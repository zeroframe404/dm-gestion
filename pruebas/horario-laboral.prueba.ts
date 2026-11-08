// El horario laboral con la sesión de verdad: no deja ingresar fuera de turno, deja pedir una excepción, avisa
// antes del cierre, cierra solo y le avisa al superadministrador. El servidor es un doble que dice la hora que
// se le pide; el reloj de la PC no cuenta (la hora de la agencia es la del servidor).
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import {
  estadoDelPedidoAlIngresar,
  guardarUsoLaboral,
  pedirExcepcionAlIngresar,
  pedirExcepcionEnSesion,
  reiniciarHorarioParaPruebas,
  resolverPedido,
  usarEmisorDeHorario,
  usarFuenteDeHorario,
  verificarIngreso,
  vuelta,
} from '../src/main/servicios/horarioLaboral'
import { FueraDeHorario } from '../src/main/servicios/errores'
import { establecerSesion, sesion } from '../src/main/servicios/sesion'
import type { ConfiguracionDeHorario, SolicitudDeHorario } from '../src/shared/horario'
import type { SesionUsuario } from '../src/shared/tipos'
import type { FuenteVps } from '../src/main/vps/fuenteVps'

const config: ConfiguracionDeHorario = {
  habilitado: true,
  ADMIN: { activo: true, desde: '09:00', hasta: '21:00' },
  EMPLEADO: { activo: true, desde: '10:00', hasta: '20:00' },
}
const aLas = (hora: string): string => new Date(Date.parse(`2026-11-08T${hora}:00-03:00`)).toISOString()

const persona = (usuario: string, rol: SesionUsuario['rol']): SesionUsuario => ({
  id: 1,
  nombre: usuario,
  usuario,
  rol,
  sucursal: { id: 1, nombre: 'Dock Sud' },
  debeCambiarClave: false,
})
const LUCIA = persona('lucia', 'EMPLEADO')
const MARCOS = persona('marcos', 'ADMIN')
const DANIEL = persona('daniel', 'SUPER_ADMIN')

function solicitud(extra: Partial<SolicitudDeHorario> = {}): SolicitudDeHorario {
  return {
    id: 'p1', numero: 1, usuario: 'lucia', nombre: 'lucia', rol: 'EMPLEADO', sucursal: 'Dock Sud', momento: 'INGRESO', motivo: '',
    estado: 'PENDIENTE', ip: '190.1.2.3', localidad: 'Avellaneda', horaLocal: '2026-11-08 21:00', minutosConcedidos: null,
    vigenteHasta: null, resueltaPor: null, resueltaEn: null, creadoEn: aLas('21:00'), ...extra,
  }
}

interface Doble {
  ahora: string
  excepcionHasta: string | null
  caido: boolean
  lecturas: number
  pedidos: Array<{ momento: string; sucursal: string }>
  pendientes: SolicitudDeHorario[]
  consulta: SolicitudDeHorario
  resueltos: Array<{ id: string; aprobada: boolean; minutos: number | null }>
  guardados: ConfiguracionDeHorario[]
}

function prepararElServidor(estado: Partial<Doble> = {}): Doble {
  const doble: Doble = {
    ahora: aLas('21:00'), excepcionHasta: null, caido: false, lecturas: 0, pedidos: [], pendientes: [],
    consulta: solicitud(), resueltos: [], guardados: [], ...estado,
  }
  const fuente = {
    horarioEstado: async () => {
      doble.lecturas++
      if (doble.caido) throw new Error('sin internet')
      return { config, version: 1, ahora: doble.ahora, excepcionHasta: doble.excepcionHasta }
    },
    horarioGuardar: async (_actor: unknown, nueva: ConfiguracionDeHorario) => {
      doble.guardados.push(nueva)
      return { config: nueva, version: 2, ahora: doble.ahora, excepcionHasta: null }
    },
    horarioPedirExcepcion: async (_actor: unknown, pedido: { momento: string; sucursal: string }) => {
      doble.pedidos.push(pedido)
      return solicitud({ momento: pedido.momento as SolicitudDeHorario['momento'] })
    },
    horarioSolicitud: async () => doble.consulta,
    horarioSolicitudes: async () => doble.pendientes,
    horarioResolver: async (_actor: unknown, id: string, aprobada: boolean, minutos: number | null) => {
      doble.resueltos.push({ id, aprobada, minutos })
      return solicitud({ estado: aprobada ? 'APROBADA' : 'RECHAZADA' })
    },
  }
  usarFuenteDeHorario(() => fuente as unknown as FuenteVps)
  return doble
}

