// Administración → Uso laboral: el horario en que puede trabajar cada rol y el registro de excepciones.
//
// Es del superadministrador y de nadie más (la pestaña sólo se arma para SUPER_ADMIN, el proceso principal
// pide el rol y el servidor lo vuelve a pedir). Y es OPCIONAL: viene apagada; mientras no se active,
// nadie tiene horario. El superadministrador nunca lo tiene: no hay renglón para él, a propósito.
//
// Lo que se carga acá lo hace cumplir el programa en cada computadora (no deja ingresar fuera de horario,
// avisa a los 30 minutos del cierre y cierra la sesión sola) y el servidor deja el REGISTRO de cada pedido
// de excepción, con la IP y la localidad que él vio, se haya aprobado o no.
import { useCallback, useEffect, useState } from 'react'
import {
  HORARIO_POR_OMISION,
  motivoDeConfiguracionInvalida,
  NOMBRE_DE_ROL_CON_HORARIO,
  ROLES_CON_HORARIO,
  type ConfiguracionDeHorario,
  type ReglaDeHorario,
  type RolConHorario,
  type SolicitudDeHorario,
} from '../../../shared/horario'
import { PedidoParaResolver, textoDeMinutos } from '../../componentes/AvisoDePedidosDeHorario'
import { nombreDelRol } from '../../componentes/DatosDelPedidoDeHorario'
import { Alerta, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'

const MOMENTO: Record<SolicitudDeHorario['momento'], string> = {
  INGRESO: 'Al ingresar',
  EN_SESION: 'Trabajando',
}

function Resultado({ pedido }: { pedido: SolicitudDeHorario }) {
  if (pedido.estado === 'PENDIENTE') return <Etiqueta tono="aviso">Esperando</Etiqueta>
  if (pedido.estado === 'RECHAZADA') return <Etiqueta tono="peligro">Rechazada</Etiqueta>
  return <Etiqueta tono="exito">Aprobada · {pedido.minutosConcedidos ? textoDeMinutos(pedido.minutosConcedidos) : ''}</Etiqueta>
}

function filaDeRegla(
  rol: RolConHorario,
  regla: ReglaDeHorario,
  cambiar: (rol: RolConHorario, cambios: Partial<ReglaDeHorario>) => void,
  habilitado: boolean,
) {
  const nombre = NOMBRE_DE_ROL_CON_HORARIO[rol]
  return (
    <div key={rol} className="rounded-xl border border-slate-200 p-4">
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={regla.activo}
          disabled={!habilitado}
          onChange={(evento) => cambiar(rol, { activo: evento.target.checked })}
        />
        Limitar el horario de {nombre.toLowerCase()}
      </label>
      <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
        <Campo
          etiqueta="Desde"
          type="time"
          value={regla.desde}
          disabled={!habilitado || !regla.activo}
          onChange={(evento) => cambiar(rol, { desde: evento.target.value })}
        />
        <Campo
          etiqueta="Hasta"
          type="time"
          value={regla.hasta}
          disabled={!habilitado || !regla.activo}
          onChange={(evento) => cambiar(rol, { hasta: evento.target.value })}
        />
      </div>
      {!regla.activo && <p className="mt-2 text-xs text-slate-500">Sin límite: {nombre.toLowerCase()} pueden trabajar a cualquier hora.</p>}
    </div>
  )
}

function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function UsoLaboral() {
  const [guardada, setGuardada] = useState<ConfiguracionDeHorario | null>(null)
  const [config, setConfig] = useState<ConfiguracionDeHorario>(HORARIO_POR_OMISION)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<SolicitudDeHorario[]>([])
  const [registro, setRegistro] = useState<SolicitudDeHorario[]>([])
  const [errorDelRegistro, setErrorDelRegistro] = useState<string | null>(null)

  const cargarPedidos = useCallback(async () => {
    const [esperando, todos] = await Promise.all([window.dm.horario.pendientes(), window.dm.horario.registro()])
    if (esperando.ok) setPendientes(esperando.datos)
    if (todos.ok) {
      setRegistro(todos.datos)
      setErrorDelRegistro(null)
    } else {
      setErrorDelRegistro(todos.error)
    }
  }, [])

  useEffect(() => {
    let vigente = true
    void (async () => {
      const resultado = await window.dm.horario.estado()
      if (!vigente) return
      if (resultado.ok) {
        setGuardada(resultado.datos.config)
        setConfig(resultado.datos.config)
      } else {
        setError(resultado.error)
      }
      setCargando(false)
      await cargarPedidos()
    })()
    // Los pedidos nuevos entran solos mientras esta pantalla está abierta.
    const dejarDeEscuchar = window.dm.horario.alLlegarPedidos(() => void cargarPedidos())
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [cargarPedidos])

  function cambiarRegla(rol: RolConHorario, cambios: Partial<ReglaDeHorario>) {
    setAviso(null)
    setConfig((actual) => ({ ...actual, [rol]: { ...actual[rol], ...cambios } }))
  }

  const motivoInvalido = motivoDeConfiguracionInvalida(config)
  const hayCambios = guardada === null || JSON.stringify(guardada) !== JSON.stringify(config)

  async function guardar() {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.horario.guardar(config)
    setGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setGuardada(resultado.datos.config)
    setConfig(resultado.datos.config)
    setAviso('Listo. Cada computadora toma el horario nuevo en un par de minutos.')
  }

  if (cargando) return <Cargando />

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Tarjeta
        titulo="Horario de trabajo"
        descripcion="Opcional. Define de qué hora a qué hora puede trabajar cada rol, en hora de Argentina. Fuera de ese horario no se puede ingresar y, trabajando, 30 minutos antes del cierre el programa avisa y al llegar la hora cierra la sesión y la conexión con el servidor. El superadministrador no tiene horario."
      >
        <div className="flex flex-col gap-4">
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={config.habilitado}
              onChange={(evento) => {
                setAviso(null)
                setConfig((actual) => ({ ...actual, habilitado: evento.target.checked }))
              }}
            />
            Activar el control de horario
          </label>
          {ROLES_CON_HORARIO.map((rol) => filaDeRegla(rol, config[rol], cambiarRegla, config.habilitado))}
          {motivoInvalido && config.habilitado && <Alerta tono="aviso">{motivoInvalido}</Alerta>}
          <div className="flex gap-2">
            <Boton
              variante="primario"
              escribe
              cargando={guardando}
              disabled={!hayCambios || (config.habilitado && motivoInvalido !== null)}
              onClick={() => void guardar()}
            >
              Guardar horario
            </Boton>
            {guardada && hayCambios && (
              <Boton variante="fantasma" disabled={guardando} onClick={() => setConfig(guardada)}>
                Descartar cambios
              </Boton>
            )}
          </div>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Pedidos esperando respuesta"
        descripcion="Quien está fuera de horario, o a punto de quedarlo, puede pedirte una excepción. Aprobar da un tiempo extra; rechazar deja el horario como está."
      >
        {pendientes.length === 0 ? (
          <p className="text-sm text-slate-500">No hay pedidos pendientes.</p>
        ) : (
          <div className="space-y-3">
            {pendientes.map((pedido) => (
              <PedidoParaResolver key={pedido.id} pedido={pedido} alResolver={() => void cargarPedidos()} />
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Registro de excepciones"
        descripcion="Todos los pedidos, aprobados o no, con la dirección IP y la localidad desde donde se pidieron. No se borran."
        acciones={
          <Boton variante="secundario" tamano="sm" onClick={() => void cargarPedidos()}>
            Actualizar
          </Boton>
        }
      >
        {errorDelRegistro && <Alerta tono="error">{errorDelRegistro}</Alerta>}
        {registro.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hubo pedidos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="py-2 pr-3 font-semibold">Persona</th>
                  <th className="py-2 pr-3 font-semibold">Rol</th>
                  <th className="py-2 pr-3 font-semibold">Sucursal</th>
                  <th className="py-2 pr-3 font-semibold">Cuándo</th>
                  <th className="py-2 pr-3 font-semibold">IP</th>
                  <th className="py-2 pr-3 font-semibold">Localidad</th>
                  <th className="py-2 pr-3 font-semibold">Resultado</th>
                  <th className="py-2 font-semibold">Lo resolvió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registro.map((pedido) => (
                  <tr key={pedido.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{fechaLegible(pedido.creadoEn)}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{pedido.nombre}</td>
                    <td className="py-2 pr-3 text-slate-600">{nombreDelRol(pedido.rol)}</td>
                    <td className="py-2 pr-3 text-slate-600">{pedido.sucursal || '—'}</td>
                    <td className="py-2 pr-3 text-slate-600">{MOMENTO[pedido.momento]}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-700">{pedido.ip || '—'}</td>
                    <td className="py-2 pr-3 text-slate-600">{pedido.localidad || 'Desconocida'}</td>
                    <td className="py-2 pr-3">
                      <Resultado pedido={pedido} />
                    </td>
                    <td className="py-2 text-slate-600">{pedido.resueltaPor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  )
}
