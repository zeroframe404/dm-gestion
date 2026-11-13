// La licencia de la agencia del lado del programa: el ingreso con la licencia vencida (con y sin
// internet), el cierre de la sesión cuando vence trabajando, la traducción de lo que contesta el
// servidor al ingresar, y el id estable de la computadora que cuenta los puestos.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import {
  estadoDeLaLicencia,
  instalarLicencia,
  reiniciarLicenciaParaPruebas,
  revisarLicencia,
  usarEmisorDeLicencia,
  usarFuenteDeLicencia,
  verificarIngresoPorLicencia,
} from '../src/main/servicios/licencia'
import { establecerSesion } from '../src/main/servicios/sesion'
import { AlmacenVps } from '../src/main/usuarios/vps'
import { idDelEquipo } from '../src/main/vps/equipo'
import type { FuenteVps } from '../src/main/vps/fuenteVps'
import { avisoDeLicencia, fechaDeLicencia, normalizarEstadoDeLicencia, type EstadoDeLicencia } from '../src/shared/licencia'
import type { SesionUsuario } from '../src/shared/tipos'

const LUCIA: SesionUsuario = { id: 1, nombre: 'Lucía', usuario: 'lucia', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }

function estado(extra: Partial<EstadoDeLicencia> = {}): EstadoDeLicencia {
  return {
    estado: 'vigente',
    permiteIngresar: true,
    agencia: 'perez',
    titular: 'Seguros Pérez',
    plan: 'estandar',
    puestos: 3,
    usados: 1,
    vence: '2099-12-31',
    diasRestantes: 1000,
    graciaHasta: '2100-01-07T00:00:00.000Z',
    mensaje: 'Licencia vigente.',
    ...extra,
  }
}

interface Doble {
  estado: EstadoDeLicencia | null
  caido: boolean
  instaladas: string[]
}

function fuente(doble: Doble): FuenteVps {
  return {
    licenciaEstado: async () => {
      if (doble.caido) throw Object.assign(new Error('sin internet'), { code: 'ENOTFOUND' })
      return doble.estado
    },
    licenciaInstalar: async (licencia: string) => {
      doble.instaladas.push(licencia)
      doble.estado = estado()
      return doble.estado
    },
  } as unknown as FuenteVps
}

function preparar(doble: Doble): { cierres: string[]; avisos: unknown[] } {
  abrirBaseDeDatos(':memory:')
  reiniciarLicenciaParaPruebas()
  establecerSesion(null)
  const cierres: string[] = []
  const avisos: unknown[] = []
  usarFuenteDeLicencia(() => fuente(doble))
  usarEmisorDeLicencia(((_evento: string, datos: unknown) => void avisos.push(datos)) as never, (motivo) => {
    cierres.push(motivo)
    establecerSesion(null)
  })
  return { cierres, avisos }
}

function terminar(): void {
  usarFuenteDeLicencia(null)
  usarEmisorDeLicencia(null)
  establecerSesion(null)
  cerrarBaseDeDatos()
}

test('licencia: con la licencia vigente se ingresa; vencida, no', async () => {
  const doble: Doble = { estado: estado(), caido: false, instaladas: [] }
  const { avisos } = preparar(doble)
  try {
    await verificarIngresoPorLicencia(LUCIA)
    doble.estado = estado({ estado: 'vencida', permiteIngresar: false, mensaje: 'La licencia de DM Gestión de esta agencia venció.' })
    await assert.rejects(verificarIngresoPorLicencia(LUCIA), /venció/)
    assert.equal(avisos.length, 2, 'cada cambio de estado se avisa a la pantalla')
  } finally {
    terminar()
  }
})

test('licencia: un servidor anterior a las licencias (o sin control) no frena nada', async () => {
  const doble: Doble = { estado: null, caido: false, instaladas: [] }
  preparar(doble)
  try {
    await verificarIngresoPorLicencia(LUCIA)
    assert.equal((await estadoDeLaLicencia()).estado, 'exenta')
  } finally {
    terminar()
  }
})

test('licencia: sin internet vale lo último que se supo, aun reiniciando, y la gracia vencida se nota con el reloj de la PC', async () => {
  const doble: Doble = { estado: estado({ estado: 'en_gracia', graciaHasta: new Date(Date.now() + 60_000).toISOString() }), caido: false, instaladas: [] }
  preparar(doble)
  try {
    await verificarIngresoPorLicencia(LUCIA)
    doble.caido = true
    reiniciarLicenciaParaPruebas()
    await verificarIngresoPorLicencia(LUCIA)

    // La gracia terminó mientras la PC estaba sin conexión.
    doble.caido = false
    doble.estado = estado({ estado: 'en_gracia', graciaHasta: new Date(Date.now() - 60_000).toISOString() })
    await estadoDeLaLicencia()
    doble.caido = true
    reiniciarLicenciaParaPruebas()
    await assert.rejects(verificarIngresoPorLicencia(LUCIA), /venció/)
  } finally {
    terminar()
  }
})

