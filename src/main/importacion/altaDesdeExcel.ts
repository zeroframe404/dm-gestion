// El corazón PURO del «Alta desde Excel»: del Excel de otra agencia (ya leído, ver lectorDeLibro.ts) y
// de lo que la persona eligió en el asistente (qué es cada hoja, qué campo es cada columna) → las
// pestañas en el formato de la base, con los encabezados que el importador reconoce.
//
// La idea es no tocar el importador ni la sincronización: en vez de enseñarles otro formato, el Excel
// ajeno se TRADUCE al de siempre —una planilla mensual con el mes actual de título, «BAJAS <mes>»,
// «SINIESTROS», «IMPUTADOS», «RIESGOS VARIOS»— y entra por el mismo camino que la migración desde
// Google. Después del alta, la base de esa agencia es igual a cualquier otra.
import type {
  AsignacionDeAlta,
  AsignacionDeHoja,
  CampoDeAlta,
  HojaDeAltaVista,
  RequisitoDeAlta,
  TipoDeHojaDeAlta,
  TipoPestana,
} from '../../shared/tipos'
import { ETIQUETA_DE_HOJA_DE_ALTA, TIPOS_DE_HOJA_DE_ALTA } from '../../shared/tipos'
import { camposDelTipo, encabezadoParaAgregar, mapearEncabezados, repiteEncabezados, type Campo } from './encabezados'
import type { HojaLeida, LibroLeido } from './lectorDeLibro'
import { FILAS_PARA_ENCABEZADOS } from './layouts'
import { limpiar, normalizarTexto } from './normalizar'
import { clasificarPestana, MESES } from './pestanas'

/** El tipo de pestaña de la base que corresponde a cada tipo de hoja del alta. */
export const TIPO_DE_PESTANA: Record<TipoDeHojaDeAlta, TipoPestana> = {
  CARTERA: 'MENSUAL',
  BAJAS: 'BAJAS',
  SINIESTROS: 'SINIESTROS',
  PAGOS: 'PAGOS',
  RIESGOS_VARIOS: 'RIESGOS_VARIOS',
}

/** Campos que son de la aplicación (los escribe ella sola): no tiene sentido traerlos de otro Excel. */
const CAMPOS_DE_LA_APP = new Set<Campo>(['usuario', 'cobro', 'ticket', 'revisado', 'resultado'])

/** Cómo se llama cada campo en la pantalla. Lo que no está acá se muestra con su encabezado. */
const ETIQUETAS: Partial<Record<Campo, string>> = {
  nombre: 'Nombre y apellido',
  documento: 'DNI / CUIT',
  telefono: 'Teléfono',
  email: 'Email',
  direccion: 'Dirección',
  localidad: 'Localidad',
  provincia: 'Provincia',
  codigo_postal: 'Código postal',
  sucursal: 'Sucursal',
  fecha_nacimiento: 'Fecha de nacimiento',
  compania: 'Compañía',
  numero_poliza: 'Número de póliza',
  cobertura: 'Cobertura',
  prima: 'Prima',
  forma_pago: 'Forma de pago',
  productor: 'Productor',
  estado: 'Estado',
  vigencia_desde: 'Vigencia desde',
  vigencia_hasta: 'Vigencia hasta',
  alta: 'Fecha de alta',
  cuota: 'Cuota (importe)',
  dia_vencimiento: 'Día de vencimiento',
  aviso: 'Aviso',
  fecha_envio: 'Fecha de envío',
  avisar_vto: 'Avisar vencimiento',
  pago: 'Fecha de pago',
  observaciones: 'Observaciones',
  obs_pago: 'Nota del pago',
  marca: 'Marca',
  modelo: 'Modelo',
  anio: 'Año',
  patente: 'Patente',
  motor: 'Motor',
  chasis: 'Chasis',
  tipo_vehiculo: 'Tipo de vehículo (auto, moto…)',
  uso: 'Uso',
  color: 'Color',
  suma_asegurada: 'Suma asegurada',
  motivo: 'Motivo',
  fecha_baja: 'Fecha de baja',
  mes: 'Mes',
  tipo_riesgo: 'Tipo de riesgo',
  fecha: 'Fecha',
  fecha_carga: 'Fecha de carga',
  emision: 'Fecha de emisión',
  numero_siniestro: 'Número de siniestro',
  descripcion: 'Descripción',
  importe: 'Importe',
  medio_pago: 'Medio de pago',
  abogado: 'Abogado',
  tercero_compania: 'Compañía del tercero',
  tercero_telefono: 'Teléfono del tercero',
  tercero_patente: 'Patente del tercero',
  tercero_lesionados: 'Lesionados',
  tercero_lesionados_detalle: 'Detalle de lesionados',
}

