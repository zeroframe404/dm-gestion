// El aviso en vivo, de punta a punta contra el simulador del puente.
//
// Lo que se prueba acá es el camino que hace que un cambio hecho en otra sucursal aparezca en ésta en
// el momento: el vigía pregunta qué cambió, baja SÓLO esas pestañas, y recién entonces las da por
// vistas. «La otra computadora» es el simulador editado directo, que es exactamente lo que ve esta
// máquina cuando otra escribió.
//
// Las dos cosas que más importan y que son fáciles de romper sin que se note:
//
//   - Que baje sólo lo que cambió y no las treinta pestañas. Si eso se rompe, todo «funciona» y la
//     agencia se come una lectura de varios MB cada vez que alguien tipea una celda.
//   - Que NO se dé por vista una pestaña que no se llegó a bajar. Si eso se rompe, el cambio se pierde
//     hasta el reloj de red de los cinco minutos, que es justo lo que esto vino a evitar.
import assert from 'node:assert/strict'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { planillaDelMes } from '../src/main/servicios/cartera'
import { leerSnapshotDeMetrica } from '../src/main/servicios/metricasCache'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { estadoDeVersiones } from '../src/main/sincronizacion/versiones'
import { esServidorSinAviso } from '../src/main/sincronizacion/puenteDeGrilla'
import { reiniciarVigiaParaPruebas, unaVueltaDelVigia } from '../src/main/sincronizacion/vigia'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { baseDePrueba, importar } from './ayuda'

const TOKEN = 'prueba'

/** La planilla de un mes, con la columna `_ID` que la aplicación escribe al final. */
function hojaDeLaAgencia() {
  return [
    {
      titulo: 'AGOSTO 2026',
      valores: [
        ['LOCAL', 'NOMBRE', 'COMPANIA', 'PATENTE', 'CUOTA', '_ID'],
        ['DOCK SUD', 'PEREZ JUAN', 'RIVADAVIA', 'AA123BB', '15300', 'id-perez'],
        ['LANUS', 'GOMEZ ANA', 'RIVADAVIA', 'AC456DD', '12000', 'id-gomez'],
      ],
    },
    { titulo: 'BAJAS AGOSTO 2026', valores: [['NOMBRE', 'COMPANIA', 'PATENTE', 'MOTIVO', '_ID']] },
    { titulo: 'SINIESTROS', valores: [['FECHA', 'NOMBRE', 'COMPANIA', 'PATENTE', 'DETALLE', '_ID']] },
  ]
}

interface Computadora {
  db: BaseDeDatos
  fuente: FuenteVps
  motor: MotorDeSincronizacion
}

/**
 * Una computadora de la agencia contra el simulador: base propia en memoria, ya importada, y su
 * propio motor —no el del programa, que trae el importador de verdad y la base de la máquina—.
 */
async function unaComputadora(simulador: VpsSimulado): Promise<Computadora> {
  // `credencialesDelPuente` fuera de Electron lee estas dos: con esto el puente del vigía sale contra
  // el simulador y no contra el VPS de verdad.
  process.env.DM_GESTION_VPS_URL = simulador.url
  process.env.DM_GESTION_VPS_TOKEN = TOKEN
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  const fuente = new FuenteVps({ urlBase: simulador.url, token: TOKEN })
  await importar(db, fuente)
  const importarPestanas = async (pestanas?: string[]) => {
    usarBaseDeDatos(db)
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente, importacionId: id, soloPestanas: pestanas })
  }
  const motor = new MotorDeSincronizacion({ crearFuente: () => fuente, importar: importarPestanas })
  motor.encender()
  reiniciarVigiaParaPruebas()
  return { db, fuente, motor }
}

/**
 * Deja activa esta base. El banco comparte una sola «base actual» entre todos los archivos, y los
 * relojes del motor siguen corriendo entre pruebas: sin esto, una vuelta del vigía puede encontrarse
 * con la base de otra prueba, o con ninguna.
 */
