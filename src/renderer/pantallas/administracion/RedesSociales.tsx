// Administración → Redes sociales: la app de Meta con la que el programa publica.
//
// Es una credencial, así que vive donde viven las credenciales: cifrada en el servidor y en el
// config.json de cada computadora, nunca en la base ni en la hoja. Mismo criterio que la cuenta de
// servicio de Google, y desde la v12.4 también con el mismo camino: la carga el superadministrador una
// vez y el resto de las máquinas la adopta al arrancar.
//
// Lo que más falla no es el código: es la dirección de redirección. Tiene que estar escrita EXACTA en
// developers.facebook.com y ser la misma en las cinco computadoras, y si no, Facebook rechaza el
// ingreso con un error que no explica nada. Por eso la pantalla la muestra grande, con un botón para
// copiarla, y por eso viaja junto con la app.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeMeta, VinculoConMeta } from '../../../shared/tipos'
import { SUCURSALES } from '../../../shared/sucursales'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

export function RedesSociales() {
  // La carga sólo el superadministrador: lo que se guarda acá pisa la app de las otras computadoras.
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && usuario.rol === 'SUPER_ADMIN'
  const [estado, setEstado] = useState<EstadoDeMeta | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [urlDeVuelta, setUrlDeVuelta] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [cuentas, setCuentas] = useState<VinculoConMeta[] | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.redes.estadoMeta()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAppId(resultado.datos.appId)
      setUrlDeVuelta(resultado.datos.urlDeRedireccion)
    } else {
      setError(resultado.error)
    }
    // Sólo para mostrar el panorama: vincular o desvincular se hace desde Marketing → Redes, donde
    // ya está el contexto de «para qué sucursal» y el diálogo para elegir la página.
    const panel = await window.dm.redes.panel()
    if (panel.ok) setCuentas(panel.datos.cuentas)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.redes.guardarMeta({ appId, appSecret, urlDeRedireccion: urlDeVuelta.trim() })
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setUrlDeVuelta(resultado.datos.urlDeRedireccion)
      // La clave no se vuelve a mostrar: se guardó y no tiene por qué quedar en pantalla.
      setAppSecret('')
      setAviso(
        resultado.datos.compartido?.error
          ? 'La app se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo.'
          : 'Listo: la app quedó guardada y salió para el resto de las computadoras. Ahora se puede vincular la cuenta desde Marketing → Redes.',
      )
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
        descripcion="Con esto el programa puede publicar en la página de Facebook de la agencia y en su Instagram. Se crea una vez en developers.facebook.com y se carga una sola vez acá: el resto de las computadoras la adopta al abrir el programa."
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

          <EstadoCompartido
            estado={estado.compartido}
            nombre="la app de Meta"
            comoSeCarga="La carga el superadministrador una sola vez y el resto la adopta al abrir el programa."
          />

          <Alerta tono="info">
            El App Secret se guarda cifrado en el servidor y en{' '}
            <code className="font-mono text-xs">{estado.rutaDeConfig}</code> de cada computadora. No viaja a la hoja ni a la
            base de la cartera, y nunca vuelve a esta pantalla.
          </Alerta>

          {usuario.rol !== 'SUPER_ADMIN' && (
            <Alerta tono="info">
              La app de Meta la carga el superadministrador: es una sola para toda la agencia.
            </Alerta>
          )}
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Cuentas vinculadas por sucursal"
        descripcion="Cada sucursal tiene su propia Página de Facebook e Instagram. Se vinculan y se desvinculan desde Marketing → Redes, eligiendo ahí la sucursal; acá se ve el panorama de las cuatro."
      >
        {cuentas === null ? (
          <Cargando />
        ) : (
          <ul className="flex flex-col gap-2">
            {SUCURSALES.map((sucursal) => {
              const cuenta = cuentas.find((candidata) => candidata.sucursal === sucursal) ?? null
              const vinculada = cuenta?.estado === 'ACTIVA'
              return (
                <li
                  key={sucursal}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marino-700 text-white">
                    <Icono nombre="facebook" tamano={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{sucursal}</p>
                    <p className="truncate text-xs text-slate-500">
                      {vinculada
                        ? `${cuenta.paginaNombre}${cuenta.instagramUsuario ? ` · Instagram @${cuenta.instagramUsuario}` : ' · sin Instagram'}`
                        : cuenta?.estado === 'TOKEN_RECHAZADO'
                          ? 'Se cortó la conexión con Meta: hay que volver a vincular.'
                          : 'Sin vincular.'}
                    </p>
                  </div>
                  {vinculada && <Etiqueta tono="exito">Vinculada</Etiqueta>}
                  {cuenta?.estado === 'TOKEN_RECHAZADO' && <Etiqueta tono="peligro">Token rechazado</Etiqueta>}
                </li>
              )
            })}
          </ul>
        )}
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

        {/* Se puede cambiar porque el día que cambie el dominio de la agencia hay que poder corregirla
            sin publicar una versión nueva. Viaja con la app, así que las cinco computadoras usan la
            misma: con que una tenga otra, el login de Facebook falla ahí y en ningún otro lado. */}
        <div className="mt-4">
          <Campo
            etiqueta="Cambiar la dirección de vuelta"
            value={urlDeVuelta}
            onChange={(evento) => setUrlDeVuelta(evento.target.value)}
            disabled={!puedeEditar}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="https://dmartinezseguros.com/meta/vuelta"
            ayuda="Sólo si cambió el dominio de la agencia. Se guarda con el botón «Guardar» de la tarjeta de arriba y sale para todas las computadoras; vacía vuelve a la de fábrica."
          />
        </div>
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
