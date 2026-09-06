// Una burbuja del hilo: el texto, los archivos y el tilde.
//
// Los tildes son los de siempre y significan exactamente lo que parecen:
//   reloj   todavía no salió de esta computadora (sin internet, o subiendo los archivos)
//   ✓       el servidor lo tiene
//   ✓✓      la computadora del otro lo bajó          ← confirmación de llegada
//   ✓✓ azul el otro abrió la conversación y lo vio    ← confirmación de lectura
// En un grupo vale el que MENOS avanzó: el doble tilde en color quiere decir «lo vieron todos», que
// es lo que la gente entiende. Pasando el mouse por encima se ve quién y a qué hora.
//
// Los archivos, según lo que sean:
//   foto            se ve la miniatura, y al tocarla se abre con el programa del sistema
//   GIF             se pide el archivo entero y se ve moverse (la miniatura es el primer cuadro, quieto)
//   video, audio    ficha con el nombre y el peso, y un botón para abrirlo
//   PDF y lo demás  lo mismo
// Un video no se dibuja adentro de la burbuja a propósito: para eso habría que mandar el archivo
// entero al renderer y un mp4 de 40 MB son 53 MB de texto cruzando el puente, con la ventana
// congelada mientras tanto.
import { useEffect, useState } from 'react'
import type { AdjuntoDeMensaje, MensajeInterno } from '../../../shared/tipos'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { esSoloEmojis } from './emojis'

