// Las cotizaciones que manda cada compañía (el PDF, o una captura), para no perderlas entre el
// mensaje de WhatsApp y la planilla. Vive dentro de la ficha del presupuesto, como un bloque más.
import { useCallback, useEffect, useState } from 'react'
import type { AdjuntoDePresupuesto, ArchivoParaAdjuntar } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { SelectorDeAdjuntos } from '../../componentes/SelectorDeAdjuntos'
import { Alerta } from '../../componentes/ui'
import { pesoLegible } from '../../imagenes'
import { EtiquetaDeEstado } from '../polizas/AdjuntosDePoliza'

interface Props {
  presupuestoId: number
  puedeEditar: boolean
  puedeBorrar: boolean
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleDateString('es-AR', { dateStyle: 'short' })
}

export function AdjuntosDePresupuesto({ presupuestoId, puedeEditar, puedeBorrar }: Props) {
  const [adjuntos, setAdjuntos] = useState<AdjuntoDePresupuesto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.presupuestos.adjuntos(presupuestoId)
    if (resultado.ok) setAdjuntos(resultado.datos)
    else setError(resultado.error)
  }, [presupuestoId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hacer = async (
    accion: () => Promise<{ ok: true; datos: AdjuntoDePresupuesto[] } | { ok: false; error: string }>,
  ): Promise<boolean> => {
    setTrabajando(true)
    setError(null)
    const resultado = await accion()
    setTrabajando(false)
    if (resultado.ok) setAdjuntos(resultado.datos)
    else setError(resultado.error)
    return resultado.ok
  }

  const abrir = async (adjunto: AdjuntoDePresupuesto) => {
    setError(null)
    const resultado = await window.dm.presupuestos.abrirAdjunto(adjunto.id)
    if (!resultado.ok) setError(resultado.error)
    else if (!adjunto.descargado) void cargar()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta tono="error">{error}</Alerta>}
      {adjuntos.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100">
          {adjuntos.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2">
              <Icono nombre="carpeta" tamano={16} className="shrink-0 text-slate-400" />
              <button
                type="button"
                onClick={() => void abrir(doc)}
                className="min-w-0 flex-1 text-left text-sm font-medium text-marino-700 hover:underline"
              >
                <span className="block truncate">{doc.nombre}</span>
                <span className="block text-xs font-normal text-slate-500">
                  {pesoLegible(doc.tamano)} · {fechaCorta(doc.creadoEn)} · {doc.usuarioNombre}
                </span>
              </button>
              <EtiquetaDeEstado adjunto={doc} />
              {puedeBorrar && (
                <button
                  type="button"
                  aria-label={`Borrar ${doc.nombre}`}
                  disabled={trabajando}
                  onClick={() => void hacer(() => window.dm.presupuestos.borrarAdjunto(doc.id))}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Icono nombre="basura" tamano={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adjuntos.length === 0 && <p className="text-sm text-slate-500">Todavía no hay ninguna cotización guardada.</p>}
      <SelectorDeAdjuntos
        compacto
        disabled={!puedeEditar}
        ocupado={trabajando}
        texto="arrastrá el PDF de la cotización, o pegalo con Ctrl+V"
        aceptar="application/pdf,image/*"
        alElegir={(archivos: ArchivoParaAdjuntar[]) => hacer(() => window.dm.presupuestos.adjuntarArchivos(presupuestoId, archivos))}
      />
    </div>
  )
}
