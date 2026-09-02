// Compañías → Grúas: cuántos kilómetros de remolque da cada compañía en cada cobertura.
//
// Es la pregunta que llega el día del problema («me quedé en la ruta, ¿hasta dónde me llevan?») y la
// que se usa para vender («ésta te da 200 km, la otra 50»). Por eso la tabla es una matriz —compañías
// en las filas, coberturas en las columnas— y no un listado: lo que se compara es una fila contra
// otra, no una fila contra sí misma.
//
// Vacío y cero no son lo mismo, y la pantalla lo dice con todas las letras: una celda sin cargar es
// «sin cargar» (nadie preguntó todavía), y una grúa sin tope es «ilimitada». Confundirlos es
// prometer un remolque que no existe.
import { useMemo, useState } from 'react'
import type { DatosDeGrua, GruaDeCompania, ListasDeCompanias } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import { Buscador, comparar, Contador, DialogoDeBorrado, ENCABEZADO, normalizar, SoloConsulta, Sugerencias } from './comunes'

const VACIO: DatosDeGrua = { compania: '', cobertura: '', kilometros: '', auxilio: '', observaciones: '' }

interface Edicion {
  id: number | null
  datos: DatosDeGrua
}

interface Props {
  listas: ListasDeCompanias
  alCambiar: (listas: ListasDeCompanias) => void
}

