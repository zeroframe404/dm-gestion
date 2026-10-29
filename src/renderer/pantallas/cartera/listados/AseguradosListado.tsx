// Listado de Asegurados (Cartera → Asegurados): los clientes de la cartera en una tabla de a 10, con filtros
// plegables, exportación a Excel de TODO el resultado filtrado y el alta de clientes. Es la misma gente que
// Clientes; acá sólo cambia la forma de mirarla. El nombre abre la ficha en Clientes.
//
// Decisión sobre «Fusionar»: queda apagado. La fusión real (fusionarClientes) borra una ficha y es irreversible;
// hoy sólo se hace desde Cartera → Duplicados, donde el sistema propone qué pares son la misma persona, hay que
// elegir cuál queda y esperar la cuenta regresiva de confirmación. Ese diálogo es privado de aquella pantalla y
// armar acá uno que junte dos clientes cualesquiera sacaría esas protecciones.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FILTROS_DE_ASEGURADOS_VACIOS,
  TEXTO_DE_TIPO_DE_DOCUMENTO,
  TIPOS_DE_DOCUMENTO_FILTRABLES,
  type FilaDeAsegurado,
  type FiltrosDeAsegurados,
  type TipoDeDocumentoFiltrable,
} from '../../../../shared/listados'
import { exportarAExcel } from '../../../exportarAExcel'
import { FiltroMultiple } from '../../../componentes/FiltroMultiple'
import { Alerta, Boton } from '../../../componentes/ui'
import {
  AccionNoDisponible,
  CampoDeFiltro,
  CeldaDoble,
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

const TITULO = 'Listado de Asegurados'
const SIN_DATO = '—'

/** Las opciones de los filtros de lista, sacadas de TODOS los asegurados (no del resultado filtrado). */
interface OpcionesDeFiltros {
  productores: string[]
  sucursales: string[]
}

function distintos(valores: Array<string | null | undefined>): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valores) {
    const texto = valor?.trim()
    if (texto && !vistos.has(texto.toLocaleUpperCase('es'))) vistos.set(texto.toLocaleUpperCase('es'), texto)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

function opcionesDe(filas: FilaDeAsegurado[]): OpcionesDeFiltros {
  return { productores: distintos(filas.flatMap((fila) => fila.productores)), sucursales: distintos(filas.map((fila) => fila.sucursal)) }
}

function hayFiltros(filtros: FiltrosDeAsegurados): boolean {
  return Boolean(filtros.busqueda.trim() || filtros.productores.length || filtros.sucursales.length || filtros.tiposDeDocumento.length)
}

export default function AseguradosListado() {
  const { ir } = useNavegacion()
  const puedeEditar = usePuedeEditar('clientes')

  // `borrador` es lo que se está tipeando en el panel; `aplicados` es lo que se buscó con «Buscar».
  const [borrador, setBorrador] = useState<FiltrosDeAsegurados>(FILTROS_DE_ASEGURADOS_VACIOS)
  const [aplicados, setAplicados] = useState<FiltrosDeAsegurados>(FILTROS_DE_ASEGURADOS_VACIOS)
  const [filas, setFilas] = useState<FilaDeAsegurado[]>([])
  const [opciones, setOpciones] = useState<OpcionesDeFiltros>({ productores: [], sucursales: [] })
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
      columnas: ['Nombre completo', 'Tipo de documento', 'Documento', 'Email', 'Celular', 'Productor'],
      filas: filas.map((fila) => [fila.nombreCompleto, fila.tipoDocumento, fila.documento, fila.email, fila.celular, fila.productor]),
    })
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Se guardó la planilla en ${resultado.datos.ruta}`)
  }

  const columnas = useMemo<ColumnaDeListado<FilaDeAsegurado>[]>(
    () => [
      {
        id: 'nombre',
        encabezado: 'Nombre completo',
        celda: (fila) => <CeldaDoble principal={fila.nombreCompleto || SIN_DATO} alHacerClic={() => ir('clientes', { clienteId: fila.clienteId })} />,
      },
      {
        id: 'documento',
        encabezado: 'Documento',
        celda: (fila) => (fila.documento ? <CeldaDoble principal={fila.documento} secundario={fila.tipoDocumento} /> : SIN_DATO),
      },
      { id: 'email', encabezado: 'Email', celda: (fila) => fila.email ?? SIN_DATO },
      { id: 'celular', encabezado: 'Celular', celda: (fila) => fila.celular ?? SIN_DATO },
      { id: 'productor', encabezado: 'Productor', celda: (fila) => fila.productor ?? SIN_DATO },
    ],
    [ir],
  )

  const actualizar = (cambios: Partial<FiltrosDeAsegurados>) => setBorrador((previos) => ({ ...previos, ...cambios }))

  const opcionesDeTipo = TIPOS_DE_DOCUMENTO_FILTRABLES.map((tipo) => ({ valor: tipo, texto: TEXTO_DE_TIPO_DE_DOCUMENTO[tipo] }))

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

      <PanelDeFiltros alBuscar={buscar} alLimpiar={limpiar} buscando={cargando}>
        <GrillaDeFiltros columnas={4}>
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
        </GrillaDeFiltros>
      </PanelDeFiltros>

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
