// La migración inicial al VPS (una sola vez): lee la hoja de Google por última vez, la publica
// completa en la base del VPS y corre una reimportación para que la copia local quede alineada
// con la fuente nueva. Mismo espíritu que «Subir usuarios» de la base de usuarios compartida.
import type { EstadoMigracionVps, ResumenMigracionVps } from '../../shared/tipos'
import { db } from '../db/base'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { anotarEvento } from '../sincronizacion/cola'
import { estadoGoogle } from './config'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps, fuenteGoogleDirecta } from './sincronizacion'

export async function estadoDeLaBaseVps(): Promise<EstadoMigracionVps> {
  const fuente = crearFuenteVps()
  const googleConfigurado = estadoGoogle().configurado
  if (!fuente) {
    return {
      urlBase: '(sin configurar en desarrollo: DM_GESTION_VPS_URL)',
      googleConfigurado,
      base: null,
      error: 'En desarrollo la base del VPS no está disponible salvo que DM_GESTION_VPS_URL apunte a un servidor local.',
    }
  }
  const urlBase = fuente.urlDelServidor()
  try {
    return { urlBase, googleConfigurado, base: await fuente.estadoBase(), error: null }
  } catch (error) {
    return {
      urlBase,
      googleConfigurado,
      base: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function migrarAlVps(): Promise<ResumenMigracionVps> {
  const google = fuenteGoogleDirecta()
  if (!google) {
    throw new ErrorDeNegocio(
      'Para migrar hace falta la conexión con Google todavía configurada en esta PC: la migración lee la hoja completa por última vez.',
    )
  }
  const vps = crearFuenteVps()
  if (!vps) throw new ErrorDeNegocio('En desarrollo la base del VPS no está disponible (DM_GESTION_VPS_URL).')
  const estado = await vps.estadoBase()
  if (estado.inicializada) {
    throw new ErrorDeNegocio('La base del VPS ya está migrada: la migración es una sola vez.')
  }

  const estructura = await google.estructura()
  const pestanas = [...estructura.pestanas].sort((a, b) => a.indice - b.indice)
  if (pestanas.length === 0) throw new ErrorDeNegocio('La hoja de Google no tiene pestañas para migrar.')

  await vps.migracionComenzar()
  for (const pestana of pestanas) {
    const valores = await google.leerValores(pestana.titulo)
    await vps.migracionCargarPestana({ titulo: pestana.titulo, oculta: pestana.oculta, valores })
  }

  // Antes de confirmar: si otra computadora arrancó SU migración en el medio, el «comenzar» ajeno
  // vació lo nuestro y la base quedaría incompleta. Con el conteo distinto se aborta sin confirmar.
  const enElServidor = await vps.estadoBase()
  if (enElServidor.pestanas !== pestanas.length) {
    throw new ErrorDeNegocio(
      `La migración se pisó con otra: el servidor tiene ${enElServidor.pestanas} pestañas y esta computadora subió ${pestanas.length}. ` +
        'Seguramente alguien más tocó «Migrar» a la vez. Esperá un minuto y migrenla UNA sola vez, desde UNA sola computadora.',
    )
  }

  let resumen: ResumenMigracionVps
  try {
    resumen = await vps.migracionConfirmar()
  } catch (error) {
    // Si la confirmación viajó pero la respuesta se perdió, la base quedó confirmada igual:
    // se relee el estado antes de dar la migración por fallida.
    const releido = await vps.estadoBase().catch(() => null)
    if (!releido?.inicializada) throw error
    resumen = { pestanas: releido.pestanas, filas: releido.filas }
  }
  anotarEvento(
    'motor',
    `GENERAL DE CLIENTES migrado al VPS: ${resumen.pestanas} pestañas y ${resumen.filas} filas. Desde ahora la base del VPS es la fuente de verdad.`,
  )

  // Reimportación de alineación: refresca sheet_id, número de fila y huella de cada fila contra la
  // fuente nueva. Es idempotente (upsert por _ID): no duplica nada.
  const { id } = db()
    .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
    .get(ahoraIso()) as { id: number }
  const informe = await ejecutarImportacion({ db: db(), fuente: vps, importacionId: id })
  db()
    .prepare('UPDATE importaciones SET terminada_en = ?, estado = ?, informe_json = ? WHERE id = ?')
    .run(informe.terminadaEn, informe.estado, JSON.stringify(informe), id)

  return resumen
}
