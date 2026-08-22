// La planilla del mes: la pantalla donde se trabaja todos los días. Es la hoja de Excel de siempre,
// con el semáforo calculado solo y las tres acciones de un clic (avisar, registrar pago, dar de baja).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calcularAlerta,
  nombreDePeriodo,
  NOMBRE_COLOR,
  ORDEN_COLORES,
  type Alerta,
  type ColorAlerta,
} from '../../../shared/semaforo'
import type { CampoEditable, FilaCartera, PlanillaDelMes as DatosPlanilla } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta as Aviso, Boton, Cargando, cx } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoBaja } from './DialogoBaja'
import { DialogoPago } from './DialogoPago'
import { PanelDetalle } from './PanelDetalle'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'

/** Fila con su alerta ya calculada: se calcula una vez por render, no por celda. */
interface FilaConAlerta {
  fila: FilaCartera
  alerta: Alerta
}

const CLASES_COLOR: Record<ColorAlerta, string> = {
  verde: 'bg-green-100 text-green-800 border-green-200',
  azul: 'bg-sky-100 text-sky-800 border-sky-200',
  amarillo: 'bg-amber-100 text-amber-900 border-amber-200',
  naranja: 'bg-orange-200 text-orange-900 border-orange-300',
  rojo: 'bg-red-100 text-red-800 border-red-200',
  neutro: 'bg-slate-100 text-slate-500 border-slate-200',
}

const PUNTO_COLOR: Record<ColorAlerta, string> = {
  verde: 'bg-green-500',
  azul: 'bg-sky-500',
  amarillo: 'bg-amber-400',
  naranja: 'bg-orange-500',
  rojo: 'bg-red-500',
  neutro: 'bg-slate-300',
}

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

interface Filtros {
  busqueda: string
  sucursal: string
  formaPago: string
  compania: string
  color: string
  soloAvisarVto: boolean
}

const FILTROS_VACIOS: Filtros = { busqueda: '', sucursal: '', formaPago: '', compania: '', color: '', soloAvisarVto: false }

