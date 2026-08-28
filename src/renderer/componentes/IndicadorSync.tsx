// Indicador de sincronización de la barra superior: de un vistazo, si lo que se está cargando llegó a
// la base del VPS o está esperando. Verde sincronizado, amarillo con cambios por subir, rojo sin conexión.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoSincronizacion } from '../../shared/tipos'
import { Icono, type NombreIcono } from './Icono'
import { cx, haceCuanto } from './ui'

interface Aspecto {
  clases: string
  punto: string
  icono: NombreIcono | null
  texto: string
  detalle: string
}

function aspectoDe(estado: EstadoSincronizacion): Aspecto {
  if (!estado.configurada) {
    return {
      clases: 'border-slate-200 bg-slate-50 text-slate-600',
      punto: 'bg-slate-400',
      icono: null,
      texto: 'Local',
      detalle: 'La conexión con la base del VPS no está disponible en esta computadora: los datos se guardan sólo acá.',
    }
  }
  if (estado.situacion === 'sin-conexion') {
    return {
      clases: 'border-red-200 bg-red-50 text-red-700',
      punto: 'bg-red-500',
      icono: 'alerta',
      texto: 'Sin conexión — trabajando local',
      detalle: `Se sigue trabajando normal. Hay ${estado.pendientes} cambios esperando para subir; se van a subir solos cuando vuelva internet.`,
    }
  }
  if (estado.situacion === 'trabajando') {
    return {
      clases: 'border-marino-200 bg-marino-50 text-marino-700',
      punto: 'bg-marino-500',
      icono: 'cargando',
      texto: 'Sincronizando…',
      detalle: 'Subiendo y bajando cambios de la base del VPS.',
    }
  }
  if (estado.pendientes > 0) {
    return {
      clases: 'border-amber-200 bg-amber-50 text-amber-800',
      punto: 'bg-amber-400',
      icono: null,
      texto: `${estado.pendientes} ${estado.pendientes === 1 ? 'cambio' : 'cambios'} por subir`,
      detalle:
        estado.fallidas > 0
          ? `Se suben en unos segundos. Aparte hay ${estado.fallidas} que no se pudieron subir: mirá Administración → Sincronización.`
          : 'Se suben en unos segundos.',
    }
  }
  // Los que fallaron no están «por subir»: nadie los va a reintentar solo. Decirlo así evita que el
  // cartel quede clavado en un número que no baja nunca por más que uno toque «Sincronizar».
  if (estado.fallidas > 0) {
    return {
      clases: 'border-amber-200 bg-amber-50 text-amber-800',
      punto: 'bg-amber-400',
      icono: 'alerta',
      texto: `${estado.fallidas} ${estado.fallidas === 1 ? 'cambio' : 'cambios'} sin subir`,
      detalle: 'No se pudieron subir y no se reintentan solos. Entrá a Administración → Sincronización y tocá «Volver a intentar los que fallaron».',
    }
  }
  return {
    clases: 'border-green-200 bg-green-50 text-green-800',
    punto: 'bg-green-500',
    icono: null,
    texto: `Sincronizado ${haceCuanto(estado.ultimaBajada)}`,
    // «Última subida» es la última vez que HUBO algo para subir (si nadie cargó nada, queda vieja y
    // no significa que la sincronización esté caída): se aclara para que no asuste.
    detalle: `Todo lo de esta computadora está en la base del VPS. Última subida ${haceCuanto(estado.ultimaSubida)} (la última vez que hubo cambios para subir).`,
  }
}

export function IndicadorSync() {
  const [estado, setEstado] = useState<EstadoSincronizacion | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  const refrescar = useCallback(async () => {
    const resultado = await window.dm.sincronizacion.estado()
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  useEffect(() => {
    void refrescar()
    const dejarDeEscuchar = window.dm.sincronizacion.alCambiarEstado((nuevo) => setEstado(nuevo))
    // El texto dice «hace X minutos»: hay que refrescarlo aunque no cambie nada.
    const reloj = setInterval(() => void refrescar(), 30_000)
    return () => {
      dejarDeEscuchar()
      clearInterval(reloj)
    }
  }, [refrescar])

  if (!estado) return null
  const aspecto = aspectoDe(estado)

  const sincronizar = async () => {
    if (!estado.configurada || sincronizando) return
    setSincronizando(true)
    const resultado = await window.dm.sincronizacion.ahora(false)
    if (resultado.ok) setEstado(resultado.datos)
    setSincronizando(false)
  }

  return (
    <button
      type="button"
      onClick={() => void sincronizar()}
      disabled={!estado.configurada}
      title={`${aspecto.detalle}${estado.configurada ? '\n\nHacé clic para sincronizar ahora.' : ''}`}
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        aspecto.clases,
        estado.configurada && 'hover:brightness-95',
      )}
    >
      {aspecto.icono === 'cargando' || sincronizando ? (
        <Icono nombre="cargando" tamano={12} className="animate-spin" />
      ) : aspecto.icono ? (
        <Icono nombre={aspecto.icono} tamano={12} />
      ) : (
        <span className={cx('h-2 w-2 rounded-full', aspecto.punto)} aria-hidden="true" />
      )}
      {sincronizando ? 'Sincronizando…' : aspecto.texto}
    </button>
  )
}
