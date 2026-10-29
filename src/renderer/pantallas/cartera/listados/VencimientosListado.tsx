// Listado de Vencimientos (Cartera → Vencimientos): es una BÚSQUEDA, no una lista que se carga sola. El rango de
// fechas de vencimiento es obligatorio; sin él «Buscar» queda apagado y la tabla pide elegirlo. Tabla paginada de 10
// y exportación a Excel de TODO el resultado. «Renovó» sale de `poliza_anterior_id` (la póliza que la reemplaza),
// no del estado. Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NOMBRE_TIPO_DE_VENCIMIENTO,
  TIPOS_DE_VENCIMIENTO,
  TIPOS_DE_VENCIMIENTO_DISPONIBLES,
  type FilaDeVencimiento,
  type FiltrosDeVencimientos,
  type TipoDeVencimiento,
} from '../../../../shared/listados/vencimientos'
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
} from '../../../componentes/listados'
import { useRefrescoEnVivo } from '../../../contexto/DatosEnVivo'
import { useNavegacion } from '../../../contexto/Navegacion'
import { exportarAExcel } from '../../../exportarAExcel'

const FILTROS_VACIOS: FiltrosDeVencimientos = {
  desde: '',
  hasta: '',
  tipo: 'RENOVACION',
  companias: [],
  ramas: [],
  productores: [],
  formasDePago: [],
  incluirAnuladas: false,
  excluirRenovadas: false,
  soloRenovadas: false,
}

const AVISO_SIN_REFACTURACION = 'Todavía no está disponible: el sistema no registra refacturaciones, sólo renovaciones.'
const AVISO_SIN_VENDEDORES = 'Todavía no está disponible: las pólizas no tienen vendedor. Para filtrar por quien la vende usá Productores.'
const AVISO_SIN_GRUPOS = 'Todavía no está disponible: todavía no existen los grupos de clientes.'
const MOTIVO_SIN_RANGO = 'Elegí el rango de fechas de vencimiento para poder buscar.'
const TEXTO_SIN_RANGO = 'Seleccioná un rango de fechas de vencimiento para buscar'

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion. */
function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Los valores distintos y sin vacíos de una columna, ordenados, para las opciones de un filtro. */
function distintos(filas: readonly FilaDeVencimiento[], de: (fila: FilaDeVencimiento) => string | null): string[] {
  return [...new Set(filas.map(de).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'es'))
}

/** El rango es válido cuando están las dos fechas y no están al revés. */
function rangoCompleto(f: Pick<FiltrosDeVencimientos, 'desde' | 'hasta'>): boolean {
  return f.desde !== '' && f.hasta !== '' && f.desde <= f.hasta
}

