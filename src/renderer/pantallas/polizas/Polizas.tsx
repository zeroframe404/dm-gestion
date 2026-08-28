// Módulo Pólizas: una fila por póliza, con la vigencia y el estado a la vista, y el alta/edición en
// la misma pantalla. No hay router, así que acá se decide qué se ve: el listado o el formulario.
// Los parámetros de navegación deciden con qué arranca (desde la ficha de un cliente se llega con
// `nuevaPolizaPara`, desde la bandeja de renovaciones con `polizaId`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DIAS_DE_RENOVACION, diasParaVencer, NOMBRE_ESTADO_POLIZA } from '../../../shared/polizas'
import type { EstadoPoliza, FiltrosPolizas, ListadoPolizas, PolizaDeCliente } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { useNavegacion } from '../../contexto/Navegacion'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'
import { FormularioPoliza } from './FormularioPoliza'
import { usePuedeEditar } from '../../contexto/Permisos'

/** Color de la etiqueta de estado. Vencida va en ámbar y no en rojo: sigue siendo cartera, hay que renovarla. */
export const TONO_DE_ESTADO: Record<EstadoPoliza, 'exito' | 'aviso' | 'neutro'> = {
  ACTIVA: 'exito',
  VENCIDA: 'aviso',
  BAJA: 'neutro',
}

const FILTROS_VACIOS: FiltrosPolizas = { busqueda: '', estado: '', compania: '', sucursal: '', cobertura: '' }

/** Qué se está mostrando. El formulario no es otra pantalla del menú: es un modo de ésta. */
type Vista = { pantalla: 'listado' } | { pantalla: 'formulario'; polizaId: number | null; clienteIdInicial: number | null }

