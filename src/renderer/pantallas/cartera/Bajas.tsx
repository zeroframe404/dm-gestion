// Bajas del mes elegido, igual que la hoja BAJAS: quién se fue, por qué y cuándo.
//
// Dos cosas que la pantalla resuelve y que antes no estaban:
//  - Una baja guarda TODO lo que la fila tenía en la cartera, no sólo el nombre y el motivo. La tabla
//    sigue siendo corta (es la que se lee de un vistazo) y el resto se abre en el panel de la derecha,
//    igual que en la planilla del mes.
//  - «Poner vigente» devuelve la póliza a la cartera sin cargarla de nuevo: es el caso del cliente que
//    se dio de baja en julio y vuelve en septiembre.
//  - Los filtros son LOS MISMOS que los de la planilla del mes —sucursal, forma de pago, compañía y
//    rama, todos de varias opciones a la vez—, porque la baja es la misma fila del otro lado: quien
//    mira «ATM y Metropol en Dock Sud» en la planilla quiere mirar exactamente eso mismo acá. Lo que
//    no viaja son el semáforo y los contadores, que son del mes vivo y una baja ya no tiene.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { coincideAlguno, mismoTextoDeFiltro } from '../../../shared/filtros'
import { NOMBRE_RAMA, ramaDeVehiculo, type Rama } from '../../../shared/ramas'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { mismaSucursal } from '../../../shared/sucursales'
import type { ResultadoDeEliminacion } from '../../../shared/eliminacion'
import {
  NOMBRE_MOTIVO_BAJA,
  type CambiosDeReactivacion,
  type CatalogosCartera,
  type FilaBaja,
  type MotivoDeBaja,
  type PeriodoCartera,
} from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { Icono } from '../../componentes/Icono'
import { BotonEliminar } from '../../componentes/BotonEliminar'
import { Alerta, Boton, Campo, Cargando, cx, Dialogo, Etiqueta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useNavegacion } from '../../contexto/Navegacion'

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

/**
 * Los mismos filtros de la planilla del mes, menos los que no tienen sentido en una baja: el semáforo
 * y los contadores del día. Cada desplegable guarda una LISTA y la lista vacía es «todas».
 */
interface Filtros {
  busqueda: string
  sucursales: string[]
  formasDePago: string[]
  companias: string[]
  ramas: string[]
}

const FILTROS_VACIOS: Filtros = { busqueda: '', sucursales: [], formasDePago: [], companias: [], ramas: [] }

/** «Pick up», «Moto eléctrica»… o el texto crudo del vehículo cuando no es ninguna de las siete ramas. */
function nombreDeRama(baja: FilaBaja): string {
  const rama = ramaDeVehiculo(baja.vehiculo, baja.categoriaVehiculo)
  return rama ? NOMBRE_RAMA[rama] : (baja.vehiculo ?? '')
}

