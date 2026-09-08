// La FuenteVps contra el simulador local del puente /api/dmg: el contrato de grilla completo
// (estructura, lecturas, celdas, filas, pestañas, _ID), la migración inicial en tres fases, los
// reintentos y la traducción de errores. No sale a internet, igual que el resto del banco.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { esFallaDeRed } from '../src/main/servicios/red'
import { adoptarVersiones, estadoDeVersiones, olvidarVersiones } from '../src/main/sincronizacion/versiones'
import { ErrorDelServidorVps, FuenteVps } from '../src/main/vps/fuenteVps'
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

    const { primeraFila, numeros } = await fuente.agregarFilas('AGOSTO', [['ONLINE', 'NUEVO CLIENTE', '5000', 'fresh0000001']])
    assert.equal(primeraFila, 5)
    assert.deepEqual(numeros, [5])

    const estructura = await fuente.estructura()
    await fuente.borrarFilas(estructura.pestanas[0]!.sheetId, [3])
    const valores = simulador.valoresDe('AGOSTO')!
    assert.equal(valores.length, 4)
    assert.equal(valores[2]![1], 'LOPEZ RAUL', 'la fila de abajo se corrió al lugar de la borrada')
    assert.equal(valores[3]![1], 'NUEVO CLIENTE')
  })

  await t.test('la versión que devuelve una escritura se adopta, para no bajarse la pestaña por el propio cambio', async () => {
    // El eco: sin esto, el aviso en vivo despierta a la computadora por lo que ella misma acaba de
    // escribir y le hace bajar la pestaña entera para no encontrar nada.
    olvidarVersiones()
    adoptarVersiones(simulador.mapaDeVersiones(), simulador.generacion)
    const conocidaAntes = estadoDeVersiones().versiones['AGOSTO']

    await fuente.escribirCeldas([{ titulo: 'AGOSTO', fila: 2, columna: 2, valor: '16500' }])
    assert.equal(estadoDeVersiones().versiones['AGOSTO'], conocidaAntes + 1, 'la escritura propia se da por vista')

    // Y el caso que hace que esto sea correcto: si otra computadora escribió en el medio, la versión
    // pega un salto y NO se adopta, para que el cambio de la otra se baje igual.
    simulador.marcarCambiada('AGOSTO')
    const antesDelSalto = estadoDeVersiones().versiones['AGOSTO']
    await fuente.escribirCeldas([{ titulo: 'AGOSTO', fila: 2, columna: 2, valor: '17000' }])
    assert.equal(estadoDeVersiones().versiones['AGOSTO'], antesDelSalto, 'con un salto de versión no se adopta nada')

    olvidarVersiones()
  })

  await t.test('borrar y escribir por _ID: la grilla corrida no engaña al borrado ni a la celda (12.6)', async () => {
    // La pestaña quedó: 1 encabezados, 2 PEREZ (abc123def456), 3 LOPEZ (mno345pqr678), 4 NUEVO CLIENTE (fresh0000001).
    const estructura = await fuente.estructura()
    const sheetId = estructura.pestanas[0]!.sheetId
    // La computadora leyó a NUEVO CLIENTE en la fila 5 (antes de que se borrara la 3): el número está
    // viejo, pero el _ID lo encuentra igual en la 4.
    const borrado = await fuente.borrarFilas(sheetId, [{ numero: 5, id: 'fresh0000001' }], 3)
    assert.deepEqual(borrado.noEncontradas, [])
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 3)
    assert.equal(simulador.valoresDe('AGOSTO')![2]![1], 'LOPEZ RAUL', 'se borró NUEVO CLIENTE y no LOPEZ')

    // Un _ID que ya no está: no se borra nada en su lugar y se avisa.
    const otra = await fuente.borrarFilas(sheetId, [{ numero: 3, id: 'fresh0000001' }], 3)
    assert.deepEqual(otra.noEncontradas, ['fresh0000001'])
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 3, 'LOPEZ sigue en la fila 3')

    // Una celda con _ID dirigida a un número viejo cae en el renglón correcto...
    const celdas = await fuente.escribirCeldas([{ titulo: 'AGOSTO', fila: 9, columna: 2, valor: '7777', id: 'mno345pqr678' }], { AGOSTO: 3 })
    assert.deepEqual(celdas.noEncontradas, [])
    assert.equal(simulador.valoresDe('AGOSTO')![2]![2], '7777')
    // ...y una dirigida a un renglón que ya no existe NO crea una fila fantasma.
    const perdida = await fuente.escribirCeldas([{ titulo: 'AGOSTO', fila: 9, columna: 2, valor: '1', id: 'yanoesta' }], { AGOSTO: 3 })
    assert.deepEqual(perdida.noEncontradas, [{ titulo: 'AGOSTO', id: 'yanoesta' }])
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 3, 'la pestaña no creció')

    // Agregar una fila cuyo _ID ya está no la repite, y la respuesta dice cuál quedó afuera.
    const agregado = await fuente.agregarFilas('AGOSTO', [
      ['ONLINE', 'REPETIDA', '1', 'mno345pqr678'],
      ['ONLINE', 'NUEVA DE VERDAD', '2', 'nueva0000002'],
    ])
    assert.deepEqual(agregado.numeros, [null, 4])
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 4)
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
    // Con `previos`, la celda que ya no dice lo que se vio se salta: la grilla se corrió en el medio.
    const tramo = await fuente.escribirTramos('AGOSTO', 39, [{ fila: 2, valores: ['id-x', 'id-y'], previos: ['', 'id-b'] }])
    assert.deepEqual(tramo.saltadas, [2])
    assert.equal(simulador.valoresDe('AGOSTO')![1]![39], 'id-a', 'la fila 2 no se pisó')
    assert.equal(simulador.valoresDe('AGOSTO')![2]![39], 'id-y')
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
        assert.ok(error instanceof ErrorDelServidorVps)
        assert.equal(error.status, 401, '12.7: el código viaja con el error')
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

