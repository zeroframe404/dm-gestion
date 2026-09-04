// Vínculos con identidad compartida (12.7): cómo una tarea o un presupuesto dicen «de qué ficha soy»
// de una forma que TODAS las computadoras entienden.
//
// Hasta la 12.6 el vínculo de una tarea viajaba a APP TAREAS como texto para leer («Siniestro S-123 ·
// Pérez») y nada más. Es lo que la agencia mira desde Google, así que se conserva; pero en la otra
// computadora la tarea llegaba suelta —sin cliente, póliza ni siniestro—, y la ficha del siniestro no
// la mostraba. Ahora viaja además la clave («SINIESTRO:<_ID>», «POLIZA:<clave>», «CLIENTE:<clave>»,
// «LEAD:<_ID>», «PRESUPUESTO:<_ID>», «RENOVACION:<clave de la póliza>|<vence>»), que es lo mismo
// que usan los adjuntos y los comentarios (ver anexos.ts), y con ella cada computadora engancha la
// tarea a SU fila local.
import type { BaseDeDatos } from '../db/base'
import { interpretarNumero, limpiar } from '../importacion/normalizar'

export interface IdsDeVinculo {
  siniestro_id?: number | null
  renovacion_id?: number | null
  presupuesto_id?: number | null
  lead_id?: number | null
  poliza_id?: number | null
  cliente_id?: number | null
}

/** La clave del vínculo de una tarea, del más específico al más general; null si la tarea es suelta. */
export function claveDeVinculoDeTarea(base: BaseDeDatos, ids: IdsDeVinculo): string | null {
  const uno = <T>(sql: string, id: number): T | undefined => base.prepare(sql).get(id) as T | undefined
  if (ids.siniestro_id) {
    const s = uno<{ fila_id: string | null }>('SELECT fila_id FROM siniestros WHERE id = ?', ids.siniestro_id)
    if (s?.fila_id) return `SINIESTRO:${s.fila_id}`
  }
  if (ids.renovacion_id) {
    const r = uno<{ clave: string | null; vence_el: string }>(
      'SELECT p.clave, r.vence_el FROM renovaciones r JOIN polizas p ON p.id = r.poliza_id WHERE r.id = ?',
      ids.renovacion_id,
    )
    if (r?.clave) return `RENOVACION:${r.clave}|${r.vence_el}`
  }
  if (ids.presupuesto_id) {
    const p = uno<{ fila_id: string | null }>('SELECT fila_id FROM presupuestos WHERE id = ?', ids.presupuesto_id)
    if (p?.fila_id) return `PRESUPUESTO:${p.fila_id}`
  }
  if (ids.lead_id) {
    const l = uno<{ fila_id: string | null }>('SELECT fila_id FROM leads WHERE id = ?', ids.lead_id)
    if (l?.fila_id) return `LEAD:${l.fila_id}`
  }
  if (ids.poliza_id) {
    const p = uno<{ clave: string | null }>('SELECT clave FROM polizas WHERE id = ?', ids.poliza_id)
    if (p?.clave) return `POLIZA:${p.clave}`
  }
  if (ids.cliente_id) {
    const c = uno<{ clave: string | null }>('SELECT clave FROM clientes WHERE id = ?', ids.cliente_id)
    if (c?.clave) return `CLIENTE:${c.clave}`
  }
  return null
}

/**
 * Los id locales que nombra una clave, o null si la clave no se entiende o la ficha todavía no está en
 * esta computadora (llega con la próxima importación o bajada; mientras tanto la tarea queda suelta y
 * se vuelve a intentar cuando la fila cambie o se reimporte).
 */