const ETIQUETAS_POR_TIPO: Partial<Record<TipoDeHojaDeAlta, Partial<Record<Campo, string>>>> = {
  SINIESTROS: { fecha: 'Fecha del siniestro' },
  PAGOS: { fecha: 'Fecha del pago', mes: 'Mes que paga', cuota: 'Cuota que paga' },
}

/** Los campos que se le ofrecen a la persona para un tipo de hoja, en el orden de siempre. */
export function camposDeAlta(tipo: TipoDeHojaDeAlta): CampoDeAlta[] {
  return camposDelTipo(TIPO_DE_PESTANA[tipo])
    .filter((campo) => !CAMPOS_DE_LA_APP.has(campo))
    .filter((campo) => encabezadoParaAgregar(campo, TIPO_DE_PESTANA[tipo], []) !== null)
    .map((campo) => ({
      campo,
      etiqueta: ETIQUETAS_POR_TIPO[tipo]?.[campo] ?? ETIQUETAS[campo] ?? encabezadoParaAgregar(campo, TIPO_DE_PESTANA[tipo], []) ?? campo,
    }))
}

/** Qué tiene que tener cada tipo de hoja. Lo obligatorio frena la publicación; lo demás es un aviso. */
export const REQUISITOS: Record<TipoDeHojaDeAlta, RequisitoDeAlta[]> = {
  CARTERA: [
    { campos: ['nombre', 'documento'], texto: 'el nombre o el DNI del cliente', obligatorio: true },
    { campos: ['compania'], texto: 'la compañía', obligatorio: false },
    { campos: ['numero_poliza', 'patente'], texto: 'el número de póliza o la patente (sin eso no se distinguen dos seguros del mismo cliente)', obligatorio: false },
    { campos: ['cuota'], texto: 'la cuota, para Cobranzas', obligatorio: false },
    { campos: ['dia_vencimiento'], texto: 'el día de vencimiento, para Cobranzas', obligatorio: false },
    { campos: ['sucursal'], texto: 'la sucursal (si es una sola, ponela como valor fijo)', obligatorio: false },
  ],
  BAJAS: [
    { campos: ['nombre', 'documento', 'numero_poliza', 'patente'], texto: 'el nombre, el DNI, la póliza o la patente', obligatorio: true },
    { campos: ['fecha_baja'], texto: 'la fecha de baja', obligatorio: false },
  ],
  SINIESTROS: [
    { campos: ['nombre', 'documento', 'numero_poliza', 'patente'], texto: 'el asegurado, su DNI, la póliza o la patente', obligatorio: true },
    { campos: ['fecha'], texto: 'la fecha del siniestro', obligatorio: false },
  ],
  PAGOS: [
    { campos: ['fecha'], texto: 'la fecha del pago', obligatorio: true },
    { campos: ['importe'], texto: 'el importe', obligatorio: true },
    { campos: ['nombre', 'documento', 'numero_poliza', 'patente'], texto: 'quién pagó (nombre, DNI, póliza o patente)', obligatorio: false },
  ],
  RIESGOS_VARIOS: [
    { campos: ['nombre', 'documento'], texto: 'el nombre o el DNI del cliente', obligatorio: true },
    { campos: ['compania'], texto: 'la compañía', obligatorio: false },
  ],
}

