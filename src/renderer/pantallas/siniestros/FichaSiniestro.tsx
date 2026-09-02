// La ficha del siniestro: el estado del trámite, la línea de tiempo de observaciones fechadas y
// firmadas, los documentos adjuntos y las tareas vinculadas.
//
// Es la pantalla donde se contesta «¿cómo viene lo de González?» sin llamar a nadie. Por eso la línea
// de tiempo está en el medio y ocupa lugar: es el relato del trámite, no un campo de notas.
import { useCallback, useEffect, useState } from 'react'
import {
  CATEGORIAS_DE_ADJUNTO,
  CATEGORIA_DE_ADJUNTO_OTRAS,
  ESTADOS_DE_SINIESTRO,
  type CategoriaDeAdjunto,
  type EstadoSiniestro,
  type FichaSiniestro as Ficha,
  type EstadoTarea,
} from '../../../shared/tipos'
import { NOMBRE_ESTADO_TAREA } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { BotonEliminar } from '../../componentes/BotonEliminar'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Selector, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { CLASES_ESTADO } from './Siniestros'

interface Props {
  siniestroId: number
  alVolver: () => void
}

function fechaYHora(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

function pesoDeArchivo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FichaSiniestro({ siniestroId, alVolver }: Props) {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('siniestros')
  const puedeBorrarDocumentos = usuario.rol !== 'EMPLEADO' && puedeEditar

  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [observacion, setObservacion] = useState('')
  const [tareaAbierta, setTareaAbierta] = useState(false)
  const [adjuntarAbierto, setAdjuntarAbierto] = useState(false)

  // Sin permiso de edición la ficha se lee entera, pero no se toca nada: como estar guardando.
  const bloqueado = trabajando || !puedeEditar

  const cargar = useCallback(async () => {
    const resultado = await window.dm.siniestros.ficha(siniestroId)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }, [siniestroId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Todas las acciones devuelven la ficha entera: se guarda el resultado y listo. */
  const hacer = async (accion: () => Promise<{ ok: true; datos: Ficha } | { ok: false; error: string }>) => {
    setTrabajando(true)
    setError(null)
    const resultado = await accion()
    setTrabajando(false)
    if (resultado.ok) setFicha(resultado.datos)
    else setError(resultado.error)
    return resultado.ok
  }

  if (!ficha) {
    return (
      <div className="p-8">
        {error ? <Alerta tono="error">{error}</Alerta> : <Cargando texto="Abriendo el siniestro…" />}
        <div className="mt-4">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>
        </div>
      </div>
    )
  }

  const s = ficha.siniestro

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Boton icono="flechaIzquierda" onClick={alVolver}>
          Volver
        </Boton>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">
            {s.esRobo && <span className="mr-2 rounded bg-red-100 px-2 py-0.5 align-middle text-sm font-extrabold text-red-700">ROBO</span>}
            {s.clienteNombre ?? 'Sin asegurado'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {[s.compania, s.numeroPoliza, s.cobertura, s.patente].filter(Boolean).join(' · ') || 'Sin datos de póliza'}
          </p>
        </div>
        <label className="text-sm font-semibold text-slate-700">
          Estado del trámite
          <select
            value={s.estado}
            disabled={bloqueado}
            onChange={(evento) => void hacer(() => window.dm.siniestros.cambiarEstado(s.id, evento.target.value as EstadoSiniestro))}
            className={cx('ml-2 h-9 rounded-lg border px-2 text-sm font-semibold disabled:opacity-60', CLASES_ESTADO[s.estado])}
          >
            {ESTADOS_DE_SINIESTRO.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </label>
        <BotonEliminar tipo="siniestro" id={s.id} tamano="md" etiqueta="Eliminar" alBorrar={alVolver} />
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {s.estadoTexto && (
        <Alerta tono="info">
          En la planilla, la columna ESTADO de este siniestro dice «{s.estadoTexto}». Se está mostrando como{' '}
          <strong className="font-semibold">{s.estado}</strong>; al tocar el desplegable se corrige también allá.
        </Alerta>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* --- Columna izquierda: los datos de la hoja y los del tercero, editables --- */}
        <div className="flex flex-col gap-4 lg:col-span-1">
          <Tarjeta titulo="Datos del siniestro">
            <dl className="flex flex-col gap-2.5 text-sm">
              <Dato etiqueta="Sucursal" valor={s.sucursal} campo="sucursal" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Fecha de carga" valor={s.fechaCarga} campo="fechaCarga" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Fecha del siniestro" valor={s.fecha} campo="fecha" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="N.º de siniestro" valor={s.numeroSiniestro} campo="numeroSiniestro" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Cobertura" valor={s.cobertura} campo="cobertura" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Patente" valor={s.patente} campo="patente" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Importe" valor={s.importe} campo="importe" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato etiqueta="Qué pasó" valor={s.descripcion} campo="descripcion" siniestroId={s.id} soloLectura={!puedeEditar} alGuardar={hacer} />
              <Dato
                etiqueta="Abogado"
                valor={s.abogado}
                campo="abogado"
                siniestroId={s.id}
                soloLectura={!puedeEditar}
                alGuardar={hacer}
                ayuda="Estudio, nombre y teléfono de quien lleve lo legal."
              />
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Teléfono</dt>
                <dd className="text-slate-800">{s.telefono ?? '—'}</dd>
              </div>
            </dl>
          </Tarjeta>

          {/* --- El otro auto: con esto se reclama, y de los lesionados depende la constancia médica --- */}
          <Tarjeta titulo="El tercero" descripcion="Con quién hay que hablar del otro lado, y si hubo heridos.">
            <dl className="flex flex-col gap-2.5 text-sm">
              <Dato
                etiqueta="Compañía del tercero"
                valor={s.terceroCompania}
                campo="terceroCompania"
                siniestroId={s.id}
                soloLectura={!puedeEditar}
                alGuardar={hacer}
              />
              <Dato
                etiqueta="Teléfono del tercero"
                valor={s.terceroTelefono}
                campo="terceroTelefono"
                siniestroId={s.id}
                soloLectura={!puedeEditar}
                alGuardar={hacer}
              />
              <Dato
                etiqueta="Patente del tercero"
                valor={s.terceroPatente}
                campo="terceroPatente"
                siniestroId={s.id}
                soloLectura={!puedeEditar}
                alGuardar={hacer}
              />
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Terceros lesionados</dt>
                <dd className="mt-0.5">
                  <select
                    value={s.terceroLesionados}
                    disabled={bloqueado}
                    aria-label="Terceros lesionados"
                    onChange={(evento) => void hacer(() => window.dm.siniestros.editar(s.id, 'terceroLesionados', evento.target.value))}
                    className={cx(
                      'h-8 rounded-lg border px-2 text-sm font-semibold disabled:opacity-60',
                      s.terceroLesionados === 'SI'
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : s.terceroLesionados === 'NO'
                          ? 'border-green-300 bg-green-50 text-green-700'
                          : 'border-slate-300 bg-white text-slate-500',
                    )}
                  >
                    <option value="">Todavía no se sabe</option>
                    <option value="NO">No hubo lesionados</option>
                    <option value="SI">Sí, hubo lesionados</option>
                  </select>
                </dd>
              </div>
              {s.terceroLesionados === 'SI' && (
                <Dato
                  etiqueta="Quién se lesionó"
                  valor={s.terceroLesionadosDetalle}
                  campo="terceroLesionadosDetalle"
                  siniestroId={s.id}
                  soloLectura={!puedeEditar}
                  alGuardar={hacer}
                  ayuda="Nombre y a qué hospital fue; hace falta para la constancia médica."
                />
              )}
            </dl>
          </Tarjeta>
        </div>

        {/* --- Columna del medio: la línea de tiempo --- */}
        <Tarjeta
          titulo="Línea de tiempo"
          descripcion="Cada observación queda fechada y firmada. No se edita ni se borra: se agrega."
          className="lg:col-span-2"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <AreaTexto
                etiqueta="Nueva observación"
                rows={2}
                value={observacion}
                onChange={(evento) => setObservacion(evento.target.value)}
                placeholder="Se pidió la denuncia policial, el perito viene el jueves…"
              />
              <div className="flex justify-end">
                <Boton
                  variante="primario"
                  icono="mas"
                  disabled={!observacion.trim() || !puedeEditar}
                  cargando={trabajando}
                  onClick={async () => {
                    const ok = await hacer(() => window.dm.siniestros.agregarObservacion(s.id, observacion))
                    if (ok) setObservacion('')
                  }}
                >
                  Agregar
                </Boton>
              </div>
            </div>

            <ol className="flex flex-col gap-3 border-t border-slate-200 pt-3">
              {ficha.observaciones.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Todavía no hay observaciones.</li>}
              {ficha.observaciones.map((entrada) => (
                <li key={entrada.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-marino-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-slate-800">{entrada.texto}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fechaYHora(entrada.creadoEn)} · {entrada.usuarioNombre}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* --- Documentos --- */}
        <Tarjeta
          titulo="Documentos"
          descripcion={`Se guardan en ${ficha.carpetaDeAdjuntos} y, si hay conexión con Google, se suben además a la carpeta «Adjuntos DM» del Drive.`}
          acciones={
            <Boton icono="clip" cargando={trabajando} disabled={!puedeEditar} onClick={() => setAdjuntarAbierto(true)}>
              Adjuntar
            </Boton>
          }
        >
          {ficha.adjuntos.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Todavía no hay documentos adjuntos.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {ficha.adjuntos.map((adjunto) => (
                <li key={adjunto.id} className="flex items-center gap-3 py-2">
                  <Icono nombre="carpeta" tamano={16} className="shrink-0 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => void window.dm.siniestros.abrirAdjunto(adjunto.id)}
                    className="min-w-0 flex-1 text-left text-sm font-medium text-marino-700 hover:underline"
                  >
                    <span className="block truncate">{adjunto.nombre}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      {pesoDeArchivo(adjunto.tamano)} · {fechaYHora(adjunto.creadoEn)} · {adjunto.usuarioNombre}
                      {adjunto.enDrive && ' · en Drive'}
                    </span>
                  </button>
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      adjunto.categoria ? 'bg-marino-50 text-marino-800' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {adjunto.categoria ? adjunto.categoriaDetalle ?? adjunto.categoria : 'Sin categoría'}
                  </span>
                  {adjunto.errorDeDrive && (
                    <span className="shrink-0 text-xs text-amber-700" title={adjunto.errorDeDrive}>
                      sólo local
                    </span>
                  )}
                  {puedeBorrarDocumentos && (
                    <button
                      type="button"
                      aria-label={`Borrar ${adjunto.nombre}`}
                      onClick={() => void hacer(() => window.dm.siniestros.borrarAdjunto(adjunto.id))}
                      className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Icono nombre="basura" tamano={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        {/* --- Tareas vinculadas --- */}
        <Tarjeta
          titulo="Tareas"
          descripcion="Lo que hay que hacer para que el trámite avance."
          acciones={
            <Boton icono="mas" disabled={!puedeEditar} onClick={() => setTareaAbierta(true)}>
              Nueva tarea
            </Boton>
          }
        >
          {ficha.tareas.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No hay tareas vinculadas a este siniestro.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {ficha.tareas.map((tarea) => (
                <li key={tarea.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-sm font-medium', tarea.estado === 'hecha' ? 'text-slate-400 line-through' : 'text-slate-900')}>
                      {tarea.titulo}
                    </p>
                    {tarea.detalle && <p className="text-xs text-slate-500">{tarea.detalle}</p>}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[tarea.responsableNombre ?? 'sin responsable', tarea.venceEl ? `vence ${tarea.venceEl}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <select
                    value={tarea.estado}
                    disabled={bloqueado}
                    aria-label={`Estado de ${tarea.titulo}`}
                    onChange={(evento) =>
                      void hacer(() => window.dm.siniestros.cambiarEstadoDeTarea(tarea.id, evento.target.value as EstadoTarea))
                    }
                    className="h-8 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700"
                  >
                    {(['pendiente', 'en gestion', 'hecha'] as const).map((estado) => (
                      <option key={estado} value={estado}>
                        {NOMBRE_ESTADO_TAREA[estado]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {adjuntarAbierto && (
        <DialogoAdjuntar
          siniestroId={s.id}
          alCerrar={() => setAdjuntarAbierto(false)}
          alAdjuntar={(nueva) => {
            setFicha(nueva)
            setAdjuntarAbierto(false)
          }}
        />
      )}

      {tareaAbierta && (
        <DialogoTarea
          siniestroId={s.id}
          responsables={ficha.responsables}
          alCerrar={() => setTareaAbierta(false)}
          alCrear={(nueva) => {
            setFicha(nueva)
            setTareaAbierta(false)
          }}
        />
      )}
    </div>
  )
}

/** Un dato de la hoja que se corrige con doble clic, como en la planilla del mes. */
function Dato({
  etiqueta,
  valor,
  campo,
  siniestroId,
  soloLectura,
  alGuardar,
  ayuda,
}: {
  etiqueta: string
  valor: string | null
  campo: string
  siniestroId: number
  soloLectura: boolean
  alGuardar: (accion: () => Promise<{ ok: true; datos: Ficha } | { ok: false; error: string }>) => Promise<boolean>
  /** Una línea que explica qué se espera acá; sólo se muestra mientras el dato está vacío. */
  ayuda?: string
}) {
  const [editando, setEditando] = useState(false)

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{etiqueta}</dt>
      <dd>
        {editando ? (
          <input
            autoFocus
            defaultValue={valor ?? ''}
            onBlur={async (evento) => {
              await alGuardar(() => window.dm.siniestros.editar(siniestroId, campo, evento.target.value))
              setEditando(false)
            }}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') evento.currentTarget.blur()
              if (evento.key === 'Escape') setEditando(false)
            }}
            className="w-full rounded border border-marino-400 bg-white px-1.5 py-0.5 text-sm outline-none ring-2 ring-marino-500/30"
          />
        ) : (
          <span
            onDoubleClick={soloLectura ? undefined : () => setEditando(true)}
            title={soloLectura ? undefined : 'Doble clic para corregir'}
            className={cx('block rounded px-1 py-0.5 text-slate-800', !soloLectura && 'cursor-text hover:bg-slate-50')}
          >
            {valor || <span className="text-slate-400">{ayuda && !soloLectura ? ayuda : '—'}</span>}
          </span>
        )}
      </dd>
    </div>
  )
}

/**
 * Qué se está por adjuntar. Se pregunta ANTES de abrir el explorador de archivos: elegir las fotos y
 * recién después tener que decir qué son sería hacer el trabajo dos veces, y la categoría vale para
 * toda la tanda (las seis fotos del choque se eligen juntas y se guardan juntas).
 */
function DialogoAdjuntar({
  siniestroId,
  alCerrar,
  alAdjuntar,
}: {
  siniestroId: number
  alCerrar: () => void
  alAdjuntar: (ficha: Ficha) => void
}) {
  const [categoria, setCategoria] = useState<CategoriaDeAdjunto>(CATEGORIAS_DE_ADJUNTO[0])
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const pideDetalle = categoria === CATEGORIA_DE_ADJUNTO_OTRAS

  const adjuntar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.siniestros.adjuntar(siniestroId, null, categoria, detalle)
    setGuardando(false)
    if (resultado.ok) alAdjuntar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Adjuntar documentos"
      descripcion="Decí qué documento es y después elegí los archivos."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton
            variante="primario"
            icono="clip"
            onClick={() => void adjuntar()}
            cargando={guardando}
            disabled={pideDetalle && !detalle.trim()}
          >
            Elegir archivos…
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Selector
          etiqueta="Qué documento es"
          value={categoria}
          onChange={(evento) => setCategoria(evento.target.value as CategoriaDeAdjunto)}
          opciones={CATEGORIAS_DE_ADJUNTO.map((opcion) => ({ valor: opcion, texto: opcion }))}
          ayuda="Vale para todos los archivos que elijas ahora."
        />
        {pideDetalle && (
          <Campo
            etiqueta="Indicá cuál"
            value={detalle}
            onChange={(evento) => setDetalle(evento.target.value)}
            autoFocus
            ayuda="Presupuesto del taller, telegrama, acta de la compañía…"
          />
        )}
      </div>
    </Dialogo>
  )
}

function DialogoTarea({
  siniestroId,
  responsables,
  alCerrar,
  alCrear,
}: {
  siniestroId: number
  responsables: Array<{ id: number; nombre: string }>
  alCerrar: () => void
  alCrear: (ficha: Ficha) => void
}) {
  const [titulo, setTitulo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [responsableId, setResponsableId] = useState('')
  const [venceEl, setVenceEl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.siniestros.crearTarea({
      siniestroId,
      titulo,
      detalle,
      responsableId: responsableId ? Number(responsableId) : null,
      venceEl,
    })
    setGuardando(false)
    if (resultado.ok) alCrear(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Nueva tarea del siniestro"
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!titulo.trim()}>
            Crear tarea
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Campo etiqueta="Título" value={titulo} onChange={(evento) => setTitulo(evento.target.value)} autoFocus />
        <AreaTexto etiqueta="Detalle" rows={2} value={detalle} onChange={(evento) => setDetalle(evento.target.value)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Selector
            etiqueta="Responsable"
            value={responsableId}
            onChange={(evento) => setResponsableId(evento.target.value)}
            opciones={[{ valor: '', texto: '(sin responsable)' }, ...responsables.map((r) => ({ valor: String(r.id), texto: r.nombre }))]}
          />
          <Campo etiqueta="Vence el" type="date" value={venceEl} onChange={(evento) => setVenceEl(evento.target.value)} />
        </div>
      </div>
    </Dialogo>
  )
}