function en(db: BaseDeDatos): void {
  usarBaseDeDatos(db)
}

function cerrar(pc: Computadora): void {
  en(pc.db)
  pc.motor.apagar()
  reiniciarVigiaParaPruebas()
  pc.db.close()
  delete process.env.DM_GESTION_VPS_URL
  delete process.env.DM_GESTION_VPS_TOKEN
}

/** La primera vuelta adopta el mapa sin bajar nada: al arrancar ya se sincronizó todo. */
async function ponerseAlDia(pc: Computadora): Promise<void> {
  const bajadas = await unaVueltaDelVigia(pc.motor)
  assert.deepEqual(bajadas, [], 'la primera vuelta no baja nada: adopta el mapa y listo')
}

function cuotaDe(nombre: string): string | undefined {
  const planilla = planillaDelMes(null)
  return planilla.filas.find((fila) => (fila.nombre ?? '').includes(nombre))?.cuota ?? undefined
}

// Un solo `test` con los pasos seguidos, y no siete subtests, a propósito: el banco tiene un
// `afterEach` global (el del catálogo de vehículos) que cierra la base actual, y entre subtests eso
// deja a esta prueba sin base a mitad de camino. Los pasos van comentados para que un fallo se
// ubique igual de rápido.
test('aviso en vivo: baja sólo la pestaña que cambió, y recién ahí la da por vista', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const pc = await unaComputadora(simulador)

  try {
    // 1. La primera vuelta adopta el mapa sin bajar nada: al arrancar ya se sincronizó todo.
    en(pc.db)
    await ponerseAlDia(pc)
    assert.equal(estadoDeVersiones().generacion, 1)
    assert.equal(Object.keys(estadoDeVersiones().versiones).length, 3, 'conoce las tres pestañas de la hoja')
    const bajadaAntes = pc.motor.estado().ultimaBajada

    // 2. Lo que escribió la otra sucursal baja SÓLO esa pestaña. Si esto se rompe todo «funciona» y
    //    la agencia se come una lectura de varios MB cada vez que alguien tipea una celda.
    simulador.editarDirecto('AGOSTO 2026', 2, 4, '18000')
    simulador.marcarCambiada('AGOSTO 2026')
    simulador.pestanasLeidas = []
    assert.deepEqual(await unaVueltaDelVigia(pc.motor), ['AGOSTO 2026'], 'una sola pestaña, no las tres')
    assert.deepEqual(simulador.pestanasLeidas, ['AGOSTO 2026'], 'no se bajó ninguna otra pestaña entera')
    assert.equal(cuotaDe('PEREZ'), '18000', 'el dato de la otra sucursal ya está en esta base')
    // Y cuenta como bajada (13.0.2): es la hora que el podio de Inicio muestra como «datos bajados del
    // servidor», y la que la barra usa para «sincronizado hace…». Con el vigía andando casi todo
    // llega por acá, así que si no la corriera las dos dirían una hora vieja con datos nuevos.
    const bajadaDespues = pc.motor.estado().ultimaBajada
    assert.ok(bajadaDespues, 'la bajada en vivo deja la marca de última bajada')
    assert.ok(bajadaAntes === null || bajadaDespues > bajadaAntes, 'y la corre hacia adelante')

    // 3. Sin novedades no baja nada.
    simulador.pestanasLeidas = []
    assert.deepEqual(await unaVueltaDelVigia(pc.motor), [])
    assert.deepEqual(simulador.pestanasLeidas, [], 'ni una lectura de más')

    // 4. El eco: lo que escribe ESTA computadora no la hace bajar nada. Sin la versión que devuelve
    //    la escritura, el vigía se despertaría por su propio cambio y se bajaría la planilla entera
    //    —dos mil y pico de renglones— para no encontrar nada.
    await pc.fuente.escribirCeldas([{ titulo: 'AGOSTO 2026', fila: 3, columna: 4, valor: '13000', id: 'id-gomez' }], {
      'AGOSTO 2026': 5,
    })
    simulador.pestanasLeidas = []
    assert.deepEqual(await unaVueltaDelVigia(pc.motor), [], 'reconoce su propia escritura')
    assert.deepEqual(simulador.pestanasLeidas, [], 'y no se baja nada por su propio cambio')

    // 5. El eco cruzado: si otra computadora escribió en el medio, SÍ baja. Es el caso real de dos
    //    mostradores de Lanús cargando pagos del mismo mes: la versión que nos vuelve pega un salto
    //    de dos, y adoptarla nos haría perder el cambio de la otra para siempre.
    simulador.editarDirecto('AGOSTO 2026', 3, 3, 'AC456ZZ')
    simulador.marcarCambiada('AGOSTO 2026')
    await pc.fuente.escribirCeldas([{ titulo: 'AGOSTO 2026', fila: 2, columna: 4, valor: '19000', id: 'id-perez' }], {
      'AGOSTO 2026': 5,
    })
    assert.deepEqual(
      await unaVueltaDelVigia(pc.motor),
      ['AGOSTO 2026'],
      'el salto de versión delata que escribió otro',
    )

    // 6. Una pestaña nueva del otro lado (el cierre de mes de otra sucursal) entra aunque no esté en
    //    el mapa: el servidor la nombra por desconocida, no por su versión.
    simulador.cargarPestanaDirecto({
      titulo: 'SEPTIEMBRE 2026',
      valores: [['LOCAL', 'NOMBRE', 'COMPANIA', 'PATENTE', 'CUOTA', '_ID']],
    })
    const conLaNueva = await unaVueltaDelVigia(pc.motor)
    assert.ok(conLaNueva.includes('SEPTIEMBRE 2026'), `la pestaña nueva tiene que entrar: ${conLaNueva.join(', ')}`)

    // 7. El rebobinado: restaurar un respaldo borra las pestañas y las recrea, así que las versiones
    //    vuelven a empezar y podrían coincidir con las que esta computadora ya conocía. La generación
    //    es lo que lo delata.
    simulador.versiones = new Map()
    simulador.subirGeneracion()
    const tras = await unaVueltaDelVigia(pc.motor)
    assert.ok(tras.length >= 3, `un rebobinado se baja entero, no una pestaña: ${tras.join(', ')}`)
    assert.equal(estadoDeVersiones().generacion, 2)
  } finally {
    cerrar(pc)
    await simulador.cerrar()
  }
})

