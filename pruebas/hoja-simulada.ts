// Hoja de cálculo simulada en memoria: implementa `FuenteHoja` igual que Google Sheets, incluidas sus
// mañas (filas y celdas vacías del final que la API NO devuelve, grilla con ancho fijo, columnas ocultas).
// Sirve para probar el importador entero sin tocar ninguna hoja real.
import type {
  CeldaAEscribir,
  EstructuraHoja,
  FilaABorrar,
  FuenteHoja,
  LecturaDePestana,
  PestanaDeHoja,
  ResultadoDeAgregado,
  ResultadoDeBorrado,
  ResultadoDeCeldas,
  ResultadoDeTramos,
  TramoDeColumna,
} from '../src/main/importacion/fuente'
import type { AlmacenDeAdjuntos, ArchivoBajado, FichaParaElAlmacen } from '../src/main/servicios/adjuntos'
import { ErrorDeNegocio } from '../src/main/servicios/errores'

export interface PestanaSimulada {
  titulo: string
  /** Filas tal cual se ven en la hoja (la 1 son los encabezados). */
  valores: string[][]
  /** Ancho de la grilla (columnCount de Google). Por defecto, 26 como una hoja nueva. */
  columnas?: number
  /** La pestaña está oculta en Google. */
  oculta?: boolean
}

export interface PestanaInterna {
  sheetId: number
  titulo: string
  indice: number
  columnas: number
  valores: string[][]
  ocultas: Set<number>
  oculta: boolean
}

/** Recorta las celdas vacías del final: la API de Google devuelve filas de largo desparejo. */
function recortarFila(fila: string[]): string[] {
  const copia = [...fila]
  while (copia.length > 0 && (copia[copia.length - 1] ?? '') === '') copia.pop()
  return copia
}

export interface OpcionesHojaSimulada {
  titulo?: string
  hojaId?: string
  /** Simula una cuenta de servicio con permiso de sólo lectura. */
  soloLectura?: boolean
}

export class HojaSimulada implements FuenteHoja, AlmacenDeAdjuntos {
  readonly hojaId: string
  readonly titulo: string
  private readonly pestanas: PestanaInterna[] = []
  private readonly soloLectura: boolean
  /** Contador de llamadas, para verificar que no se pide dos veces lo mismo. */
  readonly llamadas = { estructura: 0, leerValores: 0, asegurarColumnas: 0, escribirColumna: 0, ocultarColumna: 0, leerVarias: 0, escribirCeldas: 0, agregarFilas: 0, borrarFilas: 0, crearPestana: 0 }
  /** false = sin internet: todas las llamadas fallan como en la vida real. */
  private conectada = true
  /** El almacén de adjuntos del VPS, en memoria: id → ficha + bytes (12.6). */
  readonly almacen = new Map<string, { ficha: FichaParaElAlmacen; contenido: Buffer }>()
  /** Si está puesto, la próxima subida falla con este error (para probar los reintentos). */
  fallaDeSubida: Error | null = null

  constructor(pestanas: PestanaSimulada[], opciones: OpcionesHojaSimulada = {}) {
    this.hojaId = opciones.hojaId ?? '1PRUEBAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    this.titulo = opciones.titulo ?? 'GENERAL DE CLIENTES (PRUEBA)'
    this.soloLectura = opciones.soloLectura ?? false
    pestanas.forEach((p, indice) => {
      const ancho = Math.max(p.columnas ?? 26, ...p.valores.map((f) => f.length))
      this.pestanas.push({
        sheetId: 100 + indice,
        titulo: p.titulo,
        indice,
        columnas: ancho,
        valores: p.valores.map((fila) => [...fila]),
        ocultas: new Set(),
        oculta: p.oculta ?? false,
      })
    })
  }

  private buscarPorTitulo(titulo: string): PestanaInterna {
    const p = this.pestanas.find((x) => x.titulo === titulo)
    if (!p) throw new Error(`Unable to parse range: '${titulo}'!A1:ZZ`)
    return p
  }

  private buscarPorId(sheetId: number): PestanaInterna {
    const p = this.pestanas.find((x) => x.sheetId === sheetId)
    if (!p) throw new Error(`No sheet with id: ${sheetId}`)
    return p
  }

  // --- Renglones identificados por _ID (la misma semántica que la base del VPS, 12.6) -------------

  /** La columna del _ID de una pestaña: la que dice quien llama, si no la del encabezado «_ID». */
  private columnaIdInterna(p: PestanaInterna, pedida?: number | null): number | null {
    if (Number.isInteger(pedida) && (pedida as number) >= 0) return pedida as number
    for (const fila of p.valores.slice(0, 5)) {
      const indice = fila.findIndex((celda) => (celda ?? '').trim().toUpperCase() === '_ID')
      if (indice >= 0) return indice
    }
    return null
  }

