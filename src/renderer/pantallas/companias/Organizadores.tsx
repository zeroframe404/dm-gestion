// Compañías → Organizadores: a quién le escribe el bróker cuando tiene que pedir un precio.
//
// Por qué es una lista con orden y no un listado alfabético: cuando entra una consulta, el mensaje
// con los datos del vehículo se manda a varios organizadores, uno atrás del otro, y el orden en que
// se les escribe lo decide la agencia (quién contesta más rápido, quién tiene mejor precio esta
// semana). Por eso las flechas de subir y bajar, y por eso el botón de WhatsApp está en cada fila:
// esta pantalla se usa de arriba abajo, no se busca en ella.
import { useMemo, useState } from 'react'
import type { DatosDeOrganizador, ListasDeCompanias, Organizador } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import { AccionesDeFila, Buscador, Contador, DialogoDeBorrado, ENCABEZADO, normalizar, SinFilas, SoloConsulta, Sugerencias } from './comunes'

const VACIO: DatosDeOrganizador = {
  nombre: '',
  companias: '',
  telefono: '',
  email: '',
  horario: '',
  observaciones: '',
  activo: true,
}

interface Edicion {
  id: number | null
  datos: DatosDeOrganizador
}

interface Props {
  listas: ListasDeCompanias
  alCambiar: (listas: ListasDeCompanias) => void
}

