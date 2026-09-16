// Los gráficos de Métricas, dibujados a mano en SVG. Son cuatro formas simples —un ranking de barras
// horizontales, una línea y un par de barras por mes— y no justifican traerse una librería de
// gráficos entera a una aplicación de escritorio que ya pesa lo que pesa Electron.
//
// Todos llevan además su lectura en texto (el valor al lado de cada barra, la tabla de abajo): un
// gráfico que sólo se entiende mirándolo no sirve para el que trabaja con la planilla al lado.
import type { ReactNode } from 'react'
import { NOMBRE_RAMA_DE_METRICA } from '../../../shared/tipos'
import { cx } from '../../componentes/ui'

const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

/** '2026-08' → 'AGO'. En enero se agrega el año, que es cuando importa verlo. */
export function mesCorto(periodo: string): string {
  const mes = MESES_CORTOS[Number(periodo.slice(5, 7)) - 1] ?? periodo
  return mes === 'ENE' ? `${mes} ${periodo.slice(2, 4)}` : mes
}

export function numero(valor: number): string {
  return valor.toLocaleString('es-AR')
}

// ---------------------------------------------------------------------------
// Tarjeta grande
// ---------------------------------------------------------------------------

interface PropsTarjetaGrande {
  etiqueta: string
  valor: string
  detalle?: ReactNode
  tono?: 'marca' | 'exito' | 'peligro' | 'neutro'
  /** La misma cifra separada por rama. Sin él la tarjeta es la de siempre: un cálculo viejo no la trae. */
  desglose?: { autosMotos: number | null; riesgosVarios: number | null }
}

const TONOS_DE_TARJETA = {
  marca: 'border-marino-200 bg-marino-50 text-marino-900',
  exito: 'border-green-200 bg-green-50 text-green-900',
  peligro: 'border-red-200 bg-red-50 text-red-900',
  neutro: 'border-slate-200 bg-white text-slate-900',
}

