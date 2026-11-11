// Autorizaciones puntuales (la campana de la barra superior).
//
// Un usuario cuyo rol tiene tildado «Puede solicitar autorizaciones puntuales» elige un módulo y si
// quiere sólo leer o leer y escribir. Quien puede decidir —el superadministrador o un rol con «puede
// resolver»— lo concede (lectura, o lectura y escritura, por un rato), o lo deniega, y en los tres
// casos puede dejar un mensaje que le llega al que pidió, en su campana.
//
// La concesión vigente se suma al nivel que da el rol en `servicios/permisos.ts` (nivelEfectivo): nunca
// resta. Y quien resuelve no puede dar más nivel del que él mismo tiene en ese módulo, para que un rol
// con «puede resolver» no sirva para escalar permisos que no tiene.
import { randomUUID } from 'node:crypto'
import {
  esDuracion,
  LARGO_MAXIMO_MENSAJE,
  vencimientoDe,
  type EstadoDeAutorizaciones,
  type SolicitudDeAutorizacion,
} from '../../shared/autorizaciones'
import { alcanza, DESCRIPCION_AREA, esArea, esNivel, NOMBRE_NIVEL, opcionesDe, type Area, type Nivel } from '../../shared/permisos'
import type { SesionUsuario } from '../../shared/tipos'
import { ahoraIso } from '../importacion/normalizar'
import { mutar, refrescar, solicitudesVigentes } from './almacenDeAutorizaciones'
import { ErrorDeNegocio } from './errores'
import { avisarSiCambiaronLasConcesiones, matrizVigente, nivelDelActor } from './permisos'

function texto(valor: unknown, maximo: number): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, maximo) : ''
}

function usuarioDe(actor: SesionUsuario): string {
  return actor.usuario.trim().toLowerCase()
}

function ordenarPorFecha(lista: SolicitudDeAutorizacion[], campo: 'creadaEn' | 'resueltaEn'): SolicitudDeAutorizacion[] {
  return [...lista].sort((a, b) => Date.parse(b[campo] ?? b.creadaEn) - Date.parse(a[campo] ?? a.creadaEn))
}

function armarEstado(actor: SesionUsuario): EstadoDeAutorizaciones {
  const opciones = opcionesDe(matrizVigente(), actor.rol, actor.usuario)
  const todas = solicitudesVigentes()
  const yo = usuarioDe(actor)
  const mias = ordenarPorFecha(todas.filter((s) => s.usuario === yo), 'creadaEn').slice(0, 20)
  const ajenas = todas.filter((s) => s.usuario !== yo)
  return {
    puedeSolicitar: opciones.puedeSolicitar,
    puedeResolver: opciones.puedeResolver,
    mias,
    pendientes: opciones.puedeResolver ? ordenarPorFecha(ajenas.filter((s) => s.estado === 'pendiente'), 'creadaEn').reverse() : [],
    resueltasRecientes: opciones.puedeResolver ? ordenarPorFecha(ajenas.filter((s) => s.estado !== 'pendiente'), 'resueltaEn').slice(0, 8) : [],
  }
}

/** Lo que ve la campana. `actualizar` vuelve a leer GitHub (a lo sumo cada 30 segundos). */
export async function estadoDeAutorizaciones(actor: SesionUsuario, actualizar: boolean): Promise<EstadoDeAutorizaciones> {
  if (actualizar) await refrescar()
  // Si llegó una concesión nueva (o venció una), las ventanas tienen que mostrar u ocultar el módulo.
  avisarSiCambiaronLasConcesiones(actor)
  return armarEstado(actor)
}

