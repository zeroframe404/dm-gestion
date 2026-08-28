// La FuenteVps contra el simulador local del puente /api/dmg: el contrato de grilla completo
// (estructura, lecturas, celdas, filas, pestañas, _ID), la migración inicial en tres fases, los
// reintentos y la traducción de errores. No sale a internet, igual que el resto del banco.
import assert from 'node:assert/strict'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { esFallaDeRed } from '../src/main/servicios/red'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { contar, importar, baseDePrueba } from './ayuda'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const TOKEN = 'prueba'

function fuenteDe(simulador: VpsSimulado, token = TOKEN): FuenteVps {
  return new FuenteVps({ urlBase: simulador.url, token })
}

test('fuente VPS: el contrato de grilla de punta a punta', async (t) => {
  const simulador = new VpsSimulado({
    pestanas: [
      {
        titulo: 'AGOSTO',
        valores: [
          ['LOCAL', 'NOMBRE', 'CUOTA', '_ID'],
          ['DOCK SUD', 'PEREZ JUAN', '15300', 'abc123def456'],
          ['LANUS', 'GOMEZ ANA', '12000', 'xyz789ghi012'],
          ['DOCK SUD', 'LOPEZ RAUL', '9900', 'mno345pqr678'],
        ],
      },
      { titulo: 'BAJAS AGOSTO', valores: [['NOMBRE', 'MOTIVO']] },
    ],
  })
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)

  try {
  await t.test('estructura y lecturas', async () => {
    const estructura = await fuente.estructura()
    assert.equal(estructura.hojaId, 'vps')
    assert.equal(estructura.pestanas.length, 2)
    const agosto = estructura.pestanas[0]!
    assert.equal(agosto.titulo, 'AGOSTO')
    assert.equal(agosto.filas, 4)

    const primeras = await fuente.leerPrimerasFilas('AGOSTO', 2)
    assert.equal(primeras.length, 2)
    assert.equal(primeras[1]![1], 'PEREZ JUAN')

    const varias = await fuente.leerVarias(['AGOSTO', 'BAJAS AGOSTO'])
    assert.equal(varias.length, 2)
    assert.equal(varias[1]!.valores[0]![1], 'MOTIVO')

    await assert.rejects(fuente.leerValores('NO EXISTE'), (error: Error) => {
      assert.ok(error instanceof ErrorDeNegocio)
      assert.match(error.message, /NO EXISTE/)
      return true
    })
  })

  await t.test('celdas, filas nuevas y borrado con corrimiento', async () => {
    await fuente.escribirCeldas([{ titulo: 'AGOSTO', fila: 2, columna: 2, valor: '16000' }])
    assert.equal(simulador.valoresDe('AGOSTO')![1]![2], '16000')

    const primera = await fuente.agregarFilas('AGOSTO', [['ONLINE', 'NUEVO CLIENTE', '5000', 'fresh0000001']])
    assert.equal(primera, 5)

    const estructura = await fuente.estructura()
    await fuente.borrarFilas(estructura.pestanas[0]!.sheetId, [3])
    const valores = simulador.valoresDe('AGOSTO')!
    assert.equal(valores.length, 4)
    assert.equal(valores[2]![1], 'LOPEZ RAUL', 'la fila de abajo se corrió al lugar de la borrada')
    assert.equal(valores[3]![1], 'NUEVO CLIENTE')
  })

  await t.test('pestañas nuevas, tramos de _ID y columna oculta', async () => {
    const creada = await fuente.crearPestana('APP LEADS', ['FECHA', 'NOMBRE', 'TELEFONO'])
    assert.equal(creada.titulo, 'APP LEADS')
    assert.equal(creada.filas, 1)
    await assert.rejects(fuente.crearPestana('APP LEADS', []), /Ya existe/)

    const estructura = await fuente.estructura()
    const agosto = estructura.pestanas.find((p) => p.titulo === 'AGOSTO')!
    await fuente.asegurarColumnas(agosto.sheetId, 40)
    await fuente.escribirTramos('AGOSTO', 39, [{ fila: 2, valores: ['id-a', 'id-b'] }])
    assert.equal(simulador.valoresDe('AGOSTO')![1]![39], 'id-a')
    await fuente.ocultarColumna(agosto.sheetId, 39)
  })

  await t.test('el token viaja sólo en el encabezado Authorization', () => {
    assert.ok(simulador.intercambios.length > 0)
    for (const intercambio of simulador.intercambios) {
      assert.equal(intercambio.autorizacion, `Bearer ${TOKEN}`)
      assert.ok(!intercambio.ruta.includes(TOKEN))
    }
  })
  } finally {
    await simulador.cerrar()
  }
})

