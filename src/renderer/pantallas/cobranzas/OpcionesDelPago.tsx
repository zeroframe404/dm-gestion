// Las dos opciones que comparten los tres formularios de «Registrar pago» (la planilla del mes, la
// ficha del cliente y la caja del día):
//
//  - El ESTADO DEL COBRO: «Pagó» (lo de siempre) o «Imputado». Con AGS, en Dock Sud, primero se le
//    imputa la cuota a la compañía —la paga la agencia— y el cliente transfiere después. Mientras
//    tanto la fila no figura paga y la caja no suma esa plata; cuando el cliente paga, se vuelve a
//    registrar como «Pagó».
//  - QUÉ CUOTA se paga: la de este mes, la del mes que viene por adelantado, o las dos (el cliente que
//    viene a pagar dos cuotas juntas). Del adelanto se elige además si se acredita solo al armar el
//    mes siguiente o si queda pendiente para imputarlo a mano cuando se controle el general.
import { nombreDePeriodo, periodoSiguiente } from '../../../shared/semaforo'
import type { AlcanceDelPago, DatosDePago, EstadoDeCobro, FilaCartera, ModoDeAdelanto } from '../../../shared/tipos'
import { Alerta, Campo, cx } from '../../componentes/ui'

export interface OpcionesElegidas {
  estadoCobro: EstadoDeCobro
  alcance: AlcanceDelPago
  importeAdelanto: string
  modoAdelanto: ModoDeAdelanto
}

export const OPCIONES_POR_DEFECTO: OpcionesElegidas = { estadoCobro: 'PAGO', alcance: 'MES', importeAdelanto: '', modoAdelanto: 'ACREDITAR' }

/** Las opciones con las que se abre el formulario para una fila: el adelanto viene con la cuota de la fila. */
export function opcionesParaFila(fila: FilaCartera | null): OpcionesElegidas {
  return { ...OPCIONES_POR_DEFECTO, importeAdelanto: fila?.cuota ?? '' }
}

/** Lo que se manda al registrar el pago. Sin fila no hay cuota que adelantar: sólo viaja el estado. */
export function datosDeLasOpciones(opciones: OpcionesElegidas, fila: FilaCartera | null): Pick<DatosDePago, 'estadoCobro' | 'alcance' | 'adelanto'> {
  if (!fila || opciones.alcance === 'MES') return { estadoCobro: opciones.estadoCobro, alcance: 'MES' }
  return {
    estadoCobro: opciones.estadoCobro,
    alcance: opciones.alcance,
    adelanto: { importe: opciones.importeAdelanto, modo: opciones.modoAdelanto },
  }
}

/** El texto del botón de guardar, que dice lo que va a pasar. */
export function textoDeGuardar(opciones: OpcionesElegidas, fila: FilaCartera | null): string {
  if (opciones.estadoCobro === 'IMPUTADO') return 'Guardar como imputado'
  if (fila && opciones.alcance === 'AMBAS') return 'Guardar las dos cuotas'
  if (fila && opciones.alcance === 'ADELANTADO') return 'Guardar pago adelantado'
  return 'Guardar pago'
}

interface Props {
  /** La fila que se está cobrando; null en un pago suelto (sin cuota del mes). */
  fila: FilaCartera | null
  opciones: OpcionesElegidas
  alCambiar: (opciones: OpcionesElegidas) => void
  disabled?: boolean
}

