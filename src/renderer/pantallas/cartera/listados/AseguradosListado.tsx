// Listado de Asegurados (Cartera → Asegurados): los clientes de la cartera en una tabla de a 10, con filtros
// plegables, exportación a Excel de TODO el resultado filtrado y el alta de clientes. Es la misma gente que
// Clientes; acá sólo cambia la forma de mirarla. El nombre abre la ficha en Clientes.
//
// Aseguradoras: cada cliente muestra con qué compañías está y de dónde salió el dato —«API» si la propia
// aseguradora lo confirmó (fuente principal), «VPS» si sólo lo dice la cartera—. Al abrir la pantalla se
// consulta a las APIs en segundo plano (sólo lo que está viejo) y la tabla se refresca sola al terminar.
//
// Decisión sobre «Fusionar»: queda apagado. La fusión real (fusionarClientes) borra una ficha y es irreversible;
// hoy sólo se hace desde Cartera → Duplicados, donde el sistema propone qué pares son la misma persona, hay que
// elegir cuál queda y esperar la cuenta regresiva de confirmación. Ese diálogo es privado de aquella pantalla y
// armar acá uno que junte dos clientes cualesquiera sacaría esas protecciones.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  claveDeAseguradora,
  FILTROS_DE_ASEGURADOS_VACIOS,
  FUENTES_DE_ASEGURADORA,
  TEXTO_DE_FUENTE_DE_ASEGURADORA,
  TEXTO_DE_TIPO_DE_DOCUMENTO,
  TIPOS_DE_DOCUMENTO_FILTRABLES,
  type EstadoDeApisDeAsegurados,
  type FilaDeAsegurado,
  type FiltrosDeAsegurados,
  type FuenteDeAseguradora,
  type TipoDeDocumentoFiltrable,
} from '../../../../shared/listados'
import { exportarAExcel } from '../../../exportarAExcel'
import { FiltroMultiple } from '../../../componentes/FiltroMultiple'
import { Alerta, Boton } from '../../../componentes/ui'
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
} from '../../../componentes/listados'
import { useNavegacion } from '../../../contexto/Navegacion'
import { useRefrescoEnVivo } from '../../../contexto/DatosEnVivo'
import { usePuedeEditar } from '../../../contexto/Permisos'
import { DialogoNuevoCliente } from '../../clientes/DialogoNuevoCliente'
import {
  BarraDeAseguradoras,
  CeldaDeAsegurado,
  CeldaDeAseguradoras,
  CeldaDeContacto,
  CeldaDePolizas,
  PanelDeFuentes,
  TarjetaDeResumen,
  type AseguradoraConCantidad,
} from './AseguradosPiezas'

const TITULO = 'Listado de Asegurados'
const SIN_DATO = '—'

/** Las opciones de los filtros de lista, sacadas de TODOS los asegurados (no del resultado filtrado). */
interface OpcionesDeFiltros {
  productores: string[]
  sucursales: string[]
  /** Las aseguradoras de toda la cartera, con cuántos asegurados tiene cada una (la barra rápida). */
  aseguradoras: AseguradoraConCantidad[]
}

