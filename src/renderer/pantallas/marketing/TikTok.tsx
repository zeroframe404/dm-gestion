// Marketing → Redes → TikTok: publicar videos en la cuenta de TikTok de una sucursal.
//
// Igual que la pestaña de Facebook e Instagram, abre SIEMPRE: si falta la app de TikTok de la sucursal
// o la cuenta, lo dice y dice a quién pedírselo.
//
// El formulario sigue las reglas que TikTok exige para publicar desde una app externa (si no, la app
// no pasa la revisión): se muestra con qué cuenta se publica, la privacidad la elige la persona (sin
// valor por defecto y sólo entre las que TikTok permite HOY a esa cuenta), comentarios, dúo y stitch
// arrancan apagados y se respetan si la cuenta los tiene bloqueados, el contenido comercial se declara
// a mano, y antes de publicar se avisa de la Confirmación de uso de música de TikTok.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_PRIVACIDAD_DE_TIKTOK,
  type ArchivoParaPublicar,
  type CreadorDeTikTok,
  type PanelDeTikTok,
  type PrivacidadDeTikTok,
  type PublicacionDeTikTok,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, cx } from '../../componentes/ui'

const URL_USO_DE_MUSICA = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
const URL_CONTENIDO_DE_MARCA = 'https://www.tiktok.com/legal/page/global/bc-policy/en'

/** Mientras haya algo en camino se mira la lista cada tanto: TikTok confirma minutos después. */
const REFRESCO_DEL_HISTORIAL_MS = 15_000