export function Organizadores({ listas, alCambiar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<Organizador | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const puedeEditar = listas.puedeEditar
  const organizadores = listas.organizadores
  const activos = organizadores.filter((organizador) => organizador.activo).length

  const filtrados = useMemo(() => {
    const texto = normalizar(busqueda)
    if (!texto) return organizadores
    return organizadores.filter(
      (organizador) => normalizar(organizador.nombre).includes(texto) || normalizar(organizador.companias).includes(texto),
    )
  }, [organizadores, busqueda])

  const responder = (resultado: { ok: true; datos: ListasDeCompanias } | { ok: false; error: string }, mensaje: string) => {
    if (resultado.ok) {
      alCambiar(resultado.datos)
      setError(null)
      setAviso(mensaje)
      return null
    }
    return resultado.error
  }

  const guardar = async (datos: DatosDeOrganizador) => {
    if (!edicion) return 'Se cerró el formulario antes de guardar.'
    const resultado = await window.dm.referencias.guardarOrganizador(edicion.id, datos)
    const problema = responder(resultado, `Se guardó ${datos.nombre}.`)
    if (!problema) setEdicion(null)
    return problema
  }

  const confirmarBorrado = async () => {
    if (!borrando) return
    const problema = responder(await window.dm.referencias.borrarOrganizador(borrando.id), `Se borró ${borrando.nombre}.`)
    if (problema) setError(problema)
    setBorrando(null)
  }

  const mover = async (organizador: Organizador, direccion: 'arriba' | 'abajo') => {
    // Moverse de lugar no es una novedad que valga un cartel verde: se ve en la lista misma.
    const resultado = await window.dm.referencias.moverOrganizador(organizador.id, direccion)
    if (resultado.ok) alCambiar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar por organizador o compañía" />
        {busqueda && (
          <Boton tamano="sm" variante="fantasma" icono="cerrar" onClick={() => setBusqueda('')}>
            Limpiar
          </Boton>
        )}
        <Contador rotulo="Organizadores" valor={organizadores.length} />
        {activos !== organizadores.length && <Contador rotulo="En uso" valor={activos} />}
        {puedeEditar && (
          <div className="ml-auto">
            <Boton variante="primario" icono="mas" onClick={() => setEdicion({ id: null, datos: VACIO })}>
              Nuevo organizador
            </Boton>
          </div>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!puedeEditar && <SoloConsulta que="La lista de organizadores" pedirle="alguno" />}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={`${ENCABEZADO} w-10`}>#</th>
              <th className={ENCABEZADO}>Organizador</th>
              <th className={ENCABEZADO}>Compañías que cotiza</th>
              <th className={ENCABEZADO}>Teléfono</th>
              <th className={ENCABEZADO}>Correo</th>
              <th className={ENCABEZADO}>Horario</th>
              <th className={ENCABEZADO}>Observaciones</th>
              <th className={ENCABEZADO} />
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <SinFilas columnas={8} vacia={organizadores.length === 0} busqueda={busqueda}>
                <p className="font-semibold text-slate-700">Todavía no hay organizadores cargados.</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  Son las personas a las que se les manda el mensaje para pedir precio.{' '}
                  {puedeEditar
                    ? 'Cargalos con «Nuevo organizador» y ordenalos con las flechas: la lista se recorre de arriba abajo.'
                    : 'Los carga el superadministrador.'}
                </p>
              </SinFilas>
            )}
            {filtrados.map((organizador, posicion) => (
              <tr
                key={organizador.id}
                className={`border-b border-slate-100 align-top last:border-b-0 ${organizador.activo ? '' : 'bg-slate-50/60'}`}
              >
                <td className="px-3 py-2 tabular-nums text-slate-400">{posicion + 1}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${organizador.activo ? 'text-slate-900' : 'text-slate-500 line-through'}`}>
                      {organizador.nombre}
                    </span>
                    {!organizador.activo && <Etiqueta tono="neutro">sin usar</Etiqueta>}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">{organizador.companias ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                  {organizador.telefono ? (
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{organizador.telefono}</span>
                      {/* Sin enlace el teléfono igual sirve para llamar: no se esconde, se muestra sin botón. */}
                      {organizador.whatsapp && (
                        <a
                          href={organizador.whatsapp}
                          target="_blank"
                          rel="noreferrer"
                          title={`Escribirle a ${organizador.nombre} por WhatsApp`}
                          className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100"
                        >
                          <Icono nombre="mensaje" tamano={13} />
                          Escribir
                        </a>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-slate-700">{organizador.email ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{organizador.horario ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{organizador.observaciones ?? '—'}</td>
                <td className="px-3 py-2">
                  {puedeEditar && (
                    <div className="flex items-center justify-end gap-1">
                      {/* Las flechas se ocultan con la búsqueda puesta: mover el tercero de una lista
                          filtrada lo movería respecto de filas que no están a la vista. */}
                      {!busqueda && (
                        <>
                          <Boton
                            tamano="sm"
                            variante="fantasma"
                            icono="subir"
                            aria-label={`Subir ${organizador.nombre}`}
                            disabled={posicion === 0}
                            onClick={() => void mover(organizador, 'arriba')}
                          />
                          <Boton
                            tamano="sm"
                            variante="fantasma"
                            icono="desplegar"
                            aria-label={`Bajar ${organizador.nombre}`}
                            disabled={posicion === filtrados.length - 1}
                            onClick={() => void mover(organizador, 'abajo')}
                          />
                        </>
                      )}
                      <AccionesDeFila
                        alEditar={() =>
                          setEdicion({
                            id: organizador.id,
                            datos: {
                              nombre: organizador.nombre,
                              companias: organizador.companias ?? '',
                              telefono: organizador.telefono ?? '',
                              email: organizador.email ?? '',
                              horario: organizador.horario ?? '',
                              observaciones: organizador.observaciones ?? '',
                              activo: organizador.activo,
                            },
                          })
                        }
                        alBorrar={() => setBorrando(organizador)}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edicion && (
        <DialogoOrganizador edicion={edicion} companias={listas.companias} alCerrar={() => setEdicion(null)} alGuardar={guardar} />
      )}

      <DialogoDeBorrado
        abierto={borrando !== null}
        titulo="Borrar el organizador"
        descripcion={borrando?.nombre}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => void confirmarBorrado()}
      >
        Se va de la lista de gente a la que se le pide precio. Si es alguien con quien se dejó de trabajar pero podrías volver a
        necesitar, conviene editarlo y destildar «Se le pide precio»: queda a la vista, apagado, con su teléfono.
      </DialogoDeBorrado>
    </div>
  )
}

interface PropsDialogo {
  edicion: Edicion
  companias: string[]
  alCerrar: () => void
  /** Devuelve el mensaje de error del proceso principal, o null si guardó bien. */
  alGuardar: (datos: DatosDeOrganizador) => Promise<string | null>
}

function DialogoOrganizador({ edicion, companias, alCerrar, alGuardar }: PropsDialogo) {
  const [datos, setDatos] = useState<DatosDeOrganizador>(edicion.datos)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (campo: keyof DatosDeOrganizador, valor: string | boolean) => setDatos((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async () => {
    if (!datos.nombre.trim()) {
      setError('Poné el nombre del organizador: es con lo que se lo busca.')
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
      titulo={edicion.id === null ? 'Nuevo organizador' : 'Editar el organizador'}
      descripcion="A quién se le manda el mensaje cuando hay que pedir un precio."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar organizador
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nombre" value={datos.nombre} onChange={(evento) => cambiar('nombre', evento.target.value)} autoFocus />
          <Campo
            etiqueta="Teléfono"
            value={datos.telefono}
            onChange={(evento) => cambiar('telefono', evento.target.value)}
            placeholder="11 4567-8901"
            ayuda="Con este número se arma el botón de WhatsApp de la lista."
          />
        </div>

        <Campo
          etiqueta="Compañías que cotiza"
          value={datos.companias}
          onChange={(evento) => cambiar('companias', evento.target.value)}
          list="organizadores-companias"
          ayuda="Separadas por comas. Sirve para saber a quién escribirle según lo que se esté cotizando."
        />
        <Sugerencias id="organizadores-companias" valores={companias} />

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Correo" value={datos.email} onChange={(evento) => cambiar('email', evento.target.value)} />
          <Campo
            etiqueta="Horario"
            value={datos.horario}
            onChange={(evento) => cambiar('horario', evento.target.value)}
            placeholder="Lunes a viernes de 9 a 17"
          />
        </div>

        <Campo
          etiqueta="Observaciones"
          value={datos.observaciones}
          onChange={(evento) => cambiar('observaciones', evento.target.value)}
          ayuda="Lo que conviene recordar antes de escribirle: qué datos pide, cuánto tarda en contestar."
        />

        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <input
            type="checkbox"
            checked={datos.activo}
            onChange={(evento) => cambiar('activo', evento.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Se le pide precio</span>
            <span className="block text-xs leading-relaxed text-slate-500">
              Destildalo para dejarlo apagado en la lista sin borrarlo: sigue estando, con su teléfono, para cuando vuelva a hacer falta.
            </span>
          </span>
        </label>
      </div>
    </Dialogo>
  )
}
