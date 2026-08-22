// La ficha del presupuesto: las opciones cotizadas, el mensaje de WhatsApp tal cual va a salir, y los
// tres botones que importan —mandarlo, imprimirlo y marcar cuál aceptó el cliente.
//
// El mensaje se muestra entero antes de mandarlo. No es decorativo: es lo que la persona va a leer, y
// verlo acá es lo que evita mandar un presupuesto con una compañía de menos.
import { useCallback, useEffect, useState } from 'react'
import type { FichaPresupuesto as Ficha, OpcionDePresupuesto } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Cargando, Dialogo, Tarjeta, cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { FormularioPresupuesto } from './FormularioPresupuesto'
import { CLASES_ESTADO_PRESUPUESTO } from './Presupuestos'

function fechaYHora(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function FichaPresupuesto({ presupuestoId, alVolver }: { presupuestoId: number; alVolver: () => void }) {
  const { ir } = useNavegacion()
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [editarAbierto, setEditarAbierto] = useState(false)
  const [rechazoAbierto, setRechazoAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [aceptada, setAceptada] = useState<{ opcion: OpcionDePresupuesto; clienteId: number | null; aviso: string | null } | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.presupuestos.ficha(presupuestoId)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }, [presupuestoId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const enviar = async () => {
    setTrabajando(true)
    setError(null)
    const resultado = await window.dm.presupuestos.enviar(presupuestoId)
    setTrabajando(false)
    if (!resultado.ok) return setError(resultado.error)
    setFicha(resultado.datos.ficha)
    await window.dm.sistema.abrirEnlace(resultado.datos.url)
  }

  const aceptar = async (opcion: OpcionDePresupuesto) => {
    setTrabajando(true)
    setError(null)
    const resultado = await window.dm.presupuestos.aceptar(presupuestoId, opcion.id)
    setTrabajando(false)
    if (!resultado.ok) return setError(resultado.error)
    setFicha(resultado.datos.ficha)
    setAceptada({ opcion, clienteId: resultado.datos.clienteId, aviso: resultado.datos.aviso })
  }

  const guardarPdf = async () => {
    setTrabajando(true)
    setError(null)
    const resultado = await window.dm.presupuestos.guardarPdf(presupuestoId)
    setTrabajando(false)
    if (!resultado.ok) return setError(resultado.error)
    if (resultado.datos.ruta) setAviso(`Se guardó en ${resultado.datos.ruta}`)
  }

  if (!ficha) {
    return (
      <div className="p-8">
        {error ? <Alerta tono="error">{error}</Alerta> : <Cargando texto="Abriendo el presupuesto…" />}
        <div className="mt-4">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>
        </div>
      </div>
    )
  }

  const p = ficha.presupuesto
  const vehiculo = [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Boton icono="flechaIzquierda" onClick={alVolver}>
          Volver
        </Boton>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">
            {p.numero}
            {p.version > 1 && <span className="ml-2 align-middle text-base font-bold text-slate-400">versión {p.version}</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {[p.clienteNombre, vehiculo, p.patente, p.sucursal].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className={cx('rounded-full border px-3 py-1 text-sm font-semibold', CLASES_ESTADO_PRESUPUESTO[p.estado])}>{p.estado}</span>
      </div>

      {!p.vigente && (
        <Alerta tono="aviso">
          Ésta es una versión vieja de {p.numero}: se guarda como estaba, pero ya no se edita. Abrí la última desde el listado.
        </Alerta>
      )}
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" icono="mensaje" cargando={trabajando} disabled={!p.vigente} onClick={() => void enviar()}>
          Enviar por WhatsApp
        </Boton>
        <Boton icono="descargar" cargando={trabajando} onClick={() => void guardarPdf()}>
          Guardar en PDF
        </Boton>
        <Boton icono="impresora" cargando={trabajando} onClick={() => void window.dm.presupuestos.imprimir(presupuestoId)}>
          Imprimir
        </Boton>
        <Boton icono="lapiz" disabled={!p.vigente} onClick={() => setEditarAbierto(true)}>
          Editar
        </Boton>
        {p.estado !== 'RECHAZADO' && p.vigente && (
          <Boton variante="peligro" icono="cerrar" onClick={() => setRechazoAbierto(true)} className="ml-auto">
            No lo tomó
          </Boton>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* --- Las opciones --- */}
        <Tarjeta
          titulo="Opciones cotizadas"
          descripcion="La más barata arriba. Tocá «Aceptar» en la que eligió el cliente."
          className="lg:col-span-3"
          alRas
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-y border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-4 py-2">Compañía</th>
                  <th className="px-4 py-2">Cobertura</th>
                  <th className="px-4 py-2">Por mes</th>
                  <th className="px-4 py-2">Comentario</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {ficha.opciones.map((opcion) => (
                  <tr key={opcion.id} className={cx('border-b border-slate-100 last:border-b-0', opcion.aceptada && 'bg-green-50')}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{opcion.compania}</td>
                    <td className="px-4 py-2.5 text-slate-600">{opcion.cobertura}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-900">{opcion.precio || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{opcion.comentario ?? ''}</td>
                    <td className="px-4 py-2 text-right">
                      {opcion.aceptada ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                          <Icono nombre="ok" tamano={14} />
                          Aceptada
                        </span>
                      ) : (
                        p.vigente && (
                          <Boton tamano="sm" cargando={trabajando} onClick={() => void aceptar(opcion)}>
                            Aceptar
                          </Boton>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        {/* --- El mensaje, tal cual va a salir --- */}
        <Tarjeta titulo="El mensaje" descripcion="Así lo va a recibir el cliente." className="lg:col-span-2">
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
            {ficha.mensaje}
          </pre>
          {!ficha.urlWhatsapp && (
            <p className="mt-2 text-xs text-amber-700">
              No tiene teléfono cargado: completalo con «Editar» para poder mandarlo por WhatsApp.
            </p>
          )}
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Datos">
          <dl className="flex flex-col gap-2.5 text-sm">
            <Dato etiqueta="Cliente" valor={p.clienteNombre} />
            <Dato etiqueta="Teléfono" valor={p.telefono} />
            <Dato etiqueta="DNI / CUIT" valor={p.documento} />
            <Dato etiqueta="Vehículo" valor={[vehiculo, p.patente].filter(Boolean).join(' · ')} />
            <Dato etiqueta="Observaciones" valor={p.observaciones} />
            <Dato etiqueta="Cargado por" valor={p.usuarioNombre} />
            <Dato etiqueta="Creado el" valor={fechaYHora(p.creadoEn)} />
            {p.enviadoEn && <Dato etiqueta="Enviado el" valor={fechaYHora(p.enviadoEn)} />}
            {p.aceptadoEn && <Dato etiqueta="Aceptado el" valor={fechaYHora(p.aceptadoEn)} />}
          </dl>
        </Tarjeta>

        <Tarjeta titulo="Versiones" descripcion="Cada vez que se cambia un presupuesto ya enviado queda una versión nueva; ésta es la historia.">
          {ficha.versiones.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Es la única versión de {p.numero}.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {ficha.versiones.map((version) => (
                <li key={version.id} className="flex items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => ir('presupuestos', { presupuestoId: version.id })}
                    className="min-w-0 flex-1 text-left text-sm font-medium text-marino-700 hover:underline"
                  >
                    Versión {version.version}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {version.opciones} opción(es)
                      {version.desde && ` · desde ${version.desde}`} · {fechaYHora(version.creadoEn)}
                    </span>
                  </button>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {version.vigente ? 'Vigente' : version.estado}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {editarAbierto && (
        <FormularioPresupuesto
          ficha={ficha}
          companias={ficha.companias}
          coberturas={ficha.coberturas}
          alCerrar={() => setEditarAbierto(false)}
          alGuardar={(nueva) => {
            setEditarAbierto(false)
            // Si se creó una versión nueva, la ficha que vuelve ya es la de esa versión.
            setFicha(nueva)
            if (nueva.presupuesto.id !== presupuestoId) ir('presupuestos', { presupuestoId: nueva.presupuesto.id })
          }}
        />
      )}

      {rechazoAbierto && (
        <Dialogo
          abierto
          ancho="sm"
          titulo="No lo tomó"
          descripcion="Anotá por qué: dentro de un mes es lo único que explica por qué se perdió."
          alCerrar={() => setRechazoAbierto(false)}
          pie={
            <>
              <Boton onClick={() => setRechazoAbierto(false)}>Cancelar</Boton>
              <Boton
                variante="peligro"
                cargando={trabajando}
                onClick={async () => {
                  setTrabajando(true)
                  const resultado = await window.dm.presupuestos.rechazar(presupuestoId, motivo)
                  setTrabajando(false)
                  if (resultado.ok) {
                    setFicha(resultado.datos)
                    setRechazoAbierto(false)
                    setMotivo('')
                  } else setError(resultado.error)
                }}
              >
                Marcar rechazado
              </Boton>
            </>
          }
        >
          <AreaTexto
            etiqueta="Motivo"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Consiguió más barato en otro lado, lo dejó para más adelante…"
          />
        </Dialogo>
      )}

      {aceptada && (
        <Dialogo
          abierto
          ancho="sm"
          titulo="Aceptó el presupuesto"
          alCerrar={() => setAceptada(null)}
          pie={
            <>
              <Boton onClick={() => setAceptada(null)}>Después</Boton>
              {aceptada.clienteId !== null ? (
                <Boton variante="primario" icono="polizas" onClick={() => ir('polizas', { nuevaPolizaPara: aceptada.clienteId! })}>
                  Cargar la póliza
                </Boton>
              ) : (
                p.leadId !== null && (
                  <Boton variante="primario" icono="clientes" onClick={() => ir('leads', { leadId: p.leadId! })}>
                    Convertir la consulta en cliente
                  </Boton>
                )
              )}
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm text-slate-700">
            <p>
              Quedó marcada <strong className="font-semibold text-slate-900">{aceptada.opcion.compania}</strong> —{' '}
              {aceptada.opcion.cobertura}
              {aceptada.opcion.precio && ` a ${aceptada.opcion.precio} por mes`}.
            </p>
            {aceptada.aviso ? (
              <Alerta tono="aviso">{aceptada.aviso}</Alerta>
            ) : (
              <p>Si ya la tenés emitida, cargá la póliza ahora: el formulario se abre con el cliente puesto.</p>
            )}
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
