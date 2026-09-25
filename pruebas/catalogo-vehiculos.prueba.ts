// El catálogo de vehículos (el maestro que arma el VPS con las APIs de las aseguradoras), sin tocar
// internet.
//
// El VPS se reemplaza por uno de mentira que devuelve unos pocos vehículos (códigos reales de la vieja
// tabla de la DNRPA, que traen carrocería, y versiones con código de Galeno, que no), y se
// comprueba lo que de verdad importa: que la bajada llene la base (entera la primera vez y de a
// pedazos después), que el selector encadenado lea siempre de la base, que la categoría la decida la
// carrocería de la tabla, y que sin catálogo o sin VPS no se rompa nada, porque de eso depende que el
// mostrador pueda seguir cargando pólizas.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import {
  aniosDeLaLinea,
  bajarCatalogo,
  comoImportacion,
  estadoDelCatalogo,
  etiquetaDeMarca,
  importacionesDelVps,
  importarAhora,
  lineasDelCatalogo,
  marcasDelCatalogo,
  modelosDelCatalogo,
  resolverVehiculoDelCatalogo,
  usarEsperaDePrueba,
  usarFuenteDePrueba,
  type FuenteDelMaestro,
} from '../src/main/servicios/catalogoVehiculos'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { categoriaDeCatalogo } from '../src/main/vehiculos/mapeo'
import type { BajadaDelMaestroVps, VehiculoDelMaestroVps } from '../src/main/vps/fuenteVps'

// Códigos reales de la edición 01/08/2026.
const GOL_5P: VehiculoDelMaestroVps = {
  mtm: '13605413',
  tipo: 'AUTO',
  origen: 'IMPORTADO',
  marca: 'VOLKSWAGEN',
  modelo: 'GOL',
  version: 'GOL TREND 1.6',
  carroceria: 'SEDAN 5 PUERTAS',
  anios: [2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017],
  activo: true,
}
const GOL_3P: VehiculoDelMaestroVps = { ...GOL_5P, mtm: '13622413', carroceria: 'SEDAN 3 PUERTAS', anios: [2014, 2015, 2016, 2017] }
const HILUX: VehiculoDelMaestroVps = {
  mtm: '0306874',
  tipo: 'AUTO',
  origen: 'NACIONAL',
  marca: 'TOYOTA',
  modelo: 'HILUX',
  version: 'HILUX 4X2 C/D SRV 2.7 VVTI - A3',
  carroceria: 'PICK-UP',
  anios: [2002, 2003, 2004, 2005, 2012],
  activo: true,
}
const YARIS_CROSS: VehiculoDelMaestroVps = {
  mtm: '13004C38',
  tipo: 'AUTO',
  origen: 'IMPORTADO',
  marca: 'TOYOTA',
  modelo: 'YARIS',
  version: 'YARIS CROSS SEG HEV 1.5 ECVT',
  carroceria: 'RURAL 5 PUERTAS',
  anios: [2026],
  activo: true,
}
const BIZ: VehiculoDelMaestroVps = {
  mtm: '0482720',
  tipo: 'MOTO',
  origen: 'NACIONAL',
  marca: 'HONDA',
  modelo: 'BIZ',
  version: 'BIZ 125',
  carroceria: 'MOTOCICLETA',
  anios: [2012, 2013, 2014],
  activo: true,
}

/** Un VPS de mentira: responde lo que se le pase por revisión y anota qué le pidieron. */
function vpsFalso(respuestas: (desde: number) => BajadaDelMaestroVps): FuenteDelMaestro & { pedidos: number[]; lecturasPedidas: boolean[] } {
  const pedidos: number[] = []
  const lecturasPedidas: boolean[] = []
  return {
    pedidos,
    lecturasPedidas,
    leerMaestroDeVehiculos: async (desde: number) => {
      pedidos.push(desde)
      return respuestas(desde)
    },
    importacionesDeVehiculos: async () => ({ enCurso: false, progreso: null, importaciones: [] }),
    importarVehiculos: async (forzar: boolean) => {
      lecturasPedidas.push(forzar)
      return { iniciada: true }
    },
  }
}

const COMPLETO: BajadaDelMaestroVps = { revision: 1, edicion: '2026-08-01', completo: true, vehiculos: [GOL_5P, GOL_3P, HILUX, YARIS_CROSS, BIZ] }