function preparar(): { avisos: Array<{ evento: string; datos: unknown }> } {
  abrirBaseDeDatos(':memory:')
  reiniciarHorarioParaPruebas()
  establecerSesion(null)
  const avisos: Array<{ evento: string; datos: unknown }> = []
  usarEmisorDeHorario(((evento: string, datos: unknown) => void avisos.push({ evento, datos })) as never)
  return { avisos }
}

function terminar(): void {
  reiniciarHorarioParaPruebas()
  usarEmisorDeHorario(null)
  usarFuenteDeHorario(null)
  establecerSesion(null)
  cerrarBaseDeDatos()
}

test('fuera de horario no se puede ingresar; el superadministrador sí y ni se lo consulta', async () => {
  preparar()
  const servidor = prepararElServidor({ ahora: aLas('21:00') })
  await assert.rejects(verificarIngreso(LUCIA), (error: unknown) => error instanceof FueraDeHorario && /de 10:00 a 20:00/.test(error.message))
  // Los administradores tienen su propio horario: hasta las 21:00, y a las 21:00 ya es fuera.
  await assert.rejects(verificarIngreso(MARCOS), FueraDeHorario)
  const lecturas = servidor.lecturas
  await verificarIngreso(DANIEL)
  assert.equal(servidor.lecturas, lecturas, 'al superadministrador no se le consulta nada')
  servidor.ahora = aLas('20:30')
  await verificarIngreso(MARCOS)
  await assert.rejects(verificarIngreso(LUCIA), FueraDeHorario)
  terminar()
})

test('con una excepción aprobada vigente se puede ingresar', async () => {
  preparar()
  prepararElServidor({ ahora: aLas('21:00'), excepcionHasta: aLas('22:00') })
  await verificarIngreso(LUCIA)
  terminar()
})

test('pedir la excepción al ingresar sólo vale para quien acaba de ser rechazado y consulta su pedido', async () => {
  preparar()
  const servidor = prepararElServidor()
  await assert.rejects(pedirExcepcionAlIngresar('necesito cerrar una póliza'), /Primero ingresá/)
  await assert.rejects(verificarIngreso(LUCIA), FueraDeHorario)
  assert.equal(await estadoDelPedidoAlIngresar(), null)
  const pedido = await pedirExcepcionAlIngresar('necesito cerrar una póliza')
  assert.equal(pedido.estado, 'PENDIENTE')
  assert.deepEqual(servidor.pedidos, [{ momento: 'INGRESO', sucursal: 'Dock Sud', motivo: 'necesito cerrar una póliza' }])
  servidor.consulta = solicitud({ estado: 'APROBADA', minutosConcedidos: 60 })
  assert.equal((await estadoDelPedidoAlIngresar())?.estado, 'APROBADA')
  terminar()
})

test('sin internet se sigue con lo último que se supo, incluso reiniciando el programa; la primera vez, sin nada, se deja pasar', async () => {
  preparar()
  const servidor = prepararElServidor({ caido: true })
  await verificarIngreso(LUCIA) // nunca supo nada: no se deja a la agencia afuera por una caída
  servidor.caido = false
  await assert.rejects(verificarIngreso(LUCIA), FueraDeHorario)
  servidor.caido = true
  reiniciarHorarioParaPruebas() // el programa se cerró y se volvió a abrir: lo recordado vive en la base
  await assert.rejects(verificarIngreso(LUCIA), FueraDeHorario)
  terminar()
})

