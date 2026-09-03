// Google Drive: JSON de la cuenta de servicio (para respaldos y adjuntos) y URL de la hoja de cálculo.
// Se guardan en %APPDATA%/dm-gestion/config.json —la clave privada nunca vuelve al renderer— y desde la
// v12.4 viajan al VPS para que el resto de las computadoras las adopte: una sucursal sin la cuenta no
// subía los adjuntos de los siniestros y nadie se enteraba hasta que hacían falta.
import { useEffect, useState, type FormEvent } from 'react'
import type { EstadoConexionGoogle } from '../../../shared/tipos'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

export function ConexionGoogle() {
  // La MIRAN los administradores; la CARGA sólo el superadministrador, porque lo que se guarda acá
  // pisa la cuenta de las otras cuatro computadoras. Con Administración en «sólo ver», ni eso.
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && usuario.rol === 'SUPER_ADMIN'
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
      setAviso(
        resultado.datos.compartido?.error
          ? 'La conexión se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo.'
          : 'La conexión con Google se guardó y salió para el resto de las computadoras.',
      )
    } else {
      setError(resultado.error)
    }
    setGuardando(false)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Tarjeta
        titulo="Google Drive (obligatoria)"
        descripcion="Desde la versión 12 la base vive en el VPS y el programa no sincroniza más con la hoja (el servidor la mantiene como copia de lectura). Esta cuenta de Google queda sólo para Drive: los respaldos diarios y los adjuntos de siniestros. Es obligatoria: la carga el superadministrador una vez, viaja al VPS y la adoptan solas las cinco computadoras, sea quien sea el que las use."
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
              <Alerta tono="error">
                Todavía no hay una cuenta de servicio configurada, y es obligatoria. Sin ella no se sube el respaldo
                diario de la base ni los adjuntos de los siniestros: se siguen guardando en cada computadora, pero no
                queda copia fuera de acá. Mientras falte, el cartel aparece en Inicio para todo el equipo.
              </Alerta>
            )}

            <AreaTexto
              etiqueta="JSON de la cuenta de servicio"
              name="cuentaServicioJson"
              value={json}
              disabled={!puedeEditar}
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
              disabled={!puedeEditar}
              onChange={(evento) => setUrlHoja(evento.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              spellCheck={false}
              ayuda="Acordate de compartir la hoja con el correo de la cuenta de servicio."
            />

            <EstadoCompartido
              estado={estado?.compartido}
              nombre="la conexión con Google"
              comoSeCarga="La carga el superadministrador una sola vez y el resto la adopta al abrir el programa."
            />

            <Alerta tono="info">
              La clave privada se guarda cifrada en el servidor y, en esta computadora,
              {rutaConfig ? (
                <>
                  {' '}
                  en <code className="rounded bg-amber-100/70 px-1 font-mono text-xs">{rutaConfig}</code>
                </>
              ) : (
                ' en el archivo de configuración'
              )}
              . Nunca se copia al repositorio ni a la base de datos, y nunca vuelve a esta pantalla.
            </Alerta>

            {!puedeEditar && usuario.rol !== 'SUPER_ADMIN' && (
              <Alerta tono="info">
                La conexión con Google la carga el superadministrador: lo que se guarda acá vale para las cinco computadoras.
              </Alerta>
            )}

            {error && <Alerta tono="error">{error}</Alerta>}
            {aviso && <Alerta tono="exito">{aviso}</Alerta>}

            <div className="flex justify-end">
              <Boton type="submit" variante="primario" cargando={guardando} disabled={!puedeEditar}>
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
