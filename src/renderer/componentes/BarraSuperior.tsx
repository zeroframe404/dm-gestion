// Barra superior: título del módulo, indicador de sincronización, usuario y cierre de sesión.
import { NOMBRE_ROL } from '../../shared/tipos'
import { useAcceso } from '../contexto/Acceso'
import { usePermisos } from '../contexto/Permisos'
import { useSesion, useUsuarioActual } from '../contexto/Sesion'
import { BotonDeSonido } from './BotonDeSonido'
import { BotonDeTema } from './BotonDeTema'
import { CampanaDeRechazos } from './CampanaDeRechazos'
import { CampanaDeMensajes } from './CampanaDeMensajes'
import { CampanaDeTareas } from './CampanaDeTareas'
import { ControlDeZoom } from './ControlDeZoom'
import { IndicadorSync } from './IndicadorSync'
import { Boton } from './ui'

export function BarraSuperior({ titulo }: { titulo: string }) {
  const { salir } = useSesion()
  const usuario = useUsuarioActual()
  const { acceso } = useAcceso(false)
  const permisos = usePermisos()
  // Sin acceso a Tareas la campana no tiene nada que avisar: no se muestra.
  const verTareas = permisos.puedeVer('tareas')
  const verMensajes = permisos.puedeVer('mensajes')
  // La de rechazos es de la cartera del mostrador: la ve quien tenga Cartera o Pólizas a la vista, y
  // sólo puede darlos por resueltos quien además pueda editar alguno de los dos.
  const verRechazos = permisos.puedeVer('cartera') || permisos.puedeVer('polizas')
  const resolverRechazos = permisos.puedeEditar('cartera') || permisos.puedeEditar('polizas')

  // Una sola línea bajo el nombre: si esta sesión se abrió sin internet, o si la base de usuarios
  // tiene un problema que sólo un superadministrador puede resolver.
  let avisoDeAcceso: { texto: string; detalle: string; clase: string } | null = null
  if (acceso?.sesionSinConfirmar) {
    avisoDeAcceso = {
      texto: 'Ingresaste sin internet',
      detalle: 'Tu contraseña se comprobó con la copia guardada en esta computadora. Todo lo demás funciona igual; cuando vuelva internet se vuelve a comprobar sola.',
      clase: 'text-amber-700',
    }
  } else if (acceso?.configurada && acceso.modo === 'error-remoto' && usuario.rol === 'SUPER_ADMIN') {
    avisoDeAcceso = {
      texto: 'Base de usuarios con error',
      detalle: acceso.ultimoError ?? 'No se pudo acceder a la base de usuarios compartida. Mirá Administración → Usuarios.',
      clase: 'text-red-700',
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6">
      {/* El título se recorta antes que empujar los controles fuera de la ventana: la barra es de alto
          fijo y el `body` no scrollea, así que lo que se sale de acá no vuelve. */}
      <h1 className="min-w-0 truncate font-display text-lg font-bold tracking-tight text-slate-900">{titulo}</h1>

      <div className="ml-auto flex shrink-0 items-center gap-4">
        <IndicadorSync />
        {verRechazos && (
          <>
            <span className="h-6 w-px bg-slate-200" aria-hidden="true" />
            <CampanaDeRechazos puedeResolver={resolverRechazos} puedeVerLaPantalla={permisos.puedeVer('cartera')} />
          </>
        )}
        {verTareas && (
          <>
            <span className="h-6 w-px bg-slate-200" aria-hidden="true" />
            <CampanaDeTareas />
          </>
        )}
        {verMensajes && (
          <>
            <span className="h-6 w-px bg-slate-200" aria-hidden="true" />
            <CampanaDeMensajes />
          </>
        )}
        {/* Pegado a las campanas: es lo que se busca justo después de que sonó una y molestó. */}
        <BotonDeSonido />
        {/* Al lado del sonido a propósito: las tres son preferencias de esta computadora y no del usuario. */}
        <BotonDeTema />
        <ControlDeZoom />
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
            {avisoDeAcceso && (
              <p className={`text-[11px] font-semibold ${avisoDeAcceso.clase}`} title={avisoDeAcceso.detalle}>
                {avisoDeAcceso.texto}
              </p>
            )}
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
