// Módulo Marketing: las plantillas de los mensajes de WhatsApp y los segmentos de la cartera.
import { useEffect, useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { useNavegacion } from '../../contexto/Navegacion'
import { Plantillas } from './Plantillas'
import { Segmentos } from './Segmentos'

type IdSeccion = 'segmentos' | 'plantillas'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'segmentos', nombre: 'Segmentos', icono: 'clientes', ayuda: 'marketing.segmentos' },
  { id: 'plantillas', nombre: 'Plantillas', icono: 'mensaje', ayuda: 'marketing.plantillas' },
]

export function Marketing() {
  const [seccion, setSeccion] = useState<IdSeccion>('segmentos')
  const { parametros, limpiarParametros } = useNavegacion()

  // Otro módulo puede abrir Marketing pidiendo una subpestaña puntual.
  useEffect(() => {
    const pedida = parametros.seccion
    if (!pedida) return
    if (SECCIONES.some((s) => s.id === pedida)) setSeccion(pedida as IdSeccion)
    limpiarParametros()
  }, [parametros.seccion, limpiarParametros])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas etiqueta="Secciones de marketing" prefijo="marketing" items={SECCIONES} activa={seccion} alElegir={setSeccion} />

      <div
        id={`panel-marketing-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-marketing-${seccion}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion === 'segmentos' ? <Segmentos /> : <Plantillas />}
      </div>
    </div>
  )
}
