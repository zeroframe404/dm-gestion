// Alta de un cliente. La regla de oro del pliego vive acá: NUNCA dos personas con el mismo DNI/CUIT.
//
// Por eso el alta no pregunta antes ni intenta adivinar: manda los datos y el proceso principal decide.
// Si el documento ya existe no crea nada y devuelve el cliente que ya estaba; entonces la pantalla
// muestra quién es y ofrece las dos únicas salidas sensatas: abrir esa ficha, o corregir lo cargado.
// No hay tercera opción, y no la tiene que haber: el duplicado es el error que después cuesta días.
//
// «Cargar desde la póliza (PDF)»: además de lo manual, se puede subir el PDF de una póliza de auto; la IA
// lo lee y completa el cliente, el auto y la póliza, y la pantalla pide sólo lo que el PDF no trae y es
// obligatorio (celular, email, forma de pago…). Nada se guarda sin revisión. Con el DNI de un cliente que
// ya existe, en vez de crear se ofrece AGREGARLE la póliza sin tocar sus datos. Lo manual queda igual.
import { useEffect, useMemo, useState } from 'react'
import { DIRECCION_VACIA, direccionTienePartes, type DireccionEstructurada } from '../../../shared/direccion'
import { detectarDocumento } from '../../../shared/documento'
import { FALTANTE, faltantesDelAlta, type PolizaDeAlta, type PolizaLeida, type VehiculoDeAlta } from '../../../shared/lecturaDePoliza'
import type { AvisoDeCobertura, CatalogosDePoliza, DatosDeCliente, FichaCliente, FilaCliente, PatenteDadaDeBaja, Sucursal } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { BotonDeDireccion, CampoDeDocumento, CampoDeNacimiento, conDireccion, recortar, type CampoDeTexto } from './CamposDeCliente'
import { CamposDePolizaLeida } from './CamposDePolizaLeida'
import { CargaDesdePdf, type PdfElegido } from './CargaDesdePdf'
import { TarjetaDeClienteExistente } from './TarjetaDeClienteExistente'

const LISTA_SUCURSALES = 'lista-sucursales-alta'

const DATOS_VACIOS: DatosDeCliente = {
  nombre: '',
  documento: '',
  telefono: '',
  email: '',
  direccion: '',
  localidad: '',
  sucursal: '',
  fechaNacimiento: '',
  profesion: '',
  direccionDetalle: DIRECCION_VACIA,
}

