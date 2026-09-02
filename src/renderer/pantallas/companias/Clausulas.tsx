// Compañías → Cobertura: qué ampara cada cobertura, cláusula por cláusula.
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
import type { ClausulaDeCobertura, DatosDeClausula, ListasDeCompanias } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import { AccionesDeFila, Buscador, comparar, Contador, DialogoDeBorrado, normalizar, SoloConsulta, Sugerencias } from './comunes'

const VACIO: DatosDeClausula = { compania: '', cobertura: '', clausula: '', ampara: true, detalle: '' }

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

  const puedeEditar = listas.puedeEditar
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

  const ampara = filtradas.filter((clausula) => clausula.ampara)
  const excluye = filtradas.filter((clausula) => !clausula.ampara)

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
      },
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar una cláusula en todas las coberturas" />
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <Contador rotulo="Cláusulas" valor={clausulas.length} />
        {puedeEditar && (
          <div className="ml-auto">
            <Boton
              variante="primario"
              icono="mas"
              onClick={() => setEdicion({ id: null, datos: { ...VACIO, cobertura: cobertura ?? '' } })}
            >
              Nueva cláusula
            </Boton>
          </div>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!puedeEditar && <SoloConsulta que="Lo que ampara cada cobertura" pedirle="una cláusula" />}

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
            <p className="font-semibold text-slate-700">Todavía no hay cláusulas cargadas.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              Acá va lo que ampara cada cobertura y lo que deja afuera: es lo que se contesta cuando preguntan «¿esto lo cubre?».{' '}
              {puedeEditar
                ? 'Se carga de a una: elegí la cobertura, escribí la cláusula y marcá si la ampara o si es una exclusión.'
                : 'Las carga el superadministrador.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {filtradas.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-10 text-center text-slate-500">
              Ninguna cláusula coincide con «{busqueda}».
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <Grupo
                titulo="Ampara"
                tono="exito"
                icono="ok"
                clausulas={ampara}
                puedeEditar={puedeEditar}
                mostrarCobertura={busqueda !== ''}
                alEditar={editar}
                alBorrar={setBorrando}
              />
              <Grupo
                titulo="No ampara"
                tono="peligro"
                icono="cerrar"
                clausulas={excluye}
                puedeEditar={puedeEditar}
                mostrarCobertura={busqueda !== ''}
                alEditar={editar}
                alBorrar={setBorrando}
              />
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
        titulo="Borrar la cláusula"
        descripcion={borrando ? `${borrando.cobertura} · ${borrando.clausula}` : undefined}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => void confirmarBorrado()}
      >
        Deja de estar en la lista de esa cobertura. Si lo que pasó es que la compañía dejó de cubrir eso, conviene editarla y marcarla
        como «No ampara» en vez de borrarla: así queda escrito que la pregunta ya se hizo.
      </DialogoDeBorrado>
    </div>
  )
}

function Grupo({
  titulo,
  tono,
  icono,
  clausulas,
  puedeEditar,
  mostrarCobertura,
  alEditar,
  alBorrar,
}: {
  titulo: string
  tono: 'exito' | 'peligro'
  icono: 'ok' | 'cerrar'
  clausulas: ClausulaDeCobertura[]
  puedeEditar: boolean
  /** Con la búsqueda puesta las cláusulas vienen de varias coberturas: hay que decir de cuál es cada una. */
  mostrarCobertura: boolean
  alEditar: (clausula: ClausulaDeCobertura) => void
  alBorrar: (clausula: ClausulaDeCobertura) => void
}) {
  const colores = tono === 'exito' ? 'border-green-200 text-green-700' : 'border-red-200 text-red-700'
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className={`flex items-center gap-2 border-b px-4 py-2.5 ${colores}`}>
        <Icono nombre={icono} tamano={16} />
        <h3 className="font-display text-base font-extrabold tracking-tight">{titulo}</h3>
        <span className="ml-auto text-xs font-semibold tabular-nums">{clausulas.length}</span>
      </header>
      {clausulas.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          {tono === 'exito' ? 'Nada cargado como amparado todavía.' : 'Ninguna exclusión cargada.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {clausulas.map((clausula) => (
            <li key={clausula.id} className="flex items-start gap-2 border-b border-slate-50 px-4 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{clausula.clausula}</span>
                  {mostrarCobertura && <Etiqueta tono="marca">{clausula.cobertura}</Etiqueta>}
                  {/* Sin compañía la cláusula vale para todas: sólo se marca la excepción. */}
                  {clausula.compania && <Etiqueta tono="aviso">sólo {clausula.compania}</Etiqueta>}
                </div>
                {clausula.detalle && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{clausula.detalle}</p>}
              </div>
              {puedeEditar && <AccionesDeFila alEditar={() => alEditar(clausula)} alBorrar={() => alBorrar(clausula)} />}
            </li>
          ))}
        </ul>
      )}
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

  const cambiar = (campo: keyof DatosDeClausula, valor: string | boolean) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async () => {
    if (!datos.cobertura.trim() || !datos.clausula.trim()) {
      setError('Poné la cobertura y la cláusula.')
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
      titulo={edicion.id === null ? 'Nueva cláusula' : 'Editar la cláusula'}
      descripcion="Qué ampara —o qué deja afuera— esta cobertura."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar cláusula
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
          etiqueta="Cláusula"
          value={datos.clausula}
          onChange={(evento) => cambiar('clausula', evento.target.value)}
          placeholder="Robo total"
          ayuda="Cómo se la nombra en el mostrador, no cómo figura en la póliza."
        />

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Esta cobertura…</legend>
          <div className="mt-1 flex gap-4">
            {[
              { valor: true, texto: 'La ampara', detalle: 'Entra en la cobertura.' },
              { valor: false, texto: 'No la ampara', detalle: 'Es una exclusión: queda afuera.' },
            ].map((opcion) => (
              <label key={String(opcion.valor)} className="flex flex-1 items-start gap-2">
                <input
                  type="radio"
                  name="clausula-ampara"
                  checked={datos.ampara === opcion.valor}
                  onChange={() => cambiar('ampara', opcion.valor)}
                  className="mt-0.5 h-4 w-4 border-slate-300"
                />
                <span className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{opcion.texto}</span>
                  <span className="block text-xs text-slate-500">{opcion.detalle}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <AreaTexto
          etiqueta="Detalle"
          rows={3}
          value={datos.detalle}
          onChange={(evento) => cambiar('detalle', evento.target.value)}
          ayuda="El límite, la franquicia o la condición: lo que hay que aclarar al contestar."
        />
      </div>
    </Dialogo>
  )
}
