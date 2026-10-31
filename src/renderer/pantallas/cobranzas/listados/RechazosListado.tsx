// Listado de Rechazos de Débito (Cobranzas → Rechazos): el historial de avisos de rechazo del débito, de sólo lectura.
// Se carga solo al abrir (no hay rango obligatorio) y los filtros arrancan plegados. Tabla paginada de 10 y exportación
// a Excel de TODO lo filtrado. Resolver o descartar un aviso sigue siendo cosa de Cartera → Rechazos. El «Tipo» es el
// estado del aviso (Pendiente / Visto / Resuelto) y el importe, el de la cuota de la planilla que rebotó.
// Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FILTROS_DE_RECHAZOS_VACIOS, type FilaDeRechazo, type FiltrosDeRechazos } from '../../../../shared/listados/rechazos'
import { ESTADOS_DE_RECHAZO, NOMBRE_ESTADO_RECHAZO, type EstadoDeRechazo } from '../../../../shared/tipos'
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
  RangoDeFechasConAtajos,
  TablaDeListado,
  type ColumnaDeListado,
  type TonoDeChip,
} from '../../../componentes/listados'
import { useRefrescoEnVivo } from '../../../contexto/DatosEnVivo'
import { useNavegacion } from '../../../contexto/Navegacion'
import { exportarAExcel } from '../../../exportarAExcel'
import { pesos } from '../formato'

const FILTROS_VACIOS: FiltrosDeRechazos = FILTROS_DE_RECHAZOS_VACIOS

/** Pendiente en rojo (nadie lo atendió), Visto en ámbar (se abrió pero sigue sin cobrarse), Resuelto en verde. */
const TONO_DEL_ESTADO: Record<EstadoDeRechazo, TonoDeChip> = {
  PENDIENTE: 'rojo',
  VISTO: 'ambar',
  RESUELTO: 'verde',
}

