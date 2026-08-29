// Marketing → Redes: publicar en la Página de Facebook de la agencia y en su Instagram.
//
// La pantalla abre SIEMPRE, incluso sin nada configurado: si falta la app de Meta o si todavía no se
// vinculó ninguna cuenta, lo explica y dice a quién pedírselo. Un empleado no entra a Administración,
// así que mandarlo ahí sería mandarlo a una puerta cerrada.
//
// Tres bloques, en el orden en que se usan: el estado de la cuenta, el posteo, y lo que ya se publicó.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_DESTINO,
  type ArchivoParaPublicar,
  type DestinoDePublicacion,
  type PaginaParaElegir,
  type PanelDeRedes,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Cargando, Dialogo, Etiqueta, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

function cuando(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function Redes() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('marketing')
  const esAdministrador = usuario.rol !== 'EMPLEADO'

  const [panel, setPanel] = useState<PanelDeRedes | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const [paginas, setPaginas] = useState<PaginaParaElegir[]>([])
  const [destino, setDestino] = useState<DestinoDePublicacion>('FACEBOOK')
  const [texto, setTexto] = useState('')
  const [archivo, setArchivo] = useState<ArchivoParaPublicar | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.redes.panel()
    if (resultado.ok) setPanel(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const correr = async (que: string, accion: () => Promise<void>) => {
    setOcupado(que)
    setError(null)
    setAviso(null)
    await accion()
    setOcupado(null)
  }

  const vincular = () =>
    correr('vincular', async () => {
      const resultado = await window.dm.redes.vincular()
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      // Con una sola Página se vinculó sola; con varias hay que elegir.
      if (resultado.datos.vinculada) setAviso(`Quedó vinculada la página «${resultado.datos.vinculada.paginaNombre}».`)
      else setPaginas(resultado.datos.paginas)
      await cargar()
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
      const resultado = await window.dm.redes.desvincular()
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
      const resultado = await window.dm.redes.publicar({ destino, texto, ruta: archivo?.ruta ?? '' })
      if (resultado.ok) {
        setPanel(resultado.datos)
        setTexto('')
        setArchivo(null)
        setAviso(`Publicado en ${NOMBRE_DESTINO[destino]}.`)
      } else {
        setError(resultado.error)
      }
    })

  if (cargando) return <Cargando />
  if (!panel) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const vinculada = panel.vinculo !== null
  const instagramApagado = destino === 'INSTAGRAM' && !panel.puedePublicarEnInstagram
  const puedePublicar = vinculada && puedeEditar && !instagramApagado && (texto.trim().length > 0 || archivo !== null)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {panel.ultimoError && !error && <Alerta tono="aviso">{panel.ultimoError}</Alerta>}

      {/* --- La cuenta ------------------------------------------------------ */}
      <Tarjeta
        titulo="La cuenta de la agencia"
        descripcion="Publicar acá sale en nombre de la Página de Facebook de la agencia y de su Instagram. Se vincula una vez por computadora."
        acciones={
          esAdministrador &&
          puedeEditar && (
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
                disabled={!panel.appConfigurada || !panel.puedeGuardar}
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
              {esAdministrador
                ? 'Se carga en Administración → Redes sociales, con el App ID y el App Secret de developers.facebook.com.'
                : 'Pedile a un administrador que la cargue en Administración → Redes sociales.'}
            </Alerta>
          )}
          {panel.appConfigurada && !panel.puedeGuardar && (
            <Alerta tono="error">
              Windows no puede cifrar en esta computadora, así que el permiso de Facebook no se podría guardar de forma segura. Sin
              eso no se vincula: sería dejar la cuenta de la agencia escrita en un archivo.
            </Alerta>
          )}

          {vinculada ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-marino-700 text-white">
                <Icono nombre="facebook" tamano={17} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{panel.vinculo?.paginaNombre}</p>
                <p className="truncate text-xs text-slate-500">
                  {panel.puedePublicarEnInstagram ? `Instagram @${panel.vinculo?.instagramUsuario}` : 'Sin Instagram vinculado'}
                  {panel.vinculo?.vinculadoPor ? ` · vinculó ${panel.vinculo.vinculadoPor}` : ''}
                  {panel.vinculo?.vinculadoEn ? ` el ${cuando(panel.vinculo.vinculadoEn)}` : ''}
                </p>
              </div>
              {panel.cuotaDeInstagram !== null && (
                <span className="ml-auto text-xs text-slate-500">
                  Instagram: quedan {panel.cuotaDeInstagram} publicación(es) hoy
                </span>
              )}
            </div>
          ) : (
            panel.appConfigurada && (
              <p className="text-sm leading-relaxed text-slate-600">
                Todavía no hay ninguna cuenta vinculada.{' '}
                {esAdministrador
                  ? 'Al tocar «Vincular cuenta» se abre el ingreso de Facebook; después se elige cuál de las páginas de la agencia se va a usar.'
                  : 'Pedile a un administrador que vincule la cuenta de la agencia.'}
              </p>
            )
          )}

          {!panel.puedePublicarEnInstagram && vinculada && (
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
        descripcion="Se publica de a uno, con la foto y el texto que elijas. Por ahora sólo fotos: los videos y los reels necesitan otro camino."
        acciones={
          <Boton variante="primario" icono="subir" onClick={() => void publicar()} cargando={ocupado === 'publicar'} disabled={!puedePublicar}>
            Publicar en {NOMBRE_DESTINO[destino]}
          </Boton>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Dónde. Dos botones grandes en vez de un desplegable: es la decisión que no se puede
              deshacer una vez publicada, y tiene que estar a la vista, no adentro de una lista. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(['FACEBOOK', 'INSTAGRAM'] as DestinoDePublicacion[]).map((candidato) => {
              const apagado = candidato === 'INSTAGRAM' && !panel.puedePublicarEnInstagram
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
                        ? 'En la página. Acepta texto solo o texto con foto.'
                        : apagado
                          ? 'No hay una cuenta de Instagram Business vinculada.'
                          : 'Siempre con una foto: Instagram no publica texto solo.'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* La foto, con vista previa: un posteo equivocado en una red social no se puede deshacer
              sin que alguien lo haya visto. */}
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-2">
              <Boton icono="clip" onClick={() => void elegirArchivo()} cargando={ocupado === 'archivo'} disabled={!vinculada || !puedeEditar}>
                {archivo ? 'Cambiar la foto' : 'Elegir una foto'}
              </Boton>
              {archivo && (
                <Boton variante="fantasma" tamano="sm" icono="cerrar" onClick={() => setArchivo(null)}>
                  Sacarla
                </Boton>
              )}
            </div>
            {archivo && (
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <img src={archivo.vistaPrevia} alt="" className="h-24 w-24 rounded-lg object-cover" />
                <div className="min-w-0 text-xs">
                  <p className="truncate font-semibold text-slate-800">{archivo.nombre}</p>
                  <p className="text-slate-500">{(archivo.bytes / 1024).toFixed(0)} KB</p>
                  {archivo.avisoDeInstagram && <p className="mt-1 text-amber-700">{archivo.avisoDeInstagram}</p>}
                </div>
              </div>
            )}
          </div>

          <AreaTexto
            etiqueta="Texto de la publicación"
            rows={4}
            value={texto}
            disabled={!vinculada || !puedeEditar}
            onChange={(evento) => setTexto(evento.target.value)}
            ayuda={`${texto.length} de 2.200 caracteres.`}
          />

          {!puedeEditar && <Alerta tono="aviso">Tenés Marketing en sólo lectura: podés mirar lo publicado pero no publicar.</Alerta>}
        </div>
      </Tarjeta>

      {/* --- El historial --------------------------------------------------- */}
      <Tarjeta
        titulo="Lo que se publicó"
        descripcion="Las últimas publicaciones de esta computadora, incluidas las que fallaron y por qué."
        alRas
      >
        {panel.historial.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Todavía no se publicó nada desde el programa.</p>
        ) : (
          <ul>
            {panel.historial.map((publicacion) => (
              <li key={publicacion.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <span
                  className={cx(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    publicacion.estado === 'PUBLICADA' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-600',
                  )}
                >
                  <Icono nombre={publicacion.destino === 'FACEBOOK' ? 'facebook' : 'instagram'} tamano={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-900">{NOMBRE_DESTINO[publicacion.destino]}</span>
                    {publicacion.estado === 'FALLIDA' ? (
                      <Etiqueta tono="peligro">No salió</Etiqueta>
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
                    {cuando(publicacion.publicadoEn)} · {publicacion.publicadoPor}
                    {publicacion.archivo ? ` · ${publicacion.archivo}` : ''}
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
  )
}
