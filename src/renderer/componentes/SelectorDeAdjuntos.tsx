// La zona para adjuntar: arrastrar archivos, pegarlos con Ctrl+V o elegirlos con un botón.
//
// Las fotos se achican acá, en la ventana, antes de mandarlas al proceso principal (ver imagenes.ts):
// el proceso principal recibe los bytes ya listos y no tiene que saber de lienzos. Lo que no es foto
// viaja tal cual.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { ArchivoParaAdjuntar } from '../../shared/tipos'
import { pesoLegible, prepararArchivos, type ResultadoDeOptimizacion } from '../imagenes'
import { Icono } from './Icono'
import { cx } from './ui'

interface Props {
  /** Recibe los archivos listos. Devuelve si se guardaron, para saber si mostrar el resumen. */
  alElegir: (archivos: ArchivoParaAdjuntar[]) => Promise<boolean> | boolean | void
  disabled?: boolean
  /** Alguien está guardando afuera (la ficha): la zona se apaga mientras tanto. */
  ocupado?: boolean
  /** Versión chica, para meter debajo de una lista. */
  compacto?: boolean
  /** Qué se espera que caiga acá. Sirve para el texto y para el filtro del explorador. */
  texto?: string
  aceptar?: string
  /** Si además de la zona se ofrece el explorador del sistema (rutas), qué hacer al tocarlo. */
  alExplorar?: () => void
}

function resumenDeOptimizacion(resultados: ResultadoDeOptimizacion[]): string | null {
  const achicadas = resultados.filter((r) => r.archivo.optimizado)
  if (achicadas.length === 0) return null
  const antes = achicadas.reduce((suma, r) => suma + r.antes, 0)
  const despues = achicadas.reduce((suma, r) => suma + r.despues, 0)
  return `${achicadas.length === 1 ? 'Una foto achicada' : `${achicadas.length} fotos achicadas`} de ${pesoLegible(antes)} a ${pesoLegible(despues)}, sin que se note.`
}

export function SelectorDeAdjuntos({ alElegir, disabled = false, ocupado = false, compacto = false, texto, aceptar, alExplorar }: Props) {
  const entrada = useRef<HTMLInputElement>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [resumen, setResumen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const apagado = disabled || ocupado || procesando

  const recibir = useCallback(
    async (archivos: File[]) => {
      if (apagado || archivos.length === 0) return
      setProcesando(true)
      setError(null)
      setResumen(null)
      try {
        const resultados = await prepararArchivos(archivos)
        const ok = await alElegir(resultados.map((r) => r.archivo))
        if (ok !== false) setResumen(resumenDeOptimizacion(resultados))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setProcesando(false)
      }
    },
    [alElegir, apagado],
  )

  // Ctrl+V con una imagen en el portapapeles (una captura, una foto copiada de WhatsApp Web).
  useEffect(() => {
    if (apagado) return
    const alPegar = (evento: ClipboardEvent) => {
      const objetivo = evento.target as HTMLElement | null
      // Pegar texto en un campo sigue siendo pegar texto.
      if (objetivo && (objetivo.tagName === 'INPUT' || objetivo.tagName === 'TEXTAREA' || objetivo.isContentEditable)) return
      const archivos = Array.from(evento.clipboardData?.files ?? [])
      if (archivos.length === 0) return
      evento.preventDefault()
      void recibir(archivos.map((f, i) => (f.name ? f : new File([f], `pegado-${i + 1}.png`, { type: f.type }))))
    }
    window.addEventListener('paste', alPegar)
    return () => window.removeEventListener('paste', alPegar)
  }, [apagado, recibir])

  const alSoltar = (evento: DragEvent<HTMLDivElement>) => {
    evento.preventDefault()
    setArrastrando(false)
    void recibir(Array.from(evento.dataTransfer?.files ?? []))
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={apagado ? -1 : 0}
        aria-disabled={apagado}
        onClick={() => !apagado && entrada.current?.click()}
        onKeyDown={(evento) => {
          if (!apagado && (evento.key === 'Enter' || evento.key === ' ')) {
            evento.preventDefault()
            entrada.current?.click()
          }
        }}
        onDragOver={(evento) => {
          evento.preventDefault()
          if (!apagado) setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
        className={cx(
          'flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors',
          compacto ? 'px-3 py-2.5' : 'px-4 py-6',
          arrastrando ? 'border-marino-500 bg-marino-50' : 'border-slate-300 bg-slate-50 hover:border-marino-400 hover:bg-white',
          apagado && 'cursor-not-allowed opacity-60',
        )}
      >
        <Icono nombre={procesando ? 'cargando' : 'clip'} tamano={compacto ? 16 : 22} className={cx('shrink-0 text-marino-700', procesando && 'animate-spin')} />
        <div className={cx('text-slate-600', compacto ? 'text-xs' : 'text-sm')}>
          {procesando ? (
            'Preparando los archivos…'
          ) : (
            <>
              <span className="font-semibold text-marino-800">Elegir archivos</span>
              {' · '}
              {texto ?? 'arrastrá fotos o documentos acá, o pegalos con Ctrl+V'}
            </>
          )}
        </div>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={aceptar}
          className="hidden"
          disabled={apagado}
          onChange={(evento) => {
            const archivos = Array.from(evento.target.files ?? [])
            evento.target.value = ''
            void recibir(archivos)
          }}
        />
      </div>
      {alExplorar && !compacto && (
        <button type="button" disabled={apagado} onClick={alExplorar} className="self-start text-xs text-slate-500 underline-offset-2 hover:underline">
          Elegir con el explorador de Windows (para HEIC y archivos grandes)
        </button>
      )}
      {resumen && <p className="text-xs text-emerald-700">{resumen}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  )
}
