// Los dos diálogos que la ficha del cliente abre desde su barra de acciones: registrar un pago y
// cargar un siniestro.
//
// El pago no se inventa acá: se cobra una cuota concreta del mes abierto, que es lo mismo que hace la
// Planilla del mes. Por eso el diálogo primero pregunta CUÁL cuota, y sólo si el cliente tiene una sola
// se saltea esa pregunta. Un cliente sin cuotas este mes no tiene nada que pagar, y se dice.
import { useEffect, useState } from 'react'
import {
  ESTADOS_DE_SINIESTRO,
  type CuotasDelCliente,
  type FichaCliente,
  type FilaCartera,
  type SiniestroDeCliente,
} from '../../../shared/tipos'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { Alerta, AreaTexto, Boton, Campo, Cargando, cx, Dialogo, Selector } from '../../componentes/ui'

// ---------------------------------------------------------------------------
// Registrar pago
// ---------------------------------------------------------------------------

interface PropsPago {
  ficha: FichaCliente
  alCerrar: () => void
  alPagar: (nombre: string) => void
}

export function DialogoPagoDelCliente({ ficha, alCerrar, alPagar }: PropsPago) {
  const [cuotas, setCuotas] = useState<CuotasDelCliente | null>(null)
  const [elegida, setElegida] = useState<FilaCartera | null>(null)
  const [fecha, setFecha] = useState('')
  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vigente = true
    void window.dm.clientes.cuotasDelMes(ficha.id).then((resultado) => {
      if (!vigente) return
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      setCuotas(resultado.datos)
      setFecha(resultado.datos.hoy)
      // Con una sola cuota no tiene sentido preguntar cuál: se abre directo sobre ésa.
      const unica = resultado.datos.filas.length === 1 ? resultado.datos.filas[0]! : null
      if (unica) elegir(unica, resultado.datos)
    })
    return () => {
      vigente = false
    }
  }, [ficha.id])

  const elegir = (fila: FilaCartera, datos: CuotasDelCliente) => {
    setElegida(fila)
    setImporte(fila.cuota ?? '')
    setMedio(fila.formaPago ?? datos.mediosDePago[0] ?? '')
  }

  const guardar = async () => {
    if (!elegida) return
    setGuardando(true)
    const resultado = await window.dm.cartera.registrarPago(elegida.filaId, { fecha, importe, medioDePago: medio })
    setGuardando(false)
    if (resultado.ok) alPagar(ficha.nombre)
    else setError(resultado.error)
  }

  const sinCuotas = cuotas !== null && cuotas.filas.length === 0

  return (
    <Dialogo
      abierto
      titulo="Registrar pago"
      descripcion={cuotas ? `${ficha.nombre} · cuotas de ${nombreDePeriodo(cuotas.periodo)}` : ficha.nombre}
      alCerrar={alCerrar}
      ancho={elegida ? 'sm' : 'md'}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            {sinCuotas ? 'Cerrar' : 'Cancelar'}
          </Boton>
          {elegida && (
            <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
              Guardar pago
            </Boton>
          )}
        </>
      }
    >
      {error && <Alerta tono="error">{error}</Alerta>}

      {!cuotas && !error && <Cargando texto="Buscando las cuotas del mes…" />}

      {sinCuotas && (
        <p className="text-sm leading-relaxed text-slate-600">
          {ficha.nombre} no tiene ninguna cuota en la planilla de este mes, así que no hay nada que cobrarle. Si le
          acabás de cargar una póliza, va a aparecer con el próximo cierre de mes.
        </p>
      )}

      {cuotas && cuotas.filas.length > 0 && !elegida && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-600">¿Cuál de las cuotas está pagando?</p>
          {cuotas.filas.map((fila) => (
            <button
              key={fila.filaId}
              type="button"
              onClick={() => elegir(fila, cuotas)}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-marino-300 hover:bg-marino-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {fila.compania ?? 'Sin compañía'} {fila.numeroPoliza ?? ''}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {fila.patente ?? 'sin patente'} · vence el {fila.diaVencimiento ?? '—'}
                </span>
              </span>
              <span className={cx('shrink-0 text-sm font-semibold tabular-nums', fila.pagoFecha ? 'text-green-700' : 'text-slate-900')}>
                {fila.cuota ?? '—'}
              </span>
            </button>
          ))}
        </div>
      )}

      {elegida && (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            {elegida.compania ?? ''} {elegida.numeroPoliza ?? ''} · {elegida.patente ?? 'sin patente'}
            {cuotas && cuotas.filas.length > 1 && (
              <button type="button" onClick={() => setElegida(null)} className="ml-2 font-semibold text-marino-700 underline">
                cambiar
              </button>
            )}
          </p>
          {elegida.pagoFecha && (
            <Alerta tono="aviso">Esta cuota ya figura paga el {elegida.pago ?? elegida.pagoFecha}. Guardar la vuelve a registrar.</Alerta>
          )}
          <Campo etiqueta="Fecha del pago" type="date" value={fecha} onChange={(evento) => setFecha(evento.target.value)} />
          <Campo
            etiqueta="Importe"
            value={importe}
            onChange={(evento) => setImporte(evento.target.value)}
            ayuda="Viene con la cuota del mes; cambialo si pagó otra cosa."
          />
          <Selector
            etiqueta="Medio de pago"
            value={medio}
            onChange={(evento) => setMedio(evento.target.value)}
            opciones={[{ valor: '', texto: '(sin especificar)' }, ...(cuotas?.mediosDePago ?? []).map((m) => ({ valor: m, texto: m }))]}
          />
        </div>
      )}
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Cargar siniestro
// ---------------------------------------------------------------------------

