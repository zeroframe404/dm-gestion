// La ficha del cliente: todo lo que la agencia sabe de una persona en una sola pantalla, repartido en
// pestañas porque un cliente con diez años de historia no entra de otra forma.
//
// Dos criterios que atraviesan el archivo:
//  · Los textos que vinieron de la hoja (importes, fechas, patentes) se muestran tal cual. Ahí hay
//    «12/05/1980», «12-05-80» y «MAYO 80» conviviendo, y reformatear sería inventar.
//  · Las cuatro acciones del encabezado (nueva póliza, registrar pago, cargar siniestro, nueva tarea)
//    son las que se hacen con el cliente delante, por teléfono o en el mostrador.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { direccionEstaVacia, sanearDireccion } from '../../../shared/direccion'
import { diasParaVencer, estadoDePoliza, NOMBRE_ESTADO_POLIZA } from '../../../shared/polizas'
import { hoyLocal } from '../../../shared/semaforo'
import {
  NOMBRE_ESTADO_TAREA,
  type DatosDeCliente,
  type DatosDeTarea,
  type EstadoTarea,
  type FichaCliente,
  type PolizaDeCliente,
  type Sucursal,
} from '../../../shared/tipos'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, cx, Dialogo, Etiqueta } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { BotonEliminar } from '../../componentes/BotonEliminar'
import { detalleDeRiesgo, esVehiculo, nombreDeTipoDeRiesgo } from '../../../shared/riesgos'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePermisos, usePuedeEditar } from '../../contexto/Permisos'
import { BotonDeDireccion, CampoDeDocumento, CampoDeNacimiento, conDireccion, recortar } from './CamposDeCliente'
import { DialogoPagoDelCliente, DialogoSiniestro } from './DialogosDeFicha'
import { useUsuarioActual } from '../../contexto/Sesion'

type IdPestana = 'datos' | 'vehiculos' | 'polizas' | 'pagos' | 'siniestros' | 'notas'

const PESTANAS: Array<{ id: IdPestana; nombre: string; icono: NombreIcono; ayuda: string }> = [
  { id: 'datos', nombre: 'Datos', icono: 'usuario', ayuda: 'clientes.datos' },
  { id: 'vehiculos', nombre: 'Vehículos y riesgos', icono: 'auto', ayuda: 'clientes.vehiculos' },
  { id: 'polizas', nombre: 'Pólizas', icono: 'polizas', ayuda: 'clientes.polizas' },
  { id: 'pagos', nombre: 'Pagos', icono: 'billete', ayuda: 'clientes.pagos' },
  { id: 'siniestros', nombre: 'Siniestros', icono: 'siniestros', ayuda: 'clientes.siniestros' },
  { id: 'notas', nombre: 'Notas y tareas', icono: 'mensaje', ayuda: 'clientes.notas' },
]

const TH = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'
const TD = 'px-3 py-2 align-top text-slate-700'
const LISTA_SUCURSALES = 'lista-sucursales-ficha'

/** Los campos editables del cliente, sacados de la ficha que devolvió el proceso principal. */
function datosDe(ficha: FichaCliente): DatosDeCliente {
  return {
    nombre: ficha.nombre ?? '',
    documento: ficha.documento ?? '',
    telefono: ficha.telefono ?? '',
    email: ficha.email ?? '',
    direccion: ficha.direccion ?? '',
    localidad: ficha.localidad ?? '',
    sucursal: ficha.sucursal ?? '',
    fechaNacimiento: ficha.fechaNacimiento ?? '',
    direccionDetalle: sanearDireccion(ficha.direccionDetalle),
  }
}

