// Los respaldos del GENERAL DE CLIENTES que guarda el servidor, contra el simulador del puente.
//
// El riesgo que cubren estas pruebas es uno solo y es el que importa: que REBOBINAR SEA REBOBINAR.
// Un respaldo que no se puede restaurar —o que restaura de más, o que se deshace solo a los treinta
// segundos porque el motor volvió a subir lo que había en la cola— es peor que no tener respaldo,
// porque la agencia cree que está cubierta y no lo está.
//
// No sale a internet: todo pasa por `VpsSimulado`, como el resto del banco.
import assert from 'node:assert/strict'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { FuenteVps } from '../src/main/vps/fuenteVps'

const TOKEN = 'prueba'

function conUnaCartera(): VpsSimulado {
  return new VpsSimulado({
    pestanas: [
      {
        titulo: 'AGOSTO',
        valores: [
          ['LOCAL', 'NOMBRE', 'CUOTA', '_ID'],
          ['DOCK SUD', 'GONZALEZ MARIA', '18400', 'aaa111'],
          ['LANUS', 'LOPEZ RAUL', '9900', 'bbb222'],
        ],
      },
      { titulo: 'BAJAS AGOSTO', valores: [['NOMBRE', 'MOTIVO']] },
    ],
  })
}

function fuenteDe(simulador: VpsSimulado): FuenteVps {
  return new FuenteVps({ urlBase: simulador.url, token: TOKEN })
}

test('sin ningún respaldo guardado, la lista viene vacía y no rompe nada', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  try {
    assert.deepEqual(await fuenteDe(simulador).respaldos(3), [])
  } finally {
    await simulador.cerrar()
  }
})

test('el respaldo dice qué tiene adentro: cuántas pestañas y cuántas filas', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const { respaldo, yaEstaba } = await fuente.crearRespaldo('Daniel Martínez')
    assert.equal(yaEstaba, false)
    assert.equal(respaldo.pestanas, 2, 'AGOSTO y BAJAS AGOSTO')
    assert.equal(respaldo.filas, 4, 'las tres de AGOSTO con su encabezado, más el encabezado de BAJAS')
    assert.equal(respaldo.hechoPor, 'Daniel Martínez', 'queda quién lo pidió')
    assert.match(respaldo.dia, /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    await simulador.cerrar()
  }
})

test('el respaldo del día es idempotente: apretar dos veces no llena la lista de copias iguales', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const primero = await fuente.crearRespaldo('Daniel Martínez')
    const segundo = await fuente.crearRespaldo('Ana Ruiz')
    assert.equal(segundo.yaEstaba, true, 'el segundo encuentra el que ya estaba')
    assert.equal(segundo.respaldo.id, primero.respaldo.id)
    assert.equal((await fuente.respaldos(3)).length, 1)
  } finally {
    await simulador.cerrar()
  }
})

test('sólo se piden los últimos que se van a mostrar, y vienen del más nuevo al más viejo', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    // Cinco respaldos con motivos distintos, para que el simulador no los pliegue por día.
    for (const motivo of ['DIARIO', 'A_MANO', 'ANTES_DE_RESTAURAR'] as const) simulador.guardarRespaldo(motivo, null)

    const tres = await fuente.respaldos(3)
    assert.equal(tres.length, 3)
    const fechas = tres.map((respaldo) => respaldo.fecha)
    assert.deepEqual([...fechas].sort().reverse(), fechas, 'lo más nuevo primero')

    // Y pedir menos trae menos: la pantalla muestra tres y no se baja lo que no va a dibujar.
    assert.equal((await fuente.respaldos(1)).length, 1)
  } finally {
    await simulador.cerrar()
  }
})

test('restaurar deja la base como estaba: lo que se cargó después NO sobrevive', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const { respaldo } = await fuente.crearRespaldo('Daniel Martínez')

    // Después del respaldo, la agencia sigue trabajando: se corrige una cuota y se agrega una fila.
    simulador.editarDirecto('AGOSTO', 2, 2, '99999')
    await fuente.agregarFilas('AGOSTO', [['SARANDI', 'PEREZ JUAN', '15300', 'ccc333']])
    assert.equal(simulador.valoresDe('AGOSTO')![1]![2], '99999')
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 4)

    const resumen = await fuente.restaurarRespaldo(respaldo.id, 'Daniel Martínez')

    assert.equal(resumen.pestanas, 2)
    assert.equal(resumen.filas, 4, 'vuelve a tener exactamente las filas que tenía el respaldo')
    assert.equal(simulador.valoresDe('AGOSTO')![1]![2], '18400', 'la cuota vuelve a lo que decía el respaldo')
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 3, 'y la fila cargada después no sobrevive')
  } finally {
    await simulador.cerrar()
  }
})

test('antes de rebobinar, el servidor guarda una foto de cómo estaba: restaurar tiene vuelta', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const { respaldo } = await fuente.crearRespaldo('Daniel Martínez')
    await fuente.agregarFilas('AGOSTO', [['SARANDI', 'PEREZ JUAN', '15300', 'ccc333']])

    const resumen = await fuente.restaurarRespaldo(respaldo.id, 'Daniel Martínez')
    const previo = resumen.respaldoPrevio
    assert.ok(previo, 'con la base cargada, la foto previa siempre se saca')
    assert.equal(previo.motivo, 'ANTES_DE_RESTAURAR')
    assert.equal(previo.filas, 5, 'la foto previa tiene la fila que se está por descartar')

    // Y esa foto se puede volver a restaurar: es el «me equivoqué de respaldo» con salida.
    const vuelta = await fuente.restaurarRespaldo(previo.id, 'Daniel Martínez')
    assert.equal(vuelta.filas, 5)
    assert.equal(simulador.valoresDe('AGOSTO')!.length, 4, 'volvió la fila que se había descartado')
  } finally {
    await simulador.cerrar()
  }
})

test('restaurar un respaldo que ya no está avisa, y no toca la base', async () => {
  const simulador = conUnaCartera()
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    const antes = simulador.valoresDe('AGOSTO')!.length
    await assert.rejects(fuente.restaurarRespaldo(999, 'Daniel Martínez'), /respaldo/i)
    assert.equal(simulador.valoresDe('AGOSTO')!.length, antes)
  } finally {
    await simulador.cerrar()
  }
})

test('restaurar NO se reintenta solo: pisa la base de la agencia y repetirlo es lo que no hay que hacer', async () => {
  const simulador = conUnaCartera()
  simulador.fallasIniciales = [{ estado: 500, mensaje: 'se cayó en el medio' }]
  await simulador.escuchar()
  const fuente = fuenteDe(simulador)
  try {
    await assert.rejects(fuente.restaurarRespaldo(1, 'Daniel Martínez'))
    assert.equal(simulador.llamadas.respaldosRestaurados, 0, 'ni siquiera llegó a ejecutarse una vez')
    assert.equal(simulador.intercambios.filter((i) => i.ruta.includes('/restaurar')).length, 1, 'un solo intento')
  } finally {
    await simulador.cerrar()
  }
})
