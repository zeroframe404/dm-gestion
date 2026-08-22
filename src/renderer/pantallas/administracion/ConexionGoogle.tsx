// Conexión con Google: JSON de la cuenta de servicio y URL de la hoja de cálculo.
// Se guardan en %APPDATA%/dm-gestion/config.json; la clave privada nunca vuelve al renderer.
import { useEffect, useState, type FormEvent } from 'react'
import type { EstadoConexionGoogle } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Tarjeta } from '../../componentes/ui'

export function ConexionGoogle() {
  const [estado, setEstado] = useState<EstadoConexionGoogle | null>(null)
  const [rutaConfig, setRutaConfig] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [json, setJson] = useState('')
  const [urlHoja, setUrlHoja] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vigente = true
    void Promise.all([window.dm.config.estadoGoogle(), window.dm.app.info()]).then(([resultadoEstado, resultadoInfo]) => {
      if (!vigente) return
      if (resultadoEstado.ok) {
        setEstado(resultadoEstado.datos)
        setUrlHoja(resultadoEstado.datos.urlHoja ?? '')
      } else {
        setError(resultadoEstado.error)
      }
      if (resultadoInfo.ok) setRutaConfig(resultadoInfo.datos.rutaConfig)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [])

  async function alGuardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.config.guardarGoogle({ cuentaServicioJson: json, urlHoja: urlHoja.trim() })
    if (resultado.ok) {
      setEstado(resultado.datos)
      setJson('')
      setAviso('La conexión con Google se guardó correctamente.')
    } else {
      setError(resultado.error)
    }
    setGuardando(false)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Tarjeta
        titulo="Conexión con Google"
        descripcion="Credenciales de la cuenta de servicio y hoja de cálculo que va a usar la sincronización cuando esté disponible."
      >
        {cargando ? (
          <Cargando />
        ) : (
          <form onSubmit={alGuardar} noValidate className="flex flex-col gap-5">
            {estado?.configurado ? (
              <Alerta tono="exito">
                Configurado con la cuenta <strong className="font-semibold">{estado.clientEmail ?? '(sin client_email)'}</strong>
                {estado.projectId && <> del proyecto <strong className="font-semibold">{estado.projectId}</strong></>}.
                {estado.actualizadoEn && <> Última actualización: {formatearFecha(estado.actualizadoEn)}.</>}
              </Alerta>
            ) : (
              <Alerta tono="info">Todavía no hay una cuenta de servicio configurada.</Alerta>
            )}

            <AreaTexto
              etiqueta="JSON de la cuenta de servicio"
              name="cuentaServicioJson"
              value={json}
              onChange={(evento) => setJson(evento.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "client_email": "...@....iam.gserviceaccount.com",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'}
              className="font-mono text-xs"
              ayuda={
                estado?.configurado
                  ? 'Pegá un JSON nuevo sólo si querés reemplazar la cuenta actual. Si lo dejás vacío, se conserva.'
                  : 'Pegá el contenido completo del archivo .json que descargaste de Google Cloud al crear la cuenta de servicio.'
              }
            />

            <Campo
              etiqueta="URL de la hoja de cálculo"
              name="urlHoja"
              type="url"
              value={urlHoja}
              onChange={(evento) => setUrlHoja(evento.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              spellCheck={false}
              ayuda="Acordate de compartir la hoja con el correo de la cuenta de servicio."
            />

            <Alerta tono="aviso">
              Estos datos se guardan únicamente en esta computadora
              {rutaConfig ? (
                <>
                  , en <code className="rounded bg-amber-100/70 px-1 font-mono text-xs">{rutaConfig}</code>
                </>
              ) : null}
              . Nunca se copian al repositorio ni a la base de datos.
            </Alerta>

            {error && <Alerta tono="error">{error}</Alerta>}
            {aviso && <Alerta tono="exito">{aviso}</Alerta>}

            <div className="flex justify-end">
              <Boton type="submit" variante="primario" cargando={guardando}>
                Guardar conexión
              </Boton>
            </div>
          </form>
        )}
      </Tarjeta>
    </div>
  )
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}
