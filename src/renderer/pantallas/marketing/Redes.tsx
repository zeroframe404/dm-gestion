// Marketing → Redes: publicar en la Página de Facebook e Instagram de una sucursal.
//
// La pantalla abre SIEMPRE, incluso sin nada configurado: si falta la app de Meta o si todavía no se
// vinculó ninguna cuenta, lo explica y dice a quién pedírselo. Un empleado no entra a Administración,
// así que mandarlo ahí sería mandarlo a una puerta cerrada.
//
// Cada sucursal tiene su propia cuenta. Un ADMIN o EMPLEADO publica siempre en la suya, sin elegir; un
// SUPER_ADMIN puede elegir cualquiera, incluida una que todavía no tenga nada vinculado.
//
// Cuatro bloques, en el orden en que se usan: la sucursal (si hay para elegir), la cuenta, el posteo,
// y lo que ya se publicó.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_DESTINO,
  type ArchivoParaPublicar,
  type DestinoDePublicacion,
  type PaginaParaElegir,
  type PanelDeRedes,
  type PublicacionDeRed,
  type TipoDeContenido,
} from '../../../shared/tipos'
import { SUCURSALES } from '../../../shared/sucursales'
import { AvisoLimitacionMeta } from '../../componentes/AvisoLimitacionMeta'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Etiqueta, Selector, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { Comentarios } from './Comentarios'
import { Mensajes } from './Mensajes'

const NOMBRE_TIPO_DE_CONTENIDO: Record<TipoDeContenido, string> = { FEED: 'Feed', REEL: 'Reel', STORIA: 'Historia' }

type PestanaDeRedes = 'publicar' | 'comentarios' | 'mensajes'

const PESTANAS_DE_REDES: ItemDePestana<PestanaDeRedes>[] = [
  { id: 'publicar', nombre: 'Publicar', icono: 'subir', ayuda: 'marketing.redes' },
  { id: 'comentarios', nombre: 'Comentarios', icono: 'mensaje', ayuda: 'marketing.redes.comentarios' },
  { id: 'mensajes', nombre: 'Mensajes', icono: 'usuario', ayuda: 'marketing.redes.mensajes' },
]

