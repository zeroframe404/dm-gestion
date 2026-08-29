// Alta y edición de una póliza, todo en una sola vista. El pliego lo pide así a propósito: la póliza
// se carga con el cliente en el teléfono, y un asistente por pasos obliga a ir y volver para corregir
// una patente. Por eso también los desplegables dejan escribir: la hoja es texto libre y la persona
// que carga sabe cuándo la compañía se llama distinto.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  MOTIVOS_DE_BAJA,
  NOMBRE_MOTIVO_BAJA,
  type AvisoDeCobertura,
  type CatalogosDePoliza,
  type DatosDePoliza,
  type FilaCliente,
  type MotivoDeBaja,
  type PolizaDeCliente,
  type VehiculoDeCliente,
} from '../../../shared/tipos'
import { NOMBRE_ESTADO_POLIZA } from '../../../shared/polizas'
import { DialogoRechazo } from '../../componentes/DialogoRechazo'
import { Icono } from '../../componentes/Icono'
import { SelectorDeVehiculo } from '../../componentes/SelectorDeVehiculo'
import { Alerta, AreaTexto, Boton, Campo, Cargando, cx, Dialogo, Etiqueta, Selector } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePermisos, usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

interface Props {
  /** null = alta; un id = edición de esa póliza. */
  polizaId: number | null
  /** Cliente que viene elegido desde otra pantalla (la ficha del cliente), o null. */
  clienteIdInicial: number | null
  alCerrar: () => void
  alGuardar: (poliza: PolizaDeCliente) => void
  /** La baja no devuelve la póliza, así que avisa aparte con el nombre para el mensaje del listado. */
  alDarDeBaja: (clienteNombre: string) => void
}

/** Los campos de texto de la póliza. Van juntos para actualizarlos con una sola función. */
interface CamposPoliza {
  compania: string
  cobertura: string
  formaPago: string
  cuota: string
  diaVencimiento: string
  numero: string
  propuesta: string
  vigenciaDesde: string
  vigenciaHasta: string
  avisarVto: string
  observaciones: string
}

const CAMPOS_VACIOS: CamposPoliza = {
  compania: '',
  cobertura: '',
  formaPago: '',
  cuota: '',
  diaVencimiento: '',
  numero: '',
  propuesta: '',
  vigenciaDesde: '',
  vigenciaHasta: '',
  avisarVto: '',
  observaciones: '',
}

type VehiculoNuevo = NonNullable<DatosDePoliza['vehiculoNuevo']>

const VEHICULO_VACIO: VehiculoNuevo = {
  patente: '',
  marca: '',
  modelo: '',
  linea: '',
  anio: '',
  tipo: '',
  categoria: '',
  catalogoCodigo: '',
  motor: '',
  chasis: '',
  uso: '',
  color: '',
}

/** Lo mínimo del cliente que hace falta mostrar arriba del formulario. */
interface ClienteElegido {
  id: number
  nombre: string
  documento: string | null
  sucursal: string | null
}

