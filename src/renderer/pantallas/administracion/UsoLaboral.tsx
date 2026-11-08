// Administración → Ciberseguridad → Control de horarios: el horario en que puede trabajar cada rol, qué días y en qué
// sucursal, con sus feriados, y el registro de excepciones.
//
// Es del superadministrador y de nadie más (la pestaña sólo se arma para SUPER_ADMIN, el proceso principal pide el
// rol y el servidor lo vuelve a pedir). Y es OPCIONAL: viene apagada; mientras no se active, nadie tiene horario.
// El superadministrador nunca lo tiene: no hay renglón para él, a propósito.
//
// Lo que se carga acá lo hace cumplir el programa en cada computadora (no deja ingresar fuera de horario, avisa a los
// 30 minutos del cierre y cierra la sesión sola) y el servidor deja el REGISTRO de cada pedido de excepción, con la
// IP y la localidad que él vio, se haya aprobado o no.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DIAS_DE_LA_SEMANA,
  esFechaReal,
  horarioDeSucursalPorOmision,
  horarioPorOmision,
  motivoDeConfiguracionInvalida,
  NOMBRE_DE_ROL_CON_HORARIO,
  ROLES_CON_HORARIO,
  type ConfiguracionDeHorario,
  type ReglaDeHorario,
  type RolConHorario,
  type SolicitudDeHorario,
} from '../../../shared/horario'
import { SUCURSALES } from '../../../shared/sucursales'
import { PedidoParaResolver, textoDeMinutos } from '../../componentes/AvisoDePedidosDeHorario'
import { nombreDelRol } from '../../componentes/DatosDelPedidoDeHorario'
import { Alerta, Boton, Campo, Cargando, cx, Etiqueta, Tarjeta } from '../../componentes/ui'

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
  const editable = habilitado && regla.activo
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
          disabled={!editable}
          onChange={(evento) => cambiar(rol, { desde: evento.target.value })}
        />
        <Campo
          etiqueta="Hasta"
          type="time"
          value={regla.hasta}
          disabled={!editable}
          onChange={(evento) => cambiar(rol, { hasta: evento.target.value })}
        />
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-sm font-medium text-slate-700">Días de trabajo</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Días de trabajo de ${nombre.toLowerCase()}`}>
          {DIAS_DE_LA_SEMANA.map((dia) => {
            const elegido = regla.dias.includes(dia.numero)
            return (
              <button
                key={dia.numero}
                type="button"
                aria-pressed={elegido}
                disabled={!editable}
                title={dia.largo}
                onClick={() =>
                  cambiar(rol, {
                    dias: elegido ? regla.dias.filter((d) => d !== dia.numero) : [...regla.dias, dia.numero].sort((x, y) => x - y),
                  })
                }
                className={cx(
                  'h-9 min-w-[3rem] rounded-lg border px-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:cursor-not-allowed disabled:opacity-50',
                  elegido ? 'border-marino-700 bg-marino-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {dia.corto}
              </button>
            )
          })}
        </div>
      </div>
      {!regla.activo && <p className="mt-2 text-xs text-slate-500">Sin límite: {nombre.toLowerCase()} pueden trabajar a cualquier hora y cualquier día.</p>}
    </div>
  )
}

/** «25/12/2026 · viernes» para la lista de feriados. */
function fechaDeFeriado(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  const nombreDelDia = DIAS_DE_LA_SEMANA.find((d) => d.numero === new Date(`${fecha}T12:00:00Z`).getUTCDay())?.largo ?? ''
  return `${dia}/${mes}/${anio} · ${nombreDelDia}`
}