export function PlanillaDelMes() {
  const usuario = useUsuarioActual()
  const puedeCerrarMes = usuario.rol !== 'EMPLEADO'

  const [datos, setDatos] = useState<DatosPlanilla | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ filaId: string; campo: CampoEditable } | null>(null)
  const [pagoDe, setPagoDe] = useState<FilaCartera | null>(null)
  const [bajaDe, setBajaDe] = useState<FilaCartera | null>(null)
  const [cerrando, setCerrando] = useState(false)

  const cargar = useCallback(async (periodo: string | null) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.cartera.planilla(periodo)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  /** Reemplaza una fila en memoria después de editarla, sin recargar las 2.300. */
  const reemplazar = useCallback((fila: FilaCartera) => {
    setDatos((previo) => (previo ? { ...previo, filas: previo.filas.map((f) => (f.filaId === fila.filaId ? fila : f)) } : previo))
  }, [])

  const quitar = useCallback((filaId: string) => {
    setDatos((previo) => (previo ? { ...previo, filas: previo.filas.filter((f) => f.filaId !== filaId) } : previo))
  }, [])

  const conAlerta = useMemo<FilaConAlerta[]>(() => {
    if (!datos) return []
    return datos.filas.map((fila) => ({
      fila,
      alerta: calcularAlerta(
        {
          periodo: fila.periodo,
          diaVencimiento: fila.diaVencimientoNumero,
          pagada: Boolean(fila.pagoFecha) || fila.pagoRegistrado,
          formaPago: fila.formaPago,
          diasCobertura: fila.diasCobertura,
        },
        datos.hoy,
      ),
    }))
  }, [datos])

  const filtradas = useMemo(() => {
    const busqueda = normalizar(filtros.busqueda)
    return conAlerta.filter(({ fila, alerta }) => {
      if (busqueda) {
        const enTexto =
          normalizar(fila.nombre).includes(busqueda) ||
          normalizar(fila.patente).includes(busqueda) ||
          normalizar(fila.numeroPoliza).includes(busqueda) ||
          normalizar(fila.documento).includes(busqueda)
        if (!enTexto) return false
      }
      if (filtros.sucursal && normalizar(fila.sucursal) !== normalizar(filtros.sucursal)) return false
      if (filtros.formaPago && normalizar(fila.formaPago) !== normalizar(filtros.formaPago)) return false
      if (filtros.compania && normalizar(fila.compania) !== normalizar(filtros.compania)) return false
      if (filtros.color && alerta.color !== filtros.color) return false
      if (filtros.soloAvisarVto && normalizar(fila.avisarVto) !== 'AVISAR') return false
      return true
    })
  }, [conAlerta, filtros])

  const contadores = useMemo(() => {
    const hoy = datos?.hoy ?? ''
    let vencenHoy = 0
    let vencidos = 0
    let avisadosHoy = 0
    let pagadosHoy = 0
    for (const { fila, alerta } of conAlerta) {
      const pagada = Boolean(fila.pagoFecha) || fila.pagoRegistrado
      if (!pagada && alerta.diasParaVencer === 0) vencenHoy++
      if (!pagada && alerta.diasParaVencer !== null && alerta.diasParaVencer < 0) vencidos++
      if ((fila.fechaEnvio ?? '').startsWith(hoy)) avisadosHoy++
      if (fila.pagoFecha === hoy) pagadosHoy++
    }
    return { total: conAlerta.length, vencenHoy, vencidos, avisadosHoy, pagadosHoy }
  }, [conAlerta, datos])

  const filaSeleccionada = useMemo(
    () => (seleccionada ? (datos?.filas.find((f) => f.filaId === seleccionada) ?? null) : null),
    [datos, seleccionada],
  )

  const soloLectura = datos?.soloLectura ?? false

  // --- Acciones -------------------------------------------------------------

  const guardarCelda = useCallback(
    async (filaId: string, campo: CampoEditable, valor: string) => {
      setEditando(null)
      const resultado = await window.dm.cartera.editarCelda(filaId, campo, valor)
      if (resultado.ok) reemplazar(resultado.datos)
      else setError(resultado.error)
    },
    [reemplazar],
  )

  const avisar = useCallback(
    async (fila: FilaCartera) => {
      setError(null)
      setAviso(null)
      const resultado = await window.dm.cartera.prepararAviso(fila.filaId)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      reemplazar(resultado.datos.fila)
      const abierto = await window.dm.sistema.abrirEnlace(resultado.datos.url)
      if (!abierto.ok) setError(abierto.error)
      else setAviso(`WhatsApp abierto para ${resultado.datos.fila.nombre ?? 'el cliente'}. La fila quedó como ENVIADO.`)
    },
    [reemplazar],
  )

  const cerrarMes = useCallback(async () => {
    setCerrando(true)
    setError(null)
    const resultado = await window.dm.cartera.cerrarMes()
    if (resultado.ok) {
      setAviso(`Se abrió ${nombreDePeriodo(resultado.datos.periodo)} con ${resultado.datos.filasCreadas} pólizas.`)
      await cargar(resultado.datos.periodo)
    } else {
      setError(resultado.error)
    }
    setCerrando(false)
  }, [cargar])

  // --- Columnas -------------------------------------------------------------

  const columnas = useMemo<Array<ColumnaTabla<FilaConAlerta>>>(() => {
    const celdaEditable = (campo: CampoEditable, opciones?: string[]) => (entrada: FilaConAlerta) => (
      <Celda
        fila={entrada.fila}
        campo={campo}
        opciones={opciones}
        editando={editando?.filaId === entrada.fila.filaId && editando.campo === campo}
        soloLectura={soloLectura}
        alEditar={() => setEditando({ filaId: entrada.fila.filaId, campo })}
        alCancelar={() => setEditando(null)}
        alGuardar={(valor) => void guardarCelda(entrada.fila.filaId, campo, valor)}
      />
    )
    const catalogos = datos?.catalogos

    return [
      {
        id: 'alerta',
        titulo: 'Alerta',
        ancho: 142,
        fija: true,
        celda: ({ alerta }) => (
          <span
            title={alerta.detalle}
            className={cx('inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-xs font-semibold', CLASES_COLOR[alerta.color])}
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full', PUNTO_COLOR[alerta.color])} aria-hidden="true" />
            <span className="truncate">{alerta.etiqueta || NOMBRE_COLOR[alerta.color]}</span>
          </span>
        ),
      },
      {
        id: 'acciones',
        titulo: 'Acciones',
        ancho: 108,
        fija: true,
        celda: ({ fila }) => (
          <div className="flex items-center gap-0.5">
            <BotonAccion titulo="Avisar por WhatsApp" icono="mensaje" disabled={soloLectura} onClick={() => void avisar(fila)} />
            <BotonAccion titulo="Registrar pago" icono="billete" disabled={soloLectura} onClick={() => setPagoDe(fila)} />
            <BotonAccion titulo="Dar de baja" icono="cerrar" disabled={soloLectura} peligro onClick={() => setBajaDe(fila)} />
          </div>
        ),
      },
      { id: 'sucursal', titulo: 'Sucursal', ancho: 120, fija: true, celda: celdaEditable('sucursal', catalogos?.sucursales) },
      { id: 'nombre', titulo: 'Nombre y apellido', ancho: 240, fija: true, celda: celdaEditable('nombre') },
      { id: 'telefono', titulo: 'Teléfono', ancho: 130, celda: celdaEditable('telefono') },
      { id: 'documento', titulo: 'DNI/CUIT', ancho: 110, celda: celdaEditable('documento') },
      { id: 'vencimiento', titulo: 'Fecha de venc', ancho: 100, alinear: 'centro', celda: celdaEditable('diaVencimiento') },
      { id: 'cuota', titulo: 'Cuota', ancho: 100, alinear: 'derecha', celda: celdaEditable('cuota') },
      { id: 'formaPago', titulo: 'Forma de pago', ancho: 130, celda: celdaEditable('formaPago', catalogos?.formasDePago) },
      { id: 'aviso', titulo: 'OB. avisos', ancho: 150, celda: celdaEditable('aviso') },
      { id: 'vehiculo', titulo: 'Vehículo', ancho: 90, celda: celdaEditable('vehiculo', catalogos?.tiposDeVehiculo) },
      { id: 'marca', titulo: 'Marca', ancho: 120, celda: celdaEditable('marca') },
      { id: 'modelo', titulo: 'Modelo', ancho: 200, celda: celdaEditable('modelo') },
      { id: 'patente', titulo: 'Patente', ancho: 100, celda: celdaEditable('patente') },
      { id: 'anio', titulo: 'Año', ancho: 70, alinear: 'centro', celda: celdaEditable('anio') },
      { id: 'cobertura', titulo: 'Cobertura', ancho: 160, celda: celdaEditable('cobertura', catalogos?.coberturas) },
      { id: 'compania', titulo: 'Compañía', ancho: 140, celda: celdaEditable('compania', catalogos?.companias) },
      { id: 'poliza', titulo: 'Póliza', ancho: 120, celda: celdaEditable('numeroPoliza') },
      { id: 'desde', titulo: 'Desde', ancho: 100, celda: celdaEditable('vigenciaDesde') },
      { id: 'hasta', titulo: 'Hasta', ancho: 100, celda: celdaEditable('vigenciaHasta') },
      { id: 'observaciones', titulo: 'Observaciones', ancho: 240, celda: celdaEditable('observaciones') },
    ]
  }, [avisar, datos, editando, guardarCelda, soloLectura])

  if (cargando && !datos) return <Cargando texto="Abriendo la planilla…" />

  if (!datos || datos.periodos.length === 0) {
    return (
      <div className="p-8">
        <Aviso tono="info">
          Todavía no hay ninguna planilla cargada. Andá a <strong className="font-semibold">Administración → Importar desde Google</strong> para traer la hoja.
        </Aviso>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={datos.periodo}
            onChange={(evento) => void cargar(evento.target.value)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {datos.periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {nombreDePeriodo(p.periodo)} · {p.filas} filas{p.esElActual ? ' (abierto)' : ''}
              </option>
            ))}
          </select>
        </label>

        {soloLectura && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            <Icono nombre="candado" tamano={13} />
            Mes cerrado · sólo lectura
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(datos.periodo)} disabled={cargando}>
            Actualizar
          </Boton>
          {puedeCerrarMes && (
            <Boton variante="primario" icono="mas" onClick={() => void cerrarMes()} cargando={cerrando}>
              Cerrar mes
            </Boton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador etiqueta="Total" valor={contadores.total} />
        <Contador etiqueta="Vencen hoy" valor={contadores.vencenHoy} tono="rojo" />
        <Contador etiqueta="Vencidos" valor={contadores.vencidos} tono="rojo" titulo="Ya pasó el día de vencimiento y no figuran pagos. Los que todavía están dentro de la cobertura financiera de su compañía se ven en amarillo o naranja." />
        <Contador etiqueta="Avisados hoy" valor={contadores.avisadosHoy} tono="azul" />
        <Contador etiqueta="Pagados hoy" valor={contadores.pagadosHoy} tono="verde" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(evento) => setFiltros((f) => ({ ...f, busqueda: evento.target.value }))}
            placeholder="Buscar por nombre, patente, póliza o DNI…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <FiltroDesplegable etiqueta="Sucursal" valor={filtros.sucursal} opciones={datos.catalogos.sucursales} alCambiar={(v) => setFiltros((f) => ({ ...f, sucursal: v }))} />
        <FiltroDesplegable etiqueta="Forma de pago" valor={filtros.formaPago} opciones={datos.catalogos.formasDePago} alCambiar={(v) => setFiltros((f) => ({ ...f, formaPago: v }))} />
        <FiltroDesplegable etiqueta="Compañía" valor={filtros.compania} opciones={datos.catalogos.companias} alCambiar={(v) => setFiltros((f) => ({ ...f, compania: v }))} />
        <FiltroDesplegable
          etiqueta="Alerta"
          valor={filtros.color}
          opciones={ORDEN_COLORES.map((c) => c)}
          textoDe={(c) => NOMBRE_COLOR[c as ColorAlerta]}
          alCambiar={(v) => setFiltros((f) => ({ ...f, color: v }))}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filtros.soloAvisarVto}
            onChange={(evento) => setFiltros((f) => ({ ...f, soloAvisarVto: evento.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Sólo con AVISAR VTO
        </label>
        {(filtros.busqueda || filtros.sucursal || filtros.formaPago || filtros.compania || filtros.color || filtros.soloAvisarVto) && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setFiltros(FILTROS_VACIOS)}>
            Limpiar
          </Boton>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {filtradas.length.toLocaleString('es-AR')} de {contadores.total.toLocaleString('es-AR')} filas
        </span>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="exito">{aviso}</Aviso>}

      <div className="flex min-h-0 flex-1 gap-3">
        <TablaVirtual
          filas={filtradas}
          columnas={columnas}
          claveDe={({ fila }) => fila.filaId}
          filaSeleccionada={seleccionada}
          alHacerClic={({ fila }) => setSeleccionada((previa) => (previa === fila.filaId ? null : fila.filaId))}
          vacio="Ninguna fila coincide con los filtros."
        />
        {filaSeleccionada && (
          <PanelDetalle
            fila={filaSeleccionada}
            soloLectura={soloLectura}
            alCerrar={() => setSeleccionada(null)}
            alGuardar={(campo, valor) => void guardarCelda(filaSeleccionada.filaId, campo, valor)}
          />
        )}
      </div>

      <DialogoPago
        fila={pagoDe}
        mediosDePago={datos.catalogos.mediosDePago}
        hoy={datos.hoy}
        alCerrar={() => setPagoDe(null)}
        alGuardar={(fila) => {
          reemplazar(fila)
          setPagoDe(null)
          setAviso(`Pago registrado para ${fila.nombre ?? 'el cliente'}.`)
        }}
        alFallar={setError}
      />
      <DialogoBaja
        fila={bajaDe}
        alCerrar={() => setBajaDe(null)}
        alDarDeBaja={(filaId, nombre) => {
          quitar(filaId)
          setBajaDe(null)
          setSeleccionada(null)
          setAviso(`${nombre} pasó a Bajas de ${nombreDePeriodo(datos.periodo)}.`)
        }}
        alFallar={setError}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Contador({ etiqueta, valor, tono = 'neutro', titulo }: { etiqueta: string; valor: number; tono?: 'neutro' | 'rojo' | 'azul' | 'verde'; titulo?: string }) {
  const clases = {
    neutro: 'border-slate-200 bg-white text-slate-900',
    rojo: 'border-red-200 bg-red-50 text-red-800',
    azul: 'border-sky-200 bg-sky-50 text-sky-800',
    verde: 'border-green-200 bg-green-50 text-green-800',
  }[tono]
  return (
    <div title={titulo} className={cx('rounded-lg border px-3 py-1.5', clases)}>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </div>
  )
}

function FiltroDesplegable({
  etiqueta,
  valor,
  opciones,
  textoDe,
  alCambiar,
}: {
  etiqueta: string
  valor: string
  opciones: string[]
  textoDe?: (valor: string) => string
  alCambiar: (valor: string) => void
}) {
  return (
    <select
      value={valor}
      onChange={(evento) => alCambiar(evento.target.value)}
      aria-label={etiqueta}
      className={cx(
        'h-9 rounded-lg border bg-white px-2 text-sm',
        valor ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700',
      )}
    >
      <option value="">{etiqueta}: todas</option>
      {opciones.map((opcion) => (
        <option key={opcion} value={opcion}>
          {textoDe ? textoDe(opcion) : opcion}
        </option>
      ))}
    </select>
  )
}

function BotonAccion({
  titulo,
  icono,
  onClick,
  disabled,
  peligro,
}: {
  titulo: string
  icono: 'mensaje' | 'billete' | 'cerrar'
  onClick: () => void
  disabled?: boolean
  peligro?: boolean
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={disabled}
      onClick={(evento) => {
        evento.stopPropagation()
        onClick()
      }}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        peligro
          ? 'border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700'
          : 'border-slate-200 text-slate-500 hover:border-marino-300 hover:bg-marino-50 hover:text-marino-700',
      )}
    >
      <Icono nombre={icono} tamano={14} />
    </button>
  )
}

/** Celda de la planilla: texto hasta que se hace doble clic, y ahí se edita en el lugar. */
function Celda({
  fila,
  campo,
  opciones,
  editando,
  soloLectura,
  alEditar,
  alCancelar,
  alGuardar,
}: {
  fila: FilaCartera
  campo: CampoEditable
  opciones?: string[]
  editando: boolean
  soloLectura: boolean
  alEditar: () => void
  alCancelar: () => void
  alGuardar: (valor: string) => void
}) {
  const valor = (fila[campo as keyof FilaCartera] as string | null) ?? ''
  const entrada = useRef<HTMLInputElement | null>(null)
  const idLista = `lista-${campo}`

  useEffect(() => {
    if (editando) {
      entrada.current?.focus()
      entrada.current?.select()
    }
  }, [editando])

  if (!editando) {
    return (
      <span
        onDoubleClick={
          soloLectura
            ? undefined
            : (evento) => {
                evento.stopPropagation()
                alEditar()
              }
        }
        title={valor || undefined}
        className={cx('block w-full truncate', !soloLectura && 'cursor-text')}
      >
        {valor}
      </span>
    )
  }

  return (
    <>
      <input
        ref={entrada}
        defaultValue={valor}
        list={opciones && opciones.length > 0 ? idLista : undefined}
        onClick={(evento) => evento.stopPropagation()}
        onBlur={(evento) => alGuardar(evento.currentTarget.value)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter') alGuardar(evento.currentTarget.value)
          if (evento.key === 'Escape') alCancelar()
        }}
        className="w-full rounded border border-marino-400 bg-white px-1 py-0.5 text-sm outline-none ring-2 ring-marino-500/30"
      />
      {opciones && opciones.length > 0 && (
        <datalist id={idLista}>
          {opciones.map((opcion) => (
            <option key={opcion} value={opcion} />
          ))}
        </datalist>
      )}
    </>
  )
}
