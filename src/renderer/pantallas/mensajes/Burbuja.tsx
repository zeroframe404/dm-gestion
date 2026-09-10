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
//
// Las reacciones (14.0) son las de WhatsApp y se dibujan en dos piezas: la BARRA para poner una, en la
// fila de acciones que aparece al pasar el mouse, y la PASTILLA con las que ya hay, colgada debajo de la
// burbuja. Tres cosas que no son obvias:
//   1. La fila de acciones ahora está también en los mensajes AJENOS, que es justamente donde uno
//      reacciona. En los propios sigue estando «Borrar», que es de uno solo.
//   2. Cada persona tiene UNA reacción por mensaje: tocar la propia la saca, tocar otra la cambia. Esa
//      regla la manda el servidor (ver `reaccionarA` en `servicios/mensajeria.ts`); acá sólo se dibuja,
//      y por eso la pastilla se pinta con lo que contestó el servidor y nunca con una cuenta local.
//   3. Reaccionar NO pasa por la cola —igual que el zumbido—, así que sin canal en vivo no se puede: el
//      botón queda apagado y el `title` dice por qué, como cada botón que guarda.
//
// El zumbido y la llamada no se dibujan como burbuja: ver `Zumbido` y `Llamada`, más abajo.
import { useEffect, useState } from 'react'
import type { AdjuntoDeMensaje, MensajeInterno, ReaccionDeMensaje } from '../../../shared/tipos'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { useConexion } from '../../contexto/Conexion'
import { EMOJIS_RAPIDOS, esSoloEmojis } from './emojis'
import { SelectorDeEmojis } from './SelectorDeEmojis'

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

/**
 * Lo que se lee al pasar el mouse por la barra de reacciones cuando no hay canal en vivo.
 *
 * Es la versión de `SIN_CANAL_NO_SE_GUARDA` (`componentes/ui.tsx`) para esto: una reacción no espera en
 * la cola como un mensaje —se manda en el momento o no se manda—, así que sin conexión no hay «después»
 * que ofrecer. Mismo criterio que el zumbido.
 */
const SIN_CANAL_NO_SE_REACCIONA =
  'Sin conexión no se puede reaccionar: la reacción no espera en la cola, se manda en el momento. ' +
  'Volvé a intentar cuando vuelva internet.'

/**
 * Por qué no se puede reaccionar ahora mismo, o null si se puede.
 *
 * El orden es el de las barreras de verdad, para que el cartel no mienta: primero el permiso (lo pide
 * `exigirEdicion('mensajes')` en `ipc.ts`), después el canal (lo corta `permisos.ts exigir`) y al final
 * lo que rechaza el servicio. Un mensaje que todavía está en la cola no tiene id remoto: el servidor no
 * sabe de él, y `reaccionarA` lo dice con esas mismas palabras.
 */
function motivoParaNoReaccionar(mensaje: MensajeInterno, puedeEscribir: boolean, hayCanal: boolean): string | null {
  if (!puedeEscribir) return 'No tenés permiso para escribir mensajes'
  if (!hayCanal) return SIN_CANAL_NO_SE_REACCIONA
  if (mensaje.estado === 'enCola' || mensaje.estado === 'fallado') {
    return 'Todavía no salió de esta computadora: esperá a que se mande'
  }
  return null
}

/** Quiénes reaccionaron con ese emoji, para el globito de la pastilla. */
function quienesReaccionaron(reaccion: ReaccionDeMensaje): string {
  const nombres = reaccion.nombres.join(', ')
  // Que la propia se saca tocándola no se adivina mirando: se dice donde la persona va a mirar.
  return reaccion.mia ? `${nombres} · tocá para sacar la tuya` : nombres
}

/**
 * La barra para poner una reacción: los seis de siempre y el cajón entero atrás del «más».
 *
 * Va INLINE en la fila de acciones y no en un globo flotante pegado a la burbuja: el hilo es un
 * `overflow-y-auto`, y lo que se dibuja `absolute` sobre un mensaje de arriba se corta contra el borde.
 * Inline la fila empuja y se ve completa esté donde esté el mensaje.
 *
 * Al elegir se cierra sola, y con ella se cierra el cajón —que vive adentro—: una reacción es UNA, no se
 * ponen tres seguidas como los emojis de la caja de escribir.
 */
