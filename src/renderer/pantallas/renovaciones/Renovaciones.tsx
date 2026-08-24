// La bandeja de renovaciones: lo que vence en los próximos 60 días, semana por semana. Es una pantalla
// de trabajo, no un informe: cada fila se gestiona sin salir de la tabla (responsable, estado, nota) y
// las dos decisiones que cierran el trámite —renovar o no renovar— abren un diálogo.
//
// Los títulos de las semanas, los días que faltan y la marca de «aumenta al renovar» los calcula el
// proceso principal y llegan armados en la bandeja: acá no se recalculan, así la pantalla y el resto
// del sistema no pueden decir cosas distintas.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DIAS_DE_RENOVACION, fechaCorta, porcentajeDeAumento } from '../../../shared/polizas'
import {
  ESTADOS_DE_RENOVACION,
  NOMBRE_ESTADO_RENOVACION,
  type BandejaRenovaciones,
  type EstadoRenovacion,
  type FilaRenovacion,
  type SemanaDeRenovaciones,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta as Aviso, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePuedeEditar } from '../../contexto/Permisos'
import { DialogoNuevaTarea } from '../tareas/DialogoNuevaTarea'
import { DialogoNoRenueva, DialogoRenovar } from './DialogoRenovar'

/** Los estados que dan el trámite por cerrado: son los que esconde la casilla «Ocultar las ya resueltas». */
const ESTADOS_RESUELTOS: EstadoRenovacion[] = ['renovada', 'no renueva']

interface Filtros {
  /** '' = todos, 'sin' = sin responsable asignado, o el id del usuario en texto. */
  responsable: string
  estado: '' | EstadoRenovacion
  ocultarResueltas: boolean
}

const FILTROS_VACIOS: Filtros = { responsable: '', estado: '', ocultarResueltas: false }

/** Una póliza puede entrar más de una vez si tiene vigencias distintas: la clave es la póliza y su vencimiento. */
function claveDeFila(fila: FilaRenovacion): string {
  return `${fila.polizaId}|${fila.venceEl}`
}

