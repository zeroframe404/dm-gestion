// Listado de Siniestros (Cartera → Siniestros): consulta de sólo lectura de los siniestros de la cartera, con
// filtros colapsables, tabla paginada de 10 (los más recientes primero) y exportación a Excel de TODO el resultado
// filtrado. El número de siniestro abre la ficha que ya existe (módulo Siniestros). Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilaDeSiniestroListado, FiltrosDeSiniestrosListado } from '../../../../shared/listados/siniestros'
import { ESTADOS_DE_SINIESTRO, type EstadoSiniestro } from '../../../../shared/tipos'
import { Alerta, Boton } from '../../../componentes/ui'
import { FiltroMultiple } from '../../../componentes/FiltroMultiple'
import {
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
import { usePuedeEditar } from '../../../contexto/Permisos'
import { exportarAExcel } from '../../../exportarAExcel'
import { DialogoAltaSiniestro } from '../../siniestros/DialogoAltaSiniestro'

const FILTROS_VACIOS: FiltrosDeSiniestrosListado = {
  busqueda: '',
  companias: [],
  estados: [],
  productores: [],
  fechaDesde: '',
  fechaHasta: '',
}

/** Cómo se lee cada estado en el chip (los mismos cinco del módulo Siniestros). */
const NOMBRE_DEL_ESTADO: Record<EstadoSiniestro, string> = {
  'SIN RESPONDER': 'Sin responder',
  CARGADO: 'Cargado',
  'EN TRÁMITE': 'En trámite',
  'ESPERANDO DOCUMENTACIÓN': 'Esperando documentación',
  CERRADO: 'Cerrado',
}

/** Abiertos en verde o azul según el trámite, lo que espera algo en rojo/ámbar y el cerrado en gris. */
const TONO_DEL_ESTADO: Record<EstadoSiniestro, TonoDeChip> = {
  'SIN RESPONDER': 'rojo',
  CARGADO: 'verde',
  'EN TRÁMITE': 'azul',
  'ESPERANDO DOCUMENTACIÓN': 'ambar',
  CERRADO: 'gris',
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion. */
function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Los valores distintos y sin vacíos de una columna, ordenados, para las opciones de un filtro. */
function distintos(filas: readonly FilaDeSiniestroListado[], de: (fila: FilaDeSiniestroListado) => string | null): string[] {
  return [...new Set(filas.map(de).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'es'))
}

export default function SiniestrosListado() {
  const { ir } = useNavegacion()
  const puedeEditar = usePuedeEditar('siniestros')
  const [borrador, setBorrador] = useState<FiltrosDeSiniestrosListado>(FILTROS_VACIOS)
  const [aplicados, setAplicados] = useState<FiltrosDeSiniestrosListado>(FILTROS_VACIOS)
  const [filas, setFilas] = useState<FilaDeSiniestroListado[]>([])
  // Los siniestros sin filtrar: de ahí salen las opciones de los desplegables (compañías, productores).
  const [catalogo, setCatalogo] = useState<FilaDeSiniestroListado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const [altaAbierta, setAltaAbierta] = useState(false)

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDeSiniestrosListado, enSilencio = false) => {
    const mia = ++peticion.current
    if (!enSilencio) setCargando(true)
    const [resultado, sinFiltrar] = await Promise.all([
      window.dm.listados.siniestros(filtros),
      window.dm.listados.siniestros(FILTROS_VACIOS),
    ])
    if (mia !== peticion.current) return
    if (resultado.ok) {
      setFilas(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    if (sinFiltrar.ok) setCatalogo(sinFiltrar.datos)
    // Siempre se apaga: si un refresco silencioso pisó a una carga normal, ésta ya no llega acá.
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(aplicados)
  }, [cargar, aplicados])

  // Un siniestro cargado en otra sucursal aparece solo; con el alta abierta el refresco espera.
  useRefrescoEnVivo({
    tipos: ['SINIESTROS'],
    recargar: () => cargar(aplicados, true),
    postergar: () => altaAbierta,
  })

  const companias = useMemo(() => distintos(catalogo, (f) => f.compania), [catalogo])
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
      titulo: 'Listado de Siniestros',
      columnas: ['Compañía', 'Siniestro', 'Tipo', 'Póliza', 'Ramo', 'Fecha', 'Asegurado', 'Riesgo', 'Estado', 'Productor'],
      filas: filas.map((f) => [
        f.compania ?? '',
        f.numero ?? '',
        f.tipo ?? '',
        f.numeroDePoliza ?? '',
        f.ramo ?? '',
        f.fecha ? verFecha(f.fecha) : '',
        f.asegurado ?? '',
        f.riesgo ?? '',
        NOMBRE_DEL_ESTADO[f.estado],
        f.productor ?? '',
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`)
  }

  const columnas: ColumnaDeListado<FilaDeSiniestroListado>[] = [
    { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
    {
      id: 'siniestro',
      encabezado: 'Siniestro',
      celda: (f) => (
        <CeldaDoble
          principal={f.numero ?? 'Sin número'}
          secundario={f.tipo}
          alHacerClic={() => ir('siniestros', { siniestroId: f.siniestroId })}
        />
      ),
    },
    { id: 'poliza', encabezado: 'Póliza', celda: (f) => <CeldaDoble principal={f.numeroDePoliza ?? '—'} secundario={f.ramo} /> },
    { id: 'fecha', encabezado: 'Fecha', celda: (f) => verFecha(f.fecha) },
    { id: 'asegurado', encabezado: 'Asegurado', celda: (f) => f.asegurado ?? '—' },
    { id: 'riesgo', encabezado: 'Riesgo', celda: (f) => f.riesgo ?? '—' },
    {
      id: 'estado',
      encabezado: 'Estado',
      celda: (f) => <ChipDeEstado tono={TONO_DEL_ESTADO[f.estado]}>{NOMBRE_DEL_ESTADO[f.estado]}</ChipDeEstado>,
    },
    { id: 'productor', encabezado: 'Productor', celda: (f) => f.productor ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="siniestros"
        titulo="Listado de Siniestros"
        subtitulo="Consultar y gestionar los siniestros de la cartera"
        acciones={
          <>
            <Boton icono="descargar" onClick={() => void exportar()} cargando={exportando} disabled={exportando || cargando || filas.length === 0}>
              Exportar Excel
            </Boton>
            {puedeEditar && (
              <Boton variante="primario" icono="mas" onClick={() => setAltaAbierta(true)}>
                Crear Siniestro
              </Boton>
            )}
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
              placeholder="Siniestro, póliza, asegurado, documento o patente"
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
            etiqueta="Estados"
            plural="todos"
            valores={borrador.estados}
            opciones={[...ESTADOS_DE_SINIESTRO]}
            textoDe={(valor) => NOMBRE_DEL_ESTADO[valor as EstadoSiniestro]}
            alCambiar={(v) => setBorrador((b) => ({ ...b, estados: v as EstadoSiniestro[] }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={productores}
            alCambiar={(v) => setBorrador((b) => ({ ...b, productores: v }))}
          />
          <CampoDeFiltro etiqueta="Fecha desde">
            <input
              type="date"
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.fechaDesde}
              onChange={(e) => setBorrador((b) => ({ ...b, fechaDesde: e.target.value }))}
            />
          </CampoDeFiltro>
          <CampoDeFiltro etiqueta="Fecha hasta">
            <input
              type="date"
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.fechaHasta}
              onChange={(e) => setBorrador((b) => ({ ...b, fechaHasta: e.target.value }))}
            />
          </CampoDeFiltro>
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <TablaDeListado
        etiqueta="Listado de siniestros"
        columnas={columnas}
        filas={filas}
        clave={(f) => f.siniestroId}
        cargando={cargando}
        vacio="No se encontraron siniestros"
      />

      {altaAbierta && (
        <DialogoAltaSiniestro
          alCerrar={() => setAltaAbierta(false)}
          alCargar={(ficha) => {
            setAltaAbierta(false)
            ir('siniestros', { siniestroId: ficha.siniestro.id })
          }}
        />
      )}
    </div>
  )
}