function BarraDeReacciones({
  puesta,
  motivo,
  lado,
  abierta,
  setAbierta,
  alElegir,
}: {
  /** El emoji que esta persona ya tiene puesto en este mensaje, para marcarlo en la barra. */
  puesta: string | null
  motivo: string | null
  lado: 'derecha' | 'izquierda'
  /** Abierta o cerrada la manda la burbuja: mientras está abierta, la fila de acciones no se desvanece. */
  abierta: boolean
  setAbierta: (abierta: boolean) => void
  alElegir: (emoji: string) => void
}) {
  if (!abierta || motivo) {
    return (
      <button
        type="button"
        disabled={motivo !== null}
        onClick={() => setAbierta(true)}
        title={motivo ?? 'Reaccionar con un emoji'}
        className="text-xs text-slate-500 transition-colors hover:text-marino-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-slate-500"
      >
        Reaccionar
      </button>
    )
  }

  const elegir = (emoji: string) => {
    setAbierta(false)
    alElegir(emoji)
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1 py-0.5 shadow-sm">
      {EMOJIS_RAPIDOS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => elegir(emoji)}
          title={puesta === emoji ? 'Ya la tenés puesta: tocala para sacarla' : `Reaccionar con ${emoji}`}
          className={cx(
            'rounded-full px-1 py-0.5 text-base leading-none transition-colors hover:bg-slate-100',
            puesta === emoji && 'bg-marino-50',
          )}
        >
          {emoji}
        </button>
      ))}
      <SelectorDeEmojis
        alElegir={elegir}
        cara={<Icono nombre="mas" tamano={14} />}
        etiqueta="Reaccionar con otro emoji"
        tamano="sm"
        lado={lado}
      />
      <button
        type="button"
        onClick={() => setAbierta(false)}
        aria-label="Cerrar"
        title="Cerrar"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <Icono nombre="cerrar" tamano={12} />
      </button>
    </div>
  )
}

/**
 * Las reacciones que ya tiene el mensaje: cada emoji con su cuenta, y resaltada la propia.
 *
 * Tocar la propia la saca (manda `null`) y tocar otra la cambia: es un interruptor, porque cada persona
 * tiene una sola reacción por mensaje. La cuenta se muestra siempre, también cuando es uno: «👍» solo no
 * dice si reaccionó una persona o cinco, y en un grupo de cinco eso es justo lo que se quiere saber.
 */
