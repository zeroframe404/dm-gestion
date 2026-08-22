// Alta manual de un pago desde la caja. El camino normal es buscar al cliente y tocar la cuota del
// mes que vino a pagar: así la fila de la Cartera queda paga, igual que con «Registrar pago».
// El pago suelto es para lo que no está en la planilla del mes (un riesgo vario, un alta reciente).
import { useEffect, useState } from 'react'
import type { CajaDelDia as DatosDeCaja, CuotasDelCliente, FilaCartera, FilaCliente } from '../../../shared/tipos'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Dialogo, Selector, cx } from '../../componentes/ui'
import { pesos } from './formato'

interface Props {
  fecha: string
  sucursales: string[]
  sucursalPorDefecto: string
  mediosDePago: string[]
  alCerrar: () => void
  alGuardar: (caja: DatosDeCaja, resumen: string) => void
}

export function DialogoPagoManual({ fecha, sucursales, sucursalPorDefecto, mediosDePago, alCerrar, alGuardar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<FilaCliente[]>([])
  const [buscando, setBuscando] = useState(false)
  const [cliente, setCliente] = useState<FilaCliente | null>(null)
  const [cuotas, setCuotas] = useState<CuotasDelCliente | null>(null)
  const [cuotaElegida, setCuotaElegida] = useState<FilaCartera | null>(null)

  const [fechaDelPago, setFechaDelPago] = useState(fecha)
  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState(mediosDePago[0] ?? '')
  const [sucursal, setSucursal] = useState(sucursalPorDefecto)
  const [observaciones, setObservaciones] = useState('')

  // Datos del pago suelto: se completan solos con lo que se sepa del cliente.
  const [nombre, setNombre] = useState('')
  const [documento, setDocumento] = useState('')
  const [compania, setCompania] = useState('')
  const [poliza, setPoliza] = useState('')
  const [patente, setPatente] = useState('')

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Buscar mientras se escribe, con un respiro para no llamar en cada tecla.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto.length < 2) {
      setResultados([])
      return
    }
    let vigente = true
    setBuscando(true)
    const reloj = setTimeout(() => {
      void window.dm.clientes.buscar(texto).then((resultado) => {
        if (!vigente) return
        if (resultado.ok) setResultados(resultado.datos)
        else setError(resultado.error)
        setBuscando(false)
      })
    }, 250)
    return () => {
      vigente = false
      clearTimeout(reloj)
    }
  }, [busqueda])

  const elegirCliente = async (elegido: FilaCliente) => {
    setCliente(elegido)
    setResultados([])
    setBusqueda('')
    setNombre(elegido.nombre)
    setDocumento(elegido.documento ?? '')
    // La sucursal NO se toca: es dónde entró la plata, no de dónde es el cliente. Un cliente de Lanús
    // que paga en Dock Sud tiene que sumar a la caja de Dock Sud.
    const resultado = await window.dm.clientes.cuotasDelMes(elegido.id)
    if (resultado.ok) {
      setCuotas(resultado.datos)
      const impaga = resultado.datos.filas.find((f) => !f.pagoFecha && !f.pagoRegistrado)
      if (impaga) elegirCuota(impaga)
    } else {
      setError(resultado.error)
    }
  }

  const elegirCuota = (fila: FilaCartera | null) => {
    setCuotaElegida(fila)
    if (!fila) return
    setImporte(fila.cuota ?? '')
    setCompania(fila.compania ?? '')
    setPoliza(fila.numeroPoliza ?? '')
    setPatente(fila.patente ?? '')
    if (fila.formaPago) setMedio(fila.formaPago)
  }

  const limpiarCliente = () => {
    setCliente(null)
    setCuotas(null)
    setCuotaElegida(null)
    setNombre('')
    setDocumento('')
    setCompania('')
    setPoliza('')
    setPatente('')
    setImporte('')
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.registrarPagoManual({
      cuotaFilaId: cuotaElegida?.filaId ?? null,
      // El id 0 es el marcador de «todavía no está en la base»: no se manda como cliente.
      clienteId: cliente && cliente.id > 0 ? cliente.id : null,
      polizaId: cuotaElegida?.polizaId ?? null,
      clienteNombre: nombre,
      documento,
      compania,
      numeroPoliza: poliza,
      patente,
      fecha: fechaDelPago,
      importe,
      medioDePago: medio,
      sucursal,
      observaciones,
    })
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos, `Pago registrado: ${nombre || 'sin nombre'}${importe ? ` · ${importe}` : ''}.`)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Registrar pago"
      descripcion="Buscá al cliente y elegí la cuota que vino a pagar. Si no está en la planilla del mes, cargalo como pago suelto."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar pago
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        {!cliente ? (
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="buscar-cliente-pago">
              Cliente
            </label>
            <div className="relative mt-1.5">
              <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="buscar-cliente-pago"
                value={busqueda}
                autoFocus
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar por nombre, DNI, patente o póliza…"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
              />
            </div>
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
              {busqueda.trim().length < 2 && (
                <p className="px-3 py-4 text-sm text-slate-500">Escribí al menos dos letras para buscar.</p>
              )}
              {busqueda.trim().length >= 2 && !buscando && resultados.length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-500">
                  Ningún cliente coincide. Podés cargarlo igual como pago suelto:{' '}
                  <button type="button" className="font-semibold text-marino-700 underline" onClick={() => setCliente({ ...SIN_CLIENTE })}>
                    seguir sin cliente
                  </button>
                  .
                </p>
              )}
              {resultados.map((candidato) => (
                <button
                  key={candidato.id}
                  type="button"
                  onClick={() => void elegirCliente(candidato)}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{candidato.nombre}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {candidato.documento ?? 'sin documento'} · {candidato.sucursal ?? 'sin sucursal'} · {candidato.polizasActivas} póliza(s)
                    </span>
                  </span>
                  {candidato.conDeuda && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Debe</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Icono nombre="usuario" tamano={16} className="text-slate-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900">{cliente.id > 0 ? cliente.nombre : 'Pago sin cliente de la base'}</span>
              {cliente.id > 0 && <span className="block truncate text-xs text-slate-500">{cliente.documento ?? 'sin documento'}</span>}
            </span>
            <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={limpiarCliente}>
              Cambiar
            </Boton>
          </div>
        )}

        {cuotas && cuotas.filas.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-700">Cuota de {nombreDePeriodo(cuotas.periodo)}</p>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {cuotas.filas.map((fila) => {
                const pagada = Boolean(fila.pagoFecha) || fila.pagoRegistrado
                const elegida = cuotaElegida?.filaId === fila.filaId
                return (
                  <button
                    key={fila.filaId}
                    type="button"
                    onClick={() => elegirCuota(fila)}
                    className={cx(
                      'flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      elegida ? 'border-marino-500 bg-marino-50 ring-2 ring-marino-500/20' : 'border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">
                        {fila.compania ?? 'sin compañía'} · {fila.numeroPoliza ?? 'sin póliza'}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {fila.patente ?? 'sin patente'} · vence el {fila.diaVencimiento ?? '—'}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold text-slate-900">{fila.cuota ?? '—'}</span>
                    {pagada && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">Ya paga</span>}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => elegirCuota(null)}
                className={cx(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  cuotaElegida === null ? 'border-marino-500 bg-marino-50 ring-2 ring-marino-500/20' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <span className="font-medium text-slate-900">Pago suelto</span>
                <span className="ml-2 text-xs text-slate-500">no toca la planilla del mes</span>
              </button>
            </div>
          </div>
        )}

        {cliente && cuotas && cuotas.filas.length === 0 && (
          <Alerta tono="info">
            Este cliente no tiene cuotas en la planilla de {nombreDePeriodo(cuotas.periodo)}: el pago se guarda suelto.
          </Alerta>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Fecha del pago" type="date" value={fechaDelPago} onChange={(evento) => setFechaDelPago(evento.target.value)} />
          <Campo
            etiqueta="Importe"
            value={importe}
            onChange={(evento) => setImporte(evento.target.value)}
            ayuda={cuotaElegida?.cuotaMonto ? `La cuota es de ${pesos(cuotaElegida.cuotaMonto)}` : 'Como 24.500 o 24500,50.'}
          />
          <Selector
            etiqueta="Medio de pago"
            value={medio}
            onChange={(evento) => setMedio(evento.target.value)}
            opciones={[{ valor: '', texto: '(sin especificar)' }, ...mediosDePago.map((m) => ({ valor: m, texto: m }))]}
          />
          <Selector
            etiqueta="Sucursal donde se cobró"
            value={sucursal}
            onChange={(evento) => setSucursal(evento.target.value)}
            opciones={sucursales.map((s) => ({ valor: s, texto: s }))}
          />
        </div>

        {cuotaElegida === null && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Campo etiqueta="Nombre del cliente" value={nombre} onChange={(evento) => setNombre(evento.target.value)} />
            <Campo etiqueta="DNI/CUIT" value={documento} onChange={(evento) => setDocumento(evento.target.value)} />
            <Campo etiqueta="Compañía" value={compania} onChange={(evento) => setCompania(evento.target.value)} />
            <Campo etiqueta="Póliza" value={poliza} onChange={(evento) => setPoliza(evento.target.value)} />
            <Campo etiqueta="Patente" value={patente} onChange={(evento) => setPatente(evento.target.value)} />
            <Campo etiqueta="Observaciones" value={observaciones} onChange={(evento) => setObservaciones(evento.target.value)} />
          </div>
        )}
      </div>
    </Dialogo>
  )
}

/** Marcador para cargar un pago de alguien que todavía no está en la base. */
const SIN_CLIENTE: FilaCliente = {
  id: 0,
  nombre: '',
  documento: null,
  telefono: null,
  email: null,
  sucursal: null,
  localidad: null,
  polizasActivas: 0,
  vehiculos: 0,
  conDeuda: false,
  companias: [],
}