test('aviso en vivo: contra un servidor viejo no rompe nada y deja el carril de siempre', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const pc = await unaComputadora(simulador)

  try {
    // Un VPS anterior a la 13.1 no tiene la ruta: contesta 404. No es un error que haya que reintentar
    // en loop, es «este servidor todavía no sabe avisar».
    en(pc.db)
    simulador.errorFijo = { estado: 404, mensaje: 'La ruta solicitada no existe.' }

    // Lo que el bucle necesita distinguir: esto NO es un error para reintentar en loop, es «este
    // servidor todavía no sabe avisar». De eso depende que el vigía se apague, que el motor vuelva a
    // encender su carril rápido de las tareas, y que se reintente recién dentro de diez minutos.
    const error = await unaVueltaDelVigia(pc.motor).then(
      () => null,
      (motivo: unknown) => motivo,
    )
    assert.ok(esServidorSinAviso(error), `un 404 tiene que leerse como «servidor sin aviso»: ${String(error)}`)

    // Y el mapa queda como estaba, sin dar nada por visto.
    assert.equal(estadoDeVersiones().generacion, null)
  } finally {
    cerrar(pc)
    await simulador.cerrar()
  }
})

test('aviso en vivo: lo que no se pudo bajar NO se da por visto', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const pc = await unaComputadora(simulador)

  try {
    en(pc.db)
    await ponerseAlDia(pc)
    simulador.editarDirecto('AGOSTO 2026', 2, 4, '21000')
    simulador.marcarCambiada('AGOSTO 2026')

    // El motor está apagado: `ciclarBajadaDe` devuelve null y no baja nada. Ésta es la situación real
    // de un motor ocupado subiendo o importando.
    pc.motor.apagar()
    assert.deepEqual(await unaVueltaDelVigia(pc.motor), [], 'no bajó nada')
    assert.equal(cuotaDe('PEREZ'), '15300', 'y el dato viejo sigue acá')

    // Con el motor de vuelta, la vuelta siguiente lo trae: el título quedó pendiente en vez de darse
    // por visto. Sin eso, este cambio esperaría al reloj de los cinco minutos.
    pc.motor.encender()
    assert.deepEqual(await unaVueltaDelVigia(pc.motor), ['AGOSTO 2026'], 'lo reintenta solo')
    assert.equal(cuotaDe('PEREZ'), '21000')
  } finally {
    cerrar(pc)
    await simulador.cerrar()
  }
})

