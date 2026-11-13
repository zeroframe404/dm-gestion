// Una «hoja» que vive sólo en memoria: lo justo para correr el importador entero sin tocar ningún
// servidor. La usa el ensayo del Alta desde Excel (servicios/altaDesdeExcel.ts), que importa las
// pestañas armadas en una base de datos también en memoria para mostrar qué va a pasar de verdad.
//
// Implementa la lectura y lo que el importador escribe (la columna _ID). Las operaciones de la
// sincronización no tienen sentido en un ensayo y fallan si alguien las llama.
import { ErrorDeNegocio } from '../servicios/errores'
import type {
  EstructuraHoja,
  FuenteHoja,
  LecturaDePestana,
  ResultadoDeAgregado,
  ResultadoDeBorrado,
  ResultadoDeCeldas,
  ResultadoDeTramos,
  TramoDeColumna,
  PestanaDeHoja,
} from './fuente'

interface PestanaEnMemoria {
  sheetId: number
  titulo: string
  indice: number
  columnas: number
  oculta: boolean
  valores: string[][]
}

export class FuenteEnMemoria implements FuenteHoja {
  private readonly pestanas: PestanaEnMemoria[]

  constructor(
    pestanas: Array<{ titulo: string; valores: string[][]; oculta?: boolean }>,
    private readonly titulo = 'Ensayo',
  ) {
    this.pestanas = pestanas.map((p, indice) => ({
      sheetId: indice + 1,
      titulo: p.titulo,
      indice,
      columnas: Math.max(1, ...p.valores.map((f) => f.length)),
      oculta: p.oculta ?? false,
      valores: p.valores.map((f) => [...f]),
    }))
  }

  /** Las pestañas como quedaron (con los _ID escritos), para quien quiera mirarlas. */
  valoresDe(titulo: string): string[][] {
    return this.buscar(titulo).valores.map((f) => [...f])
  }

  private buscar(titulo: string): PestanaEnMemoria {
    const p = this.pestanas.find((x) => x.titulo === titulo)
    if (!p) throw new ErrorDeNegocio(`No existe la pestaña «${titulo}».`)
    return p
  }

  private porId(sheetId: number): PestanaEnMemoria {
    const p = this.pestanas.find((x) => x.sheetId === sheetId)
    if (!p) throw new ErrorDeNegocio(`No existe la pestaña ${sheetId}.`)
    return p
  }

  private leer(p: PestanaEnMemoria, hastaFila?: number): string[][] {
    const filas = p.valores.map((fila) => {
      const copia = [...fila]
      while (copia.length > 0 && (copia[copia.length - 1] ?? '') === '') copia.pop()
      return copia
    })
    while (filas.length > 0 && filas[filas.length - 1]!.length === 0) filas.pop()
    return hastaFila ? filas.slice(0, hastaFila) : filas
  }

  async estructura(): Promise<EstructuraHoja> {
    const pestanas: PestanaDeHoja[] = this.pestanas.map((p) => ({
      sheetId: p.sheetId,
      titulo: p.titulo,
      indice: p.indice,
      filas: Math.max(p.valores.length, 1),
      columnas: p.columnas,
      oculta: p.oculta,
    }))
    return { hojaId: 'ensayo', titulo: this.titulo, pestanas }
  }

  async leerValores(titulo: string): Promise<string[][]> {
    return this.leer(this.buscar(titulo))
  }

  async leerPrimerasFilas(titulo: string, cantidad: number): Promise<string[][]> {
    return this.leer(this.buscar(titulo), cantidad)
  }

  async leerVarias(titulos: string[], hastaFila?: number): Promise<LecturaDePestana[]> {
    return titulos.map((titulo) => ({ titulo, valores: this.leer(this.buscar(titulo), hastaFila) }))
  }

  async asegurarColumnas(sheetId: number, cantidad: number): Promise<void> {
    const p = this.porId(sheetId)
    if (cantidad > p.columnas) p.columnas = cantidad
  }

  async escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<ResultadoDeTramos> {
    const p = this.buscar(titulo)
    const saltadas: number[] = []
    for (const tramo of tramos) {
      tramo.valores.forEach((valor, desplazamiento) => {
        const fila = tramo.fila - 1 + desplazamiento
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

  async ocultarColumna(): Promise<void> {
    // En memoria no hay nada que ocultar.
  }

  private noEnElEnsayo(): never {
    throw new ErrorDeNegocio('Esta operación no está disponible en el ensayo.')
  }

  async escribirCeldas(): Promise<ResultadoDeCeldas> {
    return this.noEnElEnsayo()
  }

  async agregarFilas(): Promise<ResultadoDeAgregado> {
    return this.noEnElEnsayo()
  }

  async borrarFilas(): Promise<ResultadoDeBorrado> {
    return this.noEnElEnsayo()
  }

  async crearPestana(): Promise<PestanaDeHoja> {
    return this.noEnElEnsayo()
  }
}
