// Panel lateral con el resto de las columnas de la fila (las que no entran en la tabla) y su historial.
import { useEffect, useRef, useState } from 'react'
import type { CampoEditable, EntradaHistorial, FilaCartera } from '../../../shared/tipos'
import type { ResultadoDeEliminacion } from '../../../shared/eliminacion'
import { claveDeFilaDeCelda } from '../../../shared/presencia'
import { Icono } from '../../componentes/Icono'
import { Glow, InsigniaDePresencia, motivoDelBloqueo, useCursorAdentro } from '../../componentes/Presencia'
import { seGuardaAlSalir } from '../../componentes/presencia-reglas'
import { cx } from '../../componentes/ui'
import { useBloqueoDe, useFocoDeObjeto } from '../../contexto/Presencia'
import { BotonEliminar, usePuedeEliminar } from '../../componentes/BotonEliminar'

interface Props {
  fila: FilaCartera
  soloLectura: boolean
  alCerrar: () => void
  alGuardar: (campo: CampoEditable, valor: string) => void
  /** Se borró la fila de la planilla. Sólo lo puede hacer un superadministrador. */
  alBorrar: (resultado: ResultadoDeEliminacion) => void
  /** Se deshizo una entrada del historial: la fila queda como estaba antes de ese cambio. */
  alDeshacer: (fila: FilaCartera, mensaje: string) => void
}

const GRUPOS: Array<{ titulo: string; campos: Array<{ campo: CampoEditable; etiqueta: string }> }> = [
  {
    titulo: 'Cliente',
    campos: [
      { campo: 'nombre', etiqueta: 'Nombre y apellido' },
      { campo: 'documento', etiqueta: 'DNI/CUIT' },
      { campo: 'telefono', etiqueta: 'Teléfono' },
      { campo: 'email', etiqueta: 'Email' },
      { campo: 'direccion', etiqueta: 'Dirección' },
      { campo: 'localidad', etiqueta: 'Localidad' },
      { campo: 'sucursal', etiqueta: 'Sucursal' },
    ],
  },
  {
    titulo: 'Vehículo',
    campos: [
      { campo: 'vehiculo', etiqueta: 'Vehículo' },
      { campo: 'marca', etiqueta: 'Marca' },
      { campo: 'modelo', etiqueta: 'Modelo' },
      { campo: 'anio', etiqueta: 'Año' },
      { campo: 'patente', etiqueta: 'Patente' },
      { campo: 'motor', etiqueta: 'Motor' },
      { campo: 'chasis', etiqueta: 'Chasis' },
      { campo: 'uso', etiqueta: 'Uso' },
      { campo: 'color', etiqueta: 'Color' },
    ],
  },
  {
    titulo: 'Póliza',
    campos: [
      { campo: 'compania', etiqueta: 'Compañía' },
      { campo: 'numeroPoliza', etiqueta: 'Póliza' },
      { campo: 'propuesta', etiqueta: 'Propuesta' },
      { campo: 'cobertura', etiqueta: 'Cobertura' },
      { campo: 'prima', etiqueta: 'Prima' },
      { campo: 'productor', etiqueta: 'Productor' },
      { campo: 'vigenciaDesde', etiqueta: 'Desde' },
      { campo: 'vigenciaHasta', etiqueta: 'Hasta' },
    ],
  },
  {
    titulo: 'Este mes',
    campos: [
      { campo: 'cuota', etiqueta: 'Cuota' },
      { campo: 'diaVencimiento', etiqueta: 'Fecha de venc' },
      { campo: 'formaPago', etiqueta: 'Forma de pago' },
      { campo: 'aviso', etiqueta: 'OB. avisos' },
      { campo: 'avisarVto', etiqueta: 'Avisar vto' },
      { campo: 'pago', etiqueta: 'Cuando pago' },
      { campo: 'observaciones', etiqueta: 'Observaciones' },
    ],
  },
]

