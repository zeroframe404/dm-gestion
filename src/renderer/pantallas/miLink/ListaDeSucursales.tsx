// Mi link, vista del superadministrador: las cuatro sucursales en una lista, cada una con el estado de
// su página. Desde acá se abre una para configurarla (y de ahí en más las solicitudes, denuncias y
// métricas también son de esa sucursal). Los demás roles no pasan por acá: trabajan con la suya.
import { useState } from 'react'
import type { SucursalDeMiLink } from '../../../shared/miLink'
import { Icono } from '../../componentes/Icono'
import { ChipDeEstado } from '../../componentes/listados'
import { Alerta, Boton, Cargando } from '../../componentes/ui'

interface Props {
  sucursales: SucursalDeMiLink[]
  elegida: string
  /** Abre la sucursal para configurar su página; devuelve el error si no se pudo. */
  alAbrir: (nombre: string) => Promise<string | null>
}

function estadoDe(sucursal: SucursalDeMiLink): { tono: 'verde' | 'ambar' | 'gris'; texto: string } {
  if (!sucursal.link) return { tono: 'gris', texto: 'Sin crear' }
  return sucursal.link.publicada ? { tono: 'verde', texto: 'Publicada' } : { tono: 'ambar', texto: 'Borrador' }
}

export function ListaDeSucursales({ sucursales, elegida, alAbrir }: Props) {
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abrir = async (nombre: string) => {
    setAbriendo(nombre)
    setError(null)
    const fallo = await alAbrir(nombre)
    if (fallo) setError(fallo)
    setAbriendo(null)
  }

  if (sucursales.length === 0) return <Cargando texto="Trayendo las sucursales…" />

  return (
    <div className="flex flex-col gap-5 p-6 xl:p-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Mi link · Sucursales</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
          Cada sucursal tiene su propia página, con su WhatsApp y sus redes, y quienes trabajan en ella ven y atienden lo suyo. Elegí una para
          configurar su página; las solicitudes, los siniestros y las métricas se filtran por sucursal.
        </p>
      </div>
      {error && <Alerta tono="error">{error}</Alerta>}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-suave">
        {sucursales.map((sucursal) => {
          const estado = estadoDe(sucursal)
          return (
            <li key={sucursal.nombre} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-800">
                <Icono nombre="sucursal" tamano={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{sucursal.nombre}</span>
                  {sucursal.nombre === elegida && <span className="text-xs font-semibold text-violet-700">Abierta</span>}
                </div>
                <div className="truncate text-sm text-slate-500">{sucursal.link ? sucursal.link.url : 'Todavía no tiene página.'}</div>
              </div>
              <ChipDeEstado tono={estado.tono}>{estado.texto}</ChipDeEstado>
              <Boton
                tamano="sm"
                icono={sucursal.link ? 'lapiz' : 'mas'}
                cargando={abriendo === sucursal.nombre}
                disabled={abriendo !== null}
                onClick={() => void abrir(sucursal.nombre)}
              >
                {sucursal.link ? 'Configurar' : 'Crear página'}
              </Boton>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
