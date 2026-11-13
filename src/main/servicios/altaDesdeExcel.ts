// Alta desde Excel: una agencia nueva, con su servidor recién instalado y la base vacía, sube SU Excel
// (o un .csv), dice qué es cada hoja y cada columna, ensaya, y lo publica en la base.
//
// Lo puro está en importacion/altaDesdeExcel.ts (el armado de las pestañas) y en
// importacion/lectorDeLibro.ts (leer el archivo). Acá está lo que tiene estado:
//   - el libro leído queda en memoria en el proceso principal, con un token: a la pantalla sólo le
//     llegan las primeras filas de cada hoja, no el archivo entero en cada paso;
//   - el ENSAYO importa las pestañas armadas en una base de datos en memoria, contra una fuente en
//     memoria: muestra el mismo informe que va a salir de verdad sin tocar el servidor ni esta PC;
//   - PUBLICAR es el mismo camino que la migración desde Google (`publicarEnBaseVacia`): una sola vez,
//     sobre una base sin inicializar, nunca desde la demo ni desde la beta contra la base real.
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { BrowserWindow, dialog } from 'electron'
import type {
  AsignacionDeAlta,
  AsignacionDeHoja,
  EnsayoDeAlta,
  EstadoDeAltaExcel,
  InformeImportacion,
  LibroDeAlta,
  PestanaDeAlta,
  ResumenDeAltaExcel,
  SesionUsuario,
  TipoDeHojaDeAlta,
} from '../../shared/tipos'
import { TIPOS_DE_HOJA_DE_ALTA } from '../../shared/tipos'
import { sucursalCanonica } from '../../shared/sucursales'
import { esDemo } from '../canal'
import { db as baseActual, type BaseDeDatos } from '../db/base'
import { ejecutarMigraciones } from '../db/migraciones'
import { ajustarCatalogoDeSucursales } from '../db/semilla'
import { armarPestanasCanonicas, camposDeAlta, columnasSugeridas, REQUISITOS, sugerirAsignacion, vistaDeHoja, type ResultadoDelArmado } from '../importacion/altaDesdeExcel'
import { FuenteEnMemoria } from '../importacion/fuenteEnMemoria'
import { ejecutarImportacion } from '../importacion/importador'
import { leerLibro, type LibroLeido } from '../importacion/lectorDeLibro'
import { ahoraIso } from '../importacion/normalizar'
import type { FuenteVps } from '../vps/fuenteVps'
import { emitirATodas } from './avisos'
import { ErrorDeNegocio } from './errores'
import { hayImportacionEnCurso } from './importacion'
import { estadoDeLaBaseVps, publicarEnBaseVacia } from './migracionVps'
import { exigirQueNoSeaLaBetaContraProduccion } from './proteccionBeta'
import { crearFuenteVps } from './sincronizacion'

/** El libro que se está dando de alta. Uno solo: elegir otro archivo reemplaza al anterior. */
let libroActual: { token: string; libro: LibroLeido } | null = null
let publicando = false

