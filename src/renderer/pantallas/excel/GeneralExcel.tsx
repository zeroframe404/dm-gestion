// «General Excel»: todas las áreas del programa en un solo lugar y en formato planilla.
//
// Es el módulo para quien todavía no se acostumbró al programa. La barra lateral tiene doce módulos y
// cada uno su pantalla, sus pestañas y sus botones; acá hay una lista de áreas a la izquierda y una
// planilla a la derecha, que es exactamente la forma en la que la agencia venía trabajando. La idea no
// es que alguien se quede acá para siempre: es que pueda encontrar lo que busca desde el primer día y
// pasarse a la pantalla del módulo cuando quiera hacer algo con lo que encontró.
//
// Sólo se ven las áreas que la persona ya podía ver: el catálogo lo arma el proceso principal con sus
// permisos, y cada pedido de filas vuelve a exigir el permiso de ESE módulo. No es una puerta de atrás.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CatalogoDeExcel, FilasDeReporte, FiltrosDeReporte } from '../../../shared/tipos'
import { BotonAyuda } from '../../componentes/Ayuda'
import { Icono } from '../../componentes/Icono'
import { VistaExcel } from '../../componentes/VistaExcel'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import type { IdModulo } from '../../modulos'

const FILTROS_VACIOS: FiltrosDeReporte = {
  periodo: '',
  sucursal: '',
  compania: '',
  estado: '',
  busqueda: '',
  desde: '',
  hasta: '',
}

const CONTROL =
  'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25'

