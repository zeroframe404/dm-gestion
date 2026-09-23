// El formulario del presupuesto: de quién es, qué vehículo y las compañías cotizadas.
//
// Las opciones son filas que se agregan y se sacan, porque cotizar es eso: se piden tres precios y se
// cargan los tres. La fila vacía del final está siempre lista, así se carga una atrás de otra sin
// tocar ningún botón de «agregar».
import { useEffect, useState } from 'react'
import type { ClausulaDeCobertura, DatosDeOpcion, DatosDePresupuesto, FichaPresupuesto, FilaCliente } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, cx } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoCotizarGaleno } from './DialogoCotizarGaleno'

interface Props {
  /** El presupuesto que se está editando, o null si es nuevo. */
  ficha: FichaPresupuesto | null
  /** De quién es, cuando se entra desde la ficha de una consulta o de un cliente. */
  leadId?: number | null
  clienteId?: number | null
  companias: string[]
  coberturas: string[]
  /** Qué ampara y qué no cada cobertura registrada, para «describir cobertura» en cada fila. */
  clausulas: ClausulaDeCobertura[]
  alCerrar: () => void
  alGuardar: (ficha: FichaPresupuesto) => void
}

const OPCION_VACIA: DatosDeOpcion = { compania: '', cobertura: '', precio: '', comentario: '' }

/** Igual que el «normalizar» de Compañías: mayúsculas, sin acentos y sin separadores, para comparar. */
function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

const TIPOS_DE_USO = ['Particular', 'Comercial', 'Transporte de pasajeros', 'Remise / Taxi', 'Escolar', 'Carga']

