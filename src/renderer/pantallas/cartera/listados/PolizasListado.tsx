// Listado de Pólizas (Cartera → Pólizas): consulta de sólo lectura de la cartera de pólizas, con filtros
// colapsables, tabla paginada de 10 y exportación a Excel de TODO el resultado filtrado. El número de
// póliza abre la ficha que ya existe (módulo Pólizas). Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ESTADOS_DEL_LISTADO_DE_POLIZAS,
  NOMBRE_ESTADO_DEL_LISTADO_DE_POLIZAS,
  type EstadoDePolizaListado,
  type FilaDePolizaListado,
  type FiltrosDePolizasListado,
} from '../../../../shared/listados/polizas'
import { Alerta, Boton } from '../../../componentes/ui'
import { FiltroMultiple } from '../../../componentes/FiltroMultiple'
import {
  AccionNoDisponible,
  CampoDeFiltro,
  CeldaDoble,
  ChipDeEstado,
  CLASES_INPUT_DE_FILTRO,
  EncabezadoDePantalla,
  GrillaDeFiltros,
  PanelDeFiltros,
  TablaDeListado,
  type ColumnaDeListado,
  type TonoDeChip,
} from '../../../componentes/listados'
import { useRefrescoEnVivo } from '../../../contexto/DatosEnVivo'
import { useNavegacion } from '../../../contexto/Navegacion'
import { exportarAExcel } from '../../../exportarAExcel'

const FILTROS_VACIOS: FiltrosDePolizasListado = {
  busqueda: '',
  companias: [],
  ramos: [],
  estados: [],
  productores: [],
  vigenciaDesde: '',
  vigenciaHasta: '',
}

