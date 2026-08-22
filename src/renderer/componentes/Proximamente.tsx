// Pantalla que muestra todo módulo que todavía no está desarrollado.
import type { Modulo } from '../modulos'
import { Icono } from './Icono'

export function Proximamente({ modulo }: { modulo: Modulo }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-12 text-center shadow-suave">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-marino-50 text-marino-700">
          <Icono nombre={modulo.icono} tamano={26} />
        </div>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-700">Próximamente</p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-slate-900">{modulo.nombre}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{modulo.descripcion}</p>
        <p className="mt-4 text-xs text-slate-500">Este módulo todavía no está disponible en esta versión de DM Gestión.</p>
      </div>
    </div>
  )
}
