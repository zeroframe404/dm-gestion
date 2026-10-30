// Anillo de la barra superior: cuánto del espacio para archivos adjuntos está usado. Al pasar el
// mouse dice espacio usado y total. Lo ven SUPER_ADMIN y ADMIN.
import { useEffect, useState } from 'react'
import type { EstadoDeAlmacenamiento } from '../../shared/tipos'
import { formatearBytes } from './almacenamiento'

const RADIO = 11
const CIRCUNFERENCIA = 2 * Math.PI * RADIO

export function AnilloDeAlmacenamiento() {
  const [estado, setEstado] = useState<EstadoDeAlmacenamiento | null>(null)

  useEffect(() => {
    let vivo = true
    const cargar = async () => {
      const resultado = await window.dm.almacenamiento.estado()
      if (vivo && resultado.ok) setEstado(resultado.datos)
    }
    void cargar()
    const reloj = setInterval(() => void cargar(), 60_000)
    return () => {
      vivo = false
      clearInterval(reloj)
    }
  }, [])

  if (!estado) return null
  const proporcion = Math.min(1, estado.usadoBytes / estado.totalBytes)
  const color = proporcion >= 0.9 ? 'stroke-red-500' : proporcion >= 0.75 ? 'stroke-amber-500' : 'stroke-emerald-500'
  const texto = `Espacio usado: ${formatearBytes(estado.usadoBytes)} de ${formatearBytes(estado.totalBytes)} (${Math.round(proporcion * 100)} %)`

  return (
    <span className="inline-flex h-8 w-8 items-center justify-center" title={texto} role="img" aria-label={texto}>
      <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
        <circle cx="14" cy="14" r={RADIO} fill="none" strokeWidth="3.5" className="stroke-slate-200" />
        <circle
          cx="14"
          cy="14"
          r={RADIO}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUNFERENCIA}
          strokeDashoffset={CIRCUNFERENCIA * (1 - proporcion)}
          className={`${color} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
    </span>
  )
}