/** Filas de muestra de cada pestaña armada que se le muestran a la persona. */
const MUESTRA_DE_PESTANA = 8

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Por qué no se puede publicar desde acá (demo, beta contra la base real), sin mirar la base. */
function motivoDeLaComputadora(): string | null {
  if (esDemo()) return 'En la demostración la base ya viene cargada: se puede ensayar, pero no publicar.'
  try {
    exigirQueNoSeaLaBetaContraProduccion('cargar un Excel en la base')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return null
}

export async function estadoDelAlta(): Promise<EstadoDeAltaExcel> {
  const estado = await estadoDeLaBaseVps()
  let motivo = motivoDeLaComputadora()
  if (!motivo && estado.error) motivo = `No se pudo consultar la base del servidor: ${estado.error}`
  if (!motivo && estado.base?.inicializada) {
    motivo =
      'La base de esta agencia ya tiene datos: el alta desde Excel es sólo para empezar con una base vacía. ' +
      'Se puede ensayar igual, para ver cómo se leería el archivo.'
  }
  return { urlBase: estado.urlBase, base: estado.base, error: estado.error, motivoParaNoPublicar: motivo }
}

// ---------------------------------------------------------------------------
// El archivo
// ---------------------------------------------------------------------------

/** Lee un archivo ya en memoria y lo deja listo para el asistente (lo usan el diálogo y las pruebas). */
export function cargarLibro(bytes: Buffer, archivo: string): LibroDeAlta {
  const libro = leerLibro(bytes, archivo)
  const token = randomUUID()
  libroActual = { token, libro }
  const campos = {} as LibroDeAlta['campos']
  const requisitos = {} as LibroDeAlta['requisitos']
  for (const tipo of TIPOS_DE_HOJA_DE_ALTA) {
    campos[tipo] = camposDeAlta(tipo)
    requisitos[tipo] = REQUISITOS[tipo]
  }
  return {
    token,
    archivo: libro.archivo,
    hojas: libro.hojas.map((hoja, indice) => vistaDeHoja(hoja, indice)),
    sugerencia: sugerirAsignacion(libro, token),
    campos,
    requisitos,
  }
}

export async function elegirArchivo(ventana: BrowserWindow | null): Promise<LibroDeAlta | null> {
  const opciones = {
    title: 'Elegí el Excel de la agencia',
    properties: ['openFile' as const],
    filters: [
      { name: 'Planillas (Excel o CSV)', extensions: ['xlsx', 'xlsm', 'csv', 'txt'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  }
  const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
  const ruta = elegido.filePaths[0]
  if (elegido.canceled || !ruta) return null
  if (statSync(ruta).size > 80 * 1024 * 1024) throw new ErrorDeNegocio('El archivo es demasiado grande (más de 80 MB).')
  return cargarLibro(readFileSync(ruta), path.basename(ruta))
}

/** Lo que se reconoce solo en una hoja si se la toma como `tipo` con los encabezados en `filaEncabezados`. */
export function sugerirColumnasDeHoja(token: unknown, indice: unknown, tipo: unknown, filaEncabezados: unknown): Array<string | null> {
  if (!libroActual || token !== libroActual.token) throw new ErrorDeNegocio('El archivo ya no está abierto en el programa: volvé a elegirlo.')
  const hoja = libroActual.libro.hojas[Number(indice)]
  if (!hoja) throw new ErrorDeNegocio('Esa hoja no existe en el archivo.')
  if (typeof tipo !== 'string' || !(TIPOS_DE_HOJA_DE_ALTA as readonly string[]).includes(tipo)) throw new ErrorDeNegocio('Tipo de hoja desconocido.')
  const fila = Number(filaEncabezados)
  const encabezados = Number.isInteger(fila) && fila >= 0 ? (hoja.filas[fila] ?? []) : []
  const ancho = hoja.filas.reduce((maximo, f) => Math.max(maximo, f.length), 0)
  const sugeridas = columnasSugeridas(encabezados, tipo as TipoDeHojaDeAlta)
  return Array.from({ length: ancho }, (_, i) => sugeridas[i] ?? null)
}

export function olvidarLibro(): void {
  libroActual = null
}

// ---------------------------------------------------------------------------
// La asignación que manda la pantalla
// ---------------------------------------------------------------------------

/** Revisa la forma de lo que llega del renderer: nada se usa sin mirar. */
export function validarAsignacion(crudo: unknown): { libro: LibroLeido; asignacion: AsignacionDeAlta } {
  const pedido = crudo as Partial<AsignacionDeAlta> | null
  if (!libroActual || typeof pedido?.token !== 'string' || pedido.token !== libroActual.token) {
    throw new ErrorDeNegocio('El archivo ya no está abierto en el programa: volvé a elegirlo.')
  }
  const libro = libroActual.libro
  const tipos = new Set<string>(TIPOS_DE_HOJA_DE_ALTA)
  const hojas: AsignacionDeHoja[] = []
  for (const h of Array.isArray(pedido.hojas) ? pedido.hojas : []) {
    const indice = Number(h?.indice)
    const hoja = libro.hojas[indice]
    if (!Number.isInteger(indice) || !hoja || hojas.some((x) => x.indice === indice)) continue
    const tipo = typeof h.tipo === 'string' && tipos.has(h.tipo) ? (h.tipo as TipoDeHojaDeAlta) : null
    const filaEncabezados = Number(h.filaEncabezados)
    const fijos: Record<string, string> = {}
    for (const [campo, valor] of Object.entries(h.fijos ?? {})) {
      if (typeof valor === 'string' && valor.trim()) fijos[String(campo)] = valor.trim().slice(0, 200)
    }
    hojas.push({
      indice,
      tipo,
      filaEncabezados: Number.isInteger(filaEncabezados) && filaEncabezados >= 0 && filaEncabezados < Math.max(1, hoja.filas.length) ? filaEncabezados : 0,
      columnas: (Array.isArray(h.columnas) ? h.columnas : []).slice(0, 500).map((c) => (typeof c === 'string' && c ? c : null)),
      fijos,
    })
  }
  const sucursales: Record<string, string> = {}
  for (const [valor, destino] of Object.entries(pedido.sucursales ?? {})) {
    if (typeof destino === 'string' && destino.trim()) sucursales[String(valor)] = destino.trim()
  }
  return { libro, asignacion: { token: pedido.token, hojas, sucursales } }
}

// ---------------------------------------------------------------------------
// Ensayo
// ---------------------------------------------------------------------------

/** Una base nueva en memoria con el esquema de siempre y las sucursales de esta agencia. */
function baseDeEnsayo(): BaseDeDatos {
  const memoria = new Database(':memory:') as BaseDeDatos
  memoria.pragma('foreign_keys = ON')
  const registrar = console.log
  console.log = () => undefined
  try {
    ejecutarMigraciones(memoria)
    let copiadas = false
    try {
      const propias = baseActual().prepare('SELECT nombre FROM sucursales ORDER BY id').all() as Array<{ nombre: string }>
      if (propias.length > 0) {
        const insertar = memoria.prepare('INSERT OR IGNORE INTO sucursales (nombre) VALUES (?)')
        for (const s of propias) insertar.run(s.nombre)
        copiadas = true
      }
    } catch {
      // Sin base abierta (las pruebas): se usan las sucursales configuradas.
    }
    if (!copiadas) ajustarCatalogoDeSucursales(memoria)
  } finally {
    console.log = registrar
  }
  return memoria
}

function resumenDePestanas(armado: ResultadoDelArmado): PestanaDeAlta[] {
  return armado.pestanas.map((p) => ({
    titulo: p.titulo,
    tipo: p.tipo,
    encabezados: p.valores[0] ?? [],
    filas: p.valores.length - 1,
    muestra: p.valores.slice(1, 1 + MUESTRA_DE_PESTANA),
  }))
}

export async function ensayarAlta(crudo: unknown, hoy = new Date()): Promise<EnsayoDeAlta> {
  const { libro, asignacion } = validarAsignacion(crudo)
  const armado = armarPestanasCanonicas(libro, asignacion, hoy)
  const memoria = baseDeEnsayo()
  try {
    const catalogo = (memoria.prepare('SELECT nombre FROM sucursales ORDER BY nombre').all() as Array<{ nombre: string }>).map((s) => s.nombre)
    const conocidas = new Set(catalogo.map((n) => n.toUpperCase()))
    const sucursalesDesconocidas = [...armado.valoresDeSucursal]
      .filter(([valor]) => !sucursalCanonica(valor) && !conocidas.has(valor.toUpperCase()))
      .map(([valor, filas]) => ({ valor, filas }))
      .sort((a, b) => b.filas - a.filas)

    let informe: InformeImportacion
    if (armado.pestanas.length > 0) {
      const { id } = memoria
        .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
        .get(ahoraIso()) as { id: number }
      informe = await ejecutarImportacion({
        db: memoria,
        fuente: new FuenteEnMemoria(armado.pestanas.map((p) => ({ titulo: p.titulo, valores: p.valores })), `Ensayo de ${libro.archivo}`),
        importacionId: id,
        anioActual: hoy.getFullYear(),
        mesActual: hoy.getMonth() + 1,
      })
    } else {
      informe = informeVacio(libro.archivo)
    }
    return {
      pestanas: resumenDePestanas(armado),
      avisos: armado.avisos,
      faltantes: armado.faltantes,
      informe,
      sucursalesDesconocidas,
      catalogoDeSucursales: catalogo,
    }
  } finally {
    memoria.close()
  }
}

function informeVacio(archivo: string): InformeImportacion {
  const ahora = ahoraIso()
  return {
    id: 0,
    iniciadaEn: ahora,
    terminadaEn: ahora,
    estado: 'COMPLETA',
    hojaId: 'ensayo',
    hojaTitulo: `Ensayo de ${archivo}`,
    pestanaMasNueva: null,
    pestanas: [],
    totales: {
      clientes: 0,
      vehiculos: 0,
      polizas: 0,
      polizasInactivadas: 0,
      cuotasMes: 0,
      bajas: 0,
      riesgosVarios: 0,
      siniestros: 0,
      amp: 0,
      reglasCobertura: 0,
      pagos: 0,
      filasCrudas: 0,
      filasQueYaNoEstan: 0,
      problemas: 0,
    },
    problemasPorTipo: {},
    sucursalesDesconocidas: {},
    problemas: [],
    problemasOmitidos: 0,
    avisos: [],
    rutaInforme: null,
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

export async function publicarAlta(
  crudo: unknown,
  actor: Pick<SesionUsuario, 'id'> | null,
  opciones: { vps?: FuenteVps | null; hoy?: Date } = {},
): Promise<ResumenDeAltaExcel> {
  const motivo = motivoDeLaComputadora()
  if (motivo) throw new ErrorDeNegocio(motivo)
  if (publicando) throw new ErrorDeNegocio('Ya se está cargando el Excel en la base: esperá a que termine.')
  if (hayImportacionEnCurso()) throw new ErrorDeNegocio('Hay una importación en curso. Esperá a que termine y volvé a intentar.')
  const { libro, asignacion } = validarAsignacion(crudo)
  const armado = armarPestanasCanonicas(libro, asignacion, opciones.hoy ?? new Date())
  if (armado.faltantes.length > 0) throw new ErrorDeNegocio(`Antes de cargar falta resolver: ${armado.faltantes.join(' ')}`)

  const vps = opciones.vps ?? crearFuenteVps()
  if (!vps) throw new ErrorDeNegocio('Esta computadora no tiene configurado el servidor de la agencia.')
  publicando = true
  try {
    const estado = await vps.estadoBase()
    if (estado.inicializada) {
      throw new ErrorDeNegocio('La base de esta agencia ya tiene datos: el alta desde Excel es sólo para empezar con una base vacía.')
    }
    const { resumen, informe } = await publicarEnBaseVacia(
      vps,
      armado.pestanas.map((p) => ({ titulo: p.titulo, oculta: false, valores: p.valores })),
      `Alta desde Excel («${libro.archivo}»)`,
      { usuarioId: actor?.id ?? null, alProgresar: (progreso) => emitirATodas('importacion:progreso', progreso) },
    )
    emitirATodas('importacion:terminada', informe)
    libroActual = null
    return { pestanas: resumen.pestanas, filas: resumen.filas, informe }
  } finally {
    publicando = false
  }
}
