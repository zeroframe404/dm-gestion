// La rama de una póliza de vehículo: auto, moto, pick up, camión, scooter, moto eléctrica o trailer.
//
// Son siete y sólo siete, igual que las sucursales son cuatro, y por el mismo motivo: la planilla
// escribe «PICK UP», «PICKUP», «Pick-Up» y «CAMIONETA» para el mismo vehículo, y sin plegarlos el
// desplegable termina con cuatro opciones que son una sola y elegir una esconde las filas de las
// otras tres.
//
// Lo que más se prueba acá es el segundo paso —afinar con la categoría del catálogo—, porque es el
// que decide si el filtro «Pick up» encuentra las camionetas cargadas desde «Nueva póliza» o sólo
// las tipeadas a mano en la hoja.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { catalogos, planillaDelMes } from '../src/main/servicios/cartera'
import { catalogosDePoliza } from '../src/main/servicios/polizas'
import {
  claveDeRama,
  mismaRama,
  NOMBRE_RAMA,
  ramaCanonica,
  ramaDeVehiculo,
  RAMAS,
  ramasEnTexto,
  ramasParaElegir,
} from '../src/shared/ramas'

/** Base nueva y en silencio: las migraciones y la semilla avisan por consola. */
function baseNueva(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    return abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
}

// ---------------------------------------------------------------------------
// La lista, sin base de datos de por medio
// ---------------------------------------------------------------------------

test('las ramas son siete y son las que pidió la agencia', () => {
  assert.deepEqual([...RAMAS], ['AUTO', 'MOTO', 'PICK UP', 'CAMION', 'SCOOTER', 'MOTO ELÉCTRICA', 'TRAILER'])
  for (const rama of RAMAS) assert.ok(NOMBRE_RAMA[rama], `«${rama}» tiene que tener nombre en pantalla`)
  assert.equal(ramasEnTexto(), 'AUTO, MOTO, PICK UP, CAMION, SCOOTER, MOTO ELÉCTRICA o TRAILER')
})

test('la clave borra tildes, mayúsculas y puntuación', () => {
  // Es la misma cuenta que `claveDeSucursal`, y por lo mismo: la hoja escribe cualquier cosa.
  assert.equal(claveDeRama('Pick-Up'), 'PICKUP')
  assert.equal(claveDeRama('pick up'), 'PICKUP')
  assert.equal(claveDeRama('MOTO ELÉCTRICA'), 'MOTOELECTRICA')
  assert.equal(claveDeRama('moto electrica'), 'MOTOELECTRICA')
  assert.equal(claveDeRama(null), '')
  assert.equal(claveDeRama(undefined), '')
  assert.equal(claveDeRama('   '), '')
})

test('las formas de escribir cada rama caen todas en la misma', () => {
  for (const escrito of ['PICK UP', 'PICKUP', 'Pick-Up', 'pickups', 'CAMIONETA', 'Camionetas', 'doble cabina']) {
    assert.equal(ramaCanonica(escrito), 'PICK UP', `«${escrito}» es PICK UP`)
  }
  for (const escrito of ['AUTO', 'automovil', 'AUTOS', 'Sedán', 'HATCHBACK', 'coupe', 'SUV', 'rural']) {
    assert.equal(ramaCanonica(escrito), 'AUTO', `«${escrito}» es AUTO`)
  }
  for (const escrito of ['MOTO', 'motos', 'MOTOCICLETA', 'motovehiculo']) {
    assert.equal(ramaCanonica(escrito), 'MOTO', `«${escrito}» es MOTO`)
  }
  for (const escrito of ['MOTO ELÉCTRICA', 'MOTO ELECTRICA', 'moto e', 'ELECTRICA']) {
    assert.equal(ramaCanonica(escrito), 'MOTO ELÉCTRICA', `«${escrito}» es MOTO ELÉCTRICA`)
  }
  for (const escrito of ['TRAILER', 'trailers', 'ACOPLADO', 'remolque', 'casa rodante']) {
    assert.equal(ramaCanonica(escrito), 'TRAILER', `«${escrito}» es TRAILER`)
  }
  assert.equal(ramaCanonica('CAMION'), 'CAMION')
  assert.equal(ramaCanonica('chasis'), 'CAMION')
  assert.equal(ramaCanonica('SCOOTER'), 'SCOOTER')
  assert.equal(ramaCanonica('ciclomotor'), 'SCOOTER')
})

test('lo que no es ninguna de las siete devuelve null y no se inventa una rama', () => {
  // Son riesgos que la agencia sí vende (hogar, bicicleta) o categorías del catálogo que no son una
  // rama aparte (furgón, micro, cuatriciclo). Ninguno se cuela dentro de AUTO ni de MOTO.
  for (const otro of ['HOGAR', 'BICICLETA', 'ACCIDENTE PERSONAL', 'INTEGRAL DE COMERCIO', 'FURGON', 'MICRO', 'CUATRICICLO', '', null]) {
    assert.equal(ramaCanonica(otro), null, `«${otro}» no es ninguna de las siete`)
  }
})