export function OpcionesDelPago({ fila, opciones, alCambiar, disabled }: Props) {
  const cambiar = (parte: Partial<OpcionesElegidas>) => alCambiar({ ...opciones, ...parte })
  const mes = fila ? nombreDePeriodo(fila.periodo) : ''
  const mesQueViene = fila ? nombreDePeriodo(periodoSiguiente(fila.periodo)) : ''
  const conAdelanto = fila !== null && opciones.alcance !== 'MES'

  return (
    <div className="flex flex-col gap-3">
      {fila?.pagoImputado && !fila.pagoRegistrado && !fila.pagoFecha && (
        <Alerta tono="aviso">
          Esta cuota está <strong>imputada</strong>: la agencia ya se la pagó a la compañía y falta cobrársela al cliente. Si el
          cliente pagó, dejá «Pagó» y guardá: recién ahí la fila queda paga y la caja lo cuenta.
        </Alerta>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-slate-700">Estado del cobro</legend>
        <div className="flex flex-wrap gap-2">
          <Opcion
            nombre="estado-cobro"
            elegido={opciones.estadoCobro === 'PAGO'}
            alElegir={() => cambiar({ estadoCobro: 'PAGO' })}
            texto="Pagó"
            detalle="el cliente pagó"
            deshabilitado={disabled}
          />
          <Opcion
            nombre="estado-cobro"
            elegido={opciones.estadoCobro === 'IMPUTADO'}
            alElegir={() => cambiar({ estadoCobro: 'IMPUTADO' })}
            texto="Imputado"
            detalle="se le pagó a la compañía; el cliente transfiere después"
            deshabilitado={disabled}
          />
        </div>
        {opciones.estadoCobro === 'IMPUTADO' && (
          <p className="text-xs text-slate-500">
            La cuota queda imputada pero <strong>sin cobrar</strong>: la fila no figura paga y la caja no suma esta plata hasta que el
            cliente pague. Cuando pague, volvé a registrar el pago como «Pagó».
          </p>
        )}
      </fieldset>

      {fila && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-slate-700">Qué cuota paga</legend>
          <div className="flex flex-wrap gap-2">
            <Opcion
              nombre="alcance"
              elegido={opciones.alcance === 'MES'}
              alElegir={() => cambiar({ alcance: 'MES' })}
              texto={`La de ${mes}`}
              deshabilitado={disabled}
            />
            <Opcion
              nombre="alcance"
              elegido={opciones.alcance === 'AMBAS'}
              alElegir={() => cambiar({ alcance: 'AMBAS' })}
              texto={`La de ${mes} y la de ${mesQueViene}`}
              detalle="dos cuotas juntas"
              deshabilitado={disabled}
            />
            <Opcion
              nombre="alcance"
              elegido={opciones.alcance === 'ADELANTADO'}
              alElegir={() => cambiar({ alcance: 'ADELANTADO' })}
              texto={`Sólo la de ${mesQueViene}`}
              detalle="pago adelantado"
              deshabilitado={disabled}
            />
          </div>
          {fila.adelantoSiguiente && (
            <p className="text-xs text-slate-500">
              Ya adelantó la cuota de {nombreDePeriodo(fila.adelantoSiguiente.periodo)}
              {fila.adelantoSiguiente.fecha ? ` el ${fila.adelantoSiguiente.fecha}` : ''}
              {fila.adelantoSiguiente.importe ? ` por ${fila.adelantoSiguiente.importe}` : ''}
              {fila.adelantoSiguiente.imputado
                ? ' (ya imputada a su mes).'
                : fila.adelantoSiguiente.modo === 'ACREDITAR'
                  ? ' (se acredita al armar el mes).'
                  : ' (pendiente de imputar).'}{' '}
              Volver a adelantarla corrige ese pago, no lo duplica.
            </p>
          )}
        </fieldset>
      )}

      {conAdelanto && (
        <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
          <Campo
            etiqueta={`Importe de la cuota de ${mesQueViene}`}
            value={opciones.importeAdelanto}
            onChange={(evento) => cambiar({ importeAdelanto: evento.target.value })}
            ayuda="Viene con la cuota de la fila; cambialo si la del mes que viene es distinta."
            disabled={disabled}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-slate-700">Qué hacer con la cuota adelantada</legend>
            <div className="flex flex-col gap-2">
              <Opcion
                nombre="modo-adelanto"
                elegido={opciones.modoAdelanto === 'ACREDITAR'}
                alElegir={() => cambiar({ modoAdelanto: 'ACREDITAR' })}
                texto={`Acreditarla a ${mesQueViene}`}
                detalle="cuando se arme el mes, la fila nace paga"
                deshabilitado={disabled}
              />
              <Opcion
                nombre="modo-adelanto"
                elegido={opciones.modoAdelanto === 'PENDIENTE'}
                alElegir={() => cambiar({ modoAdelanto: 'PENDIENTE' })}
                texto="Dejarla pendiente para imputar"
                detalle="la fila nace sin pagar y con el pago a la vista, para imputarlo al controlar el general"
                deshabilitado={disabled}
              />
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">
            El pago adelantado entra hoy en la caja y se rinde en la rendición de {mesQueViene}, que es el mes que paga.
          </p>
        </div>
      )}
    </div>
  )
}

function Opcion({
  nombre,
  elegido,
  alElegir,
  texto,
  detalle,
  deshabilitado,
}: {
  nombre: string
  elegido: boolean
  alElegir: () => void
  texto: string
  detalle?: string
  deshabilitado?: boolean
}) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        elegido ? 'border-marino-400 bg-marino-50 font-semibold text-marino-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        deshabilitado && 'cursor-not-allowed opacity-50',
      )}
    >
      <input type="radio" name={nombre} checked={elegido} onChange={alElegir} disabled={deshabilitado} className="h-4 w-4 border-slate-300" />
      {texto}
      {detalle && <span className="text-xs font-normal text-slate-500">({detalle})</span>}
    </label>
  )
}
