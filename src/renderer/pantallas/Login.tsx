// Pantalla de inicio de sesión.
import { useState, type FormEvent } from 'react'
import { Icono } from '../componentes/Icono'
import { Alerta, Boton, Campo, CampoClave } from '../componentes/ui'
import { useSesion } from '../contexto/Sesion'

export function Login() {
  const { ingresar } = useSesion()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!usuario.trim() || !clave) {
      setError('Ingresá tu usuario y tu contraseña.')
      return
    }
    setEnviando(true)
    setError(null)
    const mensaje = await ingresar({ usuario: usuario.trim(), clave })
    // Si el ingreso fue correcto esta pantalla se desmonta; sólo hay que manejar el error.
    if (mensaje) {
      setError(mensaje)
      setEnviando(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#12315d_0%,#163b6e_45%,#17437f_100%)] p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <Icono nombre="escudo" tamano={28} className="text-cielo-200" />
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-200">Seguros Daniel Martínez</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">DM Gestión</h1>
        </div>

        <form onSubmit={alEnviar} noValidate className="rounded-2xl bg-white p-8 shadow-media">
          <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-slate-600">Ingresá con tu usuario y tu contraseña.</p>

          <div className="mt-6 flex flex-col gap-4">
            <Campo
              etiqueta="Usuario"
              name="usuario"
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            <CampoClave
              etiqueta="Contraseña"
              name="clave"
              value={clave}
              onChange={(evento) => setClave(evento.target.value)}
              autoComplete="current-password"
            />
            {error && <Alerta tono="error">{error}</Alerta>}
            <Boton type="submit" variante="primario" cargando={enviando} className="mt-2 w-full">
              Ingresar
            </Boton>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-white/60">Los datos se guardan únicamente en esta computadora.</p>
      </div>
    </div>
  )
}
