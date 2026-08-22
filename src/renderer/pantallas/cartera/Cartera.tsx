// Módulo Cartera: la planilla del mes y sus vecinas. Dos de sus subpestañas son la misma pantalla que
// se ve desde otro módulo: Imputados es la de Cobranzas (la rendición se mira desde los dos lados y
// tiene que ser una sola) y Estadísticas es la versión tabular de Métricas, hecha para comparar
// contra la hoja fila por fila.
import { useEffect, useState } from 'react'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { Imputados } from '../cobranzas/Imputados'
import { Amp } from './Amp'
import { Bajas } from './Bajas'
import { Estadisticas } from './Estadisticas'
import { PlanillaDelMes } from './PlanillaDelMes'
import { ReglasCobertura } from './ReglasCobertura'
import { RiesgosVarios } from './RiesgosVarios'

type IdSeccion = 'planilla' | 'bajas' | 'riesgos' | 'amp' | 'imputados' | 'reglas' | 'estadisticas'

interface Seccion {
  id: IdSeccion
  nombre: string
  icono: NombreIcono
}

const SECCIONES: Seccion[] = [
  { id: 'planilla', nombre: 'Planilla del mes', icono: 'tabla' },
  { id: 'bajas', nombre: 'Bajas', icono: 'cerrar' },
  { id: 'riesgos', nombre: 'Riesgos varios', icono: 'escudo' },
  { id: 'amp', nombre: 'AMP', icono: 'mas' },
  { id: 'imputados', nombre: 'Imputados', icono: 'billete' },
  { id: 'reglas', nombre: 'Reglas de cobertura', icono: 'polizas' },
  { id: 'estadisticas', nombre: 'Estadísticas', icono: 'metricas' },
]

export function Cartera() {
  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>('planilla')
  const seccion = SECCIONES.find((s) => s.id === seccionActiva) ?? SECCIONES[0]!
  const { parametros, limpiarParametros } = useNavegacion()

  // Otro módulo puede abrir Cartera pidiendo una subpestaña puntual (por ejemplo, el formulario de
  // póliza manda acá para completar la regla de cobertura que le falta).
  useEffect(() => {
    const pedida = parametros.seccion
    if (!pedida) return
    if (SECCIONES.some((s) => s.id === pedida)) setSeccionActiva(pedida as IdSeccion)
    limpiarParametros()
  }, [parametros.seccion, limpiarParametros])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-8">
        <div role="tablist" aria-label="Secciones de la cartera" className="-mb-px flex gap-6">
          {SECCIONES.map((candidata) => {
            const activa = candidata.id === seccion.id
            return (
              <button
                key={candidata.id}
                type="button"
                role="tab"
                id={`tab-cartera-${candidata.id}`}
                aria-selected={activa}
                aria-controls={activa ? `panel-cartera-${candidata.id}` : undefined}
                onClick={() => setSeccionActiva(candidata.id)}
                className={cx(
                  'inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors',
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
        id={`panel-cartera-${seccion.id}`}
        role="tabpanel"
        aria-labelledby={`tab-cartera-${seccion.id}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion.id === 'planilla' && <PlanillaDelMes />}
        {seccion.id === 'bajas' && <Bajas />}
        {seccion.id === 'riesgos' && <RiesgosVarios />}
        {seccion.id === 'amp' && <Amp />}
        {seccion.id === 'imputados' && <Imputados />}
        {seccion.id === 'reglas' && <ReglasCobertura />}
        {seccion.id === 'estadisticas' && <Estadisticas />}
      </div>
    </div>
  )
}