test('mismaRama pliega el catálogo y, afuera, compara por clave', () => {
  assert.equal(mismaRama('CAMIONETA', 'PICK UP'), true)
  assert.equal(mismaRama('MOTO ELECTRICA', 'MOTO ELÉCTRICA'), true)
  assert.equal(mismaRama('AUTO', 'MOTO'), false)
  // Fuera del catálogo un texto sigue empatando consigo mismo en vez de perderse.
  assert.equal(mismaRama('FURGON', 'furgon'), true)
  assert.equal(mismaRama('FURGON', 'AUTO'), false)
})

// ---------------------------------------------------------------------------
// El segundo paso: afinar con la categoría del catálogo
// ---------------------------------------------------------------------------

test('gana el tipo cuando ya nombra una rama concreta', () => {
  // Lo que escribió la agencia en la hoja manda: nadie conoce mejor su cartera.
  assert.equal(ramaDeVehiculo('PICK UP', null), 'PICK UP')
  assert.equal(ramaDeVehiculo('TRAILER', null), 'TRAILER')
  assert.equal(ramaDeVehiculo('MOTO ELECTRICA', null), 'MOTO ELÉCTRICA')
  // Y no lo pisa una categoría que diga otra cosa.
  assert.equal(ramaDeVehiculo('TRAILER', 'SEDAN'), 'TRAILER')
})

test('la categoría afina el tipo genérico: la pick up del catálogo entra en «Pick up»', () => {
  // ÉSTE es el caso que hace falta. Una pick up cargada desde «Nueva póliza» sale del catálogo con
  // `tipo = 'AUTO'` y `categoria = 'PICKUP'`. Sin este paso el filtro «Pick up» encontraría sólo las
  // que vinieron tipeadas de la hoja: cero filas para la mitad de la cartera y ninguna explicación.
  assert.equal(ramaDeVehiculo('AUTO', 'PICKUP'), 'PICK UP')
  assert.equal(ramaDeVehiculo('AUTO', 'CAMION'), 'CAMION')
  assert.equal(ramaDeVehiculo('MOTO', 'SCOOTER'), 'SCOOTER')
})

test('afinar nunca cruza familias', () => {
  // Un dato mezclado no puede convertir un auto en scooter ni una moto en camión: se queda con lo que
  // dice el tipo, que es lo menos equivocado que se puede devolver.
  assert.equal(ramaDeVehiculo('AUTO', 'SCOOTER'), 'AUTO')
  assert.equal(ramaDeVehiculo('MOTO', 'PICKUP'), 'MOTO')
  assert.equal(ramaDeVehiculo('MOTO', 'CAMION'), 'MOTO')
})

test('las categorías que no son una rama de la agencia dejan el tipo como está', () => {
  for (const categoria of ['SEDAN', 'HATCHBACK', 'SUV', 'FURGON', 'MICRO', 'CUATRICICLO', 'OTRO', null, '']) {
    assert.equal(ramaDeVehiculo('AUTO', categoria), 'AUTO', `categoría «${categoria}»`)
  }
  assert.equal(ramaDeVehiculo('MOTO', 'CUATRICICLO'), 'MOTO')
})

test('un riesgo que no es un vehículo no tiene rama', () => {
  assert.equal(ramaDeVehiculo('HOGAR', null), null)
  assert.equal(ramaDeVehiculo('BICICLETA', null), null)
  assert.equal(ramaDeVehiculo(null, null), null)
  // Sin tipo pero con una categoría que sí es una rama, se la queda: es el único dato que hay.
  assert.equal(ramaDeVehiculo(null, 'PICKUP'), 'PICK UP')
})

// ---------------------------------------------------------------------------
// El desplegable
// ---------------------------------------------------------------------------

test('el desplegable ofrece las siete siempre, y además lo que la base tenga aparte', () => {
  // Las siete están aunque el mes que se está mirando no tenga ninguna moto eléctrica: una rama sin
  // filas tiene que poder elegirse igual —ver que no hay ninguna es una respuesta—, y la lista tiene
  // que decir lo mismo en las cinco computadoras.
  assert.deepEqual(ramasParaElegir([]), [...RAMAS])
  assert.deepEqual(ramasParaElegir(['AUTO', 'CAMIONETA', 'pickup']), [...RAMAS], 'los sinónimos no agregan opciones')
  assert.deepEqual(ramasParaElegir(['HOGAR', 'AUTO', 'BICICLETA']), [...RAMAS, 'BICICLETA', 'HOGAR'])
  // Y no repite el mismo texto fuera de catálogo escrito de dos formas.
  assert.deepEqual(ramasParaElegir(['FURGON', 'furgón', 'Furgon']), [...RAMAS, 'FURGON'])
  assert.deepEqual(ramasParaElegir([null, undefined, '', '   ']), [...RAMAS])
})

