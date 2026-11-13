// La migración inicial al VPS (una sola vez): lee la hoja de Google por última vez, la publica
// completa en la base del VPS y corre una reimportación para que la copia local quede alineada
// con la fuente nueva. Mismo espíritu que «Subir usuarios» de la base de usuarios compartida.
import type { EstadoMigracionVps, InformeImportacion, ProgresoImportacion, ResumenMigracionVps } from '../../shared/tipos'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { anotarEvento } from '../sincronizacion/cola'
import { estadoGoogle } from './config'
import { ErrorDeNegocio } from './errores'
import { exigirQueNoSeaLaBetaContraProduccion } from './proteccionBeta'
import { crearFuenteVps, fuenteGoogleDirecta } from './sincronizacion'
import { reservarImportacion } from './importacion'
import type { FuenteVps } from '../vps/fuenteVps'

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
  // Demo: la migración lee la hoja de Google de la agencia, y la demostración no sale a internet. La base
  // de la demo ya viene «migrada» en su servidor interno.
  if (esDemo()) throw new ErrorDeNegocio('En la demostración la base ya está en el servidor: no hay nada que migrar desde Google.')
  exigirQueNoSeaLaBetaContraProduccion('migrar la base al VPS')
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

  const cargadas: PestanaParaPublicar[] = []
  for (const pestana of pestanas) {
    cargadas.push({ titulo: pestana.titulo, oculta: pestana.oculta, valores: await google.leerValores(pestana.titulo) })
  }
  const { resumen } = await publicarEnBaseVacia(vps, cargadas, 'GENERAL DE CLIENTES migrado al VPS')
  return resumen
}

export interface PestanaParaPublicar {
  titulo: string
  oculta: boolean
  valores: string[][]
}

/**
 * Publica pestañas enteras en una base del VPS que todavía no está inicializada y corre la importación
 * de alineación. Es el tramo común de la migración desde Google y del Alta desde Excel: quien llama ya
 * comprobó que la base está vacía (el servidor lo vuelve a comprobar: rechaza con 409 si no).
 */
export async function publicarEnBaseVacia(
  vps: FuenteVps,
  pestanas: PestanaParaPublicar[],
  evento: string,
  opciones: { usuarioId?: number | null; alProgresar?: (progreso: ProgresoImportacion) => void } = {},
): Promise<{ resumen: ResumenMigracionVps; informe: InformeImportacion }> {
  if (pestanas.length === 0) throw new ErrorDeNegocio('No hay pestañas para publicar.')
  // La importación de alineación se registra y se RESERVA antes de tocar el servidor: apenas se confirma,
  // la sincronización de esta computadora ve la base inicializada con filas sin _ID y, sin la reserva,
  // corre su propia importación al mismo tiempo que ésta (ver `reservarImportacion`).
  const { id } = db()
    .prepare(`INSERT INTO importaciones (iniciada_en, estado, usuario_id) VALUES (?, 'EN_CURSO', ?) RETURNING id`)
    .get(ahoraIso(), opciones.usuarioId ?? null) as { id: number }
  const reserva = reservarImportacion(id, 'Cargando la base del VPS…')
  if (!reserva) {
    db().prepare(`UPDATE importaciones SET estado = 'CANCELADA', terminada_en = ? WHERE id = ?`).run(ahoraIso(), id)
    throw new ErrorDeNegocio('Hay una importación en curso en esta computadora. Esperá a que termine y volvé a intentar.')
  }
  try {
    await vps.migracionComenzar()
    for (const pestana of pestanas) {
      await vps.migracionCargarPestana({ titulo: pestana.titulo, oculta: pestana.oculta, valores: pestana.valores })
    }

    // Antes de confirmar: si otra computadora arrancó SU migración en el medio, el «comenzar» ajeno
    // vació lo nuestro y la base quedaría incompleta. Con el conteo distinto se aborta sin confirmar.
    const enElServidor = await vps.estadoBase()
    if (enElServidor.pestanas !== pestanas.length) {
      throw new ErrorDeNegocio(
        `La carga se pisó con otra: el servidor tiene ${enElServidor.pestanas} pestañas y esta computadora subió ${pestanas.length}. ` +
          'Seguramente alguien más hizo lo mismo a la vez. Esperá un minuto y hacelo UNA sola vez, desde UNA sola computadora.',
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
      `${evento}: ${resumen.pestanas} pestañas y ${resumen.filas} filas. Desde ahora la base del VPS es la fuente de verdad.`,
    )

    // Importación de alineación: refresca sheet_id, número de fila y huella de cada fila contra la
    // fuente nueva (y en el alta, carga todo por primera vez). Es idempotente (upsert por _ID).
    const informe = await ejecutarImportacion({
      db: db(),
      fuente: vps,
      importacionId: id,
      estaCancelada: reserva.estaCancelada,
      alProgresar: (progreso) => {
        reserva.alProgresar(progreso)
        opciones.alProgresar?.(progreso)
      },
    })
    db()
      .prepare('UPDATE importaciones SET terminada_en = ?, estado = ?, hoja_id = ?, hoja_titulo = ?, informe_json = ? WHERE id = ?')
      .run(informe.terminadaEn, informe.estado, informe.hojaId, informe.hojaTitulo, JSON.stringify(informe), id)
    return { resumen, informe }
  } catch (error) {
    db()
      .prepare(`UPDATE importaciones SET estado = 'FALLIDA', terminada_en = ? WHERE id = ? AND estado = 'EN_CURSO'`)
      .run(ahoraIso(), id)
    throw error
  } finally {
    reserva.liberar()
  }
}
