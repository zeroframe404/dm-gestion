// Administración → Redes sociales → TikTok: la app de TikTok for Developers de cada sucursal.
//
// A diferencia de la app de Meta (una sola para toda la agencia), acá cada sucursal tiene la suya:
// Client Key y Client Secret por sucursal. Se guardan cifrados en el servidor del VPS, que es quien
// canjea el ingreso de TikTok y renueva el permiso cada 24 horas; no se copian a ninguna computadora.
//
// Vincular la cuenta se hace después desde Marketing → Redes → TikTok, eligiendo ahí la sucursal.
import { useCallback, useEffect, useState } from 'react'
import type { CuentaDeTikTok, PanelDeTikTok } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'

function fecha(iso: string | null): string {
  if (!iso) return ''
  const valor = new Date(iso)
  return Number.isNaN(valor.getTime()) ? '' : valor.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function FilaDeSucursal({
  cuenta,
  urlDeFabrica,
  puedeEditar,
  alCambiar,
}: {
  cuenta: CuentaDeTikTok
  urlDeFabrica: string
  puedeEditar: boolean
  alCambiar: (panel: PanelDeTikTok, aviso: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [clientKey, setClientKey] = useState(cuenta.clientKey ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [vuelta, setVuelta] = useState(cuenta.urlDeRedireccion === urlDeFabrica ? '' : cuenta.urlDeRedireccion)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const guardar = async () => {
    setOcupado(true)
    setError(null)
    const resultado = await window.dm.tiktok.guardarApp({ sucursal: cuenta.sucursal, clientKey, clientSecret, urlDeRedireccion: vuelta.trim() })
    setOcupado(false)
    if (resultado.ok) {
      setClientSecret('')
      setEditando(false)
      alCambiar(resultado.datos, `Quedó guardada la app de TikTok de ${cuenta.sucursal}. Ahora se vincula la cuenta desde Marketing → Redes → TikTok.`)
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    setOcupado(true)
    setError(null)
    const resultado = await window.dm.tiktok.borrarApp(cuenta.sucursal)
    setOcupado(false)
    if (resultado.ok) {
      setClientKey('')
      setEditando(false)
      alCambiar(resultado.datos, `Se sacó la app de TikTok de ${cuenta.sucursal} (y con ella la cuenta vinculada). Lo publicado no se borra.`)
    } else {
      setError(resultado.error)
    }
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cuenta.urlDeRedireccion)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1_500)
    } catch {
      /* queda a la vista para copiarla a mano */
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <Icono nombre="tiktok" tamano={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{cuenta.sucursal}</p>
          <p className="truncate text-xs text-slate-500">
            {!cuenta.appCargada
              ? 'Sin app de TikTok cargada.'
              : cuenta.estado === 'ACTIVA'
                ? `Cuenta vinculada${cuenta.usuario ? `: @${cuenta.usuario}` : ''}`
                : cuenta.estado === 'TOKEN_RECHAZADO'
                  ? 'Se cortó la conexión con TikTok: hay que volver a vincular.'
                  : 'App cargada; falta vincular la cuenta desde Marketing → Redes → TikTok.'}
            {cuenta.appCargada && cuenta.clientKey ? ` · Client Key ${cuenta.clientKey}` : ''}
            {cuenta.appCargadaEn ? ` · cargada el ${fecha(cuenta.appCargadaEn)}` : ''}
          </p>
        </div>
        {cuenta.estado === 'ACTIVA' && <Etiqueta tono="exito">Vinculada</Etiqueta>}
        {cuenta.estado === 'TOKEN_RECHAZADO' && <Etiqueta tono="peligro">Token rechazado</Etiqueta>}
        {cuenta.appCargada && cuenta.estado === 'SIN_VINCULAR' && <Etiqueta tono="aviso">Sin vincular</Etiqueta>}
        {puedeEditar && !editando && (
          <Boton tamano="sm" icono="lapiz" onClick={() => setEditando(true)}>
            {cuenta.appCargada ? 'Cambiar' : 'Cargar app'}
          </Boton>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      {editando && (
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
          <Campo
            etiqueta="Client Key"
            value={clientKey}
            onChange={(evento) => setClientKey(evento.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
            ayuda="Figura en developers.tiktok.com, en la app de esta sucursal (Manage apps → la app → Credentials)."
          />
          <CampoClave
            etiqueta="Client Secret"
            value={clientSecret}
            onChange={(evento) => setClientSecret(evento.target.value)}
            autoComplete="off"
            placeholder={cuenta.appCargada ? '•••••••• (dejalo vacío para no cambiarlo)' : ''}
            ayuda="Se guarda cifrado en el servidor y no vuelve a ninguna pantalla."
          />
          <Campo
            etiqueta="Dirección de vuelta (opcional)"
            value={vuelta}
            onChange={(evento) => setVuelta(evento.target.value)}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={urlDeFabrica}
            ayuda="Vacía usa la de fábrica. Sólo cambiala si en el panel de TikTok registraste otra."
          />
          <div className="flex flex-wrap justify-end gap-2">
            {cuenta.appCargada && (
              <Boton icono="basura" onClick={() => void borrar()} disabled={ocupado}>
                Sacar la app
              </Boton>
            )}
            <Boton
              variante="fantasma"
              onClick={() => {
                setEditando(false)
                setError(null)
                setClientSecret('')
              }}
              disabled={ocupado}
            >
              Cancelar
            </Boton>
            <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={ocupado} disabled={!clientKey.trim() || (!cuenta.appCargada && !clientSecret.trim())}>
              Guardar
            </Boton>
          </div>
        </div>
      )}

      {cuenta.appCargada && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Dirección de vuelta:</span>
          <code className="min-w-0 truncate rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-slate-700">{cuenta.urlDeRedireccion}</code>
          <button type="button" className="font-semibold text-marino-700 hover:underline" onClick={() => void copiar()}>
            {copiado ? 'Copiada' : 'Copiar'}
          </button>
        </div>
      )}
    </li>
  )
}

export function AppsDeTikTok({ puedeEditar }: { puedeEditar: boolean }) {
  const [panel, setPanel] = useState<PanelDeTikTok | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.tiktok.panel()
    if (resultado.ok) setPanel(resultado.datos)
    else setError(resultado.error)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const copiarFabrica = async () => {
    if (!panel) return
    try {
      await navigator.clipboard.writeText(panel.urlDeRedireccionDeFabrica)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1_500)
    } catch {
      /* queda a la vista */
    }
  }

  return (
    <>
      <Tarjeta
        titulo="TikTok: la app de cada sucursal"
        descripcion="Cada sucursal tiene su propia app de TikTok for Developers. Se carga acá el Client Key y el Client Secret de cada una; después la cuenta se vincula desde Marketing → Redes → TikTok."
      >
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}
        {panel?.ultimoError && <Alerta tono="aviso">No se pudo traer lo cargado en el servidor: {panel.ultimoError}</Alerta>}
        {!panel ? (
          !error && <Cargando />
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {panel.cuentas.map((cuenta) => (
              <FilaDeSucursal
                key={`${cuenta.sucursal}-${cuenta.appCargadaEn ?? 'sin'}`}
                cuenta={cuenta}
                urlDeFabrica={panel.urlDeRedireccionDeFabrica}
                puedeEditar={puedeEditar}
                alCambiar={(nuevo, texto) => {
                  setPanel(nuevo)
                  setAviso(texto)
                  setError(null)
                }}
              />
            ))}
          </ul>
        )}
        {!puedeEditar && <p className="mt-3 text-xs text-slate-500">Las apps de TikTok las carga el superadministrador.</p>}
      </Tarjeta>

      <Tarjeta
        titulo="TikTok: antes de que funcione"
        descripcion="Lo que hay que hacer en developers.tiktok.com, una vez por cada app. No depende del programa."
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong className="font-semibold">Agregar los productos Login Kit y Content Posting API</strong>, y en Content Posting API
            activar <em>Direct Post</em>. Los permisos que usa el programa son <code className="font-mono text-xs">user.info.basic</code> y{' '}
            <code className="font-mono text-xs">video.publish</code>.
          </li>
          <li>
            <strong className="font-semibold">Registrar la dirección de vuelta</strong> en Login Kit → Redirect URI, escrita exacta:
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 truncate rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">
                {panel?.urlDeRedireccionDeFabrica ?? '…'}
              </code>
              <Boton tamano="sm" icono={copiado ? 'ok' : 'clip'} onClick={() => void copiarFabrica()}>
                {copiado ? 'Copiada' : 'Copiar'}
              </Boton>
            </span>
            <span className="mt-1 block text-xs text-slate-500">El programa nunca abre esa dirección: atrapa el intento y lo cancela. No hace falta que la página exista.</span>
          </li>
          <li>
            <strong className="font-semibold">Pedir la revisión de la app («Submit for review»)</strong>. Mientras TikTok no la apruebe,
            todo lo que se publique sale en privado (sólo lo ve la cuenta), y sólo pueden vincularse las cuentas cargadas como usuarios de
            prueba («Sandbox»).
          </li>
        </ul>
      </Tarjeta>
    </>
  )
}