export function Polizas() {
  const puedeEditar = usePuedeEditar('polizas')
  const { parametros, limpiarParametros } = useNavegacion()

  const [vista, setVista] = useState<Vista>({ pantalla: 'listado' })
  const [datos, setDatos] = useState<ListadoPolizas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // El texto se escribe en `texto` y recién a los 250 ms pasa a `filtros`: el listado lo resuelve el
  // proceso principal, y disparar una consulta por tecla sobre 2.400 pólizas se siente pesado.
  const [texto, setTexto] = useState('')
  const [filtros, setFiltros] = useState<FiltrosPolizas>(FILTROS_VACIOS)

  // Cada carga lleva número: si el usuario cambia un filtro mientras vuelve una consulta vieja, la
  // vieja se descarta. Si no, la tabla podría quedar mostrando el resultado del filtro anterior.
  const peticion = useRef(0)

  const cargar = useCallback(async (aplicar: FiltrosPolizas) => {
    const mia = ++peticion.current
    setCargando(true)
    const resultado = await window.dm.polizas.listar(aplicar)
    if (mia !== peticion.current) return
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(filtros)
  }, [cargar, filtros])

  useEffect(() => {
    const temporizador = setTimeout(() => {
      setFiltros((previos) => (previos.busqueda === texto ? previos : { ...previos, busqueda: texto }))
    }, 250)
    return () => clearTimeout(temporizador)
  }, [texto])

  // Los parámetros son de un solo uso: se consumen acá y se limpian, así volver a la solapa Pólizas
  // no vuelve a abrir el formulario que se abrió hace media hora.
  useEffect(() => {
    if (parametros.nuevaPolizaPara !== undefined) {
      setVista({ pantalla: 'formulario', polizaId: null, clienteIdInicial: parametros.nuevaPolizaPara })
      limpiarParametros()
    } else if (parametros.polizaId !== undefined) {
      setVista({ pantalla: 'formulario', polizaId: parametros.polizaId, clienteIdInicial: null })
      limpiarParametros()
    } else if (parametros.busqueda) {
      setTexto(parametros.busqueda)
      limpiarParametros()
    }
  }, [parametros, limpiarParametros])

  /** Vuelve al listado. Se recarga sólo cuando algo cambió: cancelar no tiene por qué pagar la consulta. */
  const volverAlListado = useCallback(
    (mensaje: string | null, recargar: boolean) => {
      setVista({ pantalla: 'listado' })
      setAviso(mensaje)
      if (recargar) void cargar(filtros)
    },
    [cargar, filtros],
  )

  const hoy = datos?.hoy ?? ''

  const columnas = useMemo<Array<ColumnaTabla<PolizaDeCliente>>>(
    () => [
      {
        id: 'cliente',
        titulo: 'Cliente',
        ancho: 230,
        fija: true,
        celda: (fila) => (
          <span className="truncate font-medium text-slate-900" title={fila.clienteNombre ?? undefined}>
            {fila.clienteNombre ?? '—'}
          </span>
        ),
      },
      {
        id: 'compania',
        titulo: 'Compañía',
        ancho: 140,
        celda: (fila) => (
          <span className="truncate" title={fila.compania ?? undefined}>
            {fila.compania ?? '—'}
          </span>
        ),
      },
      {
        id: 'numero',
        titulo: 'N.° de póliza',
        ancho: 130,
        celda: (fila) => (
          <span className="truncate font-mono text-xs" title={fila.numero ?? undefined}>
            {fila.numero ?? '—'}
          </span>
        ),
      },
      {
        id: 'cobertura',
        titulo: 'Cobertura',
        ancho: 160,
        celda: (fila) => (
          <span className="truncate" title={fila.cobertura ?? undefined}>
            {fila.cobertura ?? '—'}
          </span>
        ),
      },
      {
        id: 'vehiculo',
        titulo: 'Patente y vehículo',
        ancho: 200,
        celda: (fila) => (
          <span className="truncate" title={[fila.patente, fila.vehiculo].filter(Boolean).join(' · ') || undefined}>
            {fila.patente && <span className="font-mono text-xs font-semibold text-slate-800">{fila.patente}</span>}
            {fila.patente && fila.vehiculo && <span className="text-slate-300"> · </span>}
            {fila.vehiculo}
            {!fila.patente && !fila.vehiculo && '—'}
          </span>
        ),
      },
      {
        id: 'cuota',
        titulo: 'Cuota',
        ancho: 100,
        alinear: 'derecha',
        // Tal cual viene de la hoja: es texto libre y reformatearlo sería inventar un importe.
        celda: (fila) => <span className="truncate tabular-nums">{fila.cuota ?? '—'}</span>,
      },
      { id: 'desde', titulo: 'Desde', ancho: 100, celda: (fila) => <span className="truncate tabular-nums">{fila.vigenciaDesde ?? '—'}</span> },
      { id: 'hasta', titulo: 'Hasta', ancho: 100, celda: (fila) => <span className="truncate tabular-nums">{fila.vigenciaHasta ?? '—'}</span> },
      {
        id: 'sucursal',
        titulo: 'Sucursal',
        ancho: 120,
        celda: (fila) => (
          <span className="truncate" title={fila.sucursal ?? undefined}>
            {fila.sucursal ?? '—'}
          </span>
        ),
      },
      {
        id: 'estado',
        titulo: 'Estado',
        ancho: 190,
        celda: (fila) => {
          // La fila ya trae `diasParaVencer` del servicio, pero se recalcula con el helper compartido y
          // el `hoy` del listado: así lo que dice esta columna no puede discrepar de la bandeja de
          // renovaciones, que usa exactamente la misma función.
          const dias = diasParaVencer(fila.vigenciaHastaIso, hoy) ?? fila.diasParaVencer
          const porVencer = fila.estado === 'ACTIVA' && dias !== null && dias <= DIAS_DE_RENOVACION
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Etiqueta tono={TONO_DE_ESTADO[fila.estado]}>{NOMBRE_ESTADO_POLIZA[fila.estado]}</Etiqueta>
              {dias !== null && porVencer && (
                <span
                  className={cx('truncate text-xs font-semibold tabular-nums', dias <= 15 ? 'text-amber-700' : 'text-slate-500')}
                  title={`Vence el ${fila.vigenciaHasta ?? fila.vigenciaHastaIso ?? ''}`}
                >
                  {dias === 0 ? 'vence hoy' : dias === 1 ? 'vence mañana' : `vence en ${dias} días`}
                </span>
              )}
            </span>
          )
        },
      },
    ],
    [hoy],
  )

  if (vista.pantalla === 'formulario') {
    return (
      <FormularioPoliza
        polizaId={vista.polizaId}
        clienteIdInicial={vista.clienteIdInicial}
        alCerrar={() => volverAlListado(null, false)}
        alGuardar={(poliza) =>
          volverAlListado(
            vista.polizaId === null
              ? `Se cargó la póliza de ${poliza.clienteNombre ?? 'el cliente'}${poliza.numero ? ` (N.° ${poliza.numero})` : ''}.`
              : `Se guardaron los cambios de la póliza de ${poliza.clienteNombre ?? 'el cliente'}.`,
            true,
          )
        }
        alDarDeBaja={(nombre) => volverAlListado(`La póliza de ${nombre} quedó dada de baja.`, true)}
      />
    )
  }

  if (cargando && !datos) return <Cargando texto="Abriendo las pólizas…" />

  const hayFiltros = Boolean(filtros.busqueda || filtros.estado || filtros.compania || filtros.sucursal || filtros.cobertura)
  const catalogos = datos?.catalogos

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Pólizas</span>
          <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">
            {(datos?.total ?? 0).toLocaleString('es-AR')}
          </span>
        </div>
        <p className="max-w-xl text-sm text-slate-500">Una fila por póliza. Hacé clic en cualquiera para abrirla y editarla.</p>
        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(filtros)} disabled={cargando}>
            Actualizar
          </Boton>
          {puedeEditar && (
            <Boton
              variante="primario"
              icono="mas"
              onClick={() => setVista({ pantalla: 'formulario', polizaId: null, clienteIdInicial: null })}
            >
              Nueva póliza
            </Boton>
          )}
          <BotonAyuda clave="polizas" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <input
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            aria-label="Buscar pólizas"
            placeholder="Buscar por cliente, DNI/CUIT, N.° de póliza o patente…"
            className="h-9 w-96 rounded-lg border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <FiltroDesplegable
          etiqueta="Estado"
          valor={filtros.estado}
          opciones={['ACTIVA', 'VENCIDA', 'BAJA']}
          textoDe={(valor) => NOMBRE_ESTADO_POLIZA[valor as EstadoPoliza]}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, estado: valor as FiltrosPolizas['estado'] }))}
        />
        <FiltroDesplegable
          etiqueta="Compañía"
          valor={filtros.compania}
          opciones={catalogos?.companias ?? []}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, compania: valor }))}
        />
        <FiltroDesplegable
          etiqueta="Sucursal"
          valor={filtros.sucursal}
          opciones={catalogos?.sucursales ?? []}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, sucursal: valor }))}
        />
        <FiltroDesplegable
          etiqueta="Cobertura"
          valor={filtros.cobertura}
          opciones={catalogos?.coberturas ?? []}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, cobertura: valor }))}
        />
        {(hayFiltros || texto) && (
          <Boton
            tamano="sm"
            variante="fantasma"
            icono="cerrar"
            onClick={() => {
              setTexto('')
              setFiltros(FILTROS_VACIOS)
            }}
          >
            Limpiar
          </Boton>
        )}
        <span className="ml-auto text-sm text-slate-500 tabular-nums">
          {(datos?.filas.length ?? 0).toLocaleString('es-AR')} de {(datos?.total ?? 0).toLocaleString('es-AR')} pólizas
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <TablaVirtual
        filas={datos?.filas ?? []}
        columnas={columnas}
        claveDe={(fila) => String(fila.id)}
        alHacerClic={(fila) => setVista({ pantalla: 'formulario', polizaId: fila.id, clienteIdInicial: null })}
        vacio={
          hayFiltros ? (
            <>
              Ninguna póliza coincide con los filtros. Probá con menos filtros o buscá por la patente, que es lo que menos se
              escribe distinto.
            </>
          ) : (
            <>
              Todavía no hay pólizas cargadas. Traelas desde <strong className="font-semibold">Administración → Reimportar la base</strong>{' '}
              o cargá la primera con <strong className="font-semibold">Nueva póliza</strong>.
            </>
          )
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/** Filtro de una sola línea: se pinta de azul cuando está aplicado, para verlo sin leerlo. */
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
        'h-9 max-w-52 rounded-lg border bg-white px-2 text-sm',
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