test('fuente VPS: errores y reintentos', async (t) => {
  await t.test('token equivocado → mensaje de negocio, sin reintentar', async () => {
    const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE']] }] })
    await simulador.escuchar()
    try {
      const fuente = fuenteDe(simulador, 'token-equivocado')
      await assert.rejects(fuente.estructura(), (error: Error) => {
        assert.ok(error instanceof ErrorDeNegocio)
        assert.match(error.message, /token/i)
        return true
      })
      assert.equal(simulador.intercambios.length, 1, 'un 401 no se reintenta')
    } finally {
      await simulador.cerrar()
    }
  })

  await t.test('base sin migrar → mensaje que guía a la migración, y la lectura de la subida corta antes de escribir', async () => {
    const simulador = new VpsSimulado()
    await simulador.escuchar()
    try {
      const fuente = fuenteDe(simulador)
      await assert.rejects(fuente.leerVarias(['AGOSTO']), (error: Error) => {
        assert.ok(error instanceof ErrorDeNegocio)
        assert.match(error.message, /migraci/i)
        return true
      })
      const estado = await fuente.estadoBase()
      assert.equal(estado.inicializada, false)
    } finally {
      await simulador.cerrar()
    }
  })

  await t.test('un 500 pasajero se reintenta en las lecturas', async () => {
    const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE'], ['ANA']] }] })
    await simulador.escuchar()
    simulador.fallasIniciales.push({ estado: 500, mensaje: 'se reinició el backend' })
    try {
      const fuente = fuenteDe(simulador)
      const valores = await fuente.leerValores('AGOSTO')
      assert.equal(valores.length, 2)
    } finally {
      await simulador.cerrar()
    }
  })

  await t.test('agregar filas NO se reintenta ante un 500: pudo haberse aplicado igual', async () => {
    const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE']] }] })
    await simulador.escuchar()
    simulador.fallasIniciales.push({ estado: 500, mensaje: 'se cortó en el medio' })
    try {
      const fuente = fuenteDe(simulador)
      await assert.rejects(fuente.agregarFilas('AGOSTO', [['ANA']]))
      assert.equal(simulador.llamadas.agregar, 0, 'no llegó a aplicarse y tampoco se repitió')
    } finally {
      await simulador.cerrar()
    }
  })

  await t.test('crear pestaña tampoco se reintenta ante un 500', async () => {
    const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE']] }] })
    await simulador.escuchar()
    simulador.fallasIniciales.push({ estado: 500, mensaje: 'se cortó en el medio' })
    try {
      const fuente = fuenteDe(simulador)
      await assert.rejects(fuente.crearPestana('APP LEADS', ['FECHA']))
      assert.equal(simulador.llamadas.pestanas, 0, 'no llegó a aplicarse y tampoco se repitió')
    } finally {
      await simulador.cerrar()
    }
  })

  await t.test('servidor caído → falla de red que la cola sabe esperar', async () => {
    const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE']] }] })
    await simulador.escuchar()
    const fuente = fuenteDe(simulador)
    await simulador.cerrar()
    await assert.rejects(fuente.agregarFilas('AGOSTO', [['ANA']]), (error: unknown) => {
      assert.ok(esFallaDeRed(error), 'tiene que reconocerse como «sin conexión», no como «el servidor dijo que no»')
      return true
    })
  })
})

test('fuente VPS: migración inicial y dos computadoras contra la misma base', async () => {
  // La hoja simulada de siempre hace de «hoja de Google» de la agencia; el simulador del VPS
  // arranca vacío y recibe la migración pestaña por pestaña, como el botón de Administración.
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  const vps = fuenteDe(simulador)

  try {
  const estructura = await hoja.estructura()
  await vps.migracionComenzar()
  for (const pestana of [...estructura.pestanas].sort((a, b) => a.indice - b.indice)) {
    await vps.migracionCargarPestana({
      titulo: pestana.titulo,
      oculta: pestana.oculta,
      valores: await hoja.leerValores(pestana.titulo),
    })
  }
  const resumen = await vps.migracionConfirmar()
  assert.ok(resumen.pestanas >= 20, `migraron todas las pestañas (fueron ${resumen.pestanas})`)
  await assert.rejects(vps.migracionComenzar(), /una sola vez/)

  // La computadora A importa desde el VPS: tiene que dar exactamente lo mismo que importar
  // de la hoja original, porque la migración es una copia literal.
  const dbDesdeHoja = baseDePrueba()
  await importar(dbDesdeHoja, new HojaSimulada(construirHojaDePrueba()))
  const dbA = baseDePrueba()
  const { informe } = await importar(dbA, vps)
  assert.equal(informe.estado, 'COMPLETA')
  for (const tabla of ['clientes', 'polizas', 'cuotas_mes', 'bajas', 'siniestros', 'pagos'] as const) {
    assert.equal(
      contar(dbA, tabla),
      contar(dbDesdeHoja, tabla),
      `misma cantidad de ${tabla} que importando de la hoja original`,
    )
  }

  // Un cambio que la computadora A escribe en el VPS aparece en la B al importar: la base del
  // VPS es ahora el bus entre las sucursales, como antes lo era la hoja.
  // De la planilla mensual MÁS NUEVA: es la que define la cartera y tiene la columna PAGO.
  const fila = dbA
    .prepare(
      `SELECT fila_id, numero_fila, pestana FROM filas_crudas
       WHERE tipo_pestana = 'MENSUAL' AND en_la_hoja = 1
       ORDER BY periodo DESC, numero_fila ASC LIMIT 1`,
    )
    .get() as { fila_id: string; numero_fila: number; pestana: string }
  const encabezados = (await vps.leerPrimerasFilas(fila.pestana, 1))[0]!
  const columnaPago = encabezados.findIndex((encabezado) => encabezado.trim().toUpperCase() === 'PAGO')
  assert.ok(columnaPago >= 0, 'la pestaña mensual migrada conserva la columna PAGO')
  await vps.escribirCeldas([{ titulo: fila.pestana, fila: fila.numero_fila, columna: columnaPago, valor: '28/08' }])

  const dbB = baseDePrueba()
  await importar(dbB, vps)
  const pagoEnB = dbB
    .prepare(`SELECT pago FROM cuotas_mes WHERE fila_id = ?`)
    .get(fila.fila_id) as { pago: string | null } | undefined
  assert.equal(pagoEnB?.pago, '28/08', 'el pago escrito por una computadora aparece en la otra')
  } finally {
    await simulador.cerrar()
  }
})
