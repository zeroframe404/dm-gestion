// Administración → Ciberseguridad: lo que protege el acceso a DM Gestión. Es del superadministrador y de nadie más
// (la pestaña sólo se arma para SUPER_ADMIN; cada pantalla de adentro vuelve a pedir el rol al proceso principal).
//
// Tiene el «Control de horarios» y las «Autorizaciones de IP»; se entra desde una tarjeta para que las próximas
// herramientas tengan dónde sumarse sin llenar la barra de pestañas.
import { useState } from 'react'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { Boton } from '../../componentes/ui'
import { AutorizacionesDeIp } from './AutorizacionesDeIp'
import { UsoLaboral } from './UsoLaboral'

interface Herramienta {
  id: 'horarios' | 'ips'
  nombre: string
  descripcion: string
  icono: NombreIcono
}

const HERRAMIENTAS: Herramienta[] = [
  {
    id: 'horarios',
    nombre: 'Control de horarios',
    descripcion:
      'Define en qué horario, qué días y en qué sucursal puede trabajar cada rol, con feriados, y mirá los pedidos de excepción.',
    icono: 'reloj',
  },
  {
    id: 'ips',
    nombre: 'Autorizaciones de IP',
    descripcion:
      'Elegí qué computadoras pueden usar el programa: con el control activado, el servidor no atiende a ninguna IP que no esté en la lista.',
    icono: 'escudo',
  },
]

export function Ciberseguridad() {
  const [abierta, setAbierta] = useState<Herramienta['id'] | null>(null)

  if (abierta) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <Boton variante="fantasma" tamano="sm" onClick={() => setAbierta(null)}>
            ← Volver a Ciberseguridad
          </Boton>
        </div>
        {abierta === 'horarios' ? <UsoLaboral /> : <AutorizacionesDeIp />}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">Ciberseguridad</h2>
        <p className="mt-1 text-sm text-slate-600">Herramientas para cuidar quién entra al programa y cuándo.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HERRAMIENTAS.map((herramienta) => (
          <button
            key={herramienta.id}
            type="button"
            onClick={() => setAbierta(herramienta.id)}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-marino-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-marino-50 text-marino-700 group-hover:bg-marino-100">
              <Icono nombre={herramienta.icono} tamano={22} />
            </span>
            <span className="block text-base font-semibold text-slate-900">{herramienta.nombre}</span>
            <span className="block text-sm leading-relaxed text-slate-600">{herramienta.descripcion}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
