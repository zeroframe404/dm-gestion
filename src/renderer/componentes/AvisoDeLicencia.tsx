// El cartel de la licencia, arriba de todo: a los administradores, desde 15 días antes del vencimiento;
// a todos, fijo, durante los días de gracia. Con la licencia al día no se dibuja nada.
import { avisoDeLicencia } from '../../shared/licencia'
import { useLicencia } from '../contexto/Licencia'
import { useUsuarioActual } from '../contexto/Sesion'
import { Icono } from './Icono'

export function AvisoDeLicencia() {
  const { estado } = useLicencia()
  const usuario = useUsuarioActual()
  const aviso = avisoDeLicencia(estado, usuario.rol)
  if (!aviso || !estado) return null
  const grave = estado.estado === 'en_gracia'
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        grave
          ? 'flex items-center justify-center gap-3 bg-red-700 px-4 py-1.5 text-xs font-semibold text-white'
          : 'flex items-center justify-center gap-3 bg-amber-400 px-4 py-1.5 text-xs font-semibold text-amber-950'
      }
    >
      <Icono nombre="alerta" tamano={14} />
      <span>
        {aviso} Para renovarla, comunicate con quien te vendió DM Gestión
        {usuario.rol === 'SUPER_ADMIN' ? ' y pegá la licencia nueva en Administración → Licencia.' : '.'}
      </span>
    </div>
  )
}
