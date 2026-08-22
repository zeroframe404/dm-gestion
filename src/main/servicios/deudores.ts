// Buscador de deudores: quién debe, acotado como lo pide el mostrador —sucursal, compañía, forma de
// pago y los días del mes que se tilden, que casi nunca son seguidos («los que vencen el 1, el 3 y el
// 5»)— y el listado listo para exportar a Excel o a un .txt para imprimir o mandar por mensaje.
//
// Una deuda es una CUOTA impaga, no una persona: alguien con dos pólizas atrasadas debe dos veces y
// hay que cobrarle las dos. Por eso cada fila es una cuota y el listado dice aparte cuántas personas
// distintas son.
//
// Trabaja sobre las mismas filas de la planilla que la Cartera y la Mora (SELECT_PLANILLA), así que
// «impaga» quiere decir exactamente lo mismo en las tres pantallas: sin fecha en CUANDO PAGO y sin un
// pago registrado desde la aplicación.
import { comoTextoDeFecha } from '../../shared/polizas'
import { esDebitoAutomatico, fechaDeVencimiento, hoyLocal, nombreDePeriodo } from '../../shared/semaforo'
import {
  DEUDORES_SIN_FILTROS,
  FORMATOS_DE_DEUDORES,
  type FilaCartera,
  type FilaDeudor,
  type FiltrosDeudores,
  type FormatoDeDeudores,
  type ListadoDeudores,
} from '../../shared/tipos'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { aFila, periodosDisponibles, SELECT_PLANILLA, type FilaCruda } from './cartera'
import { diasCoberturaPorCompania } from './companias'
import { paraNombreDeArchivo } from './exportacion'
import { construirXlsx, type ValorDeCelda } from './xlsx'

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

/** Lo que llega del renderer no es confiable: se saca en limpio antes de tocar la base. */
export function sanearFiltrosDeDeudores(bruto: unknown): FiltrosDeudores {
  const datos = (bruto ?? {}) as Partial<FiltrosDeudores>
  const lista = (valores: unknown): string[] =>
    Array.isArray(valores) ? [...new Set(valores.map((v) => limpiar(v)).filter((v) => v !== ''))] : []
  const dias = Array.isArray(datos.dias)
    ? [...new Set(datos.dias.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b)
    : []
  const periodo = limpiar(datos.periodo)
  return {
    ...DEUDORES_SIN_FILTROS,
    periodo: /^\d{4}-\d{2}$/.test(periodo) ? periodo : '',
    sucursales: lista(datos.sucursales),
    companias: lista(datos.companias),
    formasDePago: lista(datos.formasDePago),
    dias,
    incluirDebito: datos.incluirDebito === true,
  }
}

/** Alguno de los valores tildados es el mismo texto que el de la fila (sin tildes ni mayúsculas). */
function estaEntre(valor: string | null, tildados: string[]): boolean {
  if (tildados.length === 0) return true
  const normalizado = normalizarTexto(valor)
  return tildados.some((tildado) => normalizarTexto(tildado) === normalizado)
}

function aDia(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1) / 86_400_000)
}

function aFilaDeudor(fila: FilaCartera, hoy: string): FilaDeudor {
  const vencimiento = fechaDeVencimiento(fila.periodo, fila.diaVencimientoNumero)
  const diasDeAtraso = vencimiento ? aDia(hoy) - aDia(vencimiento) : null
  return {
    filaId: fila.filaId,
    periodo: fila.periodo,
    clienteId: fila.clienteId,
    nombre: fila.nombre,
    documento: fila.documento,
    telefono: fila.telefono,
    email: fila.email,
    sucursal: fila.sucursal,
    compania: fila.compania,
    numeroPoliza: fila.numeroPoliza,
    patente: fila.patente,
    cuota: fila.cuota,
    cuotaMonto: fila.cuotaMonto,
    formaPago: fila.formaPago,
    diaVencimiento: fila.diaVencimientoNumero,
    vencimiento,
    diasDeAtraso,
    vencida: diasDeAtraso !== null && diasDeAtraso > 0,
    seCobraSola: esDebitoAutomatico(fila.formaPago),
  }
}

