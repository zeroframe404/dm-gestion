// Compañías → Cobertura: qué ampara cada cobertura, ítem por ítem (Robo, Ruedas…), con casillas para tildar.
//
// Es la lista que contesta la pregunta más común del mostrador: «¿esto lo cubre?». Y por eso incluye
// lo que NO cubre, que es la mitad de la respuesta útil: decir «terceros completo no cubre el granizo»
// evita un siniestro rechazado seis meses después.
//
// Una cláusula sin compañía vale para TODAS. Se hizo así porque las coberturas se arman casi igual en
// todo el mercado: repetir la misma lista de quince cláusulas por cada una de las catorce compañías
// la volvería imposible de mantener al día, que es la manera más segura de que quede mintiendo.
// Cargar la compañía queda para la excepción, y esas cláusulas se muestran marcadas.
import { useEffect, useMemo, useState } from 'react'
import { textoDeOpciones, type ClausulaDeCobertura, type DatosDeClausula, type ListasDeCompanias, type OpcionDeClausula } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import { AccionesDeFila, Buscador, comparar, Contador, DialogoDeBorrado, normalizar, SoloConsulta, Sugerencias } from './comunes'

const VACIO: DatosDeClausula = { compania: '', cobertura: '', clausula: '', ampara: true, detalle: '', opciones: [] }

/** Las casillas de siempre; cualquier otra se agrega a mano en el diálogo. */
const OPCIONES_SUGERIDAS = ['Parcial', 'Total', 'Porcentaje', 'Franquicia', 'Eventos', 'Desgaste', 'Depreciación', 'Robo', 'Hurto']

interface Edicion {
  id: number | null
  datos: DatosDeClausula
}

interface Props {
  listas: ListasDeCompanias
  alCambiar: (listas: ListasDeCompanias) => void
}

