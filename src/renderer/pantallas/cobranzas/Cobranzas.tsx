// Módulo Cobranzas: la caja del día por sucursal, la mora, la rendición mensual contra las compañías
// y las comisiones estimadas. Imputados es la misma pantalla que la subpestaña de Cartera.
import { useEffect, useMemo, useState } from 'react'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { useUsuarioActual } from '../../contexto/Sesion'
import { CajaDelDia } from './CajaDelDia'
import { Comisiones } from './Comisiones'
import { Imputados } from './Imputados'
import { Mora } from './Mora'

type IdSeccion = 'caja' | 'mora' | 'imputados' | 'comisiones'

interface Seccion {
  id: IdSeccion
  nombre: string
  icono: NombreIcono
}

export function Cobranzas() {
  const usuario = useUsuarioActual()
  const { parametros, limpiarParametros } = useNavegacion()

  // Las comisiones son información de la agencia, no del mostrador: sólo las ven los administradores.
  // El proceso principal lo vuelve a controlar en cada llamado.
  const secciones = useMemo<Seccion[]>(() => {
    const lista: Seccion[] = [
      { id: 'caja', nombre: 'Caja del día', icono: 'billete' },
      { id: 'mora', nombre: 'Mora', icono: 'alerta' },
      { id: 'imputados', nombre: 'Imputados', icono: 'tabla' },
    ]
    if (usuario.rol !== 'EMPLEADO') lista.push({ id: 'comisiones', nombre: 'Comisiones', icono: 'porcentaje' })
    return lista
  }, [usuario.rol])

  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>('caja')
  const seccion = secciones.some((s) => s.id === seccionActiva) ? seccionActiva : 'caja'

  // Otro módulo puede abrir Cobranzas pidiendo una subpestaña puntual.
  useEffect(() => {
    const pedida = parametros.seccion
    if (!pedida) return
    if (secciones.some((s) => s.id === pedida)) setSeccionActiva(pedida as IdSeccion)
    limpiarParametros()
  }, [parametros.seccion, limpiarParametros, secciones])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-8">
        <div role="tablist" aria-label="Secciones de cobranzas" className="-mb-px flex gap-6">
          {secciones.map((candidata) => {
            const activa = candidata.id === seccion
            return (
              <button
                key={candidata.id}
                type="button"
                role="tab"
                id={`tab-cobranzas-${candidata.id}`}
                aria-selected={activa}
                aria-controls={activa ? `panel-cobranzas-${candidata.id}` : undefined}
                onClick={() => setSeccionActiva(candidata.id)}
                className={cx(
                  'inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  activa ? 'border-marino-700 text-marino-800' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <Icono nombre={candidata.icono} tamano={16} />
                {candidata.nombre}
              </button>
            )
          })}
        </div>
      </div>

      <div
        id={`panel-cobranzas-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-cobranzas-${seccion}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion === 'caja' && <CajaDelDia />}
        {seccion === 'mora' && <Mora />}
        {seccion === 'imputados' && <Imputados />}
        {seccion === 'comisiones' && <Comisiones />}
      </div>
    </div>
  )
}
