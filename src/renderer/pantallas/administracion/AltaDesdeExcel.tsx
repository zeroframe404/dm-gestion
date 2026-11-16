// Administración → Alta desde Excel (sólo superadministrador). Una agencia nueva, con su servidor recién
// instalado y la base vacía, sube SU Excel o CSV y le dice al programa qué es cada hoja y cada columna.
// Cuatro pasos: archivo → hojas → columnas → revisar (ensayo en memoria) y cargar en la base.
//
// La pantalla no lee el archivo: lo lee el proceso principal, que se lo queda y le pasa a la pantalla las
// primeras filas de cada hoja. Lo que viaja de acá para allá es sólo la asignación (qué es cada cosa).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ETIQUETA_DE_HOJA_DE_ALTA,
  TIPOS_DE_HOJA_DE_ALTA,
  type AsignacionDeAlta,
  type AsignacionDeHoja,
  type EnsayoDeAlta,
  type EstadoDeAltaExcel,
  type LibroDeAlta,
  type ProgresoImportacion,
  type ResumenDeAltaExcel,
  type TipoDeHojaDeAlta,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Dialogo, Etiqueta, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { Progreso, ResultadoImportacion } from './ImportarGoogle'

type Paso = 'archivo' | 'hojas' | 'columnas' | 'revisar' | 'listo'

const PASOS: Array<{ id: Paso; nombre: string }> = [
  { id: 'archivo', nombre: 'Archivo' },
  { id: 'hojas', nombre: 'Hojas' },
  { id: 'columnas', nombre: 'Columnas' },
  { id: 'revisar', nombre: 'Revisar y cargar' },
]

const CONTROL =
  'w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25 disabled:bg-slate-100'

/** «A», «B»… «AA»: como las columnas de Excel. */
function letra(indice: number): string {
  let n = indice + 1
  let texto = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    texto = String.fromCharCode(65 + resto) + texto
    n = Math.floor((n - 1) / 26)
  }
  return texto
}

/** Las columnas de la asignación siempre del ancho de la hoja (lo que no se conoce, sin importar). */
function conAncho(columnas: Array<string | null | undefined>, ancho: number): Array<string | null> {
  return Array.from({ length: Math.max(ancho, columnas.length) }, (_, i) => columnas[i] ?? null)
}

