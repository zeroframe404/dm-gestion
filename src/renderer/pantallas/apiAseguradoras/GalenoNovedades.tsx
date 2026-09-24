// API Aseguradoras → Galeno (novedades): el usuario y la clave con los que el servidor consulta el
// portal de Galeno.
//
// Dos cosas que la hacen distinta del resto de los ajustes compartidos (el catálogo de vehículos,
// Google, Meta):
//
// 1. LA CREDENCIAL NO SE GUARDA EN ESTA COMPUTADORA. Va derecho al VPS, que la guarda cifrada, porque
//    quien la usa es el servidor. Repartir en las cinco máquinas una credencial que ninguna necesita
//    sería regalar superficie de ataque a cambio de nada.
// 2. NO HAY «traer del servidor». No hay nada que traer: acá no se usa.
//
// Por eso tampoco se muestra nunca la clave guardada —el servidor no la devuelve— y el campo aparece
// siempre vacío: cargar de nuevo la reemplaza, dejarlo vacío no la toca.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeAjusteCompartido, PruebaDeGalenoNovedades } from '../../../shared/tipos'
import { Alerta, Boton, Cargando, Tarjeta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

function fecha(iso: string | null): string {
  if (!iso) return 'nunca'
  const valor = new Date(iso)
  return Number.isNaN(valor.getTime()) ? iso : valor.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function GalenoNovedades() {
  const usuario = useUsuarioActual()
  const esSuperAdmin = usuario.rol === 'SUPER_ADMIN'

  const [compartido, setCompartido] = useState<EstadoDeAjusteCompartido | null>(null)
  const [cargando, setCargando] = useState(true)
  const [usuarioGaleno, setUsuarioGaleno] = useState('')
  const [clave, setClave] = useState('')
  const [legajos, setLegajos] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeGalenoNovedades | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.galenoNovedades.estadoCompartido()
    if (resultado.ok) setCompartido(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.galenoNovedades.guardarCredenciales({
      usuario: usuarioGaleno.trim(),
      clave,
      // Vacío quiere decir «todos los legajos que Galeno declare para este usuario», que es lo que
      // conviene salvo que la agencia quiera sincronizar sólo uno.
      legajos: legajos
        .split(',')
        .map((legajo) => legajo.trim())
        .filter(Boolean),
      ramas: [],
      activo: true,
    })
    if (resultado.ok) {
      setCompartido(resultado.datos)
      // La clave no se deja en memoria más de lo necesario.
      setClave('')
      setAviso('Credenciales guardadas en el servidor. La próxima pasada las usa.')
    } else {
      setError(resultado.error)
    }
    setGuardando(false)
  }

  const probar = async () => {
    setProbando(true)
    setError(null)
    setPrueba(null)
    const resultado = await window.dm.galenoNovedades.probar()
    if (resultado.ok) setPrueba(resultado.datos)
    else setError(resultado.error)
    setProbando(false)
  }

  if (cargando) return <Cargando texto="Consultando el servidor…" />

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Tarjeta titulo="Galeno Seguros">
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-slate-600">
            Con estas credenciales el servidor consulta el portal de productores de Galeno cada quince minutos y trae las
            pólizas que se cargaron, se modificaron o se anularon. Lo que trae aparece en Cartera → Galeno.
          </p>

          {compartido?.enElServidor ? (
            <Alerta tono="exito">
              Cargadas en el servidor el {fecha(compartido.actualizadoEn)}
              {compartido.actualizadoPor ? ` por ${compartido.actualizadoPor}` : ''}.
            </Alerta>
          ) : (
            <Alerta tono="aviso">Todavía no hay credenciales de Galeno cargadas en el servidor.</Alerta>
          )}

          {compartido?.error && <Alerta tono="error">{compartido.error}</Alerta>}
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="info">{aviso}</Alerta>}
          {prueba && (
            <Alerta tono={prueba.ok ? 'exito' : 'error'}>
              {prueba.detalle}
              {!prueba.ok && (
                <>
                  {' '}
                  Si dice que rechazó el usuario o la clave, puede que el usuario «USWS…» no sirva contra el portal:
                  pedile a Galeno el web service para sistemas de gestión a serviciosalproductor@galenoseguros.com.ar.
                </>
              )}
            </Alerta>
          )}

          {esSuperAdmin ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Usuario</span>
                <input
                  value={usuarioGaleno}
                  onChange={(evento) => setUsuarioGaleno(evento.target.value)}
                  autoComplete="off"
                  placeholder="USWS…"
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Clave</span>
                <input
                  value={clave}
                  onChange={(evento) => setClave(evento.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Se guarda cifrada en el servidor"
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Legajos (opcional)</span>
                <input
                  value={legajos}
                  onChange={(evento) => setLegajos(evento.target.value)}
                  autoComplete="off"
                  placeholder="Vacío = todos los que tenga el usuario. Separados por coma."
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Boton
                  onClick={() => void guardar()}
                  disabled={guardando || !usuarioGaleno.trim() || !clave}
                  cargando={guardando}
                >
                  Guardar en el servidor
                </Boton>
                <Boton
                  variante="secundario"
                  onClick={() => void probar()}
                  disabled={probando || !compartido?.enElServidor}
                  cargando={probando}
                >
                  Probar conexión
                </Boton>
                <span className="text-xs text-slate-500">
                  «Probar conexión» usa lo que ya está guardado en el servidor, no lo que está escrito acá.
                </span>
              </div>
            </>
          ) : (
            <Alerta tono="info">
              Las credenciales de Galeno las carga el superadministrador: con ellas se ve la cartera entera de la
              compañía.
            </Alerta>
          )}
        </div>
      </Tarjeta>
    </div>
  )
}
