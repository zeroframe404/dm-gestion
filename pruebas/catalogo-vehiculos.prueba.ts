// El catálogo de vehículos, sin tocar internet.
//
// El proveedor se reemplaza por uno de mentira que devuelve dos marcas y unas pocas líneas, y se
// comprueba lo que de verdad importa: que el refresco llene la caché, que el selector encadenado lea
// siempre de la base, que la categoría la decida el catálogo, y —lo principal— que sin credenciales
// no se rompa nada, porque de eso depende que el mostrador pueda seguir cargando pólizas.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import {
  aniosDeLaLinea,
  estadoDelCatalogo,
  hayProveedorConfigurado,
  lineasDelCatalogo,
  marcasDelCatalogo,
  modelosDelCatalogo,
  refrescarCatalogo,
  resolverVehiculoDelCatalogo,
  usarProveedorDePrueba,
} from '../src/main/servicios/catalogoVehiculos'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { categoriaDeCatalogo } from '../src/main/vehiculos/mapeo'
import type { LineaCruda, MarcaCruda, ModeloCrudo, ProveedorDeVehiculos } from '../src/main/vehiculos/proveedor'
import type { TipoDeVehiculo } from '../src/shared/tipos'

/** Un proveedor de mentira: dos marcas de autos y una de motos, con sus versiones. */
function proveedorFalso(opciones: { fallaMotos?: boolean } = {}): ProveedorDeVehiculos {
  const marcas: Record<TipoDeVehiculo, MarcaCruda[]> = {
    AUTO: [
      { id: '1', nombre: 'TOYOTA' },
      { id: '2', nombre: 'FORD' },
    ],
    MOTO: [{ id: '9', nombre: 'HONDA' }],
  }
  const modelos: Record<string, ModeloCrudo[]> = {
    'AUTO:1': [{ id: '11', marcaId: '1', nombre: 'HILUX' }],
    'AUTO:2': [{ id: '21', marcaId: '2', nombre: 'FOCUS' }],
    'MOTO:9': [{ id: '91', marcaId: '9', nombre: 'WAVE' }],
  }
  const lineas: Record<string, LineaCruda[]> = {
    'AUTO:1:11': [
      {
        id: '101',
        marcaId: '1',
        modeloId: '11',
        nombre: 'HILUX 2.8 SRV 4X4 D/C',
        anioDesde: 2016,
        anioHasta: 2024,
        categoriaCruda: 'PICK UP',
        categoria: 'PICKUP',
        precioLista: 40_000_000,
      },
    ],
    'AUTO:2:21': [
      {
        id: '201',
        marcaId: '2',
        modeloId: '21',
        nombre: 'FOCUS 1.6 S 5P',
        anioDesde: 2014,
        anioHasta: 2019,
        categoriaCruda: null,
        // Sin categoría: es el caso que NO se puede inventar.
        categoria: null,
        precioLista: null,
      },
    ],
    'MOTO:9:91': [
      {
        id: '901',
        marcaId: '9',
        modeloId: '91',
        nombre: 'WAVE 110 S',
        anioDesde: null,
        anioHasta: null,
        categoriaCruda: null,
        categoria: 'MOTO',
        precioLista: null,
      },
    ],
  }

  return {
    nombre: 'DePrueba',
    tiposQueSirve: () => ['AUTO', 'MOTO'],
    probar: async () => ({ ok: true, detalle: 'Conectado con el proveedor de prueba.', marcasEncontradas: 2 }),
    marcas: async (tipo) => {
      if (tipo === 'MOTO' && opciones.fallaMotos) throw new Error('La cuenta no tiene contratadas las motos.')
      return marcas[tipo]
    },
    modelos: async (tipo, marcaId) => modelos[`${tipo}:${marcaId}`] ?? [],
    lineas: async (tipo, marcaId, modeloId) => lineas[`${tipo}:${marcaId}:${modeloId}`] ?? [],
  }
}

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
  usarProveedorDePrueba(null)
  cerrarBaseDeDatos()
})

test('sin credenciales el catálogo no rompe nada: dice que no está y sigue todo a mano', () => {
  baseLimpia()
  const estado = estadoDelCatalogo()
  assert.equal(hayProveedorConfigurado(), false)
  assert.equal(estado.configurado, false)
  assert.equal(estado.hayCatalogo, false)
  // Los desplegables devuelven listas vacías, no errores: el formulario cae solo al modo a mano.
  assert.deepEqual(marcasDelCatalogo('AUTO'), [])
  assert.deepEqual(modelosDelCatalogo('AUTO', '1'), [])
  assert.deepEqual(lineasDelCatalogo('AUTO', '1', '11'), [])
})