/** Un pedido nuevo. Lo hace uno mismo: se exige que su rol tenga tildado «puede solicitar». */
export async function pedirAutorizacion(actor: SesionUsuario, datos: unknown): Promise<EstadoDeAutorizaciones> {
  const d = typeof datos === 'object' && datos !== null ? (datos as Record<string, unknown>) : {}
  if (!opcionesDe(matrizVigente(), actor.rol, actor.usuario).puedeSolicitar) {
    throw new ErrorDeNegocio('Tu rol no puede pedir autorizaciones puntuales. Pedíselo a un administrador.')
  }
  const area: Area | null = esArea(d.area) ? d.area : null
  if (!area) throw new ErrorDeNegocio('Elegí a qué módulo querés acceder.')
  if (d.nivel !== 'ver' && d.nivel !== 'editar') throw new ErrorDeNegocio('Elegí si necesitás sólo leer o leer y escribir.')
  const nivel = d.nivel
  const motivo = texto(d.motivo, LARGO_MAXIMO_MENSAJE)
  const donde = DESCRIPCION_AREA[area].nombre
  if (alcanza(nivelDelActor(actor, area), nivel)) {
    throw new ErrorDeNegocio(`En ${donde} ya tenés «${NOMBRE_NIVEL[nivelDelActor(actor, area)].toLowerCase()}»: no hace falta pedirlo.`)
  }
  const yo = usuarioDe(actor)
  const solicitud: SolicitudDeAutorizacion = {
    id: randomUUID(),
    usuario: yo,
    nombre: actor.nombre,
    area,
    nivelPedido: nivel,
    motivo,
    creadaEn: ahoraIso(),
    estado: 'pendiente',
    nivelOtorgado: null,
    resueltaPor: null,
    resueltaEn: null,
    mensaje: '',
    venceEn: null,
    vista: false,
  }
  await mutar(actor, `pedido de autorización de ${yo}`, (actuales) => {
    // Se controla sobre la lista recién leída: dos pedidos del mismo módulo, uno solo.
    if (actuales.some((s) => s.usuario === yo && s.area === area && s.estado === 'pendiente')) {
      throw new ErrorDeNegocio(`Ya tenés un pedido pendiente para ${donde}. Esperá la respuesta.`)
    }
    return [...actuales, solicitud]
  })
  return armarEstado(actor)
}

/** Quien puede decidir contesta un pedido: lectura y escritura, sólo lectura, o denegar. Con mensaje. */
export async function resolverAutorizacion(actor: SesionUsuario, datos: unknown): Promise<EstadoDeAutorizaciones> {
  const d = typeof datos === 'object' && datos !== null ? (datos as Record<string, unknown>) : {}
  if (!opcionesDe(matrizVigente(), actor.rol, actor.usuario).puedeResolver) {
    throw new ErrorDeNegocio('Tu rol no puede resolver autorizaciones puntuales.')
  }
  const id = texto(d.id, 60)
  if (!id) throw new ErrorDeNegocio('Falta cuál es el pedido.')
  const decision: Nivel = esNivel(d.decision) ? d.decision : 'ninguno'
  if (!esNivel(d.decision)) throw new ErrorDeNegocio('Elegí qué hacer con el pedido.')
  const mensaje = texto(d.mensaje, LARGO_MAXIMO_MENSAJE)
  const duracion = esDuracion(d.duracion) ? d.duracion : 'hoy'
  const ahora = new Date()
  const yo = usuarioDe(actor)

  await mutar(actor, `resolución de un pedido de autorización`, (actuales) => {
    const pedido = actuales.find((s) => s.id === id)
    if (!pedido) throw new ErrorDeNegocio('Ese pedido ya no existe.')
    if (pedido.estado !== 'pendiente') throw new ErrorDeNegocio('Ese pedido ya lo resolvió otra persona.')
    if (pedido.usuario === yo) throw new ErrorDeNegocio('No podés resolver tu propio pedido.')
    // Nadie da más de lo que tiene: si no, «puede resolver» sería una puerta para escalar permisos.
    if (decision !== 'ninguno' && !alcanza(nivelDelActor(actor, pedido.area), decision)) {
      throw new ErrorDeNegocio(
        `No podés dar «${NOMBRE_NIVEL[decision].toLowerCase()}» en ${DESCRIPCION_AREA[pedido.area].nombre}: vos mismo no lo tenés.`,
      )
    }
    return actuales.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            estado: decision === 'ninguno' ? 'denegada' : 'concedida',
            nivelOtorgado: decision,
            resueltaPor: actor.nombre,
            resueltaEn: ahoraIso(),
            mensaje,
            venceEn: decision === 'ninguno' ? null : vencimientoDe(duracion, ahora),
            vista: false,
          },
    )
  })
  return armarEstado(actor)
}

/** El que pidió ya vio las respuestas: se apaga el puntito. */
export async function marcarRespuestasVistas(actor: SesionUsuario): Promise<EstadoDeAutorizaciones> {
  const yo = usuarioDe(actor)
  const hayPorMarcar = solicitudesVigentes().some((s) => s.usuario === yo && s.estado !== 'pendiente' && !s.vista)
  if (hayPorMarcar) {
    await mutar(actor, `respuestas vistas de ${yo}`, (actuales) =>
      actuales.map((s) => (s.usuario === yo && s.estado !== 'pendiente' && !s.vista ? { ...s, vista: true } : s)),
    )
  }
  return armarEstado(actor)
}