export function GeneralExcel() {
  const { parametros, limpiarParametros, ir } = useNavegacion()
  const [catalogo, setCatalogo] = useState<CatalogoDeExcel | null>(null)
  const [areaId, setAreaId] = useState<string>('')
  const [filtros, setFiltros] = useState<FiltrosDeReporte>(FILTROS_VACIOS)
  const [datos, setDatos] = useState<FilasDeReporte | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    void window.dm.excel.catalogo().then((resultado) => {
      if (resultado.ok) {
        setCatalogo(resultado.datos)
        // Otro módulo puede haber pedido un área puntual con el botón «Ver como Excel».
        const pedida = parametros.area
        const existe = resultado.datos.areas.some((area) => area.id === pedida)
        setAreaId(existe && pedida ? pedida : (resultado.datos.areas[0]?.id ?? ''))
        if (pedida) limpiarParametros()
      } else {
        setError(resultado.error)
      }
      setCargando(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const area = useMemo(() => catalogo?.areas.find((candidata) => candidata.id === areaId) ?? null, [catalogo, areaId])

  const traer = useCallback(async () => {
    if (!areaId) return
    setError(null)
    const resultado = await window.dm.excel.filas({ reporteId: areaId, filtros, columnas: [] })
    if (resultado.ok) setDatos(resultado.datos)
    else {
      setError(resultado.error)
      setDatos(null)
    }
  }, [areaId, filtros])

  useEffect(() => {
    void traer()
  }, [traer])

  // Cambiar de área limpia los filtros: el «estado» de Siniestros no quiere decir nada en Leads, y
  // arrastrarlo sin avisar daría una planilla vacía sin explicación.
  const elegirArea = (id: string) => {
    setAreaId(id)
    setFiltros(FILTROS_VACIOS)
    setDatos(null)
    setAviso(null)
  }

  const exportar = async () => {
    if (!areaId) return
    setGuardando(true)
    setAviso(null)
    const resultado = await window.dm.reportes.exportar({ reporteId: areaId, filtros, columnas: [] }, 'xlsx', null)
    setGuardando(false)
    if (resultado.ok) {
      if (resultado.datos.ruta) setAviso(`Se guardó en ${resultado.datos.ruta}`)
    } else {
      setError(resultado.error)
    }
  }

  if (cargando) return <Cargando />
  if (!catalogo) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (catalogo.areas.length === 0) {
    return (
      <div className="p-8">
        <Alerta tono="aviso">
          No tenés ningún módulo a la vista, así que acá no hay nada que mostrar. Los permisos se configuran en Administración →
          Permisos.
        </Alerta>
      </div>
    )
  }

  const cambiar = (campo: keyof FiltrosDeReporte) => (evento: { target: { value: string } }) =>
    setFiltros((previos) => ({ ...previos, [campo]: evento.target.value }))

  const usa = (filtro: string) => area?.filtros.includes(filtro as never) ?? false

  return (
    <div className="flex min-h-0 flex-1">
      {/* La lista de áreas: es el índice de la planilla, como las pestañas de abajo de una hoja. */}
      <nav aria-label="Áreas" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-slate-50 p-2">
        {catalogo.areas.map((candidata) => (
          <button
            key={candidata.id}
            type="button"
            onClick={() => elegirArea(candidata.id)}
            title={candidata.descripcion}
            className={cx(
              'rounded-lg px-3 py-2 text-left text-sm transition-colors',
              candidata.id === areaId
                ? 'bg-white font-semibold text-marino-800 shadow-suave'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            {candidata.nombre}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-slate-900">
              {area?.nombre ?? 'Planilla'}
              <BotonAyuda clave="excel" />
            </h2>
            <p className="truncate text-sm text-slate-500">{area?.descripcion}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* El puente de vuelta: encontraste la fila, ahora andá a la pantalla que la puede tocar. */}
            {area && (
              <Boton icono="flechaDerecha" onClick={() => ir(area.modulo as IdModulo)}>
                Abrir el módulo
              </Boton>
            )}
            <Boton variante="primario" icono="descargar" onClick={() => void exportar()} cargando={guardando}>
              Bajar el Excel
            </Boton>
          </div>
        </header>

        {/* Los filtros que ESTA área entiende, y nada más: un desplegable que no filtra nada sólo
            genera la sospecha de que el programa no anda. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {usa('periodo') && (
            <select aria-label="Mes" value={filtros.periodo} onChange={cambiar('periodo')} className={CONTROL}>
              <option value="">Mes: el abierto</option>
              {catalogo.periodos.map((periodo) => (
                <option key={periodo} value={periodo}>
                  {periodo}
                </option>
              ))}
            </select>
          )}
          {usa('sucursal') && (
            <select aria-label="Sucursal" value={filtros.sucursal} onChange={cambiar('sucursal')} className={CONTROL}>
              <option value="">Todas las sucursales</option>
              {catalogo.sucursales.map((sucursal) => (
                <option key={sucursal} value={sucursal}>
                  {sucursal}
                </option>
              ))}
            </select>
          )}
          {usa('compania') && (
            <select aria-label="Compañía" value={filtros.compania} onChange={cambiar('compania')} className={CONTROL}>
              <option value="">Todas las compañías</option>
              {catalogo.companias.map((compania) => (
                <option key={compania} value={compania}>
                  {compania}
                </option>
              ))}
            </select>
          )}
          {usa('estado') && (area?.estados.length ?? 0) > 0 && (
            <select aria-label={area?.etiquetaDeEstado} value={filtros.estado} onChange={cambiar('estado')} className={CONTROL}>
              <option value="">{area?.etiquetaDeEstado}: todo</option>
              {area?.estados.map((estado) => (
                <option key={estado} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          )}
          {usa('fechas') && (
            <>
              <input type="date" aria-label="Desde" value={filtros.desde} onChange={cambiar('desde')} className={CONTROL} />
              <input type="date" aria-label="Hasta" value={filtros.hasta} onChange={cambiar('hasta')} className={CONTROL} />
            </>
          )}
          {usa('busqueda') && (
            <label className="relative flex-1 min-w-48">
              <span className="sr-only">Buscar</span>
              <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={filtros.busqueda}
                onChange={cambiar('busqueda')}
                placeholder="Buscar por nombre, documento, póliza o patente…"
                className={cx(CONTROL, 'w-full pl-8')}
              />
            </label>
          )}
          {datos && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">
              {datos.total.toLocaleString('es-AR')} fila(s)
            </span>
          )}
        </div>

        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}
        {datos?.recortado && (
          <Alerta tono="aviso">
            Son {datos.total.toLocaleString('es-AR')} filas y en pantalla entran las primeras {datos.filas.length.toLocaleString('es-AR')}.
            Filtrá para achicar la lista, o bajate el Excel, que sale completo.
          </Alerta>
        )}

        {datos ? (
          <VistaExcel columnas={datos.columnas} filas={datos.filas} vacio="No hay ninguna fila con estos filtros." />
        ) : (
          <Cargando />
        )}
      </div>
    </div>
  )
}
