// Listado de Asegurados: las aseguradoras de cada cliente, de dónde salen (API o VPS) y su filtro.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import {
  confirmacionesDeAtm,
  confirmacionesDeEquidad,
  confirmacionesDeGaleno,
  estadoDeApisDeAsegurados,
} from '../src/main/servicios/aseguradorasPorApi'
import { listarAsegurados } from '../src/main/servicios/listadoAsegurados'
import { claveDeAseguradora, FILTROS_DE_ASEGURADOS_VACIOS } from '../src/shared/listados/asegurados'

const AHORA = new Date().toISOString()

function base(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const cliente = db.prepare(`INSERT INTO clientes (clave, nombre, documento, documento_normalizado, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)`)
  cliente.run('c1', 'PEREZ JUAN', '20-12345678-3', '12345678', AHORA, AHORA)
  cliente.run('c2', 'GOMEZ ANA', '23456789', '23456789', AHORA, AHORA)
  cliente.run('c3', 'LOPEZ LUIS', '34567890', '34567890', AHORA, AHORA)
  const poliza = db.prepare(
    `INSERT INTO polizas (clave, cliente_id, compania, numero, numero_normalizado, productor, activa, periodo_origen, pestana_origen, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, 'MARTINEZ', ?, '2026-11', 'NOV', ?, ?)`,
  )
  poliza.run('p1', 1, 'Galeno', '0011111', '0011111', 1, AHORA, AHORA)
  poliza.run('p2', 1, 'ATM', '453', '453', 1, AHORA, AHORA)
  poliza.run('p3', 2, 'LA EQUIDAD', '777', '777', 1, AHORA, AHORA)
  poliza.run('p4', 3, 'RIVADAVIA', '1', '1', 0, AHORA, AHORA)
  return db
}

function confirmar(db: BaseDeDatos, aseguradora: string, documento: string, poliza = '') {
  db.prepare(
    `INSERT INTO api_aseguradoras_confirmados (aseguradora, documento, poliza, nombre, clave_consulta, consultado_en) VALUES (?, ?, ?, NULL, '*', ?)`,
  ).run(aseguradora, documento, poliza, AHORA)
}

test('la clave de aseguradora junta las grafías de la misma compañía', () => {
  assert.equal(claveDeAseguradora('La Equidad'), 'EQUIDAD')
  assert.equal(claveDeAseguradora('EQUIDAD SEGUROS'), 'EQUIDAD')
  assert.equal(claveDeAseguradora('galeno '), 'GALENO')
  assert.equal(claveDeAseguradora('Mercantil Andina'), 'MERCANTIL')
  assert.equal(claveDeAseguradora('San Cristóbal'), 'SAN CRISTOBAL')
  assert.equal(claveDeAseguradora(null), '')
})

test('sin nada de las APIs, todas las aseguradoras salen del VPS', () => {
  base()
  const filas = listarAsegurados(FILTROS_DE_ASEGURADOS_VACIOS)
  const perez = filas.find((f) => f.nombreCompleto === 'PEREZ JUAN')!
  assert.deepEqual(perez.aseguradoras.map((a) => a.fuente), ['VPS', 'VPS'])
  assert.equal(perez.polizasVigentes, 2)
  const lopez = filas.find((f) => f.nombreCompleto === 'LOPEZ LUIS')!
  assert.deepEqual(lopez.aseguradoras, [{ nombre: 'RIVADAVIA', fuente: 'VPS' }], 'una baja muestra la compañía que tuvo')
  assert.equal(lopez.polizasVigentes, 0)
})