export function Renovaciones() {
  const { ir } = useNavegacion()

  const [bandeja, setBandeja] = useState<BandejaRenovaciones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  // Qué semanas están abiertas. Sin decisión tomada manda el valor por defecto: sólo la primera.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [renovarA, setRenovarA] = useState<FilaRenovacion | null>(null)
  const [noRenuevaA, setNoRenuevaA] = useState<FilaRenovacion | null>(null)
  const [tareaPara, setTareaPara] = useState<FilaRenovacion | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.renovaciones.bandeja()
    if (resultado.ok) setBandeja(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /**
   * Guarda el seguimiento de una fila. Los tres campos viajan siempre juntos porque el canal recibe un
   * DatosDeSeguimiento completo: lo que no cambió se manda tal como estaba.
   */
  const actualizar = useCallback(
    async (fila: FilaRenovacion, cambio: { estado?: EstadoRenovacion; responsableId?: number | null; nota?: string }) => {
      const clave = claveDeFila(fila)
      setGuardando(clave)
      setError(null)
      const resultado = await window.dm.renovaciones.actualizar(fila.polizaId, fila.venceEl, {
        estado: cambio.estado ?? fila.estado,
        responsableId: 'responsableId' in cambio ? (cambio.responsableId ?? null) : fila.responsableId,
        nota: cambio.nota ?? fila.nota ?? '',
      })
      setGuardando(null)
      if (resultado.ok) setBandeja(resultado.datos)
      else setError(resultado.error)
    },
    [],
  )

  const todas = useMemo(() => bandeja?.semanas.flatMap((semana) => semana.filas) ?? [], [bandeja])

  const contadores = useMemo(() => {
    let urgentes = 0
    let pendientes = 0
    let resueltas = 0
    for (const fila of todas) {
      if (fila.diasParaVencer <= 7) urgentes++
      if (fila.estado === 'pendiente') pendientes++
      if (ESTADOS_RESUELTOS.includes(fila.estado)) resueltas++
    }
    return { urgentes, pendientes, resueltas }
  }, [todas])

  // Los filtros son de memoria: la bandeja entera ya está en el renderer y son 60 días de pólizas,
  // no vale la pena volver al proceso principal para esconder filas.
  const semanasVisibles = useMemo<SemanaDeRenovaciones[]>(() => {
    if (!bandeja) return []
    const pasa = (fila: FilaRenovacion) => {
      if (filtros.ocultarResueltas && ESTADOS_RESUELTOS.includes(fila.estado)) return false
      if (filtros.estado && fila.estado !== filtros.estado) return false
      if (filtros.responsable === 'sin' && fila.responsableId !== null) return false
      if (filtros.responsable && filtros.responsable !== 'sin' && String(fila.responsableId ?? '') !== filtros.responsable) return false
      return true
    }
    return bandeja.semanas
      .map((semana) => ({ ...semana, filas: semana.filas.filter(pasa) }))
      .filter((semana) => semana.filas.length > 0)
  }, [bandeja, filtros])

  const visibles = useMemo(() => semanasVisibles.reduce((suma, semana) => suma + semana.filas.length, 0), [semanasVisibles])
  const hayFiltros = filtros.responsable !== '' || filtros.estado !== '' || filtros.ocultarResueltas

  if (cargando && !bandeja) return <Cargando texto="Buscando lo que vence…" />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Contador etiqueta="Vencen en 60 días" valor={bandeja?.total ?? 0} />
        <Contador
          etiqueta="Vencidas o en 7 días"
          valor={contadores.urgentes}
          tono="rojo"
          titulo="Ya vencieron o les queda una semana: son las que hay que llamar hoy."
        />
        <Contador etiqueta="Sin empezar" valor={contadores.pendientes} tono="ambar" titulo="Todavía están en «Pendiente»." />
        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar()} disabled={cargando}>
            Actualizar
          </Boton>
          <BotonAyuda clave="renovaciones" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FiltroDesplegable
          etiqueta="Responsable"
          valor={filtros.responsable}
          opciones={[
            { valor: 'sin', texto: 'Sin responsable' },
            ...(bandeja?.responsables ?? []).map((r) => ({ valor: String(r.id), texto: r.nombre })),
          ]}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, responsable: valor }))}
        />
        <FiltroDesplegable
          etiqueta="Estado"
          valor={filtros.estado}
          opciones={ESTADOS_DE_RENOVACION.map((e) => ({ valor: e, texto: NOMBRE_ESTADO_RENOVACION[e] }))}
          alCambiar={(valor) => setFiltros((f) => ({ ...f, estado: valor as '' | EstadoRenovacion }))}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filtros.ocultarResueltas}
            onChange={(evento) => setFiltros((f) => ({ ...f, ocultarResueltas: evento.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ocultar las ya resueltas
          <span className="tabular-nums text-slate-400">({contadores.resueltas})</span>
        </label>
        {hayFiltros && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setFiltros(FILTROS_VACIOS)}>
            Limpiar
          </Boton>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {visibles.toLocaleString('es-AR')} de {(bandeja?.total ?? 0).toLocaleString('es-AR')} pólizas
        </span>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="exito">{aviso}</Aviso>}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {semanasVisibles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="font-display text-base font-bold text-slate-800">
              {hayFiltros && (bandeja?.total ?? 0) > 0
                ? 'Ninguna renovación coincide con los filtros.'
                : `No hay pólizas que venzan en los próximos ${DIAS_DE_RENOVACION} días.`}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {hayFiltros && (bandeja?.total ?? 0) > 0
                ? 'Probá con otro responsable o estado, o limpiá los filtros.'
                : 'Cuando una póliza entre en los últimos dos meses de vigencia va a aparecer acá, agrupada por semana.'}
            </p>
          </div>
        ) : (
          semanasVisibles.map((semana, indice) => (
            <BloqueSemana
              key={semana.desde}
              semana={semana}
              abierta={abiertas[semana.desde] ?? indice === 0}
              guardando={guardando}
              responsables={bandeja?.responsables ?? []}
              alPlegar={() =>
                setAbiertas((previo) => ({ ...previo, [semana.desde]: !(previo[semana.desde] ?? indice === 0) }))
              }
              alVerCliente={(clienteId) => ir('clientes', { clienteId })}
              alActualizar={actualizar}
              alRenovar={setRenovarA}
              alNoRenovar={setNoRenuevaA}
              alCrearTarea={setTareaPara}
            />
          ))
        )}
      </div>

      <DialogoRenovar
        fila={renovarA}
        alCerrar={() => setRenovarA(null)}
        alRenovar={(nueva, nombre) => {
          setBandeja(nueva)
          setRenovarA(null)
          setError(null)
          setAviso(`${nombre} quedó renovada. La vigencia anterior pasó a histórica.`)
        }}
        alFallar={setError}
      />
      <DialogoNoRenueva
        fila={noRenuevaA}
        alCerrar={() => setNoRenuevaA(null)}
        alConfirmar={(nueva, nombre) => {
          setBandeja(nueva)
          setNoRenuevaA(null)
          setError(null)
          setAviso(`${nombre} salió de la bandeja: la póliza quedó dada de baja.`)
        }}
        alFallar={setError}
      />

      {tareaPara && (
        <DialogoNuevaTarea
          vinculo={{
            polizaId: tareaPara.polizaId,
            clienteId: tareaPara.clienteId,
            renovacionId: tareaPara.renovacionId,
            texto: `la renovación de ${tareaPara.clienteNombre ?? 'la póliza'} (vence ${fechaCorta(tareaPara.venceEl)})`,
          }}
          responsables={bandeja?.responsables ?? []}
          sucursales={tareaPara.sucursal ? [tareaPara.sucursal] : []}
          alCerrar={() => setTareaPara(null)}
          alCrear={(tarea) => {
            setTareaPara(null)
            setAviso(`Quedó anotada la tarea «${tarea.titulo}»${tarea.responsableNombre ? ` para ${tarea.responsableNombre}` : ''}.`)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Una semana
// ---------------------------------------------------------------------------

const ENCABEZADO = 'px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap'

interface PropsSemana {
  semana: SemanaDeRenovaciones
  abierta: boolean
  guardando: string | null
  responsables: Array<{ id: number; nombre: string }>
  alPlegar: () => void
  alVerCliente: (clienteId: number) => void
  alActualizar: (fila: FilaRenovacion, cambio: { estado?: EstadoRenovacion; responsableId?: number | null; nota?: string }) => void
  alRenovar: (fila: FilaRenovacion) => void
  alNoRenovar: (fila: FilaRenovacion) => void
  alCrearTarea: (fila: FilaRenovacion) => void
}

function BloqueSemana({
  semana,
  abierta,
  guardando,
  responsables,
  alPlegar,
  alVerCliente,
  alActualizar,
  alRenovar,
  alNoRenovar,
  alCrearTarea,
}: PropsSemana) {
  const idTabla = `semana-${semana.desde}`
  const urgentes = semana.filas.filter((fila) => fila.diasParaVencer <= 7).length

  return (
    <section className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave">
      <button
        type="button"
        onClick={alPlegar}
        aria-expanded={abierta}
        aria-controls={idTabla}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
      >
        <Icono
          nombre="flechaDerecha"
          tamano={14}
          className={cx('shrink-0 text-slate-400 transition-transform', abierta && 'rotate-90')}
        />
        <span className="font-display text-sm font-bold tracking-tight text-slate-900">{semana.titulo}</span>
        <span className="text-xs text-slate-500">
          {fechaCorta(semana.desde)} al {fechaCorta(semana.hasta)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {urgentes > 0 && <Etiqueta tono="peligro">{urgentes} urgente{urgentes === 1 ? '' : 's'}</Etiqueta>}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
            {semana.filas.length} {semana.filas.length === 1 ? 'póliza' : 'pólizas'}
          </span>
        </span>
      </button>

      {abierta && (
        <div id={idTabla} className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={ENCABEZADO}>Cliente</th>
                <th className={ENCABEZADO}>Compañía</th>
                <th className={ENCABEZADO}>Póliza</th>
                <th className={ENCABEZADO}>Vehículo</th>
                <th className={cx(ENCABEZADO, 'text-right')}>Cuota</th>
                <th className={ENCABEZADO}>Hasta</th>
                <th className={ENCABEZADO}>Responsable</th>
                <th className={ENCABEZADO}>Estado</th>
                <th className={ENCABEZADO}>Nota</th>
                <th className={ENCABEZADO} />
              </tr>
            </thead>
            <tbody>
              {semana.filas.map((fila) => (
                <FilaDeRenovacion
                  key={claveDeFila(fila)}
                  fila={fila}
                  guardando={guardando === claveDeFila(fila)}
                  responsables={responsables}
                  alVerCliente={alVerCliente}
                  alActualizar={alActualizar}
                  alRenovar={alRenovar}
                  alNoRenovar={alNoRenovar}
                  alCrearTarea={alCrearTarea}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Una fila
// ---------------------------------------------------------------------------

const CLASES_ESTADO: Record<EstadoRenovacion, string> = {
  pendiente: 'border-slate-300 text-slate-700',
  'en gestion': 'border-marino-400 bg-marino-50 font-semibold text-marino-800',
  renovada: 'border-green-300 bg-green-50 font-semibold text-green-800',
  'no renueva': 'border-red-200 bg-red-50 font-semibold text-red-700',
}

interface PropsFila {
  fila: FilaRenovacion
  guardando: boolean
  responsables: Array<{ id: number; nombre: string }>
  alVerCliente: (clienteId: number) => void
  alActualizar: (fila: FilaRenovacion, cambio: { estado?: EstadoRenovacion; responsableId?: number | null; nota?: string }) => void
  alRenovar: (fila: FilaRenovacion) => void
  alNoRenovar: (fila: FilaRenovacion) => void
  alCrearTarea: (fila: FilaRenovacion) => void
}

function FilaDeRenovacion({ fila, guardando, responsables, alVerCliente, alActualizar, alRenovar, alNoRenovar, alCrearTarea }: PropsFila) {
  const puedeEditar = usePuedeEditar('renovaciones')
  const porcentaje = porcentajeDeAumento(fila.observaciones)
  const resuelta = ESTADOS_RESUELTOS.includes(fila.estado)
  // Sin permiso de edición la bandeja se mira, pero no se toca: es lo mismo que estar guardando.
  const bloqueado = guardando || !puedeEditar

  return (
    <tr className={cx('border-b border-slate-100 last:border-b-0 align-top', resuelta && 'bg-slate-50/70', guardando && 'opacity-60')}>
      <td className="px-2.5 py-2">
        <button
          type="button"
          onClick={() => alVerCliente(fila.clienteId)}
          title="Abrir la ficha del cliente"
          className="max-w-[15rem] truncate text-left font-semibold text-marino-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
        >
          {fila.clienteNombre ?? 'Sin nombre'}
        </button>
        {(fila.sucursal || fila.telefono) && (
          <p className="truncate text-xs text-slate-500">{[fila.sucursal, fila.telefono].filter(Boolean).join(' · ')}</p>
        )}
      </td>
      <td className="px-2.5 py-2 whitespace-nowrap text-slate-700">
        {fila.compania ?? '—'}
        {fila.cobertura && <p className="truncate text-xs text-slate-500">{fila.cobertura}</p>}
      </td>
      <td className="px-2.5 py-2 whitespace-nowrap font-mono text-xs text-slate-600">{fila.numero ?? '—'}</td>
      <td className="px-2.5 py-2">
        <span className="block max-w-[13rem] truncate text-slate-700" title={fila.vehiculo ?? undefined}>
          {fila.vehiculo ?? '—'}
        </span>
        {fila.patente && <p className="font-mono text-xs text-slate-500">{fila.patente}</p>}
      </td>
      <td className="px-2.5 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">
        {fila.cuota ?? '—'}
        {/* El aumento al renovar es lo que el usuario pidió ver de un vistazo: va pegado a la cuota,
            que es el número que hay que tocar, con las observaciones enteras en el tooltip. */}
        {fila.aumentaAlRenovar && (
          <span className="mt-1 block" title={fila.observaciones ?? 'Las observaciones piden aumentar al renovar.'}>
            <Etiqueta tono="aviso">{porcentaje !== null ? `Aumentar ${porcentaje}%` : 'Aumentar al renovar'}</Etiqueta>
          </span>
        )}
      </td>
      <td className="px-2.5 py-2 whitespace-nowrap">
        <span className="text-slate-700" title={fila.vigenciaHasta ? `En la planilla: ${fila.vigenciaHasta}` : undefined}>
          {fechaCorta(fila.venceEl)}
        </span>
        <p className={cx('text-xs font-semibold tabular-nums', claseDeDias(fila.diasParaVencer))}>{textoDeDias(fila.diasParaVencer)}</p>
      </td>
      <td className="px-2.5 py-2">
        <select
          value={fila.responsableId === null ? '' : String(fila.responsableId)}
          disabled={bloqueado}
          aria-label={`Responsable de la renovación de ${fila.clienteNombre ?? 'la póliza'}`}
          onChange={(evento) => alActualizar(fila, { responsableId: evento.target.value === '' ? null : Number(evento.target.value) })}
          className={cx(
            'h-8 w-full min-w-[8rem] rounded-lg border bg-white px-1.5 text-xs',
            fila.responsableId === null ? 'border-slate-300 text-slate-500' : 'border-slate-300 font-medium text-slate-800',
          )}
        >
          <option value="">Sin asignar</option>
          {responsables.map((responsable) => (
            <option key={responsable.id} value={responsable.id}>
              {responsable.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2.5 py-2">
        <select
          value={fila.estado}
          disabled={bloqueado}
          aria-label={`Estado del trámite de ${fila.clienteNombre ?? 'la póliza'}`}
          onChange={(evento) => alActualizar(fila, { estado: evento.target.value as EstadoRenovacion })}
          className={cx('h-8 w-full min-w-[7.5rem] rounded-lg border px-1.5 text-xs', CLASES_ESTADO[fila.estado])}
        >
          {ESTADOS_DE_RENOVACION.map((estado) => (
            <option key={estado} value={estado}>
              {NOMBRE_ESTADO_RENOVACION[estado]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2.5 py-2">
        <CampoNota
          valor={fila.nota}
          disabled={bloqueado}
          etiqueta={`Nota de la renovación de ${fila.clienteNombre ?? 'la póliza'}`}
          alGuardar={(nota) => alActualizar(fila, { nota })}
        />
      </td>
      <td className="px-2.5 py-2">
        <div className="flex items-center justify-end gap-1">
          <Boton tamano="sm" icono="renovaciones" onClick={() => alRenovar(fila)} disabled={bloqueado}>
            Renovar
          </Boton>
          <button
            type="button"
            title="Anotar una tarea de esta renovación"
            aria-label={`Nueva tarea de la renovación de ${fila.clienteNombre ?? 'la póliza'}`}
            disabled={bloqueado}
            onClick={() => alCrearTarea(fila)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-marino-300 hover:bg-marino-50 hover:text-marino-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icono nombre="tareas" tamano={14} />
          </button>
          <button
            type="button"
            title="El cliente no renueva"
            aria-label={`Marcar que ${fila.clienteNombre ?? 'el cliente'} no renueva`}
            disabled={bloqueado}
            onClick={() => alNoRenovar(fila)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icono nombre="cerrar" tamano={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

/**
 * La nota se guarda al salir del foco, no en cada tecla: cada guardado devuelve la bandeja entera y
 * volver a pedirla letra por letra sería absurdo. El texto se mantiene en estado local para que el
 * refresco de la bandeja no pise lo que se está escribiendo.
 */
function CampoNota({
  valor,
  etiqueta,
  disabled,
  alGuardar,
}: {
  valor: string | null
  etiqueta: string
  disabled: boolean
  alGuardar: (nota: string) => void
}) {
  const [texto, setTexto] = useState(valor ?? '')

  useEffect(() => {
    setTexto(valor ?? '')
  }, [valor])

  const guardarSiCambio = () => {
    if (texto !== (valor ?? '')) alGuardar(texto)
  }

  return (
    <input
      value={texto}
      disabled={disabled}
      aria-label={etiqueta}
      placeholder="Anotá acá el seguimiento…"
      onChange={(evento) => setTexto(evento.target.value)}
      onBlur={guardarSiCambio}
      onKeyDown={(evento) => {
        if (evento.key === 'Enter') evento.currentTarget.blur()
        if (evento.key === 'Escape') setTexto(valor ?? '')
      }}
      className="h-8 w-full min-w-[10rem] rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25"
    />
  )
}

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

/** Los días que faltan, escritos como los diría alguien de la agencia. */
function textoDeDias(dias: number): string {
  if (dias < 0) return `Venció hace ${-dias} d`
  if (dias === 0) return 'Vence hoy'
  if (dias === 1) return 'Falta 1 día'
  return `Faltan ${dias} días`
}

/** Rojo hasta una semana (vencidas incluidas), ámbar hasta dos, y de ahí en más sin color. */
function claseDeDias(dias: number): string {
  if (dias <= 7) return 'text-red-700'
  if (dias <= 15) return 'text-amber-700'
  return 'text-slate-500'
}

function Contador({
  etiqueta,
  valor,
  tono = 'neutro',
  titulo,
}: {
  etiqueta: string
  valor: number
  tono?: 'neutro' | 'rojo' | 'ambar'
  titulo?: string
}) {
  const clases = {
    neutro: 'border-slate-200 bg-white text-slate-900',
    rojo: 'border-red-200 bg-red-50 text-red-800',
    ambar: 'border-amber-200 bg-amber-50 text-amber-800',
  }[tono]
  return (
    <div title={titulo} className={cx('rounded-lg border px-3 py-1.5', clases)}>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </div>
  )
}

function FiltroDesplegable({
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  etiqueta: string
  valor: string
  opciones: Array<{ valor: string; texto: string }>
  alCambiar: (valor: string) => void
}) {
  return (
    <select
      value={valor}
      onChange={(evento) => alCambiar(evento.target.value)}
      aria-label={etiqueta}
      className={cx(
        'h-9 rounded-lg border bg-white px-2 text-sm',
        valor ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700',
      )}
    >
      <option value="">{etiqueta}: todos</option>
      {opciones.map((opcion) => (
        <option key={opcion.valor} value={opcion.valor}>
          {opcion.texto}
        </option>
      ))}
    </select>
  )
}
