// Los campos del auto y de la póliza que se completan con lo que leyó la IA, para revisar y corregir.
//
// Cada dato que vino del PDF lleva la marca «Leído del PDF»; los que el PDF no trajo y son obligatorios
// se resaltan con «Falta este dato». Los avisos de siempre del formulario de póliza (antigüedad de la
// cobertura, patente dada de baja por otro cliente) salen acá mismo, pegados a los campos que los producen.
import { FALTANTE, type PolizaDeAlta, type VehiculoDeAlta } from '../../../shared/lecturaDePoliza'
import type { AvisoDeCobertura, CatalogosDePoliza, PatenteDadaDeBaja } from '../../../shared/tipos'
import { Alerta, Campo } from '../../componentes/ui'

const LISTA_COMPANIAS = 'lista-companias-alta-pdf'
const LISTA_COBERTURAS = 'lista-coberturas-alta-pdf'
const LISTA_FORMAS_DE_PAGO = 'lista-formas-de-pago-alta-pdf'

export interface ConfirmacionDeAviso {
  /** Quien puede confirmar el aviso (un administrador). Un empleado ve que lo tiene que confirmar otro. */
  puedeConfirmar: boolean
  confirmado: boolean
  alConfirmar: (confirmado: boolean) => void
}

interface Props {
  vehiculo: VehiculoDeAlta
  poliza: PolizaDeAlta
  alCambiarVehiculo: (campo: keyof VehiculoDeAlta, valor: string) => void
  alCambiarPoliza: (campo: keyof PolizaDeAlta, valor: string) => void
  /** Claves de lo que vino del PDF: `vehiculo.chasis`, `poliza.vigenciaDesde`… */
  leidos: ReadonlySet<string>
  /** Etiquetas de lo que todavía falta (ver `FALTANTE`). */
  faltan: readonly string[]
  catalogos: CatalogosDePoliza | null
  avisoDeCobertura: AvisoDeCobertura | null
  confirmacionDelAviso: ConfirmacionDeAviso
  patenteDeBaja: PatenteDadaDeBaja | null
  confirmacionDeLaPatente: Pick<ConfirmacionDeAviso, 'confirmado' | 'alConfirmar'>
}

