// Servicio de importación: arma la fuente con las credenciales guardadas, corre el importador en segundo
// plano, empuja el progreso al renderer y guarda el informe en %APPDATA%/dm-gestion/informes/.
import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import type { EstadoImportador, InformeImportacion, ProgresoImportacion, SesionUsuario, VistaPreviaHoja } from '../../shared/tipos'
import { db } from '../db/base'
import type { FuenteHoja } from '../importacion/fuente'
import { ejecutarImportacion } from '../importacion/importador'
import { generarTextoDeInforme, informeParaArchivo } from '../importacion/informe'
import { ahoraIso } from '../importacion/normalizar'
import { clasificarPestanas, elegirMasNueva } from '../importacion/pestanas'
import { carpetaDatos } from '../rutas'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'

interface ImportacionEnCurso {
  id: number
  cancelada: boolean
  progreso: ProgresoImportacion
}

let enCurso: ImportacionEnCurso | null = null

function emitir<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
}

export function carpetaInformes(): string {
  const carpeta = path.join(carpetaDatos(), 'informes')
  mkdirSync(carpeta, { recursive: true })
  return carpeta
}

// v12: la reimportación completa lee de la base del VPS, que es la fuente de verdad. La fuente de
// Google quedó sólo dentro de la migración inicial (migracionVps.ts).
function crearFuente(): { fuente: FuenteHoja; hojaId: string } {
  const fuente = crearFuenteVps()
  if (!fuente) {
    throw new ErrorDeNegocio(
      'En desarrollo la base del VPS no está disponible: apuntá DM_GESTION_VPS_URL a un servidor local (scripts/vps-simulado.mjs).',
    )
  }
  return { fuente, hojaId: 'vps' }
}

export function hayImportacionEnCurso(): boolean {
  return enCurso !== null
}

/** Informe mínimo para corridas que no llegaron a producir uno (falla temprana o cierre de la app). */
function informeMinimo(id: number, iniciadaEn: string, estado: InformeImportacion['estado'], error: string, avisos: string[] = []): InformeImportacion {
  return {
    id,
    iniciadaEn,
    terminadaEn: ahoraIso(),
    estado,
    hojaId: '',
    hojaTitulo: '',
    pestanaMasNueva: null,
    pestanas: [],
    totales: { clientes: 0, vehiculos: 0, polizas: 0, polizasInactivadas: 0, cuotasMes: 0, bajas: 0, riesgosVarios: 0, siniestros: 0, amp: 0, reglasCobertura: 0, pagos: 0, filasCrudas: 0, filasQueYaNoEstan: 0, problemas: 0 },
    problemasPorTipo: {},
    sucursalesDesconocidas: {},
    problemas: [],
    problemasOmitidos: 0,
    avisos,
    rutaInforme: null,
    error,
  }
}

export async function vistaPreviaDeHoja(): Promise<VistaPreviaHoja> {
  const { fuente } = crearFuente()
  const estructura = await fuente.estructura()
  const clasificadas = clasificarPestanas(estructura.pestanas.map((p) => ({ titulo: p.titulo, indice: p.indice })))
  const ocultas = new Set(estructura.pestanas.filter((p) => p.oculta).map((p) => p.titulo))
  const masNueva = elegirMasNueva(clasificadas.filter((c) => !ocultas.has(c.titulo)))
  return {
    hojaId: estructura.hojaId,
    titulo: estructura.titulo,
    pestanas: estructura.pestanas.map((p) => {
      const c = clasificadas.find((x) => x.titulo === p.titulo && x.indice === p.indice)!
      return { ...p, tipo: c.tipo, periodo: c.periodo, esLaMasNueva: masNueva !== null && masNueva.titulo === p.titulo && masNueva.indice === p.indice }
    }),
  }
}