function distintos(valores: Array<string | null | undefined>): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valores) {
    const texto = valor?.trim()
    if (texto && !vistos.has(texto.toLocaleUpperCase('es'))) vistos.set(texto.toLocaleUpperCase('es'), texto)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

/** Cuántos asegurados tiene cada aseguradora (y cuántos confirmados por API), de la que más tiene a la que menos. */
function aseguradorasConCantidad(filas: FilaDeAsegurado[]): AseguradoraConCantidad[] {
  const cuentas = new Map<string, AseguradoraConCantidad>()
  for (const fila of filas) {
    for (const a of fila.aseguradoras) {
      const clave = claveDeAseguradora(a.nombre)
      const cuenta = cuentas.get(clave) ?? { nombre: a.nombre, cantidad: 0, porApi: 0 }
      cuenta.cantidad++
      if (a.fuente === 'API') cuenta.porApi++
      cuentas.set(clave, cuenta)
    }
  }
  return [...cuentas.values()].sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'))
}

function opcionesDe(filas: FilaDeAsegurado[]): OpcionesDeFiltros {
  return {
    productores: distintos(filas.flatMap((fila) => fila.productores)),
    sucursales: distintos(filas.map((fila) => fila.sucursal)),
    aseguradoras: aseguradorasConCantidad(filas),
  }
}

function hayFiltros(filtros: FiltrosDeAsegurados): boolean {
  return Boolean(
    filtros.busqueda.trim() ||
      filtros.productores.length ||
      filtros.sucursales.length ||
      filtros.tiposDeDocumento.length ||
      filtros.aseguradoras.length ||
      filtros.fuentes.length,
  )
}

/** «GALENO (API), ATM (VPS)»: la columna de aseguradoras en la planilla. */
function aseguradorasEnTexto(fila: FilaDeAsegurado): string | null {
  return fila.aseguradoras.length > 0 ? fila.aseguradoras.map((a) => `${a.nombre} (${a.fuente})`).join(', ') : null
}

export default function AseguradosListado() {
  const { ir } = useNavegacion()
  const puedeEditar = usePuedeEditar('clientes')

  // `borrador` es lo que se está tipeando en el panel; `aplicados` es lo que se buscó con «Buscar».
  const [borrador, setBorrador] = useState<FiltrosDeAsegurados>(FILTROS_DE_ASEGURADOS_VACIOS)
  const [aplicados, setAplicados] = useState<FiltrosDeAsegurados>(FILTROS_DE_ASEGURADOS_VACIOS)
  const [filas, setFilas] = useState<FilaDeAsegurado[]>([])
  const [opciones, setOpciones] = useState<OpcionesDeFiltros>({ productores: [], sucursales: [], aseguradoras: [] })
  const [apis, setApis] = useState<EstadoDeApisDeAsegurados | null>(null)
  const [consultandoApis, setConsultandoApis] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  // Sólo vale la respuesta de la última consulta: si se busca dos veces seguidas, la lenta no pisa a la nueva.
  const consulta = useRef(0)

  const cargar = useCallback(async (filtros: FiltrosDeAsegurados, { enSilencio = false, conOpciones = false } = {}) => {
    const numero = ++consulta.current
    if (!enSilencio) setCargando(true)
    const resultado = await window.dm.listados.asegurados(filtros)
    // Las opciones de los desplegables salen de la cartera entera; si el resultado ya es la cartera entera se reusa.
    const todas = conOpciones && hayFiltros(filtros) ? await window.dm.listados.asegurados(FILTROS_DE_ASEGURADOS_VACIOS) : resultado
    if (numero !== consulta.current) return
    setCargando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setError(null)
    setFilas(resultado.datos)
    if (conOpciones && todas.ok) setOpciones(opcionesDe(todas.datos))
  }, [])

  useEffect(() => {
    void cargar(FILTROS_DE_ASEGURADOS_VACIOS, { conOpciones: true })
  }, [cargar])

  // Los filtros aplicados, para recargar con ellos cuando terminan las APIs (el efecto no depende de ellos).
  const aplicadosActuales = useRef(aplicados)
  aplicadosActuales.current = aplicados

  // Una pasada por las APIs de las aseguradoras. Mientras corre, la tabla ya se ve con lo que había.
  const consultarApis = useCallback(
    async (forzar: boolean) => {
      setConsultandoApis(true)
      const resultado = await window.dm.listados.consultarApisDeAsegurados({ forzar })
      setConsultandoApis(false)
      if (resultado.ok) setApis(resultado.datos)
      void cargar(aplicadosActuales.current, { enSilencio: true, conOpciones: true })
    },
    [cargar],
  )

  useEffect(() => {
    void window.dm.listados.apisDeAsegurados().then((resultado) => {
      if (resultado.ok) setApis(resultado.datos)
    })
    // Al abrir sólo se pide lo que está viejo: Galeno cada 6 horas, ATM y Equidad lo que no se preguntó hoy.
    void consultarApis(false)
  }, [consultarApis])

  // Un cliente dado de alta en otra computadora aparece solo. Espera mientras haya un diálogo abierto.
  useRefrescoEnVivo({
    tipos: ['MENSUAL', 'BAJAS'],
    recargar: () => cargar(aplicados, { enSilencio: true, conOpciones: true }),
    postergar: () => dialogoAbierto,
  })

  const buscar = () => {
    setAplicados(borrador)
    void cargar(borrador)
  }

  /** La barra rápida de aseguradoras filtra al toque, sin pasar por «Buscar». */
  const alternarAseguradora = (nombre: string) => {
    const elegidas = aplicados.aseguradoras.includes(nombre) ? aplicados.aseguradoras.filter((a) => a !== nombre) : [...aplicados.aseguradoras, nombre]
    const nuevos = { ...aplicados, aseguradoras: elegidas }
    setBorrador((previos) => ({ ...previos, aseguradoras: elegidas }))
    setAplicados(nuevos)
    void cargar(nuevos)
  }

  const limpiar = () => {
    setBorrador(FILTROS_DE_ASEGURADOS_VACIOS)
    setAplicados(FILTROS_DE_ASEGURADOS_VACIOS)
    void cargar(FILTROS_DE_ASEGURADOS_VACIOS)
  }

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    // Se baja TODO el resultado filtrado (no sólo la página que se ve), con las mismas columnas de la tabla.
    const resultado = await exportarAExcel({
      titulo: TITULO,
      columnas: ['Nombre completo', 'Tipo de documento', 'Documento', 'Email', 'Celular', 'Aseguradoras (origen)', 'Productor', 'Pólizas vigentes', 'Sucursal'],
      filas: filas.map((fila) => [
        fila.nombreCompleto,
        fila.tipoDocumento,
        fila.documento,
        fila.email,
        fila.celular,
        aseguradorasEnTexto(fila),
        fila.productor,
        fila.polizasVigentes,
        fila.sucursal,
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó la planilla en ${resultado.datos.ruta}`)
  }

  const columnas = useMemo<ColumnaDeListado<FilaDeAsegurado>[]>(
    () => [
      {
        id: 'nombre',
        encabezado: 'Asegurado',
        alineacion: 'izquierda',
        celda: (fila) => (
          <CeldaDeAsegurado nombre={fila.nombreCompleto || SIN_DATO} detalle={fila.sucursal} alAbrir={() => ir('clientes', { clienteId: fila.clienteId })} />
        ),
      },
      {
        id: 'documento',
        encabezado: 'Documento',
        celda: (fila) =>
          fila.documento ? (
            <CeldaDoble principal={fila.documento} secundario={fila.tipoDocumento ? <ChipDeEstado tono="azul">{fila.tipoDocumento}</ChipDeEstado> : null} />
          ) : (
            SIN_DATO
          ),
      },
      { id: 'contacto', encabezado: 'Contacto', alineacion: 'izquierda', celda: (fila) => <CeldaDeContacto celular={fila.celular} email={fila.email} /> },
      { id: 'aseguradoras', encabezado: 'Aseguradoras', celda: (fila) => <CeldaDeAseguradoras aseguradoras={fila.aseguradoras} /> },
      { id: 'productor', encabezado: 'Productor', celda: (fila) => <span className="text-xs font-medium text-slate-600">{fila.productor ?? SIN_DATO}</span> },
      { id: 'polizas', encabezado: 'Pólizas', celda: (fila) => <CeldaDePolizas vigentes={fila.polizasVigentes} /> },
    ],
    [ir],
  )

  const actualizar = (cambios: Partial<FiltrosDeAsegurados>) => setBorrador((previos) => ({ ...previos, ...cambios }))

  const opcionesDeTipo = TIPOS_DE_DOCUMENTO_FILTRABLES.map((tipo) => ({ valor: tipo, texto: TEXTO_DE_TIPO_DE_DOCUMENTO[tipo] }))
  const opcionesDeFuente = FUENTES_DE_ASEGURADORA.map((fuente) => ({ valor: fuente, texto: TEXTO_DE_FUENTE_DE_ASEGURADORA[fuente] }))

  // El resumen es del resultado que se ve (con los filtros aplicados).
  const resumen = useMemo(() => {
    const conVigentes = filas.filter((fila) => fila.polizasVigentes > 0).length
    const porApi = filas.filter((fila) => fila.aseguradoras.some((a) => a.fuente === 'API')).length
    const aseguradoras = aseguradorasConCantidad(filas)
    const porcentaje = (parte: number) => (filas.length > 0 ? `${Math.round((parte / filas.length) * 100)} %` : '0 %')
    return { conVigentes, porApi, aseguradoras, porcentaje }
  }, [filas])

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="usuario"
        titulo={TITULO}
        subtitulo="Buscar y administrar los clientes asegurados de tu cartera"
        acciones={
          <>
            <AccionNoDisponible icono="enlace" motivo="Para juntar dos fichas repetidas usá Cartera → Planilla del mes → Duplicados: ahí el sistema propone los pares y se confirma antes de borrar una ficha, algo que no se puede deshacer.">
              Fusionar
            </AccionNoDisponible>
            <AccionNoDisponible icono="usuario" motivo="Todavía no se pueden asignar vendedores: la cartera no guarda un vendedor por cliente.">
              Asignar Vendedores
            </AccionNoDisponible>
            <Boton icono="descargar" onClick={() => void exportar()} disabled={cargando || exportando || filas.length === 0} cargando={exportando}>
              Exportar Excel
            </Boton>
            {puedeEditar && (
              <Boton variante="primario" icono="mas" onClick={() => setDialogoAbierto(true)}>
                Crear Cliente
              </Boton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaDeResumen icono="usuario" tono="marino" titulo="Asegurados" valor={filas.length} detalle={hayFiltros(aplicados) ? 'con los filtros aplicados' : 'en toda la cartera'} />
        <TarjetaDeResumen icono="escudo" tono="verde" titulo="Con póliza vigente" valor={resumen.conVigentes} detalle={`${resumen.porcentaje(resumen.conVigentes)} del total`} />
        <TarjetaDeResumen icono="ok" tono="violeta" titulo="Confirmados por API" valor={resumen.porApi} detalle={`${resumen.porcentaje(resumen.porApi)} · el resto, según el VPS`} />
        <TarjetaDeResumen
          icono="sucursal"
          tono="ambar"
          titulo="Aseguradoras"
          valor={resumen.aseguradoras.length}
          detalle={resumen.aseguradoras[0] ? `La que más tiene: ${resumen.aseguradoras[0].nombre}` : 'sin aseguradoras cargadas'}
        />
      </div>

      <PanelDeFuentes estado={apis} consultando={consultandoApis} alConsultar={() => void consultarApis(true)} />

      <PanelDeFiltros alBuscar={buscar} alLimpiar={limpiar} buscando={cargando}>
        <GrillaDeFiltros columnas={3}>
          <CampoDeFiltro etiqueta="Buscar">
            <input
              type="search"
              value={borrador.busqueda}
              onChange={(evento) => actualizar({ busqueda: evento.target.value })}
              placeholder="Nombre, documento, email o celular"
              maxLength={100}
              className={CLASES_INPUT_DE_FILTRO}
            />
          </CampoDeFiltro>
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={opciones.productores}
            alCambiar={(productores) => actualizar({ productores })}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Sucursales"
            plural="todas"
            valores={borrador.sucursales}
            opciones={opciones.sucursales}
            alCambiar={(sucursales) => actualizar({ sucursales })}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Tipo de documento"
            plural="todos"
            valores={borrador.tiposDeDocumento}
            opciones={opcionesDeTipo}
            alCambiar={(tipos) => actualizar({ tiposDeDocumento: tipos as TipoDeDocumentoFiltrable[] })}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Aseguradoras"
            plural="todas"
            valores={borrador.aseguradoras}
            opciones={opciones.aseguradoras.map((a) => a.nombre)}
            alCambiar={(aseguradoras) => actualizar({ aseguradoras })}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Origen de la aseguradora"
            plural="todos"
            valores={borrador.fuentes}
            opciones={opcionesDeFuente}
            alCambiar={(fuentes) => actualizar({ fuentes: fuentes as FuenteDeAseguradora[] })}
          />
        </GrillaDeFiltros>
      </PanelDeFiltros>

      <BarraDeAseguradoras aseguradoras={opciones.aseguradoras} elegidas={aplicados.aseguradoras} alAlternar={alternarAseguradora} />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <TablaDeListado
        etiqueta={TITULO}
        columnas={columnas}
        filas={filas}
        clave={(fila) => fila.clienteId}
        cargando={cargando}
        vacio={hayFiltros(aplicados) ? 'No se encontraron asegurados con esos filtros' : 'Todavía no hay asegurados cargados'}
      />

      <DialogoNuevoCliente
        abierto={dialogoAbierto}
        alCerrar={() => setDialogoAbierto(false)}
        alCrear={(cliente) => {
          setDialogoAbierto(false)
          ir('clientes', { clienteId: cliente.id })
        }}
        alAbrirExistente={(clienteId) => {
          setDialogoAbierto(false)
          ir('clientes', { clienteId })
        }}
      />
    </div>
  )
}