function baseLimpia(): void {
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
}

test.afterEach(() => {
  usarFuenteDePrueba(null)
  cerrarBaseDeDatos()
})

test('sin catálogo bajado no se rompe nada: dice que no está y los desplegables vienen vacíos', () => {
  baseLimpia()
  const estado = estadoDelCatalogo()
  assert.equal(estado.hayCatalogo, false)
  assert.equal(estado.revision, 0)
  // Listas vacías, no errores: el formulario cae solo al modo a mano.
  assert.deepEqual(marcasDelCatalogo('AUTO'), [])
  assert.deepEqual(modelosDelCatalogo('AUTO', 'TOYOTA'), [])
  assert.deepEqual(lineasDelCatalogo('AUTO', 'TOYOTA', 'HILUX'), [])
})

test('sin VPS, bajar avisa con un mensaje claro', async () => {
  baseLimpia()
  // En las pruebas no hay DM_GESTION_VPS_URL: crearFuenteVps() devuelve null.
  await assert.rejects(bajarCatalogo(), (error: unknown) => error instanceof ErrorDeNegocio && /no está conectada al VPS/.test(error.message))
})

test('la primera bajada trae todo y el selector encadenado lo lee', async () => {
  baseLimpia()
  const vps = vpsFalso(() => COMPLETO)
  usarFuenteDePrueba(vps)
  const avances: string[] = []
  const estado = await bajarCatalogo((progreso) => avances.push(progreso.etapa))

  assert.deepEqual(vps.pedidos, [0])
  assert.deepEqual(avances, ['pidiendo', 'guardando', 'listo'])
  assert.equal(estado.hayCatalogo, true)
  assert.equal(estado.revision, 1)
  assert.equal(estado.edicion, '2026-08-01')
  assert.deepEqual(estado.porTipo, [
    { tipo: 'AUTO', marcas: 2, modelos: 3, versiones: 4 },
    { tipo: 'MOTO', marcas: 1, modelos: 1, versiones: 1 },
  ])

  assert.deepEqual(marcasDelCatalogo('AUTO'), [
    { id: 'TOYOTA', nombre: 'Toyota' },
    { id: 'VOLKSWAGEN', nombre: 'Volkswagen' },
  ])
  assert.deepEqual(marcasDelCatalogo('MOTO'), [{ id: 'HONDA', nombre: 'Honda' }])
  assert.deepEqual(
    modelosDelCatalogo('AUTO', 'TOYOTA').map((modelo) => modelo.id),
    ['HILUX', 'YARIS'],
  )
})

test('la misma versión en dos carrocerías lleva la carrocería en el nombre', async () => {
  baseLimpia()
  usarFuenteDePrueba(vpsFalso(() => COMPLETO))
  await bajarCatalogo()
  const lineas = lineasDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL')
  assert.deepEqual(
    lineas.map((linea) => [linea.id, linea.nombre]),
    [
      ['13622413', 'GOL TREND 1.6 · Sedan 3 puertas'],
      ['13605413', 'GOL TREND 1.6 · Sedan 5 puertas'],
    ],
  )
  // Una versión sin repetir va sola.
  assert.equal(lineasDelCatalogo('AUTO', 'TOYOTA', 'HILUX')[0]?.nombre, 'HILUX 4X2 C/D SRV 2.7 VVTI - A3')
})

test('los años son los que tienen valuación en la tabla, del más nuevo al más viejo', async () => {
  baseLimpia()
  usarFuenteDePrueba(vpsFalso(() => COMPLETO))
  await bajarCatalogo()
  assert.deepEqual(aniosDeLaLinea('AUTO', 'TOYOTA', 'HILUX', '0306874'), [2012, 2005, 2004, 2003, 2002])
  assert.deepEqual(aniosDeLaLinea('AUTO', 'TOYOTA', 'YARIS', '13004C38'), [2026])
  // Un código que no es de esa marca y modelo no devuelve nada.
  assert.deepEqual(aniosDeLaLinea('AUTO', 'VOLKSWAGEN', 'GOL', '0306874'), [])
})

