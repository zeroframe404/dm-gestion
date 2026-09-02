// Compañías → Precios: cuánto sale cada cobertura en cada compañía.
//
// La lista que más se mira es la de RESPONSABILIDAD CIVIL, que es el piso con el que se compara todo,
// y por eso la pantalla arranca en esa cobertura si está cargada. Dentro de cada cobertura las filas
// van de la más barata a la más cara: la pregunta del mostrador nunca es «cuánto sale en ATM», es
// «cuál es la más barata», y la respuesta tiene que estar en el primer renglón.
//
// Lo que la pantalla insiste en mostrar es DESDE CUÁNDO rige cada precio. Un precio de hace cuatro
// meses se ve igual que uno de hoy, y pasarlo por bueno es el error caro de esta pantalla.
import { useEffect, useMemo, useState } from 'react'
import type { DatosDePrecio, ListasDeCompanias, PrecioDeCompania } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import {
  AccionesDeFila,
  Buscador,
  comparar,
  Contador,
  DialogoDeBorrado,
  ENCABEZADO,
  fechaCorta,
  normalizar,
  pesos,
  SinFilas,
  SoloConsulta,
  Sugerencias,
} from './comunes'

/** La cobertura con la que arranca la pantalla, si está cargada: es la que se consulta todo el día. */
const COBERTURA_PREFERIDA = 'RESPONSABILIDADCIVIL'

/** Un precio de más de estos días ya no se pasa sin volver a preguntar. */
const DIAS_PARA_ENVEJECER = 60

const VACIO: DatosDePrecio = { compania: '', cobertura: '', rama: '', precio: '', vigenteDesde: '', observaciones: '' }

interface Edicion {
  id: number | null
  datos: DatosDePrecio
}

interface Props {
  listas: ListasDeCompanias
  alCambiar: (listas: ListasDeCompanias) => void
}

/** Cuántos días pasaron desde esa fecha, o null si no hay fecha cargada. */
function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  const desde = Date.parse(`${iso}T00:00:00`)
  if (Number.isNaN(desde)) return null
  return Math.floor((Date.now() - desde) / 86_400_000)
}

