// Galeno: a quién le corresponde cada novedad antes de tocar la cartera.
//
// Esto es la mitad del sistema que corre en ESTA computadora. La otra mitad —consultar el portal,
// guardar el espejo y calcular el diff— vive en el servidor del VPS y tiene sus propias pruebas
// (`server/src/modules/galeno/galeno.diff.test.ts` allá).
//
// Lo que se prueba acá es la decisión que puede hacer daño: con qué cliente va cada póliza. Un
// emparejamiento de más crea una póliza a nombre de quien no es; uno de menos deja la bandeja llena de
// filas que se podrían haber resuelto solas. Y, sobre todo, que una ANULACIÓN nunca se aplique sola,
// que es la regla que impide que un error del lado de Galeno borre datos de la agencia.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { contarBandeja, resolverNovedad } from '../src/main/servicios/galeno'
import type { NovedadDeGaleno, PolizaDeGaleno, TipoDeNovedadDeGaleno } from '../src/shared/tipos'

function base(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  return db
}

/** Un cliente mínimo, con el documento normalizado como lo deja el alta de la agencia. */
function altaDeCliente(db: BaseDeDatos, nombre: string, documento: string, normalizado: string): number {
  const ahora = new Date().toISOString()
  const fila = db
    .prepare(
      `INSERT INTO clientes (clave, documento, documento_normalizado, nombre, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(`${normalizado}-${nombre}`, documento, normalizado, nombre, ahora, ahora) as { id: number }
  return fila.id
}

function altaDePoliza(db: BaseDeDatos, clienteId: number, compania: string, numero: string, normalizado: string): number {
  const ahora = new Date().toISOString()
  const fila = db
    .prepare(
      `INSERT INTO polizas (clave, cliente_id, compania, numero, numero_normalizado, periodo_origen, pestana_origen,
                            activa, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, '2026-03', 'MARZO 2026', 1, ?, ?) RETURNING id`,
    )
    .get(`${compania}-${normalizado}`, clienteId, compania, numero, normalizado, ahora, ahora) as { id: number }
  return fila.id
}

const POLIZA: PolizaDeGaleno = {
  legajo: '62695',
  rama: '1',
  numeroPoliza: '4500123',
  riesgo: '1',
  suplemento: '0',
  compania: 'GALENO',
  nombre: 'PEREZ JUAN CARLOS',
  documento: '20123456',
  tipoDocumento: 'DNI',
  direccion: 'AV. MITRE 1234',
  localidad: 'AVELLANEDA',
  codigoPostal: '1870',
  vigenciaDesde: '2026-03-01',
  vigenciaHasta: '2026-09-01',
  formaPago: 'DEBITO AUTOMATICO',
  cantidadDeRiesgos: '1',
  fechaAnulacion: '',
  renovadaPor: '',
  renuevaA: '',
  patente: 'AB123CD',
  marca: 'VOLKSWAGEN',
  modelo: 'GOL TREND',
  version: '',
  anio: '2019',
  motor: '',
  chasis: '',
  cobertura: 'TODO RIESGO',
  codigoCobertura: 'C1',
  sumaAsegurada: 12500000,
}

function novedad(tipo: TipoDeNovedadDeGaleno, datos: Partial<PolizaDeGaleno> = {}): NovedadDeGaleno {
  return {
    id: 1,
    tipo,
    datos: { ...POLIZA, ...datos },
    anterior: null,
    motivo: null,
    creadoEn: new Date().toISOString(),
  }
}

test('Galeno: un documento que empareja con UN cliente se aplica solo', () => {
  const db = base()
  altaDeCliente(db, 'PEREZ, JUAN C.', '20.123.456', '20123456')

  const fila = resolverNovedad(novedad('ALTA'))

  assert.equal(fila.resolucion, 'automatica')
  assert.equal(fila.candidatos.length, 1)
  cerrarBaseDeDatos()
})

test('Galeno: el CUIT del tomador empareja con el DNI del cliente', () => {
  // «20-12345678-3» y «12345678» son la misma persona: es el mismo criterio con el que la agencia
  // evita duplicados en el alta manual. Sin esto, cada tomador que Galeno manda con CUIT crearía un
  // cliente nuevo al lado del que ya está.
  const db = base()
  altaDeCliente(db, 'PEREZ JUAN', '12.345.678', '12345678')

  const fila = resolverNovedad(novedad('ALTA', { documento: '20123456783' }))

  assert.equal(fila.resolucion, 'automatica')
  cerrarBaseDeDatos()
})

test('Galeno: sin ningún cliente con ese documento, espera en la bandeja', () => {
  base()

  const fila = resolverNovedad(novedad('ALTA'))

  assert.equal(fila.resolucion, 'falta-cliente')
  assert.equal(fila.candidatos.length, 0)
  cerrarBaseDeDatos()
})

test('Galeno: con dos clientes con el mismo documento, NO elige: pregunta', () => {
  // Crear la póliza a nombre del que no era es mucho más caro de arreglar que una fila esperando.
  const db = base()
  altaDeCliente(db, 'PEREZ JUAN', '20.123.456', '20123456')
  altaDeCliente(db, 'PEREZ JUAN CARLOS', '20.123.456', '20123456')

  const fila = resolverNovedad(novedad('ALTA'))

  assert.equal(fila.resolucion, 'cliente-ambiguo')
  assert.equal(fila.candidatos.length, 2)
  cerrarBaseDeDatos()
})

test('Galeno: el emparejamiento NO mira el nombre', () => {
  // Un cliente que se llama igual pero tiene otro documento no es la misma persona.
  const db = base()
  altaDeCliente(db, 'PEREZ JUAN CARLOS', '30.999.888', '30999888')

  const fila = resolverNovedad(novedad('ALTA'))

  assert.equal(fila.resolucion, 'falta-cliente')
  cerrarBaseDeDatos()
})

test('Galeno: sin documento del tomador tampoco adivina', () => {
  const db = base()
  altaDeCliente(db, 'PEREZ JUAN CARLOS', '20.123.456', '20123456')

  const fila = resolverNovedad(novedad('ALTA', { documento: '' }))

  assert.equal(fila.resolucion, 'falta-cliente')
  assert.equal(fila.candidatos.length, 0)
  cerrarBaseDeDatos()
})

test('Galeno: una modificación sobre una póliza que ya está se aplica sola', () => {
  const db = base()
  const clienteId = altaDeCliente(db, 'PEREZ JUAN', '20.123.456', '20123456')
  const polizaId = altaDePoliza(db, clienteId, 'GALENO', '4500123', '4500123')

  const fila = resolverNovedad(novedad('MODIFICACION'))

  assert.equal(fila.resolucion, 'automatica')
  assert.equal(fila.polizaExistenteId, polizaId)
  cerrarBaseDeDatos()
})

test('Galeno: la póliza de OTRA compañía con el mismo número no se toca', () => {
  // Los números de póliza se repiten entre compañías: sin el filtro por compañía, una modificación de
  // Galeno pisaría la póliza de Rivadavia que casualmente tiene ese número.
  const db = base()
  const clienteId = altaDeCliente(db, 'PEREZ JUAN', '20.123.456', '20123456')
  altaDePoliza(db, clienteId, 'RIVADAVIA', '4500123', '4500123')

  const fila = resolverNovedad(novedad('MODIFICACION'))

  assert.equal(fila.polizaExistenteId, null)
  cerrarBaseDeDatos()
})

test('Galeno: una ANULACIÓN nunca se aplica sola, por más que el cliente empareje', () => {
  // LA regla del sistema. Un error del lado de Galeno -o del mapeo- no puede dar de baja una póliza
  // viva de la cartera: lo peor que puede pasar es un aviso de más en la bandeja.
  const db = base()
  const clienteId = altaDeCliente(db, 'PEREZ JUAN', '20.123.456', '20123456')
  altaDePoliza(db, clienteId, 'GALENO', '4500123', '4500123')

  const fila = resolverNovedad(novedad('ANULACION', { fechaAnulacion: '2026-06-05' }))

  assert.equal(fila.resolucion, 'anulada-en-galeno')
  assert.notEqual(fila.resolucion, 'automatica')
  cerrarBaseDeDatos()
})

test('Galeno: el drenado automático sólo toca lo que resolvió solo', () => {
  // `drenarGaleno` aplica exactamente las filas `automatica`. Esta cuenta es la que decide qué se
  // toca sin que nadie mire: si una anulación llegara a contarse como automática, el drenado la
  // aplicaría.
  const db = base()
  altaDeCliente(db, 'PEREZ JUAN', '20.123.456', '20123456')

  const cuenta = contarBandeja([
    resolverNovedad(novedad('ALTA')),
    resolverNovedad(novedad('ANULACION', { fechaAnulacion: '2026-06-05' })),
    resolverNovedad(novedad('ALTA', { documento: '99999999' })),
  ])

  assert.equal(cuenta.automatica, 1)
  assert.equal(cuenta['anulada-en-galeno'], 1)
  assert.equal(cuenta['falta-cliente'], 1)
  cerrarBaseDeDatos()
})
