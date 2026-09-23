// Cartera → Rechazos: los débitos que rebotaron, quién avisó y a qué sucursal le toca cobrarlos.
//
// La campana de la barra superior muestra sólo lo de la sucursal de quien entró, que es lo urgente.
// Acá se ve todo, con el filtro de sucursal puesto en la propia: es la pantalla desde la que se hace el
// seguimiento (llamé, no atendió, pagó) y desde la que la administración controla que se hayan cobrado.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  ESTADOS_DE_RECHAZO,
  NOMBRE_ESTADO_RECHAZO,
  NOMBRE_MOTIVO_RECHAZO,
  type EstadoDeRechazo,
  type FiltrosRechazos,
  type ListadoRechazos,
  type MotivoDeRechazo,
} from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { RangoDeFecha } from '../../componentes/RangoDeFecha'
import { Icono } from '../../componentes/Icono'
import { BotonEliminar } from '../../componentes/BotonEliminar'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { usePermisos } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/** Rojo hasta que alguien lo abre, ámbar mientras se gestiona, verde cuando se cobró. */
const TONO_DE_ESTADO: Record<EstadoDeRechazo, 'peligro' | 'aviso' | 'exito'> = {
  PENDIENTE: 'peligro',
  VISTO: 'aviso',
  RESUELTO: 'exito',
}

