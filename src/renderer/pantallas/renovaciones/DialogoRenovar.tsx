// Los dos finales posibles de una renovación: renovarla (nace la vigencia nueva) o marcar que el
// cliente no renueva (se da de baja la póliza). Los dos diálogos viven juntos porque son el mismo
// momento de la gestión, trabajan sobre la misma FilaRenovacion y se abren desde la misma fila.
import { useEffect, useState } from 'react'
import { mesesDeVigencia, porcentajeDeAumento } from '../../../shared/polizas'
import {
  DESTINOS_DE_LA_ANTERIOR,
  DETALLE_DESTINO_ANTERIOR,
  MOTIVOS_DE_BAJA,
  NOMBRE_DESTINO_ANTERIOR,
  NOMBRE_MOTIVO_BAJA,
  type BandejaRenovaciones,
  type DatosDeRenovacion,
  type DestinoDeLaAnterior,
  type FilaRenovacion,
  type MotivoDeBaja,
} from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Cargando, cx, Dialogo, Selector } from '../../componentes/ui'

// ---------------------------------------------------------------------------
// Renovar
// ---------------------------------------------------------------------------

interface PropsRenovar {
  /** null = cerrado. Al pasar una fila se pide la sugerencia al proceso principal. */
  fila: FilaRenovacion | null
  alCerrar: () => void
  alRenovar: (bandeja: BandejaRenovaciones, nombre: string, destino: DestinoDeLaAnterior) => void
  alFallar: (mensaje: string) => void
}

const FORMULARIO_VACIO: DatosDeRenovacion = {
  vigenciaDesde: '',
  vigenciaHasta: '',
  cuota: '',
  numero: '',
  propuesta: '',
  observaciones: '',
  destinoDeLaAnterior: 'renovada',
  motivoDeBaja: 'CAMBIO DE COMPANIA',
  notaDeBaja: '',
}

/** «un año», «4 meses»: cuánto dura el plazo, escrito como se dice. */
function enMeses(meses: number): string {
  if (meses === 12) return 'un año'
  if (meses === 1) return 'un mes'
  return `${meses} meses`
}

/**
 * De dónde salió el plazo que se está proponiendo: de la compañía cuando lo tiene cargado (Agrosalta
 * cada 4 meses, Río Uruguay cada 6, Metropol cada 12), o de lo que duraba la vigencia que termina.
 */
function ayudaDeVigencia(fila: FilaRenovacion, datos: DatosDeRenovacion): string {
  if (fila.mesesDeRenovacion !== null) {
    return `Propuesta: ${enMeses(fila.mesesDeRenovacion)} después del inicio, que es cada cuánto renueva ${fila.compania ?? 'esta compañía'}.`
  }
  const propuesto = mesesDeVigencia(datos.vigenciaDesde, datos.vigenciaHasta)
  return propuesto === null
    ? 'Propuesta a partir del final de la vigencia anterior.'
    : `Propuesta: ${enMeses(propuesto)} después del inicio. Si esta compañía renueva con otro plazo, cargalo en Administración → Compañías.`
}