export function Precios({ listas, alCambiar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [cobertura, setCobertura] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<PrecioDeCompania | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const puedeEditar = listas.puedeEditar
  const precios = listas.precios

  /** Las coberturas que tienen al menos un precio: son las solapas de arriba. */
  const coberturas = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const precio of precios) {
      const clave = normalizar(precio.cobertura)
      if (!vistas.has(clave)) vistas.set(clave, precio.cobertura)
    }
    return [...vistas.values()].sort(comparar)
  }, [precios])

  // La cobertura elegida se acomoda sola: al abrir la pantalla y cada vez que la que estaba elegida
  // se queda sin precios (se borró el último). Sin esto la tabla quedaba vacía sin explicación.
  useEffect(() => {
    if (cobertura !== null && coberturas.some((nombre) => normalizar(nombre) === normalizar(cobertura))) return
    const preferida = coberturas.find((nombre) => normalizar(nombre) === COBERTURA_PREFERIDA)
    setCobertura(preferida ?? coberturas[0] ?? null)
  }, [coberturas, cobertura])

  const filtrados = useMemo(() => {
    const texto = normalizar(busqueda)
    return precios.filter((precio) => {
      if (cobertura !== null && normalizar(precio.cobertura) !== normalizar(cobertura)) return false
      if (!texto) return true
      return normalizar(precio.compania).includes(texto) || normalizar(precio.rama).includes(texto)
    })
  }, [precios, cobertura, busqueda])

  const masBarato = filtrados.length > 0 ? Math.min(...filtrados.map((precio) => precio.precio)) : null

  const responder = (resultado: { ok: true; datos: ListasDeCompanias } | { ok: false; error: string }, mensaje: string) => {
    if (resultado.ok) {
      alCambiar(resultado.datos)
      setError(null)
      setAviso(mensaje)
      return null
    }
    return resultado.error
  }

  const guardar = async (datos: DatosDePrecio) => {
    if (!edicion) return 'Se cerró el formulario antes de guardar.'
    const resultado = await window.dm.referencias.guardarPrecio(edicion.id, datos)
    const problema = responder(resultado, `Se guardó el precio de ${datos.compania} · ${datos.cobertura}.`)
    if (!problema) {
      setEdicion(null)
      // Guardar un precio de otra cobertura y quedarse mirando la de antes parece que no guardó nada.
      setCobertura(datos.cobertura)
    }
    return problema
  }

  const confirmarBorrado = async () => {
    if (!borrando) return
    const problema = responder(
      await window.dm.referencias.borrarPrecio(borrando.id),
      `Se borró el precio de ${borrando.compania} · ${borrando.cobertura}.`,
    )
    if (problema) setError(problema)
    setBorrando(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar por compañía o rama" />
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <Contador rotulo="Precios cargados" valor={precios.length} />
        {puedeEditar && (
          <div className="ml-auto">
            <Boton
              variante="primario"
              icono="mas"
              onClick={() => setEdicion({ id: null, datos: { ...VACIO, cobertura: cobertura ?? '' } })}
            >
              Nuevo precio
            </Boton>
          </div>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!puedeEditar && <SoloConsulta que="La lista de precios" pedirle="una compañía" />}

      {/* Las coberturas cargadas, como botones: se pasa de responsabilidad civil a todo riesgo de un clic. */}
      {coberturas.length > 1 && (
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

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={ENCABEZADO}>Compañía</th>
              <th className={ENCABEZADO}>Rama</th>
              <th className={`${ENCABEZADO} text-right`}>Precio</th>
              <th className={ENCABEZADO}>Rige desde</th>
              <th className={ENCABEZADO}>Observaciones</th>
              {puedeEditar && <th className={ENCABEZADO} />}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <SinFilas columnas={puedeEditar ? 6 : 5} vacia={precios.length === 0} busqueda={busqueda}>
                <p className="font-semibold text-slate-700">Todavía no hay precios cargados.</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  Es la lista de precios de todas las compañías, cobertura por cobertura.{' '}
                  {puedeEditar
                    ? 'Empezá por responsabilidad civil, que es la que más se consulta, y cargá una fila por compañía.'
                    : 'La carga el superadministrador.'}
                </p>
              </SinFilas>
            )}
            {filtrados.map((precio) => {
              const dias = diasDesde(precio.vigenteDesde)
              const viejo = dias !== null && dias > DIAS_PARA_ENVEJECER
              return (
                <tr key={precio.id} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      {precio.compania}
                      {precio.precio === masBarato && filtrados.length > 1 && <Etiqueta tono="exito">el más barato</Etiqueta>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{precio.rama ?? 'Cualquiera'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{pesos(precio.precio)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-700">{fechaCorta(precio.vigenteDesde)}</span>
                      {/* Sin fecha no se puede saber si el precio sirve: se avisa igual que si estuviera vencido. */}
                      {precio.vigenteDesde === null && <Etiqueta tono="neutro">sin fecha</Etiqueta>}
                      {viejo && <Etiqueta tono="aviso">hace {dias} días</Etiqueta>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{precio.observaciones ?? '—'}</td>
                  {puedeEditar && (
                    <td className="px-3 py-2">
                      <AccionesDeFila
                        alEditar={() =>
                          setEdicion({
                            id: precio.id,
                            datos: {
                              compania: precio.compania,
                              cobertura: precio.cobertura,
                              rama: precio.rama ?? '',
                              precio: String(precio.precio).replace('.', ','),
                              vigenteDesde: precio.vigenteDesde ?? '',
                              observaciones: precio.observaciones ?? '',
                            },
                          })
                        }
                        alBorrar={() => setBorrando(precio)}
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {edicion && (
        <DialogoPrecio
          edicion={edicion}
          companias={listas.companias}
          coberturas={listas.coberturas}
          alCerrar={() => setEdicion(null)}
          alGuardar={guardar}
        />
      )}

      <DialogoDeBorrado
        abierto={borrando !== null}
        titulo="Borrar el precio"
        descripcion={borrando ? `${borrando.compania} · ${borrando.cobertura}` : undefined}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => void confirmarBorrado()}
      >
        Esa compañía deja de aparecer en la comparación de precios de esa cobertura. Si lo que cambió es el importe, editalo en vez de
        borrarlo: así queda la fecha nueva a la vista.
      </DialogoDeBorrado>
    </div>
  )
}

interface PropsDialogo {
  edicion: Edicion
  companias: string[]
  coberturas: string[]
  alCerrar: () => void
  alGuardar: (datos: DatosDePrecio) => Promise<string | null>
}

function DialogoPrecio({ edicion, companias, coberturas, alCerrar, alGuardar }: PropsDialogo) {
  const [datos, setDatos] = useState<DatosDePrecio>(edicion.datos)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (campo: keyof DatosDePrecio, valor: string) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async () => {
    if (!datos.compania.trim() || !datos.cobertura.trim()) {
      setError('Poné la compañía y la cobertura: son las dos cosas con las que se busca el precio.')
      return
    }
    if (!datos.precio.trim()) {
      setError('Poné el precio.')
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
      titulo={edicion.id === null ? 'Nuevo precio' : 'Editar el precio'}
      descripcion="Cuánto sale esta cobertura en esta compañía, y desde cuándo rige ese precio."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar precio
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
            list="precios-companias"
            autoFocus
            ayuda="Escribila igual que en la planilla."
          />
          <Campo
            etiqueta="Cobertura"
            value={datos.cobertura}
            onChange={(evento) => cambiar('cobertura', evento.target.value)}
            list="precios-coberturas"
            ayuda="Por ejemplo: RESPONSABILIDAD CIVIL."
          />
        </div>
        <Sugerencias id="precios-companias" valores={companias} />
        <Sugerencias id="precios-coberturas" valores={coberturas} />

        <div className="grid grid-cols-3 gap-3">
          <Campo
            etiqueta="Precio"
            value={datos.precio}
            onChange={(evento) => cambiar('precio', evento.target.value)}
            inputMode="decimal"
            placeholder="18500"
            ayuda="Con coma o sin ella: 18500 o 18500,50."
          />
          <Campo
            etiqueta="Rama"
            value={datos.rama}
            onChange={(evento) => cambiar('rama', evento.target.value)}
            placeholder="AUTO"
            ayuda="Vacío = vale para cualquier vehículo."
          />
          <Campo
            etiqueta="Rige desde"
            type="date"
            value={datos.vigenteDesde}
            onChange={(evento) => cambiar('vigenteDesde', evento.target.value)}
            ayuda="Sin esto no se puede saber si el precio sigue sirviendo."
          />
        </div>

        <Campo
          etiqueta="Observaciones"
          value={datos.observaciones}
          onChange={(evento) => cambiar('observaciones', evento.target.value)}
          ayuda="Lo que hay que aclarar al pasarlo: si es con débito, si incluye algún descuento."
        />
      </div>
    </Dialogo>
  )
}