export function Rechazos() {
  const usuario = useUsuarioActual()
  const permisos = usePermisos()
  const puedeSeguir = permisos.puedeEditar('cartera') || permisos.puedeEditar('polizas')

  const [datos, setDatos] = useState<ListadoRechazos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  // Arranca en la sucursal de quien entró: es lo que esa persona tiene que cobrar. Se puede sacar.
  const [filtros, setFiltros] = useState<FiltrosRechazos>({ busqueda: '', sucursales: [usuario.sucursal.nombre], estado: '' })

  const cargar = useCallback(async (aplicar: FiltrosRechazos) => {
    setCargando(true)
    const resultado = await window.dm.rechazos.listar(aplicar)
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

  const cambiarEstado = async (rechazoId: number, estado: EstadoDeRechazo) => {
    const resultado = await window.dm.rechazos.cambiarEstado(rechazoId, estado, filtros)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
  }

  // El filtro de sucursal viene armado del servicio: las cuatro de la agencia más lo que traigan los
  // avisos. Acá había un `useMemo` que le prependía la sucursal de quien entró, porque antes la lista
  // salía sólo de los rechazos cargados y la propia podía no tener ninguno todavía. Desde que la arma
  // `sucursalesParaElegir` ya está siempre, y el parche no hacía más que aparentar que la lista se
  // completaba en la pantalla.
  const sucursales = datos?.sucursales ?? []

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'
  const filas = datos?.filas ?? []

  if (cargando && !datos) return <Cargando texto="Buscando los rechazos…" />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            aria-label="Buscar rechazos"
            placeholder="Buscar por nombre, DNI, póliza, patente o teléfono…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <FiltroMultiple
          etiqueta="Sucursal"
          valores={filtros.sucursales}
          opciones={sucursales}
          alCambiar={(v) => setFiltros((f) => ({ ...f, sucursales: v }))}
        />
        <RangoDeFecha
          etiqueta="Fecha"
          desde={filtros.desde ?? ''}
          hasta={filtros.hasta ?? ''}
          alCambiar={(desde, hasta) => setFiltros((f) => ({ ...f, desde, hasta }))}
        />
        {(filtros.busqueda || filtros.sucursales.length > 0 || filtros.estado || filtros.desde || filtros.hasta) && (
          <Boton
            tamano="sm"
            variante="fantasma"
            icono="cerrar"
            onClick={() => {
              setTexto('')
              setFiltros({ busqueda: '', sucursales: [], estado: '', desde: '', hasta: '' })
            }}
          >
            Limpiar
          </Boton>
        )}
        <Boton tamano="sm" icono="cargando" onClick={() => void cargar(filtros)} disabled={cargando}>
          Actualizar
        </Boton>
        <span className="ml-auto text-sm text-slate-500 tabular-nums">
          {filas.length.toLocaleString('es-AR')} de {(datos?.total ?? 0).toLocaleString('es-AR')} avisos
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip
          etiqueta="Todos"
          valor={(datos?.porEstado.PENDIENTE ?? 0) + (datos?.porEstado.VISTO ?? 0) + (datos?.porEstado.RESUELTO ?? 0)}
          activo={filtros.estado === ''}
          alTocar={() => setFiltros((f) => ({ ...f, estado: '' }))}
        />
        {ESTADOS_DE_RECHAZO.map((estado) => (
          <Chip
            key={estado}
            etiqueta={NOMBRE_ESTADO_RECHAZO[estado]}
            valor={datos?.porEstado[estado] ?? 0}
            activo={filtros.estado === estado}
            alTocar={() => setFiltros((f) => ({ ...f, estado: f.estado === estado ? '' : estado }))}
          />
        ))}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Estado</th>
              <th className={encabezado}>Cliente</th>
              <th className={encabezado}>Teléfono</th>
              <th className={encabezado}>Compañía y póliza</th>
              <th className={encabezado}>Patente</th>
              <th className={encabezado}>Cuota</th>
              <th className={encabezado}>Qué pasó</th>
              <th className={encabezado}>Sucursal</th>
              <th className={encabezado}>Avisó</th>
              <th className={encabezado} />
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-slate-500">
                  {(datos?.total ?? 0) === 0
                    ? 'Todavía no se avisó ningún rechazo. Se avisan desde la póliza o desde la planilla del mes, con el botón «Avisar rechazo del débito».'
                    : 'Ningún aviso coincide con los filtros.'}
                </td>
              </tr>
            )}
            {filas.map((fila) => (
              <tr key={fila.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2">
                  <Etiqueta tono={TONO_DE_ESTADO[fila.estado]}>{NOMBRE_ESTADO_RECHAZO[fila.estado]}</Etiqueta>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-900">{fila.clienteNombre ?? '—'}</p>
                  <p className="text-xs text-slate-500">{fila.documento ?? 'sin DNI/CUIT'}</p>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-700">{fila.telefono ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  <p>{fila.compania ?? '—'}</p>
                  <p className="font-mono text-xs">{fila.numeroPoliza ?? '—'}</p>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{fila.patente ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700">
                  {fila.cuota ?? '—'}
                  {fila.periodo && <span className="block text-xs text-slate-500">{nombreDePeriodo(fila.periodo)}</span>}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {fila.motivo ? (NOMBRE_MOTIVO_RECHAZO[fila.motivo as MotivoDeRechazo] ?? fila.motivo) : <span className="text-slate-400">sin motivo</span>}
                  {fila.nota && <p className="text-xs text-slate-500">{fila.nota}</p>}
                  {fila.formaPago && <p className="text-xs text-slate-400">{fila.formaPago}</p>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fila.sucursal ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">
                  {fila.avisadoPor ?? '—'}
                  <span className="block text-slate-400">{fila.fecha}</span>
                  {fila.resueltoPor && <span className="block text-green-700">resolvió {fila.resueltoPor}</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1">
                    {puedeSeguir &&
                      (fila.estado === 'RESUELTO' ? (
                        <Boton tamano="sm" variante="fantasma" onClick={() => void cambiarEstado(fila.id, 'PENDIENTE')}>
                          Volver a abrir
                        </Boton>
                      ) : (
                        <Boton tamano="sm" variante="fantasma" icono="ok" onClick={() => void cambiarEstado(fila.id, 'RESUELTO')}>
                          Resuelto
                        </Boton>
                      ))}
                    <BotonEliminar tipo="rechazo" id={fila.id} etiqueta={false} alBorrar={() => void cargar(filtros)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Contador que además filtra, igual que los de la planilla del mes. */
function Chip({ etiqueta, valor, activo, alTocar }: { etiqueta: string; valor: number; activo: boolean; alTocar: () => void }) {
  return (
    <button
      type="button"
      onClick={alTocar}
      aria-pressed={activo}
      className={cx(
        'rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
        activo
          ? 'border-marino-500 bg-marino-50 text-marino-900 ring-2 ring-marino-500/25'
          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300',
      )}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </button>
  )
}
