// Listado de Vencimientos de Cuotas (Cobranzas → Vencimientos Cuotas): es una BÚSQUEDA, no una lista que se carga sola.
// El rango de fechas de vencimiento es obligatorio; sin él «Buscar» queda apagado y la tabla pide elegirlo. Cada fila es
// una cuota de la planilla mensual (la misma de Planilla del mes y de Cobranzas); el estado lo calcula el servicio con las
// reglas de esas pantallas. Tabla paginada de 10 y exportación a Excel de TODO el resultado. Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FILTROS_DE_CUOTAS_VACIOS, type EstadoDeCuota, type FilaDeCuota, type FiltrosDeCuotas } from '../../../../shared/listados/cuotas'
import { Alerta, Boton } from '../../../componentes/ui'
import { FiltroMultiple } from '../../../componentes/FiltroMultiple'
import {
  BotonPildora,
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

const AVISO_SIN_VENDEDORES = 'Todavía no está disponible: las pólizas no tienen vendedor. Para filtrar por quien la vende usá Productores.'
const AVISO_SIN_GRUPOS = 'Todavía no está disponible: todavía no existen los grupos de clientes.'
const MOTIVO_SIN_RANGO = 'Elegí el rango de fechas de vencimiento para poder buscar.'
const TEXTO_SIN_RANGO = 'Seleccioná un rango de fechas de vencimiento para buscar cuotas'
const AVISO_EXCLUIR_PAGADAS = 'Saca las cuotas pagas y las adelantadas (cuya plata ya entró). Si también activás «Solo cuotas vencidas» no cambia nada: una cuota vencida nunca está paga.'

const TONO_DEL_ESTADO: Record<EstadoDeCuota, TonoDeChip> = {
  Pagada: 'verde',
  Adelantada: 'azul',
  Imputada: 'ambar',
  Vencida: 'rojo',
  Pendiente: 'gris',
  Anulada: 'gris',
  Renovada: 'gris',
  'Sin mora': 'azul',
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion. */
function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Los valores distintos y sin vacíos de una columna, ordenados, para las opciones de un filtro. */
function distintos(filas: readonly FilaDeCuota[], de: (fila: FilaDeCuota) => string | null): string[] {
  return [...new Set(filas.map(de).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'es'))
}

/** El rango es válido cuando están las dos fechas y no están al revés. */
function rangoCompleto(f: Pick<FiltrosDeCuotas, 'desde' | 'hasta'>): boolean {
  return f.desde !== '' && f.hasta !== '' && f.desde <= f.hasta
}

export default function VencimientosCuotasListado() {
  const { ir } = useNavegacion()
  const [borrador, setBorrador] = useState<FiltrosDeCuotas>(FILTROS_DE_CUOTAS_VACIOS)
  // null = todavía no se buscó nada. Una búsqueda se hace con «Buscar», no al tipear.
  const [aplicados, setAplicados] = useState<FiltrosDeCuotas | null>(null)
  const [filas, setFilas] = useState<FilaDeCuota[]>([])
  // Una fila por combinación de compañía / ramo / forma de pago / productor existente: de ahí salen las opciones de los desplegables.
  const [catalogo, setCatalogo] = useState<FilaDeCuota[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDeCuotas, enSilencio = false) => {
    const mia = ++peticion.current
    if (!enSilencio) setCargando(true)
    try {
      const resultado = await window.dm.listados.cuotas(filtros)
      if (mia !== peticion.current) return
      if (resultado.ok) {
        setFilas(resultado.datos)
        setError(null)
      } else {
        // Si la búsqueda falla no se dejan a la vista las filas de la anterior: no corresponden a estos filtros.
        setFilas([])
        setError(resultado.error)
      }
    } catch {
      if (mia !== peticion.current) return
      setFilas([])
      setError('No se pudo cargar el listado. Probá de nuevo.')
    }
    // La respuesta vigente siempre cierra el «Cargando», aunque sea una recarga silenciosa que pisó a una búsqueda en vuelo.
    setCargando(false)
  }, [])

  const cargarCatalogo = useCallback(async () => {
    try {
      const resultado = await window.dm.listados.cuotas({ ...FILTROS_DE_CUOTAS_VACIOS, soloOpciones: true })
      if (resultado.ok) setCatalogo(resultado.datos)
    } catch {
      // Sin catálogo los desplegables quedan vacíos, pero la búsqueda sigue andando.
    }
  }, [])

  useEffect(() => {
    void cargarCatalogo()
  }, [cargarCatalogo])

  useEffect(() => {
    if (aplicados) void cargar(aplicados)
  }, [cargar, aplicados])

  // Un pago, una baja o una planilla nueva cargada en otra sucursal aparece sola (la búsqueda sólo si ya hay una hecha).
  useRefrescoEnVivo({
    tipos: ['MENSUAL', 'PAGOS', 'BAJAS'],
    recargar: async () => {
      await cargarCatalogo()
      if (aplicados) await cargar(aplicados, true)
    },
  })

  const companias = useMemo(() => distintos(catalogo, (f) => f.compania), [catalogo])
  const ramas = useMemo(() => distintos(catalogo, (f) => f.ramo), [catalogo])
  const productores = useMemo(() => distintos(catalogo, (f) => f.productor), [catalogo])
  const formasDePago = useMemo(() => distintos(catalogo, (f) => f.formaPago), [catalogo])

  const hayRango = rangoCompleto(borrador)

  const buscar = () => {
    if (!hayRango) return
    setAviso(null)
    setAplicados({ ...borrador })
  }
  const limpiar = () => {
    peticion.current++
    setAviso(null)
    setError(null)
    setBorrador(FILTROS_DE_CUOTAS_VACIOS)
    setAplicados(null)
    setFilas([])
    setCargando(false)
  }

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    // Todo el resultado (no sólo la página que se ve), con las columnas y el orden de la tabla.
    try {
      const resultado = await exportarAExcel({
        titulo: 'Listado de Vencimientos de Cuotas',
        columnas: ['Compañía', 'Póliza', 'Cliente', 'Vencimiento', 'Cuota', 'Importe', 'Estado', 'Riesgo', 'Productor'],
        filas: filas.map((f) => [
          f.compania ?? '',
          f.numero ?? '',
          f.cliente,
          verFecha(f.vencimiento) === '—' ? '' : verFecha(f.vencimiento),
          f.cuota ?? '',
          f.importe,
          f.estado,
          f.riesgo ?? '',
          f.productor ?? '',
        ]),
      })
      if (!resultado.ok) setError(resultado.error)
      else if (resultado.datos.ruta) setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`)
    } finally {
      setExportando(false)
    }
  }

  const columnas: ColumnaDeListado<FilaDeCuota>[] = [
    { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
    {
      id: 'poliza',
      encabezado: 'Póliza / Endoso',
      celda: (f) => {
        const polizaId = f.polizaId
        return (
          <CeldaDoble
            principal={f.numero ?? 'Sin número'}
            secundario={f.ramo}
            alHacerClic={polizaId === null ? undefined : () => ir('polizas', { polizaId })}
          />
        )
      },
    },
    {
      id: 'cliente',
      encabezado: 'Cliente',
      celda: (f) => {
        const clienteId = f.clienteId
        return <CeldaDoble principal={f.cliente} alHacerClic={clienteId === null ? undefined : () => ir('clientes', { clienteId })} />
      },
    },
    { id: 'vencimiento', encabezado: 'Vencimiento', celda: (f) => verFecha(f.vencimiento) },
    {
      id: 'importe',
      encabezado: 'Importe',
      celda: (f) => <CeldaDoble principal={f.importe === null ? '—' : pesos(f.importe)} secundario={f.cuota ? `Cuota ${f.cuota}` : null} />,
    },
    { id: 'estado', encabezado: 'Estado', celda: (f) => <ChipDeEstado tono={TONO_DEL_ESTADO[f.estado]}>{f.estado}</ChipDeEstado> },
    { id: 'riesgo', encabezado: 'Riesgo', celda: (f) => f.riesgo ?? '—' },
    { id: 'productor', encabezado: 'Productor', celda: (f) => f.productor ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="calendario"
        titulo="Listado de Vencimientos de Cuotas"
        subtitulo="Buscar cuotas de pólizas próximas a vencer o vencidas"
        acciones={
          <Boton
            icono="descargar"
            onClick={() => void exportar()}
            cargando={exportando}
            disabled={exportando || cargando || filas.length === 0}
            title={filas.length === 0 ? 'Hacé una búsqueda con resultados para poder exportar.' : undefined}
          >
            Exportar Excel
          </Boton>
        }
      />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <PanelDeFiltros
        abiertoPorDefecto
        alBuscar={buscar}
        alLimpiar={limpiar}
        buscando={cargando}
        buscarDeshabilitado={!hayRango}
        motivoSinBuscar={MOTIVO_SIN_RANGO}
        opcionesAdicionales={
          <>
            <BotonPildora activo={borrador.incluirAnuladas} alAlternar={() => setBorrador((b) => ({ ...b, incluirAnuladas: !b.incluirAnuladas }))}>
              Incluir pólizas anuladas
            </BotonPildora>
            <BotonPildora
              activo={borrador.excluirPagadas}
              alAlternar={() => setBorrador((b) => ({ ...b, excluirPagadas: !b.excluirPagadas }))}
              title={AVISO_EXCLUIR_PAGADAS}
            >
              Excluir cuotas pagadas
            </BotonPildora>
            <BotonPildora activo={borrador.soloVencidas} alAlternar={() => setBorrador((b) => ({ ...b, soloVencidas: !b.soloVencidas }))}>
              Solo cuotas vencidas
            </BotonPildora>
          </>
        }
      >
        <GrillaDeFiltros columnas={4}>
          <RangoDeFechasConAtajos
            etiqueta="Rango de Fechas de Vencimiento"
            obligatorio
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
          <CampoDeFiltro etiqueta="Cliente">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.cliente}
              placeholder="Buscar por nombre de cliente…"
              onChange={(e) => setBorrador((b) => ({ ...b, cliente: e.target.value }))}
            />
          </CampoDeFiltro>
          <CampoDeFiltro etiqueta="Riesgo">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.riesgo}
              placeholder="Buscar por descripción del riesgo…"
              onChange={(e) => setBorrador((b) => ({ ...b, riesgo: e.target.value }))}
            />
          </CampoDeFiltro>
          <FiltroMultiple
            variante="chips"
            etiqueta="Formas de Pago"
            valores={borrador.formasDePago}
            opciones={formasDePago}
            alCambiar={(v) => setBorrador((b) => ({ ...b, formasDePago: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={productores}
            alCambiar={(v) => setBorrador((b) => ({ ...b, productores: v }))}
          />
          <CampoDeFiltro etiqueta="Vendedores">
            <input className={CLASES_INPUT_DE_FILTRO} value="Todos" disabled readOnly title={AVISO_SIN_VENDEDORES} aria-label={`Vendedores. ${AVISO_SIN_VENDEDORES}`} />
          </CampoDeFiltro>
          <CampoDeFiltro etiqueta="Grupos">
            <input className={CLASES_INPUT_DE_FILTRO} value="Todos" disabled readOnly title={AVISO_SIN_GRUPOS} aria-label={`Grupos. ${AVISO_SIN_GRUPOS}`} />
          </CampoDeFiltro>
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <TablaDeListado
        etiqueta="Listado de vencimientos de cuotas"
        columnas={columnas}
        filas={aplicados ? filas : []}
        clave={(f) => f.id}
        cargando={cargando}
        vacio={aplicados ? 'No se encontraron cuotas con los filtros aplicados' : TEXTO_SIN_RANGO}
      />
    </div>
  )
}
