// El isotipo de la marca de la demo (Cobertia): un escudo con un tilde sobre un cuadrado verde azulado.
// Es el mismo dibujo que `recursos/demo/logo-cobertia.svg` (de donde salen el ícono del instalador y el
// de la pantalla de carga), en SVG para que se vea nítido a cualquier tamaño y sin archivos aparte.
//
// La versión de la agencia no lo usa: ahí sigue el escudo de siempre.
import { useId } from 'react'

export function LogoDeLaMarca({ tamano = 40, className }: { tamano?: number; className?: string }) {
  // Dos logos en la misma pantalla no pueden compartir los ids de los degradés.
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 512 512" width={tamano} height={tamano} className={className} role="img" aria-label="Cobertia">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f766e" />
          <stop offset="1" stopColor="#065f46" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d1fae5" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="112" fill={`url(#${id}f)`} />
      <path d="M256 92 L392 140 V252 C392 336 336 396 256 424 C176 396 120 336 120 252 V140 Z" fill={`url(#${id}b)`} />
      <path d="M190 262 L238 310 L328 208" fill="none" stroke="#0f766e" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