/** El botón «Describir cobertura»: qué ampara y qué no, según lo cargado en Compañías → Cobertura. */
function DescribirCobertura({ clausulas, compania, cobertura }: { clausulas: ClausulaDeCobertura[]; compania: string; cobertura: string }) {
  const [abierto, setAbierto] = useState(false)
  if (!cobertura.trim()) return null
  const cob = normalizar(cobertura)
  const comp = normalizar(compania)
  const coincidencias = clausulas
    .filter((c) => normalizar(c.cobertura) === cob && (c.compania === null || normalizar(c.compania) === comp))
    .sort((a, b) => Number(a.compania === null) - Number(b.compania === null) || Number(b.ampara) - Number(a.ampara) || a.orden - b.orden)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title="Describir esta cobertura"
        aria-label={`Describir la cobertura ${cobertura}`}
        onClick={() => setAbierto((v) => !v)}
        className={cx('rounded p-1.5 text-slate-400 hover:bg-marino-50 hover:text-marino-700', abierto && 'bg-marino-50 text-marino-700')}
      >
        <Icono nombre="info" tamano={15} />
      </button>
      {abierto && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-media">
          <p className="mb-1.5 font-semibold text-slate-700">{cobertura}</p>
          {coincidencias.length === 0 ? (
            <p className="text-slate-500">Todavía no hay cláusulas cargadas para esta cobertura (Compañías → Cobertura).</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {coincidencias.map((c) => (
                <li key={c.id} className={c.ampara ? 'text-slate-700' : 'text-red-700'}>
                  <strong>{c.ampara ? 'Cubre: ' : 'No cubre: '}</strong>
                  {c.clausula}
                  {c.detalle ? ` — ${c.detalle}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function FormularioPresupuesto({ ficha, leadId, clienteId, companias, coberturas, clausulas, alCerrar, alGuardar }: Props) {
  const usuario = useUsuarioActual()
  const p = ficha?.presupuesto ?? null

  const [datos, setDatos] = useState<DatosDePresupuesto>({
    leadId: p?.leadId ?? leadId ?? null,
    clienteId: p?.clienteId ?? clienteId ?? null,
    clienteNombre: p?.clienteNombre ?? '',
    telefono: p?.telefono ?? '',
    documento: p?.documento ?? '',
    sucursal: p?.sucursal ?? usuario.sucursal.nombre,
    patente: p?.patente ?? '',
    marca: p?.marca ?? '',
    modelo: p?.modelo ?? '',
    anio: p?.anio ?? '',
    tipoVehiculo: p?.tipoVehiculo ?? '',
    sumaAsegurada: p?.sumaAsegurada ?? '',
    observaciones: p?.observaciones ?? '',
    opciones: ficha ? ficha.opciones.map((o) => ({ compania: o.compania, cobertura: o.cobertura, precio: o.precio, comentario: o.comentario ?? '' })) : [],
  })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [buscando, setBuscando] = useState('')
  const [candidatos, setCandidatos] = useState<FilaCliente[]>([])
  const [cotizandoConGaleno, setCotizandoConGaleno] = useState(false)

  // Si se entra desde una consulta o un cliente, los datos se traen solos: el punto es no re-tipear.
  useEffect(() => {
    if (ficha) return
    const traer = async () => {
      if (leadId) {
        const resultado = await window.dm.leads.ficha(leadId)
        if (resultado.ok) {
          const lead = resultado.datos.lead
          setDatos((previos) => ({
            ...previos,
            clienteNombre: lead.nombre,
            telefono: lead.telefono ?? '',
            documento: lead.documento ?? '',
            sucursal: lead.sucursal ?? previos.sucursal,
            tipoVehiculo: lead.tipoVehiculo ?? '',
          }))
        }
      } else if (clienteId) {
        const resultado = await window.dm.clientes.ficha(clienteId)
        if (resultado.ok) {
          const cliente = resultado.datos
          setDatos((previos) => ({
            ...previos,
            clienteNombre: cliente.nombre,
            telefono: cliente.telefono ?? '',
            documento: cliente.documento ?? '',
            sucursal: cliente.sucursal ?? previos.sucursal,
          }))
        }
      }
    }
    void traer()
  }, [ficha, leadId, clienteId])

  // Buscador de clientes: sólo cuando el presupuesto no es de nadie todavía.
  useEffect(() => {
    if (datos.clienteId !== null || datos.leadId !== null || buscando.trim().length < 2) {
      setCandidatos([])
      return
    }
    let vigente = true
    const reloj = setTimeout(async () => {
      const resultado = await window.dm.clientes.buscar(buscando)
      if (vigente && resultado.ok) setCandidatos(resultado.datos)
    }, 250)
    return () => {
      vigente = false
      clearTimeout(reloj)
    }
  }, [buscando, datos.clienteId, datos.leadId])

  const cambiar = (cambios: Partial<DatosDePresupuesto>) => setDatos((previos) => ({ ...previos, ...cambios }))

  const cambiarOpcion = (indice: number, cambios: Partial<DatosDeOpcion>) =>
    setDatos((previos) => ({
      ...previos,
      opciones: previos.opciones.map((opcion, i) => (i === indice ? { ...opcion, ...cambios } : opcion)),
    }))

  // Siempre hay una fila vacía al final para seguir cargando sin apretar «agregar».
  const filas = [...datos.opciones, OPCION_VACIA]

  const escribirEnFila = (indice: number, cambios: Partial<DatosDeOpcion>) => {
    if (indice < datos.opciones.length) return cambiarOpcion(indice, cambios)
    setDatos((previos) => ({ ...previos, opciones: [...previos.opciones, { ...OPCION_VACIA, ...cambios }] }))
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = p ? await window.dm.presupuestos.guardar(p.id, datos) : await window.dm.presupuestos.crear(datos)
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos)
    else setError(resultado.error)
  }

  const creaVersion = p !== null && p.estado !== 'BORRADOR'
  const celda = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 placeholder:text-slate-400'

  return (
    <>
    <Dialogo
      abierto
      ancho="lg"
      titulo={p ? `Presupuesto ${p.numero}` : 'Nuevo presupuesto'}
      descripcion={
        creaVersion
          ? `Este presupuesto ya está ${p.estado}. Al guardar se crea la versión ${p.version + 1} y la anterior queda tal cual, con los precios que el cliente ya recibió.`
          : 'Cargá el vehículo y las compañías que cotizaste. El mensaje de WhatsApp y el PDF se arman solos con esto.'
      }
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" cargando={guardando} onClick={() => void guardar()}>
            {creaVersion ? `Guardar como versión ${p.version + 1}` : 'Guardar'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alerta tono="error">{error}</Alerta>}
        {creaVersion && (
          <Alerta tono="info">
            Se guarda como versión nueva a propósito: si el cliente llama diciendo «me habías pasado otro precio», la versión anterior sigue
            entera para poder mirarla.
          </Alerta>
        )}

        {/* --- De quién es --- */}
        <section className="flex flex-col gap-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Para quién</h3>

          {datos.clienteId === null && datos.leadId === null && !p && (
            <div className="relative">
              <Campo
                etiqueta="Buscar un cliente que ya esté (opcional)"
                value={buscando}
                onChange={(e) => setBuscando(e.target.value)}
                placeholder="Nombre, DNI o patente…"
                ayuda="Si es alguien que ya es cliente, elegilo y los datos se completan solos."
              />
              {candidatos.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-media">
                  {candidatos.map((cliente) => (
                    <li key={cliente.id}>
                      <button
                        type="button"
                        onClick={() => {
                          cambiar({
                            clienteId: cliente.id,
                            clienteNombre: cliente.nombre,
                            telefono: cliente.telefono ?? '',
                            documento: cliente.documento ?? '',
                            sucursal: cliente.sucursal ?? datos.sucursal,
                          })
                          setBuscando('')
                          setCandidatos([])
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="block font-medium text-slate-900">{cliente.nombre}</span>
                        <span className="block text-xs text-slate-500">
                          {[cliente.documento, cliente.sucursal].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Campo etiqueta="Nombre" value={datos.clienteNombre} onChange={(e) => cambiar({ clienteNombre: e.target.value })} />
            <Campo etiqueta="Teléfono" value={datos.telefono} onChange={(e) => cambiar({ telefono: e.target.value })} />
            <Campo etiqueta="DNI / CUIT" value={datos.documento} onChange={(e) => cambiar({ documento: e.target.value })} />
          </div>
        </section>

        {/* --- El vehículo --- */}
        <section className="flex flex-col gap-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">El vehículo</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Campo etiqueta="Patente" value={datos.patente} onChange={(e) => cambiar({ patente: e.target.value.toUpperCase() })} />
            <Campo etiqueta="Marca" value={datos.marca} onChange={(e) => cambiar({ marca: e.target.value })} />
            <Campo etiqueta="Modelo" value={datos.modelo} onChange={(e) => cambiar({ modelo: e.target.value })} />
            <Campo etiqueta="Año" value={datos.anio} onChange={(e) => cambiar({ anio: e.target.value })} inputMode="numeric" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Campo
                etiqueta="Tipo de uso"
                list="tipos-de-uso-presupuesto"
                value={datos.tipoVehiculo}
                onChange={(e) => cambiar({ tipoVehiculo: e.target.value })}
                placeholder="Particular, transporte de pasajeros…"
              />
              <datalist id="tipos-de-uso-presupuesto">
                {TIPOS_DE_USO.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <Campo
              etiqueta="Suma asegurada"
              value={datos.sumaAsegurada}
              onChange={(e) => cambiar({ sumaAsegurada: e.target.value })}
              placeholder="$ 17.000.000"
            />
          </div>
        </section>

        {/* --- Las opciones cotizadas --- */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Opciones cotizadas</h3>
            <Boton icono="enlace" onClick={() => setCotizandoConGaleno(true)}>
              Cotizar con Galeno
            </Boton>
          </div>
          <datalist id="companias-presupuesto">
            {companias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="coberturas-presupuesto">
            {coberturas.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <th className="pb-1.5 pr-2 font-bold">Compañía</th>
                  <th className="pb-1.5 pr-2 font-bold">Cobertura</th>
                  <th className="w-32 pb-1.5 pr-2 font-bold">Precio mensual</th>
                  <th className="pb-1.5 pr-2 font-bold">Comentario</th>
                  <th className="w-8 pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {filas.map((opcion, indice) => {
                  const esLaVacia = indice === datos.opciones.length
                  return (
                    <tr key={indice} className={cx(esLaVacia && 'opacity-70 focus-within:opacity-100')}>
                      <td className="py-1 pr-2">
                        <input
                          list="companias-presupuesto"
                          value={opcion.compania}
                          onChange={(e) => escribirEnFila(indice, { compania: e.target.value })}
                          placeholder={esLaVacia ? 'Sumar otra…' : ''}
                          aria-label={`Compañía de la opción ${indice + 1}`}
                          className={celda}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-1">
                          <input
                            list="coberturas-presupuesto"
                            value={opcion.cobertura}
                            onChange={(e) => escribirEnFila(indice, { cobertura: e.target.value })}
                            aria-label={`Cobertura de la opción ${indice + 1}`}
                            className={celda}
                          />
                          <DescribirCobertura clausulas={clausulas} compania={opcion.compania} cobertura={opcion.cobertura} />
                        </div>
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={opcion.precio}
                          onChange={(e) => escribirEnFila(indice, { precio: e.target.value })}
                          placeholder="$ 45.000"
                          aria-label={`Precio de la opción ${indice + 1}`}
                          className={cx(celda, 'tabular-nums')}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={opcion.comentario}
                          onChange={(e) => escribirEnFila(indice, { comentario: e.target.value })}
                          placeholder="Franquicia, cuotas, lo que haya que aclarar"
                          aria-label={`Comentario de la opción ${indice + 1}`}
                          className={celda}
                        />
                      </td>
                      <td className="py-1">
                        {!esLaVacia && (
                          <button
                            type="button"
                            aria-label={`Sacar la opción ${indice + 1}`}
                            onClick={() => setDatos((previos) => ({ ...previos, opciones: previos.opciones.filter((_, i) => i !== indice) }))}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Icono nombre="basura" tamano={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <AreaTexto
          etiqueta="Observaciones"
          rows={2}
          value={datos.observaciones}
          onChange={(e) => cambiar({ observaciones: e.target.value })}
          placeholder="Lo que se le quiera aclarar; sale en el mensaje y en el PDF."
        />
      </div>
    </Dialogo>
    {cotizandoConGaleno && (
      <DialogoCotizarGaleno
        tipoVehiculoSugerido={/moto/i.test(datos.tipoVehiculo) ? 'MOTO' : 'AUTO'}
        nombreSugerido={datos.clienteNombre}
        patenteSugerida={datos.patente}
        documentoSugerido={datos.documento}
        telefonoSugerido={datos.telefono}
        alCerrar={() => setCotizandoConGaleno(false)}
        alAgregarOpciones={(nuevas) => setDatos((previos) => ({ ...previos, opciones: [...previos.opciones, ...nuevas] }))}
      />
    )}
    </>
  )
}
