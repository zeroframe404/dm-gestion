// El cartel que avisa que falta la conexión con Google Drive. Lo ve TODO el equipo, en Inicio.
//
// Por qué está en Inicio y no enterrado en Administración: desde la 12.5 la credencial es OBLIGATORIA
// y sin ella se pierden dos cosas que no se notan hasta que hacen falta —el respaldo diario que sube a
// Drive y los adjuntos de los siniestros— así que enterarse tarde es exactamente el problema. Un
// empleado no la puede cargar, pero sí puede ver que falta y avisarle al superadministrador, que es lo
// que antes no pasaba: la sucursal sin cuenta no subía nada y nadie se enteraba.
//
// Dos reglas que ordenan el componente:
//
//   1. NO LLEVA NINGÚN DATO DE LA CREDENCIAL. Pregunta por `config:googleEnLaAgencia`, que contesta si
//      está y de cuándo es, y nada más. El correo de la cuenta y la URL de la hoja siguen siendo de
//      administradores, en Administración → Conexión con Google.
//   2. NO FRENA EL PROGRAMA, que es la regla de todo lo que habla con el VPS. Si el servidor no
//      contesta, el cartel no aparece: no se le va a decir a nadie que falta una credencial cuando lo
//      único que pasó es que se cayó internet.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeGoogleEnLaAgencia } from '../../shared/tipos'
import { useUsuarioActual } from '../contexto/Sesion'
import { Alerta, Boton } from './ui'

/**
 * `className` es del contenedor: en Inicio va con margen arriba y en Administración con el mismo
 * padding lateral que la barra de pestañas. Se pasa desde afuera y no se envuelve en un div en cada
 * pantalla porque el componente muchas veces no dibuja NADA, y un envoltorio vacío deja un hueco.
 */
export function AvisoConexionGoogle({ className = 'mt-6' }: { className?: string }) {
  const usuario = useUsuarioActual()
  const [estado, setEstado] = useState<EstadoDeGoogleEnLaAgencia | null>(null)
  const [trayendo, setTrayendo] = useState(false)
  const [detalle, setDetalle] = useState<string | null>(null)

  const consultar = useCallback(async () => {
    const resultado = await window.dm.config.googleEnLaAgencia()
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  useEffect(() => {
    void consultar()
  }, [consultar])

  // Sin respuesta todavía, con el servidor caído, o en una versión que no habla con el VPS, no se dice
  // nada: ver la regla 2 del encabezado. No se le va a decir a nadie que falta una credencial cuando lo
  // único que pasó es que se cayó internet.
  if (!estado || estado.error || !estado.hayServidor) return null
  if (estado.enElServidor && estado.enEstaComputadora && estado.alDia) return null

  const traer = async () => {
    setTrayendo(true)
    setDetalle(null)
    const resultado = await window.dm.config.traerGoogle()
    setTrayendo(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setDetalle(
        resultado.datos.enEstaComputadora && resultado.datos.alDia
          ? 'Listo: esta computadora ya tiene la misma conexión con Google que el resto.'
          : resultado.datos.enElServidor
            ? 'No se pudo adoptar lo que hay en el servidor: revisá la pantalla de Administración → Google Drive.'
            : 'El servidor todavía no la tiene. La carga el superadministrador una sola vez.',
      )
    } else {
      setDetalle(resultado.error)
    }
  }

  // Falta cargarla en la agencia: no la tiene nadie. Es el caso grave.
  if (!estado.enElServidor) {
    return (
      <div className={className}>
        <Alerta tono="error">
          <p className="font-semibold">Falta cargar la conexión con Google Drive, y es obligatoria.</p>
          <p className="mt-1">
            Sin ella no se sube el respaldo diario de la base ni los adjuntos de los siniestros: se siguen guardando en
            esta computadora, pero no queda copia fuera de acá.{' '}
            {usuario.rol === 'SUPER_ADMIN'
              ? 'Cargala en Administración → Conexión con Google; se carga una vez y la adoptan las cinco computadoras.'
              : 'La carga el superadministrador una sola vez, en Administración → Conexión con Google, y de ahí la adoptan todas las computadoras. Avisale.'}
          </p>
        </Alerta>
      </div>
    )
  }

  // Está en la agencia, pero esta máquina no la tiene o tiene OTRA. Los dos casos se arreglan igual, con
  // un botón, y los dos importan: una computadora con una credencial vieja sube los adjuntos a un Drive
  // que ya nadie mira, que es peor que no subirlos, porque parece que anduvo.
  const noLaTiene = !estado.enEstaComputadora
  return (
    <div className={className}>
      <Alerta tono="aviso">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {noLaTiene
                ? 'Esta computadora todavía no tiene la conexión con Google Drive.'
                : 'Esta computadora tiene una conexión con Google distinta de la de la agencia.'}
            </p>
            <p className="mt-1">
              {noLaTiene
                ? 'Ya está cargada en la agencia'
                : 'La que vale es la que cargó el superadministrador'}
              {estado.actualizadoPor ? ` (${estado.actualizadoPor})` : ''}: se baja sola al abrir el programa, y con
              este botón no hay que esperar a la próxima vez. Mientras tanto, desde acá{' '}
              {noLaTiene
                ? 'no se suben los respaldos ni los adjuntos de los siniestros.'
                : 'los respaldos y los adjuntos de los siniestros van a parar a otro lado.'}
            </p>
            {detalle && <p className="mt-1 opacity-80">{detalle}</p>}
          </div>
          <Boton icono="descargar" cargando={trayendo} onClick={() => void traer()}>
            Traerla ahora
          </Boton>
        </div>
      </Alerta>
    </div>
  )
}
