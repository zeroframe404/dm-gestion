// La segunda campana de la barra superior: los débitos que rebotaron y que esta sucursal tiene que
// cobrar a mano.
//
// Va aparte de la de tareas a propósito. Una tarea es de una persona; un rechazo es de la sucursal: lo
// puede atender cualquiera de los que estén en el mostrador, y por eso lo ven todos los que trabajan
// ahí. Mezclarlas haría que un aviso que es de dos personas parezca de una sola.
//
// Se refresca sola cada dos minutos, igual que la otra: el aviso lo carga alguien de otra sucursal y
// llega por la sincronización, así que preguntar cada tanto es lo único que puede enterarse.
// Cuando aparece un rechazo que antes no estaba suena su propio aviso, distinto al de las tareas: hay
// que poder saber cuál de las dos campanas sonó sin dar vuelta la cabeza, porque un rechazo se cobra
// llamando por teléfono y una tarea puede esperar a la tarde.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NOMBRE_MOTIVO_RECHAZO, type AvisosDeRechazos, type MotivoDeRechazo } from '../../shared/tipos'
import { useNavegacion } from '../contexto/Navegacion'
import { useAvisoNuevo } from '../sonidos/useAvisoNuevo'
import { Icono } from './Icono'
import { cx } from './ui'

const CADA_CUANTO_MS = 2 * 60_000

export function CampanaDeRechazos({ puedeResolver, puedeVerLaPantalla }: { puedeResolver: boolean; puedeVerLaPantalla: boolean }) {
  const { ir } = useNavegacion()
  const [avisos, setAvisos] = useState<AvisosDeRechazos | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const traer = useCallback(async () => {
    const resultado = await window.dm.rechazos.avisos()
    if (resultado.ok) setAvisos(resultado.datos)
  }, [])

  useEffect(() => {
    void traer()
    const reloj = setInterval(() => void traer(), CADA_CUANTO_MS)
    return () => clearInterval(reloj)
  }, [traer])

  const idsDeRechazos = useMemo(() => (avisos ? avisos.filas.map((fila) => fila.id) : null), [avisos])
  useAvisoNuevo(idsDeRechazos, 'rechazo')

  useEffect(() => {
    if (!abierta) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierta(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierta(false)
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

  const abrir = async () => {
    const siguiente = !abierta
    setAbierta(siguiente)
    setError(null)
    // Abrirla cuenta como enterarse: se apaga el punto, pero el aviso sigue sin resolver hasta que
    // alguien diga que lo cobró. Ver el rechazo no es haberlo cobrado.
    if (siguiente) {
      const resultado = await window.dm.rechazos.marcarVistos()
      if (resultado.ok) setAvisos(resultado.datos)
    }
  }

  const resolver = async (rechazoId: number) => {
    const resultado = await window.dm.rechazos.resolver(rechazoId)
    if (resultado.ok) setAvisos(resultado.datos)
    else setError(resultado.error)
  }

  const sinResolver = avisos?.sinResolver ?? 0
  const hayNovedad = (avisos?.nuevos ?? 0) > 0
  // Con algo sin cobrar la campana se pinta; sin nada queda gris como el resto de la barra. Un ámbar
  // permanente en una sucursal que no debe nada dejaría de querer decir algo a los dos días.
  const conAlgo = sinResolver > 0

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        onClick={() => void abrir()}
        aria-label={
          sinResolver === 0
            ? `Débitos rechazados de ${avisos?.sucursal ?? 'tu sucursal'}: no hay ninguno sin resolver`
            : `Débitos rechazados de ${avisos?.sucursal ?? 'tu sucursal'}: ${sinResolver} sin resolver`
        }
        aria-expanded={abierta}
        className={cx(
          'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          conAlgo ? 'text-amber-700 hover:bg-amber-50 hover:text-amber-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          abierta && (conAlgo ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-900'),
        )}
      >
        <Icono nombre="alerta" tamano={18} />
        {sinResolver > 0 && <span className="text-xs font-bold tabular-nums">{sinResolver}</span>}
        {hayNovedad && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />}
      </button>

      {abierta && avisos && (
        <div className="absolute right-0 z-40 mt-2 w-[26rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-media">
          <header className="border-b border-slate-100 px-4 py-3">
            <p className="font-display text-sm font-bold tracking-tight text-slate-900">Débitos rechazados</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {sinResolver === 0
                ? `No hay rechazos sin resolver en ${avisos.sucursal}.`
                : `${sinResolver} sin resolver en ${avisos.sucursal}. Hay que llamarlos y cobrarles a mano.`}
            </p>
          </header>

          {error && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>}

          <ul className="max-h-96 overflow-y-auto">
            {avisos.filas.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nada por ahora.</li>}
            {avisos.filas.map((fila) => (
              <li key={fila.id} className="border-b border-slate-100 px-4 py-2.5 last:border-b-0 hover:bg-slate-50">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', fila.estado === 'PENDIENTE' ? 'bg-red-500' : 'bg-amber-500')}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{fila.clienteNombre ?? 'Sin nombre'}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[
                        fila.motivo ? (NOMBRE_MOTIVO_RECHAZO[fila.motivo as MotivoDeRechazo] ?? fila.motivo) : null,
                        fila.compania,
                        fila.patente,
                        fila.telefono,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {fila.nota && <p className="mt-0.5 text-xs text-slate-600">{fila.nota}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {fila.fecha}
                      {fila.avisadoPor ? ` · avisó ${fila.avisadoPor}` : ''}
                    </p>
                  </div>
                  {puedeResolver && (
                    <button
                      type="button"
                      onClick={() => void resolver(fila.id)}
                      title="Ya se cobró o se corrigió el CBU: sacarlo de la lista."
                      className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-green-400 hover:bg-green-50 hover:text-green-800"
                    >
                      Resuelto
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Sin Cartera a la vista el enlace llevaría a un módulo que no está en la barra lateral. */}
          {puedeVerLaPantalla && (
            <footer className="border-t border-slate-100 px-4 py-2">
              <button
                type="button"
                onClick={() => {
                  setAbierta(false)
                  ir('cartera', { seccion: 'rechazos' })
                }}
                className="text-sm font-semibold text-marino-700 hover:underline"
              >
                Ver todos los rechazos
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  )
}