function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function UsoLaboral() {
  const [guardada, setGuardada] = useState<ConfiguracionDeHorario | null>(null)
  const [config, setConfig] = useState<ConfiguracionDeHorario>(horarioPorOmision)
  const [sucursal, setSucursal] = useState<string>(SUCURSALES[0])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fechaNueva, setFechaNueva] = useState('')
  const [motivoNuevo, setMotivoNuevo] = useState('')
  const [errorDeFeriado, setErrorDeFeriado] = useState<string | null>(null)
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

  const horario = config.sucursales[sucursal] ?? horarioDeSucursalPorOmision()

  /** Cambia el horario de la sucursal que se está mirando (el resto de la configuración queda igual). */
  function cambiarSucursal(cambios: Partial<typeof horario>) {
    setAviso(null)
    setConfig((actual) => ({
      ...actual,
      sucursales: { ...actual.sucursales, [sucursal]: { ...(actual.sucursales[sucursal] ?? horarioDeSucursalPorOmision()), ...cambios } },
    }))
  }

  function cambiarRegla(rol: RolConHorario, cambios: Partial<ReglaDeHorario>) {
    cambiarSucursal({ [rol]: { ...horario[rol], ...cambios } })
  }

  function agregarFeriado() {
    setErrorDeFeriado(null)
    if (!esFechaReal(fechaNueva)) {
      setErrorDeFeriado('Elegí la fecha del feriado.')
      return
    }
    if (horario.feriados.some((f) => f.fecha === fechaNueva)) {
      setErrorDeFeriado('Ese día ya está cargado como feriado.')
      return
    }
    cambiarSucursal({
      feriados: [...horario.feriados, { fecha: fechaNueva, motivo: motivoNuevo.trim().slice(0, 80) }].sort((x, y) => x.fecha.localeCompare(y.fecha)),
    })
    setFechaNueva('')
    setMotivoNuevo('')
  }

  function copiarATodas() {
    setAviso(null)
    setConfig((actual) => ({
      ...actual,
      sucursales: Object.fromEntries(SUCURSALES.map((nombre) => [nombre, structuredClone(horario)])),
    }))
    setAviso(`Se copió el horario y los feriados de ${sucursal} a todas las sucursales. Falta guardar.`)
  }

  const motivoInvalido = motivoDeConfiguracionInvalida(config)
  const hayCambios = guardada === null || JSON.stringify(guardada) !== JSON.stringify(config)
  /** Qué sucursales ya tienen algún horario activo (se marca con un punto en el selector). */
  const conHorario = useMemo(
    () => new Set(SUCURSALES.filter((nombre) => ROLES_CON_HORARIO.some((rol) => config.sucursales[nombre]?.[rol].activo))),
    [config],
  )

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
    <div className="flex flex-col gap-6">
      <Tarjeta
        titulo="Control de horarios"
        descripcion="Opcional. Define en qué horario y qué días puede trabajar cada rol, sucursal por sucursal, en hora de Argentina. Fuera de ese horario no se puede ingresar y, trabajando, 30 minutos antes del cierre el programa avisa y al llegar la hora cierra la sesión y la conexión con el servidor. El superadministrador no tiene horario."
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

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Sucursal</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sucursal a configurar">
              {SUCURSALES.map((nombre) => (
                <button
                  key={nombre}
                  type="button"
                  aria-pressed={nombre === sucursal}
                  onClick={() => setSucursal(nombre)}
                  className={cx(
                    'flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                    nombre === sucursal ? 'border-marino-700 bg-marino-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {nombre}
                  {conHorario.has(nombre) && (
                    <span title="Tiene horario configurado" className={cx('h-2 w-2 rounded-full', nombre === sucursal ? 'bg-white' : 'bg-marino-600')} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {ROLES_CON_HORARIO.map((rol) => filaDeRegla(rol, horario[rol], cambiarRegla, config.habilitado))}
          {motivoInvalido && config.habilitado && <Alerta tono="aviso">{motivoInvalido}</Alerta>}

          <div className="flex flex-wrap gap-2">
            <Boton
              variante="primario"
              escribe
              cargando={guardando}
              disabled={!hayCambios || (config.habilitado && motivoInvalido !== null)}
              onClick={() => void guardar()}
            >
              Guardar horario
            </Boton>
            <Boton variante="secundario" disabled={guardando} onClick={copiarATodas}>
              Copiar a todas las sucursales
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
        titulo={`Feriados de ${sucursal}`}
        descripcion="Días puntuales en que no se trabaja (feriados, puentes). Ese día nadie de la sucursal con el horario limitado puede ingresar, salvo con una excepción. Se guardan junto con el horario."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Fecha" type="date" value={fechaNueva} onChange={(evento) => setFechaNueva(evento.target.value)} />
            <Campo
              etiqueta="Motivo (opcional)"
              value={motivoNuevo}
              maxLength={80}
              placeholder="Navidad"
              onChange={(evento) => setMotivoNuevo(evento.target.value)}
            />
            <Boton onClick={agregarFeriado}>Agregar feriado</Boton>
          </div>
          {errorDeFeriado && <Alerta tono="aviso">{errorDeFeriado}</Alerta>}
          {horario.feriados.length === 0 ? (
            <p className="text-sm text-slate-500">No hay feriados cargados en {sucursal}.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {horario.feriados.map((feriado) => (
                <li key={feriado.fecha} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{fechaDeFeriado(feriado.fecha)}</span>
                    {feriado.motivo && <span className="ml-2 text-slate-600">{feriado.motivo}</span>}
                  </span>
                  <Boton variante="fantasma" tamano="sm" onClick={() => cambiarSucursal({ feriados: horario.feriados.filter((f) => f.fecha !== feriado.fecha) })}>
                    Quitar
                  </Boton>
                </li>
              ))}
            </ul>
          )}
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