test('licencia: si vence con la sesión abierta, la sesión se cierra con el motivo', async () => {
  const doble: Doble = { estado: estado(), caido: false, instaladas: [] }
  const { cierres } = preparar(doble)
  try {
    establecerSesion(LUCIA)
    await revisarLicencia()
    assert.deepEqual(cierres, [])
    doble.estado = estado({ estado: 'vencida', permiteIngresar: false, mensaje: 'La licencia venció.' })
    await revisarLicencia()
    assert.deepEqual(cierres, ['La licencia venció.'])
  } finally {
    terminar()
  }
})

test('licencia: instalar manda la licencia sin espacios y rechaza lo que no es una licencia', async () => {
  const doble: Doble = { estado: estado({ estado: 'vencida', permiteIngresar: false }), caido: false, instaladas: [] }
  preparar(doble)
  try {
    await assert.rejects(instalarLicencia('hola'), /dmgl1/)
    const nuevo = await instalarLicencia(' dmgl1.abc\n.def ')
    assert.deepEqual(doble.instaladas, ['dmgl1.abc.def'])
    assert.equal(nuevo.permiteIngresar, true)
  } finally {
    terminar()
  }
})

test('licencia: el ingreso contra el servidor traduce «licencia vencida» y «sin puestos», y manda el id de la computadora', async () => {
  const cuerpos: unknown[] = []
  const original = globalThis.fetch
  let respuesta: { status: number; json: unknown } = { status: 403, json: { error: 'La licencia venció.', codigo: 'licencia_vencida' } }
  globalThis.fetch = (async (_url: string, opciones: { body?: string }) => {
    cuerpos.push(JSON.parse(opciones.body ?? 'null'))
    return new Response(JSON.stringify(respuesta.json), { status: respuesta.status })
  }) as typeof fetch
  try {
    const almacen = new AlmacenVps({ urlBase: 'http://127.0.0.1:9', token: 'compartido' })
    assert.deepEqual(await almacen.ingresar('lucia', 'clave', { equipo: 'PC-1', app: '18.1.3' }), {
      tipo: 'rechazo',
      codigo: 'licencia',
      mensaje: 'La licencia venció.',
    })
    respuesta = { status: 403, json: { error: 'Ya están todas en uso.', codigo: 'sin_puestos' } }
    const sinLugar = await almacen.ingresar('lucia', 'clave', { equipo: 'PC-1', app: '18.1.3' })
    assert.equal(sinLugar.tipo === 'rechazo' && sinLugar.codigo, 'sin-puestos')
    const enviado = cuerpos[0] as { equipoId?: unknown }
    assert.equal(typeof enviado.equipoId, 'string')
    assert.equal(enviado.equipoId, (cuerpos[1] as { equipoId?: unknown }).equipoId, 'el id no cambia entre un ingreso y otro')
  } finally {
    globalThis.fetch = original
  }
})

test('licencia: el id de la computadora se crea una vez y se reusa', () => {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-equipo-'))
  try {
    const archivo = path.join(carpeta, 'sub', 'dm-gestion-equipo.json')
    const primero = idDelEquipo(archivo)
    assert.match(primero, /^[A-Za-z0-9-]{8,80}$/)
    assert.equal(idDelEquipo(archivo), primero)
    assert.equal((JSON.parse(readFileSync(archivo, 'utf8')) as { id: string }).id, primero)
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }
})

test('licencia: avisos y formas de lo que llega del servidor', () => {
  assert.equal(avisoDeLicencia(estado({ estado: 'por_vencer', mensaje: 'Vence en 5 días.' }), 'EMPLEADO'), null)
  assert.equal(avisoDeLicencia(estado({ estado: 'por_vencer', mensaje: 'Vence en 5 días.' }), 'ADMIN'), 'Vence en 5 días.')
  assert.equal(avisoDeLicencia(estado({ estado: 'en_gracia', mensaje: 'Venció.' }), 'EMPLEADO'), 'Venció.')
  assert.equal(avisoDeLicencia(estado(), 'SUPER_ADMIN'), null)
  assert.equal(normalizarEstadoDeLicencia({ estado: 'otra cosa' }), null)
  assert.equal(normalizarEstadoDeLicencia({ estado: 'vencida', permiteIngresar: 'si' })?.permiteIngresar, false)
  assert.equal(fechaDeLicencia('2027-01-31'), '31/01/2027')
})
