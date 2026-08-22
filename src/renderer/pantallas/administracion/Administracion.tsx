// Módulo Administración: Usuarios (sólo SUPER_ADMIN), Conexión con Google (SUPER_ADMIN y ADMIN) y Acerca de.
import { useMemo, useState } from 'react'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { AcercaDe } from './AcercaDe'
import { Companias } from './Companias'
import { ConexionGoogle } from './ConexionGoogle'
import { ImportarGoogle } from './ImportarGoogle'
import { Impresora } from './Impresora'
import { Sincronizacion } from './Sincronizacion'
import { Usuarios } from './Usuarios'

type IdSeccion = 'usuarios' | 'companias' | 'impresora' | 'google' | 'importar' | 'sincronizacion' | 'acerca'

interface Seccion {
  id: IdSeccion
  nombre: string
  icono: NombreIcono
}

export function Administracion() {
  const usuario = useUsuarioActual()

  // Las secciones visibles dependen del rol. El proceso principal vuelve a controlarlo en cada llamado.
  const secciones = useMemo<Seccion[]>(() => {
    const lista: Seccion[] = []
    if (usuario.rol === 'SUPER_ADMIN') lista.push({ id: 'usuarios', nombre: 'Usuarios', icono: 'clientes' })
    if (usuario.rol !== 'EMPLEADO') {
      lista.push({ id: 'companias', nombre: 'Compañías', icono: 'escudo' })
      lista.push({ id: 'impresora', nombre: 'Impresora', icono: 'impresora' })
      lista.push({ id: 'google', nombre: 'Conexión con Google', icono: 'nube' })
      lista.push({ id: 'importar', nombre: 'Importar desde Google', icono: 'nubeBajada' })
      lista.push({ id: 'sincronizacion', nombre: 'Sincronización', icono: 'nube' })
    }
    lista.push({ id: 'acerca', nombre: 'Acerca de', icono: 'info' })
    return lista
  }, [usuario.rol])

  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>(() => secciones[0]?.id ?? 'acerca')
  const seccion = secciones.some((candidata) => candidata.id === seccionActiva) ? seccionActiva : 'acerca'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-8">
        <div role="tablist" aria-label="Secciones de administración" className="-mb-px flex gap-6">
          {secciones.map((candidata) => {
            const activa = candidata.id === seccion
            return (
              <button
                key={candidata.id}
                type="button"
                role="tab"
                id={`tab-${candidata.id}`}
                aria-selected={activa}
                aria-controls={activa ? `panel-${candidata.id}` : undefined}
                onClick={() => setSeccionActiva(candidata.id)}
                className={cx(
                  'flex items-center gap-2 border-b-2 px-1 py-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  activa
                    ? 'border-marino-700 text-marino-700'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <Icono nombre={candidata.icono} tamano={16} />
                {candidata.nombre}
              </button>
            )
          })}
        </div>
      </div>

      <div id={`panel-${seccion}`} role="tabpanel" aria-labelledby={`tab-${seccion}`} className="min-w-0 flex-1 overflow-y-auto p-8">
        {seccion === 'usuarios' && <Usuarios />}
        {seccion === 'companias' && <Companias />}
        {seccion === 'impresora' && <Impresora />}
        {seccion === 'google' && <ConexionGoogle />}
        {seccion === 'importar' && <ImportarGoogle />}
        {seccion === 'sincronizacion' && <Sincronizacion />}
        {seccion === 'acerca' && <AcercaDe />}
      </div>
    </div>
  )
}