test('resolver: la categoría la decide la carrocería, y el código es el MTM', async () => {
  baseLimpia()
  usarFuenteDePrueba(vpsFalso(() => COMPLETO))
  await bajarCatalogo()

  assert.deepEqual(resolverVehiculoDelCatalogo('AUTO', 'TOYOTA', 'HILUX', '0306874', '2004'), {
    tipo: 'AUTO',
    marca: 'Toyota',
    modelo: 'HILUX',
    linea: 'HILUX 4X2 C/D SRV 2.7 VVTI - A3',
    anio: '2004',
    categoria: 'PICKUP',
    codigo: '0306874',
  })
  assert.equal(resolverVehiculoDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL', '13605413', '2015').categoria, 'HATCHBACK')
  assert.equal(resolverVehiculoDelCatalogo('AUTO', 'TOYOTA', 'YARIS', '13004C38', '2026').categoria, 'RURAL')
  assert.equal(resolverVehiculoDelCatalogo('MOTO', 'HONDA', 'BIZ', '0482720', '2013').categoria, 'MOTO')

  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', 'TOYOTA', 'HILUX', '0306874', '2010'), /no ofrecen esa versión/)
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', 'TOYOTA', 'HILUX', 'NOEXISTE', '2004'), /no está en el catálogo/)
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', 'TOYOTA', 'HILUX', '0306874', ''), /año/)
})

test('después de la primera, se pide sólo lo nuevo; un código dado de baja deja de ofrecerse sin borrarse', async () => {
  baseLimpia()
  const vps = vpsFalso((desde) =>
    desde === 0
      ? COMPLETO
      : {
          revision: 2,
          edicion: '2026-09-04',
          completo: false,
          vehiculos: [
            { ...HILUX, anios: [...HILUX.anios, 2013] },
            { ...GOL_3P, activo: false },
          ],
        },
  )
  usarFuenteDePrueba(vps)
  await bajarCatalogo()
  const estado = await bajarCatalogo()

  assert.deepEqual(vps.pedidos, [0, 1])
  assert.equal(estado.revision, 2)
  assert.equal(estado.edicion, '2026-09-04')
  assert.equal(aniosDeLaLinea('AUTO', 'TOYOTA', 'HILUX', '0306874')[0], 2013)
  assert.deepEqual(
    lineasDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL').map((linea) => linea.id),
    ['13605413'],
  )
  // Sigue en la base, sólo apagado: una póliza vieja lo puede nombrar.
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL', '13622413', '2015'), /no está en el catálogo/)
})

test('una bajada completa apaga lo que ya no vino', async () => {
  baseLimpia()
  let segunda = false
  usarFuenteDePrueba(
    vpsFalso(() => {
      if (!segunda) return COMPLETO
      return { ...COMPLETO, revision: 5, vehiculos: [GOL_5P, HILUX, YARIS_CROSS, BIZ] }
    }),
  )
  await bajarCatalogo()
  // El servidor contesta con el catálogo entero (por ejemplo, porque se reimportó desde cero): lo
  // que no vino se apaga.
  segunda = true
  await bajarCatalogo()
  assert.deepEqual(
    lineasDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL').map((linea) => linea.id),
    ['13605413'],
  )
})

test('si el servidor quedó atrás de esta PC, se vuelve a pedir todo', async () => {
  baseLimpia()
  let revisionDelServidor = 7
  const vps = vpsFalso((desde) =>
    desde === 0
      ? { ...COMPLETO, revision: revisionDelServidor }
      : { revision: revisionDelServidor, edicion: null, completo: false, vehiculos: [] },
  )
  usarFuenteDePrueba(vps)
  await bajarCatalogo()
  revisionDelServidor = 3
  const estado = await bajarCatalogo()
  assert.deepEqual(vps.pedidos, [0, 7, 0])
  assert.equal(estado.revision, 3)
})

test('un servidor sin catálogo todavía no borra lo que había, deja el motivo anotado y le pide que lea las APIs', async () => {
  baseLimpia()
  // Por ejemplo: se restauró el VPS desde cero y todavía no leyó las APIs.
  const vps = vpsFalso((desde) => (desde === 0 ? COMPLETO : { revision: 0, edicion: null, completo: true, vehiculos: [] }))
  usarFuenteDePrueba(vps)
  await bajarCatalogo()
  await assert.rejects(bajarCatalogo(), /todavía está armando el catálogo con las APIs/)
  const estado = estadoDelCatalogo()
  assert.equal(estado.hayCatalogo, true)
  assert.equal(estado.porTipo[0]?.versiones, 4)
  assert.match(estado.ultimoError ?? '', /todavía está armando el catálogo/)
  // Sin forzar: si el servidor ya está leyendo, o leyó hace poco, no arranca otra lectura.
  assert.deepEqual(vps.lecturasPedidas, [false])
})

// Versiones como las publica el VPS con la API de Galeno: el código es el de Galeno y no hay carrocería.
const GALENO_AMAROK: VehiculoDelMaestroVps = {
  mtm: 'GALENO:4:39:1203:77',
  tipo: 'AUTO',
  origen: 'GALENO',
  marca: 'VOLKSWAGEN',
  modelo: 'AMAROK',
  version: 'AMAROK 2.0 TDI 4X4 D/C HIGHLINE',
  carroceria: null,
  anios: [2019, 2020, 2021],
  activo: true,
}
const GALENO_WAVE: VehiculoDelMaestroVps = {
  mtm: 'GALENO:28:900:1:7',
  tipo: 'MOTO',
  origen: 'GALENO',
  marca: 'HONDA',
  modelo: 'WAVE',
  version: 'WAVE 110 S',
  carroceria: null,
  anios: [2020],
  activo: true,
}

test('las versiones de Galeno: el código es el de Galeno y la categoría sale de la descripción', async () => {
  baseLimpia()
  usarFuenteDePrueba(vpsFalso(() => ({ revision: 1, edicion: '2026-09-25', completo: true, vehiculos: [GALENO_AMAROK, GALENO_WAVE] })))
  await bajarCatalogo()
  const amarok = resolverVehiculoDelCatalogo('AUTO', 'VOLKSWAGEN', 'AMAROK', 'GALENO:4:39:1203:77', '2020')
  assert.equal(amarok.codigo, 'GALENO:4:39:1203:77')
  assert.equal(amarok.categoria, 'PICKUP')
  assert.equal(resolverVehiculoDelCatalogo('MOTO', 'HONDA', 'WAVE', 'GALENO:28:900:1:7', '2020').categoria, 'MOTO')
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', 'VOLKSWAGEN', 'AMAROK', 'GALENO:4:39:1203:77', '2015'), /no ofrecen esa versión para 2015/)
})

test('«Leer las APIs ahora»: pide la lectura, sigue el avance hasta que termina y baja lo nuevo', async () => {
  baseLimpia()
  usarEsperaDePrueba(0)
  let consultas = 0
  const lecturasPedidas: boolean[] = []
  const log = {
    id: 'l1',
    fuente: 'GALENO',
    edicion: '2026-09-25',
    estado: 'PUBLICADA',
    aceptadas: 2,
    detalle: { fuentes: [{ id: 'GALENO', nombre: 'Galeno', estado: 'LEIDA', versiones: 2, autos: 1, motos: 1, pedidos: 9, fallidos: 0 }] },
  }
  usarFuenteDePrueba({
    leerMaestroDeVehiculos: async () => ({ revision: 1, edicion: '2026-09-25', completo: true, vehiculos: [GALENO_AMAROK, GALENO_WAVE] }),
    importarVehiculos: async (forzar) => {
      lecturasPedidas.push(forzar)
      return { iniciada: true }
    },
    importacionesDeVehiculos: async () =>
      ++consultas < 3
        ? { enCurso: true, progreso: { detalle: 'Galeno · autos: 1 versiones leídas', hechos: 25, total: 90 }, importaciones: [] }
        : { enCurso: false, progreso: null, importaciones: [log] },
  })
  const avances: string[] = []
  try {
    const resultado = await importarAhora(true, (progreso) => avances.push(progreso.detalle))
    assert.deepEqual(lecturasPedidas, [true])
    assert.equal(consultas, 3)
    assert.ok(avances.includes('Galeno · autos: 1 versiones leídas (25 de 90 pedidos)'))
    assert.equal(resultado.importacion?.fuentes[0]?.nombre, 'Galeno')
    assert.equal(resultado.estado.porTipo.find((tipo) => tipo.tipo === 'MOTO')?.versiones, 1)
  } finally {
    usarEsperaDePrueba(3_000)
  }
})

test('«Leer las APIs ahora» que falla: devuelve el motivo y no pide otra lectura', async () => {
  baseLimpia()
  usarEsperaDePrueba(0)
  const lecturasPedidas: boolean[] = []
  usarFuenteDePrueba({
    leerMaestroDeVehiculos: async () => ({ revision: 0, edicion: null, completo: true, vehiculos: [] }),
    importarVehiculos: async (forzar) => {
      lecturasPedidas.push(forzar)
      return { iniciada: true }
    },
    importacionesDeVehiculos: async () => ({
      enCurso: false,
      progreso: null,
      importaciones: [{ id: 'l1', fuente: 'GALENO', estado: 'ERROR', mensaje: 'Galeno: Usuario no habilitado' }],
    }),
  })
  try {
    const resultado = await importarAhora(true, () => undefined)
    assert.equal(resultado.importacion?.estado, 'ERROR')
    assert.equal(resultado.importacion?.mensaje, 'Galeno: Usuario no habilitado')
    assert.equal(resultado.estado.hayCatalogo, false)
    assert.deepEqual(lecturasPedidas, [true])
  } finally {
    usarEsperaDePrueba(3_000)
  }
})

test('un corte de red deja lo bajado intacto', async () => {
  baseLimpia()
  let cortado = false
  usarFuenteDePrueba(
    vpsFalso(() => {
      if (cortado) throw new Error('fetch failed')
      return COMPLETO
    }),
  )
  await bajarCatalogo()
  cortado = true
  await assert.rejects(bajarCatalogo(), /fetch failed/)
  const estado = estadoDelCatalogo()
  assert.equal(estado.hayCatalogo, true)
  assert.equal(estado.revision, 1)
  assert.equal(estado.ultimoError, 'fetch failed')
  assert.equal(estado.bajandoAhora, false)
})

test('el log de lecturas del VPS se lee con su forma y sin el VPS avisa', async () => {
  baseLimpia()
  assert.match((await importacionesDelVps()).error ?? '', /no está conectada/)
  const importacion = comoImportacion({
    id: 'a',
    fuente: 'DNRPA',
    edicion: '2026-09-04',
    estado: 'PUBLICADA',
    leidas: 18180,
    aceptadas: 18179,
    descartadas: 1,
    altas: 3,
    cambios: 10,
    bajas: 1,
    iniciadaEn: '2026-09-05T03:00:00.000Z',
    terminadaEn: '2026-09-05T03:00:12.000Z',
    detalle: { descartesPorMotivo: { 'sin-modelo': 1 }, autos: 14574, motos: 3605 },
  })
  assert.equal(importacion?.aceptadas, 18179)
  assert.deepEqual(importacion?.descartesPorMotivo, { 'sin-modelo': 1 })
  assert.equal(importacion?.motos, 3605)
  assert.deepEqual(importacion?.fuentes, [])
  assert.equal(comoImportacion(null), null)

  const deGaleno = comoImportacion({
    id: 'b',
    fuente: 'GALENO',
    edicion: '2026-09-25',
    estado: 'PUBLICADA',
    detalle: {
      fuentes: [
        { id: 'GALENO', nombre: 'Galeno', estado: 'INCOMPLETA', versiones: 9000, autos: 7000, motos: 2000, pedidos: 30000, fallidos: 3, mensaje: '3 de 30000 pedidos fallaron' },
        { nombre: 'sin id' },
      ],
    },
  })
  assert.deepEqual(deGaleno?.fuentes, [
    { id: 'GALENO', nombre: 'Galeno', estado: 'INCOMPLETA', versiones: 9000, autos: 7000, motos: 2000, pedidos: 30000, fallidos: 3, mensaje: '3 de 30000 pedidos fallaron' },
  ])
})

test('la marca en pantalla', () => {
  assert.equal(etiquetaDeMarca('VOLKSWAGEN'), 'Volkswagen')
  assert.equal(etiquetaDeMarca('MERCEDES BENZ'), 'Mercedes Benz')
  assert.equal(etiquetaDeMarca('BMW'), 'BMW')
})

test('la categoría sale de la carrocería de la tabla y, si no alcanza, de la descripción', () => {
  // Carrocerías reales de la DNRPA.
  assert.equal(categoriaDeCatalogo('AUTO', 'PICK-UP CABINA DOBLE', 'AMAROK 2.0 TDI'), 'PICKUP')
  assert.equal(categoriaDeCatalogo('AUTO', 'SEDAN 5 PUERTAS', 'GOL TREND 1.6'), 'HATCHBACK')
  assert.equal(categoriaDeCatalogo('AUTO', 'SEDAN 4 PUERTAS', 'CRONOS 1.3'), 'SEDAN')
  assert.equal(categoriaDeCatalogo('AUTO', 'TODO TERRENO', 'SW4 2.8'), 'SUV')
  assert.equal(categoriaDeCatalogo('AUTO', 'RURAL 5 PUERTAS', 'YARIS CROSS'), 'RURAL')
  assert.equal(categoriaDeCatalogo('AUTO', 'CHASIS C/CABINA', 'CARGO 1722'), 'CAMION')
  assert.equal(categoriaDeCatalogo('AUTO', 'TRANS.DE PASAJEROS', 'SPRINTER 415'), 'MICRO')
  assert.equal(categoriaDeCatalogo('MOTO', 'MOTOCICLETA', 'BIZ 125'), 'MOTO')
  assert.equal(categoriaDeCatalogo('MOTO', 'MOTONETA / SCOOTER', 'ELITE 125'), 'SCOOTER')
  assert.equal(categoriaDeCatalogo('MOTO', 'CUATRICICLO', 'TRX 420'), 'CUATRICICLO')
  // Sin carrocería, la descripción.
  assert.equal(categoriaDeCatalogo('AUTO', null, 'HILUX 2.8 SRV 4X4 D/C'), 'PICKUP')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'KANGOO FURGON 1.6'), 'FURGON')
  // «Camioneta» va última a propósito: en Argentina se le dice así a una pick-up y también a una SUV.
  assert.equal(categoriaDeCatalogo('AUTO', null, 'RANGER CAMIONETA D/C'), 'PICKUP')
  // Lo que no se puede saber devuelve null, no «OTRO».
  assert.equal(categoriaDeCatalogo('AUTO', 'SIN ESPECIFICACION', 'MODELO NUEVO 1.4'), null)
})