// Los adjuntos (12.6) van por otro camino que la grilla: el archivo crudo en el cuerpo, los datos en
// encabezados. Lo que se prueba es el contrato contra el simulador, que copia al servidor real:
// idempotente por id + hash, 409 si el mismo id trae otro contenido, 400 si llegó dañado, 413 si
// supera el tope, y 404 después de borrarlo.
test('fuente VPS: los adjuntos suben crudos, bajan iguales y se borran', async () => {
  const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE', '_ID']] }] })
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const contenido = Buffer.from('foto de prueba '.repeat(100))
    const sha256 = createHash('sha256').update(contenido).digest('hex')
    const id = 'a'.repeat(32)
    const ficha = { id, nombre: 'Póliza Gómez.pdf', tipo: 'application/pdf', grupo: 'poliza-1', subidoPor: 'Fede', sha256 }

    const primera = await fuente.subirAdjunto(ficha, contenido)
    assert.equal(primera.yaEstaba, false)
    const segunda = await fuente.subirAdjunto(ficha, contenido)
    assert.equal(segunda.yaEstaba, true, 'repetir la misma subida es gratis')

    const otro = Buffer.from('otra cosa')
    await assert.rejects(
      fuente.subirAdjunto({ ...ficha, sha256: createHash('sha256').update(otro).digest('hex') }, otro),
      /no se reescribe/,
      'el mismo id con otro contenido es un 409',
    )
    // 12.7: el código HTTP viaja con el error, porque quien sube decide con él si el rechazo es del
    // archivo (413, 400 dañado: rendirse al tercero) o de otra cosa (401, 503: esperar y reintentar).
    await assert.rejects(fuente.subirAdjunto({ ...ficha, id: 'b'.repeat(32), sha256: 'f'.repeat(64) }, contenido), (error: Error) => {
      assert.ok(error instanceof ErrorDelServidorVps)
      assert.match(error.message, /dañado/)
      assert.equal(error.status, 400)
      // El mensaje lleva adentro el nombre del archivo; el detalle es lo que dijo el servidor y nada
      // más. Quien decide por palabras (`esRechazoDelArchivo`) mira el detalle, para que un adjunto
      // llamado «hash.pdf» o «dañado.pdf» no se dé por rechazado con cualquier 400 pasajero.
      assert.match(error.message, /subir el adjunto «Póliza Gómez\.pdf»/)
      assert.doesNotMatch(error.detalle, /Póliza Gómez/)
      assert.match(error.detalle, /dañado/)
      return true
    })

    const bajado = await fuente.bajarAdjunto(id)
    assert.equal(bajado.nombre, 'Póliza Gómez.pdf', 'el nombre vuelve con acentos')
    assert.equal(bajado.tipo, 'application/pdf')
    assert.equal(bajado.sha256, sha256)
    assert.ok(bajado.contenido.equals(contenido), 'los bytes vuelven iguales')

    simulador.topeDeAdjunto = 10
    await assert.rejects(fuente.subirAdjunto({ ...ficha, id: 'c'.repeat(32) }, contenido), (error: Error) => {
      assert.ok(error instanceof ErrorDelServidorVps)
      assert.match(error.message, /supera el máximo/)
      assert.equal(error.status, 413)
      return true
    })

    await fuente.borrarAdjunto(id)
    await assert.rejects(fuente.bajarAdjunto(id), (error: Error) => {
      assert.ok(error instanceof ErrorDelServidorVps)
      assert.match(error.message, /no existe/)
      assert.equal(error.status, 404)
      return true
    })
    await fuente.borrarAdjunto(id)
  } finally {
    await simulador.cerrar()
  }
})
