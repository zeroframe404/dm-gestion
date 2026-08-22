// La matriz de coberturas: qué antigüedad de vehículo acepta cada compañía para cada cobertura.
// A diferencia del resto de la cartera, esta pantalla ARRANCA VACÍA y no hay nada que hacerle: la
// pestaña COBERTURA de la hoja no es una tabla sino un resumen con celdas combinadas, así que el
// importador no la puede mapear y la matriz la carga el superadministrador a mano. Por eso la
// pantalla está diseñada al revés que las otras: lo primero que se ve no son los datos cargados,
// sino la lista de lo que falta cargar, ordenada por cuántas pólizas depende de cada combinación.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DatosDeRegla, MatrizDeCobertura, ReglaDeCobertura } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, cx, Dialogo, Etiqueta } from '../../componentes/ui'

/** Igual que en la planilla: se compara sin acentos ni signos porque los nombres vienen escritos a mano. */
function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/** Ordena alfabéticamente respetando acentos y ñ, que es como se leen los nombres de las compañías. */
const comparar = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'es-AR')

/**
 * El límite en el idioma del mostrador. La regla se puede cargar de dos maneras (años de antigüedad o
 * año de fabricación mínimo), pero al que atiende le sirve una sola frase, así que la antigüedad se
 * traduce siempre a un año concreto: «hasta 20 años» no dice nada, «modelo 2006 o más nuevo» sí.
 */
function limiteEnPalabras(antiguedadMaxima: number | null, anioMinimo: number | null, anioActual: number): string {
  if (antiguedadMaxima !== null) {
    return `hasta ${antiguedadMaxima} ${antiguedadMaxima === 1 ? 'año' : 'años'} (modelo ${anioActual - antiguedadMaxima} o más nuevo)`
  }
  if (anioMinimo !== null) return `modelo ${anioMinimo} o más nuevo`
  return ''
}

/** Lee un campo del formulario como entero: null si está vacío, NaN si tiene algo que no es un número. */
function aNumero(texto: string): number | null {
  const limpio = texto.trim()
  if (!limpio) return null
  return /^\d+$/.test(limpio) ? Number(limpio) : Number.NaN
}

const REGLA_VACIA: DatosDeRegla = {
  compania: '',
  cobertura: '',
  incluye: '',
  franquicia: '',
  detalle: '',
  observaciones: '',
  antiguedadMaxima: '',
  anioMinimo: '',
}

/** Lo que el diálogo está editando: `id` en null es una regla nueva. */
interface Edicion {
  id: number | null
  datos: DatosDeRegla
}