export function Bajas() {
  const { ir } = useNavegacion()
  const puedeEditarCartera = usePuedeEditar('cartera')
  // Deshacer y poner vigente piden el mismo permiso que dar de baja: editar cartera. Cualquier rol
  // que puede dar de baja puede también reactivar.
  const esAdministrador = puedeEditarCartera

  const [periodos, setPeriodos] = useState<PeriodoCartera[]>([])
  const [periodo, setPeriodo] = useState<string | null>(null)
  const [catalogos, setCatalogos] = useState<CatalogosCartera | null>(null)
  const [filas, setFilas] = useState<FilaBaja[]>([])
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
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
        // Los catálogos vienen en la misma respuesta que ya se pedía por los meses: no hay una llamada
        // más, y las opciones son EXACTAMENTE las de la planilla del mes.
        setCatalogos(resultado.datos.catalogos)
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

  /** La rama de cada baja, calculada una vez: es la misma cuenta que hace la planilla del mes. */
  const conRama = useMemo(
    () => filas.map((baja) => ({ baja, rama: ramaDeVehiculo(baja.vehiculo, baja.categoriaVehiculo) })),
    [filas],
  )

  // Se filtra en memoria: las bajas de un mes son pocas y ya están todas acá.
  const visibles = useMemo(() => {
    const texto = normalizar(filtros.busqueda)
    return conRama
      .filter(({ baja, rama }) => {
        if (
          texto &&
          ![baja.clienteNombre, baja.documento, baja.numeroPoliza, baja.patente, baja.compania, baja.sucursal, baja.telefono].some((valor) =>
            normalizar(valor).includes(texto),
          )
        ) {
          return false
        }
        // `mismaSucursal` y no el texto pelado, igual que en la planilla: es lo que mete «AVELLANEDA»
        // y «DOCKSUD» dentro de la misma opción «Dock Sud».
        if (!coincideAlguno(filtros.sucursales, baja.sucursal, mismaSucursal)) return false
        if (!coincideAlguno(filtros.formasDePago, baja.formaPago)) return false
        if (!coincideAlguno(filtros.companias, baja.compania)) return false
        if (filtros.ramas.length > 0 && !filtros.ramas.some((elegida) => (rama ? elegida === rama : mismoTextoDeFiltro(elegida, baja.vehiculo)))) return false
        return true
      })
      .map(({ baja }) => baja)
  }, [conRama, filtros])

  const hayFiltros =
    Boolean(filtros.busqueda) ||
    filtros.sucursales.length > 0 ||
    filtros.formasDePago.length > 0 ||
    filtros.companias.length > 0 ||
    filtros.ramas.length > 0

  const detalle = useMemo(() => filas.find((f) => f.id === seleccionada) ?? null, [filas, seleccionada])

  // Para los mensajes: «todos los meses» cuando no hay uno elegido, o el nombre del que sí.
  const etiquetaPeriodo = periodo === '' ? 'todos los meses' : periodo ? nombreDePeriodo(periodo) : 'este mes'

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

  const borrada = (resultado: ResultadoDeEliminacion) => {
    setError(null)
    setSeleccionada(null)
    setAviso(`Se borró de la base la baja de ${resultado.titulo}.`)
    void cargar(periodo)
  }

  const reactivar = async (baja: FilaBaja, cambios: CambiosDeReactivacion) => {
    setError(null)
    setAviso(null)
    setReactivando(true)
    const resultado = await window.dm.cartera.reactivarBaja(baja.id, cambios)
    setReactivando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setSeleccionada(null)
    setAReactivar(null)
    // Se relee con el filtro de mes que está puesto (no el de la baja): mirando «Todos los meses» tiene
    // que seguir viéndose todo, no achicarse al único mes de la baja que se acaba de reactivar.
    void cargar(periodo)
    setAviso(
      `${resultado.datos.clienteNombre} volvió a estar vigente en ${nombreDePeriodo(resultado.datos.periodo)}. ` +
        (resultado.datos.filaNueva
          ? 'Se le creó la fila del mes con los últimos datos que tenía.'
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
            {/* «Todos los meses» busca en cualquier baja, sin importar cuándo se fue: es lo que hace
                falta para encontrar —y poder reactivar— a alguien que se dio de baja hace rato. */}
            <option value="">Todos los meses</option>
            {periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {nombreDePeriodo(p.periodo)}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            {periodo === '' ? 'Bajas de todos los meses' : 'Bajas del mes'}
          </span>
          <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">{filas.length.toLocaleString('es-AR')}</span>
        </div>

        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(evento) => setFiltros((f) => ({ ...f, busqueda: evento.target.value }))}
            placeholder="Buscar por nombre, patente, póliza o DNI…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <FiltroMultiple
          etiqueta="Sucursal"
          valores={filtros.sucursales}
          opciones={catalogos?.sucursales ?? []}
          alCambiar={(v) => setFiltros((f) => ({ ...f, sucursales: v }))}
        />
        <FiltroMultiple
          etiqueta="Forma de pago"
          valores={filtros.formasDePago}
          opciones={catalogos?.formasDePago ?? []}
          alCambiar={(v) => setFiltros((f) => ({ ...f, formasDePago: v }))}
        />
        <FiltroMultiple
          etiqueta="Compañía"
          valores={filtros.companias}
          opciones={catalogos?.companias ?? []}
          alCambiar={(v) => setFiltros((f) => ({ ...f, companias: v }))}
        />
        <FiltroMultiple
          etiqueta="Rama"
          valores={filtros.ramas}
          opciones={catalogos?.ramas ?? []}
          textoDe={(r) => NOMBRE_RAMA[r as Rama] ?? r}
          alCambiar={(v) => setFiltros((f) => ({ ...f, ramas: v }))}
        />
        {hayFiltros && (
          <>
            <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setFiltros(FILTROS_VACIOS)}>
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
                  <th className={encabezado}>Rama</th>
                  <th className={encabezado}>Cuota</th>
                  <th className={encabezado}>Sucursal</th>
                  <th className={encabezado}>Motivo</th>
                  <th className={encabezado}>Fecha</th>
                  {periodo === '' && <th className={encabezado}>Mes</th>}
                  <th className={encabezado} />
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={periodo === '' ? 13 : 12} className="px-3 py-10 text-center text-slate-500">
                      {filas.length === 0
                        ? `No hay bajas cargadas en ${etiquetaPeriodo}.`
                        : filtros.busqueda
                          ? `Ninguna baja de ${etiquetaPeriodo} coincide con «${filtros.busqueda}» y los filtros elegidos.`
                          : `Ninguna baja de ${etiquetaPeriodo} coincide con los filtros elegidos.`}
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
                    {/* La rama no se guarda: se deduce del vehículo y de la categoría del catálogo, igual que en la planilla. */}
                    <td className="px-3 py-2 text-slate-600">{nombreDeRama(baja) || '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{baja.cuota ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{baja.sucursal ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {baja.motivo ? (NOMBRE_MOTIVO_BAJA[baja.motivo as MotivoDeBaja] ?? baja.motivo) : <span className="text-slate-400">sin motivo</span>}
                      {baja.nota && <p className="text-xs text-slate-500">{baja.nota}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{baja.fechaBaja ?? '—'}</td>
                    {periodo === '' && (
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{baja.periodo ? nombreDePeriodo(baja.periodo) : '—'}</td>
                    )}
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(evento) => evento.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {esAdministrador && baja.puedeReactivarse ? (
                          <Boton tamano="sm" icono="ok" onClick={() => setAReactivar(baja)}>
                            Poner vigente
                          </Boton>
                        ) : (
                          <Etiqueta tono="neutro">{baja.hechaEnLaApp ? 'En la app' : 'De la planilla'}</Etiqueta>
                        )}
                        <BotonEliminar tipo="baja" id={baja.id} etiqueta={false} alBorrar={borrada} />
                      </div>
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
              alBorrar={borrada}
              alVerCliente={detalle.clienteId === null ? null : () => ir('clientes', { clienteId: detalle.clienteId! })}
            />
          )}
        </div>
      )}

      <DialogoPonerVigente
        baja={aReactivar}
        catalogos={catalogos}
        guardando={reactivando}
        alCerrar={() => setAReactivar(null)}
        alConfirmar={(cambios) => aReactivar && void reactivar(aReactivar, cambios)}
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
  alBorrar,
  alVerCliente,
}: {
  baja: FilaBaja
  puedeDeshacer: boolean
  puedeReactivar: boolean
  alCerrar: () => void
  alDeshacer: () => void
  alReactivar: () => void
  alBorrar: (resultado: ResultadoDeEliminacion) => void
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
        <BotonEliminar tipo="baja" id={baja.id} alBorrar={alBorrar} className="ml-auto" />
      </footer>
    </aside>
  )
}

const CAMPOS_VACIOS: CambiosDeReactivacion = {
  compania: '',
  numeroPoliza: '',
  propuesta: '',
  cuota: '',
  diaVencimiento: '',
  formaPago: '',
}

/**
 * Poner vigente toca la planilla de todos: se confirma, y de paso se corrige lo que haya cambiado
 * mientras el cliente no estaba —a veces vuelve con otra compañía, otra póliza o la cuota distinta—.
 * Los campos arrancan con lo último que tenía la baja; dejarlos así es no cambiar nada.
 */
function DialogoPonerVigente({
  baja,
  catalogos,
  guardando,
  alCerrar,
  alConfirmar,
}: {
  baja: FilaBaja | null
  catalogos: CatalogosCartera | null
  guardando: boolean
  alCerrar: () => void
  alConfirmar: (cambios: CambiosDeReactivacion) => void
}) {
  const [campos, setCampos] = useState<CambiosDeReactivacion>(CAMPOS_VACIOS)

  // Arranca de nuevo con los datos de la baja cada vez que se abre (o se abre para otra distinta).
  useEffect(() => {
    if (!baja) return
    setCampos({
      compania: baja.compania ?? '',
      numeroPoliza: baja.numeroPoliza ?? '',
      propuesta: baja.propuesta ?? '',
      cuota: baja.cuota ?? '',
      diaVencimiento: baja.diaVencimiento ?? '',
      formaPago: baja.formaPago ?? '',
    })
  }, [baja])

  if (!baja) return null

  const cambiar = (cambio: Partial<CambiosDeReactivacion>) => setCampos((previos) => ({ ...previos, ...cambio }))

  return (
    <Dialogo
      abierto
      titulo="Poner vigente la póliza"
      descripcion={[baja.clienteNombre, baja.compania, baja.numeroPoliza, baja.patente].filter(Boolean).join(' · ')}
      alCerrar={alCerrar}
      ancho="md"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => alConfirmar(campos)} cargando={guardando}>
            Poner vigente
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>
          La póliza vuelve a estar activa y se le pone su fila en la planilla del mes abierto. La baja sale de esta lista y también
          de la pestaña BAJAS de la base.
        </p>
        <p className="text-slate-500">
          Es para el cliente que se fue y volvió: no hace falta cargarlo de nuevo. Si vuelve con otra compañía, otra póliza o la
          cuota distinta, corregilo acá antes de confirmar —si no, queda tal como estaba el día que se fue—.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConSugerencias
            etiqueta="Compañía"
            lista="reactivar-compania"
            opciones={catalogos?.companias ?? []}
            valor={campos.compania ?? ''}
            alCambiar={(v) => cambiar({ compania: v })}
          />
          <ConSugerencias
            etiqueta="Forma de pago"
            lista="reactivar-forma-pago"
            opciones={catalogos?.formasDePago ?? []}
            valor={campos.formaPago ?? ''}
            alCambiar={(v) => cambiar({ formaPago: v })}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Póliza" value={campos.numeroPoliza ?? ''} onChange={(evento) => cambiar({ numeroPoliza: evento.target.value })} />
          <Campo etiqueta="Propuesta" value={campos.propuesta ?? ''} onChange={(evento) => cambiar({ propuesta: evento.target.value })} />
          <Campo etiqueta="Cuota" value={campos.cuota ?? ''} onChange={(evento) => cambiar({ cuota: evento.target.value })} />
        </div>

        <Campo
          etiqueta="Fecha de vencimiento"
          value={campos.diaVencimiento ?? ''}
          onChange={(evento) => cambiar({ diaVencimiento: evento.target.value })}
          ayuda="El día del mes que vence la cuota: 10, 25…"
        />
      </div>
    </Dialogo>
  )
}

/** Campo con desplegable de lo que ya se usa, pero que deja escribir cualquier cosa. */
function ConSugerencias({
  etiqueta,
  lista,
  opciones,
  valor,
  alCambiar,
}: {
  etiqueta: string
  lista: string
  opciones: string[]
  valor: string
  alCambiar: (valor: string) => void
}) {
  return (
    <>
      <Campo etiqueta={etiqueta} list={lista} value={valor} onChange={(evento) => alCambiar(evento.target.value)} />
      <datalist id={lista}>
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion} />
        ))}
      </datalist>
    </>
  )
}
