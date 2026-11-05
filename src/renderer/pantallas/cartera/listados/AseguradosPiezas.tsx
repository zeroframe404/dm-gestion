// Las piezas del listado de Asegurados que no son la tabla en sí: las tarjetas de resumen, la barra de
// aseguradoras con su cantidad, el panel que dice de dónde sale cada aseguradora (API o VPS) y los chips
// de cada celda. Colores sólo de los pares que el tema oscuro ya da vuelta (estilos.css).
import type { ReactNode } from 'react'
import {
  TEXTO_DE_FUENTE_DE_ASEGURADORA,
  type AseguradoraDelAsegurado,
  type EstadoDeApiDeAsegurados,
  type EstadoDeApisDeAsegurados,
} from '../../../../shared/listados'
import { obtenerIniciales } from '../../../../shared/texto'
import { Icono, type NombreIcono } from '../../../componentes/Icono'
import { Boton, cx, haceCuanto } from '../../../componentes/ui'

const numero = new Intl.NumberFormat('es-AR')

// ---------------------------------------------------------------------------
// Tarjetas de resumen
// ---------------------------------------------------------------------------

type TonoDeTarjeta = 'marino' | 'verde' | 'violeta' | 'ambar'

const TONOS: Record<TonoDeTarjeta, string> = {
  marino: 'bg-marino-50 text-marino-700',
  verde: 'bg-green-50 text-green-700',
  violeta: 'bg-violet-100 text-violet-800',
  ambar: 'bg-amber-50 text-amber-700',
}

