// Pantalla de inicio de sesión. Debajo del formulario dice, sin jerga, si hay conexión con la base de
// usuarios compartida y quién puede entrar sin internet en esta computadora.
import { useState, type FormEvent } from 'react'
import type { EstadoDeAcceso } from '../../shared/tipos'
import { Icono } from '../componentes/Icono'
import { Alerta, Boton, Campo, CampoClave, cx } from '../componentes/ui'
import { useAcceso } from '../contexto/Acceso'
import { useSesion } from '../contexto/Sesion'

export function Login() {
  const { ingresar, motivoCierre } = useSesion()
  const { acceso, comprobando } = useAcceso(true)
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

  const esperaRed = enviando && acceso?.configurada === true

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
            {motivoCierre && <Alerta tono="aviso">{motivoCierre}</Alerta>}
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
              {esperaRed ? 'Conectando con la base de usuarios…' : 'Ingresar'}
            </Boton>
          </div>
        </form>

        <LineaDeAcceso acceso={acceso} comprobando={comprobando} />
      </div>
    </div>
  )
}

interface Linea {
  punto: 'verde' | 'ambar' | 'rojo' | 'gris' | 'cargando'
  texto: string
}

function lineaDe(acceso: EstadoDeAcceso | null, comprobando: boolean): Linea {
  if (!acceso || (comprobando && acceso.configurada && acceso.modo !== 'en-linea' && !acceso.ultimaComprobacion)) {
    return { punto: 'cargando', texto: 'Comprobando la conexión…' }
  }
  if (!acceso.configurada) {
    return acceso.sinTokenEnProduccion
      ? {
          punto: 'rojo',
          texto: 'Esta versión del programa no tiene configurada la base de usuarios compartida: los usuarios se guardan sólo en esta computadora. Avisale a quien arma el programa.',
        }
      : { punto: 'gris', texto: 'Los datos se guardan únicamente en esta computadora.' }
  }
  const guardado = acceso.usuarioGuardado
  switch (acceso.modo) {
    case 'sin-inicializar':
      return {
        punto: 'ambar',
        texto: 'La base de usuarios compartida todavía no se inicializó: se ingresa con los usuarios de esta computadora. Un superadministrador tiene que subirlos desde Administración → Usuarios.',
      }
    case 'en-linea':
      return { punto: 'verde', texto: 'En línea. Podés ingresar con cualquier usuario.' }
    case 'sin-internet':
      return guardado
        ? {
            punto: 'ambar',
            texto: `Sin internet. En esta computadora sólo puede ingresar «${guardado}», que fue el último en ingresar con conexión. Los demás van a poder entrar cuando vuelva internet.`,
          }
        : {
            punto: 'ambar',
            texto: 'Sin internet. Para ingresar por primera vez en esta computadora hace falta conexión. Probá de nuevo cuando vuelva.',
          }
    case 'error-remoto':
      return {
        punto: 'rojo',
        texto: `Hay internet, pero el programa no pudo acceder a la base de usuarios. Avisale al administrador.${guardado ? ` Mientras tanto, en esta computadora sólo puede ingresar «${guardado}».` : ''}`,
      }
    default:
      return { punto: 'gris', texto: 'Los datos se guardan únicamente en esta computadora.' }
  }
}

const COLOR_PUNTO: Record<Linea['punto'], string> = {
  verde: 'bg-green-400',
  ambar: 'bg-amber-400',
  rojo: 'bg-red-400',
  gris: 'bg-white/40',
  cargando: 'bg-white/40',
}

function LineaDeAcceso({ acceso, comprobando }: { acceso: EstadoDeAcceso | null; comprobando: boolean }) {
  const linea = lineaDe(acceso, comprobando)
  return (
    <div className="mt-6 flex flex-col items-center gap-1 text-center text-xs text-white/70" role="status">
      <p className="flex items-start justify-center gap-2">
        {linea.punto === 'cargando' ? (
          <Icono nombre="cargando" tamano={12} className="mt-0.5 shrink-0 animate-spin" />
        ) : (
          <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', COLOR_PUNTO[linea.punto])} aria-hidden="true" />
        )}
        <span>{linea.texto}</span>
      </p>
      {acceso?.configurada && !acceso.puedeGuardarCredencial && (
        <p>Esta computadora no puede guardar la copia cifrada para ingresar sin internet.</p>
      )}
    </div>
  )
}