test('de punta a punta por HTTP: el cliente real del VPS contra el simulador', async () => {
  const { VpsSimulado } = await import('../scripts/vps-simulado.mjs')
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  process.env.DM_GESTION_VPS_URL = simulador.url
  try {
    baseLimpia()
    simulador.cargarVehiculos([GOL_5P, GOL_3P, HILUX, BIZ], '2026-08-01')
    let estado = await bajarCatalogo()
    assert.equal(estado.revision, 1)
    assert.equal(estado.porTipo[0]?.versiones, 3)

    // La edición siguiente: entra el Yaris Cross y sale el Gol de 3 puertas.
    simulador.cargarVehiculos([YARIS_CROSS, { ...GOL_3P, activo: false }], '2026-09-04')
    estado = await bajarCatalogo()
    assert.equal(estado.revision, 2)
    assert.equal(estado.edicion, '2026-09-04')
    assert.deepEqual(
      modelosDelCatalogo('AUTO', 'TOYOTA').map((modelo) => modelo.id),
      ['HILUX', 'YARIS'],
    )
    assert.deepEqual(
      lineasDelCatalogo('AUTO', 'VOLKSWAGEN', 'GOL').map((linea) => linea.id),
      ['13605413'],
    )

    // «Leer las APIs ahora» contra el simulador: arranca la lectura, la ve en curso y después baja.
    usarEsperaDePrueba(0)
    simulador.alLeerLasApis = () => {
      simulador.cargarVehiculos([GALENO_AMAROK], '2026-09-25')
      return { id: 'l1', fuente: 'GALENO', edicion: '2026-09-25', estado: 'PUBLICADA', aceptadas: 5 }
    }
    const avances: string[] = []
    const resultado = await importarAhora(true, (progreso) => avances.push(progreso.detalle))
    assert.deepEqual(simulador.lecturasPedidas, [true])
    assert.ok(avances.some((avance) => avance.startsWith('Galeno · autos')))
    assert.equal(resultado.importacion?.estado, 'PUBLICADA')
    assert.equal(resultado.estado.edicion, '2026-09-25')
    assert.deepEqual(
      lineasDelCatalogo('AUTO', 'VOLKSWAGEN', 'AMAROK').map((linea) => linea.id),
      ['GALENO:4:39:1203:77'],
    )
  } finally {
    usarEsperaDePrueba(3_000)
    delete process.env.DM_GESTION_VPS_URL
    await simulador.cerrar()
  }
})
