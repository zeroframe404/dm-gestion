// La planilla del mes: la pantalla donde se trabaja todos los días. Es la hoja de Excel de siempre,
// con el semáforo calculado solo y las tres acciones de un clic (avisar, registrar pago, dar de baja).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRefrescoEnVivo } from '../../contexto/DatosEnVivo'
import { diasEntre } from '../../../shared/polizas'
import {
  calcularAlerta,
  nombreDePeriodo,
  NOMBRE_COLOR,
  ORDEN_COLORES,
  type Alerta,
  type ColorAlerta,
} from '../../../shared/semaforo'
import { coincideAlguno, mismoTextoDeFiltro } from '../../../shared/filtros'
import { claveDeCelda } from '../../../shared/presencia'
import { NOMBRE_RAMA, ramaDeVehiculo, type Rama } from '../../../shared/ramas'
import { mismaSucursal } from '../../../shared/sucursales'
import type { CampoEditable, FilaCartera, PlanillaDelMes as DatosPlanilla } from '../../../shared/tipos'
import { DialogoRechazo } from '../../componentes/DialogoRechazo'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { Icono } from '../../componentes/Icono'
import { MarcaDePresencia, motivoDelBloqueo } from '../../componentes/Presencia'
import { SelectorDeColumnas, useColumnasElegidas } from '../../componentes/SelectorDeColumnas'
import { Alerta as Aviso, Boton, Cargando, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useBloqueoDe, useReportarFoco } from '../../contexto/Presencia'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoBaja } from './DialogoBaja'
import { DialogoPago } from './DialogoPago'
import { PanelDetalle } from './PanelDetalle'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'

/**
 * De qué campo lógico es cada columna que se puede editar.
 *
 * Existe por el glow de la 14.0: el foco de una celda viaja como `celda:<filaId>:<campo>` y tiene que
 * ser el mismo texto en las cinco computadoras, así que no puede ser el id de la columna —que es de
 * esta pantalla— sino el campo. Cuatro no coinciden («vencimiento» es `diaVencimiento`, «póliza» es
 * `numeroPoliza», «desde» y «hasta» son `vigenciaDesde` y `vigenciaHasta`), y antes de esto el par
 * vivía suelto en cada declaración de columna. Acá está una sola vez y `celdaEditable` lo lee de acá.
 */
const CAMPO_DE_LA_COLUMNA = {
  nombre: 'nombre',
  sucursal: 'sucursal',
  telefono: 'telefono',
  documento: 'documento',
  vencimiento: 'diaVencimiento',
  cuota: 'cuota',
  formaPago: 'formaPago',
  aviso: 'aviso',
  vehiculo: 'vehiculo',
  marca: 'marca',
  modelo: 'modelo',
  patente: 'patente',
  anio: 'anio',
  cobertura: 'cobertura',
  compania: 'compania',
  poliza: 'numeroPoliza',
  propuesta: 'propuesta',
  desde: 'vigenciaDesde',
  hasta: 'vigenciaHasta',
  observaciones: 'observaciones',
} as const satisfies Record<string, CampoEditable>

type ColumnaEditable = keyof typeof CAMPO_DE_LA_COLUMNA

/** Fila con su alerta y su rama ya calculadas: se calculan una vez por render, no por celda. */
interface FilaConAlerta {
  fila: FilaCartera
  alerta: Alerta
  /** La rama que le corresponde («PICK UP», «MOTO»…), o null cuando el riesgo no es de ninguna de las siete. */
  rama: Rama | null
}

const CLASES_COLOR: Record<ColorAlerta, string> = {
  verde: 'bg-green-100 text-green-800 border-green-200',
  azul: 'bg-sky-100 text-sky-800 border-sky-200',
  amarillo: 'bg-amber-100 text-amber-900 border-amber-200',
  naranja: 'bg-orange-200 text-orange-900 border-orange-300',
  rojo: 'bg-red-100 text-red-800 border-red-200',
  neutro: 'bg-slate-100 text-slate-500 border-slate-200',
  violeta: 'bg-violet-100 text-violet-900 border-violet-200',
}

const PUNTO_COLOR: Record<ColorAlerta, string> = {
  verde: 'bg-green-500',
  azul: 'bg-sky-500',
  amarillo: 'bg-amber-400',
  naranja: 'bg-orange-500',
  rojo: 'bg-red-500',
  neutro: 'bg-slate-300',
  violeta: 'bg-violet-500',
}

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/**
 * Qué dice la tabla cuando no queda ninguna fila. Filtrar por sucursal sobre un mes que no tiene la
 * sucursal cargada devuelve cero SIEMPRE, y como el desplegable se arma con el catálogo —que está en
 * todas las computadoras— parece que el filtro tendría que andar. Acá se dice de dónde sale el vacío.
 */
function mensajeDeVacio(sucursales: readonly string[], sinSucursal: number, total: number): string {
  const base = 'Ninguna fila coincide con los filtros.'
  if (sucursales.length === 0 || total === 0 || sinSucursal === 0) return base
  const elegidas = sucursales.length === 1 ? `«${sucursales[0]}»` : `«${sucursales.join('», «')}»`
  if (sinSucursal === total) {
    return (
      `Ninguna fila de este mes tiene la sucursal cargada, así que filtrar por ${elegidas} no puede traer nada. ` +
      'Suele pasar cuando la planilla que importó esta computadora no trae la columna LOCAL: miralo en ' +
      'Administración → Reimportar la base, en «Columnas reconocidas por pestaña».'
    )
  }
  return `${base} Ojo: ${sinSucursal.toLocaleString('es-AR')} de las ${total.toLocaleString('es-AR')} filas del mes no tienen sucursal cargada.`
}

