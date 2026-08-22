// Barra superior: título del módulo, indicador de sincronización, usuario y cierre de sesión.
import { NOMBRE_ROL } from '../../shared/tipos'
import { useSesion, useUsuarioActual } from '../contexto/Sesion'
import { CampanaDeTareas } from './CampanaDeTareas'
import { IndicadorSync } from './IndicadorSync'
import { Boton } from './ui'

export function BarraSuperior({ titulo }: { titulo: string }) {
  const { salir } = useSesion()
  const usuario = useUsuarioActual()

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6">
      <h1 className="font-display text-lg font-bold tracking-tight text-slate-900">{titulo}</h1>

      <div className="ml-auto flex items-center gap-4">
        <IndicadorSync />
        <span className="h-6 w-px bg-slate-200" aria-hidden="true" />
        <CampanaDeTareas />
        <span className="h-6 w-px bg-slate-200" aria-hidden="true" />

        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full bg-marino-700 text-xs font-bold text-white"
            aria-hidden="true"
          >
            {obtenerIniciales(usuario.nombre)}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">{usuario.nombre}</p>
            <p className="text-xs text-slate-500">
              {NOMBRE_ROL[usuario.rol]} · Sucursal {usuario.sucursal.nombre}
            </p>
          </div>
        </div>

        <Boton variante="fantasma" tamano="sm" icono="salir" onClick={() => void salir()}>
          Cerrar sesión
        </Boton>
      </div>
    </header>
  )
}

function obtenerIniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const primera = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return (primera + ultima).toUpperCase() || '?'
}