  /** El primer renglón (base 1) que lleva cada _ID. */
  private renglonesPorId(p: PestanaInterna, columnaId: number): Map<string, number> {
    const mapa = new Map<string, number>()
    p.valores.forEach((fila, indice) => {
      const id = (fila[columnaId] ?? '').trim()
      if (id && !mapa.has(id)) mapa.set(id, indice + 1)
    })
    return mapa
  }

  /** A qué renglón apunta de verdad un {numero, id}: al número si sigue llevando ese _ID, si no al que lo lleva hoy. */
  private resolverRenglon(p: PestanaInterna, numero: number, id: string, columnaId: number | null): number | null {
    if (!id || columnaId === null) return numero
    if (((p.valores[numero - 1] ?? [])[columnaId] ?? '').trim() === id) return numero
    return this.renglonesPorId(p, columnaId).get(id) ?? null
  }

  async estructura(): Promise<EstructuraHoja> {
    this.llamadas.estructura++
    this.exigirConexion()
    const pestanas: PestanaDeHoja[] = this.pestanas.map((p) => ({
      sheetId: p.sheetId,
      titulo: p.titulo,
      indice: p.indice,
      filas: Math.max(p.valores.length, 1000),
      columnas: p.columnas,
      oculta: p.oculta,
    }))
    return { hojaId: this.hojaId, titulo: this.titulo, pestanas }
  }

  async leerValores(titulo: string): Promise<string[][]> {
    this.llamadas.leerValores++
    this.exigirConexion()
    return this.valoresDe(titulo)
  }

  async leerPrimerasFilas(titulo: string, cantidad: number): Promise<string[][]> {
    return (await this.leerValores(titulo)).slice(0, cantidad)
  }

  async asegurarColumnas(sheetId: number, cantidad: number): Promise<void> {
    this.llamadas.asegurarColumnas++
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    const p = this.buscarPorId(sheetId)
    if (cantidad > p.columnas) p.columnas = cantidad
  }

  async escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<ResultadoDeTramos> {
    this.llamadas.escribirColumna++
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    const p = this.buscarPorTitulo(titulo)
    if (indiceColumna >= p.columnas) {
      throw Object.assign(new Error(`Range ('${titulo}'!) exceeds grid limits`), { status: 400 })
    }
    const saltadas: number[] = []
    for (const tramo of tramos) {
      tramo.valores.forEach((valor, desplazamiento) => {
        const fila = tramo.fila - 1 + desplazamiento
        // Con `previos`, se escribe sólo la celda que sigue diciendo lo que se vio (como la base del VPS).
        if (Array.isArray(tramo.previos)) {
          const actual = ((p.valores[fila] ?? [])[indiceColumna] ?? '').trim()
          if (actual !== (tramo.previos[desplazamiento] ?? '').trim()) {
            saltadas.push(fila + 1)
            return
          }
        }
        while (p.valores.length <= fila) p.valores.push([])
        const destino = p.valores[fila]!
        while (destino.length <= indiceColumna) destino.push('')
        destino[indiceColumna] = valor
      })
    }
    return { saltadas }
  }

  async ocultarColumna(sheetId: number, indiceColumna: number): Promise<void> {
    this.llamadas.ocultarColumna++
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    this.buscarPorId(sheetId).ocultas.add(indiceColumna)
  }

  // ---------------------------------------------------------------------------
  // Operaciones de la sincronización
  // ---------------------------------------------------------------------------

  async leerVarias(titulos: string[], hastaFila?: number): Promise<LecturaDePestana[]> {
    // Una sola llamada, como el batchGet de verdad: no suma al contador de lecturas sueltas.
    this.llamadas.leerVarias++
    this.exigirConexion()
    return titulos.map((titulo) => {
      const valores = this.valoresDe(titulo)
      return { titulo, valores: hastaFila ? valores.slice(0, hastaFila) : valores }
    })
  }

  private valoresDe(titulo: string): string[][] {
    const p = this.buscarPorTitulo(titulo)
    const filas = p.valores.map(recortarFila)
    while (filas.length > 0 && (filas[filas.length - 1] ?? []).length === 0) filas.pop()
    return filas
  }