// ---------------------------------------------------------------------------
// La propuesta inicial
// ---------------------------------------------------------------------------

const FILAS_DE_MUESTRA = 40

export function vistaDeHoja(hoja: HojaLeida, indice: number): HojaDeAltaVista {
  return {
    indice,
    nombre: hoja.nombre,
    oculta: hoja.oculta,
    totalFilas: hoja.filas.length,
    totalColumnas: hoja.filas.reduce((maximo, fila) => Math.max(maximo, fila.length), 0),
    muestra: hoja.filas.slice(0, FILAS_DE_MUESTRA),
  }
}

/** La fila (de las primeras 8) que más campos reconoce como encabezados de ese tipo, y cuántos. */
export function mejorFilaDeEncabezados(filas: string[][], tipo: TipoDeHojaDeAlta): { fila: number; reconocidos: number } {
  let mejor = { fila: 0, reconocidos: -1 }
  for (let r = 0; r < Math.min(filas.length, FILAS_PARA_ENCABEZADOS); r++) {
    const reconocidos = mapearEncabezados(filas[r] ?? [], TIPO_DE_PESTANA[tipo]).porCampo.size
    if (reconocidos > mejor.reconocidos) mejor = { fila: r, reconocidos }
  }
  return { fila: mejor.fila, reconocidos: Math.max(0, mejor.reconocidos) }
}

/** Qué campo es cada columna según su encabezado (lo que el importador ya reconoce solo). */
export function columnasSugeridas(encabezados: string[], tipo: TipoDeHojaDeAlta): Array<string | null> {
  const ofrecidos = new Set(camposDeAlta(tipo).map((c) => c.campo))
  const mapeo = mapearEncabezados(encabezados, TIPO_DE_PESTANA[tipo])
  return encabezados.map((_, indice) => {
    const campo = mapeo.columnas[indice]?.campo
    return campo && ofrecidos.has(campo) ? campo : null
  })
}

function tipoDeAltaDesdePestana(tipo: TipoPestana): TipoDeHojaDeAlta | null {
  for (const candidato of TIPOS_DE_HOJA_DE_ALTA) if (TIPO_DE_PESTANA[candidato] === tipo) return candidato
  return null
}

/**
 * Lo que el programa entiende solo de cada hoja: por el nombre de la hoja si dice algo («Bajas»,
 * «Siniestros», un mes), si no por cuántos encabezados reconoce. Una hoja oculta o que no se parece a
 * nada queda en «no importar».
 */
export function sugerirHoja(hoja: HojaLeida, indice: number): AsignacionDeHoja {
  const porNombre = tipoDeAltaDesdePestana(clasificarPestana(hoja.nombre).tipo)
  let tipo: TipoDeHojaDeAlta | null = porNombre
  let fila = 0
  if (tipo) {
    fila = mejorFilaDeEncabezados(hoja.filas, tipo).fila
  } else {
    // Sin pista en el nombre: el tipo que más encabezados reconoce. Con empate gana la cartera, que es
    // lo que casi siempre es la hoja principal de otra agencia.
    let mejor: { tipo: TipoDeHojaDeAlta; fila: number; reconocidos: number } | null = null
    for (const candidato of TIPOS_DE_HOJA_DE_ALTA) {
      const { fila: f, reconocidos } = mejorFilaDeEncabezados(hoja.filas, candidato)
      if (!mejor || reconocidos > mejor.reconocidos) mejor = { tipo: candidato, fila: f, reconocidos }
    }
    if (mejor && mejor.reconocidos >= 3 && !hoja.oculta) {
      tipo = mejor.tipo
      fila = mejor.fila
    } else {
      fila = mejor?.fila ?? 0
    }
  }
  const encabezados = hoja.filas[fila] ?? []
  return {
    indice,
    tipo,
    filaEncabezados: fila,
    columnas: tipo ? columnasSugeridas(encabezados, tipo) : encabezados.map(() => null),
    fijos: {},
  }
}

