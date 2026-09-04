// Las fotos y documentos de una póliza (12.6): el auto, la moto, el frente de la póliza, la cédula.
//
// Vive dentro del formulario de la póliza, como un bloque más. Las fotos se muestran como
// miniaturas (las calcula el proceso principal una sola vez); lo demás, como una lista. Todo lo que
// se adjunta acá sube al servidor y se ve desde cualquier computadora de la agencia.
import { useCallback, useEffect, useState } from 'react'
import type { AdjuntoDePoliza, ArchivoParaAdjuntar } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { SelectorDeAdjuntos } from '../../componentes/SelectorDeAdjuntos'
import { Alerta, cx } from '../../componentes/ui'
import { pesoLegible } from '../../imagenes'

interface Props {
  /** null = la póliza todavía no se guardó: no hay dónde colgar nada. */
  polizaId: number | null
  puedeEditar: boolean
  puedeBorrar: boolean
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleDateString('es-AR', { dateStyle: 'short' })
}

/** Dónde está el archivo, en una palabra: para que se entienda por qué una foto tarda en abrir. */
export function estadoDelAdjunto(a: { enElServidor: boolean; errorDelServidor: string | null; descargado: boolean; enDrive: boolean }): { texto: string; tono: 'ok' | 'aviso' | 'error' } {
  if (a.errorDelServidor && !a.enElServidor) return { texto: 'no subió', tono: 'error' }
  if (!a.enElServidor && a.descargado) return { texto: 'subiendo…', tono: 'aviso' }
  if (a.enElServidor && !a.descargado) return { texto: 'en el servidor', tono: 'ok' }
  return { texto: a.enDrive ? 'en el servidor y en Drive' : 'en el servidor', tono: 'ok' }
}

export function EtiquetaDeEstado({ adjunto }: { adjunto: { enElServidor: boolean; errorDelServidor: string | null; descargado: boolean; enDrive: boolean } }) {
  const estado = estadoDelAdjunto(adjunto)
  return (
    <span
      title={adjunto.errorDelServidor ?? undefined}
      className={cx(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        estado.tono === 'ok' && 'bg-emerald-50 text-emerald-700',
        estado.tono === 'aviso' && 'bg-amber-50 text-amber-700',
        estado.tono === 'error' && 'bg-red-50 text-red-700',
      )}
    >
      {estado.texto}
    </span>
  )
}

export function AdjuntosDePoliza({ polizaId, puedeEditar, puedeBorrar }: Props) {
  const [adjuntos, setAdjuntos] = useState<AdjuntoDePoliza[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    if (polizaId === null) return
    const resultado = await window.dm.polizas.adjuntos(polizaId)
    if (resultado.ok) setAdjuntos(resultado.datos)
    else setError(resultado.error)
  }, [polizaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hacer = async (accion: () => Promise<{ ok: true; datos: AdjuntoDePoliza[] } | { ok: false; error: string }>): Promise<boolean> => {
    setTrabajando(true)
    setError(null)
    const resultado = await accion()
    setTrabajando(false)
    if (resultado.ok) setAdjuntos(resultado.datos)
    else setError(resultado.error)
    return resultado.ok
  }

  if (polizaId === null) {
    return <p className="text-sm text-slate-500">Guardá la póliza y después adjuntale las fotos del vehículo y los documentos.</p>
  }

  const fotos = adjuntos.filter((a) => a.miniatura)
  const documentos = adjuntos.filter((a) => !a.miniatura)

  const abrir = async (adjunto: AdjuntoDePoliza) => {
    setError(null)
    const resultado = await window.dm.polizas.abrirAdjunto(adjunto.id)
    if (!resultado.ok) setError(resultado.error)
    else if (!adjunto.descargado) void cargar()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta tono="error">{error}</Alerta>}
      {fotos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((foto) => (
            <li key={foto.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
              <button type="button" onClick={() => void abrir(foto)} className="block aspect-square w-full" title={`${foto.nombre} · ${pesoLegible(foto.tamano)} · ${foto.usuarioNombre}`}>
                <img src={foto.miniatura ?? undefined} alt={foto.nombre} className="h-full w-full object-cover" />
              </button>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1 text-[10px] text-white">
                <span className="truncate">{foto.nombre}</span>
                {puedeBorrar && (
                  <button
                    type="button"
                    aria-label={`Borrar ${foto.nombre}`}
                    disabled={trabajando}
                    onClick={() => void hacer(() => window.dm.polizas.borrarAdjunto(foto.id))}
                    className="shrink-0 rounded p-0.5 hover:bg-red-600"
                  >
                    <Icono nombre="basura" tamano={12} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {documentos.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100">
          {documentos.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2">
              <Icono nombre="carpeta" tamano={16} className="shrink-0 text-slate-400" />
              <button type="button" onClick={() => void abrir(doc)} className="min-w-0 flex-1 text-left text-sm font-medium text-marino-700 hover:underline">
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
                  onClick={() => void hacer(() => window.dm.polizas.borrarAdjunto(doc.id))}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Icono nombre="basura" tamano={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adjuntos.length === 0 && <p className="text-sm text-slate-500">Todavía no hay fotos ni documentos.</p>}
      <SelectorDeAdjuntos
        compacto
        disabled={!puedeEditar}
        ocupado={trabajando}
        texto="arrastrá las fotos del auto o la moto, o pegalas con Ctrl+V"
        alElegir={(archivos: ArchivoParaAdjuntar[]) => hacer(() => window.dm.polizas.adjuntarArchivos(polizaId, archivos))}
      />
    </div>
  )
}
