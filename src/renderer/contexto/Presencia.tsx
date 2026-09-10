// Quién está trabajando en qué (14.0): la mitad de la pantalla del glow de colores.
//
// Son DOS contextos que viven en el mismo archivo porque hacen las dos mitades de lo mismo:
//
//   BAJA  la foto de la presencia que manda el servidor (`Presente[]`, la lista completa de las otras
//         computadoras conectadas y en qué anda cada una) y la deja indexada por CLAVE DE FOCO, que es
//         lo que preguntan la celda de la planilla, el renglón de Mora y el encabezado de una ficha.
//   SUBE  el foco de esta computadora: en qué celda o ficha está parada la persona que la usa.
//
// UN SOLO SUSCRIPTOR, como `DatosEnVivo` y `Conexion`: el proveedor se monta una vez en `App.tsx`.
// Acá pesa más que en los otros: la presencia se pregunta desde CADA celda visible de la planilla
// —dos mil filas por veintidós columnas—, así que lo que se dibuja tiene que ser una lectura de un
// `Map` ya armado y no un recorrido de la lista por celda.
//
// LA CLAVE PROPIA NO CUENTA. El servidor manda la foto entera, la de esta computadora incluida, pero
// el glow es «alguien MÁS está acá»: verse a uno mismo con un anillo alrededor de la celda que está
// editando no dice nada y encima taparía el anillo del otro. Se filtra por clave y no por conexión:
// la misma persona puede tener dos ventanas abiertas (la de la sucursal y la del mostrador) y en las
// dos es ella.
//
// EL FOCO SE APILA. Hay dos que compiten: el del módulo, que dice nada más «está en Cartera» y lo
// reporta `App.tsx` al cambiar de pantalla, y el puntual —una celda, una ficha—, que es el que
// interesa. El puntual siempre gana y el del módulo es el piso al que se vuelve cuando la ficha se
// cierra. Con una sola variable, el orden de los efectos de React (los hijos antes que el padre)
// decidía cuál quedaba, y cerrar una ficha dejaba a la persona clavada en una celda que ya no miraba.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Foco, Presente } from '../../main/vivo/protocolo'
import { claveDeObjeto, indexarPresencia, mismaFoto, type ClaveDeFoco } from '../../shared/presencia'
import { useSesion } from './Sesion'
import { claveDeUsuario } from '../../shared/texto'

/** Los objetos que tienen ficha propia y por lo tanto glow propio. */
export type ObjetoConFicha = Extract<Foco, { tipo: 'objeto' }>['objeto']

/**
 * SON DOS CONTEXTOS Y NO UNO, y la razón es la velocidad de la planilla.
 *
 * La foto cambia con CADA aviso de presencia: alguien se mueve de celda en otra computadora y llega una
 * lista nueva —hasta diez por segundo cuando dos personas trabajan con el panel de detalle abierto—.
 * Con un solo contexto, todo el que lo consultara se volvería a dibujar en cada aviso, y el que lo
 * consulta para SUBIR su foco (`useReportarFoco`, que usa la pantalla de la planilla entera) se
 * llevaría de arriba las dos mil filas y sus mil cuatrocientas celdas, aunque ninguna cambiara de
 * anillo. Escribir en una celda pasaba a ir a tirones.
 *
 * Partido en dos, el que sube tiene un valor que no cambia NUNCA (las dos funciones salen de refs) y no
 * se redibuja jamás; el que baja lo miran nada más los que dibujan el glow.
 */
interface ContextoDeLaFoto {
  /** Las demás computadoras conectadas, sin la clave propia. */
  presentes: readonly Presente[]
  /** Quiénes están en ese lugar de la pantalla, ya indexados. */
  presenciaDe: (clave: ClaveDeFoco) => readonly Presente[]
  /** La primera persona que esté EDITANDO ahí, que es la que traba. */
  bloqueoDe: (clave: ClaveDeFoco) => Presente | null
}