const VEHICULO_VACIO: VehiculoDeAlta = { patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', uso: '', color: '' }
const POLIZA_VACIA: PolizaDeAlta = { compania: '', numero: '', propuesta: '', cobertura: '', vigenciaDesde: '', vigenciaHasta: '', formaPago: '', cuota: '', observaciones: '' }

/** Lo leído pisa lo que esté vacío o distinto; lo que el PDF no trajo no borra lo que ya se había tipeado. */
function conLoLeido(previos: DatosDeCliente, leido: DatosDeCliente): DatosDeCliente {
  const texto = (nuevo: string, viejo: string) => (nuevo.trim() !== '' ? nuevo : viejo)
  const base: DatosDeCliente = {
    ...previos,
    nombre: texto(leido.nombre, previos.nombre),
    documento: texto(leido.documento, previos.documento),
    telefono: texto(leido.telefono, previos.telefono),
    email: texto(leido.email, previos.email),
  }
  return direccionTienePartes(leido.direccionDetalle) ? conDireccion(base, leido.direccionDetalle) : base
}

function recortarTextos<T extends object>(valores: T): T {
  return Object.fromEntries(Object.entries(valores).map(([clave, valor]) => [clave, typeof valor === 'string' ? valor.trim() : valor])) as T
}

interface Props {
  abierto: boolean
  alCerrar: () => void
  /**
   * El cliente se creó (o se le agregó la póliza): la pantalla lo abre. `aviso` es el texto para mostrar
   * cuando el alta ya trae su póliza (desde el PDF); sin él, la pantalla usa el de siempre.
   */
  alCrear: (cliente: FichaCliente, aviso?: string) => void
  /** El documento ya existía y se eligió abrir al que estaba. */
  alAbrirExistente: (clienteId: number) => void
}

export function DialogoNuevoCliente({ abierto, alCerrar, alCrear, alAbrirExistente }: Props) {
  const [datos, setDatos] = useState<DatosDeCliente>(DATOS_VACIOS)
  const [duplicado, setDuplicado] = useState<{ yaExiste: FilaCliente; motivo: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  // Las localidades que ya están cargadas en la agencia: se sugieren para que «Lanús» se escriba una
  // sola forma y no cuatro. No obligan: el campo sigue siendo libre.
  const [localidades, setLocalidades] = useState<string[]>([])

  // --- Carga desde el PDF de la póliza ---
  const puedeEditarClientes = usePuedeEditar('clientes')
  const puedeEditarPolizas = usePuedeEditar('polizas')
  const usuario = useUsuarioActual()
  const puedeConfirmarAvisos = usuario.rol !== 'EMPLEADO'
  /** null = todavía no se sabe si la IA está configurada. */
  const [iaConfigurada, setIaConfigurada] = useState<boolean | null>(null)
  const [catalogos, setCatalogos] = useState<CatalogosDePoliza | null>(null)
  const [lectura, setLectura] = useState<PolizaLeida | null>(null)
  const [pdf, setPdf] = useState<PdfElegido | null>(null)
  const [vehiculo, setVehiculo] = useState<VehiculoDeAlta>(VEHICULO_VACIO)
  const [poliza, setPoliza] = useState<PolizaDeAlta>(POLIZA_VACIA)
  /** El cliente que ya tiene el DNI que está cargado, si lo hay. */
  const [existente, setExistente] = useState<FilaCliente | null>(null)
  /** Se eligió corregir el DNI en vez de agregarle la póliza al cliente que ya estaba. */
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [avisoDeCobertura, setAvisoDeCobertura] = useState<AvisoDeCobertura | null>(null)
  const [confirmaAviso, setConfirmaAviso] = useState(false)
  const [patenteDeBaja, setPatenteDeBaja] = useState<PatenteDadaDeBaja | null>(null)
  const [confirmaPatente, setConfirmaPatente] = useState(false)

  const puedeCargarDesdePdf = puedeEditarClientes && puedeEditarPolizas
  const modoPdf = lectura !== null
  const enModoExistente = modoPdf && existente !== null && !corrigiendo
  const idDelExistente = enModoExistente && existente ? existente.id : null

  useEffect(() => {
    if (!abierto) return
    setDatos(DATOS_VACIOS)
    setDuplicado(null)
    setError(null)
    setLectura(null)
    setPdf(null)
    setVehiculo(VEHICULO_VACIO)
    setPoliza(POLIZA_VACIA)
    setExistente(null)
    setCorrigiendo(false)
    setAvisoDeCobertura(null)
    setConfirmaAviso(false)
    setPatenteDeBaja(null)
    setConfirmaPatente(false)
    void window.dm.sucursales.listar().then((resultado) => {
      if (resultado.ok) setSucursales(resultado.datos)
    })
    void window.dm.clientes.localidades().then((resultado) => {
      if (resultado.ok) setLocalidades(resultado.datos)
    })
    void window.dm.asistente.estado().then((resultado) => setIaConfigurada(resultado.ok && resultado.datos.configurado))
    void window.dm.polizas.catalogos().then((resultado) => {
      if (resultado.ok) setCatalogos(resultado.datos)
    })
  }, [abierto])

  // Con el PDF leído, apenas hay un DNI se mira si ya está cargado: así no se piden teléfono y mail a quien
  // ya los tiene. Es sólo un aviso; el que impide el duplicado, al guardar, sigue siendo el proceso principal.
  useEffect(() => {
    if (!abierto || !modoPdf) return
    if (detectarDocumento(datos.documento).digitos.length < 7) {
      setExistente(null)
      return
    }
    let vigente = true
    const temporizador = setTimeout(() => {
      void window.dm.clientes.porDocumento(datos.documento).then((resultado) => {
        if (vigente && resultado.ok) setExistente(resultado.datos)
      })
    }, 400)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [abierto, modoPdf, datos.documento])

  // El aviso de antigüedad de la cobertura, mientras se completa: enterarse al guardar es enterarse tarde.
  useEffect(() => {
    if (!abierto || !modoPdf) return
    const compania = poliza.compania.trim()
    const cobertura = poliza.cobertura.trim()
    const anio = vehiculo.anio.trim()
    if (!compania || !cobertura || !anio) {
      setAvisoDeCobertura(null)
      return
    }
    let vigente = true
    const temporizador = setTimeout(() => {
      void window.dm.polizas.validarCobertura(compania, cobertura, anio).then((resultado) => {
        // Si la matriz no se puede consultar no se inventa un aviso: el proceso principal revisa al guardar.
        if (vigente) setAvisoDeCobertura(resultado.ok ? resultado.datos : null)
      })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [abierto, modoPdf, poliza.compania, poliza.cobertura, vehiculo.anio])

  const faltan = useMemo(
    () => (modoPdf ? faltantesDelAlta({ clienteExistente: enModoExistente, cliente: datos, vehiculo, poliza }) : []),
    [modoPdf, enModoExistente, datos, vehiculo, poliza],
  )
  const bloqueadoPorAviso = modoPdf && avisoDeCobertura?.hayProblema === true && (!puedeConfirmarAvisos || !confirmaAviso)
  const leidos = useMemo(() => new Set(lectura?.leidos ?? []), [lectura])

  if (!abierto) return null

  const cambiarTexto = (campo: CampoDeTexto) => (valor: string) => {
    if (campo === 'documento') setCorrigiendo(false)
    setDatos((previos) => ({ ...previos, [campo]: valor }))
  }

  const cambiarDireccion = (direccionDetalle: DireccionEstructurada) => setDatos((previos) => conDireccion(previos, direccionDetalle))

  const cambiarVehiculo = (campo: keyof VehiculoDeAlta, valor: string) => {
    setVehiculo((previos) => ({ ...previos, [campo]: valor }))
    if (campo === 'patente') {
      setPatenteDeBaja(null)
      setConfirmaPatente(false)
    }
  }

  const cambiarPoliza = (campo: keyof PolizaDeAlta, valor: string) => setPoliza((previos) => ({ ...previos, [campo]: valor }))

  const alLeer = (leida: PolizaLeida, archivo: PdfElegido) => {
    setLectura(leida)
    setPdf(archivo)
    setDatos((previos) => conLoLeido(previos, leida.cliente))
    setVehiculo(leida.vehiculo)
    setPoliza(leida.poliza)
    setExistente(leida.clienteExistente)
    setCorrigiendo(false)
    setConfirmaAviso(false)
    setPatenteDeBaja(null)
    setConfirmaPatente(false)
    setError(null)
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    // Se recortan los espacios, nada más: el resto lo valida y lo normaliza el proceso principal, que
    // es el que sabe cómo se compara un documento contra los 2.100 que ya están cargados.
    const resultado = await window.dm.clientes.crear(recortar(datos))
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (resultado.datos.creado) {
      alCrear(resultado.datos.cliente)
      return
    }
    setDuplicado({ yaExiste: resultado.datos.yaExiste, motivo: resultado.datos.motivo })
  }

  const guardarConPdf = async () => {
    setGuardando(true)
    setError(null)
    // Una patente de otro cliente que la dio de baja se puede volver a asegurar, pero avisando de quién era.
    // El proceso principal igual lo vuelve a revisar al guardar.
    const patente = vehiculo.patente.trim()
    if (patente && !confirmaPatente) {
      const consulta = await window.dm.polizas.patenteDadaDeBaja(idDelExistente, patente)
      if (consulta.ok && consulta.datos) {
        setGuardando(false)
        setPatenteDeBaja(consulta.datos)
        return
      }
    }
    const resultado = await window.dm.clientes.altaDesdePoliza({
      clienteExistenteId: idDelExistente,
      cliente: recortar(datos),
      vehiculo: recortarTextos(vehiculo),
      poliza: recortarTextos(poliza),
      confirmadoPeseAlAviso: avisoDeCobertura?.hayProblema === true && confirmaAviso,
      confirmadoPatenteDeBaja: confirmaPatente,
      adjunto: pdf,
    })
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (resultado.datos.creado) {
      const { cliente, adjuntoGuardado } = resultado.datos
      let aviso = idDelExistente !== null ? `Se le agregó el auto y la póliza a ${cliente.nombre}.` : `${cliente.nombre} quedó dado de alta con su auto y su póliza.`
      // El alta ya está hecha: si el adjunto falló no se la deshace, pero se avisa para que no pase inadvertido.
      if (pdf && !adjuntoGuardado) aviso += ' No se pudo adjuntar el PDF: subilo desde la póliza.'
      alCrear(cliente, aviso)
      return
    }
    // El DNI apareció entre la lectura y el guardado: no se creó nada, se muestra quién es.
    setDuplicado({ yaExiste: resultado.datos.yaExiste, motivo: resultado.datos.motivo })
  }

  // --- El documento ya existe: no se creó nada ------------------------------
  if (duplicado) {
    const existenteAlGuardar = duplicado.yaExiste
    return (
      <Dialogo
        abierto
        titulo="Ese documento ya está cargado"
        alCerrar={alCerrar}
        ancho="md"
        pie={
          <>
            <Boton onClick={() => setDuplicado(null)}>Volver a editar</Boton>
            <Boton variante="primario" icono="flechaDerecha" onClick={() => alAbrirExistente(existenteAlGuardar.id)}>
              Abrir el cliente existente
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* El motivo viene redactado del proceso principal: se muestra tal cual, sin adornarlo. */}
          <Alerta tono="aviso">{duplicado.motivo}</Alerta>

          <TarjetaDeClienteExistente cliente={existenteAlGuardar} />

          <p className="text-sm leading-relaxed text-slate-600">
            Si es la misma persona, abrí su ficha y cargale ahí la póliza nueva. Si te equivocaste al tipear el documento, volvé a editar: lo que cargaste
            sigue estando.
          </p>
        </div>
      </Dialogo>
    )
  }

  // --- El formulario --------------------------------------------------------
  const marca = (clave: string) => (modoPdf && leidos.has(clave) ? 'Leído del PDF' : undefined)
  const falta = (etiqueta: string) => (modoPdf && faltan.includes(etiqueta) ? 'Falta este dato' : null)
  const titleDelBoton = faltan.length > 0 ? `Falta: ${faltan.join(', ')}.` : bloqueadoPorAviso ? 'Hay un aviso de antigüedad sin confirmar.' : undefined

  const pie = enModoExistente ? (
    <>
      <Boton onClick={alCerrar} disabled={guardando}>
        Cancelar
      </Boton>
      <Boton onClick={() => existente && alAbrirExistente(existente.id)} disabled={guardando}>
        Abrir el cliente existente
      </Boton>
      <Boton
        escribe
        variante="primario"
        icono="ok"
        onClick={() => void guardarConPdf()}
        cargando={guardando}
        disabled={faltan.length > 0 || bloqueadoPorAviso}
        title={titleDelBoton}
      >
        Agregar esta póliza al cliente existente
      </Boton>
    </>
  ) : modoPdf ? (
    <>
      <Boton onClick={alCerrar} disabled={guardando}>
        Cancelar
      </Boton>
      <Boton
        escribe
        variante="primario"
        icono="ok"
        onClick={() => void guardarConPdf()}
        cargando={guardando}
        disabled={faltan.length > 0 || bloqueadoPorAviso}
        title={titleDelBoton}
      >
        Crear cliente y póliza
      </Boton>
    </>
  ) : (
    <>
      <Boton onClick={alCerrar} disabled={guardando}>
        Cancelar
      </Boton>
      <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
        Crear cliente
      </Boton>
    </>
  )

  const camposDePoliza = lectura && (
    <CamposDePolizaLeida
      vehiculo={vehiculo}
      poliza={poliza}
      alCambiarVehiculo={cambiarVehiculo}
      alCambiarPoliza={cambiarPoliza}
      leidos={leidos}
      faltan={faltan}
      catalogos={catalogos}
      avisoDeCobertura={avisoDeCobertura}
      confirmacionDelAviso={{ puedeConfirmar: puedeConfirmarAvisos, confirmado: confirmaAviso, alConfirmar: setConfirmaAviso }}
      patenteDeBaja={patenteDeBaja}
      confirmacionDeLaPatente={{ confirmado: confirmaPatente, alConfirmar: setConfirmaPatente }}
    />
  )

  return (
    <Dialogo
      abierto
      titulo="Nuevo cliente"
      descripcion="El nombre y el documento son los que después se usan para encontrarlo."
      alCerrar={alCerrar}
      ancho="lg"
      pie={pie}
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        {puedeCargarDesdePdf && iaConfigurada === true && <CargaDesdePdf alLeer={alLeer} yaLeido={modoPdf} deshabilitado={guardando} />}
        {puedeCargarDesdePdf && iaConfigurada === false && (
          <p className="text-xs text-slate-500">
            Para cargar un cliente desde el PDF de la póliza, el superadministrador tiene que cargar la clave de Anthropic.
          </p>
        )}
        {lectura?.avisos.map((aviso) => (
          <Alerta key={aviso} tono="aviso">
            {aviso}
          </Alerta>
        ))}
        {/* Lo único que se le pide a la persona: lo que el PDF no trajo y hace falta. Arriba de todo, para que
            se vea sin tener que bajar hasta el campo. */}
        {modoPdf && faltan.length > 0 && <Alerta tono="info">Para crear, falta completar: {faltan.join(', ')}.</Alerta>}

        {enModoExistente && existente && lectura ? (
          // --- Con PDF y el DNI de un cliente que ya está: se le agrega la póliza, sus datos no se tocan ---
          <>
            <TarjetaDeClienteExistente cliente={existente} nombreDelPdf={lectura.cliente.nombre} />
            <Alerta tono="info">Se le van a agregar el auto y la póliza a este cliente. Sus datos no se tocan.</Alerta>
            <button type="button" className="self-start text-sm font-medium text-marino-700 underline" onClick={() => setCorrigiendo(true)}>
              No es esta persona: corregir el DNI
            </button>
            {camposDePoliza}
          </>
        ) : (
          <>
            {modoPdf && existente && corrigiendo && (
              <Alerta tono="aviso">
                <p>
                  Ya hay un cliente con ese documento: <strong className="font-semibold">{existente.nombre}</strong>. Corregí el DNI, o volvé a agregarle la póliza a ese cliente.
                </p>
                <button type="button" className="mt-1 text-sm font-medium underline" onClick={() => setCorrigiendo(false)}>
                  Agregarle la póliza a {existente.nombre}
                </button>
              </Alerta>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                etiqueta="Nombre y apellido"
                value={datos.nombre}
                onChange={(evento) => cambiarTexto('nombre')(evento.target.value)}
                ayuda={marca('cliente.nombre')}
                error={falta(FALTANTE.nombre)}
                autoFocus={!modoPdf}
                autoComplete="off"
              />
              <div>
                <CampoDeDocumento
                  valor={datos.documento}
                  alCambiar={cambiarTexto('documento')}
                  ayudaExtra={`${marca('cliente.documento') ? 'Leído del PDF. ' : ''}Con o sin puntos y guiones. Si ya existe, te lo vamos a decir antes de crear nada.`}
                />
                {falta(FALTANTE.documento) && <p className="mt-1 text-xs text-red-600">{falta(FALTANTE.documento)}</p>}
              </div>
              <Campo
                etiqueta="Celular/WhatsApp"
                value={datos.telefono}
                onChange={(evento) => cambiarTexto('telefono')(evento.target.value)}
                className="tabular-nums"
                ayuda={marca('cliente.telefono') ? 'Leído del PDF' : 'Es el número al que después salen los avisos de vencimiento.'}
                error={falta(FALTANTE.telefono)}
                autoComplete="off"
              />
              <Campo
                etiqueta="Email"
                type="email"
                value={datos.email}
                onChange={(evento) => cambiarTexto('email')(evento.target.value)}
                ayuda={marca('cliente.email')}
                error={falta(FALTANTE.email)}
                autoComplete="off"
              />
              <BotonDeDireccion direccion={datos.direccionDetalle} alCambiar={cambiarDireccion} localidadesConocidas={localidades} />
              <Campo
                etiqueta="Sucursal"
                value={datos.sucursal}
                onChange={(evento) => cambiarTexto('sucursal')(evento.target.value)}
                list={LISTA_SUCURSALES}
                autoComplete="off"
              />
              <CampoDeNacimiento valor={datos.fechaNacimiento} alCambiar={cambiarTexto('fechaNacimiento')} />
              <Campo
                etiqueta="Profesión"
                value={datos.profesion}
                onChange={(evento) => cambiarTexto('profesion')(evento.target.value)}
                ayuda="Para saber qué otro seguro ofrecerle más adelante."
                autoComplete="off"
              />
            </div>

            {camposDePoliza}
          </>
        )}

        <datalist id={LISTA_SUCURSALES}>
          {sucursales.map((sucursal) => (
            <option key={sucursal.id} value={sucursal.nombre} />
          ))}
        </datalist>
      </div>
    </Dialogo>
  )
}