export function sugerirAsignacion(libro: LibroLeido, token: string): AsignacionDeAlta {
  return { token, hojas: libro.hojas.map((hoja, indice) => sugerirHoja(hoja, indice)), sucursales: {} }
}

// ---------------------------------------------------------------------------
// El armado de las pestañas
// ---------------------------------------------------------------------------

/** Campos de texto en los que dos columnas se juntan (APELLIDO + NOMBRE, dos teléfonos, dos observaciones). */
const CAMPOS_QUE_SE_JUNTAN = new Set<Campo>(['nombre', 'direccion', 'telefono', 'email', 'observaciones', 'obs_pago', 'descripcion', 'motivo', 'cobertura'])

const SEPARADOR_AL_JUNTAR: Partial<Record<Campo, string>> = { nombre: ' ', direccion: ' ' }

export interface PestanaArmada {
  titulo: string
  tipo: TipoDeHojaDeAlta
  valores: string[][]
}

export interface ResultadoDelArmado {
  pestanas: PestanaArmada[]
  avisos: string[]
  /** Lo que falta y es obligatorio: mientras haya algo acá no se publica. */
  faltantes: string[]
  /** Valores de sucursal tal como vienen en el Excel (antes de corregirlos), con cuántas filas los usan. */
  valoresDeSucursal: Map<string, number>
}

/** El título de la pestaña de cada tipo. La cartera lleva el mes de hoy: es la planilla del mes. */
export function tituloDePestana(tipo: TipoDeHojaDeAlta, hoy: Date): string {
  const mes = `${MESES[hoy.getMonth()]} ${hoy.getFullYear()}`
  switch (tipo) {
    case 'CARTERA':
      return mes
    case 'BAJAS':
      return `BAJAS ${mes}`
    case 'SINIESTROS':
      return 'SINIESTROS'
    case 'PAGOS':
      return 'IMPUTADOS'
    case 'RIESGOS_VARIOS':
      return 'RIESGOS VARIOS'
  }
}

function juntar(campo: Campo, valores: string[]): string {
  const distintos: string[] = []
  for (const valor of valores) {
    const limpio = limpiar(valor)
    if (limpio && !distintos.some((d) => normalizarTexto(d) === normalizarTexto(limpio))) distintos.push(limpio)
  }
  if (distintos.length === 0) return ''
  // Los demás campos no se pueden juntar: se usa la primera columna que tenga algo (DNI o, si no, CUIT).
  if (!CAMPOS_QUE_SE_JUNTAN.has(campo)) return distintos[0]!
  return distintos.join(SEPARADOR_AL_JUNTAR[campo] ?? ' / ')
}

/** La clave con la que se corrige una sucursal: el texto tal cual, sin espacios de más. */
export function claveDeValorDeSucursal(valor: string): string {
  return limpiar(valor).replace(/\s+/g, ' ')
}

/**
 * Arma las pestañas. Las hojas del mismo tipo se juntan en una sola (por ejemplo, una cartera por
 * sucursal). Los valores pasan tal cual: el importador ya sabe leer fechas, importes y documentos.
 */