test('el refresco llena la caché y el selector encadenado la lee', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso())

  const avances: string[] = []
  const estado = await refrescarCatalogo(null, (progreso) => avances.push(`${progreso.tipo}:${progreso.etapa}`))

  assert.equal(estado.hayCatalogo, true)
  const autos = estado.porTipo.find((tipo) => tipo.tipo === 'AUTO')!
  assert.equal(autos.marcas, 2)
  assert.equal(autos.modelos, 2)
  assert.equal(autos.lineas, 2)
  assert.notEqual(autos.refrescadoEn, null)
  assert.equal(autos.ultimoError, null)
  // Hubo avance para las tres etapas: la barra de progreso tiene de dónde agarrarse.
  assert.ok(avances.some((paso) => paso === 'AUTO:marcas'))
  assert.ok(avances.some((paso) => paso === 'AUTO:lineas'))

  // Las marcas salen ordenadas por nombre, no por el id del proveedor.
  assert.deepEqual(
    marcasDelCatalogo('AUTO').map((marca) => marca.nombre),
    ['FORD', 'TOYOTA'],
  )
  // Y los autos y las motos no se mezclan.
  assert.deepEqual(
    marcasDelCatalogo('MOTO').map((marca) => marca.nombre),
    ['HONDA'],
  )
  assert.deepEqual(
    modelosDelCatalogo('AUTO', '1').map((modelo) => modelo.nombre),
    ['HILUX'],
  )
  assert.deepEqual(
    lineasDelCatalogo('AUTO', '1', '11').map((linea) => linea.nombre),
    ['HILUX 2.8 SRV 4X4 D/C'],
  )
})

test('la categoría la decide el catálogo y no se puede elegir; sin dato viene en null', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso())
  await refrescarCatalogo('AUTO', () => undefined)

  const hilux = resolverVehiculoDelCatalogo('AUTO', '1', '11', '101', '2020')
  assert.equal(hilux.marca, 'TOYOTA')
  assert.equal(hilux.modelo, 'HILUX')
  assert.equal(hilux.linea, 'HILUX 2.8 SRV 4X4 D/C')
  assert.equal(hilux.anio, '2020')
  assert.equal(hilux.categoria, 'PICKUP')
  // El código lleva el tipo adelante: los ids de autos y de motos se repiten entre sí.
  assert.equal(hilux.codigo, 'AUTO:101')

  // Una línea sin categoría viene en null y NO en «OTRO»: una categoría inventada se ve igual que una
  // correcta y después nadie sabe cuál revisar.
  const focus = resolverVehiculoDelCatalogo('AUTO', '2', '21', '201', '2016')
  assert.equal(focus.categoria, null)

  // Un vehículo que no está en la caché no se resuelve: no se inventa nada.
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', '1', '11', '999', '2020'), ErrorDeNegocio)
  // Y el año es obligatorio.
  assert.throws(() => resolverVehiculoDelCatalogo('AUTO', '1', '11', '101', ''), ErrorDeNegocio)
})

test('los años que se ofrecen son los que la línea existió', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso())
  await refrescarCatalogo('AUTO', () => undefined)

  const anios = aniosDeLaLinea('AUTO', '1', '11', '101', new Date('2026-08-29T12:00:00Z'))
  // La Hilux de la prueba va de 2016 a 2024: no se puede elegir 2015 ni 2026.
  assert.equal(anios[0], 2024)
  assert.equal(anios.at(-1), 2016)
  assert.ok(!anios.includes(2015))
  assert.ok(!anios.includes(2026))
})

test('que falle una mitad del catálogo no tira abajo la otra', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso({ fallaMotos: true }))

  const estado = await refrescarCatalogo(null, () => undefined)
  const autos = estado.porTipo.find((tipo) => tipo.tipo === 'AUTO')!
  const motos = estado.porTipo.find((tipo) => tipo.tipo === 'MOTO')!

  assert.equal(autos.lineas, 2, 'los autos se bajaron igual')
  assert.equal(motos.lineas, 0)
  // El motivo queda escrito: la agencia puede tener contratada una sola mitad y hay que poder decirlo.
  assert.ok(motos.ultimoError?.includes('motos'))
  assert.equal(estado.hayCatalogo, true)
})

