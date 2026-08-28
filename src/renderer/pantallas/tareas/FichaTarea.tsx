// La ficha de una tarea: qué hay que hacer, a quién le toca, la conversación y los documentos.
//
// Todo lo de arriba se edita en el lugar y se guarda de una: una tarea cambia de dueño y de fecha
// todo el tiempo, y abrir un diálogo para mover una fecha es una fricción que no se banca nadie.
import { useCallback, useEffect, useState } from 'react'
import {
  ESTADOS_DE_TAREA,
  NOMBRE_ESTADO_TAREA,
  PRIORIDADES_DE_TAREA,
  type DatosDeEdicionDeTarea,
  type EstadoTarea,
  type FichaTarea as Ficha,
  type PrioridadTarea,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Selector, Tarjeta, cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { CLASES_PRIORIDAD, EtiquetaDeVencimiento } from './Tareas'

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

export function FichaTarea({ tareaId, alVolver }: { tareaId: number; alVolver: () => void }) {
  const { ir } = useNavegacion()
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('tareas')
  const puedeBorrarDocumentos = usuario.rol !== 'EMPLEADO' && puedeEditar

  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [edicion, setEdicion] = useState<DatosDeEdicionDeTarea | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.tareas.ficha(tareaId)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }, [tareaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hacer = async (accion: () => Promise<{ ok: true; datos: Ficha } | { ok: false; error: string }>) => {
    setTrabajando(true)
    setError(null)
    const resultado = await accion()
    setTrabajando(false)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setEdicion(null)
    } else setError(resultado.error)
    return resultado.ok
  }

  if (!ficha) {
    return (
      <div className="p-8">
        {error ? <Alerta tono="error">{error}</Alerta> : <Cargando texto="Abriendo la tarea…" />}
        <div className="mt-4">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>
        </div>
      </div>
    )
  }

  const t = ficha.tarea
  /** Los datos editables arrancan de lo que hay: se «entra en edición» al tocar cualquier campo. */
  const actuales: DatosDeEdicionDeTarea = edicion ?? {
    titulo: t.titulo,
    detalle: t.detalle ?? '',
    responsableId: t.responsableId,
    sucursal: t.sucursal ?? '',
    venceEl: t.venceEl ?? '',
    prioridad: t.prioridad,
    estado: t.estado,
  }
  const cambiar = (cambios: Partial<DatosDeEdicionDeTarea>) => setEdicion({ ...actuales, ...cambios })

  /** A qué módulo salta el vínculo de la tarea. */
  const abrirVinculo = () => {
    if (t.siniestroId !== null) return ir('siniestros', { siniestroId: t.siniestroId })
    if (t.leadId !== null) return ir('leads', { leadId: t.leadId })
    if (t.presupuestoId !== null) return ir('presupuestos', { presupuestoId: t.presupuestoId })
    if (t.polizaId !== null) return ir('polizas', { polizaId: t.polizaId })
    if (t.clienteId !== null) return ir('clientes', { clienteId: t.clienteId })
  }

  // Sin `.sort()`: `ficha.sucursales` ya viene en el orden de la agencia y reordenarla acá hacía que la
  // ficha y el listado ofrecieran la misma lista en dos órdenes distintos. La sucursal de la tarea va
  // al final por si es una vieja que no está en la lista: abrirla no puede hacerle perder su valor.
  const opcionesDeSucursal = [...new Set([...ficha.sucursales, actuales.sucursal].filter(Boolean))]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Boton icono="flechaIzquierda" onClick={alVolver}>
          Volver
        </Boton>
        <div className="min-w-0 flex-1">
          <h1 className={cx('font-display text-2xl font-extrabold tracking-tight', t.estado === 'hecha' ? 'text-slate-400 line-through' : 'text-slate-900')}>
            {t.titulo}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>Creada por {t.creadoPor} el {fechaYHora(t.creadoEn)}</span>
            <EtiquetaDeVencimiento tarea={t} />
          </p>
        </div>

        <select
          value={t.estado}
          disabled={trabajando || !puedeEditar}
          aria-label="Estado de la tarea"
          onChange={(e) => void hacer(async () => {
            const cambio = await window.dm.tareas.cambiarEstado(t.id, e.target.value as EstadoTarea)
            if (!cambio.ok) return cambio
            return window.dm.tareas.ficha(t.id)
          })}
          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
        >
          {ESTADOS_DE_TAREA.map((estado) => (
            <option key={estado} value={estado}>
              {NOMBRE_ESTADO_TAREA[estado]}
            </option>
          ))}
        </select>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      {t.vinculo !== 'suelta' && (
        <Alerta tono="info">
          Esta tarea cuelga de {t.vinculoTexto}.{' '}
          <button type="button" onClick={abrirVinculo} className="font-semibold underline underline-offset-2">
            Abrir la ficha
          </button>
          .
        </Alerta>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Tarjeta
          titulo="La tarea"
          className="lg:col-span-2"
          acciones={
            edicion && (
              <>
                <Boton tamano="sm" onClick={() => setEdicion(null)} disabled={trabajando}>
                  Descartar
                </Boton>
                <Boton
                  tamano="sm"
                  variante="primario"
                  icono="ok"
                  cargando={trabajando}
                  onClick={() => void hacer(() => window.dm.tareas.editar(t.id, actuales))}
                >
                  Guardar
                </Boton>
              </>
            )
          }
        >
          <div className="flex flex-col gap-4">
            <Campo etiqueta="Qué hay que hacer" value={actuales.titulo} disabled={!puedeEditar} onChange={(e) => cambiar({ titulo: e.target.value })} />
            <AreaTexto etiqueta="Descripción" rows={4} value={actuales.detalle} disabled={!puedeEditar} onChange={(e) => cambiar({ detalle: e.target.value })} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Selector
                etiqueta="Asignada a"
                value={actuales.responsableId ?? ''}
                disabled={!puedeEditar}
                onChange={(e) => cambiar({ responsableId: e.target.value ? Number(e.target.value) : null })}
                opciones={[{ valor: '', texto: 'Sin responsable' }, ...ficha.responsables.map((r) => ({ valor: r.id, texto: r.nombre }))]}
              />
              <Selector
                etiqueta="Sucursal"
                value={actuales.sucursal}
                disabled={!puedeEditar}
                onChange={(e) => cambiar({ sucursal: e.target.value })}
                opciones={[{ valor: '', texto: 'Sin sucursal' }, ...opcionesDeSucursal.map((s) => ({ valor: s, texto: s }))]}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo etiqueta="Vence" type="date" value={actuales.venceEl} disabled={!puedeEditar} onChange={(e) => cambiar({ venceEl: e.target.value })} />
              <Selector
                etiqueta="Prioridad"
                value={actuales.prioridad}
                disabled={!puedeEditar}
                onChange={(e) => cambiar({ prioridad: e.target.value as PrioridadTarea })}
                opciones={PRIORIDADES_DE_TAREA.map((p) => ({ valor: p, texto: p }))}
              />
            </div>
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Documentos"
          descripcion={`Se guardan en ${ficha.carpetaDeAdjuntos} y, si hay conexión con Google, se suben además a la carpeta «Adjuntos DM» del Drive.`}
          acciones={
            <Boton icono="clip" cargando={trabajando} disabled={!puedeEditar} onClick={() => void hacer(() => window.dm.tareas.adjuntar(t.id, null))}>
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
                    onClick={() => void window.dm.tareas.abrirAdjunto(adjunto.id)}
                    className="min-w-0 flex-1 text-left text-sm font-medium text-marino-700 hover:underline"
                  >
                    <span className="block truncate">{adjunto.nombre}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      {pesoDeArchivo(adjunto.tamano)} · {fechaYHora(adjunto.creadoEn)} · {adjunto.usuarioNombre}
                      {adjunto.enDrive && ' · en Drive'}
                    </span>
                  </button>
                  {adjunto.errorDeDrive && (
                    <span className="shrink-0 text-xs text-amber-700" title={adjunto.errorDeDrive}>
                      sólo local
                    </span>
                  )}
                  {puedeBorrarDocumentos && (
                    <button
                      type="button"
                      aria-label={`Borrar ${adjunto.nombre}`}
                      onClick={() => void hacer(() => window.dm.tareas.borrarAdjunto(adjunto.id))}
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
      </div>

      <Tarjeta titulo="Comentarios" descripcion="Cómo viene. Queda con fecha y con quién lo escribió.">
        <div className="flex flex-col gap-3">
          <AreaTexto
            etiqueta="Nuevo comentario"
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Llamé y no atendieron, vuelvo a probar mañana a la mañana…"
          />
          <div className="flex items-center gap-3">
            <span className={cx('rounded-full border px-2.5 py-0.5 text-xs font-semibold', CLASES_PRIORIDAD[t.prioridad])}>
              Prioridad {t.prioridad}
            </span>
            <Boton
              variante="primario"
              icono="mas"
              className="ml-auto"
              disabled={!comentario.trim() || !puedeEditar}
              cargando={trabajando}
              onClick={async () => {
                const ok = await hacer(() => window.dm.tareas.comentar(t.id, comentario))
                if (ok) setComentario('')
              }}
            >
              Comentar
            </Boton>
          </div>

          <ol className="flex flex-col gap-3 border-t border-slate-200 pt-3">
            {ficha.comentarios.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Todavía no hay comentarios.</li>}
            {ficha.comentarios.map((entrada) => (
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
  )
}
