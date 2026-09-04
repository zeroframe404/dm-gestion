// Módulo Cartera: la planilla del mes y sus vecinas. Dos de sus subpestañas son la misma pantalla que
// se ve desde otro módulo: Imputados es la de Cobranzas (la rendición se mira desde los dos lados y
// tiene que ser una sola) y Estadísticas es la versión tabular de Métricas, hecha para comparar
// contra la hoja fila por fila.
import { useEffect, useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { useNavegacion } from '../../contexto/Navegacion'
import { Imputados } from '../cobranzas/Imputados'
import { Amp } from './Amp'
import { Bajas } from './Bajas'
import { Duplicados } from './Duplicados'
import { Estadisticas } from './Estadisticas'
import { PlanillaDelMes } from './PlanillaDelMes'
import { Rechazos } from './Rechazos'
import { ReglasCobertura } from './ReglasCobertura'
import { RiesgosVarios } from './RiesgosVarios'

type IdSeccion = 'planilla' | 'bajas' | 'rechazos' | 'riesgos' | 'amp' | 'imputados' | 'reglas' | 'estadisticas' | 'duplicados'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'planilla', nombre: 'Planilla del mes', icono: 'tabla', ayuda: 'cartera.planilla', excel: 'cartera' },
  { id: 'bajas', nombre: 'Bajas', icono: 'cerrar', ayuda: 'cartera.bajas', excel: 'bajas' },
  { id: 'rechazos', nombre: 'Rechazos', icono: 'alerta', ayuda: 'cartera.rechazos' },
  { id: 'riesgos', nombre: 'Riesgos varios', icono: 'escudo', ayuda: 'cartera.riesgos', excel: 'riesgos' },
  { id: 'amp', nombre: 'AMP', icono: 'mas', ayuda: 'cartera.amp' },
  { id: 'imputados', nombre: 'Imputados', icono: 'billete', ayuda: 'imputados' },
  { id: 'reglas', nombre: 'Reglas de cobertura', icono: 'polizas', ayuda: 'cartera.reglas' },
  { id: 'estadisticas', nombre: 'Estadísticas', icono: 'metricas', ayuda: 'cartera.estadisticas' },
  { id: 'duplicados', nombre: 'Duplicados', icono: 'cuadricula', ayuda: 'cartera.duplicados' },
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
      <BarraDePestanas
        etiqueta="Secciones de la cartera"
        prefijo="cartera"
        items={SECCIONES}
        activa={seccion.id}
        alElegir={setSeccionActiva}
      />

      <div
        id={`panel-cartera-${seccion.id}`}
        role="tabpanel"
        aria-labelledby={`tab-cartera-${seccion.id}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion.id === 'planilla' && <PlanillaDelMes />}
        {seccion.id === 'bajas' && <Bajas />}
        {seccion.id === 'rechazos' && <Rechazos />}
        {seccion.id === 'riesgos' && <RiesgosVarios />}
        {seccion.id === 'amp' && <Amp />}
        {seccion.id === 'imputados' && <Imputados />}
        {seccion.id === 'reglas' && <ReglasCobertura />}
        {seccion.id === 'estadisticas' && <Estadisticas />}
        {seccion.id === 'duplicados' && <Duplicados />}
      </div>
    </div>
  )
}
