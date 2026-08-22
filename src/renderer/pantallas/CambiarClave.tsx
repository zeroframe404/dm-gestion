// Cambio de contraseña obligatorio: se muestra cuando la sesión tiene `debeCambiarClave`.
import { useState, type FormEvent } from 'react'
import { LARGO_MINIMO_CLAVE } from '../../shared/tipos'
import { Icono } from '../componentes/Icono'
import { Alerta, Boton, CampoClave } from '../componentes/ui'
import { useSesion, useUsuarioActual } from '../contexto/Sesion'

export function CambiarClave() {
  const { actualizar, salir } = useSesion()
  const usuario = useUsuarioActual()
  const [claveActual, setClaveActual] = useState('')
  const [claveNueva, setClaveNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!claveActual) return setError('Ingresá tu contraseña actual.')
    if (claveNueva.length < LARGO_MINIMO_CLAVE) {
      return setError(`La contraseña nueva tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`)
    }
    if (claveNueva === claveActual) return setError('La contraseña nueva tiene que ser distinta de la actual.')
    if (claveNueva !== repetida) return setError('Las contraseñas nuevas no coinciden.')

    setEnviando(true)
    setError(null)
    const resultado = await window.dm.auth.cambiarClave({ claveActual, claveNueva })
    if (resultado.ok) {
      actualizar(resultado.datos)
    } else {
      setError(resultado.error)
      setEnviando(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#12315d_0%,#163b6e_45%,#17437f_100%)] p-6">
      <div className="w-full max-w-[440px]">
        <form onSubmit={alEnviar} noValidate className="rounded-2xl bg-white p-8 shadow-media">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-marino-50 text-marino-700">
            <Icono nombre="candado" tamano={22} />
          </div>
          <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900">Cambiá tu contraseña</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Hola, {usuario.nombre}. Por seguridad, tenés que elegir una contraseña nueva antes de continuar.
          </p>

          <div className="mt-6 flex flex-col gap-4">
            <CampoClave
              etiqueta="Contraseña actual"
              name="claveActual"
              value={claveActual}
              onChange={(evento) => setClaveActual(evento.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <CampoClave
              etiqueta="Contraseña nueva"
              name="claveNueva"
              value={claveNueva}
              onChange={(evento) => setClaveNueva(evento.target.value)}
              autoComplete="new-password"
              ayuda={`Mínimo ${LARGO_MINIMO_CLAVE} caracteres.`}
            />
            <CampoClave
              etiqueta="Repetir contraseña nueva"
              name="repetida"
              value={repetida}
              onChange={(evento) => setRepetida(evento.target.value)}
              autoComplete="new-password"
            />
            {error && <Alerta tono="error">{error}</Alerta>}
            <Boton type="submit" variante="primario" cargando={enviando} className="mt-2 w-full">
              Guardar y continuar
            </Boton>
            <Boton variante="fantasma" icono="salir" onClick={() => void salir()} className="w-full">
              Cerrar sesión
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}