test('un refresco que se corta no deja al mostrador sin catálogo', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso())
  await refrescarCatalogo('AUTO', () => undefined)
  assert.equal(marcasDelCatalogo('AUTO').length, 2)

  // El proveedor se cae a mitad de la segunda bajada: la caché anterior tiene que seguir entera,
  // porque el borrado y la reescritura pasan juntos y recién al final.
  const roto = proveedorFalso()
  usarProveedorDePrueba({ ...roto, lineas: async () => { throw new Error('se cortó') } })
  await refrescarCatalogo('AUTO', () => undefined)

  assert.equal(marcasDelCatalogo('AUTO').length, 2, 'lo que ya estaba bajado sigue estando')
  assert.equal(lineasDelCatalogo('AUTO', '1', '11').length, 1)
  assert.ok(estadoDelCatalogo().porTipo.find((tipo) => tipo.tipo === 'AUTO')?.ultimoError)
})

test('una bajada que vuelve vacía NO borra la caché ni se anota como exitosa', async () => {
  baseLimpia()
  usarProveedorDePrueba(proveedorFalso())
  await refrescarCatalogo('AUTO', () => undefined)
  assert.equal(marcasDelCatalogo('AUTO').length, 2)

  // El proveedor no falla: devuelve listas vacías, que es lo que pasa si cambia la forma de la
  // respuesta (otra envoltura, otro nombre para el id). Sin guard, esto borraba las 2 marcas y las 2
  // versiones y lo registraba como un refresco correcto, sin error que mirar.
  const mudo = proveedorFalso()
  usarProveedorDePrueba({ ...mudo, marcas: async () => [] })
  const estado = await refrescarCatalogo('AUTO', () => undefined)

  assert.equal(marcasDelCatalogo('AUTO').length, 2, 'lo que estaba bajado no se toca')
  assert.equal(lineasDelCatalogo('AUTO', '1', '11').length, 1)
  const autos = estado.porTipo.find((tipo) => tipo.tipo === 'AUTO')!
  assert.equal(autos.marcas, 2, 'las cuentas siguen siendo las de la bajada buena')
  assert.ok(autos.ultimoError?.includes('marca'), 'y queda el motivo escrito')
  assert.equal(estado.hayCatalogo, true)

  // Lo mismo si trae marcas pero ninguna versión: una caché sin líneas no sirve para nada.
  const sinVersiones = proveedorFalso()
  usarProveedorDePrueba({ ...sinVersiones, lineas: async () => [] })
  await refrescarCatalogo('AUTO', () => undefined)
  assert.equal(lineasDelCatalogo('AUTO', '1', '11').length, 1, 'tampoco se toca')
})

test('la categoría se deduce de la descripción cuando la API no la trae', () => {
  // Es la tabla de palabras, que es la parte más frágil del mapeo y por eso se prueba sola.
  assert.equal(categoriaDeCatalogo('AUTO', 'PICK UP', 'AMAROK 2.0 TDI'), 'PICKUP')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'HILUX 2.8 SRV 4X4 D/C'), 'PICKUP')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'KANGOO FURGON 1.6'), 'FURGON')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'COROLLA CROSS SUV'), 'SUV')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'FOCUS 1.6 S 5P'), 'HATCHBACK')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'CORSA 1.6 4P'), 'SEDAN')
  assert.equal(categoriaDeCatalogo('AUTO', null, 'IVECO DAILY CHASIS'), 'CAMION')
  // «Camioneta» va última a propósito: en Argentina se le dice así a una pick-up y también a una SUV,
  // y lo específico tiene que ganar.
  assert.equal(categoriaDeCatalogo('AUTO', null, 'RANGER CAMIONETA D/C'), 'PICKUP')
  // Lo que no se puede saber devuelve null, no «OTRO».
  assert.equal(categoriaDeCatalogo('AUTO', null, 'MODELO NUEVO 1.4'), null)
  // Una moto que no es scooter ni cuatriciclo es una moto: ahí sí se sabe.
  assert.equal(categoriaDeCatalogo('MOTO', null, 'WAVE 110 S'), 'MOTO')
  assert.equal(categoriaDeCatalogo('MOTO', null, 'BURGMAN SCOOTER 125'), 'SCOOTER')
})
