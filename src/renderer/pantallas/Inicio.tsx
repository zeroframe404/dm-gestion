// Inicio: saludo, lo que le toca a cada uno hoy, y el mapa de los módulos.
//
// Lo primero que se ve después del saludo son las tareas propias, no un tablero: el pliego pide que
// cada usuario vea sus pendientes al entrar, y eso es lo que hace que alguien abra la aplicación a la
// mañana en vez de mirar un papelito.
import { useEffect, useState } from 'react'
import { NOMBRE_ROL, type FilaTarea } from '../../shared/tipos'
import { Icono } from '../componentes/Icono'
import { Etiqueta, cx } from '../componentes/ui'
import { BotonAyuda } from '../componentes/Ayuda'
import { useNavegacion } from '../contexto/Navegacion'
import { usePermisos } from '../contexto/Permisos'
import { useUsuarioActual } from '../contexto/Sesion'
import { esAreaDePermisos, MODULOS, type IdModulo } from '../modulos'

export function Inicio({ alNavegar }: { alNavegar: (id: IdModulo) => void }) {
  const usuario = useUsuarioActual()
  const { puedeVer } = usePermisos()
  // El mapa de módulos muestra sólo los que esta persona puede abrir: ofrecer un atajo a una pantalla
  // que después dice «no tenés permiso» no le sirve a nadie.
  const modulosDeTrabajo = MODULOS.filter(
    (modulo) => modulo.id !== 'inicio' && (!esAreaDePermisos(modulo.id) || puedeVer(modulo.id)),
  )
  const disponibles = modulosDeTrabajo.filter((modulo) => modulo.disponible).length

  return (
    <div className="p-8">
      <section className="rounded-2xl bg-[linear-gradient(135deg,#12315d_0%,#163b6e_45%,#17437f_100%)] px-8 py-8 text-white shadow-media">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-200">{saludoSegunHora()}</p>
            <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Hola, {primerNombre(usuario.nombre)}</h2>
          </div>
          <BotonAyuda clave="inicio" variante="oscuro" />
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">
          Estás trabajando en la sucursal {usuario.sucursal.nombre} como {NOMBRE_ROL[usuario.rol].toLowerCase()}. Ya
          podés usar {disponibles} de los {modulosDeTrabajo.length} módulos; el resto se va habilitando en las próximas
          versiones.
        </p>
      </section>

      <MisTareas />

      <div className="mt-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Módulos</p>
        <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900">Todo lo que va a tener DM Gestión</h3>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {modulosDeTrabajo.map((modulo) => (
          <button
            key={modulo.id}
            type="button"
            onClick={() => alNavegar(modulo.id)}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-suave transition-all hover:border-marino-300 hover:shadow-media focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-marino-50 text-marino-700">
                <Icono nombre={modulo.icono} tamano={20} />
              </div>
              {!modulo.disponible && <Etiqueta>Próximamente</Etiqueta>}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{modulo.nombre}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{modulo.descripcion}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Las tareas abiertas de quien está usando la aplicación, lo más urgente primero. */
function MisTareas() {
  const { ir } = useNavegacion()
  const { puedeVer } = usePermisos()
  const verTareas = puedeVer('tareas')
  const [tareas, setTareas] = useState<FilaTarea[] | null>(null)

  useEffect(() => {
    if (!verTareas) return
    const traer = async () => {
      const resultado = await window.dm.tareas.mias()
      if (resultado.ok) setTareas(resultado.datos)
      else setTareas([])
    }
    void traer()
  }, [verTareas])

  // Mientras carga no se reserva lugar: si no hay nada pendiente, esta sección no existe y el mapa de
  // módulos sube. Un recuadro vacío que dice «no tenés tareas» no le sirve a nadie todos los días.
  if (!tareas || tareas.length === 0) return null

  const vencidas = tareas.filter((t) => t.vencida).length
  const hoy = tareas.filter((t) => t.venceHoy).length

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Lo tuyo</p>
          <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900">Tus tareas pendientes</h3>
        </div>
        {(vencidas > 0 || hoy > 0) && (
          <p className={cx('mb-1 text-sm font-semibold', vencidas > 0 ? 'text-red-600' : 'text-amber-700')}>
            {vencidas > 0 && `${vencidas} vencida(s)`}
            {vencidas > 0 && hoy > 0 && ' · '}
            {hoy > 0 && `${hoy} vence(n) hoy`}
          </p>
        )}
        <button
          type="button"
          onClick={() => ir('tareas')}
          className="mb-1 ml-auto text-sm font-semibold text-marino-700 hover:underline"
        >
          Ver todas
        </button>
      </div>

      <ul className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave">
        {tareas.map((tarea) => (
          <li key={tarea.id} className="border-b border-slate-100 last:border-b-0">
            <button
              type="button"
              onClick={() => ir('tareas', { tareaId: tarea.id })}
              className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50"
            >
              <span
                className={cx(
                  'h-2 w-2 shrink-0 rounded-full',
                  tarea.vencida ? 'bg-red-500' : tarea.venceHoy ? 'bg-amber-500' : tarea.prioridad === 'ALTA' ? 'bg-marino-500' : 'bg-slate-300',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{tarea.titulo}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[
                    tarea.vencida
                      ? `venció hace ${Math.abs(tarea.diasParaVencer ?? 0)} día(s)`
                      : tarea.venceHoy
                        ? 'vence hoy'
                        : tarea.venceEl
                          ? `vence ${tarea.venceEl}`
                          : 'sin fecha',
                    tarea.vinculoTexto,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {tarea.prioridad === 'ALTA' && (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">ALTA</span>
              )}
              <Icono nombre="flechaDerecha" tamano={15} className="shrink-0 text-slate-300" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function saludoSegunHora(): string {
  const hora = new Date().getHours()
  if (hora < 13) return 'Buen día'
  if (hora < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre
}