interface ContextoDeReporte {
  /** Sube el foco de esta computadora. `null` saca el puntual y vuelve al piso del módulo. */
  anunciar: (id: string, foco: Foco | null) => void
  /** El piso: la pantalla donde está parada esta computadora cuando no hay nada puntual elegido. */
  anunciarModulo: (modulo: string | null) => void
}

const VACIO: readonly Presente[] = []

/**
 * Lo que se ve sin proveedor arriba: nadie está en ningún lado y reportar no hace nada.
 *
 * No tira error (a diferencia de `usePermisos`) porque el glow lo consultan componentes que también
 * se dibujan fuera del escritorio —una tabla en un diálogo del Login no existe hoy, pero el costo de
 * que no explote es este objeto— y porque el banco de pruebas monta pantallas sueltas.
 */
const SIN_PRESENCIA: ContextoDeLaFoto = {
  presentes: VACIO,
  presenciaDe: () => VACIO,
  bloqueoDe: () => null,
}

const SIN_REPORTE: ContextoDeReporte = {
  anunciar: () => {},
  anunciarModulo: () => {},
}

const Contexto = createContext<ContextoDeLaFoto>(SIN_PRESENCIA)
const ContextoDelReporte = createContext<ContextoDeReporte>(SIN_REPORTE)