// ---------------------------------------------------------------------------
// La búsqueda
// ---------------------------------------------------------------------------

/** Valores distintos, sin repetir por mayúsculas ni tildes, ordenados en castellano. */
function distintos(valores: Array<string | null>): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valores) {
    const limpio = limpiar(valor)
    if (!limpio) continue
    const clave = normalizarTexto(limpio)
    if (!vistos.has(clave)) vistos.set(clave, limpio)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

interface Relevamiento {
  /** Las impagas que pasan todos los filtros menos el de los días. */
  filas: FilaDeudor[]
  sucursales: string[]
  companias: string[]
  formasDePago: string[]
}

/**
 * Una sola pasada por las cuotas impagas del período: de ahí salen las filas filtradas y las listas
 * de los desplegables.
 *
 * Las listas se arman ANTES de aplicar ningún filtro, incluido el de las que se cobran solas. Si se
 * armaran después, TARJETA no aparecería nunca para tildar —queda afuera por omisión— y no habría
 * forma de pedir justamente las tarjetas que no entraron.
 */
function relevar(filtros: FiltrosDeudores, hoy: string): Relevamiento {
  const dias = diasCoberturaPorCompania()
  const crudas = db()
    .prepare(
      `${SELECT_PLANILLA}
       WHERE c.dada_de_baja = 0
         AND (c.pago IS NULL OR TRIM(c.pago) = '')
         AND COALESCE(p.activa, 1) = 1
         AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.poliza_id = c.poliza_id AND pg.periodo = c.periodo)
         AND (@periodo IS NULL OR c.periodo = @periodo)`,
    )
    .all({ periodo: filtros.periodo || null }) as FilaCruda[]

  const filas: FilaDeudor[] = []
  const todas: FilaCartera[] = []
  for (const cruda of crudas) {
    const fila = aFila(cruda, dias)
    // Un pago registrado desde la aplicación puede no haber escrito todavía CUANDO PAGO en la fila.
    if (fila.pagoRegistrado) continue
    todas.push(fila)
    if (!estaEntre(fila.sucursal, filtros.sucursales)) continue
    if (!estaEntre(fila.compania, filtros.companias)) continue
    if (filtros.formasDePago.length > 0) {
      // Lo tildado manda: pedir TARJETA es querer ver justamente las tarjetas que no entraron.
      if (!estaEntre(fila.formaPago, filtros.formasDePago)) continue
    } else if (!filtros.incluirDebito && esDebitoAutomatico(fila.formaPago)) {
      continue
    }
    filas.push(aFilaDeudor(fila, hoy))
  }

  return {
    filas,
    sucursales: distintos(todas.map((fila) => fila.sucursal)),
    companias: distintos(todas.map((fila) => fila.compania)),
    formasDePago: distintos(todas.map((fila) => fila.formaPago)),
  }
}

/** `hoy` es sólo para que las pruebas sean deterministas; el IPC nunca lo pasa. */
export function buscarDeudores(bruto: FiltrosDeudores, hoy = hoyLocal()): ListadoDeudores {
  const filtros = sanearFiltrosDeDeudores(bruto)
  const periodos = periodosDisponibles()
  const relevamiento = relevar(filtros, hoy)
  const todas = relevamiento.filas

  const porDia = new Array<number>(32).fill(0)
  let sinDia = 0
  for (const fila of todas) {
    if (fila.diaVencimiento === null) sinDia++
    else porDia[fila.diaVencimiento] = (porDia[fila.diaVencimiento] ?? 0) + 1
  }

  const filas = (
    filtros.dias.length === 0 ? todas : todas.filter((fila) => fila.diaVencimiento !== null && filtros.dias.includes(fila.diaVencimiento))
  ).sort(
    (a, b) =>
      (a.diaVencimiento ?? 99) - (b.diaVencimiento ?? 99) ||
      a.periodo.localeCompare(b.periodo) ||
      (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'),
  )

  // Una persona con dos pólizas atrasadas es una sola persona a la que llamar: se cuenta por cliente
  // y, cuando la fila no quedó enganchada a ninguna ficha, por su documento o su nombre.
  const personas = new Set(filas.map((fila) => (fila.clienteId !== null ? `#${fila.clienteId}` : normalizarTexto(fila.documento || fila.nombre))))

  return {
    filas,
    clientes: personas.size,
    total: filas.reduce((suma, fila) => suma + (fila.cuotaMonto ?? 0), 0),
    sinImporte: filas.filter((fila) => fila.cuotaMonto === null).length,
    sinDia,
    porDia,
    periodo: filtros.periodo,
    periodos,
    sucursales: relevamiento.sucursales,
    companias: relevamiento.companias,
    formasDePago: relevamiento.formasDePago,
    hoy,
  }
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

const COLUMNAS: Array<{ titulo: string; ancho: number; valor: (fila: FilaDeudor) => ValorDeCelda }> = [
  { titulo: 'Cliente', ancho: 30, valor: (f) => f.nombre },
  { titulo: 'DNI/CUIT', ancho: 15, valor: (f) => f.documento },
  { titulo: 'Teléfono', ancho: 16, valor: (f) => f.telefono },
  { titulo: 'Sucursal', ancho: 14, valor: (f) => f.sucursal },
  { titulo: 'Compañía', ancho: 20, valor: (f) => f.compania },
  { titulo: 'Póliza', ancho: 16, valor: (f) => f.numeroPoliza },
  { titulo: 'Patente', ancho: 11, valor: (f) => f.patente },
  { titulo: 'Forma de pago', ancho: 16, valor: (f) => f.formaPago },
  { titulo: 'Día', ancho: 6, valor: (f) => f.diaVencimiento },
  { titulo: 'Vence', ancho: 12, valor: (f) => (f.vencimiento ? comoTextoDeFecha(f.vencimiento) : null) },
  { titulo: 'Cuota', ancho: 13, valor: (f) => f.cuotaMonto ?? f.cuota },
  { titulo: 'Mes', ancho: 14, valor: (f) => nombreDePeriodo(f.periodo) },
  { titulo: 'Estado', ancho: 22, valor: (f) => textoDelAtraso(f) },
]

function textoDelAtraso(fila: FilaDeudor): string {
  if (fila.diasDeAtraso === null) return 'Sin día de vencimiento'
  if (fila.diasDeAtraso > 0) return `Vencida hace ${fila.diasDeAtraso} ${fila.diasDeAtraso === 1 ? 'día' : 'días'}`
  if (fila.diasDeAtraso === 0) return 'Vence hoy'
  return `Vence en ${-fila.diasDeAtraso} ${fila.diasDeAtraso === -1 ? 'día' : 'días'}`
}

function importe(valor: number): string {
  return `$ ${valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Una línea que cuenta con qué filtros se armó el listado: sin eso, el archivo no se puede leer solo. */
function lineaDeFiltros(filtros: FiltrosDeudores): string {
  const partes: string[] = []
  partes.push(filtros.periodo ? nombreDePeriodo(filtros.periodo) : 'Todos los meses')
  if (filtros.sucursales.length > 0) partes.push(`Sucursal: ${filtros.sucursales.join(', ')}`)
  if (filtros.companias.length > 0) partes.push(`Compañía: ${filtros.companias.join(', ')}`)
  if (filtros.formasDePago.length > 0) partes.push(`Forma de pago: ${filtros.formasDePago.join(', ')}`)
  if (filtros.dias.length > 0) partes.push(`Vencen el ${filtros.dias.join(', ')}`)
  if (filtros.formasDePago.length === 0 && !filtros.incluirDebito) partes.push('Sin las que se cobran solas')
  return partes.join(' · ')
}

function nombreDelArchivo(filtros: FiltrosDeudores, extension: string): string {
  const mes = filtros.periodo || 'todos-los-meses'
  const sucursal = filtros.sucursales.length === 1 ? `-${paraNombreDeArchivo(filtros.sucursales[0]!)}` : ''
  return `deudores-${mes}${sucursal}.${extension}`.replace(/\s+/g, '-')
}

/**
 * El .txt va en columnas de ancho fijo, no separado por tabulaciones: se imprime, se lee en el Bloc de
 * notas y se manda por mensaje sin que se desarme. Lo que hay que trabajar en Excel es el .xlsx.
 */
function txtDeDeudores(listado: ListadoDeudores, filtros: FiltrosDeudores): string {
  const recortar = (valor: ValorDeCelda, ancho: number): string => {
    const texto = valor === null ? '' : String(valor)
    return (texto.length > ancho ? `${texto.slice(0, ancho - 1)}…` : texto).padEnd(ancho)
  }
  const anchos = COLUMNAS.map((columna) => Math.max(columna.ancho, columna.titulo.length))
  const lineas: string[] = []
  lineas.push('LISTADO DE DEUDORES')
  lineas.push(lineaDeFiltros(filtros))
  lineas.push(`Generado el ${comoTextoDeFecha(listado.hoy)}`)
  lineas.push('')
  lineas.push(COLUMNAS.map((columna, i) => recortar(columna.titulo, anchos[i]!)).join('  ').trimEnd())
  lineas.push(anchos.map((ancho) => '-'.repeat(ancho)).join('  '))
  for (const fila of listado.filas) {
    lineas.push(
      COLUMNAS.map((columna, i) => {
        const valor = columna.valor(fila)
        return recortar(typeof valor === 'number' && columna.titulo === 'Cuota' ? importe(valor) : valor, anchos[i]!)
      })
        .join('  ')
        .trimEnd(),
    )
  }
  if (listado.filas.length === 0) lineas.push('(No hay deudas con esos filtros.)')
  lineas.push('')
  lineas.push(`${listado.filas.length} deuda(s) de ${listado.clientes} cliente(s). Total: ${importe(listado.total)}.`)
  if (listado.sinImporte > 0) lineas.push(`${listado.sinImporte} sin importe numérico: no suman al total.`)
  // El .txt lo abre el Bloc de notas de Windows: fin de línea CRLF o sale todo pegado en un renglón.
  return `${lineas.join('\r\n')}\r\n`
}

function xlsxDeDeudores(listado: ListadoDeudores, filtros: FiltrosDeudores): Buffer {
  return construirXlsx([
    {
      nombre: 'Deudores',
      titulo: `Deudores · ${lineaDeFiltros(filtros)}`,
      encabezados: COLUMNAS.map((columna) => columna.titulo),
      anchos: COLUMNAS.map((columna) => columna.ancho),
      filas: listado.filas.map((fila) => COLUMNAS.map((columna) => columna.valor(fila))),
    },
  ])
}

export interface ArchivoDeDeudores {
  nombre: string
  contenido: string | Buffer
  descripcion: string
}

export function archivoDeDeudores(bruto: FiltrosDeudores, formato: FormatoDeDeudores, hoy = hoyLocal()): ArchivoDeDeudores {
  const elegido = FORMATOS_DE_DEUDORES.includes(formato) ? formato : 'xlsx'
  const filtros = sanearFiltrosDeDeudores(bruto)
  const listado = buscarDeudores(filtros, hoy)
  if (elegido === 'txt') {
    return { nombre: nombreDelArchivo(filtros, 'txt'), contenido: txtDeDeudores(listado, filtros), descripcion: 'Archivo de texto' }
  }
  return { nombre: nombreDelArchivo(filtros, 'xlsx'), contenido: xlsxDeDeudores(listado, filtros), descripcion: 'Planilla de Excel' }
}
