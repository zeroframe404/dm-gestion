// Bajas del mes elegido, igual que la hoja BAJAS: quién se fue, por qué y cuándo.
//
// Dos cosas que la pantalla resuelve y que antes no estaban:
//  - Una baja guarda TODO lo que la fila tenía en la cartera, no sólo el nombre y el motivo. La tabla
//    sigue siendo corta (es la que se lee de un vistazo) y el resto se abre en el panel de la derecha,
//    igual que en la planilla del mes.
//  - «Poner vigente» devuelve la póliza a la cartera sin cargarla de nuevo: es el caso del cliente que
//    se dio de baja en julio y vuelve en septiembre.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { NOMBRE_MOTIVO_BAJA, type FilaBaja, type MotivoDeBaja, type PeriodoCartera } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Dialogo, Etiqueta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useNavegacion } from '../../contexto/Navegacion'
import { useUsuarioActual } from '../../contexto/Sesion'

/** Se compara sin tildes, sin mayúsculas y sin puntuación: «ABC 123» encuentra a «abc-123». */
function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/** Los mismos grupos que el panel de la planilla del mes, para que la baja se lea igual que la fila. */
const GRUPOS: Array<{ titulo: string; campos: Array<{ campo: keyof FilaBaja; etiqueta: string }> }> = [
  {
    titulo: 'Cliente',
    campos: [
      { campo: 'clienteNombre', etiqueta: 'Nombre y apellido' },
      { campo: 'documento', etiqueta: 'DNI/CUIT' },
      { campo: 'telefono', etiqueta: 'Teléfono' },
      { campo: 'email', etiqueta: 'Email' },
      { campo: 'direccion', etiqueta: 'Dirección' },
      { campo: 'localidad', etiqueta: 'Localidad' },
      { campo: 'sucursal', etiqueta: 'Sucursal' },
    ],
  },
  {
    titulo: 'Vehículo',
    campos: [
      { campo: 'vehiculo', etiqueta: 'Vehículo' },
      { campo: 'marca', etiqueta: 'Marca' },
      { campo: 'modelo', etiqueta: 'Modelo' },
      { campo: 'anio', etiqueta: 'Año' },
      { campo: 'patente', etiqueta: 'Patente' },
      { campo: 'motor', etiqueta: 'Motor' },
      { campo: 'chasis', etiqueta: 'Chasis' },
      { campo: 'uso', etiqueta: 'Uso' },
      { campo: 'color', etiqueta: 'Color' },
    ],
  },
  {
    titulo: 'Póliza',
    campos: [
      { campo: 'compania', etiqueta: 'Compañía' },
      { campo: 'numeroPoliza', etiqueta: 'Póliza' },
      { campo: 'propuesta', etiqueta: 'Propuesta' },
      { campo: 'cobertura', etiqueta: 'Cobertura' },
      { campo: 'prima', etiqueta: 'Prima' },
      { campo: 'productor', etiqueta: 'Productor' },
      { campo: 'vigenciaDesde', etiqueta: 'Desde' },
      { campo: 'vigenciaHasta', etiqueta: 'Hasta' },
      { campo: 'alta', etiqueta: 'Alta' },
    ],
  },
  {
    titulo: 'Cómo estaba el mes',
    campos: [
      { campo: 'cuota', etiqueta: 'Cuota' },
      { campo: 'diaVencimiento', etiqueta: 'Fecha de venc' },
      { campo: 'formaPago', etiqueta: 'Forma de pago' },
      { campo: 'observaciones', etiqueta: 'Observaciones' },
    ],
  },
  {
    titulo: 'La baja',
    campos: [
      { campo: 'motivo', etiqueta: 'Motivo' },
      { campo: 'nota', etiqueta: 'Nota' },
      { campo: 'fechaBaja', etiqueta: 'Fecha' },
    ],
  },
]