export function Clausulas({ listas, alCambiar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [cobertura, setCobertura] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<ClausulaDeCobertura | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const puedeEditar = listas.puedeEditarClausulas
  const clausulas = listas.clausulas

  const coberturas = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const clausula of clausulas) {
      const clave = normalizar(clausula.cobertura)
      if (!vistas.has(clave)) vistas.set(clave, clausula.cobertura)
    }
    return [...vistas.values()].sort(comparar)
  }, [clausulas])

  // La cobertura elegida se acomoda sola al abrir y cuando la que estaba se queda sin cláusulas.
  useEffect(() => {
    if (cobertura !== null && coberturas.some((nombre) => normalizar(nombre) === normalizar(cobertura))) return
    setCobertura(coberturas[0] ?? null)
  }, [coberturas, cobertura])

  const filtradas = useMemo(() => {
    const texto = normalizar(busqueda)
    return clausulas.filter((clausula) => {
      // Con algo escrito se busca en TODAS las coberturas: «granizo» tiene que encontrarse esté donde
      // esté, que es exactamente para lo que se busca acá.
      if (!texto) return cobertura === null || normalizar(clausula.cobertura) === normalizar(cobertura)
      return (
        normalizar(clausula.clausula).includes(texto) ||
        normalizar(clausula.detalle).includes(texto) ||
        normalizar(clausula.cobertura).includes(texto)
      )
    })
  }, [clausulas, cobertura, busqueda])

  // «CLÁSICA – ATM»: un bloque por cobertura y compañía, con sus ítems desplegables adentro.
  const bloques = useMemo(() => {
    const mapa = new Map<string, { cobertura: string; compania: string | null; clausulas: ClausulaDeCobertura[] }>()
    for (const clausula of filtradas) {
      const clave = `${normalizar(clausula.cobertura)}|${normalizar(clausula.compania ?? '')}`
      const bloque = mapa.get(clave) ?? { cobertura: clausula.cobertura, compania: clausula.compania, clausulas: [] }
      bloque.clausulas.push(clausula)
      mapa.set(clave, bloque)
    }
    return [...mapa.values()].sort((a, b) => comparar(a.cobertura, b.cobertura) || comparar(a.compania ?? '', b.compania ?? ''))
  }, [filtradas])

  const responder = (resultado: { ok: true; datos: ListasDeCompanias } | { ok: false; error: string }, mensaje: string) => {
    if (resultado.ok) {
      alCambiar(resultado.datos)
      setError(null)
      setAviso(mensaje)
      return null
    }
    return resultado.error
  }

  const guardar = async (datos: DatosDeClausula) => {
    if (!edicion) return 'Se cerró el formulario antes de guardar.'
    const problema = responder(await window.dm.referencias.guardarClausula(edicion.id, datos), `Se guardó «${datos.clausula}».`)
    if (!problema) {
      setEdicion(null)
      setCobertura(datos.cobertura)
    }
    return problema
  }

  const confirmarBorrado = async () => {
    if (!borrando) return
    const problema = responder(await window.dm.referencias.borrarClausula(borrando.id), `Se borró «${borrando.clausula}».`)
    if (problema) setError(problema)
    setBorrando(null)
  }

  const editar = (clausula: ClausulaDeCobertura) =>
    setEdicion({
      id: clausula.id,
      datos: {
        compania: clausula.compania ?? '',
        cobertura: clausula.cobertura,
        clausula: clausula.clausula,
        ampara: clausula.ampara,
        detalle: clausula.detalle ?? '',
        opciones: clausula.opciones,
      },
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar un ítem en todas las coberturas" />
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <Contador rotulo="Ítems" valor={clausulas.length} />
        {puedeEditar && (
          <div className="ml-auto">
            <Boton
              variante="primario"
              icono="mas"
              onClick={() => setEdicion({ id: null, datos: { ...VACIO, cobertura: cobertura ?? '' } })}
            >
              Nuevo ítem
            </Boton>
          </div>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!puedeEditar && <SoloConsulta que="Lo que ampara cada cobertura" pedirle="un ítem" quien="un administrador" />}

      {coberturas.length > 1 && !busqueda && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Cobertura</span>
          {coberturas.map((nombre) => {
            const activa = cobertura !== null && normalizar(nombre) === normalizar(cobertura)
            return (
              <button
                key={nombre}
                type="button"
                onClick={() => setCobertura(nombre)}
                aria-pressed={activa}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  activa
                    ? 'border-marino-300 bg-marino-50 text-marino-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {nombre}
              </button>
            )
          })}
        </div>
      )}

      {clausulas.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8">
          <div className="max-w-lg text-center">
            <p className="font-semibold text-slate-700">Todavía no hay ítems cargados.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              Acá va lo que ampara cada cobertura y lo que deja afuera: es lo que se contesta cuando preguntan «¿esto lo cubre?».{' '}
              {puedeEditar
                ? 'Se carga de a uno: elegí la cobertura y la compañía, escribí el ítem (Robo, Ruedas…) y tildá lo que corresponde.'
                : 'Las carga un administrador.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {filtradas.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-10 text-center text-slate-500">
              Ningún ítem coincide con «{busqueda}».
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {bloques.map((bloque) => (
                <Bloque
                  key={`${bloque.cobertura}|${bloque.compania ?? ''}`}
                  bloque={bloque}
                  puedeEditar={puedeEditar}
                  mostrarCobertura={busqueda !== ''}
                  alEditar={editar}
                  alBorrar={setBorrando}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {edicion && (
        <DialogoClausula
          edicion={edicion}
          companias={listas.companias}
          coberturas={listas.coberturas}
          alCerrar={() => setEdicion(null)}
          alGuardar={guardar}
        />
      )}

      <DialogoDeBorrado
        abierto={borrando !== null}
        titulo="Borrar el ítem"
        descripcion={borrando ? `${borrando.cobertura} · ${borrando.clausula}` : undefined}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => void confirmarBorrado()}
      >
        Deja de estar en la lista de esa cobertura. Si la compañía dejó de cubrir eso, conviene editarlo y destildar las casillas en vez de borrarlo.
      </DialogoDeBorrado>
    </div>
  )
}

function Bloque({
  bloque,
  puedeEditar,
  mostrarCobertura,
  alEditar,
  alBorrar,
}: {
  bloque: { cobertura: string; compania: string | null; clausulas: ClausulaDeCobertura[] }
  puedeEditar: boolean
  mostrarCobertura: boolean
  alEditar: (clausula: ClausulaDeCobertura) => void
  alBorrar: (clausula: ClausulaDeCobertura) => void
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-slate-900">
          {bloque.cobertura} – {bloque.compania ?? 'Todas las compañías'}
        </h3>
        <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">{bloque.clausulas.length}</span>
      </header>
      <ul className="flex flex-col">
        {bloque.clausulas.map((clausula) => (
          <li key={clausula.id} className="border-b border-slate-50 last:border-b-0">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 hover:bg-slate-50">
                <span className="text-slate-400 transition-transform group-open:rotate-90">▸</span>
                <span className="text-sm font-semibold text-slate-900">{clausula.clausula}</span>
                {mostrarCobertura && <Etiqueta tono="marca">{clausula.cobertura}</Etiqueta>}
                {!clausula.ampara && <Etiqueta tono="peligro">No ampara</Etiqueta>}
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{textoDeOpciones(clausula.opciones)}</span>
                {puedeEditar && (
                  <span onClick={(evento) => evento.stopPropagation()}>
                    <AccionesDeFila alEditar={() => alEditar(clausula)} alBorrar={() => alBorrar(clausula)} />
                  </span>
                )}
              </summary>
              <div className="px-11 pb-3">
                {clausula.opciones.length === 0 ? (
                  <p className="text-xs text-slate-400">Sin casillas tildadas.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {clausula.opciones.map((opcion) => (
                      <label key={opcion.nombre} className="flex items-center gap-1.5 text-sm text-slate-700">
                        <input type="checkbox" checked readOnly disabled className="h-4 w-4" />
                        {opcion.nombre}
                        {opcion.valor && <strong className="text-slate-900">{opcion.valor}</strong>}
                      </label>
                    ))}
                  </div>
                )}
                {clausula.detalle && <p className="mt-2 text-xs leading-relaxed text-slate-500">{clausula.detalle}</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface PropsDialogo {
  edicion: Edicion
  companias: string[]
  coberturas: string[]
  alCerrar: () => void
  alGuardar: (datos: DatosDeClausula) => Promise<string | null>
}

function DialogoClausula({ edicion, companias, coberturas, alCerrar, alGuardar }: PropsDialogo) {
  const [datos, setDatos] = useState<DatosDeClausula>(edicion.datos)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [otra, setOtra] = useState('')

  const cambiar = (campo: 'compania' | 'cobertura' | 'clausula' | 'detalle', valor: string) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const opciones = datos.opciones ?? []
  const alternar = (nombre: string) =>
    setDatos((previo) => ({
      ...previo,
      opciones: (previo.opciones ?? []).some((o) => o.nombre === nombre)
        ? (previo.opciones ?? []).filter((o) => o.nombre !== nombre)
        : [...(previo.opciones ?? []), { nombre, valor: '' }],
    }))
  const poner = (nombre: string, valor: string) =>
    setDatos((previo) => ({ ...previo, opciones: (previo.opciones ?? []).map((o): OpcionDeClausula => (o.nombre === nombre ? { ...o, valor } : o)) }))
  const agregarOtra = () => {
    const nombre = otra.trim()
    if (nombre && !opciones.some((o) => o.nombre.toLowerCase() === nombre.toLowerCase())) alternar(nombre)
    setOtra('')
  }
  const todas = [...OPCIONES_SUGERIDAS, ...opciones.map((o) => o.nombre).filter((n) => !OPCIONES_SUGERIDAS.includes(n))]

  const guardar = async () => {
    if (!datos.cobertura.trim() || !datos.clausula.trim()) {
      setError('Poné la cobertura y el ítem.')
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
      titulo={edicion.id === null ? 'Nuevo ítem' : 'Editar el ítem'}
      descripcion="Un ítem de la cobertura, con las casillas que corresponden."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar ítem
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Cobertura"
            value={datos.cobertura}
            onChange={(evento) => cambiar('cobertura', evento.target.value)}
            list="clausulas-coberturas"
            autoFocus
            ayuda="Por ejemplo: TERCEROS COMPLETO."
          />
          <Campo
            etiqueta="Compañía (opcional)"
            value={datos.compania}
            onChange={(evento) => cambiar('compania', evento.target.value)}
            list="clausulas-companias"
            ayuda="Vacío = vale para todas. Cargala sólo si esta compañía es la excepción."
          />
        </div>
        <Sugerencias id="clausulas-coberturas" valores={coberturas} />
        <Sugerencias id="clausulas-companias" valores={companias} />

        <Campo
          etiqueta="Ítem"
          value={datos.clausula}
          onChange={(evento) => cambiar('clausula', evento.target.value)}
          placeholder="Robo"
          ayuda="Por ejemplo: Robo, Ruedas, Granizo."
        />

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Tildá lo que corresponde</legend>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2">
            {todas.map((nombre) => {
              const tildada = opciones.find((o) => o.nombre === nombre)
              return (
                <div key={nombre} className="flex items-center gap-2">
                  <label className="flex min-w-[7rem] items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={!!tildada} onChange={() => alternar(nombre)} className="h-4 w-4 border-slate-300" />
                    {nombre}
                  </label>
                  {tildada && (
                    <input
                      value={tildada.valor}
                      onChange={(evento) => poner(nombre, evento.target.value)}
                      placeholder="3%, 1 por año…"
                      aria-label={`Valor de ${nombre}`}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={otra}
              onChange={(evento) => setOtra(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter') {
                  evento.preventDefault()
                  agregarOtra()
                }
              }}
              placeholder="Otra casilla…"
              aria-label="Agregar otra casilla"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <Boton tamano="sm" onClick={agregarOtra}>
              Agregar
            </Boton>
          </div>
        </fieldset>

        <AreaTexto
          etiqueta="Detalle"
          rows={3}
          value={datos.detalle}
          onChange={(evento) => cambiar('detalle', evento.target.value)}
          ayuda="Cualquier otra aclaración (opcional)."
        />
      </div>
    </Dialogo>
  )
}