export function resolverVinculoDeTarea(base: BaseDeDatos, clave: string): IdsDeVinculo | null {
  const separador = clave.indexOf(':')
  if (separador <= 0) return null
  const tipo = limpiar(clave.slice(0, separador)).toUpperCase()
  const valor = clave.slice(separador + 1).trim()
  if (!valor) return null
  const uno = (sql: string, ...parametros: unknown[]): number | null =>
    ((base.prepare(sql).get(...(parametros as [])) as { id: number } | undefined)?.id ?? null)
  switch (tipo) {
    case 'SINIESTRO': {
      const id = uno('SELECT id FROM siniestros WHERE fila_id = ?', valor)
      if (id === null) return null
      const cliente = (base.prepare('SELECT cliente_id, poliza_id FROM siniestros WHERE id = ?').get(id) as { cliente_id: number | null; poliza_id: number | null })
      return { siniestro_id: id, cliente_id: cliente.cliente_id, poliza_id: cliente.poliza_id }
    }
    case 'RENOVACION': {
      const [clavePoliza, vence] = valor.split('|')
      if (!clavePoliza || !vence) return null
      const polizaId = uno('SELECT id FROM polizas WHERE clave = ?', clavePoliza)
      if (polizaId === null) return null
      const renovacionId = uno('SELECT id FROM renovaciones WHERE poliza_id = ? AND vence_el = ?', polizaId, vence)
      const cliente = (base.prepare('SELECT cliente_id FROM polizas WHERE id = ?').get(polizaId) as { cliente_id: number }).cliente_id
      return { renovacion_id: renovacionId, poliza_id: polizaId, cliente_id: cliente }
    }
    case 'PRESUPUESTO': {
      const id = uno('SELECT id FROM presupuestos WHERE fila_id = ?', valor)
      if (id === null) return null
      const p = base.prepare('SELECT lead_id, cliente_id FROM presupuestos WHERE id = ?').get(id) as { lead_id: number | null; cliente_id: number | null }
      return { presupuesto_id: id, lead_id: p.lead_id, cliente_id: p.cliente_id }
    }
    case 'LEAD': {
      const id = uno('SELECT id FROM leads WHERE fila_id = ?', valor)
      return id === null ? null : { lead_id: id }
    }
    case 'POLIZA': {
      const id = uno('SELECT id FROM polizas WHERE clave = ? OR fila_id = ? ORDER BY id LIMIT 1', valor, valor)
      if (id === null) return null
      const cliente = (base.prepare('SELECT cliente_id FROM polizas WHERE id = ?').get(id) as { cliente_id: number }).cliente_id
      return { poliza_id: id, cliente_id: cliente }
    }
    case 'CLIENTE': {
      const id = uno('SELECT id FROM clientes WHERE clave = ?', valor)
      return id === null ? null : { cliente_id: id }
    }
    default:
      return null
  }
}

/** Sólo las columnas resueltas, para un UPDATE que no borre lo que ya se sabía. */
export function columnasDeVinculo(ids: IdsDeVinculo | null): Record<string, number | null> {
  if (!ids) return {}
  const salida: Record<string, number | null> = {}
  for (const [columna, valor] of Object.entries(ids)) if (valor !== undefined && valor !== null) salida[columna] = valor
  return salida
}

// ---------------------------------------------------------------------------
// Presupuestos: las opciones enteras
// ---------------------------------------------------------------------------

export interface OpcionDePresupuestoParaLaHoja {
  compania: string
  cobertura: string
  precio: string
  comentario: string
}

export function opcionesAJson(opciones: OpcionDePresupuestoParaLaHoja[]): string {
  return JSON.stringify(
    opciones.map((o) => ({ c: o.compania, b: o.cobertura, p: o.precio || '', n: o.comentario || '' })),
  ).slice(0, 4000)
}

/**
 * Las opciones desde la columna OPCIONES JSON (12.7) o, si la fila es anterior y sólo tiene el texto
 * legible («SANCOR TERCEROS COMPLETO $ 45.000 · RIVADAVIA TODO RIESGO $ 61.000»), lo que se pueda
 * sacar de ahí: el precio es lo del final, la compañía se reconoce contra las que ya se usan, y el
 * resto es la cobertura. Devuelve [] si no hay nada usable (la ficha queda sin opciones, no rota).
 */