/** Programada en azul, Vigente en verde, Vencida en ámbar (sigue siendo cartera); Renovada y Baja salieron de ella. */
const TONO_DEL_ESTADO: Record<EstadoDePolizaListado, TonoDeChip> = {
  PROGRAMADA: 'azul',
  VIGENTE: 'verde',
  VENCIDA: 'ambar',
  RENOVADA: 'gris',
  BAJA: 'rojo',
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion. */
function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Los valores distintos y sin vacíos de una columna, ordenados, para las opciones de un filtro. */
function distintos(filas: readonly FilaDePolizaListado[], de: (fila: FilaDePolizaListado) => string | null): string[] {
  return [...new Set(filas.map(de).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'es'))
}

/** ¿Hay algún filtro puesto? Si no, la consulta ya devuelve la cartera entera. */
function hayFiltros(f: FiltrosDePolizasListado): boolean {
  return Boolean(
    f.busqueda.trim() ||
      f.companias.length ||
      f.ramos.length ||
      f.estados.length ||
      f.productores.length ||
      f.vigenciaDesde ||
      f.vigenciaHasta,
  )
}

export default function PolizasListado() {
  const { ir } = useNavegacion()
  const [borrador, setBorrador] = useState<FiltrosDePolizasListado>(FILTROS_VACIOS)
  const [aplicados, setAplicados] = useState<FiltrosDePolizasListado>(FILTROS_VACIOS)
  const [filas, setFilas] = useState<FilaDePolizaListado[]>([])
  // La cartera sin filtrar: de ahí salen las opciones de los desplegables (compañías, ramos, productores).
  const [catalogo, setCatalogo] = useState<FilaDePolizaListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDePolizasListado, enSilencio = false) => {
    const mia = ++peticion.current
    if (!enSilencio) setCargando(true)
    // Con los filtros vacíos el resultado ya es la cartera entera: no se pide dos veces.
    const [resultado, sinFiltrar] = await (hayFiltros(filtros)
      ? Promise.all([window.dm.listados.polizas(filtros), window.dm.listados.polizas(FILTROS_VACIOS)])
      : window.dm.listados.polizas(filtros).then((r) => [r, r] as const))
    if (mia !== peticion.current) return
    // La última consulta apaga el «Cargando» aunque haya sido silenciosa: si una carga normal quedó vieja
    // por un refresco en vivo, nadie más lo apagaría.
    setCargando(false)
    if (resultado.ok) {
      setFilas(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    if (sinFiltrar.ok) setCatalogo(sinFiltrar.datos)
  }, [])

  useEffect(() => {
    void cargar(aplicados)
  }, [cargar, aplicados])

  // Una póliza cargada en otra sucursal aparece sola.
  useRefrescoEnVivo({
    tipos: ['MENSUAL', 'BAJAS'],
    recargar: () => cargar(aplicados, true),
  })

  const companias = useMemo(() => distintos(catalogo, (f) => f.compania), [catalogo])
  const ramos = useMemo(() => distintos(catalogo, (f) => f.ramo), [catalogo])
  const productores = useMemo(() => distintos(catalogo, (f) => f.productor), [catalogo])

  const buscar = () => {
    setAviso(null)
    setAplicados({ ...borrador, busqueda: borrador.busqueda.trim() })
  }
  const limpiar = () => {
    setAviso(null)
    setBorrador(FILTROS_VACIOS)
    setAplicados(FILTROS_VACIOS)
  }

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    // Todo el resultado filtrado (no sólo la página que se ve), con las columnas y el orden de la tabla.
    const resultado = await exportarAExcel({
      titulo: 'Listado de Pólizas',
      columnas: ['Compañía', 'Póliza', 'Ramo', 'Cliente', 'Riesgo', 'Vigencia desde', 'Vigencia hasta', 'Estado', 'Productor'],
      filas: filas.map((f) => [
        f.compania ?? '',
        f.numero ?? '',
        f.ramo ?? '',
        f.cliente,
        f.riesgo ?? '',
        verFecha(f.vigenciaDesde) === '—' ? '' : verFecha(f.vigenciaDesde),
        verFecha(f.vigenciaHasta) === '—' ? '' : verFecha(f.vigenciaHasta),
        NOMBRE_ESTADO_DEL_LISTADO_DE_POLIZAS[f.estado],
        f.productor ?? '',
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`)
  }

  const columnas: ColumnaDeListado<FilaDePolizaListado>[] = [
    { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
    {
      id: 'poliza',
      encabezado: 'Póliza',
      celda: (f) => (
        <CeldaDoble
          principal={f.numero ?? 'Sin número'}
          secundario={f.ramo}
          alHacerClic={() => ir('polizas', { polizaId: f.polizaId })}
        />
      ),
    },
    { id: 'cliente', encabezado: 'Cliente', celda: (f) => f.cliente },
    { id: 'riesgo', encabezado: 'Riesgo', celda: (f) => f.riesgo ?? '—' },
    {
      id: 'vigencia',
      encabezado: 'Vigencia',
      celda: (f) => <CeldaDoble principal={<span className="font-medium text-slate-800">{verFecha(f.vigenciaDesde)}</span>} secundario={verFecha(f.vigenciaHasta)} />,
    },
    {
      id: 'estado',
      encabezado: 'Estado',
      celda: (f) => <ChipDeEstado tono={TONO_DEL_ESTADO[f.estado]}>{NOMBRE_ESTADO_DEL_LISTADO_DE_POLIZAS[f.estado]}</ChipDeEstado>,
    },
    { id: 'productor', encabezado: 'Productor', celda: (f) => f.productor ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="polizas"
        titulo="Listado de Pólizas"
        subtitulo="Consultar y gestionar la cartera de pólizas"
        acciones={
          <>
            <Boton icono="descargar" onClick={() => void exportar()} cargando={exportando} disabled={exportando || cargando || filas.length === 0}>
              Exportar Excel
            </Boton>
            <AccionNoDisponible icono="mas" motivo="Todavía no se puede: el modelo de datos no tiene endosos.">
              Crear Endoso
            </AccionNoDisponible>
          </>
        }
      />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <PanelDeFiltros alBuscar={buscar} alLimpiar={limpiar} buscando={cargando}>
        <GrillaDeFiltros columnas={3}>
          <CampoDeFiltro etiqueta="Buscar">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.busqueda}
              onChange={(e) => setBorrador((b) => ({ ...b, busqueda: e.target.value }))}
              placeholder="Póliza, cliente, documento o patente"
            />
          </CampoDeFiltro>
          <FiltroMultiple
            variante="chips"
            etiqueta="Compañías"
            valores={borrador.companias}
            opciones={companias}
            alCambiar={(v) => setBorrador((b) => ({ ...b, companias: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Ramos"
            valores={borrador.ramos}
            opciones={ramos}
            alCambiar={(v) => setBorrador((b) => ({ ...b, ramos: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Estados"
            plural="todos"
            valores={borrador.estados}
            opciones={[...ESTADOS_DEL_LISTADO_DE_POLIZAS]}
            textoDe={(valor) => NOMBRE_ESTADO_DEL_LISTADO_DE_POLIZAS[valor as EstadoDePolizaListado]}
            alCambiar={(v) => setBorrador((b) => ({ ...b, estados: v as EstadoDePolizaListado[] }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={productores}
            alCambiar={(v) => setBorrador((b) => ({ ...b, productores: v }))}
          />
          <CampoDeFiltro etiqueta="Vigencia desde">
            <input
              type="date"
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.vigenciaDesde}
              onChange={(e) => setBorrador((b) => ({ ...b, vigenciaDesde: e.target.value }))}
            />
          </CampoDeFiltro>
          <CampoDeFiltro etiqueta="Vigencia hasta">
            <input
              type="date"
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.vigenciaHasta}
              onChange={(e) => setBorrador((b) => ({ ...b, vigenciaHasta: e.target.value }))}
            />
          </CampoDeFiltro>
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <TablaDeListado
        etiqueta="Listado de pólizas"
        columnas={columnas}
        filas={filas}
        clave={(f) => f.polizaId}
        cargando={cargando}
        vacio="No se encontraron pólizas"
      />
    </div>
  )
}