  async escribirCeldas(celdas: CeldaAEscribir[], columnaIdPorTitulo: Record<string, number> = {}): Promise<ResultadoDeCeldas> {
    this.llamadas.escribirCeldas++
    this.exigirConexion()
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    const noEncontradas: Array<{ titulo: string; id: string }> = []
    for (const celda of celdas) {
      const p = this.buscarPorTitulo(celda.titulo)
      let fila = celda.fila
      // Con _ID: el renglón se resuelve como en la base del VPS, y si ya no está NO se crea uno nuevo.
      if (celda.id) {
        const resuelto = this.resolverRenglon(p, celda.fila, celda.id, this.columnaIdInterna(p, columnaIdPorTitulo[celda.titulo]))
        if (resuelto === null) {
          if (!noEncontradas.some((n) => n.titulo === celda.titulo && n.id === celda.id)) noEncontradas.push({ titulo: celda.titulo, id: celda.id })
          continue
        }
        fila = resuelto
      }
      if (celda.columna >= p.columnas) p.columnas = celda.columna + 1
      while (p.valores.length < fila) p.valores.push([])
      const destino = p.valores[fila - 1]!
      while (destino.length <= celda.columna) destino.push('')
      destino[celda.columna] = celda.valor
    }
    return { noEncontradas }
  }

  async agregarFilas(titulo: string, filas: string[][]): Promise<ResultadoDeAgregado> {
    this.llamadas.agregarFilas++
    this.exigirConexion()
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    const p = this.buscarPorTitulo(titulo)
    // Google agrega después de la última fila con datos, no después de la última fila de la grilla.
    while (p.valores.length > 0 && (p.valores[p.valores.length - 1] ?? []).every((v) => (v ?? '').trim() === '')) p.valores.pop()
    const primera = p.valores.length + 1
    // Como la base del VPS: la fila cuyo _ID ya está en la pestaña (o repetido en la tanda) no entra.
    const columnaId = this.columnaIdInterna(p)
    const vistos = columnaId === null ? new Set<string>() : new Set(this.renglonesPorId(p, columnaId).keys())
    const numeros: Array<number | null> = []
    for (const fila of filas) {
      const id = columnaId === null ? '' : (fila[columnaId] ?? '').trim()
      if (id && vistos.has(id)) {
        numeros.push(null)
        continue
      }
      if (id) vistos.add(id)
      p.valores.push([...fila])
      numeros.push(p.valores.length)
      if (fila.length > p.columnas) p.columnas = fila.length
    }
    return { primeraFila: numeros.some((n) => n !== null) ? primera : 0, numeros }
  }

  async borrarFilas(sheetId: number, filas: Array<number | FilaABorrar>, columnaId: number | null = null): Promise<ResultadoDeBorrado> {
    this.llamadas.borrarFilas++
    this.exigirConexion()
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    const p = this.buscarPorId(sheetId)
    const columna = this.columnaIdInterna(p, columnaId)
    const noEncontradas: string[] = []
    const numeros: number[] = []
    for (const fila of filas) {
      if (typeof fila === 'number') {
        numeros.push(fila)
        continue
      }
      const resuelto = this.resolverRenglon(p, fila.numero, fila.id ?? '', columna)
      if (resuelto === null) noEncontradas.push(fila.id ?? '')
      else numeros.push(resuelto)
    }
    for (const fila of [...new Set(numeros)].sort((a, b) => b - a)) p.valores.splice(fila - 1, 1)
    return { noEncontradas }
  }

  async crearPestana(titulo: string, encabezados: string[]): Promise<PestanaDeHoja> {
    this.llamadas.crearPestana++
    this.exigirConexion()
    if (this.soloLectura) throw Object.assign(new Error('The caller does not have permission'), { status: 403 })
    // Google rechaza el título repetido con un 400: la pestaña ya existe y no hay nada que crear.
    if (this.pestanas.some((p) => p.titulo === titulo)) {
      throw Object.assign(new Error(`A sheet with the name "${titulo}" already exists.`), { status: 400 })
    }
    // Un sheetId que no use ninguna otra pestaña. Antes era 100 + cantidad, y después de quitar una
    // pestaña (las pruebas sacan IMPUTADOS) la nueva chocaba con la última: un borrado dirigido a la
    // pestaña nueva caía en COBERTURA.
    const siguiente = Math.max(100, ...this.pestanas.map((p) => p.sheetId + 1))
    const interna: PestanaInterna = {
      sheetId: siguiente,
      titulo,
      indice: this.pestanas.length,
      columnas: Math.max(encabezados.length + 4, 26),
      valores: [[...encabezados]],
      ocultas: new Set(),
      oculta: false,
    }
    this.pestanas.push(interna)
    return {
      sheetId: interna.sheetId,
      titulo: interna.titulo,
      indice: interna.indice,
      filas: 1000,
      columnas: interna.columnas,
      oculta: false,
    }
  }

  /** Simula quedarse sin internet: todas las llamadas fallan como si no hubiera red. */
  desconectar(): void {
    this.conectada = false
  }

  conectar(): void {
    this.conectada = true
  }