function cuando(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function Redes() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('marketing')
  const [pestana, setPestana] = useState<PestanaDeRedes>('publicar')

  const [panel, setPanel] = useState<PanelDeRedes | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  // Un SUPER_ADMIN elige la sucursal; el resto siempre publica en la propia.
  const [sucursalElegida, setSucursalElegida] = useState<string>(usuario.sucursal.nombre)
  const esSuper = usuario.rol === 'SUPER_ADMIN'

  const [historial, setHistorial] = useState<PublicacionDeRed[]>([])
  const [cuotaInstagram, setCuotaInstagram] = useState<number | null>(null)
  const [paginas, setPaginas] = useState<PaginaParaElegir[]>([])
  const [destino, setDestino] = useState<DestinoDePublicacion>('FACEBOOK')
  const [tipoDeContenido, setTipoDeContenidoState] = useState<TipoDeContenido>('FEED')
  const [texto, setTexto] = useState('')
  const [archivo, setArchivo] = useState<ArchivoParaPublicar | null>(null)
  const [programarActivado, setProgramarActivado] = useState(false)
  const [programarPara, setProgramarPara] = useState('')

  // Una historia no se puede programar: al elegirla, se apaga sola la programación si estaba activada.
  const setTipoDeContenido = (tipo: TipoDeContenido) => {
    setTipoDeContenidoState(tipo)
    if (tipo === 'STORIA') {
      setProgramarActivado(false)
      setProgramarPara('')
    }
  }

  const cargarPanel = useCallback(async () => {
    const resultado = await window.dm.redes.panel()
    if (resultado.ok) {
      setPanel(resultado.datos)
      if (esSuper && !resultado.datos.sucursalPropia) {
        setSucursalElegida((actual) => actual || SUCURSALES[0])
      }
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [esSuper])

  useEffect(() => {
    void cargarPanel()
  }, [cargarPanel])

  const cuentaActual = panel?.cuentas.find((cuenta) => cuenta.sucursal === sucursalElegida) ?? null
  const vinculada = cuentaActual?.estado === 'ACTIVA'
  const puedeInstagram = Boolean(cuentaActual?.puedePublicarEnInstagram)

  const cargarHistorial = useCallback(async () => {
    const resultado = await window.dm.redes.publicaciones(sucursalElegida)
    if (resultado.ok) setHistorial(resultado.datos)
  }, [sucursalElegida])

  useEffect(() => {
    void cargarHistorial()
  }, [cargarHistorial])

  useEffect(() => {
    if (!vinculada || !puedeInstagram) {
      setCuotaInstagram(null)
      return
    }
    void window.dm.redes.cuotaInstagram(sucursalElegida).then((resultado) => {
      if (resultado.ok) setCuotaInstagram(resultado.datos)
    })
  }, [sucursalElegida, vinculada, puedeInstagram])

  const correr = async (que: string, accion: () => Promise<void>) => {
    setOcupado(que)
    setError(null)
    setAviso(null)
    await accion()
    setOcupado(null)
  }

  const vincular = () =>
    correr('vincular', async () => {
      const resultado = await window.dm.redes.vincular(sucursalElegida)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      // Con una sola Página se vinculó sola; con varias hay que elegir.
      if (resultado.datos.vinculada) setAviso(`Quedó vinculada la página «${resultado.datos.vinculada.paginaNombre}» para ${sucursalElegida}.`)
      else setPaginas(resultado.datos.paginas)
      await cargarPanel()
    })

  const elegirPagina = (paginaId: string) =>
    correr('elegir', async () => {
      const resultado = await window.dm.redes.elegirPagina(paginaId)
      setPaginas([])
      if (resultado.ok) {
        setPanel(resultado.datos)
        setAviso('Cuenta vinculada.')
      } else {
        setError(resultado.error)
      }
    })

  const desvincular = () =>
    correr('desvincular', async () => {
      const resultado = await window.dm.redes.desvincular(sucursalElegida)
      if (resultado.ok) {
        setPanel(resultado.datos)
        setAviso('Se desvinculó la cuenta. Nada de lo publicado se borra.')
      } else {
        setError(resultado.error)
      }
    })

  const elegirArchivo = () =>
    correr('archivo', async () => {
      const resultado = await window.dm.redes.elegirArchivo()
      if (resultado.ok) {
        if (resultado.datos) setArchivo(resultado.datos)
      } else {
        setError(resultado.error)
      }
    })

  const publicar = () =>
    correr('publicar', async () => {
      const programarParaIso = programarActivado && programarPara ? new Date(programarPara).toISOString() : ''
      const resultado = await window.dm.redes.publicar({
        sucursal: sucursalElegida,
        destino,
        tipoDeContenido,
        texto,
        ruta: archivo?.ruta ?? '',
        programarPara: programarParaIso,
      })
      if (resultado.ok) {
        setPanel(resultado.datos)
        setTexto('')
        setArchivo(null)
        setProgramarActivado(false)
        setProgramarPara('')
        setAviso(programarParaIso ? `Se programó para ${NOMBRE_DESTINO[destino]}.` : `Publicado en ${NOMBRE_DESTINO[destino]}.`)
        await cargarHistorial()
      } else {
        setError(resultado.error)
      }
    })

  if (cargando) return <Cargando />
  if (!panel) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const instagramApagado = destino === 'INSTAGRAM' && !puedeInstagram
  const necesitaArchivo = tipoDeContenido !== 'FEED' || destino === 'INSTAGRAM'
  const archivoInvalido = Boolean(
    archivo &&
      ((tipoDeContenido === 'REEL' && archivo.tipoDeArchivo !== 'VIDEO') ||
        (destino === 'INSTAGRAM' && tipoDeContenido === 'FEED' && archivo.tipoDeArchivo === 'VIDEO') ||
        (destino === 'FACEBOOK' && tipoDeContenido === 'STORIA' && archivo.tipoDeArchivo === 'VIDEO')),
  )
  const fechaProgramacionInvalida = programarActivado && (!programarPara || new Date(programarPara).getTime() <= Date.now())
  const tieneContenido = necesitaArchivo ? archivo !== null : texto.trim().length > 0 || archivo !== null
  const puedePublicar =
    vinculada && puedeEditar && !instagramApagado && !archivoInvalido && !fechaProgramacionInvalida && tieneContenido

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {esSuper && (
        <div className="mx-auto w-full max-w-4xl px-8 pt-8">
          <Tarjeta titulo="Sucursal" descripcion="Cada sucursal tiene su propia cuenta de Facebook e Instagram. Elegí con cuál trabajar.">
            <Selector
              etiqueta="Sucursal"
              value={sucursalElegida}
              onChange={(evento) => setSucursalElegida(evento.target.value)}
              opciones={SUCURSALES.map((nombre) => ({ valor: nombre, texto: nombre }))}
            />
          </Tarjeta>
        </div>
      )}

      <BarraDePestanas etiqueta="Secciones de Redes" prefijo="redes" items={PESTANAS_DE_REDES} activa={pestana} alElegir={setPestana} />

      <div id={`panel-redes-${pestana}`} role="tabpanel" aria-labelledby={`tab-redes-${pestana}`} className="min-h-0 flex-1 overflow-y-auto">
        {pestana === 'comentarios' ? (
          <Comentarios sucursal={sucursalElegida} puedeEditar={puedeEditar} />
        ) : pestana === 'mensajes' ? (
          <Mensajes sucursal={sucursalElegida} puedeEditar={puedeEditar} />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}
          {/* Sin la app cargada, el aviso de la tarjeta de abajo ya dice qué falta: un segundo cartel
              con el último error de Meta o del VPS sería ruido sobre una pantalla que no puede hacer nada. */}
          {panel.ultimoError && !error && panel.appConfigurada && <Alerta tono="aviso">{panel.ultimoError}</Alerta>}

          {/* --- La cuenta ------------------------------------------------------ */}
          <Tarjeta
            titulo={`La cuenta de ${sucursalElegida}`}
            descripcion="Publicar acá sale en nombre de la Página de Facebook de esa sucursal y de su Instagram."
            acciones={
              panel.puedeVincular && (
                <>
                  {vinculada && (
                    <Boton onClick={() => void desvincular()} cargando={ocupado === 'desvincular'}>
                      Desvincular
                    </Boton>
                  )}
                  <Boton
                    variante="primario"
                    icono="facebook"
                    onClick={() => void vincular()}
                    cargando={ocupado === 'vincular'}
                    disabled={!panel.appConfigurada}
                  >
                    {vinculada ? 'Volver a vincular' : 'Vincular cuenta'}
                  </Boton>
                </>
              )
            }
          >
            <div className="flex flex-col gap-3">
              {!panel.appConfigurada && (
                <Alerta tono="aviso">
                  Todavía no está cargada la app de Meta en esta computadora, así que no se puede vincular ninguna cuenta.{' '}
                  {panel.puedeVincular
                    ? 'Se carga en Administración → Redes sociales, con el App ID y el App Secret de developers.facebook.com.'
                    : 'Pedile a un superadministrador que la cargue en Administración → Redes sociales.'}
                </Alerta>
              )}
              {cuentaActual?.estado === 'TOKEN_RECHAZADO' && (
                <Alerta tono="error">
                  Se cortó la conexión con Meta: Facebook cambió o retiró el permiso de esta cuenta. Un superadministrador tiene que
                  volver a vincularla.
                </Alerta>
              )}

              {vinculada ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-marino-700 text-white">
                    <Icono nombre="facebook" tamano={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{cuentaActual.paginaNombre}</p>
                    <p className="truncate text-xs text-slate-500">
                      {puedeInstagram ? `Instagram @${cuentaActual.instagramUsuario}` : 'Sin Instagram vinculado'}
                      {cuentaActual.vinculadoPor ? ` · vinculó ${cuentaActual.vinculadoPor}` : ''}
                      {cuentaActual.vinculadoEn ? ` el ${cuando(cuentaActual.vinculadoEn)}` : ''}
                    </p>
                  </div>
                  {cuotaInstagram !== null && (
                    <span className="ml-auto text-xs text-slate-500">Instagram: quedan {cuotaInstagram} publicación(es) hoy</span>
                  )}
                </div>
              ) : (
                panel.appConfigurada && (
                  <p className="text-sm leading-relaxed text-slate-600">
                    Todavía no hay ninguna cuenta vinculada para {sucursalElegida}.{' '}
                    {panel.puedeVincular
                      ? 'Al tocar «Vincular cuenta» se abre el ingreso de Facebook; después se elige cuál de las páginas se va a usar.'
                      : 'Pedile a un superadministrador que vincule la cuenta de esta sucursal.'}
                  </p>
                )
              )}

              {vinculada && !puedeInstagram && (
                <p className="text-xs leading-relaxed text-slate-500">
                  Para publicar en Instagram, esa cuenta tiene que ser <strong>Business</strong> y estar vinculada a la página de
                  Facebook. Se hace desde la configuración de la página, en Facebook.
                </p>
              )}
            </div>
          </Tarjeta>

          {/* --- El posteo ------------------------------------------------------ */}
          <Tarjeta
            titulo="Publicar"
            descripcion="Se publica de a uno, con el archivo y el texto que elijas: foto o video en el Feed, siempre video en un Reel, foto o video en una Historia."
            acciones={
              <Boton variante="primario" icono="subir" onClick={() => void publicar()} cargando={ocupado === 'publicar'} disabled={!puedePublicar}>
                {programarActivado ? `Programar en ${NOMBRE_DESTINO[destino]}` : `Publicar en ${NOMBRE_DESTINO[destino]}`}
              </Boton>
            }
          >
            <div className="flex flex-col gap-4">
              {/* Dónde. Dos botones grandes en vez de un desplegable: es la decisión que no se puede
                  deshacer una vez publicada, y tiene que estar a la vista, no adentro de una lista. */}
              <div className="grid gap-3 sm:grid-cols-2">
                {(['FACEBOOK', 'INSTAGRAM'] as DestinoDePublicacion[]).map((candidato) => {
                  const apagado = candidato === 'INSTAGRAM' && !puedeInstagram
                  return (
                    <button
                      key={candidato}
                      type="button"
                      onClick={() => setDestino(candidato)}
                      disabled={apagado || !vinculada}
                      aria-pressed={destino === candidato}
                      className={cx(
                        'flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        destino === candidato && !apagado
                          ? 'border-marino-600 bg-marino-50 text-marino-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                      )}
                    >
                      <Icono nombre={candidato === 'FACEBOOK' ? 'facebook' : 'instagram'} tamano={22} />
                      <span>
                        <span className="block font-semibold">{NOMBRE_DESTINO[candidato]}</span>
                        <span className="block text-xs text-slate-500">
                          {candidato === 'FACEBOOK'
                            ? 'En la página. Acepta texto solo, foto o video.'
                            : apagado
                              ? 'No hay una cuenta de Instagram Business vinculada.'
                              : 'Siempre con una foto o un video: Instagram no publica texto solo.'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Qué tipo de contenido: cambia qué archivo hace falta y si se puede programar. */}
              <div className="grid gap-3 sm:grid-cols-3">
                {(['FEED', 'REEL', 'STORIA'] as TipoDeContenido[]).map((candidato) => (
                  <button
                    key={candidato}
                    type="button"
                    onClick={() => setTipoDeContenido(candidato)}
                    disabled={!vinculada}
                    aria-pressed={tipoDeContenido === candidato}
                    className={cx(
                      'rounded-xl border-2 px-4 py-3 text-left transition-colors',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      tipoDeContenido === candidato
                        ? 'border-marino-600 bg-marino-50 text-marino-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                    )}
                  >
                    <span className="block font-semibold">{NOMBRE_TIPO_DE_CONTENIDO[candidato]}</span>
                    <span className="block text-xs text-slate-500">
                      {candidato === 'FEED' && 'En el muro, con el resto de las publicaciones.'}
                      {candidato === 'REEL' && 'Siempre un video.'}
                      {candidato === 'STORIA' && 'Foto o video, 24 horas. No se puede programar.'}
                    </span>
                  </button>
                ))}
              </div>

              {/* El archivo, con vista previa cuando es una foto: un posteo equivocado en una red social
                  no se puede deshacer sin que alguien lo haya visto. Un video no tiene miniatura. */}
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex flex-col gap-2">
                  <Boton icono="clip" onClick={() => void elegirArchivo()} cargando={ocupado === 'archivo'} disabled={!vinculada || !puedeEditar}>
                    {archivo ? 'Cambiar el archivo' : 'Elegir una foto o un video'}
                  </Boton>
                  {archivo && (
                    <Boton variante="fantasma" tamano="sm" icono="cerrar" onClick={() => setArchivo(null)}>
                      Sacarlo
                    </Boton>
                  )}
                </div>
                {archivo && (
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {archivo.tipoDeArchivo === 'FOTO' ? (
                      <img src={archivo.vistaPrevia} alt="" className="h-24 w-24 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                        <Icono nombre="subir" tamano={28} />
                      </span>
                    )}
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-semibold text-slate-800">{archivo.nombre}</p>
                      <p className="text-slate-500">{(archivo.bytes / 1024 / 1024).toFixed(1)} MB</p>
                      {archivo.avisoDeInstagram && <p className="mt-1 text-amber-700">{archivo.avisoDeInstagram}</p>}
                    </div>
                  </div>
                )}
                {archivoInvalido && (
                  <p className="text-xs text-red-700">
                    {tipoDeContenido === 'REEL' && 'Un Reel es siempre un video: para una foto, elegí Feed.'}
                    {destino === 'INSTAGRAM' &&
                      tipoDeContenido === 'FEED' &&
                      'Instagram no publica video en el Feed: elegí Reel o Historia.'}
                    {destino === 'FACEBOOK' && tipoDeContenido === 'STORIA' && 'Facebook no publica video en Historias desde acá.'}
                  </p>
                )}
              </div>

              <AreaTexto
                etiqueta="Texto de la publicación"
                rows={4}
                value={texto}
                disabled={!vinculada || !puedeEditar}
                onChange={(evento) => setTexto(evento.target.value)}
                ayuda={
                  tipoDeContenido === 'STORIA' ? 'Las historias no llevan texto: se guarda como referencia, pero no sale en Meta.' : `${texto.length} de 2.200 caracteres.`
                }
              />

              {/* Programar: sólo Feed y Reel. Una historia se publica siempre al momento. */}
              {tipoDeContenido === 'STORIA' ? (
                <AvisoLimitacionMeta motivo="Las historias no se pueden programar." />
              ) : (
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
                    />
                  )}
                </div>
              )}

              {!puedeEditar && <Alerta tono="aviso">Tenés Marketing en sólo lectura: podés mirar lo publicado pero no publicar.</Alerta>}
            </div>
          </Tarjeta>

          {/* --- El historial --------------------------------------------------- */}
          <Tarjeta titulo="Lo que se publicó" descripcion={`Las últimas publicaciones de ${sucursalElegida}, incluidas las que fallaron y por qué.`} alRas>
            {historial.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Todavía no se publicó nada en esta sucursal.</p>
            ) : (
              <ul>
                {historial.map((publicacion) => (
                  <li key={publicacion.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                    <span
                      className={cx(
                        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        publicacion.estado === 'PUBLICADA'
                          ? 'bg-slate-100 text-slate-600'
                          : publicacion.estado === 'PROGRAMADA'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-600',
                      )}
                    >
                      <Icono nombre={publicacion.destino === 'FACEBOOK' ? 'facebook' : 'instagram'} tamano={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-900">{NOMBRE_DESTINO[publicacion.destino]}</span>
                        <Etiqueta tono="neutro">{NOMBRE_TIPO_DE_CONTENIDO[publicacion.tipoDeContenido]}</Etiqueta>
                        {publicacion.estado === 'FALLIDA' ? (
                          <Etiqueta tono="peligro">No salió</Etiqueta>
                        ) : publicacion.estado === 'PROGRAMADA' ? (
                          <Etiqueta tono="aviso">Programada para {cuando(publicacion.programadoPara ?? publicacion.creadoEn)}</Etiqueta>
                        ) : (
                          <Etiqueta tono="exito">Publicada</Etiqueta>
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

          {/* Cuando la persona administra más de una página hay que preguntar cuál. */}
          <Dialogo
            abierto={paginas.length > 0}
            titulo="¿En qué página se publica?"
            descripcion="Estas son las páginas que administra la cuenta con la que ingresaste. La elegida es la que va a usar el programa."
            alCerrar={() => setPaginas([])}
            ancho="md"
            pie={<Boton onClick={() => setPaginas([])}>Cancelar</Boton>}
          >
            <ul className="flex flex-col gap-2">
              {paginas.map((pagina) => (
                <li key={pagina.id}>
                  <button
                    type="button"
                    onClick={() => void elegirPagina(pagina.id)}
                    disabled={ocupado === 'elegir'}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-marino-300 hover:bg-marino-50 disabled:opacity-60"
                  >
                    <Icono nombre="facebook" tamano={18} className="shrink-0 text-marino-700" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900">{pagina.nombre}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {pagina.instagramUsuario ? `Instagram @${pagina.instagramUsuario}` : 'Sin Instagram vinculado'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Dialogo>
          </div>
        )}
      </div>
    </div>
  )
}