export function ProveedorPresencia({ children }: { children: ReactNode }) {
  const { usuario } = useSesion()
  const miClave = usuario ? claveDeUsuario(usuario.usuario) : ''
  const [presentes, setPresentes] = useState<readonly Presente[]>(VACIO)

  useEffect(() => {
    let vigente = true
    const pedir = () => {
      void window.dm.vivo.presencia().then((resultado) => {
        if (!vigente || !resultado.ok) return
        // Si no cambió nada de lo que se dibuja, no se toca el estado: ver `mismaFoto`.
        setPresentes((antes) => (mismaFoto(antes, resultado.datos) ? antes : resultado.datos))
      })
    }
    // Se pregunta el estado además de escuchar el evento, por lo mismo que en `Conexion`: el canal
    // pudo haber saludado antes de que esta pantalla se montara y el próximo cambio puede tardar.
    pedir()
    const dejarDeEscuchar = window.dm.vivo.alCambiarLaPresencia(() => pedir())
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [])

  // --- Lo que sube ----------------------------------------------------------
  // En refs y no en estado: reportar el foco no redibuja nada de esta computadora, y con estado cada
  // doble clic en una celda re-renderizaría la planilla entera de arriba abajo.
  const pila = useRef<Array<{ id: string; foco: Foco }>>([])
  const modulo = useRef<Foco | null>(null)
  const ultimo = useRef<string>('')

  const mandar = useCallback(() => {
    const foco = pila.current.length > 0 ? pila.current[pila.current.length - 1]!.foco : modulo.current
    // Se comparan los focos serializados: el mismo doble clic puede reportar dos veces (el efecto que
    // enfoca el input, un re-render del padre) y mandar dos frames iguales por el canal no aporta.
    // El respiro de 100 ms está del otro lado, en `main/vivo/presencia.ts`.
    const huella = foco ? JSON.stringify(foco) : ''
    if (huella === ultimo.current) return
    ultimo.current = huella
    void window.dm.vivo.foco(foco)
  }, [])

  const anunciar = useCallback(
    (id: string, foco: Foco | null) => {
      const sinEste = pila.current.filter((entrada) => entrada.id !== id)
      pila.current = foco ? [...sinEste, { id, foco }] : sinEste
      mandar()
    },
    [mandar],
  )

  const anunciarModulo = useCallback(
    (nombre: string | null) => {
      modulo.current = nombre ? { tipo: 'modulo', modulo: nombre } : null
      mandar()
    },
    [mandar],
  )

  const foto = useMemo<ContextoDeLaFoto>(() => {
    const ajenos = presentes.filter((presente) => presente.clave !== miClave)
    const porClave = indexarPresencia(ajenos)
    return {
      presentes: ajenos,
      presenciaDe: (clave) => porClave.get(clave) ?? VACIO,
      bloqueoDe: (clave) =>
        porClave.get(clave)?.find((presente) => presente.foco !== null && presente.foco.tipo !== 'modulo' && presente.foco.editando) ??
        null,
    }
  }, [presentes, miClave])

  // Sin `presentes` adentro: este valor nace una vez y no cambia nunca más, que es lo que hace que
  // reportar un foco no redibuje la pantalla que lo reporta.
  const reporte = useMemo<ContextoDeReporte>(() => ({ anunciar, anunciarModulo }), [anunciar, anunciarModulo])

  return (
    <ContextoDelReporte.Provider value={reporte}>
      <Contexto.Provider value={foto}>{children}</Contexto.Provider>
    </ContextoDelReporte.Provider>
  )
}

/** La foto: quiénes están y dónde. Ojo, esto se redibuja con cada aviso de presencia. */
export function usePresencia(): ContextoDeLaFoto {
  return useContext(Contexto)
}

/** Quiénes están en ese lugar de la pantalla. Lista vacía si nadie: es lo que mira el `Glow`. */
export function usePresenciaDe(clave: ClaveDeFoco): readonly Presente[] {
  return usePresencia().presenciaDe(clave)
}

/**
 * La persona que tiene trabado ese lugar, o `null` si nadie lo está editando.
 *
 * Es el bloqueo SUAVE de la 14.0: no protege nada (la barrera de verdad es el `previo` que viaja con
 * cada escritura y el 409 del servidor), sirve para no dejar que dos personas escriban lo mismo al
 * mismo tiempo cuando se puede evitar de antemano.
 */
export function useBloqueoDe(clave: ClaveDeFoco): Presente | null {
  return usePresencia().bloqueoDe(clave)
}

/**
 * Para reportar un foco a mano: devuelve una función que se llama al empezar a editar y con `null` al
 * terminar. La usa la planilla, que abre y cierra celdas de a una.
 *
 * El identificador sale de `useId`, así dos componentes montados a la vez no se pisan el foco, y al
 * desmontarse se limpia solo: una celda que desaparece porque la fila se fue del servidor no puede
 * dejar a esta computadora reportando para siempre que la está editando.
 */
export function useReportarFoco(): (foco: Foco | null) => void {
  const { anunciar } = useContext(ContextoDelReporte)
  const id = useId()
  const reportar = useCallback((foco: Foco | null) => anunciar(id, foco), [anunciar, id])
  useEffect(() => () => anunciar(id, null), [anunciar, id])
  return reportar
}

/** El piso: la pantalla donde está parada esta computadora. Lo llama `App.tsx` al cambiar de módulo. */
export function useFocoDeModulo(modulo: string | null): void {
  const { anunciarModulo } = useContext(ContextoDelReporte)
  useEffect(() => {
    anunciarModulo(modulo)
  }, [anunciarModulo, modulo])
}

/**
 * El foco de una ficha abierta: se reporta al abrirla y se limpia al cerrarla, con `editando` en true
 * mientras haya cambios sin guardar.
 *
 * `filaId` puede venir en `null` mientras la ficha todavía está cargando, o cuando el objeto nunca se
 * subió al servidor y por lo tanto no tiene `_ID`: ahí no se reporta nada, porque un foco sin `_ID` no
 * lo puede ubicar ninguna de las otras computadoras.
 */
export function useFocoDeObjeto(objeto: ObjetoConFicha, filaId: string | null | undefined, editando: boolean): void {
  const reportar = useReportarFoco()
  useEffect(() => {
    if (!filaId) {
      reportar(null)
      return
    }
    reportar({ tipo: 'objeto', objeto, filaId, editando })
  }, [reportar, objeto, filaId, editando])
}

/** La clave del glow de una ficha, para el encabezado y para el botón de guardar. */
export function claveDeFicha(objeto: ObjetoConFicha, filaId: string | null | undefined): ClaveDeFoco {
  return claveDeObjeto(objeto, filaId ?? '')
}