function marcaDeTiempo(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export function iniciarImportacion(actor: SesionUsuario): { importacionId: number } {
  if (enCurso) throw new ErrorDeNegocio('Ya hay una importación en curso. Esperá a que termine o cancelala.')
  const { fuente } = crearFuente()

  const fila = db()
    .prepare(`INSERT INTO importaciones (iniciada_en, estado, usuario_id) VALUES (?, 'EN_CURSO', ?) RETURNING id`)
    .get(ahoraIso(), actor.id) as { id: number }

  enCurso = {
    id: fila.id,
    cancelada: false,
    progreso: { importacionId: fila.id, fase: 'preparando', porcentaje: 0, mensaje: 'Conectando con la base del VPS…', pestanas: [] },
  }
  emitir('importacion:progreso', enCurso.progreso)
  void correr(fila.id, fuente)
  return { importacionId: fila.id }
}

async function correr(id: number, fuente: FuenteHoja): Promise<void> {
  let informe: InformeImportacion
  try {
    informe = await ejecutarImportacion({
      db: db(),
      fuente,
      importacionId: id,
      alProgresar: (progreso) => {
        if (enCurso && enCurso.id === id) enCurso.progreso = progreso
        emitir('importacion:progreso', progreso)
      },
      estaCancelada: () => (enCurso?.id === id ? enCurso.cancelada : true),
    })
  } catch (error) {
    // ejecutarImportacion ya captura todo; esto es por si falla antes de arrancar.
    console.error('[importacion] Falla inesperada:', error)
    informe = informeMinimo(id, ahoraIso(), 'FALLIDA', error instanceof Error ? error.message : String(error))
  }

  const texto = generarTextoDeInforme(informe)
  try {
    const ruta = path.join(carpetaInformes(), `importacion-${marcaDeTiempo(informe.iniciadaEn)}.txt`)
    writeFileSync(ruta, informeParaArchivo(texto), 'utf8')
    informe.rutaInforme = ruta
  } catch (error) {
    console.error('[importacion] No se pudo guardar el informe:', error)
    informe.avisos.push(`No se pudo guardar el archivo del informe: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    db()
      .prepare(
        `UPDATE importaciones SET terminada_en = ?, estado = ?, hoja_id = ?, hoja_titulo = ?, informe_json = ?, informe_texto = ?, ruta_informe = ?
         WHERE id = ?`,
      )
      .run(informe.terminadaEn, informe.estado, informe.hojaId, informe.hojaTitulo, JSON.stringify(informe), texto, informe.rutaInforme, id)
  } catch (error) {
    console.error('[importacion] No se pudo registrar la importación:', error)
  }

  if (enCurso?.id === id) enCurso = null
  emitir('importacion:terminada', informe)
}

export function cancelarImportacion(): void {
  if (!enCurso) throw new ErrorDeNegocio('No hay ninguna importación en curso.')
  enCurso.cancelada = true
}

function ultimaImportacion(): InformeImportacion | null {
  const fila = db()
    .prepare('SELECT informe_json FROM importaciones WHERE informe_json IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get() as { informe_json: string } | undefined
  if (!fila) return null
  try {
    return JSON.parse(fila.informe_json) as InformeImportacion
  } catch {
    return null
  }
}

export function estadoDelImportador(): EstadoImportador {
  return { enCurso: enCurso !== null, progreso: enCurso?.progreso ?? null, ultima: ultimaImportacion() }
}

/**
 * Si la app se cerró en medio de una importación, la corrida queda registrada como fallida CON informe,
 * así la pantalla la muestra como última importación y el usuario sabe que tiene que volver a correrla.
 */
export function marcarImportacionesInterrumpidas(): void {
  const interrumpidas = db()
    .prepare(`SELECT id, iniciada_en FROM importaciones WHERE estado = 'EN_CURSO'`)
    .all() as Array<{ id: number; iniciada_en: string }>
  if (interrumpidas.length === 0) return

  const actualizar = db().prepare(
    `UPDATE importaciones SET estado = 'FALLIDA', terminada_en = COALESCE(terminada_en, ?), informe_json = ?, informe_texto = ? WHERE id = ?`,
  )
  for (const fila of interrumpidas) {
    const informe = informeMinimo(fila.id, fila.iniciada_en, 'FALLIDA', 'La aplicación se cerró mientras la importación estaba en curso.', [
      'Volvé a correr la importación completa: lo que alcanzó a guardarse quedó en la base y se actualiza sin duplicar.',
    ])
    actualizar.run(informe.terminadaEn, JSON.stringify(informe), generarTextoDeInforme(informe), fila.id)
  }
  console.warn(`[importacion] ${interrumpidas.length} importación(es) interrumpida(s) marcada(s) como fallidas.`)
}

export async function guardarInforme(importacionId: number, ventana: BrowserWindow | null): Promise<{ ruta: string | null }> {
  const fila = db()
    .prepare('SELECT informe_texto, iniciada_en FROM importaciones WHERE id = ?')
    .get(importacionId) as { informe_texto: string | null; iniciada_en: string } | undefined
  if (!fila?.informe_texto) throw new ErrorDeNegocio('No hay informe guardado para esa importación.')

  const opciones: Electron.SaveDialogOptions = {
    title: 'Guardar informe de importación',
    defaultPath: path.join(app.getPath('documents'), `informe-importacion-${marcaDeTiempo(fila.iniciada_en)}.txt`),
    filters: [
      { name: 'Archivo de texto', extensions: ['txt'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  }
  const resultado = ventana ? await dialog.showSaveDialog(ventana, opciones) : await dialog.showSaveDialog(opciones)
  if (resultado.canceled || !resultado.filePath) return { ruta: null }
  writeFileSync(resultado.filePath, informeParaArchivo(fila.informe_texto), 'utf8')
  return { ruta: resultado.filePath }
}

export function abrirCarpetaInformes(): void {
  void shell.openPath(carpetaInformes())
}