export function TarjetaGrande({ etiqueta, valor, detalle, tono = 'neutro', desglose }: PropsTarjetaGrande) {
  const cifra = (cantidad: number | null) => (cantidad === null ? '—' : numero(cantidad))
  return (
    <div className={cx('min-w-0 rounded-xl border px-4 py-3 shadow-suave', TONOS_DE_TARJETA[tono])}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="mt-0.5 block font-display text-3xl leading-tight font-extrabold tabular-nums">{valor}</span>
      {desglose && (
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums">
          <span>
            {NOMBRE_RAMA_DE_METRICA.AUTOS_MOTOS} <strong className="font-semibold">{cifra(desglose.autosMotos)}</strong>
          </span>
          <span>
            {NOMBRE_RAMA_DE_METRICA.RIESGOS_VARIOS} <strong className="font-semibold">{cifra(desglose.riesgosVarios)}</strong>
          </span>
        </span>
      )}
      {detalle && <span className="mt-1 block text-xs leading-relaxed opacity-80">{detalle}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ranking de barras horizontales
// ---------------------------------------------------------------------------

export interface FilaDeRanking {
  etiqueta: string
  cantidad: number
  /** 0 a 100. Si no viene, la barra se dibuja contra el mayor de la lista. */
  porcentaje?: number
}

interface PropsRanking {
  filas: FilaDeRanking[]
  /** Cuántas se muestran antes de agrupar el resto en «otras». */
  maximo?: number
  vacio: string
  /** Qué dice la segunda columna: el porcentaje o nada. */
  conPorcentaje?: boolean
}

export function Ranking({ filas, maximo = 8, vacio, conPorcentaje = true }: PropsRanking) {
  if (filas.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{vacio}</p>

  const visibles = filas.slice(0, maximo)
  const resto = filas.slice(maximo)
  if (resto.length > 0) {
    visibles.push({
      etiqueta: `Otras (${resto.length})`,
      cantidad: resto.reduce((suma, fila) => suma + fila.cantidad, 0),
      porcentaje: resto.reduce((suma, fila) => suma + (fila.porcentaje ?? 0), 0),
    })
  }
  const mayor = Math.max(...visibles.map((fila) => fila.cantidad), 1)

  return (
    <ul className="flex flex-col gap-2">
      {visibles.map((fila) => (
        <li key={fila.etiqueta} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="truncate text-sm font-medium text-slate-800" title={fila.etiqueta}>
            {fila.etiqueta}
          </span>
          <span className="text-right text-sm tabular-nums text-slate-600">
            <strong className="font-semibold text-slate-900">{numero(fila.cantidad)}</strong>
            {conPorcentaje && fila.porcentaje !== undefined && (
              <span className="ml-1.5 text-xs text-slate-500">{fila.porcentaje.toLocaleString('es-AR')} %</span>
            )}
          </span>
          <span className="col-span-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <span
              className="block h-full rounded-full bg-marino-600"
              style={{ width: `${Math.max((fila.cantidad / mayor) * 100, fila.cantidad > 0 ? 2 : 0)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Línea de evolución
// ---------------------------------------------------------------------------

const ANCHO = 720
const ALTO = 200
const MARGEN = { arriba: 14, abajo: 26, izquierda: 46, derecha: 10 }

/**
 * Un tope de eje que quede en un número redondo Y cuya mitad también lo sea: la marca del medio se
 * escribe redondeada, y con un tope de 1 el eje diría «1, 1, 0».
 */
function topeDeEje(maximo: number): number {
  if (maximo <= 0) return 2
  const magnitud = 10 ** Math.floor(Math.log10(maximo))
  const bruto = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((escala) => escala * magnitud).find((tope) => tope >= maximo) ?? 10 * magnitud
  return bruto < 10 ? Math.max(2, Math.ceil(bruto / 2) * 2) : bruto
}

export interface PuntoDeSerie {
  periodo: string
  valor: number
}

/** Una línea más debajo de la principal, con un valor por cada punto y en el mismo orden. */
export interface SerieDeLinea {
  nombre: string
  color: string
  valores: number[]
}

const COLOR_DE_LA_LINEA = '#235ba8'

interface PropsLinea {
  puntos: PuntoDeSerie[]
  titulo: string
  /** Cómo se llama la línea principal en la leyenda. Sólo se usa si hay `series`. */
  nombre?: string
  /** Las líneas que la separan (por ejemplo, por rama). Sin ellas el gráfico es la línea de siempre. */
  series?: SerieDeLinea[]
}

export function GraficoDeLinea({ puntos, titulo, nombre = 'Total', series = [] }: PropsLinea) {
  if (puntos.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Todavía no hay meses cargados.</p>

  const tope = topeDeEje(Math.max(...puntos.map((punto) => punto.valor), ...series.flatMap((serie) => serie.valores)))
  const util = { ancho: ANCHO - MARGEN.izquierda - MARGEN.derecha, alto: ALTO - MARGEN.arriba - MARGEN.abajo }
  const x = (i: number) => MARGEN.izquierda + (puntos.length === 1 ? util.ancho / 2 : (i / (puntos.length - 1)) * util.ancho)
  const y = (valor: number) => MARGEN.arriba + util.alto - (valor / tope) * util.alto
  const linea = puntos.map((punto, i) => `${x(i)},${y(punto.valor)}`).join(' ')

  const grafico = (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="h-auto w-full" role="img" aria-label={titulo}>
      {[0, 0.5, 1].map((parte) => (
        <g key={parte}>
          <line
            x1={MARGEN.izquierda}
            x2={ANCHO - MARGEN.derecha}
            y1={y(tope * parte)}
            y2={y(tope * parte)}
            stroke="var(--grafico-rejilla)"
            strokeWidth="1"
          />
          <text x={MARGEN.izquierda - 6} y={y(tope * parte) + 4} textAnchor="end" fontSize="11" fill="var(--grafico-eje)">
            {numero(Math.round(tope * parte))}
          </text>
        </g>
      ))}
      {/* Las series de la separación van debajo y punteadas: la línea principal sigue siendo la que se lee primero. */}
      {series.map((serie) => (
        <polyline
          key={serie.nombre}
          points={puntos.map((_, i) => `${x(i)},${y(serie.valores[i] ?? 0)}`).join(' ')}
          fill="none"
          stroke={serie.color}
          strokeWidth="2"
          strokeDasharray="6 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      <polyline points={linea} fill="none" stroke={COLOR_DE_LA_LINEA} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {puntos.map((punto, i) => (
        <g key={punto.periodo}>
          <circle cx={x(i)} cy={y(punto.valor)} r="3.5" fill={COLOR_DE_LA_LINEA} />
          <title>
            {[`${punto.periodo}: ${numero(punto.valor)}`, ...series.map((serie) => `${serie.nombre}: ${numero(serie.valores[i] ?? 0)}`)].join(' · ')}
          </title>
          <text x={x(i)} y={ALTO - 8} textAnchor="middle" fontSize="11" fill="var(--grafico-rotulo)">
            {mesCorto(punto.periodo)}
          </text>
        </g>
      ))}
    </svg>
  )

  if (series.length === 0) return grafico
  return (
    <div>
      {grafico}
      <div className="mt-1 flex flex-wrap justify-center gap-4 text-xs text-slate-600">
        {[{ nombre, color: COLOR_DE_LA_LINEA }, ...series].map((serie) => (
          <span key={serie.nombre} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: serie.color }} />
            {serie.nombre}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barras por mes (altas y bajas, una al lado de la otra)
// ---------------------------------------------------------------------------

export interface MesDeBarras {
  periodo: string
  primera: number
  segunda: number
  /**
   * La parte de cada barra que es de riesgos varios; el resto es de autos y motos. Se dibuja arriba y en
   * tono claro. Sin él la barra va de un solo tono, como siempre.
   */
  riesgosVarios?: { primera: number; segunda: number }
}

interface PropsBarras {
  meses: MesDeBarras[]
  titulo: string
  nombrePrimera: string
  nombreSegunda: string
}

/** Lo que dice el globito de una barra: el total y, si la trae, su separación por rama. */
function rotuloDeBarra(periodo: string, nombre: string, valor: number, deRiesgosVarios: number | undefined): string {
  const total = `${periodo} · ${nombre}: ${numero(valor)}`
  if (deRiesgosVarios === undefined) return total
  const autosMotos = `${NOMBRE_RAMA_DE_METRICA.AUTOS_MOTOS} ${numero(valor - deRiesgosVarios)}`
  return `${total} (${autosMotos} · ${NOMBRE_RAMA_DE_METRICA.RIESGOS_VARIOS} ${numero(deRiesgosVarios)})`
}

/** El tono pleno de cada barra (la parte de autos y motos) y el claro que le va arriba (riesgos varios). */
const COLOR_PRIMERA = { pleno: '#16a34a', claro: '#86efac' }
const COLOR_SEGUNDA = { pleno: '#dc2626', claro: '#fca5a5' }

export function GraficoDeBarras({ meses, titulo, nombrePrimera, nombreSegunda }: PropsBarras) {
  if (meses.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Todavía no hay meses cargados.</p>

  const hayRamas = meses.some((mes) => mes.riesgosVarios !== undefined)
  const tope = topeDeEje(Math.max(...meses.flatMap((mes) => [mes.primera, mes.segunda])))
  const util = { ancho: ANCHO - MARGEN.izquierda - MARGEN.derecha, alto: ALTO - MARGEN.arriba - MARGEN.abajo }
  const paso = util.ancho / meses.length
  const ancho = Math.min(paso / 2.6, 18)
  const base = MARGEN.arriba + util.alto
  const alto = (valor: number) => (valor / tope) * util.alto

  return (
    <div>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="h-auto w-full" role="img" aria-label={titulo}>
        {[0, 0.5, 1].map((parte) => (
          <g key={parte}>
            <line
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={base - util.alto * parte}
              y2={base - util.alto * parte}
              stroke="var(--grafico-rejilla)"
              strokeWidth="1"
            />
            <text x={MARGEN.izquierda - 6} y={base - util.alto * parte + 4} textAnchor="end" fontSize="11" fill="var(--grafico-eje)">
              {numero(Math.round(tope * parte))}
            </text>
          </g>
        ))}
        {meses.map((mes, i) => {
          const centro = MARGEN.izquierda + paso * i + paso / 2
          // Cada barra es el total; encima, en tono claro, va la parte de riesgos varios. Lo que queda
          // abajo en tono pleno es la de autos y motos, así que la barra sigue midiendo el total de antes.
          const barra = (x: number, valor: number, deRiesgosVarios: number | undefined, color: { pleno: string; claro: string }, nombre: string) => (
            <>
              <rect x={x} y={base - alto(valor)} width={ancho} height={Math.max(alto(valor), 0)} fill={color.pleno} rx="2">
                <title>{rotuloDeBarra(mes.periodo, nombre, valor, deRiesgosVarios)}</title>
              </rect>
              {deRiesgosVarios !== undefined && deRiesgosVarios > 0 && (
                <rect x={x} y={base - alto(valor)} width={ancho} height={Math.max(alto(deRiesgosVarios), 0)} fill={color.claro} rx="2">
                  <title>{rotuloDeBarra(mes.periodo, nombre, valor, deRiesgosVarios)}</title>
                </rect>
              )}
            </>
          )
          return (
            <g key={mes.periodo}>
              {barra(centro - ancho - 1, mes.primera, mes.riesgosVarios?.primera, COLOR_PRIMERA, nombrePrimera)}
              {barra(centro + 1, mes.segunda, mes.riesgosVarios?.segunda, COLOR_SEGUNDA, nombreSegunda)}
              <text x={centro} y={ALTO - 8} textAnchor="middle" fontSize="11" fill="var(--grafico-rotulo)">
                {mesCorto(mes.periodo)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-green-600" />
          {nombrePrimera}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-600" />
          {nombreSegunda}
        </span>
        {hayRamas && (
          <span>
            El tono claro de cada barra es la parte de {NOMBRE_RAMA_DE_METRICA.RIESGOS_VARIOS.toLowerCase()}; el pleno, la de{' '}
            {NOMBRE_RAMA_DE_METRICA.AUTOS_MOTOS.toLowerCase()}.
          </span>
        )}
      </div>
    </div>
  )
}