export function Bajas() {
  const usuario = useUsuarioActual()
  const { ir } = useNavegacion()
  const puedeEditarCartera = usePuedeEditar('cartera')
  // Deshacer y poner vigente mueven la planilla de todos: como cerrar el mes, piden administrador.
  const esAdministrador = usuario.rol !== 'EMPLEADO' && puedeEditarCartera

  const [periodos, setPeriodos] = useState<PeriodoCartera[]>([])
  const [periodo, setPeriodo] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaBaja[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [seleccionada, setSeleccionada] = useState<number | null>(null)
  const [aReactivar, setAReactivar] = useState<FilaBaja | null>(null)
  const [reactivando, setReactivando] = useState(false)

  const cargar = useCallback(async (elegido: string | null) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.cartera.bajas(elegido)
    if (resultado.ok) setFilas(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    let vigente = true
    void window.dm.cartera.planilla(null).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) {
        setPeriodos(resultado.datos.periodos)
        const inicial = resultado.datos.periodo
        setPeriodo(inicial)
        void cargar(inicial)
      } else {
        setError(resultado.error)
        setCargando(false)
      }
    })
    return () => {
      vigente = false
    }
  }, [cargar])

  // El buscador es de memoria: las bajas de un mes son pocas y ya están todas acá.
  const visibles = useMemo(() => {
    const texto = normalizar(busqueda)
    if (!texto) return filas
    return filas.filter((baja) =>
      [baja.clienteNombre, baja.documento, baja.numeroPoliza, baja.patente, baja.compania, baja.sucursal, baja.telefono].some((valor) =>
        normalizar(valor).includes(texto),
      ),
    )
  }, [busqueda, filas])

  const detalle = useMemo(() => filas.find((f) => f.id === seleccionada) ?? null, [filas, seleccionada])

  const deshacer = async (baja: FilaBaja) => {
    setError(null)
    setAviso(null)
    const resultado = await window.dm.cartera.deshacerBaja(baja.id)
    if (resultado.ok) {
      setFilas(resultado.datos)
      setSeleccionada(null)
      setAviso(`${baja.clienteNombre ?? 'La póliza'} volvió a la planilla del mes.`)
    } else {
      setError(resultado.error)
    }
  }

  const reactivar = async (baja: FilaBaja) => {
    setError(null)
    setAviso(null)
    setReactivando(true)
    const resultado = await window.dm.cartera.reactivarBaja(baja.id)
    setReactivando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setFilas(resultado.datos.bajas)
    setSeleccionada(null)
    setAReactivar(null)
    setAviso(
      `${resultado.datos.clienteNombre} volvió a estar vigente en ${nombreDePeriodo(resultado.datos.periodo)}. ` +
        (resultado.datos.filaNueva
          ? 'Se le creó la fila del mes con los últimos datos que tenía: corregí la cuota y lo que haya cambiado en la planilla.'
          : 'Su fila volvió a la planilla del mes.'),
    )
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={periodo ?? ''}
            onChange={(evento) => {
              setPeriodo(evento.target.value)
              setSeleccionada(null)
              void cargar(evento.target.value)
            }}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {nombreDePeriodo(p.periodo)}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Bajas del mes</span>
          <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">{filas.length.toLocaleString('es-AR')}</span>
        </div>

        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por nombre, patente, póliza o DNI…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        {busqueda && (
          <>
            <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
              Limpiar
            </Boton>
            <span className="text-sm text-slate-500">
              {visibles.length.toLocaleString('es-AR')} de {filas.length.toLocaleString('es-AR')} bajas
            </span>
          </>
        )}
        <p className="ml-auto text-sm text-slate-500">Hacé clic en una baja para ver todos sus datos.</p>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {cargando ? (
        <Cargando />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className={encabezado}>Nombre</th>
                  <th className={encabezado}>DNI/CUIT</th>
                  <th className={encabezado}>Compañía</th>
                  <th className={encabezado}>Póliza</th>
                  <th className={encabezado}>Patente</th>
                  <th className={encabezado}>Vehículo</th>
                  <th className={encabezado}>Cuota</th>
                  <th className={encabezado}>Sucursal</th>
                  <th className={encabezado}>Motivo</th>
                  <th className={encabezado}>Fecha</th>
                  <th className={encabezado} />
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                      {filas.length === 0
                        ? `No hay bajas cargadas en ${periodo ? nombreDePeriodo(periodo) : 'este mes'}.`
                        : `Ninguna baja de ${periodo ? nombreDePeriodo(periodo) : 'este mes'} coincide con «${busqueda}».`}
                    </td>
                  </tr>
                )}
                {visibles.map((baja) => (
                  <tr
                    key={baja.id}
                    onClick={() => setSeleccionada((previa) => (previa === baja.id ? null : baja.id))}
                    className={cx(
                      'cursor-pointer border-b border-slate-100 last:border-b-0',
                      seleccionada === baja.id ? 'bg-marino-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-slate-900">{baja.clienteNombre ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{baja.documento ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{baja.compania ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{baja.numeroPoliza ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{baja.patente ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{[baja.marca, baja.modelo].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{baja.cuota ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{baja.sucursal ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {baja.motivo ? (NOMBRE_MOTIVO_BAJA[baja.motivo as MotivoDeBaja] ?? baja.motivo) : <span className="text-slate-400">sin motivo</span>}
                      {baja.nota && <p className="text-xs text-slate-500">{baja.nota}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{baja.fechaBaja ?? '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(evento) => evento.stopPropagation()}>
                      {esAdministrador && baja.puedeReactivarse ? (
                        <Boton tamano="sm" icono="ok" onClick={() => setAReactivar(baja)}>
                          Poner vigente
                        </Boton>
                      ) : (
                        <Etiqueta tono="neutro">{baja.hechaEnLaApp ? 'En la app' : 'De la hoja'}</Etiqueta>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detalle && (
            <PanelDeBaja
              baja={detalle}
              puedeDeshacer={esAdministrador && detalle.hechaEnLaApp}
              puedeReactivar={esAdministrador && detalle.puedeReactivarse}
              alCerrar={() => setSeleccionada(null)}
              alDeshacer={() => void deshacer(detalle)}
              alReactivar={() => setAReactivar(detalle)}
              alVerCliente={detalle.clienteId === null ? null : () => ir('clientes', { clienteId: detalle.clienteId! })}
            />
          )}
        </div>
      )}

      <DialogoPonerVigente
        baja={aReactivar}
        guardando={reactivando}
        alCerrar={() => setAReactivar(null)}
        alConfirmar={() => aReactivar && void reactivar(aReactivar)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/** Todo lo que la fila tenía en la cartera el día que se fue. Es de sólo lectura: una baja es historia. */
function PanelDeBaja({
  baja,
  puedeDeshacer,
  puedeReactivar,
  alCerrar,
  alDeshacer,
  alReactivar,
  alVerCliente,
}: {
  baja: FilaBaja
  puedeDeshacer: boolean
  puedeReactivar: boolean
  alCerrar: () => void
  alDeshacer: () => void
  alReactivar: () => void
  alVerCliente: (() => void) | null
}) {
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-slate-900">{baja.clienteNombre ?? 'Sin nombre'}</p>
          <p className="truncate text-xs text-slate-500">
            {baja.compania ?? '—'} · {baja.numeroPoliza ?? 'sin póliza'} · {baja.patente ?? 'sin patente'}
          </p>
        </div>
        <button type="button" aria-label="Cerrar el detalle" onClick={alCerrar} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Icono nombre="cerrar" tamano={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {GRUPOS.map((grupo) => {
          const conDatos = grupo.campos.filter(({ campo }) => {
            const valor = baja[campo]
            return typeof valor === 'string' && valor.trim() !== ''
          })
          // Un grupo entero vacío no se muestra: en una baja vieja de la hoja pasa, y siete renglones
          // con guiones no dicen nada.
          if (conDatos.length === 0) return null
          return (
            <section key={grupo.titulo} className="mb-4">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{grupo.titulo}</p>
              <dl className="flex flex-col gap-1">
                {conDatos.map(({ campo, etiqueta }) => (
                  <div key={String(campo)} className="grid grid-cols-[9rem_1fr] items-start gap-2">
                    <dt className="truncate text-xs text-slate-500">{etiqueta}</dt>
                    <dd className="text-sm break-words text-slate-800">
                      {campo === 'motivo'
                        ? (NOMBRE_MOTIVO_BAJA[baja.motivo as MotivoDeBaja] ?? baja.motivo)
                        : (baja[campo] as string)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
        {alVerCliente && (
          <Boton tamano="sm" variante="fantasma" icono="enlace" onClick={alVerCliente}>
            Ver el cliente
          </Boton>
        )}
        {puedeDeshacer && (
          <Boton tamano="sm" variante="fantasma" onClick={alDeshacer}>
            Deshacer
          </Boton>
        )}
        {puedeReactivar && (
          <Boton tamano="sm" variante="primario" icono="ok" onClick={alReactivar}>
            Poner vigente
          </Boton>
        )}
      </footer>
    </aside>
  )
}

/** Poner vigente toca la planilla de todos: se confirma, y se dice exactamente qué va a pasar. */
function DialogoPonerVigente({
  baja,
  guardando,
  alCerrar,
  alConfirmar,
}: {
  baja: FilaBaja | null
  guardando: boolean
  alCerrar: () => void
  alConfirmar: () => void
}) {
  if (!baja) return null
  return (
    <Dialogo
      abierto
      titulo="Poner vigente la póliza"
      descripcion={[baja.clienteNombre, baja.compania, baja.numeroPoliza, baja.patente].filter(Boolean).join(' · ')}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={alConfirmar} cargando={guardando}>
            Poner vigente
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>
          La póliza vuelve a estar activa y se le pone su fila en la planilla del mes abierto, con los últimos datos que tenía. La baja
          sale de esta lista y también de la pestaña BAJAS de la hoja.
        </p>
        <p className="text-slate-500">
          Es para el cliente que se fue y volvió: no hace falta cargarlo de nuevo. Lo que haya cambiado —la cuota, la compañía, el
          vehículo— se corrige después en la planilla o en la póliza.
        </p>
      </div>
    </Dialogo>
  )
}