const TIPOS = ESTADOS_DE_RECHAZO.map((estado) => NOMBRE_ESTADO_RECHAZO[estado])

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion; una fecha que no se entiende se deja como vino. */
function verFecha(iso: string | null): string {
  if (!iso) return '—'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** 'AAAA-MM' → 'MM/AAAA'; cualquier otra cosa se deja como vino. */
function verPeriodo(periodo: string | null): string | null {
  if (!periodo) return null
  return /^\d{4}-\d{2}$/.test(periodo) ? `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}` : periodo
}

/** Lo que se lee debajo del número de póliza: la cuota que rebotó y su mes. */
function detalleDeLaCuota(f: FilaDeRechazo): string | null {
  const partes = [f.cuota ? `Cuota ${f.cuota}` : null, verPeriodo(f.periodo)].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

/** Los valores distintos y sin vacíos de una columna, ordenados, para las opciones de un filtro. */
function distintos(filas: readonly FilaDeRechazo[], de: (fila: FilaDeRechazo) => string | null): string[] {
  return [...new Set(filas.map(de).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'es'))
}

/** ¿Hay algún filtro puesto? Si no, la consulta ya devuelve todos los avisos. */
function hayFiltros(f: FiltrosDeRechazos): boolean {
  return Boolean(
    f.desde ||
      f.hasta ||
      f.companias.length ||
      f.ramas.length ||
      f.productores.length ||
      f.causas.length ||
      f.tipos.length ||
      f.cliente.trim(),
  )
}

export default function RechazosListado() {
  const { ir } = useNavegacion()
  const [borrador, setBorrador] = useState<FiltrosDeRechazos>(FILTROS_VACIOS)
  const [aplicados, setAplicados] = useState<FiltrosDeRechazos>(FILTROS_VACIOS)
  const [filas, setFilas] = useState<FilaDeRechazo[]>([])
  // Todos los avisos sin filtrar: de ahí salen las opciones de los desplegables (compañías, ramas, productores, causas).
  const [catalogo, setCatalogo] = useState<FilaDeRechazo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDeRechazos, enSilencio = false) => {
    const mia = ++peticion.current
    if (!enSilencio) setCargando(true)
    // Con los filtros vacíos el resultado ya son todos los avisos: no se pide dos veces.
    const [resultado, sinFiltrar] = await (hayFiltros(filtros)
      ? Promise.all([window.dm.listados.rechazos(filtros), window.dm.listados.rechazos(FILTROS_VACIOS)])
      : window.dm.listados.rechazos(filtros).then((r) => [r, r] as const))
    if (mia !== peticion.current) return
    // La última consulta apaga el «Cargando» aunque haya sido silenciosa: si una carga normal quedó vieja
    // por un refresco en vivo, nadie más lo apagaría.
    setCargando(false)
    if (resultado.ok) {
      setFilas(resultado.datos)
      setError(null)
    } else {
      // Una búsqueda que falla no deja a la vista los resultados de la anterior.
      setFilas([])
      setError(resultado.error)
    }
    if (sinFiltrar.ok) setCatalogo(sinFiltrar.datos)
  }, [])

  useEffect(() => {
    void cargar(aplicados)
  }, [cargar, aplicados])

  // Un aviso anotado o resuelto en otra sucursal aparece (o cambia de estado) solo.
  useRefrescoEnVivo({
    tipos: ['APP_RECHAZOS'],
    recargar: () => cargar(aplicados, true),
  })

  const companias = useMemo(() => distintos(catalogo, (f) => f.compania), [catalogo])
  const ramas = useMemo(() => distintos(catalogo, (f) => f.ramo), [catalogo])
  const productores = useMemo(() => distintos(catalogo, (f) => f.productor), [catalogo])
  const causas = useMemo(() => distintos(catalogo, (f) => f.causa), [catalogo])

  const rangoAlReves = borrador.desde !== '' && borrador.hasta !== '' && borrador.desde > borrador.hasta

  const buscar = () => {
    if (rangoAlReves) return
    setAviso(null)
    setAplicados({ ...borrador, cliente: borrador.cliente.trim() })
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
      titulo: 'Listado de Rechazos de Débito',
      columnas: ['Fecha', 'Compañía', 'Póliza', 'Ramo', 'Cuota', 'Mes de la cuota', 'Cliente', 'Importe', 'Tipo', 'Causa', 'Productor'],
      filas: filas.map((f) => [
        verFecha(f.fecha) === '—' ? '' : verFecha(f.fecha),
        f.compania ?? '',
        f.numero ?? '',
        f.ramo ?? '',
        f.cuota ?? '',
        verPeriodo(f.periodo) ?? '',
        f.cliente,
        f.importe,
        f.tipo,
        f.causa ?? '',
        f.productor ?? '',
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`)
  }

  const columnas: ColumnaDeListado<FilaDeRechazo>[] = [
    { id: 'fecha', encabezado: 'Fecha', celda: (f) => verFecha(f.fecha) },
    { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
    {
      id: 'poliza',
      encabezado: 'Póliza / Endoso',
      celda: (f) => (
        <CeldaDoble
          principal={f.numero ?? 'Sin número'}
          secundario={detalleDeLaCuota(f) ?? f.ramo}
          alHacerClic={f.polizaId === null ? undefined : () => ir('polizas', { polizaId: f.polizaId ?? undefined })}
        />
      ),
    },
    { id: 'cliente', encabezado: 'Cliente', celda: (f) => f.cliente },
    {
      id: 'importe',
      encabezado: 'Importe',
      celda: (f) =>
        f.importe === null ? (
          <span title="El aviso no quedó atado a una cuota de la planilla con monto.">—</span>
        ) : (
          <span className="tabular-nums">{pesos(f.importe)}</span>
        ),
    },
    { id: 'tipo', encabezado: 'Tipo (estado)', celda: (f) => <ChipDeEstado tono={TONO_DEL_ESTADO[f.estado]}>{f.tipo}</ChipDeEstado> },
    { id: 'causa', encabezado: 'Causa', celda: (f) => f.causa ?? '—' },
    { id: 'productor', encabezado: 'Productor', celda: (f) => f.productor ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="alerta"
        titulo="Listado de Rechazos de Débito"
        subtitulo="Historial de rechazos de débito de cuotas y pagos de pólizas"
        acciones={
          <Boton
            icono="descargar"
            onClick={() => void exportar()}
            cargando={exportando}
            disabled={exportando || cargando || filas.length === 0}
            title={filas.length === 0 ? 'No hay rechazos para exportar con los filtros aplicados.' : undefined}
          >
            Exportar Excel
          </Boton>
        }
      />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <PanelDeFiltros
        alBuscar={buscar}
        alLimpiar={limpiar}
        buscando={cargando}
        buscarDeshabilitado={rangoAlReves}
        motivoSinBuscar="La fecha «desde» no puede ser posterior a la fecha «hasta»."
      >
        <GrillaDeFiltros columnas={4}>
          <RangoDeFechasConAtajos
            etiqueta="Rango de Fechas"
            desde={borrador.desde}
            hasta={borrador.hasta}
            alCambiar={(desde, hasta) => setBorrador((b) => ({ ...b, desde, hasta }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Compañías"
            valores={borrador.companias}
            opciones={companias}
            alCambiar={(v) => setBorrador((b) => ({ ...b, companias: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Ramas"
            valores={borrador.ramas}
            opciones={ramas}
            alCambiar={(v) => setBorrador((b) => ({ ...b, ramas: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={productores}
            alCambiar={(v) => setBorrador((b) => ({ ...b, productores: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Tipos"
            plural="todos"
            valores={borrador.tipos}
            opciones={TIPOS}
            alCambiar={(v) => setBorrador((b) => ({ ...b, tipos: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Causas"
            valores={borrador.causas}
            opciones={causas}
            alCambiar={(v) => setBorrador((b) => ({ ...b, causas: v }))}
          />
          <CampoDeFiltro etiqueta="Cliente">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.cliente}
              onChange={(e) => setBorrador((b) => ({ ...b, cliente: e.target.value }))}
              placeholder="Buscar por nombre de cliente…"
            />
          </CampoDeFiltro>
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <TablaDeListado
        etiqueta="Listado de rechazos de débito"
        columnas={columnas}
        filas={filas}
        clave={(f) => f.id}
        cargando={cargando}
        vacio="No se encontraron rechazos con los filtros aplicados"
      />
    </div>
  )
}