export function ReglasCobertura() {
  const [matriz, setMatriz] = useState<MatrizDeCobertura | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [verReferencia, setVerReferencia] = useState(false)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<ReglaDeCobertura | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.reglas.matriz()
    if (resultado.ok) setMatriz(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const reglas = matriz?.reglas ?? []
  const anioActual = matriz?.anioActual ?? new Date().getFullYear()
  const puedeEditar = matriz?.puedeEditar ?? false

  const ordenadas = useMemo(
    () => [...reglas].sort((a, b) => comparar(a.compania, b.compania) || comparar(a.cobertura, b.cobertura)),
    [reglas],
  )

  const filtradas = useMemo(() => {
    const texto = normalizar(busqueda)
    if (!texto) return ordenadas
    return ordenadas.filter((regla) => normalizar(regla.compania).includes(texto) || normalizar(regla.cobertura).includes(texto))
  }, [ordenadas, busqueda])

  // El backend ya las manda ordenadas, pero el orden es lo único que hace útil este bloque
  // («empezá por acá»), así que no se confía en que venga dado.
  const faltantes = useMemo(() => [...(matriz?.faltantes ?? [])].sort((a, b) => b.polizas - a.polizas), [matriz])

  /** Los nombres ya escritos, para el datalist del formulario: evita cargar «SANCOR» y «Sancor Seguros». */
  const sugerencias = useMemo(() => {
    const companias = new Set<string>()
    const coberturas = new Set<string>()
    for (const regla of reglas) {
      if (regla.compania) companias.add(regla.compania)
      if (regla.cobertura) coberturas.add(regla.cobertura)
    }
    for (const falta of matriz?.faltantes ?? []) {
      companias.add(falta.compania)
      coberturas.add(falta.cobertura)
    }
    return {
      companias: [...companias].sort((a, b) => comparar(a, b)),
      coberturas: [...coberturas].sort((a, b) => comparar(a, b)),
    }
  }, [reglas, matriz])

  const guardar = async (datos: DatosDeRegla) => {
    if (!edicion) return 'Se cerró el formulario antes de guardar.'
    // Crear y editar devuelven la matriz entera ya recalculada, así que no hace falta recargar: los
    // «faltantes» se achican solos apenas se carga la regla que les faltaba.
    const resultado = edicion.id === null ? await window.dm.reglas.crear(datos) : await window.dm.reglas.editar(edicion.id, datos)
    if (!resultado.ok) return resultado.error
    setMatriz(resultado.datos)
    setEdicion(null)
    setError(null)
    setAviso(`Se guardó la regla de ${datos.compania} · ${datos.cobertura}.`)
    return null
  }

  const confirmarBorrado = async () => {
    if (!borrando) return
    const resultado = await window.dm.reglas.borrar(borrando.id)
    if (resultado.ok) {
      setMatriz(resultado.datos)
      setAviso(`Se borró la regla de ${borrando.compania ?? 'la compañía'} · ${borrando.cobertura ?? 'la cobertura'}.`)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setBorrando(null)
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  if (cargando && !matriz) return <Cargando texto="Buscando las reglas de cobertura…" />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      {/* --- Barra de herramientas ------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por compañía o cobertura…"
            aria-label="Buscar por compañía o cobertura"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reglas cargadas</span>
          <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">{reglas.length.toLocaleString('es-AR')}</span>
        </div>
        {faltantes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">Sin regla</span>
            <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-amber-800">{faltantes.length.toLocaleString('es-AR')}</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar()} disabled={cargando}>
            Actualizar
          </Boton>
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setEdicion({ id: null, datos: REGLA_VACIA })}>
              Nueva regla
            </Boton>
          )}
        </div>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {!puedeEditar && (
        <Alerta tono="info">
          La matriz la carga y la edita el superadministrador. Acá la podés consultar mientras atendés: si falta una compañía o una
          cobertura, pedísela para que la cargue.
        </Alerta>
      )}

      {/* --- Lo que falta cargar --------------------------------------------- */}
      {faltantes.length > 0 && (
        <section className="shrink-0 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <Icono nombre="alerta" tamano={16} className="shrink-0" />
            Faltan {faltantes.length} combinaciones de la cartera
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Estas compañías y coberturas ya están usadas en pólizas y todavía no tienen regla, así que al cargar una póliza nadie avisa si
            el vehículo es demasiado viejo. Están ordenadas por cantidad de pólizas: {puedeEditar ? 'cargá primero las de arriba' : 'las de arriba son las más urgentes'}.
          </p>
          <ul className="mt-2.5 flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
            {faltantes.map((falta) => (
              <li
                key={`${falta.compania}|${falta.cobertura}`}
                className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-sm"
              >
                <span className="font-semibold text-slate-900">{falta.compania}</span>
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-700">{falta.cobertura}</span>
                <span className="ml-auto shrink-0 tabular-nums text-xs text-slate-500">
                  {falta.polizas.toLocaleString('es-AR')} {falta.polizas === 1 ? 'póliza' : 'pólizas'}
                </span>
                {/* Sin permiso el botón no tendría a dónde llevar, pero el dato igual sirve para pedir la carga. */}
                {puedeEditar && (
                  <Boton
                    tamano="sm"
                    icono="mas"
                    onClick={() => setEdicion({ id: null, datos: { ...REGLA_VACIA, compania: falta.compania, cobertura: falta.cobertura } })}
                  >
                    Cargar
                  </Boton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- La matriz -------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Compañía</th>
              <th className={encabezado}>Cobertura</th>
              <th className={encabezado}>Antigüedad máxima</th>
              <th className={encabezado}>Año mínimo</th>
              <th className={encabezado}>Incluye</th>
              <th className={encabezado}>Franquicia</th>
              <th className={encabezado}>Detalle</th>
              <th className={encabezado}>Observaciones</th>
              {puedeEditar && <th className={encabezado} />}
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={puedeEditar ? 9 : 8} className="px-3 py-10 text-center">
                  {reglas.length === 0 ? (
                    <div className="mx-auto max-w-lg">
                      <p className="font-semibold text-slate-700">La matriz de coberturas todavía está vacía.</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                        No se importa sola: la pestaña COBERTURA de la hoja es un cuadro de resumen con celdas combinadas y no se puede leer
                        como tabla.{' '}
                        {puedeEditar
                          ? 'Cargala a mano con «Nueva regla», o arrancá por las combinaciones que ya usa la cartera, arriba.'
                          : 'La carga el superadministrador; abajo, en «Lo que dice la hoja», está el cuadro original.'}
                      </p>
                    </div>
                  ) : (
                    <span className="text-slate-500">Ninguna regla coincide con «{busqueda}».</span>
                  )}
                </td>
              </tr>
            )}
            {filtradas.map((regla) => {
              const sinLimite = regla.antiguedadMaxima === null && regla.anioMinimo === null
              // Cuando la regla se cargó por antigüedad, el año se calcula: se muestra igual, más apagado,
              // porque es lo que realmente se compara contra el modelo del auto.
              const anioCalculado = regla.anioMinimo === null && regla.antiguedadMaxima !== null
              const anioTope = regla.anioMinimo ?? (regla.antiguedadMaxima !== null ? anioActual - regla.antiguedadMaxima : null)
              return (
                <tr key={regla.id} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="px-3 py-2 font-medium text-slate-900">{regla.compania ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{regla.cobertura ?? '—'}</td>
                  {sinLimite ? (
                    <td className="px-3 py-2" colSpan={2}>
                      <Etiqueta tono="neutro">sin límite cargado</Etiqueta>
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700">
                        {regla.antiguedadMaxima !== null
                          ? `hasta ${regla.antiguedadMaxima} ${regla.antiguedadMaxima === 1 ? 'año' : 'años'}`
                          : '—'}
                      </td>
                      <td
                        className={cx('px-3 py-2 whitespace-nowrap tabular-nums', anioCalculado ? 'text-slate-500' : 'font-medium text-slate-800')}
                        title={anioCalculado ? `Calculado: ${anioActual} menos ${regla.antiguedadMaxima} años de antigüedad.` : undefined}
                      >
                        {anioTope !== null ? `modelo ${anioTope} o más nuevo` : '—'}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-slate-600">{regla.incluye ?? ''}</td>
                  <td className="px-3 py-2 text-slate-600">{regla.franquicia ?? ''}</td>
                  <td className="px-3 py-2 text-slate-600">{regla.detalle ?? ''}</td>
                  <td className="px-3 py-2 text-slate-600">{regla.observaciones ?? ''}</td>
                  {puedeEditar && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <Boton
                          tamano="sm"
                          variante="fantasma"
                          icono="lapiz"
                          onClick={() =>
                            setEdicion({
                              id: regla.id,
                              datos: {
                                compania: regla.compania ?? '',
                                cobertura: regla.cobertura ?? '',
                                incluye: regla.incluye ?? '',
                                franquicia: regla.franquicia ?? '',
                                detalle: regla.detalle ?? '',
                                observaciones: regla.observaciones ?? '',
                                antiguedadMaxima: regla.antiguedadMaxima === null ? '' : String(regla.antiguedadMaxima),
                                anioMinimo: regla.anioMinimo === null ? '' : String(regla.anioMinimo),
                              },
                            })
                          }
                        >
                          Editar
                        </Boton>
                        <Boton tamano="sm" variante="fantasma" icono="basura" onClick={() => setBorrando(regla)}>
                          Borrar
                        </Boton>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- El cuadro original de la hoja ------------------------------------ */}
      {(matriz?.referencia.length ?? 0) > 0 && (
        <section className="shrink-0 rounded-lg border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setVerReferencia((abierto) => !abierto)}
            aria-expanded={verReferencia}
            aria-controls="referencia-hoja"
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
          >
            <Icono nombre="flechaDerecha" tamano={14} className={cx('shrink-0 transition-transform', verReferencia && 'rotate-90')} />
            Lo que dice la hoja
            <span className="font-normal text-slate-500">
              · {matriz?.referencia.length} {matriz?.referencia.length === 1 ? 'fila' : 'filas'} de la pestaña COBERTURA
            </span>
          </button>
          {verReferencia && (
            <div id="referencia-hoja" className="border-t border-slate-200">
              <p className="px-3.5 py-2 text-xs leading-relaxed text-slate-500">
                La pestaña COBERTURA es un cuadro de resumen con celdas combinadas, no una tabla, así que no se puede importar sola: esto es
                el texto crudo, para copiar los valores al cargar cada regla.
              </p>
              <div className="max-h-64 overflow-auto border-t border-slate-100">
                <table className="w-full text-xs">
                  <tbody>
                    {matriz?.referencia.map((fila, indice) => (
                      // La hoja no tiene claves: el índice es la única identidad estable que hay.
                      <tr key={indice} className="border-b border-slate-100 last:border-b-0">
                        {fila.map((celda, columna) => (
                          <td key={columna} className="px-2.5 py-1 align-top text-slate-600">
                            {celda}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {edicion && (
        <DialogoRegla
          edicion={edicion}
          anioActual={anioActual}
          sugerencias={sugerencias}
          alCerrar={() => setEdicion(null)}
          alGuardar={guardar}
        />
      )}

      <Dialogo
        abierto={borrando !== null}
        titulo="Borrar la regla"
        descripcion={
          borrando
            ? `${borrando.compania ?? 'Sin compañía'} · ${borrando.cobertura ?? 'Sin cobertura'}`
            : undefined
        }
        alCerrar={() => setBorrando(null)}
        ancho="sm"
        pie={
          <>
            <Boton onClick={() => setBorrando(null)}>Cancelar</Boton>
            <Boton variante="peligro" icono="basura" onClick={() => void confirmarBorrado()}>
              Borrar
            </Boton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Sin esta regla, al cargar una póliza de esa compañía y esa cobertura la app no va a advertir nada por la antigüedad del vehículo.
          Las pólizas ya cargadas no se tocan.
        </p>
      </Dialogo>
    </div>
  )
}

// ---------------------------------------------------------------------------
// El formulario de una regla
// ---------------------------------------------------------------------------

interface PropsDialogoRegla {
  edicion: Edicion
  anioActual: number
  sugerencias: { companias: string[]; coberturas: string[] }
  alCerrar: () => void
  /** Devuelve el mensaje de error del proceso principal, o null si guardó bien. */
  alGuardar: (datos: DatosDeRegla) => Promise<string | null>
}

function DialogoRegla({ edicion, anioActual, sugerencias, alCerrar, alGuardar }: PropsDialogoRegla) {
  // El componente se monta y se desmonta con cada apertura, así que el estado arranca del dato que
  // llega y no hace falta sincronizarlo después.
  const [datos, setDatos] = useState<DatosDeRegla>(edicion.datos)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (campo: keyof DatosDeRegla, valor: string) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const antiguedad = aNumero(datos.antiguedadMaxima)
  const anioMinimo = aNumero(datos.anioMinimo)
  const losDos = datos.antiguedadMaxima.trim() !== '' && datos.anioMinimo.trim() !== ''
  const antiguedadMalEscrita = Number.isNaN(antiguedad)
  const anioMalEscrito = Number.isNaN(anioMinimo)

  // La vista previa es lo que después va a leer el que atiende, así que se muestra mientras se escribe.
  const previa =
    !losDos && !antiguedadMalEscrita && !anioMalEscrito
      ? limiteEnPalabras(
          typeof antiguedad === 'number' ? antiguedad : null,
          typeof anioMinimo === 'number' ? anioMinimo : null,
          anioActual,
        )
      : ''

  const guardar = async () => {
    if (!datos.compania.trim() || !datos.cobertura.trim()) {
      setError('Poné la compañía y la cobertura: son las dos cosas con las que se busca la regla.')
      return
    }
    if (losDos) {
      setError('Cargá el límite de una sola manera: o los años de antigüedad, o el año mínimo. Dejá el otro vacío.')
      return
    }
    if (antiguedadMalEscrita || anioMalEscrito) {
      setError('La antigüedad y el año se escriben sólo con números («20», «2006»).')
      return
    }
    setGuardando(true)
    setError(null)
    const mensaje = await alGuardar(datos)
    setGuardando(false)
    if (mensaje) setError(mensaje)
  }

  return (
    <Dialogo
      abierto
      titulo={edicion.id === null ? 'Nueva regla de cobertura' : 'Editar la regla'}
      descripcion="Qué antigüedad de vehículo acepta esta compañía para esta cobertura. Se usa para avisar al cargar una póliza."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar regla
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Compañía"
            value={datos.compania}
            onChange={(evento) => cambiar('compania', evento.target.value)}
            list="reglas-companias"
            autoFocus
            ayuda="Escribila igual que en la planilla."
          />
          <Campo
            etiqueta="Cobertura"
            value={datos.cobertura}
            onChange={(evento) => cambiar('cobertura', evento.target.value)}
            list="reglas-coberturas"
            ayuda="Por ejemplo: TERCEROS COMPLETO."
          />
        </div>
        <datalist id="reglas-companias">
          {sugerencias.companias.map((nombre) => (
            <option key={nombre} value={nombre} />
          ))}
        </datalist>
        <datalist id="reglas-coberturas">
          {sugerencias.coberturas.map((nombre) => (
            <option key={nombre} value={nombre} />
          ))}
        </datalist>

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Límite de antigüedad</legend>
          <p className="text-xs leading-relaxed text-slate-600">
            Se carga <strong className="font-semibold">de una sola manera</strong>: o los años de antigüedad que acepta la compañía, o el año
            de fabricación más viejo que toma. Los dos vacíos significan que esta cobertura no tiene límite.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Campo
              etiqueta="Antigüedad máxima (años)"
              value={datos.antiguedadMaxima}
              onChange={(evento) => cambiar('antiguedadMaxima', evento.target.value)}
              inputMode="numeric"
              placeholder="20"
              // Se bloquea el que está vacío, no el que tiene algo: si una regla vieja llegara con los dos
              // cargados, bloquear ambos dejaría al superadministrador sin manera de arreglarla.
              disabled={datos.anioMinimo.trim() !== '' && datos.antiguedadMaxima.trim() === ''}
              error={antiguedadMalEscrita ? 'Sólo números.' : losDos ? 'Dejá uno de los dos vacío.' : null}
              ayuda={`Se recalcula todos los años: hoy, ${anioActual}.`}
            />
            <Campo
              etiqueta="Año mínimo"
              value={datos.anioMinimo}
              onChange={(evento) => cambiar('anioMinimo', evento.target.value)}
              inputMode="numeric"
              placeholder="2006"
              disabled={datos.antiguedadMaxima.trim() !== '' && datos.anioMinimo.trim() === ''}
              error={anioMalEscrito ? 'Sólo números.' : losDos ? 'Dejá uno de los dos vacío.' : null}
              ayuda="Queda fijo aunque pase el tiempo."
            />
          </div>
          <p className="mt-2.5 text-xs text-slate-600">
            En la matriz se va a leer:{' '}
            {previa ? (
              <strong className="font-semibold text-slate-800">{previa}</strong>
            ) : (
              <span className="text-slate-500">sin límite cargado</span>
            )}
          </p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Incluye" value={datos.incluye} onChange={(evento) => cambiar('incluye', evento.target.value)} />
          <Campo etiqueta="Franquicia" value={datos.franquicia} onChange={(evento) => cambiar('franquicia', evento.target.value)} />
        </div>
        <Campo etiqueta="Detalle" value={datos.detalle} onChange={(evento) => cambiar('detalle', evento.target.value)} />
        <AreaTexto
          etiqueta="Observaciones"
          rows={2}
          value={datos.observaciones}
          onChange={(evento) => cambiar('observaciones', evento.target.value)}
        />
      </div>
    </Dialogo>
  )
}
