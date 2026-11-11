// Dónde viven los pedidos de autorización puntual, y la lectura rápida que usa el control de permisos.
//
// Con base compartida (lo normal): dentro de `usuarios.json`, al lado de los permisos, y se escriben
// con el mismo candado optimista que el resto de las mutaciones. Sin ella (desarrollo, pruebas, o
// antes de subir los usuarios): una fila de `configuracion` de esta computadora.
//
// Va aparte de `autorizaciones.ts` porque `permisos.ts` necesita LEER las concesiones vigentes en
// cada llamado, y `autorizaciones.ts` necesita a `permisos.ts` para saber quién puede pedir y resolver.
import { normalizarSolicitudes, podarSolicitudes, type SolicitudDeAutorizacion } from '../../shared/autorizaciones'
import type { SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import * as compartida from './baseDeUsuarios'

const CLAVE = 'autorizaciones_puntuales'

/** Lo último que se escribió/leyó de la copia local, para no volver a escribir lo mismo en cada llamado. */
let textoEnDisco: string | null = null
let cacheLocal: { texto: string; solicitudes: SolicitudDeAutorizacion[] } | null = null
let ultimoRefresco = 0

/** La base se abre de nuevo en cada prueba: la memoria de lo leído no puede sobrevivirla. */
export function olvidarAutorizacionesEnMemoria(): void {
  textoEnDisco = null
  cacheLocal = null
  ultimoRefresco = 0
}

function leerLocal(): SolicitudDeAutorizacion[] {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE) as { valor: string } | undefined
  if (!fila) return []
  if (cacheLocal?.texto === fila.valor) return cacheLocal.solicitudes
  let solicitudes: SolicitudDeAutorizacion[] = []
  try {
    solicitudes = normalizarSolicitudes(JSON.parse(fila.valor))
  } catch {
    // Una copia ilegible no abre nada: se vuelve a «ninguna autorización».
  }
  cacheLocal = { texto: fila.valor, solicitudes }
  return solicitudes
}

function escribirLocal(solicitudes: SolicitudDeAutorizacion[]): void {
  const texto = JSON.stringify(solicitudes)
  if (texto === textoEnDisco) return
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(CLAVE, texto, new Date().toISOString())
  textoEnDisco = texto
  cacheLocal = { texto, solicitudes }
}

/**
 * Los pedidos que rigen ahora. Con base compartida, los del último `usuarios.json` leído (y de paso
 * queda la copia para ingresar sin internet); si todavía no se leyó, la copia local.
 */
export function solicitudesVigentes(): SolicitudDeAutorizacion[] {
  if (compartida.usaBaseCompartida()) {
    const documento = compartida.ultimoDocumentoLeido()
    if (documento) {
      escribirLocal(documento.autorizaciones)
      return documento.autorizaciones
    }
  }
  return leerLocal()
}

/**
 * Vuelve a leer GitHub para ver los pedidos nuevos de otras computadoras. A lo sumo una vez cada 30
 * segundos por computadora: la campana pregunta cada minuto y no hace falta más.
 */
export async function refrescar(): Promise<void> {
  if (!compartida.usaBaseCompartida()) return
  if (Date.now() - ultimoRefresco < 30_000) return
  ultimoRefresco = Date.now()
  try {
    await compartida.comprobarAcceso()
  } catch (error) {
    console.error('[autorizaciones] No se pudo refrescar la base de usuarios:', error)
  }
}

/** Aplica un cambio sobre la lista de pedidos y la guarda donde corresponda. Devuelve la lista nueva. */
export async function mutar(
  actor: SesionUsuario,
  accion: string,
  cambiar: (actuales: SolicitudDeAutorizacion[]) => SolicitudDeAutorizacion[],
): Promise<SolicitudDeAutorizacion[]> {
  const aplicar = (actuales: SolicitudDeAutorizacion[]) => podarSolicitudes(cambiar(actuales), Date.now())
  if (compartida.usaBaseCompartida()) {
    const nueva = await compartida.mutarAutorizaciones(actor, accion, aplicar)
    escribirLocal(nueva)
    return nueva
  }
  const nueva = aplicar(leerLocal())
  escribirLocal(nueva)
  return nueva
}