/**
 * Los contadores de arriba también filtran: `''` es «Total», que no filtra nada. Cada uno usa
 * exactamente la misma condición con la que se contó, así el número del cartel y las filas que
 * quedan en la tabla no pueden discrepar.
 */
type Contador = '' | 'vencenHoy' | 'vencidos' | 'avisadosHoy' | 'coberturaPorTerminar' | 'pagadosHoy' | 'imputados' | 'adelantos'

function estaPagada(fila: FilaCartera): boolean {
  return Boolean(fila.pagoFecha) || fila.pagoRegistrado
}

/**
 * Días que le quedan de cobertura financiera a una fila ya vencida, o null si no corresponde.
 *
 * La cobertura financiera son los días que la compañía sigue cubriendo al cliente después del
 * vencimiento y los pone cada una (ATM 7, Equidad 5, Metropol 3…, se configuran en Administración →
 * Compañías). El semáforo ya calcula hasta qué día llega; acá sólo se mira cuántos días faltan.
 *
 * Las pagas y las de débito automático quedan afuera solas: el semáforo no les calcula fin de
 * cobertura, porque no hay nada que perseguir.
 */
function diasDeCoberturaQueQuedan(entrada: FilaConAlerta, hoy: string): number | null {
  const { alerta } = entrada
  if (alerta.diasParaVencer === null || alerta.diasParaVencer >= 0 || !alerta.finCobertura) return null
  return diasEntre(hoy, alerta.finCobertura)
}

function entraEnElContador(entrada: FilaConAlerta, contador: Contador, hoy: string): boolean {
  const { fila, alerta } = entrada
  switch (contador) {
    case 'vencenHoy':
      return !estaPagada(fila) && alerta.diasParaVencer === 0
    case 'vencidos':
      return !estaPagada(fila) && alerta.diasParaVencer !== null && alerta.diasParaVencer < 0
    case 'avisadosHoy':
      return (fila.fechaEnvio ?? '').startsWith(hoy)
    // Ya venció y la compañía todavía lo cubre, pero por poco: son los que hay que llamar hoy, porque
    // cuando se termina la cobertura el cliente queda sin seguro.
    case 'coberturaPorTerminar': {
      const quedan = diasDeCoberturaQueQuedan(entrada, hoy)
      return !estaPagada(fila) && quedan !== null && quedan >= 0
    }
    case 'pagadosHoy':
      return fila.pagoFecha === hoy
    // Imputadas a la compañía y todavía sin cobrar al cliente: es plata que falta que entre.
    case 'imputados':
      return !estaPagada(fila) && fila.pagoImputado
    // Con un pago adelantado esperando que alguien lo impute a la fila.
    case 'adelantos':
      return !estaPagada(fila) && fila.pagoAdelantado !== null
    default:
      return true
  }
}

/**
 * Cada desplegable guarda una LISTA, no un valor: la agencia mira «ATM y Metropol» de una sentada, o
 * «Dock Sud, Daniel y Sarandí» juntas, y antes había que elegir uno, mirar, volver y elegir el otro.
 * La lista vacía es «todas» —es lo mismo que decía el `''` de antes—, así que un filtro sin nada
 * elegido sigue sin filtrar nada.
 */
interface Filtros {
  busqueda: string
  sucursales: string[]
  formasDePago: string[]
  companias: string[]
  ramas: string[]
  colores: string[]
  soloAvisarVto: boolean
  contador: Contador
}

const FILTROS_VACIOS: Filtros = {
  busqueda: '',
  sucursales: [],
  formasDePago: [],
  companias: [],
  ramas: [],
  colores: [],
  soloAvisarVto: false,
  contador: '',
}