export function Gruas({ listas, alCambiar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<GruaDeCompania | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const puedeEditar = listas.puedeEditar
  const gruas = listas.gruas

  /** Las columnas de la matriz: las coberturas que tienen al menos una grúa cargada. */
  const coberturas = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const grua of gruas) {
      const clave = normalizar(grua.cobertura)
      if (!vistas.has(clave)) vistas.set(clave, grua.cobertura)
    }
    return [...vistas.values()].sort(comparar)
  }, [gruas])

  /** Las filas: una por compañía, con sus celdas indexadas por cobertura normalizada. */
  const filas = useMemo(() => {
    const texto = normalizar(busqueda)
    const porCompania = new Map<string, { compania: string; celdas: Map<string, GruaDeCompania> }>()
    for (const grua of gruas) {
      const clave = normalizar(grua.compania)
      let fila = porCompania.get(clave)
      if (!fila) {
        fila = { compania: grua.compania, celdas: new Map() }
        porCompania.set(clave, fila)
      }
      fila.celdas.set(normalizar(grua.cobertura), grua)
    }
    return [...porCompania.values()]
      .filter((fila) => !texto || normalizar(fila.compania).includes(texto))
      .sort((a, b) => comparar(a.compania, b.compania))
  }, [gruas, busqueda])

  const responder = (resultado: { ok: true; datos: ListasDeCompanias } | { ok: false; error: string }, mensaje: string) => {
    if (resultado.ok) {
      alCambiar(resultado.datos)
      setError(null)
      setAviso(mensaje)
      return null
    }
    return resultado.error
  }

  const guardar = async (datos: DatosDeGrua) => {
    if (!edicion) return 'Se cerró el formulario antes de guardar.'
    const problema = responder(
      await window.dm.referencias.guardarGrua(edicion.id, datos),
      `Se guardó la grúa de ${datos.compania} · ${datos.cobertura}.`,
    )
    if (!problema) setEdicion(null)
    return problema
  }

  const confirmarBorrado = async () => {
    if (!borrando) return
    const problema = responder(
      await window.dm.referencias.borrarGrua(borrando.id),
      `Se borró la grúa de ${borrando.compania} · ${borrando.cobertura}.`,
    )
    if (problema) setError(problema)
    setBorrando(null)
  }

  const abrirCelda = (compania: string, cobertura: string, grua: GruaDeCompania | undefined) =>
    setEdicion({
      id: grua?.id ?? null,
      datos: grua
        ? {
            compania: grua.compania,
            cobertura: grua.cobertura,
            kilometros: grua.kilometros === null ? '' : String(grua.kilometros),
            auxilio: grua.auxilio ?? '',
            observaciones: grua.observaciones ?? '',
          }
        : { ...VACIO, compania, cobertura },
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar por compañía" />
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <Contador rotulo="Grúas cargadas" valor={gruas.length} />
        {puedeEditar && (
          <div className="ml-auto">
            <Boton variante="primario" icono="mas" onClick={() => setEdicion({ id: null, datos: VACIO })}>
              Nueva grúa
            </Boton>
          </div>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!puedeEditar && <SoloConsulta que="La lista de grúas" pedirle="una compañía" />}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        {gruas.length === 0 ? (
          <div className="px-3 py-14 text-center">
            <div className="mx-auto max-w-lg">
              <p className="font-semibold text-slate-700">Todavía no hay grúas cargadas.</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                Es cuántos kilómetros de remolque cubre cada compañía según la cobertura contratada.{' '}
                {puedeEditar ? 'Cargá una fila por compañía y cobertura con «Nueva grúa».' : 'Las carga el superadministrador.'}
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={`${ENCABEZADO} sticky left-0 bg-slate-50`}>Compañía</th>
                {coberturas.map((cobertura) => (
                  <th key={cobertura} className={`${ENCABEZADO} text-center`}>
                    {cobertura}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={coberturas.length + 1} className="px-3 py-10 text-center text-slate-500">
                    Ninguna compañía coincide con «{busqueda}».
                  </td>
                </tr>
              )}
              {filas.map((fila) => (
                <tr key={fila.compania} className="border-b border-slate-100 last:border-b-0">
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-slate-900">{fila.compania}</td>
                  {coberturas.map((cobertura) => {
                    const grua = fila.celdas.get(normalizar(cobertura))
                    return (
                      <td key={cobertura} className="px-3 py-2 text-center align-top">
                        <Celda
                          grua={grua}
                          puedeEditar={puedeEditar}
                          alAbrir={() => abrirCelda(fila.compania, cobertura, grua)}
                          alBorrar={grua ? () => setBorrando(grua) : undefined}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edicion && (
        <DialogoGrua
          edicion={edicion}
          companias={listas.companias}
          coberturas={listas.coberturas}
          alCerrar={() => setEdicion(null)}
          alGuardar={guardar}
        />
      )}

      <DialogoDeBorrado
        abierto={borrando !== null}
        titulo="Borrar la grúa"
        descripcion={borrando ? `${borrando.compania} · ${borrando.cobertura}` : undefined}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => void confirmarBorrado()}
      >
        La celda vuelve a quedar «sin cargar», que no es lo mismo que decir que esa cobertura no tiene grúa. Si la compañía dejó de dar
        remolque en esa cobertura, es mejor dejar la fila con los kilómetros en 0 aclarado en las observaciones.
      </DialogoDeBorrado>
    </div>
  )
}

function Celda({
  grua,
  puedeEditar,
  alAbrir,
  alBorrar,
}: {
  grua: GruaDeCompania | undefined
  puedeEditar: boolean
  alAbrir: () => void
  alBorrar?: () => void
}) {
  if (!grua) {
    if (!puedeEditar) return <span className="text-xs text-slate-300">sin cargar</span>
    return (
      <Boton tamano="sm" variante="fantasma" icono="mas" onClick={alAbrir}>
        Cargar
      </Boton>
    )
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      {grua.kilometros === null ? (
        <Etiqueta tono="marca">ilimitada</Etiqueta>
      ) : (
        <span className="font-display text-lg font-extrabold tabular-nums text-slate-900">
          {grua.kilometros.toLocaleString('es-AR')} <span className="text-xs font-semibold text-slate-500">km</span>
        </span>
      )}
      {grua.auxilio && <span className="text-xs leading-tight text-slate-500">{grua.auxilio}</span>}
      {grua.observaciones && <span className="text-xs leading-tight text-slate-400">{grua.observaciones}</span>}
      {puedeEditar && (
        <div className="flex items-center gap-0.5">
          <Boton tamano="sm" variante="fantasma" icono="lapiz" aria-label="Editar la grúa" onClick={alAbrir} />
          {alBorrar && <Boton tamano="sm" variante="fantasma" icono="basura" aria-label="Borrar la grúa" onClick={alBorrar} />}
        </div>
      )}
    </div>
  )
}

interface PropsDialogo {
  edicion: Edicion
  companias: string[]
  coberturas: string[]
  alCerrar: () => void
  alGuardar: (datos: DatosDeGrua) => Promise<string | null>
}

function DialogoGrua({ edicion, companias, coberturas, alCerrar, alGuardar }: PropsDialogo) {
  const [datos, setDatos] = useState<DatosDeGrua>(edicion.datos)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (campo: keyof DatosDeGrua, valor: string) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async () => {
    if (!datos.compania.trim() || !datos.cobertura.trim()) {
      setError('Poné la compañía y la cobertura: son las dos cosas con las que se busca la grúa.')
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
      titulo={edicion.id === null ? 'Nueva grúa' : 'Editar la grúa'}
      descripcion="Cuántos kilómetros de remolque da esta compañía con esta cobertura contratada."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar grúa
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
            list="gruas-companias"
            autoFocus
          />
          <Campo
            etiqueta="Cobertura"
            value={datos.cobertura}
            onChange={(evento) => cambiar('cobertura', evento.target.value)}
            list="gruas-coberturas"
          />
        </div>
        <Sugerencias id="gruas-companias" valores={companias} />
        <Sugerencias id="gruas-coberturas" valores={coberturas} />

        <Campo
          etiqueta="Kilómetros"
          value={datos.kilometros}
          onChange={(evento) => cambiar('kilometros', evento.target.value)}
          inputMode="numeric"
          placeholder="200"
          ayuda="Dejalo vacío si la grúa es ilimitada: en la tabla se lee «ilimitada», no «sin cargar»."
        />

        <Campo
          etiqueta="Qué más entra"
          value={datos.auxilio}
          onChange={(evento) => cambiar('auxilio', evento.target.value)}
          placeholder="Cambio de rueda, batería, cerrajería"
          ayuda="El auxilio que va además del remolque."
        />

        <Campo
          etiqueta="Observaciones"
          value={datos.observaciones}
          onChange={(evento) => cambiar('observaciones', evento.target.value)}
          ayuda="Lo que hay que aclarar: cuántos servicios por año, si es sólo en zona."
        />
      </div>
    </Dialogo>
  )
}