export function TarjetaDeResumen({ icono, tono, titulo, valor, detalle }: { icono: NombreIcono; tono: TonoDeTarjeta; titulo: string; valor: number; detalle?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-suave">
      <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', TONOS[tono])}>
        <Icono nombre={icono} tamano={22} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{titulo}</p>
        <p className="font-display text-2xl leading-tight font-extrabold text-slate-900">{numero.format(valor)}</p>
        {detalle && <p className="truncate text-xs text-slate-500">{detalle}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra rápida de aseguradoras
// ---------------------------------------------------------------------------

export interface AseguradoraConCantidad {
  nombre: string
  cantidad: number
  /** Cuántos de esos los confirmó la API. */
  porApi: number
}

/** Un botón por aseguradora con cuántos asegurados tiene: un clic filtra, otro clic lo saca. */
export function BarraDeAseguradoras({ aseguradoras, elegidas, alAlternar }: { aseguradoras: AseguradoraConCantidad[]; elegidas: readonly string[]; alAlternar: (nombre: string) => void }) {
  if (aseguradoras.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por aseguradora">
      <span className="mr-1 text-xs font-semibold tracking-[0.1em] text-slate-500 uppercase">Aseguradoras</span>
      {aseguradoras.map((a) => {
        const activa = elegidas.includes(a.nombre)
        return (
          <button
            key={a.nombre}
            type="button"
            onClick={() => alAlternar(a.nombre)}
            aria-pressed={activa}
            title={a.porApi > 0 ? `${numero.format(a.porApi)} de ${numero.format(a.cantidad)} confirmados por la API` : 'Según la cartera (VPS)'}
            className={cx(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
              activa ? 'border-marino-300 bg-marino-100 text-marino-800' : 'border-slate-200 bg-white text-slate-700 hover:border-marino-300 hover:bg-marino-50',
            )}
          >
            {a.porApi > 0 && <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />}
            {a.nombre}
            <span className={cx('rounded-full px-1.5 text-[11px] font-bold', activa ? 'bg-white text-marino-800' : 'bg-slate-100 text-slate-600')}>{numero.format(a.cantidad)}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chips de la celda
// ---------------------------------------------------------------------------

/** «GALENO · API» en verde (la aseguradora lo confirmó) o «ATM · VPS» en gris (lo dice la cartera). */
export function ChipDeAseguradora({ aseguradora }: { aseguradora: AseguradoraDelAsegurado }) {
  const porApi = aseguradora.fuente === 'API'
  return (
    <span
      title={`${aseguradora.nombre}: ${TEXTO_DE_FUENTE_DE_ASEGURADORA[aseguradora.fuente]}`}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2.5 text-xs font-semibold whitespace-nowrap',
        porApi ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      {aseguradora.nombre}
      <span
        className={cx(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tracking-wide',
          porApi ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600',
        )}
      >
        <Icono nombre={porApi ? 'ok' : 'baseDeDatos'} tamano={10} />
        {aseguradora.fuente}
      </span>
    </span>
  )
}

export function CeldaDeAseguradoras({ aseguradoras }: { aseguradoras: AseguradoraDelAsegurado[] }) {
  if (aseguradoras.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {aseguradoras.map((a) => (
        <ChipDeAseguradora key={a.nombre} aseguradora={a} />
      ))}
    </div>
  )
}

/** El nombre con un círculo de iniciales y, debajo, la sucursal. */
export function CeldaDeAsegurado({ nombre, detalle, alAbrir }: { nombre: string; detalle: string | null; alAbrir: () => void }) {
  return (
    <div className="flex items-center gap-3 text-left">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marino-100 text-xs font-bold text-marino-800" aria-hidden="true">
        {obtenerIniciales(nombre) || '?'}
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={(evento) => {
            evento.stopPropagation()
            alAbrir()
          }}
          className="rounded text-left font-semibold text-marino-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
        >
          {nombre}
        </button>
        {detalle && (
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <Icono nombre="sucursal" tamano={12} />
            {detalle}
          </p>
        )}
      </div>
    </div>
  )
}

/** Celular y email, uno debajo del otro, cada uno con su ícono. */
export function CeldaDeContacto({ celular, email }: { celular: string | null; email: string | null }) {
  if (!celular && !email) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-col items-start gap-0.5 text-left text-xs">
      {celular && (
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
          <Icono nombre="telefono" tamano={12} className="text-slate-400" />
          {celular}
        </span>
      )}
      {email && (
        <span className="inline-flex max-w-[16rem] items-center gap-1.5 truncate text-slate-500" title={email}>
          <Icono nombre="mensaje" tamano={12} className="shrink-0 text-slate-400" />
          <span className="truncate">{email}</span>
        </span>
      )}
    </div>
  )
}

export function CeldaDePolizas({ vigentes }: { vigentes: number }) {
  return vigentes > 0 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
      <Icono nombre="escudo" tamano={12} />
      {vigentes} {vigentes === 1 ? 'vigente' : 'vigentes'}
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">Sin vigentes</span>
  )
}

// ---------------------------------------------------------------------------
// De dónde sale la aseguradora
// ---------------------------------------------------------------------------

const MODO: Record<EstadoDeApiDeAsegurados['modo'], string> = {
  CARTERA: 'Cartera completa',
  POR_CLIENTE: 'Confirma cliente por cliente',
  SIN_CONSULTA: 'Sin consulta de cartera',
}

function TarjetaDeApi({ api }: { api: EstadoDeApiDeAsegurados }) {
  const sinConsulta = api.modo === 'SIN_CONSULTA'
  const tono = sinConsulta ? 'gris' : api.error ? 'ambar' : api.consultadoEn ? 'verde' : 'gris'
  const punto = { gris: 'bg-slate-400', ambar: 'bg-amber-500', verde: 'bg-green-500' }[tono]
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', punto)} aria-hidden="true" />
        <p className="truncate text-sm font-bold text-slate-800">{api.nombre}</p>
        <span className="ml-auto shrink-0 text-[11px] font-medium text-slate-500">{MODO[api.modo]}</span>
      </div>
      {sinConsulta ? (
        <p className="text-xs text-slate-500">La integración sólo cotiza: sus clientes salen de la cartera (VPS).</p>
      ) : (
        <>
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{numero.format(api.confirmados)}</span> confirmados · {api.consultadoEn ? haceCuanto(api.consultadoEn) : 'todavía nunca'}
            {api.pendientes > 0 && ` · ${numero.format(api.pendientes)} por consultar`}
          </p>
          {api.error && (
            <p className="line-clamp-2 text-xs text-amber-700" title={api.error}>
              {api.error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function PanelDeFuentes({ estado, consultando, alConsultar }: { estado: EstadoDeApisDeAsegurados | null; consultando: boolean; alConsultar: () => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-suave">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold tracking-tight text-slate-900">Origen de las aseguradoras</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="rounded-full bg-green-100 px-1.5 py-px text-[10px] font-bold text-green-800">API</span> la aseguradora lo confirmó (principal)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded-full bg-slate-200 px-1.5 py-px text-[10px] font-bold text-slate-600">VPS</span> lo dice la cartera de la agencia
            </span>
          </p>
        </div>
        <Boton icono="refrescar" tamano="sm" onClick={alConsultar} cargando={consultando} disabled={consultando}>
          {consultando ? 'Consultando APIs…' : 'Consultar APIs'}
        </Boton>
      </header>
      {estado && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {estado.apis.map((api) => (
            <TarjetaDeApi key={api.aseguradora} api={api} />
          ))}
        </div>
      )}
    </section>
  )
}