export function FormularioPoliza({ polizaId, clienteIdInicial, alCerrar, alGuardar, alDarDeBaja }: Props) {
  const usuario = useUsuarioActual()
  const { ir } = useNavegacion()
  const permisos = usePermisos()
  const puedeEditar = usePuedeEditar('polizas')
  // Avisar un rechazo es tocar la cobranza, no la póliza: alcanza con poder editar Pólizas o Cartera.
  const puedeAvisarRechazo = puedeEditar || permisos.puedeEditar('cartera')
  const puedeConfirmarAvisos = usuario.rol !== 'EMPLEADO'
  const enEdicion = polizaId !== null

  const [catalogos, setCatalogos] = useState<CatalogosDePoliza | null>(null)
  const [poliza, setPoliza] = useState<PolizaDeCliente | null>(null)
  const [campos, setCampos] = useState<CamposPoliza>(CAMPOS_VACIOS)
  const [cliente, setCliente] = useState<ClienteElegido | null>(null)
  const [vehiculos, setVehiculos] = useState<VehiculoDeCliente[]>([])
  const [modoVehiculo, setModoVehiculo] = useState<'existente' | 'nuevo'>('existente')
  const [vehiculoId, setVehiculoId] = useState<number | null>(null)
  const [vehiculoNuevo, setVehiculoNuevo] = useState<VehiculoNuevo>(VEHICULO_VACIO)

  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<FilaCliente[]>([])
  const [buscando, setBuscando] = useState(false)

  const [avisoCobertura, setAvisoCobertura] = useState<AvisoDeCobertura | null>(null)
  const [confirmado, setConfirmado] = useState(false)

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [bajaAbierta, setBajaAbierta] = useState(false)
  const [rechazoAbierto, setRechazoAbierto] = useState(false)

  const idCompanias = useId()
  const idCoberturas = useId()
  const idFormasDePago = useId()
  const idAvisarVto = useId()
  const cima = useRef<HTMLDivElement | null>(null)

  const cambiar = useCallback((parte: Partial<CamposPoliza>) => setCampos((previos) => ({ ...previos, ...parte })), [])
  const cambiarVehiculo = useCallback((parte: Partial<VehiculoNuevo>) => setVehiculoNuevo((previo) => ({ ...previo, ...parte })), [])

  // --- Carga inicial --------------------------------------------------------

  useEffect(() => {
    let vigente = true
    const preparar = async () => {
      const catalogo = await window.dm.polizas.catalogos()
      if (!vigente) return
      if (catalogo.ok) setCatalogos(catalogo.datos)
      else setError(catalogo.error)

      if (polizaId !== null) {
        const resultado = await window.dm.polizas.ver(polizaId)
        if (!vigente) return
        if (resultado.ok) {
          const existente = resultado.datos
          setPoliza(existente)
          setCampos({
            compania: existente.compania ?? '',
            cobertura: existente.cobertura ?? '',
            formaPago: existente.formaPago ?? '',
            cuota: existente.cuota ?? '',
            diaVencimiento: existente.diaVencimiento ?? '',
            numero: existente.numero ?? '',
            propuesta: existente.propuesta ?? '',
            vigenciaDesde: existente.vigenciaDesde ?? '',
            vigenciaHasta: existente.vigenciaHasta ?? '',
            avisarVto: existente.avisarVto ?? '',
            observaciones: existente.observaciones ?? '',
          })
          // En edición el cliente viene fijo: cambiarlo sería mover la póliza de titular, y eso se
          // hace dando de baja y cargando una nueva.
          setCliente({ id: existente.clienteId, nombre: existente.clienteNombre ?? 'Cliente sin nombre', documento: null, sucursal: existente.sucursal })
          setVehiculoId(existente.vehiculoId)
        } else {
          setError(resultado.error)
        }
      } else if (clienteIdInicial !== null) {
        // Se pide la ficha sólo para mostrar el nombre y el documento: abrir el formulario con un
        // número de cliente pelado no le sirve a nadie.
        const resultado = await window.dm.clientes.ficha(clienteIdInicial)
        if (!vigente) return
        if (resultado.ok) {
          const ficha = resultado.datos
          setCliente({ id: ficha.id, nombre: ficha.nombre, documento: ficha.documento, sucursal: ficha.sucursal })
        } else {
          setError(resultado.error)
        }
      }
      if (vigente) setCargando(false)
    }
    void preparar()
    return () => {
      vigente = false
    }
  }, [polizaId, clienteIdInicial])

  // Los vehículos son del cliente: cambian cada vez que cambia el cliente elegido.
  useEffect(() => {
    if (!cliente) {
      setVehiculos([])
      return
    }
    let vigente = true
    void window.dm.polizas.vehiculosDeCliente(cliente.id).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) {
        setVehiculos(resultado.datos)
        // Sin vehículos cargados no hay nada que elegir: en un alta se pasa solo a «cargar uno nuevo».
        // En una edición no se toca el modo, porque la póliza puede tener un vehículo que la lista no
        // devuelve (pasa con lo importado) y cambiarlo solo se lo borraría al guardar.
        if (resultado.datos.length === 0 && polizaId === null) setModoVehiculo('nuevo')
      } else {
        setError(resultado.error)
      }
    })
    return () => {
      vigente = false
    }
  }, [cliente, polizaId])

  // --- Buscador de cliente --------------------------------------------------

  useEffect(() => {
    if (cliente) return
    const texto = busqueda.trim()
    if (texto.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    let vigente = true
    setBuscando(true)
    const temporizador = setTimeout(() => {
      void window.dm.clientes.buscar(texto).then((resultado) => {
        if (!vigente) return
        setBuscando(false)
        if (resultado.ok) setResultados(resultado.datos)
        else {
          setResultados([])
          setError(resultado.error)
        }
      })
    }, 250)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [busqueda, cliente])

  const elegirCliente = (fila: FilaCliente) => {
    setCliente({ id: fila.id, nombre: fila.nombre, documento: fila.documento, sucursal: fila.sucursal })
    setBusqueda('')
    setResultados([])
    setVehiculoId(null)
    setModoVehiculo('existente')
  }

  // --- Validación de antigüedad, en vivo ------------------------------------

  const vehiculoElegido = vehiculos.find((candidato) => candidato.id === vehiculoId) ?? null
  const anioVehiculo = modoVehiculo === 'nuevo' ? vehiculoNuevo.anio : (vehiculoElegido?.anio ?? '')

  useEffect(() => {
    const compania = campos.compania.trim()
    const cobertura = campos.cobertura.trim()
    const anio = anioVehiculo.trim()
    if (!compania || !cobertura || !anio) {
      setAvisoCobertura(null)
      return
    }
    let vigente = true
    // Con retardo: si no, se consulta la matriz con «SANCOR CO» a medio escribir.
    const temporizador = setTimeout(() => {
      void window.dm.polizas.validarCobertura(compania, cobertura, anio).then((resultado) => {
        if (!vigente) return
        // Si la matriz no se puede consultar no se inventa una advertencia: el aviso es una ayuda,
        // no un permiso. El proceso principal vuelve a validar al guardar.
        setAvisoCobertura(resultado.ok ? resultado.datos : null)
      })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [campos.compania, campos.cobertura, anioVehiculo])

  // Si cambia lo que dice el aviso, la confirmación anterior ya no vale: se confirmó otra cosa.
  useEffect(() => {
    setConfirmado(false)
  }, [avisoCobertura?.mensaje])

  useEffect(() => {
    if (error) cima.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  // --- Guardar --------------------------------------------------------------

  const hayProblema = avisoCobertura?.hayProblema === true
  const bloqueadoPorAviso = hayProblema && !confirmado

  const guardar = async () => {
    if (!cliente) {
      setError('Elegí primero el cliente al que le vas a cargar la póliza.')
      return
    }
    setGuardando(true)
    setError(null)
    const datos: DatosDePoliza = {
      clienteId: cliente.id,
      vehiculoId: modoVehiculo === 'existente' ? vehiculoId : null,
      vehiculoNuevo: modoVehiculo === 'nuevo' ? vehiculoNuevo : null,
      ...campos,
      // Sólo se manda confirmado si hay algo que confirmar: si el aviso desapareció al corregir el
      // año, el permiso del administrador no tiene que viajar igual.
      confirmadoPeseAlAviso: hayProblema && confirmado,
    }
    const resultado = polizaId === null ? await window.dm.polizas.crear(datos) : await window.dm.polizas.editar(polizaId, datos)
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos)
    else setError(resultado.error)
  }

  if (cargando) return <Cargando texto={enEdicion ? 'Abriendo la póliza…' : 'Preparando el formulario…'} />

  const sinVehiculos = vehiculos.length === 0

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* La barra queda pegada arriba: el formulario es largo y «Guardar» tiene que estar siempre a mano. */}
      <div
        ref={cima}
        className="sticky top-0 z-10 -mx-6 -mt-6 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-6 py-3 backdrop-blur"
      >
        <Boton icono="flechaIzquierda" onClick={alCerrar} disabled={guardando}>
          Volver
        </Boton>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold tracking-tight text-slate-900">
            {enEdicion ? 'Editar póliza' : 'Nueva póliza'}
          </h2>
          <p className="truncate text-xs text-slate-500">
            {enEdicion
              ? [poliza?.compania, poliza?.numero && `N.° ${poliza.numero}`, poliza?.patente].filter(Boolean).join(' · ') ||
                'Sin datos cargados todavía'
              : 'Elegí el cliente, el vehículo y los datos de la póliza. Se guarda todo junto.'}
          </p>
        </div>
        {poliza && (
          <Etiqueta tono={poliza.estado === 'ACTIVA' ? 'exito' : poliza.estado === 'VENCIDA' ? 'aviso' : 'neutro'}>
            {NOMBRE_ESTADO_POLIZA[poliza.estado]}
          </Etiqueta>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Avisar un rechazo también sirve en una póliza dada de baja: al que anularon por falta de
              pago igual hay que llamarlo, y muchas veces la baja es justamente la consecuencia. */}
          {enEdicion && (
            <Boton icono="alerta" onClick={() => setRechazoAbierto(true)} disabled={guardando || !puedeAvisarRechazo}>
              Avisar rechazo del débito
            </Boton>
          )}
          {enEdicion && poliza?.estado !== 'BAJA' && (
            <Boton variante="peligro" icono="cerrar" onClick={() => setBajaAbierta(true)} disabled={guardando || !puedeEditar}>
              Dar de baja
            </Boton>
          )}
          <Boton
            variante="primario"
            icono="ok"
            onClick={() => void guardar()}
            cargando={guardando}
            disabled={bloqueadoPorAviso || !puedeEditar}
            title={
              !puedeEditar
                ? 'Tenés Pólizas en sólo lectura.'
                : bloqueadoPorAviso
                  ? puedeConfirmarAvisos
                    ? 'Hay un aviso de antigüedad sin confirmar. Tildá «Continuar igual» o corregí la cobertura.'
                    : 'Hay un aviso de antigüedad: lo tiene que confirmar un administrador.'
                  : undefined
            }
          >
            {enEdicion ? 'Guardar cambios' : 'Guardar póliza'}
          </Boton>
        </div>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {poliza?.estado === 'BAJA' && (
        <Alerta tono="info">
          Esta póliza está dada de baja
          {poliza.fechaBaja ? ` desde el ${poliza.fechaBaja}` : ''}
          {poliza.motivoBaja ? ` (${poliza.motivoBaja})` : ''}. Se puede corregir lo que quedó mal cargado, pero no vuelve a la
          cartera desde acá.
        </Alerta>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* --- Cliente --- */}
          <Grupo titulo="Cliente" icono="clientes">
            {cliente ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-marino-200 bg-marino-50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{cliente.nombre}</p>
                  <p className="truncate text-xs text-slate-600">
                    {[cliente.documento && `DNI/CUIT ${cliente.documento}`, cliente.sucursal].filter(Boolean).join(' · ') ||
                      'Sin documento ni sucursal cargados'}
                  </p>
                </div>
                <Boton tamano="sm" variante="fantasma" icono="enlace" onClick={() => ir('clientes', { clienteId: cliente.id })}>
                  Ver el cliente
                </Boton>
                {!enEdicion && (
                  <Boton
                    tamano="sm"
                    icono="lupa"
                    onClick={() => {
                      setCliente(null)
                      setVehiculoId(null)
                      setVehiculoNuevo(VEHICULO_VACIO)
                    }}
                  >
                    Cambiar
                  </Boton>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Campo
                  etiqueta="Buscá el cliente"
                  value={busqueda}
                  onChange={(evento) => setBusqueda(evento.target.value)}
                  onKeyDown={(evento) => {
                    // Con un solo resultado, Enter lo elige: es el caso normal cuando se busca por DNI.
                    if (evento.key === 'Enter' && resultados.length === 1) {
                      evento.preventDefault()
                      elegirCliente(resultados[0]!)
                    }
                  }}
                  placeholder="Nombre, apellido o DNI/CUIT…"
                  ayuda="Escribí al menos dos letras. Si el cliente todavía no existe, cargalo primero en Clientes."
                  autoFocus={!enEdicion}
                />
                <p className="text-xs text-slate-500" role="status">
                  {buscando
                    ? 'Buscando…'
                    : busqueda.trim().length >= 2
                      ? `${resultados.length} ${resultados.length === 1 ? 'cliente encontrado' : 'clientes encontrados'}`
                      : ''}
                </p>
                {resultados.length > 0 && (
                  <ul className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white">
                    {resultados.map((fila) => (
                      <li key={fila.id} className="border-b border-slate-100 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => elegirCliente(fila)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-marino-50 focus-visible:bg-marino-50 focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">{fila.nombre}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {[fila.documento, fila.sucursal, `${fila.polizasActivas} activas`].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <Icono nombre="flechaDerecha" tamano={14} className="shrink-0 text-slate-400" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Grupo>

          {/* --- Vehículo --- */}
          <Grupo titulo="Vehículo" icono="auto">
            <fieldset className="flex flex-col gap-3" disabled={!cliente}>
              <legend className="sr-only">Vehículo de la póliza</legend>
              <div className="flex flex-wrap gap-2">
                <OpcionRadio
                  nombre="modoVehiculo"
                  elegido={modoVehiculo === 'existente'}
                  alElegir={() => setModoVehiculo('existente')}
                  deshabilitado={sinVehiculos}
                  texto="Uno de los del cliente"
                  detalle={sinVehiculos ? 'no tiene ninguno cargado' : `${vehiculos.length} cargados`}
                />
                <OpcionRadio
                  nombre="modoVehiculo"
                  elegido={modoVehiculo === 'nuevo'}
                  alElegir={() => setModoVehiculo('nuevo')}
                  texto="Cargar uno nuevo"
                />
              </div>

              {modoVehiculo === 'existente' ? (
                <>
                  <Selector
                    etiqueta="Vehículo del cliente"
                    value={vehiculoId === null ? '' : String(vehiculoId)}
                    onChange={(evento) => setVehiculoId(evento.target.value ? Number(evento.target.value) : null)}
                    opciones={[
                      { valor: '', texto: sinVehiculos ? '(el cliente no tiene vehículos)' : '(elegí uno)' },
                      ...vehiculos.map((vehiculo) => ({
                        valor: String(vehiculo.id),
                        texto:
                          [vehiculo.patente, vehiculo.marca, vehiculo.modelo, vehiculo.anio].filter(Boolean).join(' · ') ||
                          `Vehículo ${vehiculo.id}`,
                      })),
                    ]}
                    ayuda="La antigüedad se valida con el año de este vehículo."
                  />
                  {enEdicion && vehiculoId === null && poliza && (poliza.patente || poliza.vehiculo) && (
                    <p className="text-xs text-slate-500">
                      La póliza figura con <strong className="font-semibold">{[poliza.patente, poliza.vehiculo].filter(Boolean).join(' ')}</strong>{' '}
                      pero ese vehículo no quedó asociado al cliente en la importación. Elegilo de la lista o cargalo como nuevo.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Marca, modelo, línea, año y la categoría salen del catálogo. Lo único que se
                      elige a mano es Auto o Moto: la categoría —pick-up, SUV, furgón— la decide el
                      catálogo, porque de ella dependen la prima y qué coberturas se pueden emitir. */}
                  <SelectorDeVehiculo valor={vehiculoNuevo} alCambiar={cambiarVehiculo} />

                  {/* Lo que no está en ningún catálogo: es de este auto en particular y no del modelo. */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Campo etiqueta="Patente" value={vehiculoNuevo.patente} onChange={(e) => cambiarVehiculo({ patente: e.target.value })} className="uppercase" />
                    <Campo etiqueta="Uso" value={vehiculoNuevo.uso} onChange={(e) => cambiarVehiculo({ uso: e.target.value })} />
                    <Campo etiqueta="Color" value={vehiculoNuevo.color} onChange={(e) => cambiarVehiculo({ color: e.target.value })} />
                    <Campo etiqueta="Motor" value={vehiculoNuevo.motor} onChange={(e) => cambiarVehiculo({ motor: e.target.value })} />
                    <Campo etiqueta="Chasis" value={vehiculoNuevo.chasis} onChange={(e) => cambiarVehiculo({ chasis: e.target.value })} />
                  </div>
                </div>
              )}
              {!cliente && <p className="text-xs text-slate-500">Elegí primero el cliente: los vehículos son suyos.</p>}
            </fieldset>
          </Grupo>
        </div>

        <div className="flex flex-col gap-4">
          {/* --- Datos de la póliza --- */}
          <Grupo titulo="Datos de la póliza" icono="polizas">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Campo
                  etiqueta="Compañía"
                  list={idCompanias}
                  value={campos.compania}
                  onChange={(evento) => cambiar({ compania: evento.target.value })}
                  ayuda="Elegí una o escribí otra."
                />
                <Campo
                  etiqueta="Cobertura"
                  list={idCoberturas}
                  value={campos.cobertura}
                  onChange={(evento) => cambiar({ cobertura: evento.target.value })}
                  ayuda="Elegí una o escribí otra."
                />
              </div>

              {/* El aviso de antigüedad va acá, pegado a los campos que lo producen, y aparece mientras
                  se escribe: enterarse al guardar es enterarse tarde. */}
              {avisoCobertura && avisoCobertura.mensaje && (
                <div className="flex flex-col gap-2">
                  <Alerta tono={avisoCobertura.hayProblema ? 'aviso' : 'info'}>
                    <p>{avisoCobertura.mensaje}</p>
                    {avisoCobertura.hayProblema && avisoCobertura.regla?.observaciones && (
                      <p className="mt-1 text-xs opacity-80">{avisoCobertura.regla.observaciones}</p>
                    )}
                  </Alerta>
                  {avisoCobertura.hayProblema &&
                    (puedeConfirmarAvisos ? (
                      <label className="inline-flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
                        <input
                          type="checkbox"
                          checked={confirmado}
                          onChange={(evento) => setConfirmado(evento.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-amber-300"
                        />
                        <span>
                          <strong className="font-semibold">Continuar igual.</strong> Queda registrado que lo confirmaste vos.
                        </span>
                      </label>
                    ) : (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">
                        Esto lo tiene que confirmar un administrador.
                      </p>
                    ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Campo
                  etiqueta="Forma de pago"
                  list={idFormasDePago}
                  value={campos.formaPago}
                  onChange={(evento) => cambiar({ formaPago: evento.target.value })}
                />
                <Campo
                  etiqueta="Cuota"
                  value={campos.cuota}
                  onChange={(evento) => cambiar({ cuota: evento.target.value })}
                  className="tabular-nums"
                  ayuda="Como se escribe en la planilla."
                />
                <Campo
                  etiqueta="Día de vencimiento"
                  value={campos.diaVencimiento}
                  onChange={(evento) => cambiar({ diaVencimiento: evento.target.value })}
                  inputMode="numeric"
                  className="tabular-nums"
                  ayuda="El día del mes, del 1 al 31."
                />
                <Campo etiqueta="N.° de póliza" value={campos.numero} onChange={(evento) => cambiar({ numero: evento.target.value })} />
                <Campo etiqueta="N.° de propuesta" value={campos.propuesta} onChange={(evento) => cambiar({ propuesta: evento.target.value })} />
              </div>

              <datalist id={idCompanias}>
                {(catalogos?.companias ?? []).map((nombre) => (
                  <option key={nombre} value={nombre} />
                ))}
              </datalist>
              <datalist id={idCoberturas}>
                {(catalogos?.coberturas ?? []).map((nombre) => (
                  <option key={nombre} value={nombre} />
                ))}
              </datalist>
              <datalist id={idFormasDePago}>
                {(catalogos?.formasDePago ?? []).map((nombre) => (
                  <option key={nombre} value={nombre} />
                ))}
              </datalist>
            </div>
          </Grupo>

          {/* --- Vigencia y avisos --- */}
          <Grupo titulo="Vigencia y avisos" icono="reloj">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Texto libre a propósito: en la hoja conviven «01/09/2026», «1-9-26» y «SEP 2026», y un
                    selector de fecha obligaría a inventar el día que falta. */}
                <Campo
                  etiqueta="Vigencia desde"
                  value={campos.vigenciaDesde}
                  onChange={(evento) => cambiar({ vigenciaDesde: evento.target.value })}
                  placeholder="DD/MM/AAAA"
                  className="tabular-nums"
                />
                <Campo
                  etiqueta="Vigencia hasta"
                  value={campos.vigenciaHasta}
                  onChange={(evento) => cambiar({ vigenciaHasta: evento.target.value })}
                  placeholder="DD/MM/AAAA"
                  className="tabular-nums"
                  ayuda="De acá sale el vencimiento y la bandeja de renovaciones."
                />
              </div>
              <Campo
                etiqueta="Avisar vto."
                list={idAvisarVto}
                value={campos.avisarVto}
                onChange={(evento) => cambiar({ avisarVto: evento.target.value })}
                ayuda="Poné AVISAR si esta póliza tiene que salir en los avisos de vencimiento."
              />
              <datalist id={idAvisarVto}>
                <option value="AVISAR" />
              </datalist>
              <AreaTexto
                etiqueta="Observaciones"
                rows={4}
                value={campos.observaciones}
                onChange={(evento) => cambiar({ observaciones: evento.target.value })}
                ayuda="Lo que se escriba acá se lee en la planilla y en la renovación (por ejemplo, «20% aumentar cuando se renueva»)."
              />
            </div>
          </Grupo>
        </div>
      </div>

      {poliza && (
        <DialogoBajaDePoliza
          abierto={bajaAbierta}
          poliza={poliza}
          alCerrar={() => setBajaAbierta(false)}
          alDarDeBaja={alDarDeBaja}
          alFallar={(mensaje) => {
            setBajaAbierta(false)
            setError(mensaje)
          }}
        />
      )}

      <DialogoRechazo
        poliza={
          poliza && rechazoAbierto
            ? {
                polizaId: poliza.id,
                clienteNombre: poliza.clienteNombre,
                compania: poliza.compania,
                numeroPoliza: poliza.numero,
                patente: poliza.patente,
                formaPago: poliza.formaPago,
                sucursal: poliza.sucursal,
              }
            : null
        }
        alCerrar={() => setRechazoAbierto(false)}
        alAvisar={(rechazo) => {
          setRechazoAbierto(false)
          setError(null)
          setAviso(`Se le avisó a ${rechazo.sucursal ?? 'la sucursal'} que a ${rechazo.clienteNombre ?? 'este cliente'} se le rechazó el débito.`)
        }}
        alFallar={(mensaje) => {
          setRechazoAbierto(false)
          setError(mensaje)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/**
 * Agrupador compacto. No se usa `Tarjeta` de ui.tsx porque su encabezado es grande y esta pantalla
 * tiene que entrar entera en una ventana: acá el título es un rótulo, no un titular.
 */
function Grupo({ titulo, icono, children }: { titulo: string; icono: 'clientes' | 'auto' | 'polizas' | 'reloj'; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-slate-500">
        <Icono nombre={icono} tamano={15} />
        <h3 className="text-[11px] font-bold tracking-[0.14em] uppercase">{titulo}</h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Radio con aspecto de botón: se ve cuál está elegido de lejos, que es como se trabaja acá. */
function OpcionRadio({
  nombre,
  elegido,
  alElegir,
  texto,
  detalle,
  deshabilitado,
}: {
  nombre: string
  elegido: boolean
  alElegir: () => void
  texto: string
  detalle?: string
  deshabilitado?: boolean
}) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        elegido ? 'border-marino-400 bg-marino-50 font-semibold text-marino-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        deshabilitado && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="radio"
        name={nombre}
        checked={elegido}
        onChange={alElegir}
        disabled={deshabilitado}
        className="h-4 w-4 border-slate-300"
      />
      {texto}
      {detalle && <span className="text-xs font-normal text-slate-500">({detalle})</span>}
    </label>
  )
}

/** «Dar de baja» desde la póliza: mismo motivo y misma nota que la baja de la planilla del mes. */
function DialogoBajaDePoliza({
  abierto,
  poliza,
  alCerrar,
  alDarDeBaja,
  alFallar,
}: {
  abierto: boolean
  poliza: PolizaDeCliente
  alCerrar: () => void
  alDarDeBaja: (clienteNombre: string) => void
  alFallar: (mensaje: string) => void
}) {
  const [motivo, setMotivo] = useState<MotivoDeBaja>('VENDIO')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  const darDeBaja = async () => {
    setGuardando(true)
    const resultado = await window.dm.polizas.darDeBaja(poliza.id, { motivo, nota })
    setGuardando(false)
    if (resultado.ok) alDarDeBaja(poliza.clienteNombre ?? 'el cliente')
    else alFallar(resultado.error)
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo="Dar de baja la póliza"
      descripcion={[poliza.clienteNombre, poliza.compania, poliza.numero && `N.° ${poliza.numero}`, poliza.patente]
        .filter(Boolean)
        .join(' · ')}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="cerrar" onClick={() => void darDeBaja()} cargando={guardando}>
            Dar de baja
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Selector
          etiqueta="Motivo"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value as MotivoDeBaja)}
          opciones={MOTIVOS_DE_BAJA.map((candidato) => ({ valor: candidato, texto: NOMBRE_MOTIVO_BAJA[candidato] }))}
        />
        <AreaTexto
          etiqueta="Nota"
          rows={3}
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          ayuda="Queda guardada con la baja y en el historial."
        />
        <p className="text-xs text-slate-500">
          La póliza deja de contar en la cartera y pasa a <strong className="font-semibold">Bajas</strong>.
        </p>
      </div>
    </Dialogo>
  )
}
