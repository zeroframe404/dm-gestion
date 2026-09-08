// Que la pantalla abierta se entere de lo que cargó la otra sucursal, sin que nadie recargue nada.
//
// Hasta la 13.0 faltaba justo esta mitad: la sincronización bajaba el dato, lo guardaba en la base, y
// la pantalla que lo estaba mostrando seguía mostrando lo de antes hasta que el usuario navegaba a
// otro lado y volvía. Con el aviso en vivo del vigía el dato llega en el momento, así que la pantalla
// que no se entera es todavía más notoria.
//
// UN SOLO SUSCRIPTOR. El proveedor se monta una vez en `App.tsx` y es el único que escucha el evento
// del proceso principal; las pantallas se cuelgan de acá con `useRefrescoEnVivo`. Con siete pantallas
// suscribiéndose cada una por su cuenta habría siete puentes IPC abiertos para el mismo aviso.
//
// CÓMO SE FILTRA. El aviso trae los tipos de pestaña que cambiaron (MENSUAL, SINIESTROS, PAGOS…) y
// cada pantalla dice de cuáles vive. Los tipos y no los títulos: una pantalla no sabe nada de «AGOSTO
// 2026» —el título cambia todos los meses— pero sí sabe que muestra la planilla mensual.
//
// Y LA REGLA QUE IMPORTA: si el usuario está editando, el refresco ESPERA. No se refresca todo menos
// la fila en edición, que es la otra salida posible: eso deja la pantalla mintiendo —los totales del
// encabezado ya cuentan lo nuevo y la fila no— y obliga a cada pantalla a saber fusionar. Postergar es
// una línea, es honesto, y como `postergar` entra en las dependencias del efecto, apenas se cierra el
// editor el refresco sale solo.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { TipoPestana } from '../../shared/tipos'

/** Dos avisos pegados (una tanda de escrituras de la otra PC) producen una sola recarga. */
const RESPIRO_DEL_REFRESCO_MS = 400
/** Techo por pantalla: por más seguido que avisen, no se recarga más seguido que esto. */
const MINIMO_ENTRE_REFRESCOS_MS = 2_000

export interface AvisoDeDatos {
  tipos: TipoPestana[]
  /** Para distinguir dos avisos iguales seguidos: sin esto, el mismo aviso no volvería a disparar. */
  numero: number
}

const Contexto = createContext<AvisoDeDatos | null>(null)

export function ProveedorDatosEnVivo({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<AvisoDeDatos | null>(null)

  useEffect(() => {
    let numero = 0
    return window.dm.sincronizacion.alCambiarLosDatos((datos) => {
      numero += 1
      setAviso({ tipos: datos.tipos, numero })
    })
  }, [])

  return <Contexto.Provider value={aviso}>{children}</Contexto.Provider>
}

/**
 * ¿Este aviso le toca a una pantalla que muestra estos tipos de pestaña?
 *
 * Pura y exportada para poder probarla sin montar React: el banco de pruebas no monta componentes.
 */
export function hayQueRefrescar(tiposDeLaPantalla: TipoPestana[], aviso: AvisoDeDatos | null): boolean {
  if (!aviso) return false
  return aviso.tipos.some((tipo) => tiposDeLaPantalla.includes(tipo))
}

export interface RefrescoEnVivo {
  /** De qué pestañas vive esta pantalla. */
  tipos: TipoPestana[]
  /** Volver a pedir los datos. Tiene que recargar EN SILENCIO: sin poner la pantalla en blanco. */
  recargar: () => void | Promise<void>
  /**
   * `true` mientras no se pueda tocar la pantalla: hay una celda en edición, o un diálogo abierto con
   * una fila congelada adentro. El aviso queda anotado y el refresco sale apenas esto vuelva a `false`.
   */
  postergar?: () => boolean
}

/**
 * Recarga la pantalla cuando bajan datos de otra computadora, sin pisar lo que el usuario esté
 * haciendo.
 *
 * `recargar` y `postergar` se leen de una ref: así una pantalla no tiene que envolverlas en
 * `useCallback` para que esto no se re-suscriba en cada render, que es el error fácil de cometer y
 * difícil de ver (el refresco se dispararía una vez por tecla tipeada).
 */
export function useRefrescoEnVivo({ tipos, recargar, postergar }: RefrescoEnVivo): void {
  const aviso = useContext(Contexto)
  const funciones = useRef({ recargar, postergar })
  funciones.current = { recargar, postergar }

  // Los tipos se comparan por contenido y no por identidad: casi siempre vienen como un literal
  // nuevo en cada render, y con la lista cruda en las dependencias el efecto correría siempre.
  const clave = tipos.join('|')
  // El aviso que hay que atender y todavía no se pudo. Se guarda el número, no el aviso entero.
  const pendiente = useRef<number | null>(null)
  const ultimoRefresco = useRef(0)

  const meToca = hayQueRefrescar(tipos, aviso)
  if (meToca && aviso && pendiente.current !== aviso.numero) pendiente.current = aviso.numero

  // `postergar?.()` se llama en el cuerpo a propósito: es lo que hace que el efecto vuelva a correr
  // cuando el usuario cierra el editor, sin que la pantalla tenga que avisar de ninguna otra forma.
  const esperando = postergar?.() ?? false

  useEffect(() => {
    if (pendiente.current === null || esperando) return
    const desdeElUltimo = Date.now() - ultimoRefresco.current
    const demora = Math.max(RESPIRO_DEL_REFRESCO_MS, MINIMO_ENTRE_REFRESCOS_MS - desdeElUltimo)
    const reloj = setTimeout(() => {
      pendiente.current = null
      ultimoRefresco.current = Date.now()
      void funciones.current.recargar()
    }, demora)
    return () => clearTimeout(reloj)
    // `clave` está para que un cambio de tipos (una pantalla que cambia de módulo) rearme el efecto.
  }, [aviso?.numero, esperando, clave])
}
