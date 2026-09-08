// Inicio: saludo, lo que le toca a cada uno hoy, y el mapa de los módulos.
//
// Lo primero que se ve después del saludo son las tareas propias, no un tablero: el pliego pide que
// cada usuario vea sus pendientes al entrar, y eso es lo que hace que alguien abra la aplicación a la
// mañana en vez de mirar un papelito.
import { useEffect, useState } from 'react'
import { NOMBRE_ROL, type FilaTarea, type PodioMensual } from '../../shared/tipos'
import { AvisoConexionGoogle } from '../componentes/AvisoConexionGoogle'
import { DialogoReportarError } from '../componentes/DialogoReportarError'
import { Icono } from '../componentes/Icono'
import { Boton, Etiqueta, cx } from '../componentes/ui'
import { BotonAyuda } from '../componentes/Ayuda'
import { BotonManual } from '../componentes/BotonManual'
import { useNavegacion } from '../contexto/Navegacion'
import { usePermisos } from '../contexto/Permisos'
import { useUsuarioActual } from '../contexto/Sesion'
import { esAreaDePermisos, MODULOS, type IdModulo } from '../modulos'
import { mesCorto, numero } from './metricas/graficos'

export function Inicio({ alNavegar }: { alNavegar: (id: IdModulo) => void }) {
  const usuario = useUsuarioActual()
  const { puedeVer } = usePermisos()
  const [reportando, setReportando] = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  // El mapa de módulos muestra sólo los que esta persona puede abrir: ofrecer un atajo a una pantalla
  // que después dice «no tenés permiso» no le sirve a nadie.
  const modulosDeTrabajo = MODULOS.filter(
    (modulo) => modulo.id !== 'inicio' && (!esAreaDePermisos(modulo.id) || puedeVer(modulo.id)),
  )

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
          Estás trabajando en la sucursal {usuario.sucursal.nombre} como {NOMBRE_ROL[usuario.rol].toLowerCase()}.
        </p>
        {/* Acá y no enterrado en Administración: quien recién empieza mira esta pantalla. Y al lado, el
            botón para avisar de un error: cuando algo no anda, ésta es la pantalla a la que se vuelve. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <BotonManual />
          <Boton icono="alerta" onClick={() => setReportando(true)}>
            Reportar error
          </Boton>
          {/* Y al lado, para cualquier rol, el pedido que no es un error: lo que al mostrador le
              gustaría que el programa haga. Va por el mismo camino y queda etiquetado aparte. */}
          <Boton icono="info" onClick={() => setSugiriendo(true)}>
            Sugerir mejora
          </Boton>
        </div>
      </section>

      <DialogoReportarError abierto={reportando} alCerrar={() => setReportando(false)} />
      <DialogoReportarError abierto={sugiriendo} alCerrar={() => setSugiriendo(false)} variante="mejora" />

      {/* La conexión con Google es obligatoria desde la 12.5 y sin ella no se suben los respaldos ni
          los adjuntos de los siniestros. El cartel va acá, arriba de todo y para todo el equipo: es la
          pantalla que se mira al entrar, y enterarse el día que hace falta un documento es tarde. */}
      <AvisoConexionGoogle />

      <MisTareas />

      <PodioDeSucursales />

      <div className="mt-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Módulos</p>
        <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900">Todos los módulos</h3>
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
    // Inicio es la pantalla que queda abierta cuando nadie está haciendo nada: si le asignan una tarea
    // desde otra sucursal, tiene que aparecer sola.
    return window.dm.tareas.alCambiarDeAfuera(() => void traer())
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

// Las medallas de las primeras tres sucursales del podio. De la cuarta en más van con un número: con
// cuatro sucursales en total casi siempre entra toda la agencia, y no hay medalla para el último.
const MEDALLAS = ['🥇', '🥈', '🥉']

/**
 * El podio del mes: quién metió más altas, sucursal contra sucursal. Es la competencia que pidió el
 * cliente para que el primero quiera seguir primero, así que no pide permiso de área —la ve
 * cualquiera que entró, tenga o no el módulo Métricas— y desaparece sola si todavía no hay mes
 * anterior cargado: sin él las altas no se pueden calcular y no hay carrera que mostrar.
 */
function PodioDeSucursales() {
  const [podio, setPodio] = useState<PodioMensual | null>(null)

  useEffect(() => {
    let vigente = true
    const traer = async () => {
      const resultado = await window.dm.metricas.podio()
      if (vigente && resultado.ok) setPodio(resultado.datos)
    }
    void traer()
    return () => {
      vigente = false
    }
  }, [])

  if (!podio || !podio.hayMesAnterior || podio.ranking.length === 0) return null

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Competencia entre sucursales</p>
          <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900">
            Podio de altas · {mesCorto(podio.periodo)}
          </h3>
          {/* Qué se está contando, dicho en la tarjeta: el número se mira todos los días y sin esta línea
              «altas» se lee como «pólizas nuevas escritas», que no es lo mismo. */}
          <p className="mt-1 text-xs text-slate-500">Pólizas que están este mes y no estaban el anterior. Las renovaciones no cuentan.</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {podio.ranking.map((fila, indice) => (
          <div
            key={fila.etiqueta}
            className={cx(
              'rounded-xl border px-4 py-3 shadow-suave',
              indice === 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none" aria-hidden="true">
                {MEDALLAS[indice] ?? `${indice + 1}°`}
              </span>
              <span className="truncate font-semibold text-slate-900" title={fila.etiqueta}>
                {fila.etiqueta}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-2xl font-extrabold tabular-nums text-slate-900">{numero(fila.altas ?? 0)}</span>
              <span className="text-xs text-slate-500">alta{fila.altas === 1 ? '' : 's'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {numero(fila.bajas)} baja{fila.bajas === 1 ? '' : 's'} · {numero(fila.activos)} activa{fila.activos === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>
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