export function armarPestanasCanonicas(libro: LibroLeido, asignacion: AsignacionDeAlta, hoy = new Date()): ResultadoDelArmado {
  const avisos: string[] = []
  const faltantes: string[] = []
  const valoresDeSucursal = new Map<string, number>()
  const pestanas: PestanaArmada[] = []
  const correccionDeSucursal = new Map(Object.entries(asignacion.sucursales ?? {}).map(([valor, destino]) => [claveDeValorDeSucursal(valor), limpiar(destino)]))

  for (const tipo of TIPOS_DE_HOJA_DE_ALTA) {
    const tipoPestana = TIPO_DE_PESTANA[tipo]
    const ofrecidos = new Set(camposDeAlta(tipo).map((c) => c.campo))
    const hojas = asignacion.hojas
      .filter((h) => h.tipo === tipo)
      .map((h) => ({ asignacion: h, hoja: libro.hojas[h.indice] }))
      .filter((h): h is { asignacion: AsignacionDeHoja; hoja: HojaLeida } => !!h.hoja)
    if (hojas.length === 0) continue
    const nombres = hojas.map((h) => `«${h.hoja.nombre}»`).join(', ')

    // Los campos que trae alguna de las hojas (por columna o por valor fijo), en el orden de siempre.
    const usados = new Set<Campo>()
    for (const { asignacion: a } of hojas) {
      for (const campo of a.columnas) if (campo && ofrecidos.has(campo)) usados.add(campo as Campo)
      for (const [campo, valor] of Object.entries(a.fijos ?? {})) if (limpiar(valor) && ofrecidos.has(campo)) usados.add(campo as Campo)
    }
    const campos: Campo[] = []
    const encabezados: string[] = []
    for (const campo of camposDelTipo(tipoPestana)) {
      if (!usados.has(campo)) continue
      const encabezado = encabezadoParaAgregar(campo, tipoPestana, encabezados)
      if (!encabezado) {
        avisos.push(`${ETIQUETA_DE_HOJA_DE_ALTA[tipo]}: el campo «${ETIQUETAS[campo] ?? campo}» no se puede guardar junto con los otros elegidos y se deja afuera.`)
        continue
      }
      campos.push(campo)
      encabezados.push(encabezado)
    }

    for (const requisito of REQUISITOS[tipo]) {
      if (requisito.campos.some((c) => campos.includes(c as Campo))) continue
      const texto = `${ETIQUETA_DE_HOJA_DE_ALTA[tipo]} (${nombres}): falta ${requisito.texto}.`
      if (requisito.obligatorio) faltantes.push(texto)
      else avisos.push(texto)
    }
    if (campos.length === 0) continue

    const valores: string[][] = [encabezados]
    for (const { asignacion: a, hoja } of hojas) {
      const filaDeEncabezados = hoja.filas[a.filaEncabezados] ?? []
      const columnasPorCampo = new Map<Campo, number[]>()
      a.columnas.forEach((campo, indice) => {
        if (!campo || !ofrecidos.has(campo)) return
        columnasPorCampo.set(campo as Campo, [...(columnasPorCampo.get(campo as Campo) ?? []), indice])
      })
      let agregadas = 0
      for (let r = a.filaEncabezados + 1; r < hoja.filas.length; r++) {
        const fila = hoja.filas[r] ?? []
        if (!fila.some((v) => limpiar(v) !== '')) continue
        // Una hoja hecha de varias pegadas suele repetir la fila de encabezados en el medio.
        if (filaDeEncabezados.length > 0 && repiteEncabezados(fila, filaDeEncabezados)) continue
        const propios = campos.map((campo) => juntar(campo, (columnasPorCampo.get(campo) ?? []).map((i) => fila[i] ?? '')))
        // Una fila que no trae nada de lo elegido (un total, una línea de notas al pie) no es un registro.
        if (!propios.some((v) => v !== '')) continue
        const salida = propios.map((valor, i) => {
          const campo = campos[i]!
          let final = valor || limpiar(a.fijos?.[campo] ?? '')
          if (campo === 'sucursal' && final) {
            const clave = claveDeValorDeSucursal(final)
            valoresDeSucursal.set(clave, (valoresDeSucursal.get(clave) ?? 0) + 1)
            final = correccionDeSucursal.get(clave) || final
          }
          return final
        })
        valores.push(salida)
        agregadas++
      }
      if (agregadas === 0) avisos.push(`La hoja «${hoja.nombre}» no tiene filas con datos debajo de los encabezados.`)
    }
    if (valores.length === 1) continue
    pestanas.push({ titulo: tituloDePestana(tipo, hoy), tipo, valores })
  }

  if (pestanas.length === 0 && faltantes.length === 0) faltantes.push('No hay ninguna hoja para importar: elegí qué tiene al menos una.')
  return { pestanas, avisos, faltantes, valoresDeSucursal }
}