test('el desplegable de rama de la Cartera y el de Pólizas ofrecen lo mismo', () => {
  // Es la misma lista en las dos pantallas: si cada una armara la suya, un filtro ofrecería siete
  // opciones y el otro nueve, y la diferencia se vería como filas que desaparecen sin explicación.
  baseNueva()
  const deLaCartera = catalogos().ramas
  const deLasPolizas = catalogosDePoliza().ramas
  assert.deepEqual(deLaCartera, deLasPolizas)
  assert.deepEqual(deLaCartera.slice(0, RAMAS.length), [...RAMAS], 'las siete arriba de todo, en orden')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// De punta a punta: la rama que ve la pantalla
// ---------------------------------------------------------------------------

/**
 * Cinco vehículos que cubren los casos que importan: el que la hoja escribió con el nombre de la
 * rama, el que la escribió con un sinónimo, el que salió del catálogo con el tipo genérico y la
 * categoría fina, y dos que no son de ninguna rama.
 */
function baseConVariosVehiculos(): BaseDeDatos {
  const db = baseNueva()
  const ahora = '2026-08-01T10:00:00'
  const vehiculos: Array<[string, string, string | null]> = [
    // [clave, tipo, categoria]
    ['v-ranger', 'AUTO', 'PICKUP'], // cargada desde «Nueva póliza»: la rama sólo se ve en la categoría
    ['v-hilux', 'CAMIONETA', null], // tipeada en la hoja con un sinónimo
    ['v-corsa', 'AUTO', 'SEDAN'], // un auto de toda la vida
    ['v-vespa', 'MOTO', 'SCOOTER'], // una moto que el catálogo afina a scooter
    ['v-casa', 'HOGAR', null], // no es un vehículo: no tiene rama
  ]
  const insertarVehiculo = db.prepare(
    `INSERT INTO vehiculos (clave, tipo, categoria, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?)`,
  )
  db.prepare(
    `INSERT INTO clientes (id, clave, nombre, documento, creado_en, actualizado_en) VALUES (1, 'doc:1', 'PEREZ ANA', '1', ?, ?)`,
  ).run(ahora, ahora)
  const insertarPoliza = db.prepare(
    `INSERT INTO polizas (clave, cliente_id, vehiculo_id, compania, numero, periodo_origen, pestana_origen, creado_en, actualizado_en)
     VALUES (?, 1, ?, 'ATM', ?, '2026-08', 'AGOSTO', ?, ?)`,
  )
  const insertarCuota = db.prepare(
    `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, creado_en, actualizado_en)
     VALUES (?, '2026-08', 'AGOSTO', ?, 1, 'PEREZ ANA', ?, ?)`,
  )
  for (const [clave, tipo, categoria] of vehiculos) {
    const vehiculoId = Number(insertarVehiculo.run(clave, tipo, categoria, ahora, ahora).lastInsertRowid)
    const polizaId = Number(insertarPoliza.run(`p-${clave}`, vehiculoId, clave, ahora, ahora).lastInsertRowid)
    insertarCuota.run(`f-${clave}`, polizaId, ahora, ahora)
  }
  return db
}

test('la planilla del mes le pone su rama a cada fila', () => {
  baseConVariosVehiculos()
  const porFila = new Map(
    planillaDelMes('2026-08').filas.map((fila) => [fila.numeroPoliza, ramaDeVehiculo(fila.vehiculo, fila.categoriaVehiculo)]),
  )

  // La Ranger es el caso que justifica todo esto: en la celda VEHICULO dice «AUTO», y sin mirar la
  // categoría del catálogo el filtro «Pick up» no la encontraría nunca.
  assert.equal(porFila.get('v-ranger'), 'PICK UP')
  assert.equal(porFila.get('v-hilux'), 'PICK UP', 'y la que la hoja escribió «CAMIONETA», también')
  assert.equal(porFila.get('v-corsa'), 'AUTO')
  assert.equal(porFila.get('v-vespa'), 'SCOOTER')
  assert.equal(porFila.get('v-casa'), null, 'un hogar no tiene rama')
  cerrarBaseDeDatos()
})

test('el desplegable de rama no ofrece «CAMIONETA» aparte de «PICK UP»', () => {
  // Es el mismo vehículo escrito de dos formas. Ofrecerlo dos veces es lo que pasaba con «AVELLANEDA»
  // y «Dock Sud» antes de que las sucursales fueran una lista cerrada: elegir una escondía las otras.
  baseConVariosVehiculos()
  const ramas = catalogos().ramas
  assert.deepEqual(ramas, [...RAMAS, 'HOGAR'], 'las siete, más el hogar que no es ninguna de ellas')
  cerrarBaseDeDatos()
})