interface PropsSiniestro {
  ficha: FichaCliente
  alCerrar: () => void
  alCargar: (siniestros: SiniestroDeCliente[]) => void
}

export function DialogoSiniestro({ ficha, alCerrar, alCargar }: PropsSiniestro) {
  // Se ofrecen las pólizas que siguen vigentes: un siniestro se denuncia sobre una póliza en curso.
  const activas = ficha.polizas.filter((p) => p.estado !== 'BAJA')

  const [polizaId, setPolizaId] = useState<string>(activas.length === 1 ? String(activas[0]!.id) : '')
  const [fecha, setFecha] = useState('')
  const [numero, setNumero] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [estado, setEstado] = useState<string>(ESTADOS_DE_SINIESTRO[0])
  const [importe, setImporte] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.siniestros.crear({
      clienteId: ficha.id,
      polizaId: polizaId ? Number(polizaId) : null,
      fecha,
      numeroSiniestro: numero,
      descripcion,
      estado,
      importe,
      observaciones,
    })
    setGuardando(false)
    if (resultado.ok) alCargar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Cargar siniestro"
      descripcion={ficha.nombre}
      alCerrar={alCerrar}
      ancho="md"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton
            variante="primario"
            icono="ok"
            onClick={() => void guardar()}
            cargando={guardando}
            disabled={!fecha || !descripcion.trim()}
          >
            Cargar siniestro
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <Selector
          etiqueta="Póliza"
          value={polizaId}
          onChange={(evento) => setPolizaId(evento.target.value)}
          ayuda={activas.length === 0 ? 'Este cliente no tiene pólizas vigentes: el siniestro queda sin imputar.' : undefined}
          opciones={[
            { valor: '', texto: activas.length === 0 ? '(no tiene pólizas vigentes)' : '(todavía no se sabe)' },
            ...activas.map((p) => ({
              valor: String(p.id),
              texto: `${p.compania ?? 'Sin compañía'} ${p.numero ?? ''} · ${p.patente ?? 'sin patente'}`.trim(),
            })),
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha del siniestro" type="date" value={fecha} onChange={(evento) => setFecha(evento.target.value)} />
          <Campo
            etiqueta="N.º de siniestro"
            value={numero}
            onChange={(evento) => setNumero(evento.target.value)}
            ayuda="El que da la compañía; se puede completar después."
          />
        </div>

        <AreaTexto
          etiqueta="Qué pasó"
          rows={3}
          value={descripcion}
          onChange={(evento) => setDescripcion(evento.target.value)}
          ayuda="Choque, granizo, robo, cristales… con el detalle que haga falta para el reclamo."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(evento) => setEstado(evento.target.value)}
            opciones={ESTADOS_DE_SINIESTRO.map((e) => ({ valor: e, texto: e }))}
          />
          <Campo etiqueta="Importe" value={importe} onChange={(evento) => setImporte(evento.target.value)} />
        </div>

        <AreaTexto etiqueta="Observaciones" rows={2} value={observaciones} onChange={(evento) => setObservaciones(evento.target.value)} />

        <p className="text-xs leading-relaxed text-slate-500">
          Queda en la pestaña <strong className="font-semibold">Siniestros</strong> de la ficha y se sube a la hoja con la
          próxima sincronización. El seguimiento —estado, observaciones fechadas, documentos y tareas— se lleva desde el módulo
          Siniestros.
        </p>
      </div>
    </Dialogo>
  )
}
