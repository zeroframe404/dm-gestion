// El cuadro de «Reportar error»: título, qué pasó y las capturas.
//
// Está pensado para el momento en que se usa: alguien con gente en el mostrador y algo que no anda. Por
// eso son tres campos y no un formulario, por eso se puede pegar la captura con Ctrl+V —que es donde
// queda al apretar Impr Pant— y por eso el contexto (quién, desde qué sucursal, con qué versión) lo
// agrega el programa solo: pedírselo a la persona es pedirle que investigue su propio problema.
//
// Lo que sale de acá va al VPS y el servidor abre el issue en GitHub. El programa nunca lleva un token
// de GitHub: eso vive en el servidor, y es a propósito (ver `servicios/soporte.ts`).
import { useCallback, useEffect, useState } from 'react'
import type { ImagenDeReporte, ReporteCreado, TipoDeReporte } from '../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, cx } from './ui'
import { Icono } from './Icono'

/** Las mismas cuatro que acepta el servidor. */
const MAXIMO_IMAGENES = 4

/**
 * Lo que cambia entre reportar un error y sugerir una mejora (12.6): los textos. El camino es el
 * mismo —el cuadro, las capturas, el VPS, el issue— y la etiqueta la pone el servidor.
 */
const TEXTOS: Record<
  TipoDeReporte,
  { titulo: string; descripcion: string; campoTitulo: string; ayudaTitulo: string; campoCuerpo: string; ayudaCuerpo: string; capturas: string; listo: string; despues: string }
> = {
  error: {
    titulo: 'Reportar un error',
    descripcion: 'Contá qué pasó y, si podés, adjuntá una captura. El programa agrega solo tu nombre, tu sucursal y la versión.',
    campoTitulo: 'Qué falló',
    ayudaTitulo: 'Una línea. Con la pantalla y qué estabas haciendo alcanza: «Cobranzas: el ticket sale sin la dirección».',
    campoCuerpo: 'Qué pasó',
    ayudaCuerpo: 'Lo que hiciste, lo que esperabas que pasara y lo que pasó. Si aparece un cartel de error, copiá el texto tal cual.',
    capturas: 'opcionales, pero son lo que más ayuda',
    listo: 'El reporte quedó anotado',
    despues:
      'Si el problema te deja seguir trabajando, seguí: esto ya llegó. Si te frena, avisá por teléfono además, porque nadie está mirando la lista de reportes todo el día.',
  },
  mejora: {
    titulo: 'Sugerir una mejora',
    descripcion: 'Contá qué te gustaría que el programa haga distinto o de más. Vale cualquier idea: un botón que falta, un paso de más, algo que se hace a mano y podría hacerse solo.',
    campoTitulo: 'Qué te gustaría',
    ayudaTitulo: 'Una línea: «Que la planilla del mes se pueda ordenar por compañía».',
    campoCuerpo: 'Contalo con más detalle',
    ayudaCuerpo: 'Cómo lo hacés hoy, qué te complica y cómo te imaginás que sería mejor. Si hay una pantalla en la que pasa, nombrala.',
    capturas: 'opcionales: una captura de la pantalla de la que hablás ayuda a entender',
    listo: 'La sugerencia quedó anotada',
    despues: 'Las sugerencias se miran y se ordenan junto con las demás; no todas se hacen, y las que sí llegan en una versión nueva.',
  },
}

