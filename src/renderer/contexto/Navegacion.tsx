// Navegación entre módulos. No hay router (la aplicación es una sola ventana y no tiene direcciones):
// alcanza con saber qué módulo está abierto y con qué lo abrieron.
//
// Existe porque los módulos de la Fase 5 se llaman entre sí todo el tiempo: desde la ficha de un cliente
// se crea una póliza, desde la bandeja de renovaciones se abre la ficha del cliente, y desde el listado
// de pólizas se vuelve al cliente. Pasar esos saltos por props obligaría a que App conozca el detalle de
// cada pantalla.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
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
}

interface Navegacion {
  modulo: IdModulo
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

  const ir = useCallback((destino: IdModulo, nuevos: ParametrosDeNavegacion = {}) => {
    setModulo(destino)
    setParametros(nuevos)
  }, [])

  const limpiarParametros = useCallback(() => setParametros({}), [])

  const valor = useMemo(() => ({ modulo, parametros, ir, limpiarParametros }), [modulo, parametros, ir, limpiarParametros])
  return <ContextoNavegacion.Provider value={valor}>{children}</ContextoNavegacion.Provider>
}

export function useNavegacion(): Navegacion {
  const contexto = useContext(ContextoNavegacion)
  if (!contexto) throw new Error('useNavegacion se usó fuera del proveedor de navegación.')
  return contexto
}