export function AltaDesdeExcel() {
  const puedeEditar = usePuedeEditar('administracion')
  const [estado, setEstado] = useState<EstadoDeAltaExcel | null>(null)
  const [paso, setPaso] = useState<Paso>('archivo')
  const [libro, setLibro] = useState<LibroDeAlta | null>(null)
  const [asignacion, setAsignacion] = useState<AsignacionDeAlta | null>(null)
  const [hojaActiva, setHojaActiva] = useState(0)
  const [ensayo, setEnsayo] = useState<EnsayoDeAlta | null>(null)
  const [resumen, setResumen] = useState<ResumenDeAltaExcel | null>(null)
  const [progreso, setProgreso] = useState<ProgresoImportacion | null>(null)
  const [ocupado, setOcupado] = useState<null | 'estado' | 'archivo' | 'ensayo' | 'publicar'>('estado')
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const consultarEstado = useCallback(async () => {
    setOcupado('estado')
    const resultado = await window.dm.altaExcel.estado()
    if (resultado.ok) setEstado(resultado.datos)
    else setError(resultado.error)
    setOcupado(null)
  }, [])

  useEffect(() => {
    void consultarEstado()
    const dejar = window.dm.importacion.alProgresar((p) => setProgreso(p))
    return () => dejar()
  }, [consultarEstado])

  const elegirArchivo = useCallback(async () => {
    setOcupado('archivo')
    setError(null)
    const resultado = await window.dm.altaExcel.elegirArchivo()
    setOcupado(null)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (!resultado.datos) return
    const nuevo = resultado.datos
    setLibro(nuevo)
    setAsignacion({
      ...nuevo.sugerencia,
      hojas: nuevo.sugerencia.hojas.map((h) => ({ ...h, columnas: conAncho(h.columnas, nuevo.hojas[h.indice]?.totalColumnas ?? 0) })),
    })
    setEnsayo(null)
    setResumen(null)
    setPaso('hojas')
  }, [])

  const cambiarHoja = useCallback((indice: number, cambio: Partial<AsignacionDeHoja>) => {
    setAsignacion((previa) =>
      previa ? { ...previa, hojas: previa.hojas.map((h) => (h.indice === indice ? { ...h, ...cambio } : h)) } : previa,
    )
    setEnsayo(null)
  }, [])

  /** Al cambiar el tipo o la fila de encabezados, el programa vuelve a proponer las columnas. */
  const reproponer = useCallback(
    async (indice: number, tipo: TipoDeHojaDeAlta | null, filaEncabezados: number) => {
      if (!libro) return
      cambiarHoja(indice, { tipo, filaEncabezados })
      if (!tipo) return
      const resultado = await window.dm.altaExcel.sugerirColumnas(libro.token, indice, tipo, filaEncabezados)
      if (resultado.ok) cambiarHoja(indice, { columnas: conAncho(resultado.datos, libro.hojas[indice]?.totalColumnas ?? 0) })
      else setError(resultado.error)
    },
    [libro, cambiarHoja],
  )

  const ensayar = useCallback(async (asignacionActual: AsignacionDeAlta) => {
    setOcupado('ensayo')
    setError(null)
    const resultado = await window.dm.altaExcel.ensayar(asignacionActual)
    if (resultado.ok) setEnsayo(resultado.datos)
    else setError(resultado.error)
    setOcupado(null)
  }, [])

  const publicar = useCallback(async () => {
    if (!asignacion) return
    setConfirmando(false)
    setOcupado('publicar')
    setError(null)
    setProgreso(null)
    const resultado = await window.dm.altaExcel.publicar(asignacion)
    setOcupado(null)
    if (resultado.ok) {
      setResumen(resultado.datos)
      setPaso('listo')
      void consultarEstado()
    } else {
      setError(resultado.error)
    }
  }, [asignacion, consultarEstado])

  const empezarDeNuevo = useCallback(() => {
    void window.dm.altaExcel.olvidar()
    setLibro(null)
    setAsignacion(null)
    setEnsayo(null)
    setResumen(null)
    setPaso('archivo')
  }, [])

  const importadas = useMemo(() => asignacion?.hojas.filter((h) => h.tipo) ?? [], [asignacion])

  const irARevisar = useCallback(() => {
    if (!asignacion) return
    setPaso('revisar')
    void ensayar(asignacion)
  }, [asignacion, ensayar])

  if (!estado && ocupado === 'estado') return <Cargando texto="Consultando la base del servidor…" />

  return (
    <div className="flex flex-col gap-5">
      <Encabezado paso={paso} />
      {error && <Alerta tono="error">{error}</Alerta>}

      {paso === 'archivo' && (
        <Tarjeta
          titulo="Alta desde Excel"
          descripcion="Para una agencia que empieza: se sube su propio Excel (o un .csv), se elige qué es cada hoja y cada columna, se ensaya, y se carga en la base vacía del servidor. Se hace una sola vez."
        >
          <div className="flex flex-col gap-4">
            {estado && <EstadoDeLaBase estado={estado} />}
            <ul className="list-disc pl-5 text-sm text-slate-600">
              <li>Sirve un .xlsx de Excel o un .csv. Un Excel viejo (.xls) hay que guardarlo antes como .xlsx.</li>
              <li>Cada hoja puede ser la cartera (clientes, pólizas y vehículos), bajas, siniestros, pagos o riesgos varios. Lo que no quieras traer, se deja afuera.</li>
              <li>Hasta el último paso no se toca nada: el ensayo muestra cómo quedaría sin cargar nada.</li>
            </ul>
            <div>
              <Boton variante="primario" icono="subir" onClick={() => void elegirArchivo()} cargando={ocupado === 'archivo'} disabled={!puedeEditar}>
                Elegir el Excel o CSV
              </Boton>
            </div>
          </div>
        </Tarjeta>
      )}

      {paso === 'hojas' && libro && asignacion && (
        <Tarjeta
          titulo={`Hojas de «${libro.archivo}»`}
          descripcion="Elegí qué tiene cada hoja y en qué fila están sus títulos. Las hojas del mismo tipo se juntan (por ejemplo, una cartera por sucursal)."
          acciones={
            <>
              <Boton icono="cerrar" variante="fantasma" onClick={empezarDeNuevo}>
                Otro archivo
              </Boton>
              <Boton
                variante="primario"
                onClick={() => {
                  setHojaActiva(importadas[0]?.indice ?? 0)
                  setPaso('columnas')
                }}
                disabled={importadas.length === 0}
              >
                Siguiente: columnas
              </Boton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {importadas.length === 0 && <Alerta tono="aviso">Elegí qué tiene al menos una hoja.</Alerta>}
            {libro.hojas.map((hoja) => {
              const a = asignacion.hojas.find((h) => h.indice === hoja.indice)
              if (!a) return null
              return (
                <div key={hoja.indice} className={cx('rounded-xl border p-4', a.tipo ? 'border-marino-200 bg-marino-50/40' : 'border-slate-200')}>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-semibold text-slate-900">
                        <Icono nombre="tabla" tamano={16} /> {hoja.nombre}
                        {hoja.oculta && <Etiqueta>oculta</Etiqueta>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {hoja.totalFilas.toLocaleString('es-AR')} filas · {hoja.totalColumnas} columnas
                      </p>
                    </div>
                    <label className="flex w-64 flex-col gap-1 text-xs font-medium text-slate-600">
                      Qué tiene
                      <select
                        className={cx(CONTROL, 'h-9')}
                        value={a.tipo ?? ''}
                        onChange={(e) => void reproponer(hoja.indice, (e.target.value || null) as TipoDeHojaDeAlta | null, a.filaEncabezados)}
                      >
                        <option value="">No importar</option>
                        {TIPOS_DE_HOJA_DE_ALTA.map((tipo) => (
                          <option key={tipo} value={tipo}>
                            {ETIQUETA_DE_HOJA_DE_ALTA[tipo]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex w-40 flex-col gap-1 text-xs font-medium text-slate-600">
                      Títulos en la fila
                      <select
                        className={cx(CONTROL, 'h-9')}
                        value={a.filaEncabezados}
                        disabled={!a.tipo}
                        onChange={(e) => void reproponer(hoja.indice, a.tipo, Number(e.target.value))}
                      >
                        {Array.from({ length: Math.max(1, Math.min(10, hoja.muestra.length)) }, (_, i) => (
                          <option key={i} value={i}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {a.tipo && <MuestraDeHoja filas={hoja.muestra} filaEncabezados={a.filaEncabezados} />}
                </div>
              )
            })}
          </div>
        </Tarjeta>
      )}

      {paso === 'columnas' && libro && asignacion && (
        <Tarjeta
          titulo="Qué es cada columna"
          descripcion="Lo que el programa reconoció solo ya está elegido. Revisá el resto: una columna sin campo no se trae. Dos columnas en el mismo campo se juntan (por ejemplo APELLIDO y NOMBRE)."
          acciones={
            <>
              <Boton variante="fantasma" onClick={() => setPaso('hojas')}>
                Volver
              </Boton>
              <Boton variante="primario" onClick={irARevisar}>
                Siguiente: revisar
              </Boton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {importadas.map((h) => (
                <button
                  key={h.indice}
                  type="button"
                  onClick={() => setHojaActiva(h.indice)}
                  className={cx(
                    'rounded-lg border px-3 py-1.5 text-sm font-semibold',
                    h.indice === hojaActiva ? 'border-marino-600 bg-marino-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {libro.hojas[h.indice]?.nombre} · {h.tipo ? ETIQUETA_DE_HOJA_DE_ALTA[h.tipo].split(' (')[0] : ''}
                </button>
              ))}
            </div>
            {(() => {
              const a = asignacion.hojas.find((h) => h.indice === hojaActiva && h.tipo)
              const hoja = libro.hojas[hojaActiva]
              if (!a || !a.tipo || !hoja) return null
              return <ColumnasDeHoja libro={libro} hoja={hoja} asignacion={a} alCambiar={(cambio) => cambiarHoja(a.indice, cambio)} />
            })()}
          </div>
        </Tarjeta>
      )}

      {paso === 'revisar' && libro && asignacion && (
        <Revisar
          ensayo={ensayo}
          estado={estado}
          asignacion={asignacion}
          ensayando={ocupado === 'ensayo'}
          publicando={ocupado === 'publicar'}
          progreso={progreso}
          puedeEditar={puedeEditar}
          alVolver={() => setPaso('columnas')}
          alCorregirSucursales={(sucursales) => {
            const nueva = { ...asignacion, sucursales }
            setAsignacion(nueva)
            void ensayar(nueva)
          }}
          alEnsayar={() => void ensayar(asignacion)}
          alPublicar={() => setConfirmando(true)}
        />
      )}

      {paso === 'listo' && resumen && (
        <>
          <Alerta tono="exito">
            Listo: se cargaron {resumen.pestanas} pestañas con {resumen.filas.toLocaleString('es-AR')} filas en la base de la agencia. Las demás
            computadoras las bajan solas al conectarse.
          </Alerta>
          <ResultadoImportacion informe={resumen.informe} titulo="Lo que se cargó" />
          <div>
            <Boton onClick={empezarDeNuevo}>Volver al inicio</Boton>
          </div>
        </>
      )}

      <Dialogo
        abierto={confirmando}
        titulo="¿Cargar el Excel en la base?"
        alCerrar={() => setConfirmando(false)}
        descripcion="Se hace una sola vez y alcanza a todas las computadoras de la agencia."
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setConfirmando(false)}>
              Cancelar
            </Boton>
            <Boton variante="primario" icono="subir" onClick={() => void publicar()}>
              Sí, cargar
            </Boton>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Las pestañas se cargan en la base vacía del servidor ({estado?.urlBase}) tal como las mostró el ensayo. Después, para cambiar algo, se edita
          desde el programa como siempre: el alta desde Excel no se puede repetir.
        </p>
      </Dialogo>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Encabezado({ paso }: { paso: Paso }) {
  const actual = paso === 'listo' ? PASOS.length : PASOS.findIndex((p) => p.id === paso)
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {PASOS.map((p, i) => (
        <li key={p.id} className="flex items-center gap-2">
          <span
            className={cx(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
              i < actual ? 'bg-green-600 text-white' : i === actual ? 'bg-marino-700 text-white' : 'bg-slate-200 text-slate-600',
            )}
          >
            {i < actual ? <Icono nombre="ok" tamano={12} /> : i + 1}
          </span>
          <span className={cx(i === actual ? 'font-semibold text-slate-900' : 'text-slate-500')}>{p.nombre}</span>
          {i < PASOS.length - 1 && <span className="mx-1 h-px w-6 bg-slate-300" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

function EstadoDeLaBase({ estado }: { estado: EstadoDeAltaExcel }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-600">
        Servidor: <code className="rounded bg-slate-100 px-1 font-mono">{estado.urlBase}</code>
        {estado.base && (
          <>
            {' '}
            · base {estado.base.inicializada ? `con ${estado.base.pestanas} pestañas y ${estado.base.filas.toLocaleString('es-AR')} filas` : 'vacía'}
          </>
        )}
      </p>
      {estado.motivoParaNoPublicar ? (
        <Alerta tono="aviso">{estado.motivoParaNoPublicar}</Alerta>
      ) : (
        <Alerta tono="info">La base está vacía: se puede cargar el Excel.</Alerta>
      )}
    </div>
  )
}

function MuestraDeHoja({ filas, filaEncabezados }: { filas: string[][]; filaEncabezados: number }) {
  const visibles = filas.slice(0, filaEncabezados + 6)
  const ancho = Math.min(14, visibles.reduce((m, f) => Math.max(m, f.length), 0))
  if (ancho === 0) return <p className="mt-3 text-xs text-slate-500">La hoja está vacía.</p>
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <tbody>
          {visibles.map((fila, r) => (
            <tr
              key={r}
              className={cx(
                'border-b border-slate-100 last:border-b-0',
                r === filaEncabezados ? 'bg-marino-100 font-semibold text-marino-900' : r < filaEncabezados ? 'text-slate-400' : 'text-slate-700',
              )}
            >
              <td className="w-8 bg-slate-50 px-2 py-1 text-right tabular-nums text-slate-400">{r + 1}</td>
              {Array.from({ length: ancho }, (_, c) => (
                <td key={c} className="max-w-[12rem] truncate px-2 py-1 whitespace-nowrap">
                  {fila[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface PropsColumnas {
  libro: LibroDeAlta
  hoja: LibroDeAlta['hojas'][number]
  asignacion: AsignacionDeHoja
  alCambiar: (cambio: Partial<AsignacionDeHoja>) => void
}

function ColumnasDeHoja({ libro, hoja, asignacion, alCambiar }: PropsColumnas) {
  const tipo = asignacion.tipo as TipoDeHojaDeAlta
  const campos = libro.campos[tipo]
  const etiquetaDe = (campo: string) => campos.find((c) => c.campo === campo)?.etiqueta ?? campo
  const encabezados = hoja.muestra[asignacion.filaEncabezados] ?? []
  const datos = hoja.muestra.slice(asignacion.filaEncabezados + 1)
  const [campoFijo, setCampoFijo] = useState('')
  const [valorFijo, setValorFijo] = useState('')

  const cubiertos = new Set<string>([...asignacion.columnas.filter((c): c is string => !!c), ...Object.keys(asignacion.fijos)])
  const ejemplos = (columna: number) =>
    datos
      .map((f) => f[columna] ?? '')
      .filter((v) => v.trim() !== '')
      .slice(0, 3)

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        {libro.requisitos[tipo].map((r) => {
          const ok = r.campos.some((c) => cubiertos.has(c))
          return (
            <li key={r.texto} className={cx('flex items-center gap-2', ok ? 'text-green-700' : r.obligatorio ? 'text-red-700' : 'text-amber-700')}>
              <Icono nombre={ok ? 'ok' : 'alerta'} tamano={14} />
              {ok ? 'Tiene' : r.obligatorio ? 'Falta (obligatorio):' : 'Falta:'} {r.texto}
            </li>
          )
        })}
      </ul>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2">Col.</th>
              <th className="px-3 py-2">Título en el Excel</th>
              <th className="px-3 py-2">Ejemplos</th>
              <th className="px-3 py-2">Campo del programa</th>
            </tr>
          </thead>
          <tbody>
            {asignacion.columnas.map((campo, i) => {
              const muestras = ejemplos(i)
              if (!encabezados[i] && muestras.length === 0) return null
              return (
                <tr key={i} className={cx('border-b border-slate-100 last:border-b-0', !campo && 'text-slate-400')}>
                  <td className="px-3 py-1.5 font-mono text-xs">{letra(i)}</td>
                  <td className="px-3 py-1.5 font-medium">{encabezados[i] || <span className="italic">(sin título)</span>}</td>
                  <td className="max-w-[18rem] truncate px-3 py-1.5 text-xs">{muestras.join(' · ')}</td>
                  <td className="w-64 px-3 py-1.5">
                    <select
                      className={cx(CONTROL, 'h-8')}
                      value={campo ?? ''}
                      onChange={(e) => {
                        const columnas = [...asignacion.columnas]
                        columnas[i] = e.target.value || null
                        alCambiar({ columnas })
                      }}
                    >
                      <option value="">— No traer —</option>
                      {campos.map((c) => (
                        <option key={c.campo} value={c.campo}>
                          {c.etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-slate-800">Valores fijos</p>
        <p className="text-xs text-slate-500">
          Para un dato que el Excel no trae o trae incompleto: se usa en todas las filas donde falte (por ejemplo, la sucursal si la agencia tiene una
          sola).
        </p>
        {Object.entries(asignacion.fijos).length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {Object.entries(asignacion.fijos).map(([campo, valor]) => (
              <li key={campo} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm">
                <span className="text-slate-500">{etiquetaDe(campo)}:</span> <strong>{valor}</strong>
                <button
                  type="button"
                  aria-label={`Sacar ${etiquetaDe(campo)}`}
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    const fijos = { ...asignacion.fijos }
                    delete fijos[campo]
                    alCambiar({ fijos })
                  }}
                >
                  <Icono nombre="cerrar" tamano={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select className={cx(CONTROL, 'h-9 w-56')} value={campoFijo} onChange={(e) => setCampoFijo(e.target.value)}>
            <option value="">Elegí un campo…</option>
            {campos.map((c) => (
              <option key={c.campo} value={c.campo}>
                {c.etiqueta}
              </option>
            ))}
          </select>
          <input className={cx(CONTROL, 'h-9 w-56')} value={valorFijo} placeholder="Valor" onChange={(e) => setValorFijo(e.target.value)} />
          <Boton
            tamano="sm"
            icono="mas"
            disabled={!campoFijo || !valorFijo.trim()}
            onClick={() => {
              alCambiar({ fijos: { ...asignacion.fijos, [campoFijo]: valorFijo.trim() } })
              setCampoFijo('')
              setValorFijo('')
            }}
          >
            Agregar
          </Boton>
        </div>
      </div>
    </div>
  )
}

interface PropsRevisar {
  ensayo: EnsayoDeAlta | null
  estado: EstadoDeAltaExcel | null
  asignacion: AsignacionDeAlta
  ensayando: boolean
  publicando: boolean
  progreso: ProgresoImportacion | null
  puedeEditar: boolean
  alVolver: () => void
  alCorregirSucursales: (sucursales: Record<string, string>) => void
  alEnsayar: () => void
  alPublicar: () => void
}

function Revisar(props: PropsRevisar) {
  const { ensayo, estado, asignacion, ensayando, publicando, progreso } = props
  const [sucursales, setSucursales] = useState<Record<string, string>>(asignacion.sucursales)
  useEffect(() => setSucursales(asignacion.sucursales), [asignacion.sucursales])

  if (publicando) {
    return (
      <Tarjeta titulo="Cargando en la base…" descripcion="No cierres el programa hasta que termine.">
        {progreso ? <Progreso progreso={progreso} /> : <Cargando texto="Subiendo las pestañas al servidor…" />}
      </Tarjeta>
    )
  }
  if (ensayando || !ensayo) return <Cargando texto="Ensayando la importación (no se carga nada)…" />

  const bloqueo = ensayo.faltantes.length > 0 ? 'Antes de cargar hay que resolver lo que falta.' : (estado?.motivoParaNoPublicar ?? null)
  const sucursalesCambiadas = JSON.stringify(sucursales) !== JSON.stringify(asignacion.sucursales)

  return (
    <div className="flex flex-col gap-5">
      <Tarjeta
        titulo="Así quedaría la base"
        descripcion="Es un ensayo: se importó en memoria, sin tocar el servidor ni esta computadora. Si algo no está bien, volvé a las columnas."
        acciones={
          <>
            <Boton variante="fantasma" onClick={props.alVolver}>
              Volver
            </Boton>
            <Boton icono="refrescar" onClick={props.alEnsayar}>
              Ensayar de nuevo
            </Boton>
            <Boton variante="primario" icono="subir" onClick={props.alPublicar} disabled={!!bloqueo || !props.puedeEditar} title={bloqueo ?? undefined}>
              Cargar en la base
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {ensayo.faltantes.map((f) => (
            <Alerta key={f} tono="error">
              {f}
            </Alerta>
          ))}
          {bloqueo && ensayo.faltantes.length === 0 && <Alerta tono="aviso">{bloqueo}</Alerta>}
          {ensayo.avisos.length > 0 && (
            <Alerta tono="aviso">
              <ul className="list-disc pl-4">
                {ensayo.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Alerta>
          )}
          {ensayo.pestanas.map((p) => (
            <div key={p.titulo} className="flex flex-col gap-2">
              <p className="text-sm">
                <strong className="font-mono">{p.titulo}</strong> · {ETIQUETA_DE_HOJA_DE_ALTA[p.tipo]} · {p.filas.toLocaleString('es-AR')} filas
              </p>
              <MuestraDeHoja filas={[p.encabezados, ...p.muestra]} filaEncabezados={0} />
            </div>
          ))}
        </div>
      </Tarjeta>

      {ensayo.sucursalesDesconocidas.length > 0 && (
        <Tarjeta
          titulo="Sucursales que no están en la lista"
          descripcion="Elegí con qué sucursal se carga cada una, o dejala como está (queda escrita, pero sin sucursal asignada). Las sucursales se agregan en Administración → Sucursales y ramas."
          acciones={
            <Boton variante="primario" disabled={!sucursalesCambiadas} onClick={() => props.alCorregirSucursales(sucursales)}>
              Aplicar y ensayar
            </Boton>
          }
        >
          <ul className="flex flex-col gap-2">
            {ensayo.sucursalesDesconocidas.map((s) => (
              <li key={s.valor} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-48 truncate font-medium">«{s.valor}»</span>
                <span className="w-20 text-xs text-slate-500">{s.filas} filas</span>
                <select
                  className={cx(CONTROL, 'h-9 w-56')}
                  value={sucursales[s.valor] ?? ''}
                  onChange={(e) => {
                    const nuevas = { ...sucursales }
                    if (e.target.value) nuevas[s.valor] = e.target.value
                    else delete nuevas[s.valor]
                    setSucursales(nuevas)
                  }}
                >
                  <option value="">Dejar como está</option>
                  {ensayo.catalogoDeSucursales.map((nombre) => (
                    <option key={nombre} value={nombre}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <ResultadoImportacion informe={ensayo.informe} titulo="Informe del ensayo" descripcion="Lo mismo que va a salir al cargar de verdad." />
    </div>
  )
}