function PastillaDeReacciones({
  reacciones,
  motivo,
  alReaccionar,
}: {
  reacciones: ReaccionDeMensaje[]
  motivo: string | null
  alReaccionar: (emoji: string | null) => void
}) {
  if (!reacciones.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 px-1">
      {reacciones.map((reaccion) => (
        <button
          key={reaccion.emoji}
          type="button"
          disabled={motivo !== null}
          // Apagada sigue diciendo QUIÉN reaccionó: es lo que la pastilla contesta, y no poder tocarla
          // no es razón para esconderlo. El motivo se suma atrás, no en lugar de los nombres.
          title={motivo ? `${quienesReaccionaron(reaccion)} · ${motivo}` : quienesReaccionaron(reaccion)}
          onClick={() => alReaccionar(reaccion.mia ? null : reaccion.emoji)}
          className={cx(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 leading-none transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent',
            reaccion.mia
              ? 'border-marino-300 bg-marino-50 text-marino-800'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          <span className="text-sm leading-none">{reaccion.emoji}</span>
          <span className="text-xs font-semibold tabular-nums">{reaccion.claves.length}</span>
        </button>
      ))}
    </div>
  )
}

interface Props {
  mensaje: MensajeInterno
  /** En un grupo se muestra quién lo dijo; en una conversación de a dos, no hace falta. */
  mostrarAutor: boolean
  /**
   * Si esta persona tiene permiso de editar en «mensajes» (14.0). Lo usan las reacciones: reaccionar es
   * escribir, y sin el permiso la barra queda apagada diciéndolo. Borrar no lo mira porque ya está
   * limitado a los mensajes propios.
   */
  puedeEscribir: boolean
  alBorrar: (mensajeId: number) => void
  alReintentar: (mensajeId: number) => void
  /** Pone (un emoji), cambia (otro) o saca (null) MI reacción. Ver `reaccionarA` en el proceso principal. */
  alReaccionar: (mensajeId: number, emoji: string | null) => void
}

/**
 * El zumbido en el hilo. No es una burbuja: va centrado, chico y sin tilde, como el «X salió del
 * grupo» de cualquier chat. Es a propósito —un zumbido no es algo que se dijo, es algo que se hizo—, y
 * además queda escrito: en un mes, «me zumbaste tres veces» se puede mirar en vez de discutir.
 */
function Zumbido({ mensaje }: { mensaje: MensajeInterno }) {
  return (
    <div className="flex w-full justify-center py-1">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-900">
        <Icono nombre="altavoz" tamano={13} />
        <span className="font-semibold">
          {mensaje.mio ? 'Mandaste un zumbido' : `${mensaje.autorNombre} te mandó un zumbido`}
        </span>
        <span className="tabular-nums text-amber-700">{horaDe(mensaje.creadoEn)}</span>
      </span>
    </div>
  )
}

/**
 * La llamada de voz en el hilo (14.0). Igual que el zumbido y por el mismo motivo: no es algo que se
 * dijo, es algo que se hizo, así que va centrada y chica en vez de en una burbuja.
 *
 * El texto lo escribe el SERVIDOR cuando la llamada termina («Llamada de voz · 3:12», «Llamada
 * perdida») y acá se muestra tal cual: la duración y el motivo los sabe él, que es el único que vio
 * los dos lados. Esta pantalla no interpreta ese texto ni lo vuelve a armar; si mañana el servidor
 * agrega un motivo nuevo, aparece solo.
 */
function Llamada({ mensaje }: { mensaje: MensajeInterno }) {
  return (
    <div className="flex w-full justify-center py-1">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-900">
        <Icono nombre="telefono" tamano={13} />
        <span className="font-semibold">{mensaje.cuerpo || 'Llamada de voz'}</span>
        <span className="tabular-nums text-emerald-700">{horaDe(mensaje.creadoEn)}</span>
      </span>
    </div>
  )
}

export function Burbuja({ mensaje, mostrarAutor, puedeEscribir, alBorrar, alReintentar, alReaccionar }: Props) {
  // Los hooks van ANTES del zumbido y de la llamada a propósito: llamarlos después de un `return` los
  // volvería condicionales, y React cuenta los hooks por orden. Ni un zumbido ni una llamada llevan
  // reacciones, así que el valor se descarta.
  const { puedeEscribir: hayCanal } = useConexion()
  const [barraAbierta, setBarraAbierta] = useState(false)
  if (mensaje.tipo === 'ZUMBIDO' && !mensaje.eliminadoEn) return <Zumbido mensaje={mensaje} />
  if (mensaje.tipo === 'LLAMADA' && !mensaje.eliminadoEn) return <Llamada mensaje={mensaje} />

  const mio = mensaje.mio
  const soloEmojis = !mensaje.eliminadoEn && !mensaje.adjuntos.length && esSoloEmojis(mensaje.cuerpo)
  const motivoDeLaReaccion = motivoParaNoReaccionar(mensaje, puedeEscribir, hayCanal)
  // La que tiene puesta esta persona, para marcarla en la barra. Es una sola, por definición.
  const miReaccion = mensaje.reacciones.find((reaccion) => reaccion.mia)?.emoji ?? null

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

        {/* Las que ya están, colgadas de la burbuja y del lado que le toca a cada uno. */}
        {!mensaje.eliminadoEn && (
          <PastillaDeReacciones
            reacciones={mensaje.reacciones}
            motivo={motivoDeLaReaccion}
            alReaccionar={(emoji) => alReaccionar(mensaje.id, emoji)}
          />
        )}

        {/* Las acciones aparecen al pasar el mouse: un chat lleno de botones no se lee. Desde la 14.0
            están también en los mensajes ajenos, que es donde uno reacciona; «Borrar» sigue siendo de
            los propios. Con la barra de emojis abierta la fila queda fija: elegir un emoji obliga a
            mover el mouse, y una fila que se desvanece en el camino no se puede usar. */}
        {!mensaje.eliminadoEn && (
          <div
            className={cx(
              'flex items-center gap-2 px-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
              // `&& !motivo`: si el canal se cae con la barra abierta, la barra vuelve a ser el botón
              // apagado y la fila tiene que volver a esconderse como cualquier otra.
              barraAbierta && !motivoDeLaReaccion ? 'opacity-100' : 'opacity-0',
            )}
          >
            <BarraDeReacciones
              puesta={miReaccion}
              motivo={motivoDeLaReaccion}
              lado={mio ? 'derecha' : 'izquierda'}
              abierta={barraAbierta}
              setAbierta={setBarraAbierta}
              alElegir={(emoji) => alReaccionar(mensaje.id, emoji)}
            />
            {mio && mensaje.estado === 'fallado' && (
              <button
                type="button"
                onClick={() => alReintentar(mensaje.id)}
                className="text-xs font-semibold text-marino-700 hover:underline"
              >
                Volver a intentar
              </button>
            )}
            {mio && (
              <button type="button" onClick={() => alBorrar(mensaje.id)} className="text-xs text-slate-500 hover:text-red-700">
                Borrar
              </button>
            )}
          </div>
        )}

        {mensaje.estado === 'fallado' && mensaje.error && (
          <p className="max-w-full px-1 text-xs text-red-700">{mensaje.error}</p>
        )}
      </div>
    </div>
  )
}