  private exigirConexion(): void {
    if (!this.conectada) throw Object.assign(new Error('getaddrinfo ENOTFOUND sheets.googleapis.com'), { code: 'ENOTFOUND' })
  }

  // ---------------------------------------------------------------------------
  // El almacén de adjuntos (la misma semántica que /api/dmg/adjuntos del VPS)
  // ---------------------------------------------------------------------------

  async subirAdjunto(ficha: FichaParaElAlmacen, contenido: Buffer): Promise<{ yaEstaba: boolean }> {
    this.exigirConexion()
    if (this.fallaDeSubida) {
      const falla = this.fallaDeSubida
      this.fallaDeSubida = null
      throw falla
    }
    const previo = this.almacen.get(ficha.id)
    if (previo) {
      if (previo.ficha.sha256 !== ficha.sha256) throw new ErrorDeNegocio('Ya hay un adjunto con ese id y otro contenido: un adjunto no se reescribe.')
      return { yaEstaba: true }
    }
    this.almacen.set(ficha.id, { ficha: { ...ficha }, contenido: Buffer.from(contenido) })
    return { yaEstaba: false }
  }

  async bajarAdjunto(id: string): Promise<ArchivoBajado> {
    this.exigirConexion()
    const guardado = this.almacen.get(id)
    if (!guardado) throw new ErrorDeNegocio('El servidor del VPS rechazó la operación (bajar el adjunto): Ese adjunto no existe.')
    return { contenido: Buffer.from(guardado.contenido), nombre: guardado.ficha.nombre, tipo: guardado.ficha.tipo, sha256: guardado.ficha.sha256 }
  }

  async borrarAdjunto(id: string): Promise<void> {
    this.exigirConexion()
    this.almacen.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Ayudas para las pruebas
  // ---------------------------------------------------------------------------

  /** Contenido actual de una pestaña (para verificar qué escribió el importador). */
  filasDe(titulo: string): string[][] {
    return this.buscarPorTitulo(titulo).valores.map((fila) => [...fila])
  }

  encabezadosDe(titulo: string): string[] {
    return recortarFila(this.buscarPorTitulo(titulo).valores[0] ?? [])
  }

  columnasOcultasDe(titulo: string): number[] {
    return [...this.buscarPorTitulo(titulo).ocultas].sort((a, b) => a - b)
  }

  /** Índice de la columna cuyo encabezado es `_ID`, o -1. */
  columnaIdDe(titulo: string): number {
    return this.encabezadosDe(titulo).findIndex((e) => e.trim().toUpperCase() === '_ID')
  }

  /** Los `_ID` escritos en la pestaña, por número de fila de la hoja (2, 3, 4…). */
  idsDe(titulo: string): Map<number, string> {
    const columna = this.columnaIdDe(titulo)
    const salida = new Map<number, string>()
    if (columna < 0) return salida
    const p = this.buscarPorTitulo(titulo)
    p.valores.forEach((fila, indice) => {
      if (indice === 0) return
      const valor = (fila[columna] ?? '').trim()
      if (valor) salida.set(indice + 1, valor)
    })
    return salida
  }

  titulos(): string[] {
    return this.pestanas.map((p) => p.titulo)
  }

  /** Simula que alguien editó una celda a mano entre dos importaciones. */
  editarCelda(titulo: string, fila: number, columna: number, valor: string): void {
    const p = this.buscarPorTitulo(titulo)
    while (p.valores.length < fila) p.valores.push([])
    const destino = p.valores[fila - 1]!
    while (destino.length <= columna) destino.push('')
    destino[columna] = valor
  }

  /** Simula que alguien agregó una fila nueva al final de una pestaña. */
  agregarFila(titulo: string, fila: string[]): void {
    this.buscarPorTitulo(titulo).valores.push([...fila])
  }

  /** Simula que alguien borró una fila de la hoja. */
  borrarFila(titulo: string, numeroDeFila: number): void {
    this.buscarPorTitulo(titulo).valores.splice(numeroDeFila - 1, 1)
  }

  /** Saca una pestaña de la hoja (para simular «todavía no existe la planilla del mes que viene»). */
  quitarPestana(titulo: string): PestanaInterna {
    const posicion = this.pestanas.findIndex((p) => p.titulo === titulo)
    if (posicion < 0) throw new Error(`No existe la pestaña «${titulo}»`)
    const [quitada] = this.pestanas.splice(posicion, 1)
    return quitada!
  }

  /** Vuelve a poner una pestaña que se había quitado, conservando su sheetId y sus _ID. */
  restaurarPestana(pestana: PestanaInterna): void {
    this.pestanas.push(pestana)
    this.pestanas.sort((a, b) => a.indice - b.indice)
  }
}
