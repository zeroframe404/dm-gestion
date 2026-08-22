// Alta rápida: se busca al cliente o la patente y los datos de la póliza se completan solos.
//
// Es el momento en que suena el teléfono y del otro lado hay alguien que acaba de chocar: lo único que
// se pide escribir es qué pasó y cuándo. Compañía, número de póliza, cobertura, patente y sucursal
// salen de la póliza elegida y se muestran para confirmar, no para tipear.
import { useEffect, useState } from 'react'
import { hoyLocal } from '../../../shared/semaforo'
import { ESTADOS_DE_SINIESTRO, type CandidatoDeSiniestro, type FichaSiniestro } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Selector, cx } from '../../componentes/ui'

interface Props {
  alCerrar: () => void
  alCargar: (ficha: FichaSiniestro) => void
}

export function DialogoAltaSiniestro({ alCerrar, alCargar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [candidatos, setCandidatos] = useState<CandidatoDeSiniestro[]>([])
  const [elegido, setElegido] = useState<CandidatoDeSiniestro | null>(null)
  const [buscando, setBuscando] = useState(false)

  const [fecha, setFecha] = useState(hoyLocal())
  const [fechaCarga, setFechaCarga] = useState(hoyLocal())
  const [numero, setNumero] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [estado, setEstado] = useState<string>(ESTADOS_DE_SINIESTRO[0])
  const [importe, setImporte] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // El buscador espera a que dejen de escribir: si no, cada tecla es una consulta.
  useEffect(() => {
    if (elegido || busqueda.trim().length < 2) {
      setCandidatos([])
      return
    }
    setBuscando(true)
    const temporizador = setTimeout(async () => {
      const resultado = await window.dm.siniestros.buscar(busqueda)
      if (resultado.ok) setCandidatos(resultado.datos)
      setBuscando(false)
    }, 250)
    return () => {
      clearTimeout(temporizador)
      setBuscando(false)
    }
  }, [busqueda, elegido])

  const guardar = async () => {
    if (!elegido) return
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.siniestros.alta({
      clienteId: elegido.clienteId,
      polizaId: elegido.polizaId,
      fecha,
      fechaCarga,
      numeroSiniestro: numero,
      descripcion,
      estado,
      importe,
      observaciones: '',
      sucursal: elegido.sucursal ?? '',
    })
    setGuardando(false)
    if (resultado.ok) alCargar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Cargar siniestro"
      descripcion="Buscá al cliente o la patente y los datos de la póliza se completan solos."
      alCerrar={alCerrar}
      ancho="lg"
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
            disabled={!elegido || !fecha || !descripcion.trim()}
          >
            Cargar siniestro
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        {!elegido ? (
          <>
            <div className="relative">
              <Icono nombre="lupa" tamano={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Patente, apellido, DNI o número de póliza…"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25"
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              {busqueda.trim().length < 2 && (
                <p className="px-3 py-8 text-center text-sm text-slate-500">Escribí al menos dos letras para buscar.</p>
              )}
              {busqueda.trim().length >= 2 && candidatos.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  {buscando ? 'Buscando…' : 'No hay ninguna póliza con esos datos. Cargá primero al cliente y su póliza.'}
                </p>
              )}
              {candidatos.map((candidato) => (
                <button
                  key={`${candidato.polizaId}`}
                  type="button"
                  onClick={() => setElegido(candidato)}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{candidato.clienteNombre}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[candidato.compania, candidato.numeroPoliza, candidato.cobertura, candidato.vehiculo].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-700">{candidato.patente ?? 'sin patente'}</span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      candidato.estadoPoliza === 'ACTIVA' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800',
                    )}
                  >
                    {candidato.estadoPoliza}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-marino-200 bg-marino-50 px-3.5 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-marino-900">{elegido.clienteNombre}</p>
                  <p className="mt-0.5 text-sm text-marino-800">
                    {[elegido.compania, elegido.numeroPoliza, elegido.cobertura].filter(Boolean).join(' · ') || 'Sin datos de póliza'}
                  </p>
                  <p className="mt-0.5 text-xs text-marino-700">
                    {[elegido.patente, elegido.vehiculo, elegido.sucursal].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Boton tamano="sm" onClick={() => setElegido(null)}>
                  Cambiar
                </Boton>
              </div>
              {elegido.estadoPoliza !== 'ACTIVA' && (
                <p className="mt-2 text-xs font-semibold text-amber-800">
                  Ojo: esta póliza figura {elegido.estadoPoliza === 'BAJA' ? 'dada de baja' : 'vencida'}. Se puede cargar igual, pero confirmá
                  la cobertura con la compañía.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Fecha del siniestro"
                type="date"
                value={fecha}
                onChange={(evento) => setFecha(evento.target.value)}
                ayuda="Cuándo pasó."
              />
              <Campo
                etiqueta="Fecha de carga"
                type="date"
                value={fechaCarga}
                onChange={(evento) => setFechaCarga(evento.target.value)}
                ayuda="Cuándo lo estamos cargando; por omisión, hoy."
              />
            </div>

            <AreaTexto
              etiqueta="Qué pasó"
              rows={3}
              value={descripcion}
              onChange={(evento) => setDescripcion(evento.target.value)}
              ayuda="Choque, granizo, robo, cristales… Si dice ROBO, la fila queda destacada en rojo."
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Selector
                etiqueta="Estado"
                value={estado}
                onChange={(evento) => setEstado(evento.target.value)}
                opciones={ESTADOS_DE_SINIESTRO.map((e) => ({ valor: e, texto: e }))}
              />
              <Campo
                etiqueta="N.º de siniestro"
                value={numero}
                onChange={(evento) => setNumero(evento.target.value)}
                ayuda="Lo da la compañía; se completa después."
              />
              <Campo etiqueta="Importe" value={importe} onChange={(evento) => setImporte(evento.target.value)} />
            </div>

            <p className="text-xs leading-relaxed text-slate-500">
              Al guardar se abre la ficha: ahí van las observaciones fechadas, los documentos y las tareas. La fila viaja a la pestaña
              SINIESTROS de la hoja con la próxima sincronización.
            </p>
          </>
        )}
      </div>
    </Dialogo>
  )
}