/** Dos fichas son iguales si lo son campo a campo, con la dirección comparada por su contenido. */
function hayDiferencias(a: DatosDeCliente, b: DatosDeCliente): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function FichaDelCliente({
  clienteId,
  alVolver,
  alBorrar,
}: {
  clienteId: number
  alVolver: () => void
  /** Se borró el cliente de la base. Distinto de volver: el listado tiene que releerse. */
  alBorrar: () => void
}) {
  const { ir } = useNavegacion()
  const { puedeEditar } = usePermisos()
  const [ficha, setFicha] = useState<FichaCliente | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pestana, setPestana] = useState<IdPestana>('datos')
  const [tareaAbierta, setTareaAbierta] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [siniestroAbierto, setSiniestroAbierto] = useState(false)

  const hoy = useMemo(() => hoyLocal(), [])

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.clientes.ficha(clienteId)
    if (resultado.ok) {
      setFicha(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [clienteId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (cargando && !ficha) return <Cargando texto="Abriendo la ficha…" />

  if (!ficha) {
    return (
      <div className="flex flex-col gap-4 p-8">
        <Alerta tono="error">{error ?? 'No se pudo abrir la ficha de este cliente.'}</Alerta>
        <div className="flex gap-2">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>
          <Boton icono="cargando" onClick={() => void cargar()}>
            Reintentar
          </Boton>
        </div>
      </div>
    )
  }

  const cuentas: Record<IdPestana, number | null> = {
    datos: null,
    vehiculos: ficha.vehiculos.length,
    polizas: ficha.polizas.length,
    pagos: ficha.pagos.length,
    siniestros: ficha.siniestros.length,
    notas: ficha.notas.length + ficha.tareas.length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Encabezado: quién es, y las cuatro acciones que se hacen con el cliente delante. */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-start gap-4">
          <Boton icono="flechaIzquierda" onClick={alVolver}>
            Volver al listado
          </Boton>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-extrabold tracking-tight text-slate-900">{ficha.nombre}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="tabular-nums">{ficha.documento ? `DNI/CUIT ${ficha.documento}` : 'Sin documento cargado'}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Icono nombre="sucursal" tamano={13} />
                {ficha.sucursal ?? 'Sin sucursal'}
              </span>
              {ficha.telefono && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{ficha.telefono}</span>
                </>
              )}
            </p>
          </div>

          {/* Cada atajo lleva a otro módulo: se ofrece sólo si esta persona puede trabajar allá. */}
          <div className="flex flex-wrap items-center gap-2">
            {puedeEditar('polizas') && (
              <Boton variante="primario" icono="mas" onClick={() => ir('polizas', { nuevaPolizaPara: ficha.id })}>
                Nueva póliza
              </Boton>
            )}
            {(puedeEditar('cartera') || puedeEditar('cobranzas') || puedeEditar('clientes')) && (
              <Boton icono="billete" onClick={() => setPagoAbierto(true)}>
                Registrar pago
              </Boton>
            )}
            {puedeEditar('siniestros') && (
              <Boton icono="siniestros" onClick={() => setSiniestroAbierto(true)}>
                Cargar siniestro
              </Boton>
            )}
            {puedeEditar('presupuestos') && (
              <Boton icono="presupuestos" onClick={() => ir('presupuestos', { nuevoPresupuestoParaCliente: ficha.id })}>
                Presupuestar
              </Boton>
            )}
            {(puedeEditar('tareas') || puedeEditar('clientes')) && (
              <Boton icono="tareas" onClick={() => setTareaAbierta(true)}>
                Nueva tarea
              </Boton>
            )}
            {/* La papelera. Para quien no es superadministrador el componente no dibuja nada: ni un
                botón apagado, que lo único que consigue es que alguien lo intente. */}
            <BotonEliminar tipo="cliente" id={ficha.id} tamano="md" etiqueta="Eliminar cliente" alBorrar={alBorrar} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div role="tablist" aria-label="Secciones de la ficha" className="-mb-4 flex flex-1 gap-6 overflow-x-auto">
            {PESTANAS.map((candidata) => {
              const activa = candidata.id === pestana
              const cuenta = cuentas[candidata.id]
              return (
                <button
                  key={candidata.id}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  onClick={() => setPestana(candidata.id)}
                  className={cx(
                    'inline-flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors',
                    activa ? 'border-marino-700 text-marino-800' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                  )}
                >
                  <Icono nombre={candidata.icono} tamano={16} />
                  {candidata.nombre}
                  {cuenta !== null && (
                    <span className={cx('rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums', activa ? 'bg-marino-100 text-marino-800' : 'bg-slate-100 text-slate-500')}>
                      {cuenta}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <BotonAyuda clave={PESTANAS.find((p) => p.id === pestana)?.ayuda ?? 'clientes.datos'} className="mb-3 shrink-0" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6" role="tabpanel" aria-label={PESTANAS.find((p) => p.id === pestana)?.nombre}>
        <div className="flex flex-col gap-4">
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}

          {pestana === 'datos' && <PestanaDatos ficha={ficha} alGuardar={setFicha} alAvisar={setAviso} />}
          {pestana === 'vehiculos' && <PestanaVehiculos ficha={ficha} />}
          {pestana === 'polizas' && <PestanaPolizas ficha={ficha} hoy={hoy} alAbrirPoliza={(polizaId) => ir('polizas', { polizaId })} />}
          {pestana === 'pagos' && <PestanaPagos ficha={ficha} />}
          {pestana === 'siniestros' && <PestanaSiniestros ficha={ficha} alAbrirSiniestro={(siniestroId) => ir('siniestros', { siniestroId })} />}
          {pestana === 'notas' && <PestanaNotas ficha={ficha} alCambiar={setFicha} alNuevaTarea={() => setTareaAbierta(true)} />}
        </div>
      </div>

      {pagoAbierto && (
        <DialogoPagoDelCliente
          ficha={ficha}
          alCerrar={() => setPagoAbierto(false)}
          alPagar={(nombre) => {
            setPagoAbierto(false)
            setAviso(`Quedó registrado el pago de ${nombre}.`)
            // La ficha muestra los pagos: se recarga para que aparezca el que se acaba de cargar.
            void cargar()
            setPestana('pagos')
          }}
        />
      )}

      {siniestroAbierto && (
        <DialogoSiniestro
          ficha={ficha}
          alCerrar={() => setSiniestroAbierto(false)}
          alCargar={(siniestros) => {
            setFicha((previa) => (previa ? { ...previa, siniestros } : previa))
            setSiniestroAbierto(false)
            setPestana('siniestros')
            setAviso('El siniestro quedó cargado en la ficha.')
          }}
        />
      )}

      <DialogoNuevaTarea
        abierto={tareaAbierta}
        clienteId={ficha.id}
        clienteNombre={ficha.nombre}
        alCerrar={() => setTareaAbierta(false)}
        alCrear={(tareas) => {
          setFicha((previa) => (previa ? { ...previa, tareas } : previa))
          setTareaAbierta(false)
          setPestana('notas')
          setAviso('La tarea quedó cargada en la ficha.')
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Datos: el único formulario editable de la ficha
// ---------------------------------------------------------------------------

function PestanaDatos({
  ficha,
  alGuardar,
  alAvisar,
}: {
  ficha: FichaCliente
  alGuardar: (ficha: FichaCliente) => void
  alAvisar: (mensaje: string | null) => void
}) {
  const puedeEditar = usePuedeEditar('clientes')
  const [borrador, setBorrador] = useState<DatosDeCliente>(() => datosDe(ficha))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [localidades, setLocalidades] = useState<string[]>([])

  // Las sucursales oficiales, para sugerirlas sin obligar: el campo es texto libre porque en la hoja
  // hay variantes viejas que no se pueden pisar sin preguntar. Con las localidades, lo mismo.
  useEffect(() => {
    void window.dm.sucursales.listar().then((resultado) => {
      if (resultado.ok) setSucursales(resultado.datos)
    })
    void window.dm.clientes.localidades().then((resultado) => {
      if (resultado.ok) setLocalidades(resultado.datos)
    })
  }, [])

  // Se reinicia sólo al cambiar de cliente, no cada vez que la ficha se rearma: agregar una nota o
  // mover una tarea devuelve una ficha nueva, y borrar lo tipeado por eso sería insoportable.
  useEffect(() => {
    setBorrador(datosDe(ficha))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficha.id])

  const original = datosDe(ficha)
  const hayCambios = hayDiferencias(borrador, original)

  const cambiarTexto = (campo: Exclude<keyof DatosDeCliente, 'direccionDetalle'>) => (valor: string) =>
    setBorrador((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    alAvisar(null)
    const resultado = await window.dm.clientes.editar(ficha.id, recortar(borrador))
    setGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    alGuardar(resultado.datos)
    setBorrador(datosDe(resultado.datos))
    alAvisar('Los datos del cliente quedaron guardados.')
  }

  return (
    <section className="max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-suave">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Nombre y apellido"
          value={borrador.nombre}
          onChange={(evento) => cambiarTexto('nombre')(evento.target.value)}
          autoComplete="off"
        />
        <CampoDeDocumento
          valor={borrador.documento}
          alCambiar={cambiarTexto('documento')}
          ayudaExtra="Es lo que identifica al cliente: dos personas no pueden tener el mismo."
        />
        <Campo
          etiqueta="Celular/WhatsApp"
          value={borrador.telefono}
          onChange={(evento) => cambiarTexto('telefono')(evento.target.value)}
          className="tabular-nums"
          autoComplete="off"
        />
        <Campo
          etiqueta="Email"
          type="email"
          value={borrador.email}
          onChange={(evento) => cambiarTexto('email')(evento.target.value)}
          autoComplete="off"
        />
        <BotonDeDireccion
          direccion={borrador.direccionDetalle}
          alCambiar={(direccionDetalle) => setBorrador((previo) => conDireccion(previo, direccionDetalle))}
          localidadesConocidas={localidades}
        />
        <Campo
          etiqueta="Sucursal"
          value={borrador.sucursal}
          onChange={(evento) => cambiarTexto('sucursal')(evento.target.value)}
          list={LISTA_SUCURSALES}
          autoComplete="off"
        />
        <CampoDeNacimiento valor={borrador.fechaNacimiento} alCambiar={cambiarTexto('fechaNacimiento')} />
      </div>

      {/* Las fichas viejas sólo tienen el renglón libre que vino de la hoja: se muestra tal cual hasta
          que alguien cargue la dirección en partes, y ahí este cartel desaparece solo. */}
      {direccionEstaVacia(borrador.direccionDetalle) && (borrador.direccion || borrador.localidad) && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Dirección cargada de la hoja: <span className="font-medium text-slate-800">{[borrador.direccion, borrador.localidad].filter(Boolean).join(', ')}</span>.
          Cargala con el botón de arriba para dejarla en partes.
        </p>
      )}

      <datalist id={LISTA_SUCURSALES}>
        {sucursales.map((sucursal) => (
          <option key={sucursal.id} value={sucursal.nombre} />
        ))}
      </datalist>

      {error && (
        <div className="mt-4">
          <Alerta tono="error">{error}</Alerta>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4">
        <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!hayCambios || !puedeEditar}>
          Guardar cambios
        </Boton>
        <Boton variante="fantasma" onClick={() => setBorrador(datosDe(ficha))} disabled={!hayCambios || guardando}>
          Descartar
        </Boton>
        <span className="text-xs text-slate-500">
          {!puedeEditar ? 'Tenés Clientes en sólo lectura.' : hayCambios ? 'Hay cambios sin guardar.' : 'No hay cambios pendientes.'}
        </span>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Vehículos
// ---------------------------------------------------------------------------

/**
 * Los riesgos del cliente: los vehículos de siempre y, desde que la póliza puede ser de otra cosa,
 * también la casa, el comercio, la bicicleta o las personas cubiertas. Las columnas de auto quedan
 * vacías en una casa; lo que la distingue va en «Detalle», que es lo que arma shared/riesgos.
 */
function PestanaVehiculos({ ficha }: { ficha: FichaCliente }) {
  if (ficha.vehiculos.length === 0) {
    return (
      <Vacio titulo="Este cliente no tiene vehículos ni otros riesgos cargados.">
        Se cargan junto con la póliza: usá «Nueva póliza» y ahí se da de alta el auto con su patente, la casa con su dirección o
        las personas cubiertas por un accidentes personales.
      </Vacio>
    )
  }

  return (
    <Caja>
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className={TH}>Tipo</th>
            <th className={TH}>Patente</th>
            <th className={TH}>Marca</th>
            <th className={TH}>Modelo</th>
            <th className={TH}>Año</th>
            <th className={TH}>Detalle</th>
            <th className={TH}>Motor</th>
            <th className={TH}>Chasis / cuadro</th>
            <th className={cx(TH, 'text-center')}>Pólizas</th>
          </tr>
        </thead>
        <tbody>
          {ficha.vehiculos.map((vehiculo) => (
            <tr key={vehiculo.id} className="border-b border-slate-100 last:border-b-0">
              <td className={TD}>{nombreDeTipoDeRiesgo(vehiculo.tipo) || '—'}</td>
              <td className={cx(TD, 'font-mono text-xs font-semibold text-slate-900')}>{vehiculo.patente ?? '—'}</td>
              <td className={TD}>{vehiculo.marca ?? '—'}</td>
              <td className={TD}>{vehiculo.modelo ?? '—'}</td>
              <td className={cx(TD, 'tabular-nums')}>{vehiculo.anio ?? '—'}</td>
              <td className={TD}>{esVehiculo(vehiculo.tipo) ? '—' : detalleDeRiesgo(vehiculo) || '—'}</td>
              <td className={cx(TD, 'font-mono text-xs')}>{vehiculo.motor ?? '—'}</td>
              <td className={cx(TD, 'font-mono text-xs')}>{vehiculo.chasis ?? '—'}</td>
              <td className={cx(TD, 'text-center tabular-nums')}>{vehiculo.polizas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Caja>
  )
}

// ---------------------------------------------------------------------------
// Pólizas: activas arriba, historial abajo
// ---------------------------------------------------------------------------

function PestanaPolizas({ ficha, hoy, alAbrirPoliza }: { ficha: FichaCliente; hoy: string; alAbrirPoliza: (polizaId: number) => void }) {
  const activas = ficha.polizas.filter((poliza) => poliza.estado !== 'BAJA')
  const historico = ficha.polizas.filter((poliza) => poliza.estado === 'BAJA')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Rotulo texto="Activas" cantidad={activas.length} />
        {activas.length === 0 ? (
          <Vacio titulo="No tiene ninguna póliza vigente.">
            Puede ser un cliente que se dio de baja o uno recién dado de alta. Con «Nueva póliza» se le carga la primera.
          </Vacio>
        ) : (
          <Caja>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className={TH}>Estado</th>
                  <th className={TH}>Compañía</th>
                  <th className={TH}>Póliza</th>
                  <th className={TH}>Cobertura</th>
                  <th className={TH}>Vehículo</th>
                  <th className={TH}>Cuota</th>
                  <th className={TH}>Vigencia</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {activas.map((poliza) => (
                  <FilaDePoliza key={poliza.id} poliza={poliza} hoy={hoy} alAbrir={alAbrirPoliza} />
                ))}
              </tbody>
            </table>
          </Caja>
        )}
      </div>

      <div>
        <Rotulo texto="Histórico" cantidad={historico.length} />
        {historico.length === 0 ? (
          <Vacio titulo="No hay pólizas dadas de baja.">Cuando se dé de baja alguna, acá va a quedar con el motivo y la fecha.</Vacio>
        ) : (
          <Caja>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className={TH}>Estado</th>
                  <th className={TH}>Compañía</th>
                  <th className={TH}>Póliza</th>
                  <th className={TH}>Vehículo</th>
                  <th className={TH}>Vigencia</th>
                  <th className={TH}>Motivo de la baja</th>
                  <th className={TH}>Fecha de baja</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {historico.map((poliza) => (
                  <tr
                    key={poliza.id}
                    onClick={() => alAbrirPoliza(poliza.id)}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                  >
                    <td className={TD}>
                      <Etiqueta tono="neutro">{NOMBRE_ESTADO_POLIZA.BAJA}</Etiqueta>
                    </td>
                    <td className={cx(TD, 'font-medium text-slate-900')}>{poliza.compania ?? '—'}</td>
                    <td className={cx(TD, 'font-mono text-xs')}>{poliza.numero ?? '—'}</td>
                    <td className={TD}>
                      {poliza.vehiculo ?? '—'}
                      {poliza.patente && <span className="ml-1 font-mono text-xs text-slate-500">{poliza.patente}</span>}
                    </td>
                    <td className={cx(TD, 'whitespace-nowrap tabular-nums')}>{rangoDeVigencia(poliza)}</td>
                    <td className={TD}>{poliza.motivoBaja ?? <span className="text-slate-400">sin motivo cargado</span>}</td>
                    <td className={cx(TD, 'whitespace-nowrap tabular-nums')}>{poliza.fechaBaja ?? '—'}</td>
                    <td className={cx(TD, 'text-right')}>
                      <BotonAbrir onClick={() => alAbrirPoliza(poliza.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Caja>
        )}
      </div>
    </div>
  )
}

function FilaDePoliza({ poliza, hoy, alAbrir }: { poliza: PolizaDeCliente; hoy: string; alAbrir: (polizaId: number) => void }) {
  // Se recalcula el estado acá en vez de confiar en el que vino: es la misma regla de shared que usan
  // la bandeja de renovaciones y el listado de pólizas, y así una ficha abierta desde ayer no muestra
  // como vigente algo que venció anoche.
  const estado = estadoDePoliza(poliza.estado !== 'BAJA', poliza.vigenciaHastaIso, hoy)
  const dias = diasParaVencer(poliza.vigenciaHastaIso, hoy)

  return (
    <tr onClick={() => alAbrir(poliza.id)} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
      <td className={TD}>
        <Etiqueta tono={estado === 'ACTIVA' ? 'exito' : estado === 'VENCIDA' ? 'aviso' : 'neutro'}>{NOMBRE_ESTADO_POLIZA[estado]}</Etiqueta>
      </td>
      <td className={cx(TD, 'font-medium text-slate-900')}>{poliza.compania ?? '—'}</td>
      <td className={cx(TD, 'font-mono text-xs')}>{poliza.numero ?? '—'}</td>
      <td className={TD}>{poliza.cobertura ?? '—'}</td>
      <td className={TD}>
        {poliza.vehiculo ?? '—'}
        {poliza.patente && <span className="ml-1 font-mono text-xs text-slate-500">{poliza.patente}</span>}
      </td>
      <td className={cx(TD, 'tabular-nums')}>
        {poliza.cuota ?? '—'}
        {poliza.formaPago && <span className="ml-1 text-xs text-slate-500">{poliza.formaPago}</span>}
      </td>
      <td className={cx(TD, 'whitespace-nowrap tabular-nums')}>
        {rangoDeVigencia(poliza)}
        {dias !== null && (
          <span className={cx('ml-2 text-xs', dias < 0 ? 'font-semibold text-amber-700' : dias <= 60 ? 'font-semibold text-marino-700' : 'text-slate-500')}>
            {dias < 0 ? `venció hace ${-dias} d` : dias === 0 ? 'vence hoy' : `en ${dias} d`}
          </span>
        )}
      </td>
      <td className={cx(TD, 'text-right')}>
        <BotonAbrir onClick={() => alAbrir(poliza.id)} />
      </td>
    </tr>
  )
}

/** Las dos fechas tal cual vinieron de la hoja, sin tocarlas. */
function rangoDeVigencia(poliza: PolizaDeCliente): string {
  if (!poliza.vigenciaDesde && !poliza.vigenciaHasta) return '—'
  return `${poliza.vigenciaDesde ?? '?'} → ${poliza.vigenciaHasta ?? '?'}`
}

// ---------------------------------------------------------------------------
// Pagos y siniestros
// ---------------------------------------------------------------------------

function PestanaPagos({ ficha }: { ficha: FichaCliente }) {
  if (ficha.pagos.length === 0) {
    return (
      <Vacio titulo="Todavía no hay pagos registrados de este cliente.">
        Los pagos se cargan desde la Planilla del mes, sobre la cuota que se está cobrando; también aparecen acá los que vinieron imputados en la hoja.
      </Vacio>
    )
  }

  return (
    <Caja>
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className={TH}>Fecha</th>
            <th className={TH}>Importe</th>
            <th className={TH}>Medio</th>
            <th className={TH}>Compañía</th>
            <th className={TH}>Póliza</th>
            <th className={TH}>Período</th>
          </tr>
        </thead>
        <tbody>
          {ficha.pagos.map((pago) => (
            <tr key={pago.id} className="border-b border-slate-100 last:border-b-0">
              <td className={cx(TD, 'whitespace-nowrap tabular-nums')}>{pago.fecha ?? '—'}</td>
              <td className={cx(TD, 'font-semibold tabular-nums text-slate-900')}>{pago.importe ?? '—'}</td>
              <td className={TD}>{pago.medio ?? '—'}</td>
              <td className={TD}>{pago.compania ?? '—'}</td>
              <td className={cx(TD, 'font-mono text-xs')}>{pago.numeroPoliza ?? '—'}</td>
              <td className={cx(TD, 'tabular-nums')}>{pago.periodo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Caja>
  )
}

function PestanaSiniestros({ ficha, alAbrirSiniestro }: { ficha: FichaCliente; alAbrirSiniestro: (siniestroId: number) => void }) {
  if (ficha.siniestros.length === 0) {
    return (
      <Vacio titulo="Este cliente no tiene siniestros cargados.">
        Se ven los que vinieron de la hoja y los que se carguen desde acá. El seguimiento completo —estado, observaciones, documentos y
        tareas— está en el módulo Siniestros.
      </Vacio>
    )
  }

  return (
    <Caja>
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className={TH}>Fecha</th>
            <th className={TH}>N° siniestro</th>
            <th className={TH}>Compañía</th>
            <th className={TH}>Póliza</th>
            <th className={TH}>Patente</th>
            <th className={TH}>Estado</th>
            <th className={TH}>Importe</th>
            <th className={TH}>Descripción</th>
            <th className={TH} aria-label="Abrir la ficha" />
          </tr>
        </thead>
        <tbody>
          {ficha.siniestros.map((siniestro) => (
            <tr
              key={siniestro.id}
              onClick={() => alAbrirSiniestro(siniestro.id)}
              className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
            >
              <td className={cx(TD, 'whitespace-nowrap tabular-nums')}>{siniestro.fecha ?? '—'}</td>
              <td className={cx(TD, 'font-mono text-xs')}>{siniestro.numeroSiniestro ?? '—'}</td>
              <td className={TD}>{siniestro.compania ?? '—'}</td>
              <td className={cx(TD, 'font-mono text-xs')}>{siniestro.numeroPoliza ?? '—'}</td>
              <td className={cx(TD, 'font-mono text-xs font-semibold')}>{siniestro.patente ?? '—'}</td>
              <td className={TD}>{siniestro.estado ?? '—'}</td>
              <td className={cx(TD, 'tabular-nums')}>{siniestro.importe ?? '—'}</td>
              <td className={cx(TD, 'min-w-64 text-slate-600')}>{siniestro.descripcion ?? '—'}</td>
              <td className={TD}>
                <BotonAbrir onClick={() => alAbrirSiniestro(siniestro.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Caja>
  )
}

// ---------------------------------------------------------------------------
// Notas y tareas
// ---------------------------------------------------------------------------

function PestanaNotas({
  ficha,
  alCambiar,
  alNuevaTarea,
}: {
  ficha: FichaCliente
  alCambiar: (actualizar: (previa: FichaCliente | null) => FichaCliente | null) => void
  alNuevaTarea: () => void
}) {
  const { puedeEditar } = usePermisos()
  const puedeAnotar = puedeEditar('clientes')
  const puedeTareas = puedeEditar('tareas') || puedeAnotar
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agregar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.clientes.agregarNota(ficha.id, texto.trim())
    setGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    const notas = resultado.datos
    alCambiar((previa) => (previa ? { ...previa, notas } : previa))
    setTexto('')
  }

  const cambiarEstado = async (tareaId: number, estado: EstadoTarea) => {
    setError(null)
    const resultado = await window.dm.clientes.cambiarEstadoDeTarea(tareaId, estado)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    const tareas = resultado.datos
    alCambiar((previa) => (previa ? { ...previa, tareas } : previa))
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Notas */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <Rotulo texto="Notas" cantidad={ficha.notas.length} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-suave">
          <AreaTexto
            etiqueta="Agregar una nota"
            rows={3}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            placeholder="Llamó por el granizo, pidió presupuesto de todo riesgo…"
            ayuda="Queda con tu nombre y la fecha. Las notas no se borran."
          />
          <div className="mt-3 flex justify-end">
            <Boton variante="primario" icono="mas" onClick={() => void agregar()} cargando={guardando} disabled={!texto.trim() || !puedeAnotar}>
              Agregar nota
            </Boton>
          </div>
        </div>

        {error && <Alerta tono="error">{error}</Alerta>}

        {ficha.notas.length === 0 ? (
          <Vacio titulo="No hay notas de este cliente.">Escribí acá lo que conviene que sepa el que atienda la próxima vez.</Vacio>
        ) : (
          <ul className="flex flex-col gap-2">
            {ficha.notas.map((nota) => (
              <li key={nota.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-suave">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{nota.texto}</p>
                <p className="mt-1.5 text-xs text-slate-500">
                  {nota.usuarioNombre} · <span className="tabular-nums">{nota.creadoEn}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tareas */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Rotulo texto="Tareas" cantidad={ficha.tareas.length} />
          {puedeTareas && (
            <Boton tamano="sm" icono="mas" onClick={alNuevaTarea} className="ml-auto">
              Nueva tarea
            </Boton>
          )}
        </div>

        {ficha.tareas.length === 0 ? (
          <Vacio titulo="No hay tareas para este cliente.">
            Sirven para no perder los pendientes: «llamar por la renovación», «pedir la cédula verde», «mandar el presupuesto».
          </Vacio>
        ) : (
          <ul className="flex flex-col gap-2">
            {ficha.tareas.map((tarea) => (
              <li key={tarea.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-suave">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-sm font-semibold text-slate-900', tarea.estado === 'hecha' && 'text-slate-400 line-through')}>{tarea.titulo}</p>
                    {tarea.detalle && <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{tarea.detalle}</p>}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{tarea.responsableNombre ? `Para ${tarea.responsableNombre}` : 'Sin responsable'}</span>
                      {tarea.venceEl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Icono nombre="reloj" tamano={12} />
                            vence {tarea.venceEl}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        la cargó {tarea.creadoPor} el <span className="tabular-nums">{tarea.creadoEn}</span>
                      </span>
                    </p>
                  </div>
                  <select
                    value={tarea.estado}
                    disabled={!puedeTareas}
                    onChange={(evento) => void cambiarEstado(tarea.id, evento.target.value as EstadoTarea)}
                    aria-label={`Estado de la tarea «${tarea.titulo}»`}
                    className={cx(
                      'h-8 shrink-0 rounded-lg border px-2 text-xs font-semibold disabled:opacity-60',
                      tarea.estado === 'hecha'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : tarea.estado === 'en gestion'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-300 bg-white text-slate-700',
                    )}
                  >
                    {(Object.keys(NOMBRE_ESTADO_TAREA) as EstadoTarea[]).map((estado) => (
                      <option key={estado} value={estado}>
                        {NOMBRE_ESTADO_TAREA[estado]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogo de tarea nueva
// ---------------------------------------------------------------------------

function DialogoNuevaTarea({
  abierto,
  clienteId,
  clienteNombre,
  alCerrar,
  alCrear,
}: {
  abierto: boolean
  clienteId: number
  clienteNombre: string
  alCerrar: () => void
  alCrear: (tareas: FichaCliente['tareas']) => void
}) {
  const usuario = useUsuarioActual()
  const [titulo, setTitulo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [venceEl, setVenceEl] = useState('')
  const [responsableId, setResponsableId] = useState(String(usuario.id))
  const [equipo, setEquipo] = useState<Array<{ id: number; nombre: string }>>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setTitulo('')
    setDetalle('')
    setVenceEl('')
    setResponsableId(String(usuario.id))
    setError(null)
    // El listado de usuarios sólo lo puede pedir el superadministrador. Si no vuelve, no es un error
    // que haya que mostrar: se ofrece asignarla a uno mismo, que es lo que pasa casi siempre.
    void window.dm.usuarios.listar().then((resultado) => {
      setEquipo(resultado.ok ? resultado.datos.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre })) : [])
    })
  }, [abierto, usuario.id])

  if (!abierto) return null

  const responsables = equipo.length > 0 ? equipo : [{ id: usuario.id, nombre: usuario.nombre }]

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const datos: DatosDeTarea = {
      clienteId,
      polizaId: null,
      titulo: titulo.trim(),
      detalle: detalle.trim(),
      responsableId: responsableId ? Number(responsableId) : null,
      venceEl,
    }
    const resultado = await window.dm.clientes.crearTarea(datos)
    setGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    alCrear(resultado.datos)
  }

  return (
    <Dialogo
      abierto
      titulo="Nueva tarea"
      descripcion={`Queda enganchada a la ficha de ${clienteNombre}.`}
      alCerrar={alCerrar}
      ancho="md"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!titulo.trim()}>
            Crear tarea
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Campo
          etiqueta="Qué hay que hacer"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          placeholder="Llamar por la renovación de la Fiat Cronos"
          autoFocus
        />
        <AreaTexto etiqueta="Detalle" rows={3} value={detalle} onChange={(evento) => setDetalle(evento.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            Responsable
            <select
              value={responsableId}
              onChange={(evento) => setResponsableId(evento.target.value)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25"
            >
              <option value="">Sin responsable</option>
              {responsables.map((persona) => (
                <option key={persona.id} value={String(persona.id)}>
                  {persona.nombre}
                  {persona.id === usuario.id ? ' (vos)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Campo etiqueta="Vence el" type="date" value={venceEl} onChange={(evento) => setVenceEl(evento.target.value)} ayuda="Dejalo vacío si no tiene fecha." />
        </div>
        {error && <Alerta tono="error">{error}</Alerta>}
      </div>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

function BotonAbrir({ onClick }: { onClick: () => void }) {
  return (
    <Boton
      tamano="sm"
      variante="fantasma"
      icono="flechaDerecha"
      onClick={(evento) => {
        evento.stopPropagation()
        onClick()
      }}
    >
      Abrir
    </Boton>
  )
}

function Rotulo({ texto, cantidad }: { texto: string; cantidad: number }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-[0.12em] text-slate-500">
      {texto}
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-500">{cantidad}</span>
    </h2>
  )
}

function Caja({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-suave">{children}</div>
}

function Vacio({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-slate-500">{children}</p>
    </div>
  )
}
