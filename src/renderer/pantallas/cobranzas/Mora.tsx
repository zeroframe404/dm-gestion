// Mora: las cuotas vencidas sin pago, de todos los meses. Es la lista de a quién hay que llamar hoy,
// así que se ordena por días de atraso y cada fila tiene el mismo «Avisar» de la planilla.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { NOMBRE_RANGO_MORA, type FilaMora, type FiltrosMora, type ListadoMora, type RangoDeMora } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { SelectorDeColumnas, useColumnasElegidas } from '../../componentes/SelectorDeColumnas'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { numero, pesos } from './formato'

const FILTROS_VACIOS: FiltrosMora = { busqueda: '', sucursal: '', compania: '', rango: '', incluirDebito: false }

const CLASES_RANGO: Record<Exclude<RangoDeMora, ''>, string> = {
  '1-7': 'bg-amber-100 text-amber-900 border-amber-200',
  '8-30': 'bg-orange-200 text-orange-900 border-orange-300',
  '+30': 'bg-red-100 text-red-800 border-red-200',
}

export function Mora() {
  const puedeAvisar = usePuedeEditar('cobranzas')
  const [datos, setDatos] = useState<ListadoMora | null>(null)
  const [filtros, setFiltros] = useState<FiltrosMora>(FILTROS_VACIOS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisando, setAvisando] = useState<string | null>(null)

  const cargar = useCallback(async (actuales: FiltrosMora) => {
    setCargando(true)
    setError(null)
    // El aviso habla del último WhatsApp que se abrió: al cambiar de filtro deja de tener sentido.
    setAviso(null)
    const resultado = await window.dm.cobranzas.mora(actuales)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  // El listado se arma en el proceso principal: la búsqueda se manda con un respiro para no
  // recalcular la mora entera en cada tecla.
  useEffect(() => {
    const reloj = setTimeout(() => void cargar(filtros), filtros.busqueda ? 250 : 0)
    return () => clearTimeout(reloj)
  }, [cargar, filtros])

  const avisar = async (fila: FilaMora) => {
    setAvisando(fila.filaId)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.cobranzas.avisarMora(fila.filaId)
    if (!resultado.ok) {
      setError(resultado.error)
      setAvisando(null)
      return
    }
    setDatos((previo) =>
      previo ? { ...previo, filas: previo.filas.map((f) => (f.filaId === fila.filaId ? resultado.datos.fila : f)) } : previo,
    )
    const abierto = await window.dm.sistema.abrirEnlace(resultado.datos.url)
    setAvisando(null)
    if (!abierto.ok) setError(abierto.error)
    else if (resultado.datos.marcada) setAviso(`WhatsApp abierto para ${fila.nombre ?? 'el cliente'}. La fila quedó como ENVIADO.`)
    else
      setAviso(
        `WhatsApp abierto para ${fila.nombre ?? 'el cliente'}. La cuota es de ${nombreDePeriodo(fila.periodo)}, un mes ya cerrado: la planilla no se tocó, el aviso quedó en el historial.`,
      )
  }

  const columnas = useMemo<Array<ColumnaTabla<FilaMora>>>(
    () => [
      // El cliente va primero y es la única fija: es de quien hay que acordarse mientras se corre la
      // tabla para mirar la póliza o la patente. Las demás se apagan desde «Columnas».
      {
        id: 'nombre',
        titulo: 'Cliente',
        ancho: 240,
        fija: true,
        siempre: true,
        celda: (fila) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{fila.nombre ?? '—'}</span>
            {fila.imputada && (
              <span
                className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800"
                title="La agencia ya le imputó la cuota a la compañía: lo que se persigue es el pago del cliente."
              >
                Imputado
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'atraso',
        titulo: 'Atraso',
        ancho: 118,
        celda: (fila) => (
          <span
            title={`Venció el ${fila.vencimiento}${fila.dentroDeCobertura && fila.finCobertura ? ` · la compañía cubre hasta el ${fila.finCobertura}` : ''}`}
            className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold', CLASES_RANGO[fila.rango])}
          >
            {fila.diasDeAtraso} {fila.diasDeAtraso === 1 ? 'día' : 'días'}
          </span>
        ),
      },
      {
        id: 'avisar',
        titulo: 'Avisar',
        ancho: 76,
        celda: (fila) => (
          <button
            type="button"
            title={fila.telefono ? `Avisar por WhatsApp a ${fila.telefono}` : 'Sin teléfono cargado'}
            aria-label="Avisar por WhatsApp"
            disabled={avisando !== null || !puedeAvisar}
            onClick={(evento) => {
              evento.stopPropagation()
              void avisar(fila)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-marino-300 hover:bg-marino-50 hover:text-marino-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icono nombre="mensaje" tamano={14} />
          </button>
        ),
      },
      { id: 'telefono', titulo: 'Teléfono', ancho: 130, celda: (fila) => fila.telefono ?? <span className="text-slate-400">sin teléfono</span> },
      { id: 'cuota', titulo: 'Cuota', ancho: 110, alinear: 'derecha', celda: (fila) => (fila.cuotaMonto === null ? (fila.cuota ?? '—') : pesos(fila.cuotaMonto)) },
      { id: 'vencimiento', titulo: 'Venció el', ancho: 110, alinear: 'centro', celda: (fila) => fila.vencimiento },
      { id: 'mes', titulo: 'Mes', ancho: 130, celda: (fila) => (
        <span className={cx('truncate', !fila.mesAbierto && 'text-slate-500')}>
          {nombreDePeriodo(fila.periodo)}
          {!fila.mesAbierto && ' ·'}
        </span>
      ) },
      { id: 'sucursal', titulo: 'Sucursal', ancho: 120, celda: (fila) => fila.sucursal ?? '—' },
      { id: 'compania', titulo: 'Compañía', ancho: 150, celda: (fila) => fila.compania ?? '—' },
      { id: 'poliza', titulo: 'Póliza', ancho: 120, celda: (fila) => <span className="truncate font-mono text-xs">{fila.numeroPoliza ?? '—'}</span> },
      { id: 'patente', titulo: 'Patente', ancho: 100, celda: (fila) => <span className="font-mono text-xs">{fila.patente ?? '—'}</span> },
      { id: 'formaPago', titulo: 'Forma de pago', ancho: 130, celda: (fila) => fila.formaPago ?? '—' },
      {
        id: 'aviso',
        titulo: 'Último aviso',
        ancho: 130,
        celda: (fila) => (fila.fechaEnvio ? <span className="truncate text-slate-600">{fila.fechaEnvio}</span> : <span className="text-slate-400">nunca</span>),
      },
    ],
    [avisando],
  )

  const { visibles, ocultas, alternar: alternarColumna, mostrarTodas } = useColumnasElegidas('mora', columnas)

  if (cargando && !datos) return <Cargando texto="Buscando la mora…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const hayFiltros = Boolean(filtros.busqueda || filtros.sucursal || filtros.compania || filtros.rango || filtros.incluirDebito)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap gap-2">
        <Contador etiqueta="Cuotas vencidas" valor={numero(datos.total)} />
        <Contador etiqueta="Deuda listada" valor={pesos(datos.totalDeuda)} tono="rojo" />
        {(['1-7', '8-30', '+30'] as const).map((rango) => (
          <button
            key={rango}
            type="button"
            onClick={() => setFiltros((f) => ({ ...f, rango: f.rango === rango ? '' : rango }))}
            className={cx(
              'rounded-lg border px-3 py-1.5 text-left transition-colors',
              filtros.rango === rango ? CLASES_RANGO[rango] : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300',
            )}
          >
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{NOMBRE_RANGO_MORA[rango]}</span>
            <span className="font-display text-lg font-extrabold tabular-nums">{numero(datos.porRango[rango])}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(evento) => setFiltros((f) => ({ ...f, busqueda: evento.target.value }))}
            placeholder="Buscar por nombre, DNI, póliza o patente…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <Desplegable etiqueta="Sucursal" valor={filtros.sucursal} opciones={datos.sucursales} alCambiar={(v) => setFiltros((f) => ({ ...f, sucursal: v }))} />
        <Desplegable etiqueta="Compañía" valor={filtros.compania} opciones={datos.companias} alCambiar={(v) => setFiltros((f) => ({ ...f, compania: v }))} />
        <select
          value={filtros.rango}
          onChange={(evento) => setFiltros((f) => ({ ...f, rango: evento.target.value as RangoDeMora }))}
          aria-label="Días de atraso"
          className={cx('h-9 rounded-lg border bg-white px-2 text-sm', filtros.rango ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700')}
        >
          {(['', '1-7', '8-30', '+30'] as const).map((rango) => (
            <option key={rango} value={rango}>
              {NOMBRE_RANGO_MORA[rango]}
            </option>
          ))}
        </select>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filtros.incluirDebito}
            onChange={(evento) => setFiltros((f) => ({ ...f, incluirDebito: evento.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Incluir débito automático
        </label>
        {hayFiltros && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setFiltros(FILTROS_VACIOS)}>
            Limpiar
          </Boton>
        )}
        <SelectorDeColumnas columnas={columnas} ocultas={ocultas} alAlternar={alternarColumna} alMostrarTodas={mostrarTodas} />
        <span className="ml-auto text-sm text-slate-500">
          {numero(datos.filas.length)} de {numero(datos.total)} cuotas
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <TablaVirtual
        filas={datos.filas}
        columnas={visibles}
        claveDe={(fila) => fila.filaId}
        vacio={
          datos.total === 0
            ? 'No hay ninguna cuota vencida sin pagar. No se listan las pólizas dadas de baja ni, salvo que lo pidas, las de débito automático.'
            : 'Ninguna cuota coincide con los filtros.'
        }
      />
      <p className="text-xs text-slate-500">
        Las cuotas de meses ya cerrados se pueden avisar igual, pero su planilla no se toca: el aviso queda en el historial.
      </p>
    </div>
  )
}

function Contador({ etiqueta, valor, tono = 'neutro' }: { etiqueta: string; valor: string; tono?: 'neutro' | 'rojo' }) {
  return (
    <div className={cx('rounded-lg border px-3 py-1.5', tono === 'rojo' ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-900')}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="font-display text-lg font-extrabold tabular-nums">{valor}</span>
    </div>
  )
}

function Desplegable({
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  etiqueta: string
  valor: string
  opciones: string[]
  alCambiar: (valor: string) => void
}) {
  return (
    <select
      value={valor}
      onChange={(evento) => alCambiar(evento.target.value)}
      aria-label={etiqueta}
      className={cx('h-9 rounded-lg border bg-white px-2 text-sm', valor ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700')}
    >
      <option value="">{etiqueta}: todas</option>
      {opciones.map((opcion) => (
        <option key={opcion} value={opcion}>
          {opcion}
        </option>
      ))}
    </select>
  )
}
