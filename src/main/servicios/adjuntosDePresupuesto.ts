// Los PDF (u otro documento) que cada compañía manda con su cotización, para no perderlos entre el
// mensaje de WhatsApp y la planilla.
//
// Mismo modelo que los adjuntos de pólizas, siniestros y tareas (ver adjuntos.ts): el archivo queda en
// esta computadora, sube al VPS en segundo plano y su ficha viaja por APP ADJUNTOS colgando de la
// clave del presupuesto, así se ve desde cualquier computadora de la agencia.
import path from 'node:path'
import type { AdjuntoDePresupuesto, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import {
  adjuntosDe as adjuntosGenericosDe,
  asegurarAdjuntoLocal,
  borrarAdjuntoRegistrado,
  copiarADrive,
  registrarAdjunto,
  type AdjuntoGenerico,
} from './adjuntos'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { dadorDeTokenDeGoogle } from './sincronizacion'
import { archivosParaAdjuntar } from './tareas'
import { enteroPositivo, texto } from './validacion'

function aAdjuntoDePresupuesto(a: AdjuntoGenerico): AdjuntoDePresupuesto {
  return {
    id: a.id,
    nombre: a.nombre,
    tipo: a.tipo,
    tamano: a.tamano,
    creadoEn: a.creadoEn,
    usuarioNombre: a.usuarioNombre,
    enDrive: a.enDrive,
    errorDeDrive: a.errorDeDrive,
    enElServidor: a.enElServidor,
    errorDelServidor: a.errorDelServidor,
    descargado: a.descargado,
    enOtraComputadora: a.enOtraComputadora,
    miniatura: a.miniatura,
    ancho: a.ancho,
    alto: a.alto,
  }
}

function exigirPresupuesto(presupuestoId: number): { id: number; fila_id: string | null } {
  const fila = db().prepare('SELECT id, fila_id FROM presupuestos WHERE id = ?').get(presupuestoId) as
    | { id: number; fila_id: string | null }
    | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese presupuesto.')
  return fila
}

export function adjuntosDePresupuesto(presupuestoId: number): AdjuntoDePresupuesto[] {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  exigirPresupuesto(id)
  return adjuntosGenericosDe('presupuesto', id).map(aAdjuntoDePresupuesto)
}

/** Los archivos que vienen de la pantalla: bytes, ya achicados si eran fotos. */
export async function agregarArchivosDePresupuesto(
  presupuestoId: number,
  archivos: unknown,
  actor: SesionUsuario,
): Promise<AdjuntoDePresupuesto[]> {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const presupuesto = exigirPresupuesto(id)
  const lista = archivosParaAdjuntar(archivos)
  const dameToken = dadorDeTokenDeGoogle()
  for (const archivo of lista) {
    const adjunto = registrarAdjunto('presupuesto', id, archivo, actor)
    await copiarADrive('presupuesto', adjunto.id, dameToken)
    anotar(id, presupuesto.fila_id, 'ADJUNTO', null, adjunto.nombre, actor)
  }
  return adjuntosDePresupuesto(id)
}

/** Rutas del disco (el explorador de archivos o la prueba de humo). */
export async function agregarAdjuntosDePresupuesto(presupuestoId: number, rutas: unknown, actor: SesionUsuario): Promise<AdjuntoDePresupuesto[]> {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const presupuesto = exigirPresupuesto(id)
  if (!Array.isArray(rutas) || rutas.length === 0) throw new ErrorDeNegocio('No elegiste ningún archivo.')
  const dameToken = dadorDeTokenDeGoogle()
  for (const ruta of rutas) {
    const origen = texto(ruta, 'La ruta del archivo', 1, 4096)
    const adjunto = registrarAdjunto('presupuesto', id, { nombre: path.basename(origen), ruta: origen }, actor)
    await copiarADrive('presupuesto', adjunto.id, dameToken)
    anotar(id, presupuesto.fila_id, 'ADJUNTO', null, adjunto.nombre, actor)
  }
  return adjuntosDePresupuesto(id)
}

/** La ruta del archivo en esta computadora; si lo cargó otra, se baja del servidor antes. */
export async function rutaDelAdjuntoDePresupuesto(adjuntoId: number): Promise<string> {
  return asegurarAdjuntoLocal('presupuesto', enteroPositivo(adjuntoId, 'El documento'))
}

export function borrarAdjuntoDePresupuesto(adjuntoId: number, actor: SesionUsuario): AdjuntoDePresupuesto[] {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const { padreId, nombre } = borrarAdjuntoRegistrado('presupuesto', id, actor)
  anotar(padreId, exigirPresupuesto(padreId).fila_id, 'ADJUNTO BORRADO', nombre, null, actor)
  return adjuntosDePresupuesto(padreId)
}

function anotar(
  presupuestoId: number,
  filaId: string | null,
  campo: string,
  anterior: string | null,
  nuevo: string | null,
  actor: SesionUsuario,
): void {
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'presupuesto_adjuntos',
    registroId: presupuestoId,
    filaId,
    campo,
    valorAnterior: anterior,
    valorNuevo: nuevo,
  })
}
