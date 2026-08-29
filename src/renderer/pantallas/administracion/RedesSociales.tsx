// Administración → Redes sociales: la app de Meta con la que el programa publica.
//
// Es una credencial, así que vive donde viven las credenciales: en config.json de esta computadora,
// nunca en la base ni en la hoja. Mismo criterio que la cuenta de servicio de Google.
//
// Lo que más falla no es el código: es la dirección de redirección. Tiene que estar escrita EXACTA en
// developers.facebook.com, y si no, Facebook rechaza el ingreso con un error que no explica nada. Por
// eso la pantalla la muestra grande y con un botón para copiarla.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeMeta } from '../../../shared/tipos'
import { Alerta, Boton, Campo, CampoClave, Cargando, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'

export function RedesSociales() {
  const puedeEditar = usePuedeEditar('administracion')
  const [estado, setEstado] = useState<EstadoDeMeta | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.redes.estadoMeta()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAppId(resultado.datos.appId)
    } else {
      setError(resultado.error)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.redes.guardarMeta({ appId, appSecret })
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      // La clave no se vuelve a mostrar: se guardó y no tiene por qué quedar en pantalla.
      setAppSecret('')
      setAviso('Listo. Ahora se puede vincular la cuenta desde Marketing → Redes.')
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.redes.borrarMeta()
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAppId('')
      setAppSecret('')
      setAviso('Se sacó la app de Meta de esta computadora.')
    } else {
      setError(resultado.error)
    }
  }

  const copiarUrl = async () => {
    if (!estado) return
    try {
      await navigator.clipboard.writeText(estado.urlDeRedireccion)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1_500)
    } catch {
      /* sin portapapeles queda a la vista para copiarla a mano */
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="App de Meta (Facebook e Instagram)"
        descripcion="Con esto el programa puede publicar en la página de Facebook de la agencia y en su Instagram. Se crea una vez en developers.facebook.com y se carga acá, en cada computadora que vaya a publicar."
        acciones={
          puedeEditar && (
            <>
              {estado.configurada && (
                <Boton icono="basura" onClick={() => void borrar()} disabled={guardando}>
                  Sacarla
                </Boton>
              )}
              <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!appId.trim()}>
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {estado.configurada ? (
            <Alerta tono="exito">
              La app está cargada. Ya se puede vincular la cuenta desde Marketing → Redes.
              {estado.actualizadoEn ? ` Se cargó el ${new Date(estado.actualizadoEn).toLocaleDateString('es-AR')}.` : ''}
            </Alerta>
          ) : (
            <Alerta tono="aviso">Todavía no está cargada: sin esto, la pestaña Redes de Marketing no puede vincular nada.</Alerta>
          )}

          <Campo
            etiqueta="App ID"
            value={appId}
            onChange={(evento) => setAppId(evento.target.value)}
            disabled={!puedeEditar}
            className="tabular-nums"
            ayuda="El número que figura arriba de todo en el panel de la app, en developers.facebook.com."
            autoComplete="off"
          />
          <CampoClave
            etiqueta="App Secret"
            value={appSecret}
            onChange={(evento) => setAppSecret(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurada ? '•••••••• (dejalo vacío para no cambiarla)' : ''}
            ayuda="La clave secreta de la app. Meta la muestra una sola vez: si se perdió, hay que generar otra."
            autoComplete="off"
          />

          <Alerta tono="info">
            Las dos se guardan sólo en esta computadora, en <code className="font-mono text-xs">{estado.rutaDeConfig}</code>. No
            viajan a la hoja, ni a la base compartida, ni a las otras sucursales.
          </Alerta>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="La dirección de vuelta"
        descripcion="Es lo que más falla al configurar la app. Tiene que estar escrita EXACTAMENTE así en el panel de Meta, en «Facebook Login → Configuración → URI de redireccionamiento de OAuth válidos». Si no coincide, Facebook rechaza el ingreso con un error que no explica nada."
      >
        <div className="flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
            {estado.urlDeRedireccion}
          </code>
          <Boton icono={copiado ? 'ok' : 'clip'} onClick={() => void copiarUrl()}>
            {copiado ? 'Copiada' : 'Copiar'}
          </Boton>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          El programa nunca abre esa dirección: atrapa el intento y lo cancela. No hace falta que la página exista.
        </p>
      </Tarjeta>

      <Tarjeta titulo="Antes de que funcione" descripcion="Tres cosas que Meta exige y que no dependen del programa.">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong className="font-semibold">La app tiene que salir de modo Desarrollo</strong> para que la use cualquiera. Mientras
            esté en Desarrollo funciona sólo para las personas dadas de alta como Administrador, Desarrollador o Tester en
            developers.facebook.com. Es el motivo número uno de «no aparece ninguna página».
          </li>
          <li>
            <strong className="font-semibold">Los permisos de publicación piden Revisión de la app</strong> y verificación del
            negocio: son <code className="font-mono text-xs">pages_manage_posts</code> e{' '}
            <code className="font-mono text-xs">instagram_content_publish</code>, entre otros.
          </li>
          <li>
            <strong className="font-semibold">Instagram tiene que ser una cuenta Business</strong> vinculada a la página de
            Facebook. Una cuenta personal no se puede publicar por API, sin importar la configuración de la app.
          </li>
        </ul>
      </Tarjeta>
    </div>
  )
}
