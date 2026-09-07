// La caja chica del mostrador: la mitad de abajo de la planilla de caja de la agencia, con las cuentas
// hechas. Es lo que se mira al cerrar el día para saber si el cajón tiene lo que tiene que tener.
//
// Arriba, la cuenta del cajón (con cuánto se abrió, lo que entró en efectivo, lo que salió y lo que
// debería quedar). Abajo, el cuadre de la planilla: el DEBE contra el HABER, que tienen que dar igual.
import { useState } from 'react'
import type { ArqueoDeCaja as Arqueo, CajaDelDia, MovimientoDeCaja, TipoDeMovimientoDeCaja } from '../../../shared/tipos'
import { NOMBRE_MOVIMIENTO_DE_CAJA } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Dialogo, cx } from '../../componentes/ui'
import { pesos } from './formato'

interface Props {
  arqueo: Arqueo
  puedeEditar: boolean
  /** La caja rehecha después de tocar un renglón: la pantalla se queda con ésa. */
  alCambiar: (caja: CajaDelDia) => void
}

/** El día como se lee («02/09»), para decir de dónde se arrastró la caja chica. */
function diaCorto(fechaIso: string): string {
  return `${fechaIso.slice(8, 10)}/${fechaIso.slice(5, 7)}`
}

export function ArqueoDeCaja({ arqueo, puedeEditar, alCambiar }: Props) {
  const [cargando, setCargando] = useState<TipoDeMovimientoDeCaja | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const borrar = async (movimiento: MovimientoDeCaja) => {
    setBorrando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.borrarMovimientoCaja(movimiento.id)
    setBorrando(false)
    if (resultado.ok) alCambiar(resultado.datos)
    else setError(resultado.error)
  }

  const cuadra = arqueo.descuadre === 0
  const sueltos = arqueo.movimientos.filter((movimiento) => movimiento.tipo === 'GASTO' || movimiento.tipo === 'CAJA_FUERTE')

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <Icono nombre="billete" tamano={16} className="text-slate-500" />
        <span className="font-display text-sm font-bold tracking-tight text-slate-900">Caja chica · {arqueo.sucursal}</span>
        {arqueo.contado !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            <Icono nombre="ok" tamano={12} />
            Cerrada{arqueo.cerradoPor ? ` por ${arqueo.cerradoPor}` : ''}
            {arqueo.cerradoEn ? ` a las ${arqueo.cerradoEn}` : ''}
          </span>
        )}
        {puedeEditar && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Boton tamano="sm" icono="mas" onClick={() => setCargando('GASTO')}>
              Gasto
            </Boton>
            <Boton tamano="sm" icono="candado" onClick={() => setCargando('CAJA_FUERTE')}>
              A la caja fuerte
            </Boton>
            <Boton tamano="sm" variante="primario" icono="ok" onClick={() => setCargando('CIERRE')}>
              {arqueo.contado === null ? 'Cerrar la caja' : 'Corregir el cierre'}
            </Boton>
          </div>
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <Titulo>El cajón</Titulo>
          <Renglon
            etiqueta="Caja chica al abrir"
            valor={arqueo.apertura}
            nota={
              arqueo.aperturaCargada
                ? null
                : arqueo.aperturaHeredadaDe
                  ? `arrastrada del cierre del ${diaCorto(arqueo.aperturaHeredadaDe)}`
                  : 'sin cargar'
            }
            accion={puedeEditar ? { texto: arqueo.aperturaCargada ? 'Cambiar' : 'Cargar', alTocar: () => setCargando('APERTURA') } : null}
          />
          <Renglon etiqueta="+ Cobrado en efectivo" valor={arqueo.efectivo} />
          <Renglon etiqueta="− Gastos" valor={arqueo.gastos} />
          <Renglon etiqueta="− A la caja fuerte" valor={arqueo.aLaCajaFuerte} />
          <Renglon etiqueta="= Debería quedar" valor={arqueo.esperado} destacado />
          {arqueo.contado !== null && (
            <>
              <Renglon etiqueta="Contado al cerrar" valor={arqueo.contado} />
              <Renglon
                etiqueta={(arqueo.diferencia ?? 0) >= 0 ? 'Sobra' : 'Falta'}
                valor={Math.abs(arqueo.diferencia ?? 0)}
                tono={arqueo.diferencia === 0 ? 'ok' : 'aviso'}
              />
            </>
          )}
        </div>

        <div>
          <Titulo>Las cuentas del día</Titulo>
          <Renglon etiqueta="Caja chica al abrir + cobrado (DEBE)" valor={arqueo.debe} />
          <Renglon etiqueta="Posnet (tarjetas)" valor={arqueo.posnet} />
          <Renglon etiqueta="Transferencias y Mercado Pago" valor={arqueo.transferencia} />
          {arqueo.otros > 0 && <Renglon etiqueta="Otros medios" valor={arqueo.otros} />}
          <Renglon etiqueta="Gastos" valor={arqueo.gastos} />
          <Renglon etiqueta="Efectivo a la caja fuerte" valor={arqueo.aLaCajaFuerte} />
          <Renglon etiqueta="Caja chica que queda" valor={arqueo.contado ?? arqueo.esperado} />
          <Renglon etiqueta="Total (HABER)" valor={arqueo.haber} destacado tono={cuadra ? 'ok' : 'aviso'} />
        </div>
      </div>

      {sueltos.length > 0 && (
        <div className="border-t border-slate-200 px-4 py-3">
          <Titulo>Cargado a mano</Titulo>
          <ul className="mt-1 flex flex-col gap-1">
            {sueltos.map((movimiento) => (
              <li key={movimiento.id} className="flex items-center gap-2 text-sm">
                <span className="w-36 shrink-0 text-slate-500">{NOMBRE_MOVIMIENTO_DE_CAJA[movimiento.tipo]}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">{movimiento.detalle ?? '—'}</span>
                <span className="tabular-nums font-semibold text-slate-900">{pesos(movimiento.importe)}</span>
                <span className="w-28 shrink-0 truncate text-right text-xs text-slate-500">
                  {movimiento.hora ?? ''} {movimiento.usuarioNombre ?? ''}
                </span>
                {puedeEditar && (
                  <Boton tamano="sm" variante="fantasma" icono="basura" onClick={() => void borrar(movimiento)} disabled={borrando}>
                    Sacar
                  </Boton>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(!cuadra || error) && (
        <div className="border-t border-slate-200 px-4 py-3">
          {error && <Alerta tono="error">{error}</Alerta>}
          {!cuadra && (
            <Alerta tono="aviso">
              En el cajón hay {pesos(Math.abs(arqueo.diferencia ?? 0))} {(arqueo.diferencia ?? 0) > 0 ? 'de más' : 'de menos'} de lo
              que dicen las cuentas, y por eso los dos totales de la planilla no dan igual. Antes de dejarlo así, mirá que
              estén cargados todos los cobros del día, los gastos que se pagaron del cajón y lo que se bajó a la caja fuerte.
            </Alerta>
          )}
        </div>
      )}

      {cargando && (
        <DialogoMovimientoDeCaja
          tipo={cargando}
          arqueo={arqueo}
          alCerrar={() => setCargando(null)}
          alGuardar={(caja) => {
            setCargando(null)
            setError(null)
            alCambiar(caja)
          }}
        />
      )}
    </div>
  )
}

function Titulo({ children }: { children: string }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</p>
}

function Renglon({
  etiqueta,
  valor,
  nota,
  destacado,
  tono,
  accion,
}: {
  etiqueta: string
  valor: number
  nota?: string | null
  destacado?: boolean
  tono?: 'ok' | 'aviso'
  accion?: { texto: string; alTocar: () => void } | null
}) {
  return (
    <div className={cx('flex items-baseline gap-2 py-1', destacado && 'mt-1 border-t border-slate-200 pt-2')}>
      <span className={cx('min-w-0 flex-1 truncate text-sm', destacado ? 'font-semibold text-slate-900' : 'text-slate-600')}>
        {etiqueta}
        {nota && <span className="ml-1.5 text-xs text-slate-400">({nota})</span>}
      </span>
      <span
        className={cx(
          'tabular-nums',
          destacado ? 'font-display text-base font-extrabold' : 'text-sm font-semibold',
          tono === 'aviso' ? 'text-amber-700' : tono === 'ok' ? 'text-green-700' : 'text-slate-900',
        )}
      >
        {pesos(valor)}
      </span>
      {accion && (
        <Boton tamano="sm" variante="fantasma" onClick={accion.alTocar}>
          {accion.texto}
        </Boton>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cargar un renglón
// ---------------------------------------------------------------------------

const AYUDA: Record<TipoDeMovimientoDeCaja, { titulo: string; descripcion: string; pideDetalle: boolean }> = {
  APERTURA: {
    titulo: 'Caja chica al abrir',
    descripcion: 'Con cuánto cambio arranca el día este mostrador. Si no se carga, se arrastra lo que quedó al cerrar el día anterior.',
    pideDetalle: false,
  },
  GASTO: {
    titulo: 'Gasto de la caja',
    descripcion: 'Lo que se pagó del cajón: la limpieza, un envío, la nafta. Sale de la caja chica y queda anotado con el concepto.',
    pideDetalle: true,
  },
  CAJA_FUERTE: {
    titulo: 'Plata a la caja fuerte',
    descripcion: 'La plata en efectivo que se baja del cajón y se guarda en la caja fuerte. Deja de estar en la caja chica.',
    pideDetalle: false,
  },
  CIERRE: {
    titulo: 'Cerrar la caja',
    descripcion: 'Contá lo que quedó en el cajón y escribilo acá. Es lo que mañana va a ser la caja chica de apertura.',
    pideDetalle: false,
  },
}

function DialogoMovimientoDeCaja({
  tipo,
  arqueo,
  alCerrar,
  alGuardar,
}: {
  tipo: TipoDeMovimientoDeCaja
  arqueo: Arqueo
  alCerrar: () => void
  alGuardar: (caja: CajaDelDia) => void
}) {
  const anterior = arqueo.movimientos.find((movimiento) => movimiento.tipo === tipo)
  const sugerido = tipo === 'APERTURA' ? arqueo.apertura : tipo === 'CIERRE' ? arqueo.esperado : 0
  const [importe, setImporte] = useState(anterior ? String(anterior.importe) : sugerido ? String(sugerido) : '')
  const [detalle, setDetalle] = useState(anterior?.detalle ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ayuda = AYUDA[tipo]

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.guardarMovimientoCaja({
      fecha: arqueo.fecha,
      sucursal: arqueo.sucursal,
      tipo,
      detalle,
      importe,
    })
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo={ayuda.titulo}
      descripcion={ayuda.descripcion}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => void guardar()} cargando={guardando}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        {tipo === 'CIERRE' && (
          <Alerta tono="info">
            Según lo cargado, en el cajón tendría que haber {pesos(arqueo.esperado)}. Si contás otra cosa, escribí lo que
            contaste: la diferencia queda a la vista en vez de taparse.
          </Alerta>
        )}
        <Campo
          etiqueta="Importe"
          value={importe}
          autoFocus
          onChange={(evento) => setImporte(evento.target.value)}
          ayuda="Como 4.600 o 4600,50."
        />
        {ayuda.pideDetalle && (
          <Campo etiqueta="Concepto" value={detalle} onChange={(evento) => setDetalle(evento.target.value)} ayuda="Limpieza, nafta, un envío…" />
        )}
        {!ayuda.pideDetalle && (
          <Campo
            etiqueta="Aclaración (opcional)"
            value={detalle}
            onChange={(evento) => setDetalle(evento.target.value)}
            ayuda="Por ejemplo, quién la bajó o de qué cobro salió."
          />
        )}
      </div>
    </Dialogo>
  )
}