// El podio de sucursales (13.2) ya no lo calcula esta computadora: lo calcula el servidor una sola vez
// y lo manda por el mismo aviso en vivo que trae los cambios de la grilla, con su propia versión aparte
// de la de las pestañas. Lo que hay que probar acá no es la cuenta del podio en sí —eso lo sigue
// probando metricas.prueba.ts contra `podioDelMes`, todavía— sino el mecanismo: que una versión nueva
// se trae y se guarda, y que sin versión nueva no se vuelve a pedir.
test('aviso en vivo: cuando el servidor recalcula una métrica, esta computadora la trae y la guarda', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const pc = await unaComputadora(simulador)

  try {
    en(pc.db)
    await ponerseAlDia(pc)
    assert.equal(leerSnapshotDeMetrica('podio'), null, 'todavía no llegó ningún podio')

    // 1. El servidor calcula el podio por primera vez: la vuelta lo trae y lo guarda.
    simulador.cargarMetricaDirecto('podio', { ranking: [{ etiqueta: 'Dock Sud', altas: 3 }] })
    await unaVueltaDelVigia(pc.motor)
    const primero = leerSnapshotDeMetrica('podio')
    assert.ok(primero, 'se guardó el snapshot')
    assert.equal(primero?.servidorVersion, 1)
    assert.deepEqual(primero?.payload, { ranking: [{ etiqueta: 'Dock Sud', altas: 3 }] })
    assert.ok(!Number.isNaN(new Date(primero!.servidorCalculadoEn).getTime()), 'servidorCalculadoEn es un instante ISO')
    assert.ok(!Number.isNaN(new Date(primero!.recibidoEn).getTime()), 'recibidoEn es un instante ISO')

    // 2. Sin que la versión cambie, la vuelta siguiente no vuelve a pedirla: la comparación de
    //    versiones es lo que evita pedir de nuevo algo que no cambió.
    const leidasAntes = simulador.llamadas.metricasLeidas
    await unaVueltaDelVigia(pc.motor)
    assert.equal(simulador.llamadas.metricasLeidas, leidasAntes, 'la versión no cambió: no se vuelve a pedir')
    assert.equal(leerSnapshotDeMetrica('podio')?.servidorVersion, 1, 'y lo guardado sigue siendo lo mismo')

    // 3. El servidor la recalcula (otra sucursal cargó una alta, dijéramos): la versión sube y la
    //    próxima vuelta trae el resultado nuevo.
    simulador.cargarMetricaDirecto('podio', { ranking: [{ etiqueta: 'Dock Sud', altas: 4 }] })
    await unaVueltaDelVigia(pc.motor)
    const segundo = leerSnapshotDeMetrica('podio')
    assert.equal(segundo?.servidorVersion, 2)
    assert.deepEqual(segundo?.payload, { ranking: [{ etiqueta: 'Dock Sud', altas: 4 }] })
  } finally {
    cerrar(pc)
    await simulador.cerrar()
  }
})