export function DialogoRenovar({ fila, alCerrar, alRenovar, alFallar }: PropsRenovar) {
  const [datos, setDatos] = useState<DatosDeRenovacion>(FORMULARIO_VACIO)
  const [cargando, setCargando] = useState(false)
  const [errorSugerencia, setErrorSugerencia] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [usarCalendario, setUsarCalendario] = useState(true)

  // La sugerencia se pide por polizaId y no por la fila entera: la bandeja se reemplaza en cada
  // guardado y la fila cambia de identidad aunque sea la misma póliza, lo que volvería a pedirla.
  const polizaId = fila?.polizaId ?? null

  useEffect(() => {
    if (polizaId === null) return
    let vigente = true
    setCargando(true)
    setGuardando(false)
    setErrorSugerencia(null)
    setDatos(FORMULARIO_VACIO)
    void window.dm.renovaciones.sugerencia(polizaId).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) {
        setDatos(resultado.datos)
        // El tipo del campo de fecha se decide una sola vez, al abrir. Si la vigencia propuesta viene
        // en ISO se usa el calendario del sistema; si vino en cualquier otro formato de la hoja se
        // deja texto libre, porque un <input type="date"> descarta lo que no entiende y borraría el dato.
        setUsarCalendario(esIso(resultado.datos.vigenciaDesde) && esIso(resultado.datos.vigenciaHasta))
      } else {
        setErrorSugerencia(resultado.error)
      }
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [polizaId])

  if (!fila) return null

  const porcentaje = porcentajeDeAumento(fila.observaciones)
  // La cuota que propone el proceso principal YA viene aumentada cuando las observaciones lo piden:
  // para eso la agencia deja la nota escrita. Acá no hay que volver a aplicarlo (sería el aumento dos
  // veces); lo que se ofrece es lo contrario, deshacerlo si esta vez no corresponde.
  const cuotaAnterior = (fila.cuota ?? '').trim()
  const yaAumentada = porcentaje !== null && cuotaAnterior !== '' && datos.cuota.trim() !== cuotaAnterior
  const puedeVolverALaAnterior = yaAumentada && leerCuota(cuotaAnterior) !== null

  const cambiar = <C extends keyof DatosDeRenovacion>(campo: C, valor: DatosDeRenovacion[C]) =>
    setDatos((previo) => ({ ...previo, [campo]: valor }))

  const destino: DestinoDeLaAnterior = datos.destinoDeLaAnterior ?? 'renovada'

  const guardar = async () => {
    setGuardando(true)
    const resultado = await window.dm.renovaciones.renovar(fila.polizaId, datos)
    setGuardando(false)
    if (resultado.ok) alRenovar(resultado.datos, fila.clienteNombre ?? 'La póliza', destino)
    else alFallar(resultado.error)
  }

  const tipoFecha = usarCalendario ? 'date' : 'text'

  return (
    <Dialogo
      abierto
      titulo="Renovar la póliza"
      descripcion={`${fila.clienteNombre ?? 'Sin nombre'} · ${fila.compania ?? ''} ${fila.numero ?? ''} · ${fila.patente ?? ''}`}
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton
            variante="primario"
            icono="renovaciones"
            onClick={() => void guardar()}
            cargando={guardando}
            disabled={cargando || errorSugerencia !== null}
          >
            Renovar la póliza
          </Boton>
        </>
      }
    >
      {cargando ? (
        <Cargando texto="Buscando la vigencia y la cuota anteriores…" />
      ) : errorSugerencia ? (
        <Alerta tono="error">{errorSugerencia}</Alerta>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            Se carga el número nuevo y nace la vigencia que sigue. Está todo propuesto (las fechas nuevas y la
            {yaAumentada ? ' cuota ya aumentada' : ' misma cuota'}): cambiá lo que haga falta antes de guardar. Abajo se
            elige qué pasa con la póliza anterior.
          </p>

          {fila.aumentaAlRenovar && (
            <Alerta tono="aviso">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>
                  {yaAumentada
                    ? `Esta póliza aumenta ${porcentaje}% al renovar: la cuota propuesta ya lo incluye (antes era ${cuotaAnterior}).`
                    : porcentaje !== null
                      ? `Esta póliza aumenta ${porcentaje}% al renovar.`
                      : 'Las observaciones piden aumentar la cuota al renovar.'}{' '}
                  {fila.observaciones && <span className="opacity-80">«{fila.observaciones}»</span>}
                </span>
                {puedeVolverALaAnterior && (
                  <Boton tamano="sm" onClick={() => cambiar('cuota', cuotaAnterior)}>
                    Dejar la cuota anterior
                  </Boton>
                )}
              </div>
            </Alerta>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Vigencia desde"
              type={tipoFecha}
              value={datos.vigenciaDesde}
              onChange={(evento) => cambiar('vigenciaDesde', evento.target.value)}
              placeholder={usarCalendario ? undefined : 'AAAA-MM-DD'}
            />
            <Campo
              etiqueta="Vigencia hasta"
              type={tipoFecha}
              value={datos.vigenciaHasta}
              onChange={(evento) => cambiar('vigenciaHasta', evento.target.value)}
              ayuda={ayudaDeVigencia(fila, datos)}
              placeholder={usarCalendario ? undefined : 'AAAA-MM-DD'}
            />
            <Campo
              etiqueta="Cuota"
              value={datos.cuota}
              onChange={(evento) => cambiar('cuota', evento.target.value)}
              ayuda={fila.cuota ? `Cuota anterior: ${fila.cuota}` : 'La póliza anterior no tenía cuota cargada.'}
              className="tabular-nums"
            />
            <Campo
              etiqueta="N° de póliza nuevo"
              value={datos.numero}
              onChange={(evento) => cambiar('numero', evento.target.value)}
              ayuda={fila.numero ? `Anterior: ${fila.numero}` : 'Dejalo vacío si todavía no lo emitieron.'}
            />
            <Campo
              etiqueta="N° de propuesta"
              value={datos.propuesta}
              onChange={(evento) => cambiar('propuesta', evento.target.value)}
              ayuda="Sólo algunas compañías la usan. Dejalo vacío si esta no da propuesta."
            />
          </div>

          <AreaTexto
            etiqueta="Observaciones"
            rows={3}
            value={datos.observaciones}
            onChange={(evento) => cambiar('observaciones', evento.target.value)}
            ayuda="Vienen las de la póliza anterior. Si ya aplicaste el aumento, conviene sacar la nota que lo pedía."
          />

          <DestinoDeLaPolizaAnterior
            fila={fila}
            destino={destino}
            motivo={datos.motivoDeBaja ?? 'CAMBIO DE COMPANIA'}
            nota={datos.notaDeBaja ?? ''}
            numeroNuevo={datos.numero}
            alElegir={(elegido) => cambiar('destinoDeLaAnterior', elegido)}
            alCambiarMotivo={(elegido) => cambiar('motivoDeBaja', elegido)}
            alCambiarNota={(texto) => cambiar('notaDeBaja', texto)}
          />
        </div>
      )}
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Qué pasa con la póliza anterior
// ---------------------------------------------------------------------------

/**
 * Las tres opciones, en el mismo cartel donde se carga el número nuevo.
 *
 * Hasta la 12.4 esto no se preguntaba: la anterior salía siempre de la cartera. Y casi siempre está
 * bien —por eso «Renovadas» viene elegida— pero los otros dos casos existen y no tenían salida. Si la
 * compañía anuló la vieja en vez de renovarla, la agencia la necesita en BAJAS, que es donde mira lo
 * que se perdió en el mes; y si las dos siguen vigentes —porque la compañía todavía no dio de baja la
 * anterior, o porque la nueva es de otro riesgo— sacarla de la cartera dejaba de cobrarse una póliza
 * que estaba viva.
 */
function DestinoDeLaPolizaAnterior({
  fila,
  destino,
  motivo,
  nota,
  numeroNuevo,
  alElegir,
  alCambiarMotivo,
  alCambiarNota,
}: {
  fila: FilaRenovacion
  destino: DestinoDeLaAnterior
  motivo: MotivoDeBaja
  nota: string
  numeroNuevo: string
  alElegir: (destino: DestinoDeLaAnterior) => void
  alCambiarMotivo: (motivo: MotivoDeBaja) => void
  alCambiarNota: (nota: string) => void
}) {
  const anterior = `${fila.compania ?? ''} ${fila.numero ?? 'sin número'}`.trim()
  const mismoNumero = numeroNuevo.trim() !== '' && numeroNuevo.trim() === (fila.numero ?? '').trim()

  return (
    <fieldset className="rounded-lg border border-slate-300 bg-white p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        La póliza anterior ({anterior})
      </legend>
      <div className="flex flex-col gap-1.5">
        {DESTINOS_DE_LA_ANTERIOR.map((opcion) => (
          <label
            key={opcion}
            className={cx(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm',
              destino === opcion ? 'border-marino-400 bg-marino-50' : 'border-slate-200 hover:bg-slate-50',
            )}
          >
            <input
              type="radio"
              name="destino-de-la-anterior"
              className="mt-0.5"
              checked={destino === opcion}
              onChange={() => alElegir(opcion)}
            />
            <span className="min-w-0">
              <span className="font-semibold text-slate-800">{NOMBRE_DESTINO_ANTERIOR[opcion]}</span>
              <span className="block text-xs leading-relaxed text-slate-600">{DETALLE_DESTINO_ANTERIOR[opcion]}</span>
            </span>
          </label>
        ))}
      </div>

      {destino === 'baja' && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Selector
            etiqueta="Motivo de la baja"
            value={motivo}
            onChange={(evento) => alCambiarMotivo(evento.target.value as MotivoDeBaja)}
            opciones={MOTIVOS_DE_BAJA.map((valor) => ({ valor, texto: NOMBRE_MOTIVO_BAJA[valor] }))}
          />
          <Campo
            etiqueta="Nota de la baja"
            value={nota}
            onChange={(evento) => alCambiarNota(evento.target.value)}
            ayuda="Opcional. Si la dejás vacía se anota que la renovó la póliza nueva."
          />
        </div>
      )}

      {destino === 'activa' && mismoNumero && (
        <div className="mt-3">
          <Alerta tono="aviso">
            Las dos pólizas van a quedar vigentes con el mismo número ({numeroNuevo.trim()}). Si la compañía emitió una
            nueva, cargá su número arriba; si es la misma póliza, lo que corresponde es dejarla en Renovadas.
          </Alerta>
        </div>
      )}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// No renueva
// ---------------------------------------------------------------------------

interface PropsNoRenueva {
  fila: FilaRenovacion | null
  alCerrar: () => void
  alConfirmar: (bandeja: BandejaRenovaciones, nombre: string) => void
  alFallar: (mensaje: string) => void
}

export function DialogoNoRenueva({ fila, alCerrar, alConfirmar, alFallar }: PropsNoRenueva) {
  // En la bandeja el caso habitual es que el cliente avise que no sigue; en Cartera el motivo más
  // común es otro («vendió»), por eso acá el que viene elegido no es el mismo.
  const [motivo, setMotivo] = useState<MotivoDeBaja>('ANULA POR DECISION DEL CLIENTE')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  const polizaId = fila?.polizaId ?? null
  useEffect(() => {
    if (polizaId === null) return
    setMotivo('ANULA POR DECISION DEL CLIENTE')
    setNota('')
    setGuardando(false)
  }, [polizaId])

  if (!fila) return null

  const confirmar = async () => {
    setGuardando(true)
    const resultado = await window.dm.renovaciones.noRenueva(fila.polizaId, { motivo, nota })
    setGuardando(false)
    if (resultado.ok) alConfirmar(resultado.datos, fila.clienteNombre ?? 'La póliza')
    else alFallar(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="El cliente no renueva"
      descripcion={`${fila.clienteNombre ?? 'Sin nombre'} · ${fila.compania ?? ''} ${fila.numero ?? ''} · ${fila.patente ?? ''}`}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="cerrar" onClick={() => void confirmar()} cargando={guardando}>
            No renueva y dar de baja
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* El casteo es seguro: las opciones salen de la misma lista MOTIVOS_DE_BAJA. */}
        <Selector
          etiqueta="Motivo"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value as MotivoDeBaja)}
          opciones={MOTIVOS_DE_BAJA.map((m) => ({ valor: m, texto: NOMBRE_MOTIVO_BAJA[m] }))}
        />
        <AreaTexto
          etiqueta="Nota"
          rows={3}
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          ayuda="Queda guardada con la baja y en el historial."
        />
        <Alerta tono="aviso">
          Se da de baja la póliza: sale de la bandeja de renovaciones y de la planilla del mes, y queda
          registrada en <strong className="font-semibold">Cartera → Bajas</strong>.
        </Alerta>
      </div>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// La cuota es texto libre: leerla y volver a escribirla igual
// ---------------------------------------------------------------------------

function esIso(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor)
}

/** Una cuota interpretada: el número y todo lo que lo rodea, para poder devolverlo tal como estaba. */
interface CuotaLeida {
  antes: string
  despues: string
  numero: number
  decimales: number
  conMiles: boolean
}

/**
 * En la hoja la cuota se escribe de todas las maneras: «$ 15.300,00», «15300», «AR$ 12.500», «$15.300.-».
 * Para aplicar el aumento hay que sacar el número sin perder el símbolo ni lo que venga detrás, y saber
 * con qué vestido estaba escrito (si agrupaba miles y cuántos decimales tenía) para devolverlo igual.
 * Devuelve null cuando no se entiende, y entonces la pantalla no ofrece el atajo: mejor que el usuario
 * escriba el importe a mano antes que inventarle un número.
 */
function leerCuota(texto: string): CuotaLeida | null {
  const encontrado = texto.match(/\d[\d.,]*/)
  if (!encontrado || encontrado.index === undefined) return null

  // «$15.300.-» → el número termina en el último dígito; los separadores sueltos quedan en `despues`.
  const crudo = encontrado[0].replace(/[.,]+$/, '')
  if (!crudo) return null
  const antes = texto.slice(0, encontrado.index)
  const despues = texto.slice(encontrado.index + crudo.length)

  let parteEntera = crudo
  let parteDecimal = ''
  const ultimaComa = crudo.lastIndexOf(',')
  if (ultimaComa >= 0) {
    parteEntera = crudo.slice(0, ultimaComa)
    parteDecimal = crudo.slice(ultimaComa + 1)
  } else {
    const trozos = crudo.split('.')
    // Un único punto con uno o dos dígitos detrás no separa miles, es el decimal («15300.5»).
    const ultimo = trozos[1]
    if (trozos.length === 2 && ultimo !== undefined && ultimo.length > 0 && ultimo.length < 3) {
      parteEntera = trozos[0] ?? ''
      parteDecimal = ultimo
    }
  }

  const digitos = parteEntera.replace(/\./g, '')
  if (!/^\d+$/.test(digitos) || !/^\d*$/.test(parteDecimal)) return null
  const numero = Number(`${digitos}.${parteDecimal || '0'}`)
  if (!Number.isFinite(numero) || numero <= 0) return null

  return { antes, despues, numero, decimales: parteDecimal.length, conMiles: parteEntera.includes('.') }
}

// El aumento por renovación lo calcula el proceso principal al armar la sugerencia (ver
// `cuotaSugerida` en servicios/renovaciones.ts), así que acá no hace falta volver a escribir importes:
// `leerCuota` queda sólo para saber si la cuota anterior es un número y se puede ofrecer volver a ella.
