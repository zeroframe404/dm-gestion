// Fotos y documentos de una póliza (12.6): el auto, la moto, el frente de la póliza, la cédula verde.
//
// Mismo modelo que los adjuntos de siniestros y tareas (ver adjuntos.ts): el archivo queda en esta
// computadora, sube al VPS en segundo plano y su ficha viaja por APP ADJUNTOS colgando de la clave de
// la póliza, que es la identidad que todas las computadoras comparten. Sin categorías: en una póliza
// el nombre del archivo alcanza, y las fotos son fotos.
import path from 'node:path'
import type { AdjuntoDePoliza, SesionUsuario } from '../../shared/tipos'
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

function aAdjuntoDePoliza(a: AdjuntoGenerico): AdjuntoDePoliza {
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

function exigirPoliza(polizaId: number): { id: number; fila_id: string | null } {
  const fila = db().prepare('SELECT id, fila_id FROM polizas WHERE id = ?').get(polizaId) as { id: number; fila_id: string | null } | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa póliza.')
  return fila
}

export function adjuntosDePoliza(polizaId: number): AdjuntoDePoliza[] {
  const id = enteroPositivo(polizaId, 'La póliza')
  exigirPoliza(id)
  return adjuntosGenericosDe('poliza', id).map(aAdjuntoDePoliza)
}

/** Los archivos que vienen de la pantalla: bytes, ya achicados si eran fotos. */
export async function agregarArchivosDePoliza(polizaId: number, archivos: unknown, actor: SesionUsuario): Promise<AdjuntoDePoliza[]> {
  const id = enteroPositivo(polizaId, 'La póliza')
  const poliza = exigirPoliza(id)
  const lista = archivosParaAdjuntar(archivos)
  const dameToken = dadorDeTokenDeGoogle()
  for (const archivo of lista) {
    const adjunto = registrarAdjunto('poliza', id, archivo, actor)
    await copiarADrive('poliza', adjunto.id, dameToken)
    anotar(id, poliza.fila_id, 'ADJUNTO', null, adjunto.nombre, actor)
  }
  return adjuntosDePoliza(id)
}

/** Rutas del disco (el explorador de archivos o la prueba de humo). */
export async function agregarAdjuntosDePoliza(polizaId: number, rutas: unknown, actor: SesionUsuario): Promise<AdjuntoDePoliza[]> {
  const id = enteroPositivo(polizaId, 'La póliza')
  const poliza = exigirPoliza(id)
  if (!Array.isArray(rutas) || rutas.length === 0) throw new ErrorDeNegocio('No elegiste ningún archivo.')
  const dameToken = dadorDeTokenDeGoogle()
  for (const ruta of rutas) {
    const origen = texto(ruta, 'La ruta del archivo', 1, 4096)
    const adjunto = registrarAdjunto('poliza', id, { nombre: path.basename(origen), ruta: origen }, actor)
    await copiarADrive('poliza', adjunto.id, dameToken)
    anotar(id, poliza.fila_id, 'ADJUNTO', null, adjunto.nombre, actor)
  }
  return adjuntosDePoliza(id)
}

/** La ruta del archivo en esta computadora; si lo cargó otra, se baja del servidor antes. */
export async function rutaDelAdjuntoDePoliza(adjuntoId: number): Promise<string> {
  return asegurarAdjuntoLocal('poliza', enteroPositivo(adjuntoId, 'El documento'))
}

export function borrarAdjuntoDePoliza(adjuntoId: number, actor: SesionUsuario): AdjuntoDePoliza[] {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const { padreId, nombre } = borrarAdjuntoRegistrado('poliza', id, actor)
  anotar(padreId, exigirPoliza(padreId).fila_id, 'ADJUNTO BORRADO', nombre, null, actor)
  return adjuntosDePoliza(padreId)
}

function anotar(polizaId: number, filaId: string | null, campo: string, anterior: string | null, nuevo: string | null, actor: SesionUsuario): void {
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'poliza_adjuntos',
    registroId: polizaId,
    filaId,
    campo,
    valorAnterior: anterior,
    valorNuevo: nuevo,
  })
}