export function PlanillaDelMes() {
  const usuario = useUsuarioActual()
  const puedeEditarCartera = usePuedeEditar('cartera')
  const puedeCerrarMes = usuario.rol !== 'EMPLEADO' && puedeEditarCartera

  const [datos, setDatos] = useState<DatosPlanilla | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ filaId: string; campo: CampoEditable } | null>(null)
  const [pagoDe, setPagoDe] = useState<FilaCartera | null>(null)
  const [bajaDe, setBajaDe] = useState<FilaCartera | null>(null)
  const [rechazoDe, setRechazoDe] = useState<FilaCartera | null>(null)
  const [cerrando, setCerrando] = useState(false)

  /**
   * `enSilencio` es la recarga que dispara el aviso en vivo cuando otra sucursal tocó este mes: no
   * pone la pantalla en blanco ni borra el error a la vista, sólo cambia las filas. Sin eso, la
   * planilla entera parpadearía sola cada vez que alguien cobra una cuota en otro mostrador.
   */
  const cargar = useCallback(async (periodo: string | null, opciones: { enSilencio?: boolean } = {}) => {
    if (!opciones.enSilencio) {
      setCargando(true)
      setError(null)
    }
    const resultado = await window.dm.cartera.planilla(periodo)
    if (resultado.ok) setDatos(resultado.datos)
    else if (!opciones.enSilencio) setError(resultado.error)
    if (!opciones.enSilencio) setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  /**
   * Lo que cobró, dio de baja o cargó la otra sucursal aparece acá solo. Es la pantalla donde más se
   * nota: dos mostradores trabajan el mismo mes al mismo tiempo.
   *
   * ESPERA MIENTRAS SE ESTÁ EDITANDO. `CeldaEditable` es un `<input>` no controlado, así que un
   * re-render no le borra lo tipeado; pero si la fila que se está editando desapareció del servidor,
   * React desmonta el input y lo escrito se pierde sin que nadie se entere. Y los tres diálogos
   * (cobrar, dar de baja, anotar un rechazo) guardan una copia congelada de la fila: recargar abajo
   * los dejaría trabajando sobre datos que ya no son los de la pantalla. En los dos casos el aviso
   * queda anotado y el refresco sale apenas se cierra lo que está abierto.
   */
  useRefrescoEnVivo({
    tipos: ['MENSUAL', 'BAJAS', 'PAGOS', 'APP_RECHAZOS'],
    recargar: () => cargar(datos?.periodo ?? null, { enSilencio: true }),
    postergar: () => editando !== null || pagoDe !== null || bajaDe !== null || rechazoDe !== null || cerrando,
  })

  /**
   * El foco de la 14.0: mientras esta computadora tiene una celda abierta, las otras cuatro la ven
   * con el anillo de este color y no la pueden abrir.
   *
   * Va en un efecto colgado de `editando` y no en cada llamador porque los caminos de salida son
   * cuatro —Enter, Escape, perder el foco, y el guardado que falla y muestra el error— y en todos
   * `editando` vuelve a `null` antes de cualquier `await`. Con la limpieza escrita a mano en los
   * cuatro, el que se olvidara dejaría a esta computadora reportando para siempre que está editando
   * una celda que ya cerró, y a los demás sin poder tocarla nunca más.
   */
  const reportarFoco = useReportarFoco()
  const periodo = datos?.periodo ?? null
  useEffect(() => {
    if (!editando || !periodo) {
      reportarFoco(null)
      return
    }
    reportarFoco({ tipo: 'celda', pestana: periodo, filaId: editando.filaId, campo: editando.campo, editando: true })
  }, [reportarFoco, editando, periodo])

  /** Reemplaza una fila en memoria después de editarla, sin recargar las 2.300. */
  const reemplazar = useCallback((fila: FilaCartera) => {
    setDatos((previo) => (previo ? { ...previo, filas: previo.filas.map((f) => (f.filaId === fila.filaId ? fila : f)) } : previo))
  }, [])

  const quitar = useCallback((filaId: string) => {
    setDatos((previo) => (previo ? { ...previo, filas: previo.filas.filter((f) => f.filaId !== filaId) } : previo))
  }, [])

  const conAlerta = useMemo<FilaConAlerta[]>(() => {
    if (!datos) return []
    return datos.filas.map((fila) => ({
      fila,
      // La rama sale del tipo del vehículo y, cuando ese tipo es genérico, de la categoría que le puso
      // el catálogo: una pick up cargada desde «Nueva póliza» queda con tipo AUTO y sin este paso el
      // filtro «Pick up» no la encontraría nunca. Ver src/shared/ramas.ts.
      rama: ramaDeVehiculo(fila.vehiculo, fila.categoriaVehiculo),
      alerta: calcularAlerta(
        {
          periodo: fila.periodo,
          diaVencimiento: fila.diaVencimientoNumero,
          pagada: Boolean(fila.pagoFecha) || fila.pagoRegistrado,
          formaPago: fila.formaPago,
          diasCobertura: fila.diasCobertura,
          imputada: fila.pagoImputado,
          adelantoPendiente: fila.pagoAdelantado !== null,
        },
        datos.hoy,
      ),
    }))
  }, [datos])

  const filtradas = useMemo(() => {
    const busqueda = normalizar(filtros.busqueda)
    const hoy = datos?.hoy ?? ''
    return conAlerta.filter((entrada) => {
      const { fila, alerta, rama } = entrada
      if (!entraEnElContador(entrada, filtros.contador, hoy)) return false
      if (busqueda) {
        const enTexto =
          normalizar(fila.nombre).includes(busqueda) ||
          normalizar(fila.patente).includes(busqueda) ||
          normalizar(fila.numeroPoliza).includes(busqueda) ||
          normalizar(fila.documento).includes(busqueda)
        if (!enTexto) return false
      }
      // La sucursal, con `mismaSucursal`: es el mismo plegado con el que el servicio arma el
      // desplegable, que mete «AVELLANEDA» y «DOCKSUD» dentro de «Dock Sud». Comparando el texto
      // pelado, esa opción no traía las filas que la celda dejó escritas de la otra forma.
      if (!coincideAlguno(filtros.sucursales, fila.sucursal, mismaSucursal)) return false
      if (!coincideAlguno(filtros.formasDePago, fila.formaPago)) return false
      if (!coincideAlguno(filtros.companias, fila.compania)) return false
      // La rama se compara contra la ya calculada, no contra el texto de la celda: así «CAMIONETA» y
      // «PICK UP» entran las dos por la misma opción. Lo que quedó fuera del catálogo se compara por
      // el texto crudo, que es como sigue estando en el desplegable.
      if (filtros.ramas.length > 0 && !filtros.ramas.some((elegida) => (rama ? elegida === rama : mismoTextoDeFiltro(elegida, fila.vehiculo)))) return false
      if (filtros.colores.length > 0 && !filtros.colores.includes(alerta.color)) return false
      if (filtros.soloAvisarVto && normalizar(fila.avisarVto) !== 'AVISAR') return false
      return true
    })
  }, [conAlerta, datos, filtros])

  /**
   * Cuántas filas del mes no tienen sucursal cargada. El desplegable de sucursal se arma con el
   * catálogo (Dock Sud, Lanús, Sarandí, Daniel), que existe en toda computadora aunque los datos no lo
   * tengan: si la planilla de Google que importó ESA computadora no traía la columna LOCAL, el filtro
   * ofrece las cuatro y las cuatro devuelven cero. Sin este número, el vacío no se explica solo.
   */
  const sinSucursal = useMemo(() => conAlerta.filter(({ fila }) => !normalizar(fila.sucursal)).length, [conAlerta])

  // Los contadores se calculan sobre el mes entero, no sobre lo filtrado: son el tablero del día y
  // tienen que seguir diciendo lo mismo cuando se toca uno para filtrar.
  const contadores = useMemo(() => {
    const hoy = datos?.hoy ?? ''
    let vencenHoy = 0
    let vencidos = 0
    let avisadosHoy = 0
    let coberturaPorTerminar = 0
    let pagadosHoy = 0
    let imputados = 0
    let adelantos = 0
    for (const entrada of conAlerta) {
      if (entraEnElContador(entrada, 'imputados', hoy)) imputados++
      if (entraEnElContador(entrada, 'adelantos', hoy)) adelantos++
      if (entraEnElContador(entrada, 'vencenHoy', hoy)) vencenHoy++
      if (entraEnElContador(entrada, 'vencidos', hoy)) vencidos++
      if (entraEnElContador(entrada, 'avisadosHoy', hoy)) avisadosHoy++
      if (entraEnElContador(entrada, 'coberturaPorTerminar', hoy)) coberturaPorTerminar++
      if (entraEnElContador(entrada, 'pagadosHoy', hoy)) pagadosHoy++
    }
    return { total: conAlerta.length, vencenHoy, vencidos, avisadosHoy, coberturaPorTerminar, pagadosHoy, imputados, adelantos }
  }, [conAlerta, datos])

  const filaSeleccionada = useMemo(
    () => (seleccionada ? (datos?.filas.find((f) => f.filaId === seleccionada) ?? null) : null),
    [datos, seleccionada],
  )

  // Un mes cerrado y un permiso de sólo lectura se ven igual desde la planilla: no se toca nada.
  const soloLectura = (datos?.soloLectura ?? false) || !puedeEditarCartera

  /** Tocar el contador que ya está aplicado lo apaga: se vuelve a ver el mes entero. */
  const alternarContador = useCallback((contador: Contador) => {
    setFiltros((f) => ({ ...f, contador: f.contador === contador ? '' : contador }))
  }, [])

  // --- Acciones -------------------------------------------------------------

  const guardarCelda = useCallback(
    async (filaId: string, campo: CampoEditable, valor: string) => {
      setEditando(null)
      const resultado = await window.dm.cartera.editarCelda(filaId, campo, valor)
      if (resultado.ok) reemplazar(resultado.datos)
      else setError(resultado.error)
    },
    [reemplazar],
  )

  const avisar = useCallback(
    async (fila: FilaCartera) => {
      setError(null)
      setAviso(null)
      const resultado = await window.dm.cartera.prepararAviso(fila.filaId)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      reemplazar(resultado.datos.fila)
      const abierto = await window.dm.sistema.abrirEnlace(resultado.datos.url)
      if (!abierto.ok) setError(abierto.error)
      else setAviso(`WhatsApp abierto para ${resultado.datos.fila.nombre ?? 'el cliente'}. La fila quedó como ENVIADO.`)
    },
    [reemplazar],
  )

  /**
   * «Avisado» sin abrir WhatsApp: para cuando ya se le avisó por otro lado (por teléfono, en el
   * mostrador, o el mensaje se mandó desde el celular) y lo único que falta es que la planilla lo diga.
   */
  const marcarAvisado = useCallback(
    async (fila: FilaCartera) => {
      setError(null)
      setAviso(null)
      const resultado = await window.dm.cartera.marcarAvisado(fila.filaId)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      reemplazar(resultado.datos)
      setAviso(`${resultado.datos.nombre ?? 'La fila'} quedó como ENVIADO y suma en «Avisados hoy».`)
    },
    [reemplazar],
  )

  const cerrarMes = useCallback(async () => {
    setCerrando(true)
    setError(null)
    const resultado = await window.dm.cartera.cerrarMes()
    if (resultado.ok) {
      const { adelantosAcreditados, adelantosPendientes } = resultado.datos
      const adelantos = [
        adelantosAcreditados > 0 ? `${adelantosAcreditados} nacieron pagas por pagos adelantados` : '',
        adelantosPendientes > 0 ? `${adelantosPendientes} tienen un pago adelantado para imputar (mirá «Adelantos sin imputar»)` : '',
      ].filter(Boolean)
      setAviso(
        `Se abrió ${nombreDePeriodo(resultado.datos.periodo)} con ${resultado.datos.filasCreadas} pólizas${adelantos.length ? `: ${adelantos.join(' y ')}` : ''}.`,
      )
      await cargar(resultado.datos.periodo)
    } else {
      setError(resultado.error)
    }
    setCerrando(false)
  }, [cargar])

  const imputarAdelanto = useCallback(
    async (fila: FilaCartera) => {
      setError(null)
      const resultado = await window.dm.cartera.imputarAdelanto(fila.filaId)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      reemplazar(resultado.datos)
      setAviso(`Se imputó el pago adelantado de ${fila.nombre ?? 'la fila'}: la cuota queda paga.`)
    },
    [reemplazar],
  )

  // --- Columnas -------------------------------------------------------------

  const columnas = useMemo<Array<ColumnaTabla<FilaConAlerta>>>(() => {
    // Se le pasa el ID DE LA COLUMNA y el campo sale de `CAMPO_DE_LA_COLUMNA`: así el id que se
    // declara al lado y el campo que viaja en el foco no pueden separarse (ver el comentario del mapa).
    const celdaEditable = (columna: ColumnaEditable, opciones?: string[]) => {
      const campo: CampoEditable = CAMPO_DE_LA_COLUMNA[columna]
      return (entrada: FilaConAlerta) => (
        <Celda
          fila={entrada.fila}
          campo={campo}
          opciones={opciones}
          editando={editando?.filaId === entrada.fila.filaId && editando.campo === campo}
          soloLectura={soloLectura}
          alEditar={() => setEditando({ filaId: entrada.fila.filaId, campo })}
          alCancelar={() => setEditando(null)}
          alGuardar={(valor) => void guardarCelda(entrada.fila.filaId, campo, valor)}
        />
      )
    }
    const catalogos = datos?.catalogos

    // El orden importa: la primera es la única fija, y es el nombre. Con veintidós columnas, correr
    // la barra horizontal para mirar la patente dejaba la fila sin dueño; ahora el nombre queda
    // pegado a la izquierda y el resto pasa por debajo. Las demás se pueden apagar desde «Columnas».
    return [
      { id: 'nombre', titulo: 'Nombre y apellido', ancho: 240, fija: true, siempre: true, celda: celdaEditable('nombre') },
      {
        id: 'alerta',
        titulo: 'Alerta',
        ancho: 142,
        celda: ({ alerta }) => (
          <span
            title={alerta.detalle}
            className={cx('inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-xs font-semibold', CLASES_COLOR[alerta.color])}
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full', PUNTO_COLOR[alerta.color])} aria-hidden="true" />
            <span className="truncate">{alerta.etiqueta || NOMBRE_COLOR[alerta.color]}</span>
          </span>
        ),
      },
      {
        id: 'acciones',
        titulo: 'Acciones',
        ancho: 200,
        celda: ({ fila }) => (
          <div className="flex items-center gap-0.5">
            {/* Sólo en la fila que tiene un pago adelantado esperando: imputarlo la deja paga. */}
            {fila.pagoAdelantado && !estaPagada(fila) && (
              <BotonAccion
                titulo={`Imputar el pago adelantado${fila.pagoAdelantado.fecha ? ` del ${fila.pagoAdelantado.fecha}` : ''}${
                  fila.pagoAdelantado.importe ? ` (${fila.pagoAdelantado.importe})` : ''
                }: la cuota queda paga`}
                icono="calendario"
                disabled={soloLectura}
                onClick={() => void imputarAdelanto(fila)}
              />
            )}
            <BotonAccion titulo="Avisar por WhatsApp" icono="mensaje" disabled={soloLectura} onClick={() => void avisar(fila)} />
            <BotonAccion
              titulo="Marcar como avisado (sin abrir WhatsApp)"
              icono="ok"
              disabled={soloLectura}
              onClick={() => void marcarAvisado(fila)}
            />
            <BotonAccion titulo="Registrar pago" icono="billete" disabled={soloLectura} onClick={() => setPagoDe(fila)} />
            {/* Sin póliza enlazada no hay a qué colgarle el aviso: la fila es de la hoja y nada más. */}
            <BotonAccion
              titulo={
                fila.polizaId === null
                  ? 'Esta fila no está enlazada a ninguna póliza: no se le puede avisar el rechazo.'
                  : 'Avisar a la sucursal que se le rechazó el débito'
              }
              icono="alerta"
              disabled={soloLectura || fila.polizaId === null}
              onClick={() => setRechazoDe(fila)}
            />
            <BotonAccion titulo="Dar de baja" icono="cerrar" disabled={soloLectura} peligro onClick={() => setBajaDe(fila)} />
          </div>
        ),
      },
      { id: 'sucursal', titulo: 'Sucursal', ancho: 120, celda: celdaEditable('sucursal', catalogos?.sucursales) },
      { id: 'telefono', titulo: 'Teléfono', ancho: 130, celda: celdaEditable('telefono') },
      { id: 'documento', titulo: 'DNI/CUIT', ancho: 110, celda: celdaEditable('documento') },
      { id: 'vencimiento', titulo: 'Fecha de venc', ancho: 100, alinear: 'centro', celda: celdaEditable('vencimiento') },
      { id: 'cuota', titulo: 'Cuota', ancho: 100, alinear: 'derecha', celda: celdaEditable('cuota') },
      { id: 'formaPago', titulo: 'Forma de pago', ancho: 130, celda: celdaEditable('formaPago', catalogos?.formasDePago) },
      { id: 'aviso', titulo: 'OB. avisos', ancho: 150, celda: celdaEditable('aviso') },
      { id: 'vehiculo', titulo: 'Vehículo', ancho: 90, celda: celdaEditable('vehiculo', catalogos?.tiposDeVehiculo) },
      // La rama NO se edita: sale sola del vehículo y de la categoría del catálogo. Está para que se
      // entienda por qué una fila entra en «Pick up» cuando su celda de vehículo dice «AUTO».
      {
        id: 'rama',
        titulo: 'Rama',
        ancho: 110,
        celda: ({ rama, fila }) => <span className="text-slate-600">{rama ? NOMBRE_RAMA[rama] : (fila.vehiculo ?? '—')}</span>,
      },
      { id: 'marca', titulo: 'Marca', ancho: 120, celda: celdaEditable('marca') },
      { id: 'modelo', titulo: 'Modelo', ancho: 200, celda: celdaEditable('modelo') },
      { id: 'patente', titulo: 'Patente', ancho: 100, celda: celdaEditable('patente') },
      { id: 'anio', titulo: 'Año', ancho: 70, alinear: 'centro', celda: celdaEditable('anio') },
      { id: 'cobertura', titulo: 'Cobertura', ancho: 160, celda: celdaEditable('cobertura', catalogos?.coberturas) },
      { id: 'compania', titulo: 'Compañía', ancho: 140, celda: celdaEditable('compania', catalogos?.companias) },
      { id: 'poliza', titulo: 'Póliza', ancho: 120, celda: celdaEditable('poliza') },
      { id: 'propuesta', titulo: 'Propuesta', ancho: 120, celda: celdaEditable('propuesta') },
      { id: 'desde', titulo: 'Desde', ancho: 100, celda: celdaEditable('desde') },
      { id: 'hasta', titulo: 'Hasta', ancho: 100, celda: celdaEditable('hasta') },
      { id: 'observaciones', titulo: 'Observaciones', ancho: 240, celda: celdaEditable('observaciones') },
    ]
  }, [avisar, datos, editando, guardarCelda, imputarAdelanto, marcarAvisado, soloLectura])

  const { visibles, ocultas, alternar: alternarColumna, mostrarTodas } = useColumnasElegidas('cartera', columnas)

  if (cargando && !datos) return <Cargando texto="Abriendo la planilla…" />

  if (!datos || datos.periodos.length === 0) {
    return (
      <div className="p-8">
        <Aviso tono="info">
          Todavía no hay ninguna planilla cargada. Andá a <strong className="font-semibold">Administración → Reimportar la base</strong> para traerla del VPS.
        </Aviso>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={datos.periodo}
            onChange={(evento) => void cargar(evento.target.value)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {datos.periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {nombreDePeriodo(p.periodo)} · {p.filas} filas{p.esElActual ? ' (abierto)' : ''}
              </option>
            ))}
          </select>
        </label>

        {soloLectura && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            <Icono nombre="candado" tamano={13} />
            {puedeEditarCartera ? 'Mes cerrado · sólo lectura' : 'Tenés Cartera en sólo lectura'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(datos.periodo)} disabled={cargando}>
            Actualizar
          </Boton>
          {puedeCerrarMes && (
            <Boton escribe variante="primario" icono="mas" onClick={() => void cerrarMes()} cargando={cerrando}>
              Cerrar mes
            </Boton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador
          etiqueta="Total"
          valor={contadores.total}
          activo={filtros.contador === ''}
          titulo="Todas las filas del mes."
          alTocar={() => setFiltros((f) => ({ ...f, contador: '' }))}
        />
        <Contador
          etiqueta="Vencen hoy"
          valor={contadores.vencenHoy}
          tono="rojo"
          activo={filtros.contador === 'vencenHoy'}
          titulo="Vencen hoy y todavía no figuran pagos."
          alTocar={() => alternarContador('vencenHoy')}
        />
        <Contador
          etiqueta="Vencidos"
          valor={contadores.vencidos}
          tono="rojo"
          activo={filtros.contador === 'vencidos'}
          titulo="Ya pasó el día de vencimiento y no figuran pagos. Los que todavía están dentro de la cobertura financiera de su compañía se ven en amarillo o naranja."
          alTocar={() => alternarContador('vencidos')}
        />
        <Contador
          etiqueta="Avisados hoy"
          valor={contadores.avisadosHoy}
          tono="azul"
          activo={filtros.contador === 'avisadosHoy'}
          titulo="Se les mandó el WhatsApp de aviso hoy."
          alTocar={() => alternarContador('avisadosHoy')}
        />
        <Contador
          etiqueta="Se les termina la cobertura"
          valor={contadores.coberturaPorTerminar}
          tono="naranja"
          activo={filtros.contador === 'coberturaPorTerminar'}
          titulo="Ya venció la cuota y no figura paga, pero la compañía todavía los cubre por unos días más (ATM 7, Rivadavia 7, Río Uruguay 7, Euroamérica 7, Galeno 7, Equidad 5, Metropol 3, contados desde el vencimiento). Cuando se termina esa cobertura el cliente queda sin seguro: son los que hay que llamar ahora. Los días de cada compañía se cambian en Administración → Compañías."
          alTocar={() => alternarContador('coberturaPorTerminar')}
        />
        <Contador
          etiqueta="Pagados hoy"
          valor={contadores.pagadosHoy}
          tono="verde"
          activo={filtros.contador === 'pagadosHoy'}
          titulo="Pagaron hoy."
          alTocar={() => alternarContador('pagadosHoy')}
        />
        {(contadores.imputados > 0 || filtros.contador === 'imputados') && (
          <Contador
            etiqueta="Imputados a cobrar"
            valor={contadores.imputados}
            tono="violeta"
            activo={filtros.contador === 'imputados'}
            titulo="La agencia ya les imputó la cuota a la compañía y el cliente todavía no pagó. Cuando pague, registrá el pago como «Pagó»."
            alTocar={() => alternarContador('imputados')}
          />
        )}
        {(contadores.adelantos > 0 || filtros.contador === 'adelantos') && (
          <Contador
            etiqueta="Adelantos sin imputar"
            valor={contadores.adelantos}
            tono="violeta"
            activo={filtros.contador === 'adelantos'}
            titulo="Pagaron esta cuota por adelantado el mes pasado y quedó pendiente de imputar. Imputala con el botón de la fila (el calendario) y la cuota queda paga."
            alTocar={() => alternarContador('adelantos')}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
          opciones={datos.catalogos.sucursales}
          alCambiar={(v) => setFiltros((f) => ({ ...f, sucursales: v }))}
        />
        <FiltroMultiple
          etiqueta="Forma de pago"
          valores={filtros.formasDePago}
          opciones={datos.catalogos.formasDePago}
          alCambiar={(v) => setFiltros((f) => ({ ...f, formasDePago: v }))}
        />
        <FiltroMultiple
          etiqueta="Compañía"
          valores={filtros.companias}
          opciones={datos.catalogos.companias}
          alCambiar={(v) => setFiltros((f) => ({ ...f, companias: v }))}
        />
        <FiltroMultiple
          etiqueta="Rama"
          valores={filtros.ramas}
          opciones={datos.catalogos.ramas}
          textoDe={(r) => NOMBRE_RAMA[r as Rama] ?? r}
          plural="todas"
          alCambiar={(v) => setFiltros((f) => ({ ...f, ramas: v }))}
        />
        <FiltroMultiple
          etiqueta="Alerta"
          valores={filtros.colores}
          opciones={ORDEN_COLORES.map((c) => c)}
          textoDe={(c) => NOMBRE_COLOR[c as ColorAlerta]}
          alCambiar={(v) => setFiltros((f) => ({ ...f, colores: v }))}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filtros.soloAvisarVto}
            onChange={(evento) => setFiltros((f) => ({ ...f, soloAvisarVto: evento.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Sólo con AVISAR VTO
        </label>
        {(filtros.busqueda ||
          filtros.sucursales.length > 0 ||
          filtros.formasDePago.length > 0 ||
          filtros.companias.length > 0 ||
          filtros.ramas.length > 0 ||
          filtros.colores.length > 0 ||
          filtros.soloAvisarVto ||
          filtros.contador) && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setFiltros(FILTROS_VACIOS)}>
            Limpiar
          </Boton>
        )}
        <SelectorDeColumnas columnas={columnas} ocultas={ocultas} alAlternar={alternarColumna} alMostrarTodas={mostrarTodas} />
        <span className="ml-auto text-sm text-slate-500">
          {filtradas.length.toLocaleString('es-AR')} de {contadores.total.toLocaleString('es-AR')} filas
        </span>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="exito">{aviso}</Aviso>}

      <div className="flex min-h-0 flex-1 gap-3">
        <TablaVirtual
          filas={filtradas}
          columnas={visibles}
          claveDe={({ fila }) => fila.filaId}
          filaSeleccionada={seleccionada}
          alHacerClic={({ fila }) => setSeleccionada((previa) => (previa === fila.filaId ? null : fila.filaId))}
          vacio={mensajeDeVacio(filtros.sucursales, sinSucursal, contadores.total)}
          // El glow por celda (14.0). Sólo en las columnas que se pueden editar: en «Alerta» o en las
          // acciones nadie puede estar parado, y devolver `null` ahí es lo que hace que el decorado no
          // cueste nada en las cuatrocientas celdas que se dibujan a la vez.
          decorarCelda={({ fila }, columna) => {
            const campo = CAMPO_DE_LA_COLUMNA[columna.id as ColumnaEditable]
            if (!campo) return null
            return <MarcaDePresencia claveDeFoco={claveDeCelda(fila.filaId, campo)} />
          }}
        />
        {filaSeleccionada && (
          <PanelDetalle
            fila={filaSeleccionada}
            soloLectura={soloLectura}
            alCerrar={() => setSeleccionada(null)}
            alGuardar={(campo, valor) => void guardarCelda(filaSeleccionada.filaId, campo, valor)}
            alBorrar={(resultado) => {
              setSeleccionada(null)
              setError(null)
              setAviso(`Se borró de la base la fila de ${resultado.titulo}.`)
              void cargar(datos.periodo)
            }}
          />
        )}
      </div>

      <DialogoPago
        fila={pagoDe}
        mediosDePago={datos.catalogos.mediosDePago}
        hoy={datos.hoy}
        alCerrar={() => setPagoDe(null)}
        alGuardar={(fila, resumen) => {
          reemplazar(fila)
          setPagoDe(null)
          setAviso(resumen)
        }}
        alFallar={setError}
      />
      <DialogoBaja
        fila={bajaDe}
        alCerrar={() => setBajaDe(null)}
        alDarDeBaja={(filaId, nombre) => {
          quitar(filaId)
          setBajaDe(null)
          setSeleccionada(null)
          setAviso(`${nombre} pasó a Bajas de ${nombreDePeriodo(datos.periodo)}.`)
        }}
        alFallar={setError}
      />
      <DialogoRechazo
        poliza={
          rechazoDe && rechazoDe.polizaId !== null
            ? {
                polizaId: rechazoDe.polizaId,
                clienteNombre: rechazoDe.nombre,
                compania: rechazoDe.compania,
                numeroPoliza: rechazoDe.numeroPoliza,
                patente: rechazoDe.patente,
                formaPago: rechazoDe.formaPago,
                sucursal: rechazoDe.sucursal,
              }
            : null
        }
        alCerrar={() => setRechazoDe(null)}
        alAvisar={(rechazo) => {
          setRechazoDe(null)
          setError(null)
          setAviso(`Se le avisó a ${rechazo.sucursal ?? 'la sucursal'} que a ${rechazo.clienteNombre ?? 'este cliente'} se le rechazó el débito.`)
        }}
        alFallar={(mensaje) => {
          setRechazoDe(null)
          setError(mensaje)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/** Cartel de arriba: además de contar, filtra la tabla al tocarlo (como las pestañas de Siniestros). */
function Contador({
  etiqueta,
  valor,
  tono = 'neutro',
  titulo,
  activo,
  alTocar,
}: {
  etiqueta: string
  valor: number
  tono?: 'neutro' | 'rojo' | 'naranja' | 'azul' | 'verde' | 'violeta'
  titulo?: string
  activo: boolean
  alTocar: () => void
}) {
  // El naranja es el mismo del semáforo: lo que ya venció pero la compañía todavía cubre. Que el
  // contador y la columna «Alerta» usen el mismo color es lo que hace que se lean como una sola cosa.
  const clases = {
    neutro: activo ? 'border-marino-500 bg-marino-50 text-marino-900' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300',
    rojo: activo ? 'border-red-500 bg-red-100 text-red-900' : 'border-red-200 bg-red-50 text-red-800 hover:border-red-300',
    naranja: activo ? 'border-orange-500 bg-orange-100 text-orange-900' : 'border-orange-200 bg-orange-50 text-orange-800 hover:border-orange-300',
    azul: activo ? 'border-sky-500 bg-sky-100 text-sky-900' : 'border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300',
    verde: activo ? 'border-green-500 bg-green-100 text-green-900' : 'border-green-200 bg-green-50 text-green-800 hover:border-green-300',
    violeta: activo ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-300',
  }[tono]
  return (
    <button
      type="button"
      onClick={alTocar}
      aria-pressed={activo}
      title={titulo}
      className={cx(
        'rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
        activo && 'ring-2 ring-marino-500/25',
        clases,
      )}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </button>
  )
}

function BotonAccion({
  titulo,
  icono,
  onClick,
  disabled,
  peligro,
}: {
  titulo: string
  icono: 'mensaje' | 'ok' | 'billete' | 'cerrar' | 'alerta' | 'calendario'
  onClick: () => void
  disabled?: boolean
  peligro?: boolean
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={disabled}
      onClick={(evento) => {
        evento.stopPropagation()
        onClick()
      }}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        peligro
          ? 'border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700'
          : 'border-slate-200 text-slate-500 hover:border-marino-300 hover:bg-marino-50 hover:text-marino-700',
      )}
    >
      <Icono nombre={icono} tamano={14} />
    </button>
  )
}

/** Celda de la planilla: texto hasta que se hace doble clic, y ahí se edita en el lugar. */
function Celda({
  fila,
  campo,
  opciones,
  editando,
  soloLectura,
  alEditar,
  alCancelar,
  alGuardar,
}: {
  fila: FilaCartera
  campo: CampoEditable
  opciones?: string[]
  editando: boolean
  soloLectura: boolean
  alEditar: () => void
  alCancelar: () => void
  alGuardar: (valor: string) => void
}) {
  const valor = (fila[campo as keyof FilaCartera] as string | null) ?? ''
  const entrada = useRef<HTMLInputElement | null>(null)
  const idLista = `lista-${campo}`
  // El bloqueo suave de la 14.0: si otra computadora tiene esta misma celda abierta, acá no se abre.
  // No protege nada por sí solo (la barrera de verdad es el `previo` que viaja con la escritura y el
  // 409 del servidor), evita el choque cuando se puede evitar antes de que pase. Se pregunta desde la
  // celda y no desde la planilla a propósito: así una persona que entra o sale redibuja las celdas que
  // toca y no la tabla entera.
  const bloqueadaPor = useBloqueoDe(claveDeCelda(fila.filaId, campo))

  useEffect(() => {
    if (editando) {
      entrada.current?.focus()
      entrada.current?.select()
    }
  }, [editando])

  if (!editando) {
    return (
      <span
        onDoubleClick={
          soloLectura || bloqueadaPor
            ? undefined
            : (evento) => {
                evento.stopPropagation()
                alEditar()
              }
        }
        // Cuando está trabada, el globito dice quién la tiene y no repite el valor: el valor se lee
        // igual en la celda, y lo que la persona necesita saber es a quién esperar.
        title={bloqueadaPor ? motivoDelBloqueo(bloqueadaPor) : valor || undefined}
        className={cx(
          'block w-full truncate',
          bloqueadaPor ? 'cursor-not-allowed' : !soloLectura && 'cursor-text',
        )}
      >
        {valor}
      </span>
    )
  }

  return (
    <>
      <input
        ref={entrada}
        defaultValue={valor}
        list={opciones && opciones.length > 0 ? idLista : undefined}
        onClick={(evento) => evento.stopPropagation()}
        onBlur={(evento) => alGuardar(evento.currentTarget.value)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter') alGuardar(evento.currentTarget.value)
          if (evento.key === 'Escape') alCancelar()
        }}
        className="w-full rounded border border-marino-400 bg-white px-1 py-0.5 text-sm outline-none ring-2 ring-marino-500/30"
      />
      {opciones && opciones.length > 0 && (
        <datalist id={idLista}>
          {opciones.map((opcion) => (
            <option key={opcion} value={opcion} />
          ))}
        </datalist>
      )}
    </>
  )
}