test('con la sesión abierta avisa a los 30 y a los 5 minutos, una sola vez cada uno, y cierra al llegar la hora', async () => {
  const { avisos } = preparar()
  const servidor = prepararElServidor({ ahora: aLas('19:35') })
  establecerSesion(LUCIA)
  await vuelta()
  assert.equal(avisos.filter((a) => a.evento === 'horario:aviso').length, 1)
  assert.deepEqual(avisos[0].datos, { minutosRestantes: 25, cierraA: '20:00' })
  // Pasa un rato entre vueltas, como en el programa de verdad: el cierre no puede correrse unos milisegundos.
  await new Promise((resolver) => setTimeout(resolver, 25))
  await vuelta()
  assert.equal(avisos.length, 1, 'no repite el mismo aviso')
  assert.ok(sesion(), 'todavía no se cerró')

  reiniciarHorarioParaPruebas()
  servidor.ahora = aLas('19:57')
  avisos.length = 0
  establecerSesion(LUCIA)
  await vuelta()
  assert.equal(avisos.length, 1)
  assert.equal((avisos[0].datos as { minutosRestantes: number }).minutosRestantes, 3)

  reiniciarHorarioParaPruebas()
  servidor.ahora = aLas('20:01')
  establecerSesion(LUCIA)
  await vuelta()
  assert.equal(sesion(), null, 'se acabó el turno: la sesión se cierra sola')
  terminar()
})

test('pedir una excepción trabajando: al aprobarse sigue adentro y avisa hasta cuándo', async () => {
  const { avisos } = preparar()
  const servidor = prepararElServidor({ ahora: aLas('19:50') })
  establecerSesion(LUCIA)
  await vuelta()
  await pedirExcepcionEnSesion(LUCIA, 'un cliente en el mostrador')
  assert.deepEqual(servidor.pedidos, [{ momento: 'EN_SESION', sucursal: 'Dock Sud', motivo: 'un cliente en el mostrador' }])
  // El superadministrador aprueba una hora: el servidor ya informa la excepción vigente.
  servidor.consulta = solicitud({ estado: 'APROBADA', minutosConcedidos: 60, vigenteHasta: aLas('20:50') })
  servidor.excepcionHasta = aLas('20:50')
  avisos.length = 0
  await vuelta()
  const respuesta = avisos.find((a) => a.evento === 'horario:respuesta')
  assert.deepEqual(respuesta?.datos, { solicitudId: 'p1', estado: 'APROBADA', minutosConcedidos: 60, cierraA: '20:50' })
  assert.ok(sesion())
  terminar()
})

test('el superadministrador se entera de cada pedido nuevo una sola vez y puede resolverlos', async () => {
  const { avisos } = preparar()
  const servidor = prepararElServidor({ pendientes: [solicitud()] })
  establecerSesion(DANIEL)
  await vuelta()
  await vuelta()
  assert.equal(avisos.filter((a) => a.evento === 'horario:pedidos').length, 1)
  servidor.pendientes = [solicitud(), solicitud({ id: 'p2', numero: 2 })]
  await vuelta()
  assert.equal(avisos.filter((a) => a.evento === 'horario:pedidos').length, 2)

  await resolverPedido(DANIEL, 'p1', true, 60)
  await resolverPedido(DANIEL, 'p2', false, null)
  assert.deepEqual(servidor.resueltos, [{ id: 'p1', aprobada: true, minutos: 60 }, { id: 'p2', aprobada: false, minutos: null }])
  await assert.rejects(resolverPedido(DANIEL, 'p1', true, 7), /minutos/)
  await assert.rejects(resolverPedido(LUCIA, 'p1', true, 60), /superadministrador/)
  terminar()
})

test('sólo el superadministrador guarda el horario y se rechaza una configuración incoherente', async () => {
  preparar()
  const servidor = prepararElServidor()
  await assert.rejects(guardarUsoLaboral(LUCIA, config), /superadministrador/)
  await assert.rejects(
    guardarUsoLaboral(DANIEL, { ...config, EMPLEADO: { activo: true, desde: '20:00', hasta: '10:00' } }),
    /posterior/,
  )
  const guardado = await guardarUsoLaboral(DANIEL, config)
  assert.equal(guardado.version, 2)
  assert.deepEqual(servidor.guardados, [config])
  terminar()
})