export function DialogoReportarError({ abierto, alCerrar, variante = 'error' }: { abierto: boolean; alCerrar: () => void; variante?: TipoDeReporte }) {
  const textos = TEXTOS[variante]
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [imagenes, setImagenes] = useState<ImagenDeReporte[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creado, setCreado] = useState<ReporteCreado | null>(null)

  // Al abrirlo de nuevo se arranca en blanco: el reporte anterior ya se mandó.
  useEffect(() => {
    if (!abierto) return
    setTitulo('')
    setCuerpo('')
    setImagenes([])
    setError(null)
    setCreado(null)
  }, [abierto])

  const agregar = useCallback((nuevas: ImagenDeReporte[]) => {
    if (nuevas.length === 0) return
    setImagenes((previas) => {
      const yaEstan = new Set(previas.map((imagen) => imagen.ruta))
      return [...previas, ...nuevas.filter((imagen) => !yaEstan.has(imagen.ruta))].slice(0, MAXIMO_IMAGENES)
    })
  }, [])

  const elegir = async () => {
    setError(null)
    const resultado = await window.dm.soporte.elegirImagenes()
    if (resultado.ok) agregar(resultado.datos)
    else setError(resultado.error)
  }

  const pegar = useCallback(async () => {
    setError(null)
    const resultado = await window.dm.soporte.pegarImagen()
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (!resultado.datos) {
      setError('No hay ninguna imagen en el portapapeles. Apretá «Impr Pant» y volvé a probar.')
      return
    }
    agregar([resultado.datos])
  }, [agregar])

  // Ctrl+V pega la captura sin tener que buscar el botón: es el camino que se usa de verdad.
  useEffect(() => {
    if (!abierto || creado) return
    const alTeclear = (evento: KeyboardEvent) => {
      if (!(evento.ctrlKey || evento.metaKey) || evento.key.toLowerCase() !== 'v') return
      // Si está escribiendo en un campo, Ctrl+V es pegar texto y no se le roba.
      const foco = document.activeElement
      if (foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement) return
      void pegar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierto, creado, pegar])

  const enviar = async () => {
    setEnviando(true)
    setError(null)
    const resultado = await window.dm.soporte.reportar({
      titulo,
      cuerpo,
      rutasDeImagenes: imagenes.map((imagen) => imagen.ruta),
      tipo: variante,
    })
    setEnviando(false)
    if (resultado.ok) setCreado(resultado.datos)
    else setError(resultado.error)
  }

  const abrirEnGitHub = async () => {
    if (!creado) return
    await window.dm.sistema.abrirEnlace(creado.url)
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo={creado ? textos.listo : textos.titulo}
      descripcion={creado ? 'Ya está del otro lado. No hace falta que lo mandes por ningún otro lado.' : textos.descripcion}
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        creado ? (
          <>
            <Boton onClick={() => void abrirEnGitHub()}>Verlo</Boton>
            <Boton variante="primario" onClick={alCerrar}>
              Listo
            </Boton>
          </>
        ) : (
          <>
            <Boton onClick={alCerrar} disabled={enviando}>
              Cancelar
            </Boton>
            <Boton variante="primario" icono="ok" onClick={() => void enviar()} cargando={enviando} disabled={!titulo.trim()}>
              Enviar
            </Boton>
          </>
        )
      }
    >
      {creado ? (
        <div className="flex flex-col gap-3">
          <Alerta tono="exito">
            Quedó anotado como {variante === 'mejora' ? 'la sugerencia' : 'el reporte'} <strong className="font-semibold">#{creado.numero}</strong>
            {creado.imagenesSubidas > 0 && <>, con {creado.imagenesSubidas === 1 ? 'una captura' : `${creado.imagenesSubidas} capturas`}</>}.
          </Alerta>
          <p className="text-sm leading-relaxed text-slate-600">{textos.despues}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Campo
            etiqueta={textos.campoTitulo}
            value={titulo}
            onChange={(evento) => setTitulo(evento.target.value)}
            maxLength={160}
            autoFocus
            ayuda={textos.ayudaTitulo}
          />
          <AreaTexto etiqueta={textos.campoCuerpo} value={cuerpo} onChange={(evento) => setCuerpo(evento.target.value)} rows={6} ayuda={textos.ayudaCuerpo} />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Capturas</span>
              <span className="text-xs text-slate-500">
                {imagenes.length}/{MAXIMO_IMAGENES} · {textos.capturas}
              </span>
              <div className="ml-auto flex gap-2">
                <Boton tamano="sm" icono="clip" onClick={() => void pegar()} disabled={imagenes.length >= MAXIMO_IMAGENES}>
                  Pegar (Ctrl+V)
                </Boton>
                <Boton tamano="sm" icono="mas" onClick={() => void elegir()} disabled={imagenes.length >= MAXIMO_IMAGENES}>
                  Buscar
                </Boton>
              </div>
            </div>

            {imagenes.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs leading-relaxed text-slate-500">
                Apretá <strong className="font-semibold">Impr Pant</strong> para copiar la pantalla y después{' '}
                <strong className="font-semibold">Ctrl+V</strong> acá. También se pueden buscar imágenes ya guardadas.
              </p>
            ) : (
              <ul className="mt-2 grid grid-cols-2 gap-2">
                {imagenes.map((imagen) => (
                  <li key={imagen.ruta} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {imagen.vistaPrevia ? (
                      <img src={imagen.vistaPrevia} alt={imagen.nombre} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 w-full items-center justify-center text-slate-400">
                        <Icono nombre="clip" tamano={20} />
                      </div>
                    )}
                    <p className="truncate px-2 py-1 text-[11px] text-slate-600" title={imagen.nombre}>
                      {imagen.nombre} · {enKb(imagen.tamano)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setImagenes((previas) => previas.filter((otra) => otra.ruta !== imagen.ruta))}
                      aria-label={`Sacar ${imagen.nombre}`}
                      title="Sacar esta captura"
                      className={cx(
                        'absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full',
                        'bg-slate-900/70 text-white transition-colors hover:bg-red-600',
                      )}
                    >
                      <Icono nombre="cerrar" tamano={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <Alerta tono="error">{error}</Alerta>}
        </div>
      )}
    </Dialogo>
  )
}

function enKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