export default function VencimientosListado() {
  const { ir } = useNavegacion()
  const [borrador, setBorrador] = useState<FiltrosDeVencimientos>(FILTROS_VACIOS)
  // null = todavía no se buscó nada. Una búsqueda se hace con «Buscar», no al tipear.
  const [aplicados, setAplicados] = useState<FiltrosDeVencimientos | null>(null)
  const [filas, setFilas] = useState<FilaDeVencimiento[]>([])
  // Todas las pólizas con vencimiento cargado, sin filtrar: de ahí salen las opciones de los desplegables.
  const [catalogo, setCatalogo] = useState<FilaDeVencimiento[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDeVencimientos, enSilencio = false) => {
    const mia = ++peticion.current
    if (!enSilencio) setCargando(true)
    const resultado = await window.dm.listados.vencimientos(filtros)
    if (mia !== peticion.current) return
    if (resultado.ok) {
      setFilas(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    // La respuesta vigente siempre cierra el «Cargando», aunque sea una recarga silenciosa que pisó a una búsqueda en vuelo.
    setCargando(false)
  }, [])

  const cargarCatalogo = useCallback(async () => {
    // Un rango que abarca todo, con las anuladas: sólo para saber qué compañías, ramas, productores y formas de pago existen.
    const resultado = await window.dm.listados.vencimientos({
      ...FILTROS_VACIOS,
      desde: '1900-01-01',
      hasta: '2999-12-31',
      incluirAnuladas: true,
    })
    if (resultado.ok) setCatalogo(resultado.datos)
  }, [])

  useEffect(() => {
    void cargarCatalogo()
  }, [cargarCatalogo])

  useEffect(() => {
    if (aplicados) void cargar(aplicados)
  }, [cargar, aplicados])

  // Una póliza cargada o renovada en otra sucursal aparece sola (sólo si ya hay una búsqueda hecha).
  useRefrescoEnVivo({
    tipos: ['MENSUAL', 'BAJAS'],
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
    setBorrador(FILTROS_VACIOS)
    setAplicados(null)
    setFilas([])
    setCargando(false)
  }

  // «Excluir renovadas» y «Solo renovadas» se contradicen: al encender una se apaga la otra.
  const alternarExcluirRenovadas = () =>
    setBorrador((b) => ({ ...b, excluirRenovadas: !b.excluirRenovadas, soloRenovadas: b.excluirRenovadas ? b.soloRenovadas : false }))
  const alternarSoloRenovadas = () =>
    setBorrador((b) => ({ ...b, soloRenovadas: !b.soloRenovadas, excluirRenovadas: b.soloRenovadas ? b.excluirRenovadas : false }))

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    // Todo el resultado (no sólo la página que se ve), con las columnas y el orden de la tabla.
    const resultado = await exportarAExcel({
      titulo: 'Listado de Vencimientos',
      columnas: ['Compañía', 'Póliza', 'Cliente', 'Vencimiento', 'Tipo', 'Renovó', 'Póliza nueva', 'Riesgo', 'Productor'],
      filas: filas.map((f) => [
        f.compania ?? '',
        f.numero ?? '',
        f.cliente,
        verFecha(f.vencimiento) === '—' ? '' : verFecha(f.vencimiento),
        f.tipo,
        f.renovada ? 'Sí' : 'No',
        f.renovadaPorNumero ?? '',
        f.riesgo ?? '',
        f.productor ?? '',
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`)
  }

  const columnas: ColumnaDeListado<FilaDeVencimiento>[] = [
    { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
    {
      id: 'poliza',
      encabezado: 'Póliza / Endoso',
      celda: (f) => (
        <CeldaDoble
          principal={f.numero ?? 'Sin número'}
          secundario={f.anulada ? 'Anulada' : f.ramo}
          alHacerClic={() => ir('polizas', { polizaId: f.polizaId })}
        />
      ),
    },
    { id: 'cliente', encabezado: 'Cliente', celda: (f) => f.cliente },
    { id: 'vencimiento', encabezado: 'Vencimiento', celda: (f) => verFecha(f.vencimiento) },
    { id: 'tipo', encabezado: 'Tipo', celda: (f) => f.tipo },
    {
      id: 'renovo',
      encabezado: 'Renovó / Refacturó',
      celda: (f) =>
        f.renovada ? (
          <CeldaDoble principal={<ChipDeEstado tono="verde">Sí</ChipDeEstado>} secundario={f.renovadaPorNumero} />
        ) : (
          <ChipDeEstado tono="gris">No</ChipDeEstado>
        ),
    },
    { id: 'riesgo', encabezado: 'Riesgo', celda: (f) => f.riesgo ?? '—' },
    { id: 'productor', encabezado: 'Productor', celda: (f) => f.productor ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="calendario"
        titulo="Listado de Vencimientos"
        subtitulo="Buscar pólizas próximas a vencer por renovación o refacturación"
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
            <BotonPildora activo={false} alAlternar={() => undefined} disabled title={AVISO_SIN_REFACTURACION}>
              Excluir refacturación mensual
            </BotonPildora>
            <BotonPildora activo={borrador.incluirAnuladas} alAlternar={() => setBorrador((b) => ({ ...b, incluirAnuladas: !b.incluirAnuladas }))}>
              Incluir pólizas anuladas
            </BotonPildora>
            <BotonPildora activo={borrador.excluirRenovadas} alAlternar={alternarExcluirRenovadas}>
              Excluir renovadas/refacturadas
            </BotonPildora>
            <BotonPildora activo={borrador.soloRenovadas} alAlternar={alternarSoloRenovadas}>
              Solo renovadas/refacturadas
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
          <CampoDeFiltro etiqueta="Tipo de Vencimiento">
            <select
              className={CLASES_INPUT_DE_FILTRO}
              value={borrador.tipo}
              onChange={(e) => setBorrador((b) => ({ ...b, tipo: e.target.value as TipoDeVencimiento }))}
              title={AVISO_SIN_REFACTURACION}
            >
              {TIPOS_DE_VENCIMIENTO.map((tipo) => {
                const disponible = TIPOS_DE_VENCIMIENTO_DISPONIBLES.includes(tipo)
                return (
                  <option key={tipo} value={tipo} disabled={!disponible}>
                    {NOMBRE_TIPO_DE_VENCIMIENTO[tipo]}
                    {disponible ? '' : ' (no disponible)'}
                  </option>
                )
              })}
            </select>
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
          <CampoDeFiltro etiqueta="Vendedores">
            <input className={CLASES_INPUT_DE_FILTRO} value="Todos" disabled readOnly title={AVISO_SIN_VENDEDORES} aria-label={`Vendedores. ${AVISO_SIN_VENDEDORES}`} />
          </CampoDeFiltro>
          <FiltroMultiple
            variante="chips"
            etiqueta="Formas de Pago"
            valores={borrador.formasDePago}
            opciones={formasDePago}
            alCambiar={(v) => setBorrador((b) => ({ ...b, formasDePago: v }))}
          />
          <CampoDeFiltro etiqueta="Grupos">
            <input className={CLASES_INPUT_DE_FILTRO} value="Todos" disabled readOnly title={AVISO_SIN_GRUPOS} aria-label={`Grupos. ${AVISO_SIN_GRUPOS}`} />
          </CampoDeFiltro>
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <TablaDeListado
        etiqueta="Listado de vencimientos"
        columnas={columnas}
        filas={aplicados ? filas : []}
        clave={(f) => f.polizaId}
        cargando={cargando}
        vacio={aplicados ? 'No se encontraron pólizas que venzan en ese rango' : TEXTO_SIN_RANGO}
      />
    </div>
  )
}