export function opcionesDesdeLaHoja(json: string, textoLegible: string, companiasConocidas: string[]): OpcionDePresupuestoParaLaHoja[] {
  const limpioJson = limpiar(json)
  if (limpioJson.startsWith('[')) {
    try {
      const lista = JSON.parse(limpioJson) as Array<Record<string, unknown>>
      if (Array.isArray(lista)) {
        return lista
          .map((o) => ({
            compania: limpiar(o.c ?? o.compania).slice(0, 120),
            cobertura: limpiar(o.b ?? o.cobertura).slice(0, 160),
            precio: limpiar(o.p ?? o.precio).slice(0, 60),
            comentario: limpiar(o.n ?? o.comentario).slice(0, 500),
          }))
          .filter((o) => o.compania || o.cobertura)
      }
    } catch {
      // Un JSON roto no vale más que el texto legible: se sigue con él.
    }
  }
  const texto = limpiar(textoLegible)
  if (!texto) return []
  const conocidas = [...companiasConocidas].map((c) => limpiar(c)).filter(Boolean).sort((a, b) => b.length - a.length)
  return texto
    .split(' · ')
    .map((parte) => limpiar(parte))
    .filter(Boolean)
    .map((parte) => {
      let resto = parte
      let precio = ''
      const conPrecio = /^(.*?)\s+(\$?\s*[\d.,]+)$/.exec(resto)
      if (conPrecio && interpretarNumero(conPrecio[2]!) !== null) {
        resto = conPrecio[1]!.trim()
        precio = conPrecio[2]!.trim()
      }
      const compania = conocidas.find((c) => resto.toUpperCase().startsWith(c.toUpperCase() + ' ') || resto.toUpperCase() === c.toUpperCase())
      const cobertura = compania ? resto.slice(compania.length).trim() : ''
      return { compania: compania ?? resto, cobertura: cobertura || (compania ? '' : '—'), precio, comentario: '' }
    })
}

/** Deja las opciones del presupuesto como dice la hoja: se reemplazan enteras, en orden. */
export function guardarOpcionesDePresupuesto(base: BaseDeDatos, presupuestoId: number, opciones: OpcionDePresupuestoParaLaHoja[]): void {
  base.prepare('DELETE FROM presupuesto_opciones WHERE presupuesto_id = ?').run(presupuestoId)
  const insertar = base.prepare(
    `INSERT INTO presupuesto_opciones (presupuesto_id, compania, cobertura, precio, precio_monto, comentario, orden)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  opciones.forEach((o, orden) => {
    insertar.run(presupuestoId, o.compania || '—', o.cobertura || '—', o.precio || null, o.precio ? interpretarNumero(o.precio) : null, o.comentario || null, orden)
  })
}

// ---------------------------------------------------------------------------
// Los estados y orígenes acotados, tal como los escriben en la hoja
// ---------------------------------------------------------------------------

const ESTADOS_DE_LEAD = ['NUEVO', 'EN CHARLA', 'COTIZADO', 'GANADO', 'PERDIDO']
const ORIGENES_DE_LEAD = ['WHATSAPP', 'LOCAL', 'RECOMENDADO', 'REDES', 'OTRO']
const ESTADOS_DE_PRESUPUESTO = ['BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO']

function sinTildes(valor: unknown): string {
  return limpiar(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

export function estadoDeLeadDesdeTexto(valor: unknown): string {
  const texto = sinTildes(valor)
  return ESTADOS_DE_LEAD.includes(texto) ? texto : 'NUEVO'
}

export function origenDeLeadDesdeTexto(valor: unknown): string {
  const texto = sinTildes(valor)
  return ORIGENES_DE_LEAD.includes(texto) ? texto : 'OTRO'
}

export function estadoDePresupuestoDesdeTexto(valor: unknown): string {
  const texto = sinTildes(valor)
  return ESTADOS_DE_PRESUPUESTO.includes(texto) ? texto : 'BORRADOR'
}