export function PanelDetalle({ fila, soloLectura, alCerrar, alGuardar, alBorrar, alDeshacer }: Props) {
  const [historial, setHistorial] = useState<EntradaHistorial[]>([])
  const [verHistorial, setVerHistorial] = useState(false)
  const [deshaciendo, setDeshaciendo] = useState<number | null>(null)
  const [errorDeshacer, setErrorDeshacer] = useState<string | null>(null)
  // Acá no hay botón de Guardar: cada campo se guarda al perder el foco, así que lo que hace de
  // «cambios sin guardar» es tener el cursor adentro de un campo. Ver `useCursorAdentro`.
  const [conCursor, propsDelCursor] = useCursorAdentro()

  // El glow de la 14.0: la fila entera, con la misma clave con la que se enciende el renglón de Mora y
  // el de Deudores. No es `objeto:cuota:...` porque `Foco` no tiene ese objeto: la fila de la planilla
  // ES la cuota del mes, y `objeto:fila:<filaId>` es la clave que ya usa la tabla.
  const claveDeFoco = claveDeFilaDeCelda(fila.filaId)
  useFocoDeObjeto('fila', fila.filaId, conCursor)
  const bloqueadaPor = useBloqueoDe(claveDeFoco)
  // Trabado por otra computadora: los campos pasan a sólo lectura, que es acá el equivalente del
  // botón de Guardar apagado de las fichas (este panel guarda campo por campo y no tiene botón). Ojo:
  // el candado se aplica al ENTRAR a un campo y no a mitad de una edición; lo decide `CampoDelDetalle`.
  const trabado = soloLectura || bloqueadaPor !== null

  useEffect(() => {
    if (!verHistorial) return
    let vigente = true
    void window.dm.cartera.historialDeFila(fila.filaId).then((resultado) => {
      if (vigente && resultado.ok) setHistorial(resultado.datos)
    })
    return () => {
      vigente = false
    }
  }, [fila.filaId, verHistorial])

  useEffect(() => {
    setVerHistorial(false)
    setHistorial([])
    setErrorDeshacer(null)
  }, [fila.filaId])

  /**
   * Deshacer una entrada: al volver bien se recarga el historial entero (no sólo se tacha la fila a
   * mano) porque deshacer TAMBIÉN queda anotado como un cambio más —es el mismo `registrarCambio` de
   * siempre—, así que la lista tiene un renglón nuevo además de la marca de «deshecho» en el viejo.
   */
  const deshacer = async (entrada: EntradaHistorial) => {
    if (trabado || deshaciendo !== null) return
    setDeshaciendo(entrada.id)
    setErrorDeshacer(null)
    const resultado = await window.dm.cartera.deshacerHistorial(entrada.id)
    setDeshaciendo(null)
    if (!resultado.ok) {
      setErrorDeshacer(resultado.error)
      return
    }
    const historialActualizado = await window.dm.cartera.historialDeFila(fila.filaId)
    if (historialActualizado.ok) setHistorial(historialActualizado.datos)
    alDeshacer(
      resultado.datos,
      `Se deshizo «${entrada.campo}» de ${resultado.datos.nombre ?? 'la fila'}: volvió a ${entrada.valorAnterior ? `«${entrada.valorAnterior}»` : 'estar vacío'}.`,
    )
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" {...propsDelCursor}>
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        {/* El aura envuelve todo el bloque del nombre: acá la insignia va debajo, no al lado —el
            panel mide 24rem y no entra junto al botón de cerrar. */}
        <Glow claveDeFoco={claveDeFoco} redondeo="rounded-md" className="block min-w-0">
          <p className="truncate font-display text-base font-bold text-slate-900">{fila.nombre ?? 'Sin nombre'}</p>
          <p className="truncate text-xs text-slate-500">
            {fila.compania ?? '—'} · {fila.numeroPoliza ?? 'sin póliza'} · {fila.patente ?? 'sin patente'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <InsigniaDePresencia claveDeFoco={claveDeFoco} />
          </div>
          {bloqueadaPor && <p className="mt-1 text-xs font-semibold text-amber-700">{motivoDelBloqueo(bloqueadaPor)}</p>}
        </Glow>
        <button type="button" aria-label="Cerrar el detalle" onClick={alCerrar} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Icono nombre="cerrar" tamano={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {GRUPOS.map((grupo) => (
          <section key={grupo.titulo} className="mb-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{grupo.titulo}</p>
            <dl className="flex flex-col gap-1">
              {grupo.campos.map(({ campo, etiqueta }) => (
                <CampoDelDetalle
                  key={`${fila.filaId}-${campo}`}
                  etiqueta={etiqueta}
                  valor={(fila[campo as keyof FilaCartera] as string | null) ?? ''}
                  trabado={trabado}
                  motivo={bloqueadaPor ? motivoDelBloqueo(bloqueadaPor) : undefined}
                  alGuardar={(escrito) => alGuardar(campo, escrito)}
                />
              ))}
            </dl>
          </section>
        ))}

        <section>
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-800"
          >
            <Icono nombre={verHistorial ? 'ojoTachado' : 'ojo'} tamano={13} />
            Historial de la fila
          </button>
          {verHistorial &&
            (historial.length === 0 ? (
              <p className="text-xs text-slate-400">Todavía no se tocó nada en esta fila desde la aplicación.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {historial.map((entrada) => (
                  <li key={entrada.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">
                      {entrada.campo} <span className="font-normal text-slate-500">· {entrada.usuarioNombre}</span>
                    </p>
                    <p className="truncate">
                      {entrada.valorAnterior ? <s className="text-slate-400">{entrada.valorAnterior}</s> : <span className="text-slate-400">(vacío)</span>}
                      {' → '}
                      <strong className="font-semibold">{entrada.valorNuevo ?? '(vacío)'}</strong>
                    </p>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">{new Date(entrada.fecha).toLocaleString('es-AR')}</p>
                      {entrada.deshechoEn ? (
                        <p className="text-[11px] font-semibold text-slate-400">
                          Deshecho por {entrada.deshechoPor} · {new Date(entrada.deshechoEn).toLocaleString('es-AR')}
                        </p>
                      ) : (
                        entrada.puedeDeshacerse && (
                          <button
                            type="button"
                            disabled={trabado || deshaciendo !== null}
                            onClick={() => void deshacer(entrada)}
                            className="shrink-0 font-semibold text-marino-600 hover:text-marino-800 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                          >
                            {deshaciendo === entrada.id ? 'Deshaciendo…' : 'Deshacer'}
                          </button>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          {verHistorial && errorDeshacer && <p className="mt-2 text-xs font-semibold text-red-600">{errorDeshacer}</p>}
        </section>
      </div>

      {/* La papelera va al pie y separada del resto: es lo único de este panel que no se deshace. Para
          quien no es superadministrador no se dibuja nada, ni el pie. */}
      <PieDeBorrado fila={fila} alBorrar={alBorrar} />
    </aside>
  )
}

/**
 * Un campo del panel: se guarda solo al salir, sin botón de Guardar.
 *
 * EL CANDADO SE CONGELA AL ENTRAR AL CAMPO. `trabado` incluye el bloqueo suave de la 14.0, que es
 * estado VIVO: aparece en cuanto otra computadora entra a la misma fila de la planilla, y eso pasa con
 * la persona a mitad de una palabra. Si el candado de AHORA decidiera el guardado, lo tipeado se
 * tiraría en silencio y el texto seguiría a la vista como si estuviera guardado, hasta que la fila se
 * refrescara y volviera el valor viejo: trabajo perdido sin un solo cartel. Ver `seGuardaAlSalir`.
 *
 * Y EL VALOR VA EN ESTADO, no en un `key` con el valor adentro. Con el valor en el `key`, un cambio de
 * ese mismo campo hecho en otra computadora desmontaba el `<input>` con el cursor adentro: se perdía lo
 * escrito y, de paso, el `focusout` no llegaba nunca (Chromium no lo dispara al sacar del DOM al
 * elemento enfocado) y esta computadora quedaba reportando «editando» para siempre. Lo que llega de
 * afuera se adopta salvo que acá haya alguien escribiendo; el choque lo resuelve el 409 del `previo`.
 */
function CampoDelDetalle({
  etiqueta,
  valor,
  trabado,
  motivo,
  alGuardar,
}: {
  etiqueta: string
  valor: string
  trabado: boolean
  motivo: string | undefined
  alGuardar: (escrito: string) => void
}) {
  const [texto, setTexto] = useState(valor)
  const [conElCursor, setConElCursor] = useState(false)
  const escribiendo = useRef(false)
  const trabadoAlEntrar = useRef(trabado)

  useEffect(() => {
    if (!escribiendo.current) setTexto(valor)
  }, [valor])

  // Con el cursor adentro manda el candado con el que se entró; con el cursor afuera, el de ahora (que
  // es lo que hace que el campo se vea gris apenas la otra computadora empieza a editar la fila).
  const candado = conElCursor ? trabadoAlEntrar.current : trabado

  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
      <dt className="truncate text-xs text-slate-500">{etiqueta}</dt>
      <dd>
        <input
          value={texto}
          readOnly={candado}
          title={motivo}
          onChange={(evento) => setTexto(evento.currentTarget.value)}
          onFocus={() => {
            trabadoAlEntrar.current = trabado
            escribiendo.current = true
            setConElCursor(true)
          }}
          onBlur={() => {
            escribiendo.current = false
            setConElCursor(false)
            if (seGuardaAlSalir(trabadoAlEntrar.current, texto, valor)) alGuardar(texto)
            // Nada que guardar: se adopta lo que haya llegado de afuera mientras el cursor estaba acá.
            else setTexto(valor)
          }}
          className={cx(
            'w-full rounded border border-transparent px-1.5 py-1 text-sm text-slate-800',
            candado ? 'bg-slate-50' : 'hover:border-slate-300 focus:border-marino-400 focus:outline-none focus:ring-2 focus:ring-marino-500/25',
          )}
        />
      </dd>
    </div>
  )
}

function PieDeBorrado({ fila, alBorrar }: { fila: FilaCartera; alBorrar: Props['alBorrar'] }) {
  if (!usePuedeEliminar('cuota')) return null
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">Borra esta fila del mes, no la póliza.</p>
      <BotonEliminar tipo="cuota" id={fila.cuotaId} alBorrar={alBorrar} />
    </footer>
  )
}
