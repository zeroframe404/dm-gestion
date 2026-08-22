// La ficha de una consulta: los datos, la charla con sus fechas, los presupuestos que se le pasaron y
// las tareas pendientes.
//
// El botón que importa es «Convertir en cliente»: crea el cliente con estos mismos datos y abre el
// formulario de póliza nueva. Ése es el punto del módulo entero —que nadie vuelva a tipear el nombre y
// el teléfono que ya están escritos acá.
import { useCallback, useEffect, useState } from 'react'
import { ESTADOS_DE_LEAD, NOMBRE_ORIGEN_LEAD, type EstadoLead, type FichaLead as Ficha } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Cargando, Dialogo, Tarjeta, cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { DialogoLead } from './DialogoLead'
import { CLASES_ESTADO_LEAD } from './Leads'

function fechaYHora(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function FichaLead({ leadId, alVolver }: { leadId: number; alVolver: () => void }) {
  const { ir } = useNavegacion()
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [nota, setNota] = useState('')
  const [editarAbierto, setEditarAbierto] = useState(false)
  const [conversion, setConversion] = useState<{ clienteId: number; clienteNombre: string; aviso: string | null } | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.leads.ficha(leadId)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }, [leadId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hacer = async (accion: () => Promise<{ ok: true; datos: Ficha } | { ok: false; error: string }>) => {
    setTrabajando(true)
    setError(null)
    const resultado = await accion()
    setTrabajando(false)
    if (resultado.ok) setFicha(resultado.datos)
    else setError(resultado.error)
    return resultado.ok
  }

  const convertir = async () => {
    setTrabajando(true)
    setError(null)
    const resultado = await window.dm.leads.convertir(leadId)
    setTrabajando(false)
    if (!resultado.ok) return setError(resultado.error)
    setFicha(resultado.datos.lead)
    setConversion({
      clienteId: resultado.datos.clienteId,
      clienteNombre: resultado.datos.clienteNombre,
      aviso: resultado.datos.aviso,
    })
  }

  if (!ficha) {
    return (
      <div className="p-8">
        {error ? <Alerta tono="error">{error}</Alerta> : <Cargando texto="Abriendo la consulta…" />}
        <div className="mt-4">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>
        </div>
      </div>
    )
  }

  const lead = ficha.lead

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Boton icono="flechaIzquierda" onClick={alVolver}>
          Volver
        </Boton>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">{lead.nombre}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {[lead.telefono, lead.sucursal, NOMBRE_ORIGEN_LEAD[lead.origen]].filter(Boolean).join(' · ')}
          </p>
        </div>

        <select
          value={lead.estado}
          disabled={trabajando}
          aria-label="Estado de la consulta"
          onChange={(e) => void hacer(() => window.dm.leads.cambiarEstado(lead.id, e.target.value as EstadoLead))}
          className={cx('h-9 rounded-lg border px-2 text-sm font-semibold disabled:opacity-60', CLASES_ESTADO_LEAD[lead.estado])}
        >
          {ESTADOS_DE_LEAD.map((estado) => (
            <option key={estado} value={estado}>
              {estado}
            </option>
          ))}
        </select>

        {lead.urlWhatsapp && (
          <Boton icono="mensaje" onClick={() => void window.dm.sistema.abrirEnlace(lead.urlWhatsapp!)}>
            WhatsApp
          </Boton>
        )}
        <Boton icono="lapiz" onClick={() => setEditarAbierto(true)}>
          Editar
        </Boton>
        <Boton variante="primario" icono="clientes" cargando={trabajando} onClick={() => void convertir()}>
          Convertir en cliente
        </Boton>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {lead.clienteId !== null && (
        <Alerta tono="exito">
          Esta consulta ya es cliente.{' '}
          <button
            type="button"
            onClick={() => ir('clientes', { clienteId: lead.clienteId! })}
            className="font-semibold underline underline-offset-2"
          >
            Abrir su ficha
          </button>
          .
        </Alerta>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Qué quería" className="lg:col-span-1">
          <dl className="flex flex-col gap-2.5 text-sm">
            <Dato etiqueta="Asegurar" valor={lead.interes} />
            <Dato etiqueta="Tipo" valor={lead.tipoVehiculo} />
            <Dato etiqueta="DNI / CUIT" valor={lead.documento} />
            <Dato etiqueta="Email" valor={lead.email} />
            <Dato etiqueta="Cargada por" valor={lead.usuarioNombre} />
            <Dato etiqueta="Entró el" valor={fechaYHora(lead.creadoEn)} />
          </dl>
        </Tarjeta>

        <Tarjeta
          titulo="La charla"
          descripcion="Cada nota queda con su fecha y quién la escribió. No se edita ni se borra: se agrega."
          className="lg:col-span-2"
        >
          <div className="flex flex-col gap-3">
            <AreaTexto
              etiqueta="Nueva nota"
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Le pasé el precio de Sancor, dijo que lo consulta con el marido y llama el lunes…"
            />
            <div className="flex justify-end">
              <Boton
                variante="primario"
                icono="mas"
                disabled={!nota.trim()}
                cargando={trabajando}
                onClick={async () => {
                  const ok = await hacer(() => window.dm.leads.agregarNota(lead.id, nota))
                  if (ok) setNota('')
                }}
              >
                Agregar
              </Boton>
            </div>

            <ol className="flex flex-col gap-3 border-t border-slate-200 pt-3">
              {ficha.notas.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Todavía no hay notas.</li>}
              {ficha.notas.map((entrada) => (
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
        <Tarjeta
          titulo="Presupuestos"
          descripcion="Lo que se le cotizó a esta consulta."
          acciones={
            <Boton icono="mas" onClick={() => ir('presupuestos', { nuevoPresupuestoParaLead: lead.id })}>
              Nuevo presupuesto
            </Boton>
          }
        >
          {ficha.presupuestos.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Todavía no se le pasó ningún precio.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {ficha.presupuestos.map((presupuesto) => (
                <li key={presupuesto.id} className="flex items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => ir('presupuestos', { presupuestoId: presupuesto.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-sm font-medium text-marino-700 hover:underline">
                      {presupuesto.numero}
                      {presupuesto.version > 1 && ` v${presupuesto.version}`}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {presupuesto.opciones} opción(es)
                      {presupuesto.desde && ` · desde ${presupuesto.desde}`}
                    </span>
                  </button>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {presupuesto.estado}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Tareas" descripcion="Lo que falta hacer con esta consulta.">
          {ficha.tareas.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No hay tareas vinculadas. Se crean desde el módulo Tareas eligiendo esta consulta.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {ficha.tareas.map((tarea) => (
                <li key={tarea.id} className="flex items-center gap-3 py-2">
                  <button type="button" onClick={() => ir('tareas', { tareaId: tarea.id })} className="min-w-0 flex-1 text-left">
                    <span
                      className={cx('block text-sm font-medium', tarea.estado === 'hecha' ? 'text-slate-400 line-through' : 'text-slate-900')}
                    >
                      {tarea.titulo}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {[tarea.responsableNombre ?? 'sin responsable', tarea.venceEl ? `vence ${tarea.venceEl}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                  {tarea.vencida && <Icono nombre="alerta" tamano={15} className="shrink-0 text-red-500" />}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {editarAbierto && (
        <DialogoLead
          lead={lead}
          sucursales={lead.sucursal ? [lead.sucursal] : []}
          alCerrar={() => setEditarAbierto(false)}
          alGuardar={(nueva) => {
            setFicha(nueva)
            setEditarAbierto(false)
          }}
        />
      )}

      {conversion && (
        <Dialogo
          abierto
          titulo="Listo: ya es cliente"
          alCerrar={() => setConversion(null)}
          ancho="sm"
          pie={
            <>
              <Boton onClick={() => setConversion(null)}>Después</Boton>
              <Boton variante="primario" icono="polizas" onClick={() => ir('polizas', { nuevaPolizaPara: conversion.clienteId })}>
                Cargar la póliza
              </Boton>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm text-slate-700">
            <p>
              <strong className="font-semibold text-slate-900">{conversion.clienteNombre}</strong> quedó en Clientes con los datos de esta
              consulta.
            </p>
            {conversion.aviso && <Alerta tono="aviso">{conversion.aviso}</Alerta>}
            <p>Si ya tenés la póliza emitida, cargala ahora: el formulario se abre con el cliente puesto.</p>
          </div>
        </Dialogo>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{etiqueta}</dt>
      <dd className="text-slate-800">{valor || '—'}</dd>
    </div>
  )
}
