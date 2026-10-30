// Navegación entre módulos. No hay router (la aplicación es una sola ventana y no tiene direcciones):
// alcanza con saber qué módulo está abierto y con qué lo abrieron.
//
// Existe porque los módulos de la Fase 5 se llaman entre sí todo el tiempo: desde la ficha de un cliente
// se crea una póliza, desde la bandeja de renovaciones se abre la ficha del cliente, y desde el listado
// de pólizas se vuelve al cliente. Pasar esos saltos por props obligaría a que App conozca el detalle de
// cada pantalla.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SolicitudDeMiLink } from '../../shared/miLink'
import type { IdModulo } from '../modulos'

export interface ParametrosDeNavegacion {
  /** Abrir la ficha de este cliente. */
  clienteId?: number
  /** Abrir esta póliza. */
  polizaId?: number
  /** Abrir la ficha de este siniestro. */
  siniestroId?: number
  /** Abrir el formulario de póliza nueva ya apuntando a este cliente. */
  nuevaPolizaPara?: number
  /** Abrir la ficha de esta consulta (Fase 8). */
  leadId?: number
  /** Abrir este presupuesto. */
  presupuestoId?: number
  /** Abrir esta tarea. */
  tareaId?: number
  /** Abrir el formulario de presupuesto nuevo ya apuntando a esta consulta. */
  nuevoPresupuestoParaLead?: number
  /** Abrir el formulario de presupuesto nuevo ya apuntando a este cliente. */
  nuevoPresupuestoParaCliente?: number
  /** Subpestaña dentro del módulo (por ejemplo «reglas» dentro de Cartera). */
  seccion?: string
  /** Texto para dejar cargado en el buscador del módulo. */
  busqueda?: string
  /** Qué área abrir en «General Excel»: lo usa el botón «Ver como Excel» de cada módulo. */
  area?: string
  /**
   * Abrir el Multicotizador con lo que pidió el visitante de Mi link (vehículo, nombre, teléfono y
   * código postal) ya cargado. Viaja la solicitud entera y no su id: está en el VPS, y volver a
   * pedirla sólo para precargar un formulario sería un viaje de más.
   */
  solicitudDeMiLink?: SolicitudDeMiLink
}

interface Navegacion {
  modulo: IdModulo
  /**
   * La sección del módulo abierta desde su sublista de la barra lateral (ver `Modulo.secciones`). A
   * diferencia de `parametros`, no se consume: la barra la usa para marcar el renglón activo.
   */
  seccion: string | null
  parametros: ParametrosDeNavegacion
  /** Cambia de módulo. Los parámetros son de un solo uso: los consume la pantalla que se abre. */
  ir: (modulo: IdModulo, parametros?: ParametrosDeNavegacion) => void
  /** La pantalla avisa que ya usó los parámetros, así volver a la solapa no los vuelve a aplicar. */
  limpiarParametros: () => void
}

const ContextoNavegacion = createContext<Navegacion | null>(null)

export function ProveedorNavegacion({ children }: { children: ReactNode }) {
  const [modulo, setModulo] = useState<IdModulo>('inicio')
  const [parametros, setParametros] = useState<ParametrosDeNavegacion>({})
  const [seccion, setSeccion] = useState<string | null>(null)

  const ir = useCallback((destino: IdModulo, nuevos: ParametrosDeNavegacion = {}) => {
    setModulo(destino)
    setParametros(nuevos)
    setSeccion(nuevos.seccion ?? null)
  }, [])

  const limpiarParametros = useCallback(() => setParametros({}), [])

  const valor = useMemo(() => ({ modulo, seccion, parametros, ir, limpiarParametros }), [modulo, seccion, parametros, ir, limpiarParametros])
  return <ContextoNavegacion.Provider value={valor}>{children}</ContextoNavegacion.Provider>
}

export function useNavegacion(): Navegacion {
  const contexto = useContext(ContextoNavegacion)
  if (!contexto) throw new Error('useNavegacion se usó fuera del proveedor de navegación.')
  return contexto
}
