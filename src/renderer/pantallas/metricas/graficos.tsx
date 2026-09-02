// Los gráficos de Métricas, dibujados a mano en SVG. Son cuatro formas simples —un ranking de barras
// horizontales, una línea y un par de barras por mes— y no justifican traerse una librería de
// gráficos entera a una aplicación de escritorio que ya pesa lo que pesa Electron.
//
// Todos llevan además su lectura en texto (el valor al lado de cada barra, la tabla de abajo): un
// gráfico que sólo se entiende mirándolo no sirve para el que trabaja con la planilla al lado.
import type { ReactNode } from 'react'
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
}

const TONOS_DE_TARJETA = {
  marca: 'border-marino-200 bg-marino-50 text-marino-900',
  exito: 'border-green-200 bg-green-50 text-green-900',
  peligro: 'border-red-200 bg-red-50 text-red-900',
  neutro: 'border-slate-200 bg-white text-slate-900',
}

export function TarjetaGrande({ etiqueta, valor, detalle, tono = 'neutro' }: PropsTarjetaGrande) {
  return (
    <div className={cx('min-w-0 rounded-xl border px-4 py-3 shadow-suave', TONOS_DE_TARJETA[tono])}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="mt-0.5 block font-display text-3xl leading-tight font-extrabold tabular-nums">{valor}</span>
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

export function GraficoDeLinea({ puntos, titulo }: { puntos: PuntoDeSerie[]; titulo: string }) {
  if (puntos.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Todavía no hay meses cargados.</p>

  const tope = topeDeEje(Math.max(...puntos.map((punto) => punto.valor)))
  const util = { ancho: ANCHO - MARGEN.izquierda - MARGEN.derecha, alto: ALTO - MARGEN.arriba - MARGEN.abajo }
  const x = (i: number) => MARGEN.izquierda + (puntos.length === 1 ? util.ancho / 2 : (i / (puntos.length - 1)) * util.ancho)
  const y = (valor: number) => MARGEN.arriba + util.alto - (valor / tope) * util.alto
  const linea = puntos.map((punto, i) => `${x(i)},${y(punto.valor)}`).join(' ')

  return (
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
      <polyline points={linea} fill="none" stroke="#235ba8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {puntos.map((punto, i) => (
        <g key={punto.periodo}>
          <circle cx={x(i)} cy={y(punto.valor)} r="3.5" fill="#235ba8" />
          <title>{`${punto.periodo}: ${numero(punto.valor)}`}</title>
          <text x={x(i)} y={ALTO - 8} textAnchor="middle" fontSize="11" fill="var(--grafico-rotulo)">
            {mesCorto(punto.periodo)}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Barras por mes (altas y bajas, una al lado de la otra)
// ---------------------------------------------------------------------------

export interface MesDeBarras {
  periodo: string
  primera: number
  segunda: number
}

interface PropsBarras {
  meses: MesDeBarras[]
  titulo: string
  nombrePrimera: string
  nombreSegunda: string
}

export function GraficoDeBarras({ meses, titulo, nombrePrimera, nombreSegunda }: PropsBarras) {
  if (meses.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Todavía no hay meses cargados.</p>

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
          return (
            <g key={mes.periodo}>
              <rect x={centro - ancho - 1} y={base - alto(mes.primera)} width={ancho} height={Math.max(alto(mes.primera), 0)} fill="#16a34a" rx="2">
                <title>{`${mes.periodo} · ${nombrePrimera}: ${numero(mes.primera)}`}</title>
              </rect>
              <rect x={centro + 1} y={base - alto(mes.segunda)} width={ancho} height={Math.max(alto(mes.segunda), 0)} fill="#dc2626" rx="2">
                <title>{`${mes.periodo} · ${nombreSegunda}: ${numero(mes.segunda)}`}</title>
              </rect>
              <text x={centro} y={ALTO - 8} textAnchor="middle" fontSize="11" fill="var(--grafico-rotulo)">
                {mesCorto(mes.periodo)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-green-600" />
          {nombrePrimera}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-600" />
          {nombreSegunda}
        </span>
      </div>
    </div>
  )
}