function cuando(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function minutos(segundos: number): string {
  return segundos % 60 === 0 ? `${segundos / 60} min` : `${Math.floor(segundos / 60)} min ${segundos % 60} s`
}

function Interruptor({
  etiqueta,
  ayuda,
  checked,
  disabled,
  onChange,
}: {
  etiqueta: string
  ayuda?: string
  checked: boolean
  disabled?: boolean
  onChange: (valor: boolean) => void
}) {
  return (
    <label className={cx('flex items-start gap-2 text-sm', disabled ? 'text-slate-400' : 'text-slate-700')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(evento) => onChange(evento.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span>
        <span className="font-medium">{etiqueta}</span>
        {ayuda && <span className="block text-xs text-slate-500">{ayuda}</span>}
      </span>
    </label>
  )
}

export function TikTok({ sucursal, puedeEditar }: { sucursal: string; puedeEditar: boolean }) {
  const [panel, setPanel] = useState<PanelDeTikTok | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const [creador, setCreador] = useState<CreadorDeTikTok | null>(null)
  const [creadorError, setCreadorError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<PublicacionDeTikTok[]>([])

  const [archivo, setArchivo] = useState<ArchivoParaPublicar | null>(null)
  const [texto, setTexto] = useState('')
  const [privacidad, setPrivacidad] = useState<PrivacidadDeTikTok | ''>('')
  const [permitirComentarios, setPermitirComentarios] = useState(false)
  const [permitirDuo, setPermitirDuo] = useState(false)
  const [permitirStitch, setPermitirStitch] = useState(false)
  const [esComercial, setEsComercial] = useState(false)
  const [contenidoPropio, setContenidoPropio] = useState(false)
  const [contenidoDeMarca, setContenidoDeMarca] = useState(false)
  const [programarActivado, setProgramarActivado] = useState(false)
  const [programarPara, setProgramarPara] = useState('')

  const cargarPanel = useCallback(async () => {
    const resultado = await window.dm.tiktok.panel()
    if (resultado.ok) setPanel(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargarPanel()
  }, [cargarPanel])

  const cuenta = panel?.cuentas.find((candidata) => candidata.sucursal === sucursal) ?? null
  const vinculada = cuenta?.estado === 'ACTIVA'

  const cargarHistorial = useCallback(async () => {
    const resultado = await window.dm.tiktok.publicaciones(sucursal)
    if (resultado.ok) setHistorial(resultado.datos)
  }, [sucursal])

  useEffect(() => {
    void cargarHistorial()
  }, [cargarHistorial])

  // Lo que TikTok deja hacer hoy: se pregunta cada vez que se abre la cuenta (TikTok lo pide así).
  useEffect(() => {
    setCreador(null)
    setCreadorError(null)
    setPrivacidad('')
    if (!vinculada) return
    let vigente = true
    void window.dm.tiktok.creador(sucursal).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setCreador(resultado.datos)
      else setCreadorError(resultado.error)
    })
    return () => {
      vigente = false
    }
  }, [sucursal, vinculada])

  // Mientras haya algo programado para ya, subiéndose o procesándose, la lista se refresca sola.
  const hayEnCamino = historial.some(
    (publicacion) =>
      publicacion.estado === 'ENVIANDO' ||
      publicacion.estado === 'PROCESANDO' ||
      (publicacion.estado === 'PROGRAMADA' && new Date(publicacion.programadoPara ?? publicacion.creadoEn).getTime() <= Date.now() + REFRESCO_DEL_HISTORIAL_MS),
  )
  useEffect(() => {
    if (!hayEnCamino) return
    const reloj = setInterval(() => void cargarHistorial(), REFRESCO_DEL_HISTORIAL_MS)
    return () => clearInterval(reloj)
  }, [hayEnCamino, cargarHistorial])

  const correr = async (que: string, accion: () => Promise<void>) => {
    setOcupado(que)
    setError(null)
    setAviso(null)
    await accion()
    setOcupado(null)
  }

  const vincular = () =>
    correr('vincular', async () => {
      const resultado = await window.dm.tiktok.vincular(sucursal)
      if (resultado.ok) {
        setPanel(resultado.datos)
        setAviso(`Quedó vinculada la cuenta de TikTok de ${sucursal}.`)
      } else {
        setError(resultado.error)
      }
    })

  const desvincular = () =>
    correr('desvincular', async () => {
      const resultado = await window.dm.tiktok.desvincular(sucursal)
      if (resultado.ok) {
        setPanel(resultado.datos)
        setAviso('Se desvinculó la cuenta de TikTok. Nada de lo publicado se borra.')
      } else {
        setError(resultado.error)
      }
    })

  const elegirVideo = () =>
    correr('archivo', async () => {
      const resultado = await window.dm.tiktok.elegirVideo()
      if (resultado.ok) {
        if (resultado.datos) setArchivo(resultado.datos)
      } else {
        setError(resultado.error)
      }
    })

  const limpiarFormulario = () => {
    setArchivo(null)
    setTexto('')
    setPrivacidad('')
    setPermitirComentarios(false)
    setPermitirDuo(false)
    setPermitirStitch(false)
    setEsComercial(false)
    setContenidoPropio(false)
    setContenidoDeMarca(false)
    setProgramarActivado(false)
    setProgramarPara('')
  }

  const publicar = () =>
    correr('publicar', async () => {
      const programarParaIso = programarActivado && programarPara ? new Date(programarPara).toISOString() : ''
      const resultado = await window.dm.tiktok.publicar({
        sucursal,
        texto,
        ruta: archivo?.ruta ?? '',
        privacidad,
        permitirComentarios: permitirComentarios && !creador?.comentariosApagados,
        permitirDuo: permitirDuo && !creador?.duoApagado,
        permitirStitch: permitirStitch && !creador?.stitchApagado,
        contenidoPropio: esComercial && contenidoPropio,
        contenidoDeMarca: esComercial && contenidoDeMarca,
        programarPara: programarParaIso,
      })
      if (resultado.ok) {
        limpiarFormulario()
        setAviso(
          programarParaIso
            ? `Se programó para el ${cuando(programarParaIso)}. El servidor lo sube a TikTok a esa hora.`
            : 'Se mandó a TikTok. TikTok tarda unos minutos en procesar el video: la lista de abajo se actualiza sola.',
        )
        await cargarHistorial()
      } else {
        setError(resultado.error)
      }
    })

  if (cargando) return <Cargando />
  if (!panel) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const opcionesDePrivacidad = creador?.opcionesDePrivacidad ?? []
  const soloPrivado = opcionesDePrivacidad.length === 1 && opcionesDePrivacidad[0] === 'SELF_ONLY'
  const marcaEnPrivado = esComercial && contenidoDeMarca && privacidad === 'SELF_ONLY'
  const comercialIncompleto = esComercial && !contenidoPropio && !contenidoDeMarca
  const fechaProgramacionInvalida = programarActivado && (!programarPara || new Date(programarPara).getTime() <= Date.now())
  const puedePublicar =
    vinculada &&
    puedeEditar &&
    creador !== null &&
    archivo?.tipoDeArchivo === 'VIDEO' &&
    privacidad !== '' &&
    !marcaEnPrivado &&
    !comercialIncompleto &&
    !fechaProgramacionInvalida &&
    texto.length <= 2_200

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {panel.ultimoError && !error && cuenta?.appCargada && <Alerta tono="aviso">{panel.ultimoError}</Alerta>}

      {/* --- La cuenta ------------------------------------------------------ */}
      <Tarjeta
        titulo={`El TikTok de ${sucursal}`}
        descripcion="Publicar acá sale en nombre de la cuenta de TikTok de esa sucursal."
        acciones={
          panel.puedeVincular && (
            <>
              {vinculada && (
                <Boton onClick={() => void desvincular()} cargando={ocupado === 'desvincular'}>
                  Desvincular
                </Boton>
              )}
              <Boton variante="primario" icono="tiktok" onClick={() => void vincular()} cargando={ocupado === 'vincular'} disabled={!cuenta?.appCargada}>
                {vinculada ? 'Volver a vincular' : 'Vincular TikTok'}
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {!cuenta?.appCargada && (
            <Alerta tono="aviso">
              Todavía no está cargada la app de TikTok de {sucursal}, así que no se puede vincular la cuenta.{' '}
              {panel.puedeVincular
                ? 'Se carga en Administración → Redes sociales → TikTok, con el Client Key y el Client Secret de developers.tiktok.com.'
                : 'Pedile a un superadministrador que la cargue en Administración → Redes sociales.'}
            </Alerta>
          )}
          {cuenta?.estado === 'TOKEN_RECHAZADO' && (
            <Alerta tono="error">
              Se cortó la conexión con TikTok: la cuenta le sacó el permiso a la app o el permiso venció. Un superadministrador tiene que volver a
              vincularla.
            </Alerta>
          )}

          {vinculada ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              {creador?.avatarUrl ? (
                <img src={creador.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white">
                  <Icono nombre="tiktok" tamano={17} />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{creador?.nombre || cuenta.nombre || 'Cuenta de TikTok'}</p>
                <p className="truncate text-xs text-slate-500">
                  {creador?.usuario || cuenta.usuario ? `@${creador?.usuario || cuenta.usuario}` : ''}
                  {cuenta.vinculadoPor ? ` · vinculó ${cuenta.vinculadoPor}` : ''}
                  {cuenta.vinculadoEn ? ` el ${cuando(cuenta.vinculadoEn)}` : ''}
                </p>
              </div>
            </div>
          ) : (
            cuenta?.appCargada && (
              <p className="text-sm leading-relaxed text-slate-600">
                Todavía no hay ninguna cuenta de TikTok vinculada para {sucursal}.{' '}
                {panel.puedeVincular
                  ? 'Al tocar «Vincular TikTok» se abre el ingreso de TikTok: hay que entrar con la cuenta de la sucursal y aceptar los permisos.'
                  : 'Pedile a un superadministrador que la vincule.'}
              </p>
            )
          )}
          {creadorError && <Alerta tono="aviso">No se pudo consultar la cuenta en TikTok: {creadorError}</Alerta>}
          {soloPrivado && (
            <Alerta tono="info">
              La app de TikTok de esta sucursal todavía no pasó la revisión de TikTok: hasta entonces todo lo que se publique sale en privado
              («Sólo yo»). Después se puede cambiar la privacidad desde la app de TikTok.
            </Alerta>
          )}
        </div>
      </Tarjeta>

      {/* --- El posteo ------------------------------------------------------ */}
      <Tarjeta
        titulo="Publicar en TikTok"
        descripcion="Siempre un video (.mp4 o .mov, hasta 40 MB). TikTok lo procesa de su lado: puede tardar unos minutos en aparecer."
        acciones={
          <Boton variante="primario" icono="subir" onClick={() => void publicar()} cargando={ocupado === 'publicar'} disabled={!puedePublicar}>
            {programarActivado ? 'Programar en TikTok' : 'Publicar en TikTok'}
          </Boton>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-2">
              <Boton icono="clip" onClick={() => void elegirVideo()} cargando={ocupado === 'archivo'} disabled={!vinculada || !puedeEditar}>
                {archivo ? 'Cambiar el video' : 'Elegir un video'}
              </Boton>
              {archivo && (
                <Boton variante="fantasma" tamano="sm" icono="cerrar" onClick={() => setArchivo(null)}>
                  Sacarlo
                </Boton>
              )}
            </div>
            {archivo && (
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <Icono nombre="tiktok" tamano={24} />
                </span>
                <div className="min-w-0 text-xs">
                  <p className="truncate font-semibold text-slate-800">{archivo.nombre}</p>
                  <p className="text-slate-500">{(archivo.bytes / 1024 / 1024).toFixed(1)} MB</p>
                  {archivo.tipoDeArchivo !== 'VIDEO' && <p className="mt-1 text-red-700">TikTok publica sólo video desde el programa.</p>}
                  {creador?.duracionMaximaSegundos && (
                    <p className="mt-1 text-slate-500">Esta cuenta admite videos de hasta {minutos(creador.duracionMaximaSegundos)}.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <AreaTexto
            etiqueta="Texto del video"
            rows={4}
            value={texto}
            disabled={!vinculada || !puedeEditar}
            onChange={(evento) => setTexto(evento.target.value)}
            error={texto.length > 2_200 ? 'El máximo son 2.200 caracteres.' : null}
            ayuda={`${texto.length} de 2.200 caracteres. Los #hashtags y las @menciones van en el mismo texto.`}
          />

          {/* La privacidad: sin valor por defecto, y sólo las que TikTok le permite hoy a esta cuenta. */}
          <Selector
            etiqueta="¿Quién puede ver este video?"
            value={privacidad}
            disabled={!vinculada || !puedeEditar || !creador}
            onChange={(evento) => setPrivacidad(evento.target.value as PrivacidadDeTikTok | '')}
            opciones={[
              { valor: '', texto: creador ? 'Elegí quién puede verlo…' : 'Consultando a TikTok…' },
              ...opcionesDePrivacidad.map((opcion) => ({ valor: opcion, texto: NOMBRE_PRIVACIDAD_DE_TIKTOK[opcion] })),
            ]}
            error={marcaEnPrivado ? 'Un contenido de marca no puede ir en privado: elegí otra privacidad.' : null}
          />

          {/* Interacciones: arrancan apagadas (TikTok lo pide así) y se bloquean si la cuenta las tiene apagadas. */}
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Permitir que los usuarios…</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Interruptor
                etiqueta="Comenten"
                ayuda={creador?.comentariosApagados ? 'Apagado en la configuración de la cuenta.' : undefined}
                checked={permitirComentarios && !creador?.comentariosApagados}
                disabled={!vinculada || !puedeEditar || !creador || creador.comentariosApagados}
                onChange={setPermitirComentarios}
              />
              <Interruptor
                etiqueta="Hagan un dúo"
                ayuda={creador?.duoApagado ? 'Apagado en la configuración de la cuenta.' : undefined}
                checked={permitirDuo && !creador?.duoApagado}
                disabled={!vinculada || !puedeEditar || !creador || creador.duoApagado}
                onChange={setPermitirDuo}
              />
              <Interruptor
                etiqueta="Hagan un stitch"
                ayuda={creador?.stitchApagado ? 'Apagado en la configuración de la cuenta.' : undefined}
                checked={permitirStitch && !creador?.stitchApagado}
                disabled={!vinculada || !puedeEditar || !creador || creador.stitchApagado}
                onChange={setPermitirStitch}
              />
            </div>
          </div>

          {/* Contenido comercial: lo declara la persona, como en la app de TikTok. */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Interruptor
              etiqueta="Es contenido comercial"
              ayuda="Marcalo si el video promociona a la agencia, un producto o a un tercero."
              checked={esComercial}
              disabled={!vinculada || !puedeEditar}
              onChange={setEsComercial}
            />
            {esComercial && (
              <div className="ml-6 flex flex-col gap-2">
                <Interruptor
                  etiqueta="Tu marca"
                  ayuda="Promociona a la agencia o algo propio. TikTok lo etiqueta como «Contenido promocional»."
                  checked={contenidoPropio}
                  disabled={!puedeEditar}
                  onChange={setContenidoPropio}
                />
                <Interruptor
                  etiqueta="Contenido de marca"
                  ayuda="Es una colaboración paga con un tercero (por ejemplo, una compañía de seguros). TikTok lo etiqueta como «Colaboración pagada» y no deja publicarlo en privado."
                  checked={contenidoDeMarca}
                  disabled={!puedeEditar}
                  onChange={setContenidoDeMarca}
                />
                {comercialIncompleto && <p className="text-xs text-red-700">Elegí al menos una de las dos opciones, o desmarcá «Es contenido comercial».</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={programarActivado}
                disabled={!vinculada || !puedeEditar}
                onChange={(evento) => setProgramarActivado(evento.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Programar para más adelante, en vez de publicar ahora
            </label>
            {programarActivado && (
              <Campo
                etiqueta="Fecha y hora"
                type="datetime-local"
                value={programarPara}
                onChange={(evento) => setProgramarPara(evento.target.value)}
                disabled={!vinculada || !puedeEditar}
                error={fechaProgramacionInvalida ? 'Elegí una fecha y hora futura.' : null}
                ayuda="TikTok no programa: el video queda guardado en el servidor y sale solo a esa hora (hasta dos meses para adelante)."
              />
            )}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            Al publicar, aceptás la{' '}
            <button type="button" className="font-semibold text-marino-700 hover:underline" onClick={() => void window.dm.sistema.abrirEnlace(URL_USO_DE_MUSICA)}>
              Confirmación de uso de música
            </button>
            {esComercial && contenidoDeMarca && (
              <>
                {' '}
                y la{' '}
                <button type="button" className="font-semibold text-marino-700 hover:underline" onClick={() => void window.dm.sistema.abrirEnlace(URL_CONTENIDO_DE_MARCA)}>
                  Política de contenido de marca
                </button>
              </>
            )}{' '}
            de TikTok.
          </p>

          {!puedeEditar && <Alerta tono="aviso">Tenés Marketing en sólo lectura: podés mirar lo publicado pero no publicar.</Alerta>}
        </div>
      </Tarjeta>

      {/* --- El historial --------------------------------------------------- */}
      <Tarjeta titulo="Lo que se mandó a TikTok" descripcion={`Los últimos videos de ${sucursal}, incluidos los que fallaron y por qué.`} alRas>
        {historial.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Todavía no se publicó nada en TikTok desde esta sucursal.</p>
        ) : (
          <ul>
            {historial.map((publicacion) => (
              <li key={publicacion.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <span
                  className={cx(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    publicacion.estado === 'PUBLICADA'
                      ? 'bg-slate-100 text-slate-600'
                      : publicacion.estado === 'FALLIDA'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-amber-50 text-amber-700',
                  )}
                >
                  <Icono nombre="tiktok" tamano={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate font-semibold text-slate-900">{publicacion.archivoNombre}</span>
                    <Etiqueta tono="neutro">{NOMBRE_PRIVACIDAD_DE_TIKTOK[publicacion.privacidad]}</Etiqueta>
                    {publicacion.estado === 'FALLIDA' ? (
                      <Etiqueta tono="peligro">No salió</Etiqueta>
                    ) : publicacion.estado === 'PUBLICADA' ? (
                      <Etiqueta tono="exito">Publicada</Etiqueta>
                    ) : publicacion.estado === 'PROGRAMADA' && publicacion.programadoPara ? (
                      <Etiqueta tono="aviso">Programada para {cuando(publicacion.programadoPara)}</Etiqueta>
                    ) : publicacion.estado === 'PROCESANDO' ? (
                      <Etiqueta tono="aviso">TikTok la está procesando</Etiqueta>
                    ) : (
                      <Etiqueta tono="aviso">Subiendo a TikTok</Etiqueta>
                    )}
                    {publicacion.url && (
                      <button
                        type="button"
                        onClick={() => void window.dm.sistema.abrirEnlace(publicacion.url!)}
                        className="text-xs font-semibold text-marino-700 hover:underline"
                      >
                        Verla
                      </button>
                    )}
                  </p>
                  {publicacion.texto && <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{publicacion.texto}</p>}
                  {publicacion.error && <p className="mt-0.5 text-xs text-red-700">{publicacion.error}</p>}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {cuando(publicacion.publicadoEn ?? publicacion.creadoEn)} · {publicacion.creadoPor}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