test('lo que confirma una API sale primero y marcado como API (por documento o por número de póliza)', () => {
  const db = base()
  confirmar(db, 'ATM', '12345678') // el DNI adentro del CUIL del cliente
  confirmar(db, 'GALENO', '99999999', '11111') // otro documento, pero la misma póliza (sin los ceros)
  confirmar(db, 'GALENO', '34567890') // la API conoce a LOPEZ en Galeno y la cartera no
  const filas = listarAsegurados(FILTROS_DE_ASEGURADOS_VACIOS)
  const perez = filas.find((f) => f.nombreCompleto === 'PEREZ JUAN')!
  assert.deepEqual(
    perez.aseguradoras.map((a) => `${a.nombre}:${a.fuente}`).sort(),
    ['ATM:API', 'Galeno:API'],
  )
  const lopez = filas.find((f) => f.nombreCompleto === 'LOPEZ LUIS')!
  assert.deepEqual(lopez.aseguradoras, [
    { nombre: 'Galeno', fuente: 'API' }, // con la grafía que usa la cartera
    { nombre: 'RIVADAVIA', fuente: 'VPS' },
  ])
})

test('el filtro por aseguradora y por origen', () => {
  const db = base()
  confirmar(db, 'ATM', '12345678')
  const nombres = (filtros: Partial<typeof FILTROS_DE_ASEGURADOS_VACIOS>) =>
    listarAsegurados({ ...FILTROS_DE_ASEGURADOS_VACIOS, ...filtros }).map((f) => f.nombreCompleto)
  assert.deepEqual(nombres({ aseguradoras: ['EQUIDAD'] }), ['GOMEZ ANA'], '«EQUIDAD» encuentra «LA EQUIDAD»')
  assert.deepEqual(nombres({ aseguradoras: ['ATM', 'RIVADAVIA'] }), ['LOPEZ LUIS', 'PEREZ JUAN'])
  assert.deepEqual(nombres({ fuentes: ['API'] }), ['PEREZ JUAN'])
  assert.deepEqual(nombres({ aseguradoras: ['Galeno'], fuentes: ['API'] }), [], 'Galeno de PEREZ sólo lo dice la cartera')
  assert.deepEqual(nombres({ aseguradoras: ['Galeno'], fuentes: ['VPS'] }), ['PEREZ JUAN'])
})

test('lectura de las respuestas de cada API', () => {
  assert.deepEqual(
    confirmacionesDeGaleno([
      { poliza: '0011111', numeroDocumentoTomador: '20123456783', tomador: 'PEREZ', fechaAnulacion: null },
      { poliza: '22', numeroDocumentoTomador: '1', fechaAnulacion: '01/01/2026' },
    ]),
    [{ documento: '12345678', poliza: '11111', nombre: 'PEREZ' }],
  )
  assert.deepEqual(
    confirmacionesDeAtm(
      { code: 200, response: [{ Poliza: '453', NumDoc: '12345678', VigFin: '20/06/2999', Asegurado: 'X' }, { Poliza: '1', NumDoc: '12345678', VigFin: '20/06/2020' }] },
      '12345678',
    ),
    [{ documento: '12345678', poliza: '453', nombre: 'X' }],
  )
  assert.deepEqual(confirmacionesDeAtm({ code: 200, response: [], error: true, msg: 'sin pólizas' }, '1'), [])
  assert.throws(() => confirmacionesDeAtm({ code: 401 }, '1'))
  assert.deepEqual(confirmacionesDeEquidad({ Vigente: false }, '23456789'), [])
  assert.deepEqual(confirmacionesDeEquidad({ Vigente: true, Asegurado: {}, Vehiculo: { Poliza: 777 } }, '23456789'), [
    { documento: '23456789', poliza: '777', nombre: null },
  ])
})

test('el estado de las APIs: Mercantil no consulta y ATM/Equidad cuentan lo que falta preguntar', () => {
  base()
  const estado = estadoDeApisDeAsegurados()
  const de = (a: string) => estado.apis.find((api) => api.aseguradora === a)!
  assert.equal(de('MERCANTIL').modo, 'SIN_CONSULTA')
  assert.equal(de('GALENO').consultadoEn, null)
  assert.equal(de('ATM').pendientes, 1)
  assert.equal(de('EQUIDAD').pendientes, 0, 'la póliza de Equidad no tiene vehículo: no hay patente que preguntar')
})