/** El peso de un archivo escrito como lo diría una persona. */
function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function horaDe(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * El ícono de un archivo, con los que el programa ya tiene. No hay uno de «foto» ni uno de «video»
 * propios: la foto se dibuja sola (se ve la miniatura) y para el video alcanza el de reproducir.
 */
function iconoDelArchivo(tipo: string): NombreIcono {
  if (tipo.startsWith('image/')) return 'cuadricula'
  if (tipo.startsWith('video/')) return 'detener'
  if (tipo.startsWith('audio/')) return 'altavoz'
  return 'carpeta'
}

function comoSeLlamaElTipo(tipo: string): string {
  if (tipo.startsWith('image/')) return 'Imagen'
  if (tipo.startsWith('video/')) return 'Video'
  if (tipo.startsWith('audio/')) return 'Audio'
  if (tipo === 'application/pdf') return 'PDF'
  return 'Archivo'
}

/**
 * Un GIF se pide entero para que se mueva. Se pide UNA vez por adjunto y sólo si está en el servidor:
 * pedirlo antes daría el error de «todavía no subió» cada vez que se dibuja la burbuja.
 */
function useGifAnimado(adjunto: AdjuntoDeMensaje): string | null {
  const [contenido, setContenido] = useState<string | null>(null)
  useEffect(() => {
    if (adjunto.tipo !== 'image/gif') return
    if (!adjunto.descargado && !adjunto.enElServidor) return
    let vivo = true
    void window.dm.mensajes.contenidoDeAdjunto(adjunto.id).then((resultado) => {
      // Si no se pudo (es enorme, o el servidor no lo tiene todavía), se queda la miniatura quieta.
      if (vivo && resultado.ok) setContenido(resultado.datos)
    })
    return () => {
      vivo = false
    }
  }, [adjunto.id, adjunto.tipo, adjunto.descargado, adjunto.enElServidor])
  return contenido
}

function Adjunto({ adjunto, mio }: { adjunto: AdjuntoDeMensaje; mio: boolean }) {
  const gif = useGifAnimado(adjunto)
  const abrir = () => void window.dm.mensajes.abrirAdjunto(adjunto.id)
  const esFoto = adjunto.tipo.startsWith('image/')

  const estado = adjunto.error
    ? adjunto.error
    : adjunto.enOtraComputadora
      ? 'Se está subiendo desde la otra computadora'
      : !adjunto.enElServidor && !adjunto.descargado
        ? 'Subiendo…'
        : null

  if (esFoto && (gif || adjunto.miniatura)) {
    return (
      <button
        type="button"
        onClick={abrir}
        title={`${adjunto.nombre} · ${pesoLegible(adjunto.tamano)}`}
        className="block overflow-hidden rounded-lg border border-slate-200 transition-opacity hover:opacity-90"
      >
        <img
          src={gif ?? adjunto.miniatura ?? ''}
          alt={adjunto.nombre}
          className="max-h-64 max-w-full object-contain"
        />
        {estado && (
          <span className={cx('block px-2 py-1 text-left text-xs', mio ? 'text-marino-100' : 'text-slate-500')}>{estado}</span>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={abrir}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
        mio ? 'border-white/25 hover:bg-white/10' : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <span className={cx('shrink-0', mio ? 'text-white' : 'text-slate-500')}>
        <Icono nombre={iconoDelArchivo(adjunto.tipo)} tamano={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm font-medium', mio ? 'text-white' : 'text-slate-800')}>{adjunto.nombre}</span>
        <span className={cx('block text-xs', mio ? 'text-marino-100' : 'text-slate-500')}>
          {comoSeLlamaElTipo(adjunto.tipo)} · {pesoLegible(adjunto.tamano)}
          {estado ? ` · ${estado}` : ''}
        </span>
      </span>
    </button>
  )
}

/** El tilde, con el detalle de quién y cuándo en el título. */
function Tilde({ mensaje }: { mensaje: MensajeInterno }) {
  if (mensaje.estado === 'fallado') {
    return (
      <span className="inline-flex items-center gap-1 text-red-600" title={mensaje.error ?? 'No se pudo mandar'}>
        <Icono nombre="alerta" tamano={13} />
      </span>
    )
  }
  if (mensaje.estado === 'enCola') {
    return (
      <span className="inline-flex items-center text-marino-100" title="Esperando para salir de esta computadora">
        <Icono nombre="reloj" tamano={13} />
      </span>
    )
  }

  const detalle = mensaje.acuses.length
    ? mensaje.acuses
        .map((acuse) =>
          acuse.leidoEn
            ? `${acuse.nombre}: leído ${horaDe(acuse.leidoEn)}`
            : acuse.entregadoEn
              ? `${acuse.nombre}: entregado ${horaDe(acuse.entregadoEn)}`
              : `${acuse.nombre}: sin entregar`,
        )
        .join('\n')
    : 'En el servidor'

  const dobleTilde = mensaje.estado === 'entregado' || mensaje.estado === 'leido'
  return (
    <span
      className={cx('inline-flex items-center', mensaje.estado === 'leido' ? 'text-sky-100' : 'text-marino-100')}
      title={detalle}
    >
      <Icono nombre="ok" tamano={13} />
      {dobleTilde && (
        <span className="-ml-2">
          <Icono nombre="ok" tamano={13} />
        </span>
      )}
    </span>
  )
}

interface Props {
  mensaje: MensajeInterno
  /** En un grupo se muestra quién lo dijo; en una conversación de a dos, no hace falta. */
  mostrarAutor: boolean
  alBorrar: (mensajeId: number) => void
  alReintentar: (mensajeId: number) => void
}

export function Burbuja({ mensaje, mostrarAutor, alBorrar, alReintentar }: Props) {
  const mio = mensaje.mio
  const soloEmojis = !mensaje.eliminadoEn && !mensaje.adjuntos.length && esSoloEmojis(mensaje.cuerpo)

  return (
    <div className={cx('group flex w-full', mio ? 'justify-end' : 'justify-start')}>
      <div className={cx('flex max-w-[min(34rem,80%)] flex-col gap-1', mio && 'items-end')}>
        {mostrarAutor && !mio && (
          <span className="px-1 text-xs font-semibold text-marino-700">{mensaje.autorNombre}</span>
        )}

        <div
          className={cx(
            'rounded-2xl px-3 py-2 shadow-sm',
            mio ? 'bg-marino-700 text-white' : 'bg-white text-slate-800 border border-slate-200',
            mensaje.eliminadoEn && 'italic opacity-70',
          )}
        >
          {mensaje.adjuntos.length > 0 && (
            <div className="mb-1.5 flex flex-col gap-1.5">
              {mensaje.adjuntos.map((adjunto) => (
                <Adjunto key={adjunto.id} adjunto={adjunto} mio={mio} />
              ))}
            </div>
          )}

          {mensaje.eliminadoEn ? (
            <p className="text-sm">Se eliminó este mensaje</p>
          ) : mensaje.cuerpo ? (
            // `whitespace-pre-wrap` conserva los renglones que escribió la persona; `break-words`
            // evita que una URL larga estire la burbuja hasta el otro lado de la pantalla.
            <p className={cx('whitespace-pre-wrap break-words', soloEmojis ? 'text-4xl leading-tight' : 'text-sm')}>
              {mensaje.cuerpo}
            </p>
          ) : null}

          <div className={cx('mt-1 flex items-center justify-end gap-1.5 text-xs', mio ? 'text-marino-100' : 'text-slate-400')}>
            <span className="tabular-nums">{horaDe(mensaje.creadoEn)}</span>
            {mio && <Tilde mensaje={mensaje} />}
          </div>
        </div>

        {/* Las acciones aparecen al pasar el mouse: un chat lleno de botones no se lee. */}
        {mio && !mensaje.eliminadoEn && (
          <div className="flex items-center gap-2 px-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {mensaje.estado === 'fallado' && (
              <button
                type="button"
                onClick={() => alReintentar(mensaje.id)}
                className="text-xs font-semibold text-marino-700 hover:underline"
              >
                Volver a intentar
              </button>
            )}
            <button type="button" onClick={() => alBorrar(mensaje.id)} className="text-xs text-slate-500 hover:text-red-700">
              Borrar
            </button>
          </div>
        )}

        {mensaje.estado === 'fallado' && mensaje.error && (
          <p className="max-w-full px-1 text-xs text-red-700">{mensaje.error}</p>
        )}
      </div>
    </div>
  )
}
