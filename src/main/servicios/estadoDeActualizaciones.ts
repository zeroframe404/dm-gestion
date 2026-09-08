// Qué versión tiene instalada cada sucursal y si dejó una actualización «para después», para que el
// superadministrador la vea desde la pantalla de Usuarios sin tener que ir máquina por máquina.
//
// Mismo patrón que el encabezado del ticket (ver `ajustesCompartidos.ts`): cada sucursal sólo puede
// escribir SU renglón. Se lee lo que hay en el servidor, se reemplaza sólo el propio y se manda la
// mezcla completa; así el reporte de Lanús nunca pisa el de Dock Sud aunque las dos publiquen a la vez.
//
// Es de sólo lectura para quien no es superadministrador: acá no hay nada que «adoptar» en esta
// computadora (a diferencia de los ajustes compartidos), es pura información para mostrar en una
// pantalla. Si el VPS no contesta, se sigue de largo: esto es un informe, nunca puede frenar el chequeo
// de actualizaciones ni el arranque del programa.
import { app } from 'electron'
import type { EstadoDeActualizacionDeSucursal } from '../../shared/tipos'
import { ahoraIso } from '../importacion/normalizar'
import { sesion } from './sesion'
import { crearFuenteVps } from './sincronizacion'

const CLAVE = 'actualizaciones_sucursales'

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** «13.0.1» > «9.2.0»: comparación numérica por tramo, no alfabética. */
export function compararVersiones(a: string, b: string): number {
  const partesA = a.split('.').map((parte) => Number.parseInt(parte, 10) || 0)
  const partesB = b.split('.').map((parte) => Number.parseInt(parte, 10) || 0)
  const largo = Math.max(partesA.length, partesB.length)
  for (let i = 0; i < largo; i++) {
    const diferencia = (partesA[i] ?? 0) - (partesB[i] ?? 0)
    if (diferencia !== 0) return diferencia
  }
  return 0
}

/** Las filas que bajaron del servidor, saneadas: cualquier cosa que no tenga la forma esperada se ignora. */
export function filasDesde(valor: unknown): EstadoDeActualizacionDeSucursal[] {
  if (!valor || typeof valor !== 'object') return []
  const crudas = (valor as { sucursales?: unknown }).sucursales
  if (!Array.isArray(crudas)) return []
  const filas: EstadoDeActualizacionDeSucursal[] = []
  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') continue
    const fila = cruda as Record<string, unknown>
    const sucursal = typeof fila.sucursal === 'string' ? fila.sucursal.trim() : ''
    const version = typeof fila.version === 'string' ? fila.version.trim() : ''
    if (!sucursal || !version) continue
    filas.push({
      sucursal,
      version,
      reportadoEn: typeof fila.reportadoEn === 'string' ? fila.reportadoEn : ahoraIso(),
      rechazoVersion: typeof fila.rechazoVersion === 'string' ? fila.rechazoVersion : null,
      rechazadoEn: typeof fila.rechazadoEn === 'string' ? fila.rechazadoEn : null,
    })
  }
  return filas
}

/**
 * Publica el renglón de la sucursal de quien está logueado ahora en esta computadora.
 *
 * Sin sesión no hay a qué sucursal atribuirle el reporte, así que no se manda nada: el chequeo de
 * actualizaciones corre igual desde antes de iniciar sesión, y no tiene sentido inventarle una sucursal.
 */
async function publicarPropia(rechazo?: { version: string }): Promise<void> {
  const actor = sesion()
  if (!actor) return
  const vps = crearFuenteVps()
  if (!vps) return

  try {
    const guardado = await vps.leerAjuste(CLAVE)
    const filas = filasDesde(guardado?.valor)
    const sucursal = actor.sucursal.nombre
    const propia = filas.find((fila) => fila.sucursal === sucursal)
    const version = app.isPackaged ? app.getVersion() : (propia?.version ?? app.getVersion())

    let rechazoVersion = rechazo ? rechazo.version : (propia?.rechazoVersion ?? null)
    let rechazadoEn = rechazo ? ahoraIso() : (propia?.rechazadoEn ?? null)
    // Si ya se actualizó por encima de lo que había dejado para después, el rechazo quedó viejo.
    if (rechazoVersion && compararVersiones(version, rechazoVersion) >= 0) {
      rechazoVersion = null
      rechazadoEn = null
    }

    const nueva: EstadoDeActualizacionDeSucursal = { sucursal, version, reportadoEn: ahoraIso(), rechazoVersion, rechazadoEn }
    const mezcla = [...filas.filter((fila) => fila.sucursal !== sucursal), nueva].sort((a, b) => a.sucursal.localeCompare(b.sucursal))
    await vps.guardarAjuste(CLAVE, { sucursales: mezcla }, actor.nombre)
  } catch (error) {
    console.error('[actualizaciones] No se pudo reportar el estado de esta sucursal:', motivo(error))
  }
}

/** Se llama en cada chequeo (cada 15 minutos) y al iniciar sesión: mantiene viva la versión reportada. */
export function reportarVersionPropia(): void {
  void publicarPropia()
}

/** El «Dejar para después» del cartel: no descarga nada, sólo anota qué versión se rechazó. */
export function reportarRechazo(version: string): void {
  void publicarPropia({ version })
}

/** Sólo para la pantalla de Usuarios del superadministrador. */
export async function estadoDeActualizacionesPorSucursal(): Promise<EstadoDeActualizacionDeSucursal[]> {
  const vps = crearFuenteVps()
  if (!vps) return []
  try {
    const guardado = await vps.leerAjuste(CLAVE)
    return filasDesde(guardado?.valor).sort((a, b) => a.sucursal.localeCompare(b.sucursal))
  } catch (error) {
    console.error('[actualizaciones] No se pudo traer el estado de las sucursales:', motivo(error))
    return []
  }
}