function CasillaDeConfirmacion({ confirmado, alConfirmar, children }: { confirmado: boolean; alConfirmar: (valor: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
      <input
        type="checkbox"
        checked={confirmado}
        onChange={(evento) => alConfirmar(evento.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-amber-300"
      />
      <span>{children}</span>
    </label>
  )
}

export function CamposDePolizaLeida({
  vehiculo,
  poliza,
  alCambiarVehiculo,
  alCambiarPoliza,
  leidos,
  faltan,
  catalogos,
  avisoDeCobertura,
  confirmacionDelAviso,
  patenteDeBaja,
  confirmacionDeLaPatente,
}: Props) {
  const marca = (clave: string) => (leidos.has(clave) ? 'Leído del PDF' : undefined)
  const falta = (etiqueta: string) => (faltan.includes(etiqueta) ? 'Falta este dato' : null)

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" aria-label="Auto">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Auto</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Patente"
            value={vehiculo.patente}
            onChange={(evento) => alCambiarVehiculo('patente', evento.target.value)}
            ayuda={marca('vehiculo.patente')}
            error={falta(FALTANTE.patente)}
            className="uppercase tabular-nums"
            autoComplete="off"
          />
          <Campo etiqueta="Marca" value={vehiculo.marca} onChange={(evento) => alCambiarVehiculo('marca', evento.target.value)} ayuda={marca('vehiculo.marca')} autoComplete="off" />
          <Campo etiqueta="Modelo" value={vehiculo.modelo} onChange={(evento) => alCambiarVehiculo('modelo', evento.target.value)} ayuda={marca('vehiculo.modelo')} autoComplete="off" />
          <Campo etiqueta="Año" value={vehiculo.anio} onChange={(evento) => alCambiarVehiculo('anio', evento.target.value)} ayuda={marca('vehiculo.anio')} className="tabular-nums" autoComplete="off" />
          <Campo etiqueta="Motor" value={vehiculo.motor} onChange={(evento) => alCambiarVehiculo('motor', evento.target.value)} ayuda={marca('vehiculo.motor')} autoComplete="off" />
          <Campo etiqueta="Chasis" value={vehiculo.chasis} onChange={(evento) => alCambiarVehiculo('chasis', evento.target.value)} ayuda={marca('vehiculo.chasis')} autoComplete="off" />
        </div>
        {patenteDeBaja && (
          <div className="flex flex-col gap-2">
            <Alerta tono="aviso">
              Esta patente fue dada de baja{patenteDeBaja.fechaBaja ? ` el ${patenteDeBaja.fechaBaja}` : ''} por <strong className="font-semibold">{patenteDeBaja.clienteAnterior}</strong>. ¿Desea continuar?
            </Alerta>
            <CasillaDeConfirmacion confirmado={confirmacionDeLaPatente.confirmado} alConfirmar={confirmacionDeLaPatente.alConfirmar}>
              <strong className="font-semibold">Es el mismo auto: continuar.</strong> Pasa a nombre de este cliente.
            </CasillaDeConfirmacion>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Póliza">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Póliza</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Compañía"
            value={poliza.compania}
            onChange={(evento) => alCambiarPoliza('compania', evento.target.value)}
            ayuda={marca('poliza.compania')}
            error={falta(FALTANTE.compania)}
            list={LISTA_COMPANIAS}
            autoComplete="off"
          />
          <Campo
            etiqueta="N.º de póliza"
            value={poliza.numero}
            onChange={(evento) => alCambiarPoliza('numero', evento.target.value)}
            ayuda={marca('poliza.numero') ?? (poliza.propuesta ? undefined : 'Si todavía no está emitida, cargá la propuesta.')}
            error={falta(FALTANTE.numero)}
            className="tabular-nums"
            autoComplete="off"
          />
          <Campo
            etiqueta="N.º de propuesta"
            value={poliza.propuesta}
            onChange={(evento) => alCambiarPoliza('propuesta', evento.target.value)}
            ayuda={marca('poliza.propuesta')}
            className="tabular-nums"
            autoComplete="off"
          />
          <Campo
            etiqueta="Cobertura"
            value={poliza.cobertura}
            onChange={(evento) => alCambiarPoliza('cobertura', evento.target.value)}
            ayuda={marca('poliza.cobertura')}
            error={falta(FALTANTE.cobertura)}
            list={LISTA_COBERTURAS}
            autoComplete="off"
          />
          <Campo
            etiqueta="Vigencia desde"
            value={poliza.vigenciaDesde}
            onChange={(evento) => alCambiarPoliza('vigenciaDesde', evento.target.value)}
            ayuda={marca('poliza.vigenciaDesde') ?? 'dd/mm/aaaa'}
            className="tabular-nums"
            autoComplete="off"
          />
          <Campo
            etiqueta="Vigencia hasta"
            value={poliza.vigenciaHasta}
            onChange={(evento) => alCambiarPoliza('vigenciaHasta', evento.target.value)}
            ayuda={marca('poliza.vigenciaHasta') ?? 'dd/mm/aaaa'}
            className="tabular-nums"
            autoComplete="off"
          />
          <Campo
            etiqueta="Forma de pago"
            value={poliza.formaPago}
            onChange={(evento) => alCambiarPoliza('formaPago', evento.target.value)}
            ayuda={marca('poliza.formaPago')}
            error={falta(FALTANTE.formaPago)}
            list={LISTA_FORMAS_DE_PAGO}
            autoComplete="off"
          />
        </div>
        {avisoDeCobertura?.mensaje && (
          <div className="flex flex-col gap-2">
            <Alerta tono={avisoDeCobertura.hayProblema ? 'aviso' : 'info'}>
              <p>{avisoDeCobertura.mensaje}</p>
            </Alerta>
            {avisoDeCobertura.hayProblema &&
              (confirmacionDelAviso.puedeConfirmar ? (
                <CasillaDeConfirmacion confirmado={confirmacionDelAviso.confirmado} alConfirmar={confirmacionDelAviso.alConfirmar}>
                  <strong className="font-semibold">Continuar igual.</strong> Queda registrado que lo confirmaste vos.
                </CasillaDeConfirmacion>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">
                  Esto lo tiene que confirmar un administrador.
                </p>
              ))}
          </div>
        )}
      </section>

      <datalist id={LISTA_COMPANIAS}>
        {(catalogos?.companias ?? []).map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>
      <datalist id={LISTA_COBERTURAS}>
        {(catalogos?.coberturas ?? []).map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>
      <datalist id={LISTA_FORMAS_DE_PAGO}>
        {(catalogos?.formasDePago ?? []).map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>
    </div>
  )
}
