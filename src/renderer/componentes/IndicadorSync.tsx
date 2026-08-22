// Indicador de sincronización de la barra superior: de un vistazo, si lo que se está cargando llegó a
// la hoja o está esperando. Verde sincronizado, amarillo con cambios por subir, rojo sin conexión.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoSincronizacion } from '../../shared/tipos'
import { Icono, type NombreIcono } from './Icono'
import { cx } from './ui'

interface Aspecto {
  clases: string
  punto: string
  icono: NombreIcono | null
  texto: string
  detalle: string
}

function haceCuanto(iso: string | null): string {
  if (!iso) return 'todavía nunca'
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutos < 1) return 'recién'
  if (minutos === 1) return 'hace 1 minuto'
  if (minutos < 60) return `hace ${minutos} minutos`
  const horas = Math.floor(minutos / 60)
  return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`
}

function aspectoDe(estado: EstadoSincronizacion): Aspecto {
  if (!estado.configurada) {
    return {
      clases: 'border-slate-200 bg-slate-50 text-slate-600',
      punto: 'bg-slate-400',
      icono: null,
      texto: 'Local',
      detalle: 'Todavía no hay hoja conectada: los datos se guardan sólo en esta computadora.',
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
      detalle: 'Subiendo y bajando cambios de la hoja.',
    }
  }
  if (estado.pendientes > 0 || estado.fallidas > 0) {
    const total = estado.pendientes + estado.fallidas
    return {
      clases: 'border-amber-200 bg-amber-50 text-amber-800',
      punto: 'bg-amber-400',
      icono: null,
      texto: `${total} ${total === 1 ? 'cambio' : 'cambios'} por subir`,
      detalle: estado.fallidas > 0 ? `${estado.fallidas} no se pudieron subir. Mirá Administración → Sincronización.` : 'Se suben en unos segundos.',
    }
  }
  return {
    clases: 'border-green-200 bg-green-50 text-green-800',
    punto: 'bg-green-500',
    icono: null,
    texto: `Sincronizado ${haceCuanto(estado.ultimaBajada)}`,
    detalle: `Última subida ${haceCuanto(estado.ultimaSubida)}. Todo lo de esta computadora está en la hoja.`,
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
