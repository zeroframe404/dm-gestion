// Registro de los canales IPC. Cada manejador implementa la firma declarada en shared/canales.ts.
// Los errores esperables (ErrorDeNegocio) vuelven como `{ ok: false, error }`; el resto se registra
// en consola y se devuelve un mensaje genérico para no filtrar detalles internos al renderer.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ArgumentosDe, NombreCanal, RespuestaDe } from '../shared/canales'
import { AREA_ELIMINABLE, esTipoEliminable, motivoDeNoPoderEliminar, rolPuedeEliminar } from '../shared/eliminacion'
import { veLosNumerosDeLaAgencia } from '../shared/permisos'
import type { FrescuraDeMetrica, InfoApp, PodioMensual, Resultado, SesionUsuario } from '../shared/tipos'
import { carpetaDatos, rutaBaseDeDatos, rutaConfig } from './rutas'
import { cambiarClave, ingresar, salir } from './servicios/auth'
import { comprobarAcceso, conectarEmisor, estadoDeAcceso, estadoDeUsuarios, subirLocales } from './servicios/baseDeUsuarios'
import {
  bajasDelMes,
  cuotasDelClienteEnElMes,
  darDeBaja,
  deshacerBaja,
  editarCelda,
  idDelAdelantoDeLaCuota,
  idDelPagoDeLaCuota,
  imputarAdelanto,
  marcarAvisado,
  planillaDelMes,
  prepararAviso,
  reactivarBaja,
  registrarPago,
} from './servicios/cartera'
import {
  avisarRechazo,
  avisosDeRechazos,
  cambiarEstadoDeRechazo,
  listarRechazos,
  marcarRechazosVistos,
  resolverRechazoDesdeLaCampana,
} from './servicios/rechazos'
import {
  anularPago,
  avisarMora,
  cambiarResultado,
  cargarMovimientoDeCaja,
  mora,
  numeroDeTicketDelPago,
  planillaDeLaCaja,
  quitarMovimientoDeCaja,
  registrarPagoManual,
  revisarPago,
} from './servicios/cobranzas'
import { cajaConCache, comisionesConCache, imputadosConCache } from './servicios/cobranzasDesdeCache'
import { guardarBinarioComo, guardarComo, guardarEn } from './servicios/exportacion'
import { guardarHtmlComoPdf, imprimirHtmlConDialogo, pdfDelHtml } from './servicios/impresion'
import { leerSnapshotDeMetrica } from './servicios/metricasCache'
import { altasConCache, estadisticasConCache, tableroConCache } from './servicios/metricasDesdeCache'
import {
  areasDelReporte,
  catalogoDeExcel,
  catalogoDeReportes,
  filasDeReporte,
  htmlDelReporte,
  vistaPreviaDeReporte,
  xlsxDePlanillaClasica,
  xlsxDelReporte,
} from './servicios/reportes'
import { borrarPlantilla, crearPlantilla, editarPlantilla, listarPlantillas } from './servicios/plantillas'
import {
  comentarios,
  conversaciones,
  cuotaDeInstagram,
  desvincularDeMeta,
  eliminarComentario,
  elegirPaginaVinculada,
  mensajesDeConversacion,
  mostrarComentario,
  ocultarComentario,
  panelDeRedes,
  publicaciones,
  publicarEnRed,
  responderComentario,
  responderConversacion,
  revisarArchivoParaPublicar,
  vincularConMeta,
} from './servicios/redes'
import { apurarAlCartero } from './mensajeria/cartero'
import {
  abrirConversacionCon,
  avisosDe as avisosDeMensajeria,
  borrarAdjuntoDeMensaje,
  contactosDe as contactosDeMensajeria,
  contenidoDeAdjuntoDeMensaje,
  conversacionesDe as conversacionesDeMensajeria,
  crearGrupoDeMensajes,
  eliminarMensajePropio,
  encolarMensaje,
  estadoDeMensajeria,
  hiloDe as hiloDeMensajes,
  marcarConversacionLeida,
  reaccionarA,
  registroDeMensajes,
  reintentarMensaje,
  rutaDelAdjuntoDeMensaje,
  zumbar,
} from './servicios/mensajeria'
import { avisarDeSegmento, borrarSegmento, guardarSegmento, resultadoDeSegmento } from './servicios/marketing'
import {
  agregarNotaDeLead,
  cambiarEstadoDeLead,
  convertirLeadEnCliente,
  crearLead,
  editarLead,
  fichaDeLead,
  listarLeads,
} from './servicios/leads'
import {
  aceptarPresupuesto,
  crearPresupuesto,
  enviarPresupuesto,
  fichaDePresupuesto,
  guardarPresupuesto,
  listarPresupuestos,
  presupuestoParaImprimir,
  rechazarPresupuesto,
} from './servicios/presupuestos'
import {
  agregarAdjuntosDeTarea,
  agregarArchivosDeTarea,
  agregarComentario,
  avisosDeTareas,
  borrarAdjuntoDeTarea,
  cambiarEstadoDeTareaDelModulo,
  crearTareaCompleta,
  editarTarea,
  fichaDeTarea,
  listarTareas,
  marcarAvisosVistos,
  misTareas,
  rutaDelAdjuntoDeTarea,
} from './servicios/tareas'
import {
  configuracionDeImpresora,
  direccionesDeTicket,
  establecerNumeroDeTicket,
  guardarConfiguracionDeImpresora,
  guardarDireccionesDeTicket,
  imprimirTicketDePago,
  imprimirTicketDePrueba,
  pedidoDeTicket,
} from './servicios/ticket'
import {
  agregarNota,
  buscarClientes,
  cambiarEstadoDeTarea,
  crearCliente,
  crearTarea,
  editarCliente,
  fichaDeCliente,
  listarClientes,
  localidadesConocidas,
} from './servicios/clientes'
import { archivoDeDeudores, buscarDeudores } from './servicios/deudores'
import {
  catalogosDePoliza,
  crearPoliza,
  darDeBajaPoliza,
  editarPoliza,
  listarPolizas,
  polizasDeCliente,
  validarCobertura,
  vehiculosDeCliente,
  verPoliza,
} from './servicios/polizas'
import {
  adjuntosDePoliza,
  agregarAdjuntosDePoliza,
  agregarArchivosDePoliza,
  borrarAdjuntoDePoliza,
  rutaDelAdjuntoDePoliza,
} from './servicios/adjuntosDePoliza'
import {
  adjuntosDePresupuesto,
  agregarAdjuntosDePresupuesto,
  agregarArchivosDePresupuesto,
  borrarAdjuntoDePresupuesto,
  rutaDelAdjuntoDePresupuesto,
} from './servicios/adjuntosDePresupuesto'
import { borrarRegla, crearRegla, editarRegla, matrizDeCobertura, reglasVigentes } from './servicios/reglas'
import {
  borrarClausula,
  borrarGrua,
  borrarOrganizador,
  borrarPrecio,
  consultarAntiguedad,
  guardarClausula,
  guardarGrua,
  guardarOrganizador,
  guardarPrecio,
  listasDeCompanias,
  moverOrganizador,
} from './servicios/referencias'
import { adoptarReferenciasDelVps, estadoCompartidoDeReferencias, publicarReferencias } from './servicios/referenciasCompartidas'
import {
  agregarAdjuntos,
  agregarArchivosDeSiniestro,
  agregarObservacion,
  altaDeSiniestro,
  borrarAdjunto,
  buscarParaSiniestro,
  cambiarEstadoDeSiniestro,
  cambiarEstadoDeTareaDeSiniestro,
  crearSiniestro,
  crearTareaDeSiniestro,
  editarSiniestro,
  elegirCategoria,
  fichaDeSiniestro,
  listarSiniestros,
  rutaDelAdjunto,
} from './servicios/siniestros'
import { crearRiesgo, editarRiesgo, listarRiesgos } from './servicios/riesgos'
import { cambiarResueltoDeAmp, listarAmp } from './servicios/amp'
import {
  actualizarSeguimiento,
  bandejaDeRenovaciones,
  datosSugeridosDeRenovacion,
  noRenueva,
  renovar,
} from './servicios/renovaciones'
import { editarCompania, listarCompanias } from './servicios/companias'
import {
  borrarCredencialesDeVehiculos,
  borrarMeta,
  estadoGoogle,
  estadoMeta,
  guardarCredencialesDeVehiculos,
  guardarGoogle,
  guardarMeta,
} from './servicios/config'
import {
  aniosDeLaLinea,
  estadoDelCatalogo,
  lineasDelCatalogo,
  marcasDelCatalogo,
  modelosDelCatalogo,
  probarProveedorDeVehiculos,
  refrescarCatalogo,
  resolverVehiculoDelCatalogo,
} from './servicios/catalogoVehiculos'
import {
  accesoriosGaleno,
  aniosGaleno,
  bancosGaleno,
  borrarGaleno,
  categoriasIvaGaleno,
  clausulasDeAjusteGaleno,
  codigoPostalGaleno,
  codigosIIBBGaleno,
  condicionesDePagoGaleno,
  cotizarGaleno,
  detalleDeLiquidacionesGaleno,
  detalleDePolizaGaleno,
  emitirConInspeccionGaleno,
  emitirGaleno,
  equipoGncGaleno,
  equiposDeRastreoGaleno,
  estadoGaleno,
  estadosCivilesGaleno,
  formasDePagoGaleno,
  guardarGaleno,
  imprimirGaleno,
  marcasGaleno,
  modelosGaleno,
  modosDeFacturacionGaleno,
  nacionalidadesGaleno,
  planesComercialesGaleno,
  probarGaleno,
  reporteGaleno,
  sexosGaleno,
  subModelosGaleno,
  tarjetasDeCreditoGaleno,
  tiposDeDocumentoGaleno,
  tiposDePersonaGaleno,
  tiposDeUsoGaleno,
} from './servicios/galeno'
import { aseguradorasDelMulticotizador, cotizarEnAseguradora, localidadesDelMulticotizador } from './servicios/multicotizador'
import {
  adoptarVehiculosDelVps,
  borrarMetaDelVps,
  borrarVehiculosDelVps,
  estadoCompartidoDeGoogle,
  estadoCompartidoDeMeta,
  estadoCompartidoDeVehiculos,
  estadoDeGoogleEnLaAgencia,
  publicarSinRomper,
  publicarTicketSinRomper,
  publicarVehiculosEnElVps,
  traerGoogleDelVps,
} from './servicios/ajustesCompartidos'
import { crearRespaldoEnElVps, listarRespaldosDelVps, restaurarRespaldoDelVps } from './servicios/respaldosVps'
import { guardarPlantillaDeAviso, plantillaDeAviso } from './servicios/plantillas'
import { historialDeFila } from './servicios/historial'
import { deshacerEntradaDeHistorial } from './servicios/deshacer'
import {
  arrancarSincronizacion,
  cerrarMesConLaBase,
  detenerSincronizacion,
  estadoDeSincronizacion,
  panelDeSincronizacion,
  respaldarAhora,
  sincronizarAhora,
  volverAIntentar,
} from './servicios/sincronizacion'
import {
  detectarDuplicados,
  fusionarClientes,
  fusionarPolizas,
  sacarBajaRepetida,
  sacarCuotaRepetida,
  vistaPreviaDeSacarBaja,
  vistaPreviaDeSacarCuota,
} from './servicios/duplicados'
import { eliminarRegistro, vistaPreviaDeEliminacion } from './servicios/eliminacion'
import { ErrorDeNegocio, SinConexion } from './servicios/errores'
import { estadoDelMesh } from './servicios/mesh'
import { elegirImagenesDelReporte, enviarReporteDeError, imagenDelPortapapeles } from './servicios/soporte'
import { estadoDeLaBaseVps, migrarAlVps } from './servicios/migracionVps'
import {
  abrirCarpetaInformes,
  cancelarImportacion,
  estadoDelImportador,
  guardarInforme,
  iniciarImportacion,
  vistaPreviaDeHoja,
} from './servicios/importacion'
import {
  conectarAvisoDePermisos,
  exigirEdicion,
  exigirVista,
  guardarPermisos,
  matrizDePermisos,
  misPermisos,
  puedeEditar,
  puedeVer as puedeVerElArea,
} from './servicios/permisos'
import { exigirRol, exigirSesion, sesion } from './servicios/sesion'
import { listarSucursales } from './servicios/sucursales'
import { estadoDeActualizacionesPorSucursal } from './servicios/estadoDeActualizaciones'
import { actualizarAhora, buscarActualizaciones, estadoDeActualizacion, instalarActualizacion, posponerActualizacion } from './servicios/updater'
import { cambiarActivo, crearUsuario, editarUsuario, listarUsuarios, resetearClave } from './servicios/usuarios'
import { enteroPositivo } from './servicios/validacion'
import { emitirATodas } from './servicios/avisos'
import {
  aplicarNovedad as aplicarNovedadDeGaleno,
  bandejaDeGaleno,
  descartarNovedad as descartarNovedadDeGaleno,
  drenarGaleno,
  estadoCompartidoDeGaleno,
  estadoDeGaleno,
  guardarCredencialesDeGaleno,
  probarGalenoNovedades,
  sincronizarGaleno,
} from './servicios/galenoNovedades'
import { perfilesLocales, subirMiPerfil, subirPerfilDe } from './usuarios/perfiles'
import { canal } from './vivo/canal'
import {
  aceptarLlamada,
  colgarLlamada,
  configuracionIce,
  estadoDeLaLlamada,
  invitarALlamar,
  mandarSenalDeLlamada,
  rechazarLlamada,
} from './vivo/llamadas'
import { leerFoco, presenciaActual, reportarFoco } from './vivo/presencia'

type Manejador<C extends NombreCanal> = (...args: ArgumentosDe<C>) => RespuestaDe<C> | Promise<RespuestaDe<C>>

const MENSAJE_ERROR_GENERICO = 'Ocurrió un error inesperado. Revisá el registro de la aplicación.'

function manejar<C extends NombreCanal>(canal: C, manejador: Manejador<C>): void {
  ipcMain.handle(canal, async (_evento, ...args: unknown[]) => {
    try {
      return await manejador(...(args as ArgumentosDe<C>))
    } catch (error) {
      // «Sin conexión» vuelve marcado (14.0). Es un ErrorDeNegocio como cualquier otro —el mensaje se
      // muestra tal cual— pero la pantalla necesita distinguirlo: no es un dato mal cargado que se
      // corrige, es el estado de la computadora, y lo que corresponde es el banner de arriba y volver
      // a intentar cuando vuelva internet, no un cartel rojo al lado de un campo.
      if (error instanceof SinConexion) {
        return { ok: false, error: error.message, codigo: 'sin-conexion' } satisfies Resultado<never>
      }
      if (error instanceof ErrorDeNegocio) {
        return { ok: false, error: error.message } satisfies Resultado<never>
      }
      console.error(`[ipc] Error inesperado en ${canal}:`, error)
      return { ok: false, error: MENSAJE_ERROR_GENERICO } satisfies Resultado<never>
    }
  })
}

function exito<T>(datos: T): Resultado<T> {
  return { ok: true, datos }
}

/**
 * Quién puede abrir la papelera de un registro. Son dos controles y hacen falta los dos:
 *   1. el ROL, que depende del tipo (`rolPuedeEliminar`): el cliente lo borran los tres, el resto sólo
 *      el superadministrador;
 *   2. poder EDITAR el módulo de donde salió (`AREA_ELIMINABLE`), así a quien tiene Clientes en «sólo
 *      ver» tampoco se le abre la papelera de un cliente.
 *
 * El tipo llega del renderer y puede ser cualquier cosa: se valida acá antes de mirarlo, y lo que no
 * sea un tipo conocido se rechaza como el resto de los datos que entran por IPC.
 */
function exigirBorrado(tipoCrudo: unknown): SesionUsuario {
  if (!esTipoEliminable(tipoCrudo)) throw new ErrorDeNegocio('No se sabe qué tipo de registro se quiere borrar.')
  const actor = exigirEdicion(AREA_ELIMINABLE[tipoCrudo])
  if (!rolPuedeEliminar(actor.rol, tipoCrudo)) throw new ErrorDeNegocio(motivoDeNoPoderEliminar(tipoCrudo))
  return actor
}

function ventanaActual(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * El comprobante de un pago recién registrado. Con la impresora en «preguntar» no sale nada todavía:
 * se le manda el cartel a la ventana que cobró y el ticket espera al «sí» (hay compañías que no piden
 * comprobante y el rollo se gasta igual). Si no, se manda a imprimir sin esperarlo: el pago ya está
 * guardado y quien cobra no tiene que quedarse mirando la impresora. Si falla, el motivo queda en
 * Administración → Impresora.
 */
function resolverTicketDelPago(pagoId: number | null): void {
  if (pagoId === null) return
  const ventana = ventanaActual()
  const pedido = ventana ? pedidoDeTicket(pagoId) : null
  if (ventana && pedido) {
    ventana.webContents.send('impresora:preguntar', pedido)
    return
  }
  void imprimirTicketDePago(pagoId).catch((error) => console.error('[ticket] No se pudo imprimir:', error))
}

function infoApp(): InfoApp {
  return {
    nombre: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    plataforma: `${process.platform} ${process.arch}`,
    carpetaDatos: carpetaDatos(),
    rutaBaseDeDatos: rutaBaseDeDatos(),
    rutaConfig: rutaConfig(),
  }
}

export function registrarIpc(): void {
  // Autenticación
  manejar('auth:ingresar', async (datos) => {
    const sesion = await ingresar(datos)
    // Al abrir sesión se enciende la sincronización y se baja lo que haya. No se espera: la pantalla
    // tiene que abrir igual aunque Google esté lento o no haya internet.
    void arrancarSincronizacion().catch((error) => console.error('[sync] No se pudo arrancar:', error))
    // Y se drena la cola de Galeno: lo que el servidor trajo mientras las computadoras estaban
    // apagadas entra a la cartera ahora. Sólo lo que emparejó por documento con un único cliente; el
    // resto espera en Cartera → Galeno a que alguien decida.
    //
    // No se espera, por lo mismo que la sincronización: la pantalla tiene que abrir aunque el VPS
    // esté lento o no haya internet. Y sólo lo intenta quien puede escribir en la cartera, para que a
    // un usuario de sólo lectura no le quede un error en el log cada vez que entra.
    if (puedeEditar(sesion, 'cartera')) {
      void drenarGaleno(sesion).catch((error) => console.error('[galeno] No se pudo drenar la cola:', error))
    }
    return exito(sesion)
  })
  manejar('auth:salir', () => {
    salir()
    detenerSincronizacion()
    return exito(null)
  })
  manejar('auth:sesion', () => exito(sesion()))
  // Los canales que escriben pasan casi todos por `exigirEdicion` (servicios/permisos.ts), y ahí está
  // el candado de «ver sí, tocar no» de la 14.0. Los que siguen son la excepción: escriben, pero se
  // piden por ROL o por VISTA, así que el candado va a mano. Son éstos y nadie más —cambiar la clave,
  // tocar usuarios, guardar la matriz de permisos, los tildes de rechazos y mensajes, adoptar las
  // referencias, sincronizar ahora, el reporte de soporte y los dos «guardar» de los perfiles (14.0)—;
  // lo que sí es de esta computadora (la impresora, la configuración, el catálogo de vehículos, ingresar
  // y salir, las actualizaciones) NUNCA lleva candado: sin internet la app se tiene que poder abrir,
  // leer y actualizar. El foco de la presencia (`vivo:foco`) tampoco: no escribe ningún dato.
  manejar('auth:cambiarClave', async (datos) => {
    const actor = exigirSesion()
    // La clave se guarda en la base de usuarios compartida: sin canal no hay dónde escribirla, y una
    // clave cambiada sólo acá dejaría a la persona afuera de las otras cuatro computadoras.
    canal().exigirConexion()
    return exito(await cambiarClave(datos, actor))
  })
  // Sin sesión a propósito: el Login lo usa para decir si hay internet y quién puede entrar sin ella.
  manejar('auth:estadoDeAcceso', async (comprobar) => exito(comprobar === true ? await comprobarAcceso() : estadoDeAcceso()))

  // El proceso principal avisa cuando cambia el acceso a la base compartida o cierra la sesión por su cuenta.
  conectarEmisor({
    estado: (estado) => emitirATodas('auth:estadoDeAcceso', estado),
    sesionActualizada: (nueva) => emitirATodas('auth:sesionActualizada', nueva),
    sesionCerrada: (motivo) => {
      detenerSincronizacion()
      emitirATodas('auth:sesionCerrada', { motivo })
    },
  })

  // Sucursales
  manejar('sucursales:listar', () => {
    exigirSesion()
    return exito(listarSucursales())
  })

  // Usuarios: sólo SUPER_ADMIN
  manejar('usuarios:listar', () => {
    exigirRol('SUPER_ADMIN')
    return exito(listarUsuarios())
  })
  // Todo lo que toca la base de usuarios va contra GitHub y vale para las cinco computadoras: sin
  // canal no se escribe (14.0). Listar sí, que es mirar.
  manejar('usuarios:crear', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await crearUsuario(datos, actor))
  })
  manejar('usuarios:editar', async (id, datos) => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await editarUsuario(id, datos, actor))
  })
  manejar('usuarios:cambiarActivo', async (id, activo) => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await cambiarActivo(id, activo, actor))
  })
  manejar('usuarios:resetearClave', async (id, claveTemporal) => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await resetearClave(id, claveTemporal, actor))
  })
  manejar('usuarios:estado', async (comprobar) => {
    exigirRol('SUPER_ADMIN')
    return exito(await estadoDeUsuarios(comprobar === true))
  })
  manejar('usuarios:subirLocales', async () => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await subirLocales(actor))
  })

  // Permisos por rol. Qué puede hacer uno mismo lo puede preguntar cualquiera (es lo que el renderer
  // usa para mostrar u ocultar); la matriz entera la mira y la toca sólo el SUPER_ADMIN.
  manejar('permisos:mios', () => exito(misPermisos(exigirSesion())))
  manejar('permisos:matriz', () => exito(matrizDePermisos(exigirRol('SUPER_ADMIN'))))
  manejar('permisos:guardar', async (permisos) => {
    const actor = exigirRol('SUPER_ADMIN')
    canal().exigirConexion()
    return exito(await guardarPermisos(permisos, actor))
  })
  conectarAvisoDePermisos(() => {
    const actual = sesion()
    if (actual) emitirATodas('permisos:cambiaron', misPermisos(actual))
  })

  // Borrado definitivo y puntual. Quién puede borrar qué depende del tipo (ver `exigirBorrado` acá
  // arriba y shared/eliminacion.ts): el CLIENTE lo borran los tres roles desde la 12.5, y todo lo demás
  // sigue siendo del SUPER_ADMIN, sin excepción.
  // Se pide lo mismo para MIRAR lo que se llevaría el borrado: el detalle de un cliente entero
  // (cuántos pagos, cuántos siniestros) no tiene por qué salir de acá para quien no puede borrarlo.
  manejar('eliminacion:vistaPrevia', (tipo, id) => exito(vistaPreviaDeEliminacion(tipo, id, exigirBorrado(tipo))))
  manejar('eliminacion:borrar', (tipo, id) => exito(eliminarRegistro(tipo, id, exigirBorrado(tipo))))

  // Cartera → Duplicados (12.6). Cualquier rol que edite la cartera (o Clientes, para las fichas)
  // puede juntar o sacar lo repetido: la agencia pidió no depender del superadministrador para sacar
  // una ficha cargada dos veces. Lo que acota es el detector: el servicio sólo toca lo que señaló.
  manejar('duplicados:listar', () => {
    exigirVista('cartera', 'clientes')
    return exito(detectarDuplicados())
  })
  manejar('duplicados:fusionarClientes', (sobrevivienteId, duplicadoId) =>
    exito(fusionarClientes(sobrevivienteId, duplicadoId, exigirEdicion('clientes', 'cartera'))),
  )
  // Juntar dos pólizas del mismo auto toca la cartera, no las fichas: lo pide `cartera`. Es lo mismo
  // que ya podía hacer quien saca un renglón repetido, y sobre lo mismo que el detector señaló.
  manejar('duplicados:fusionarPolizas', (sobrevivienteId, duplicadaId) =>
    exito(fusionarPolizas(sobrevivienteId, duplicadaId, exigirEdicion('cartera'))),
  )
  manejar('duplicados:vistaPreviaCuota', (cuotaId) => {
    exigirEdicion('cartera')
    return exito(vistaPreviaDeSacarCuota(cuotaId))
  })
  manejar('duplicados:sacarCuota', (cuotaId) => exito(sacarCuotaRepetida(cuotaId, exigirEdicion('cartera'))))
  manejar('duplicados:vistaPreviaBaja', (bajaId) => {
    exigirEdicion('cartera')
    return exito(vistaPreviaDeSacarBaja(bajaId))
  })
  manejar('duplicados:sacarBaja', (bajaId) => exito(sacarBajaRepetida(bajaId, exigirEdicion('cartera'))))

  // Conexión con Google: la MIRAN SUPER_ADMIN y ADMIN; la CARGA sólo el superadministrador, porque
  // desde la v12.4 lo que se carga acá viaja al resto de las computadoras (la sucursal que no tenía la
  // cuenta no subía los adjuntos de los siniestros y nadie se enteraba hasta que hacían falta).
  manejar('config:estadoGoogle', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito({ ...estadoGoogle(), compartido: await estadoCompartidoDeGoogle() })
  })
  manejar('config:guardarGoogle', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    const estado = guardarGoogle(datos)
    // Lo local ya quedó escrito: que el servidor no conteste no puede devolver un error rojo sobre algo
    // que sí se guardó. El motivo viaja en `compartido.error` y la pantalla lo muestra.
    return exito({ ...estado, compartido: await publicarSinRomper('google', actor.nombre) })
  })
  // Cómo está la conexión con Google en la agencia: lo mira CUALQUIERA que tenga la sesión abierta.
  // Es a propósito distinto de `config:estadoGoogle` de acá arriba: eso lleva el correo de la cuenta y
  // la URL de la hoja y sigue siendo de administradores; esto no lleva ningún dato de la credencial,
  // sólo si está y de cuándo es. Sin ella no suben los respaldos ni los adjuntos de los siniestros, y
  // quien atiende el mostrador tiene que poder ver que falta en vez de enterarse el día que hace falta.
  manejar('config:googleEnLaAgencia', async () => {
    exigirSesion()
    return exito(await estadoDeGoogleEnLaAgencia())
  })
  // Bajarla a mano. También de cualquiera: la adopción del arranque ya la baja sola en las cinco
  // computadoras, y este botón es para no tener que cerrar y volver a abrir el programa.
  manejar('config:traerGoogle', async () => {
    exigirSesion()
    await traerGoogleDelVps()
    return exito(await estadoDeGoogleEnLaAgencia())
  })

  // La base del GENERAL DE CLIENTES en el VPS (v12). El estado lo ven SUPER_ADMIN y ADMIN;
  // la migración inicial —una sola vez, pisa la base del servidor— es del SUPER_ADMIN.
  manejar('vps:estado', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await estadoDeLaBaseVps())
  })
  manejar('vps:migrar', async () => {
    exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    return exito(await migrarAlVps())
  })

  // Importación desde Google Sheets: SUPER_ADMIN y ADMIN
  manejar('importacion:vistaPrevia', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await vistaPreviaDeHoja())
  })
  manejar('importacion:iniciar', () => {
    exigirEdicion('administracion')
    return exito(iniciarImportacion(exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  manejar('importacion:cancelar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    cancelarImportacion()
    return exito(null)
  })
  manejar('importacion:estado', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(estadoDelImportador())
  })
  manejar('importacion:guardarInforme', async (importacionId) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    const ventana = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    return exito(await guardarInforme(enteroPositivo(importacionId, 'La importación'), ventana))
  })
  manejar('importacion:abrirCarpetaInformes', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    abrirCarpetaInformes()
    return exito(null)
  })

  // Cartera: la planilla del mes. La trabaja quien tenga permiso de edición en Cartera; cerrar el mes
  // y deshacer una baja siguen pidiendo además un administrador.
  manejar('cartera:planilla', (periodo) => {
    const actor = exigirVista('cartera')
    return exito(planillaDelMes(periodo, actor))
  })
  manejar('cartera:editarCelda', (filaId, campo, valor) => exito(editarCelda(filaId, campo, valor, exigirEdicion('cartera'))))
  manejar('cartera:prepararAviso', (filaId) => exito(prepararAviso(filaId, exigirEdicion('cartera'))))
  manejar('cartera:marcarAvisado', (filaId) => exito(marcarAvisado(filaId, exigirEdicion('cartera'))))
  // Se cobra desde la planilla, desde la ficha del cliente y desde la caja del día: alcanza con poder
  // editar cualquiera de esos tres módulos.
  manejar('cartera:registrarPago', (filaId, datos) => {
    const fila = registrarPago(filaId, datos, exigirEdicion('cartera', 'clientes', 'cobranzas'))
    // Un IMPUTADO no es plata que entró: no hay comprobante que imprimir todavía. Si sólo se adelantó
    // la cuota que viene, el comprobante es el del adelanto.
    if (datos.estadoCobro !== 'IMPUTADO') {
      resolverTicketDelPago(datos.alcance === 'ADELANTADO' ? idDelAdelantoDeLaCuota(filaId) : idDelPagoDeLaCuota(filaId))
    }
    return exito(fila)
  })
  manejar('cartera:imputarAdelanto', (filaId) => exito(imputarAdelanto(filaId, exigirEdicion('cartera', 'clientes', 'cobranzas'))))
  manejar('cartera:darDeBaja', (filaId, datos) => exito(darDeBaja(filaId, datos, exigirEdicion('cartera'))))
  manejar('cartera:deshacerBaja', (bajaId) => {
    exigirEdicion('cartera')
    return exito(deshacerBaja(enteroPositivo(bajaId, 'La baja'), exigirSesion()))
  })
  // «Poner vigente» devuelve una póliza a la cartera. El único control es el permiso de edición en
  // cartera, igual que darla de baja: cualquier rol con ese permiso puede reactivarla.
  manejar('cartera:reactivarBaja', (bajaId, cambios) => {
    exigirEdicion('cartera')
    return exito(reactivarBaja(enteroPositivo(bajaId, 'La baja'), exigirSesion(), cambios))
  })
  manejar('cartera:bajas', (periodo) => {
    exigirVista('cartera')
    return exito(bajasDelMes(periodo))
  })
  manejar('cartera:cerrarMes', async () => {
    exigirEdicion('cartera')
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    // La base es el árbitro (12.6): se sincroniza, se mira si el mes ya está abierto y se crea la
    // pestaña ANTES de copiar las filas, así dos computadoras no pueden cerrar el mismo mes. Sin
    // conexión no se cierra, y el mensaje lo dice (ver `cerrarMesConLaBase`).
    return exito(await cerrarMesConLaBase(actor))
  })
  manejar('cartera:historialDeFila', (filaId) => {
    exigirVista('cartera')
    return exito(historialDeFila(filaId))
  })
  // El mismo permiso que hace falta para hacer el cambio alcanza para deshacerlo: no es una acción
  // aparte, es la misma edición de celda (o el mismo aviso) yendo para el otro lado.
  manejar('cartera:deshacerHistorial', (entradaId) =>
    exito(deshacerEntradaDeHistorial(enteroPositivo(entradaId, 'La entrada del historial'), exigirEdicion('cartera'))),
  )

  // Avisos de rechazo del débito. Avisar sale de la póliza, así que pide poder editar Pólizas o
  // Cartera; mirarlos y darlos por resueltos lo hace la sucursal, que es la que atiende al cliente:
  // le alcanza con tener a la vista cualquiera de los dos módulos.
  manejar('rechazos:avisar', (polizaId, datos) =>
    exito(avisarRechazo(enteroPositivo(polizaId, 'La póliza'), datos, exigirEdicion('polizas', 'cartera'))),
  )
  manejar('rechazos:listar', (filtros) => {
    exigirVista('cartera', 'polizas')
    return exito(listarRechazos(filtros))
  })
  manejar('rechazos:cambiarEstado', (rechazoId, estado, filtros) =>
    exito(cambiarEstadoDeRechazo(rechazoId, estado, filtros, exigirEdicion('cartera', 'polizas'))),
  )
  manejar('rechazos:avisos', () => {
    exigirVista('cartera', 'polizas')
    return exito(avisosDeRechazos(exigirSesion()))
  })
  // Se pide con VISTA (mirar la campana no es editar pólizas) pero escribe: deja anotado hasta dónde
  // leyó esta persona, y eso sube y vale en las cinco computadoras. Por eso el candado a mano (14.0).
  manejar('rechazos:marcarVistos', () => {
    exigirVista('cartera', 'polizas')
    canal().exigirConexion()
    return exito(marcarRechazosVistos(exigirSesion()))
  })
  manejar('rechazos:resolver', (rechazoId) => exito(resolverRechazoDesdeLaCampana(rechazoId, exigirEdicion('cartera', 'polizas'))))

  // Compañías y sus días de cobertura financiera: SUPER_ADMIN y ADMIN
  // El listado incluye el porcentaje de comisión, que es información de la agencia: no sale de acá
  // para un empleado, aunque la pantalla que lo usa ya sea sólo de administradores.
  // Compañías la MIRA cualquiera con sesión abierta, con el rol que sea y sin permiso sobre
  // Administración: los días de cobertura financiera son los que decidieron el color de la fila que el
  // mostrador tiene delante, y saber si una compañía renueva sola o a mano es la mitad de una llamada.
  // El porcentaje de comisión no viaja a un empleado: eso sí es lo que gana la agencia.
  manejar('companias:listar', () => {
    const actor = exigirSesion()
    return exito(listarCompanias(veLosNumerosDeLaAgencia(actor.rol)))
  })
  // Tocarlas sigue siendo de administradores: cambiar los días de cobertura repinta la planilla de
  // todas las sucursales. Y como repinta la de TODAS, desde la v12.4 el catálogo viaja al servidor
  // apenas se guarda: antes había que cargarlo máquina por máquina y dos sucursales podían ver la
  // misma póliza de dos colores distintos.
  manejar('companias:editar', async (id, datos) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    const compania = editarCompania(id, datos)
    await publicarSinRomper('companias', actor.nombre)
    return exito(compania)
  })

  // Cobranzas: la caja y la mora las trabaja quien tenga el módulo; las comisiones siguen pidiendo
  // administrador, aunque un empleado tenga «editar» en Cobranzas.
  // La caja del día de las OTRAS sucursales sigue siendo de los administradores —es plata que entró en
  // otro mostrador—; un empleado mira la suya (ver `sucursalObligadaDe` en cobranzas.ts).
  // `cajaConCache` sólo pisa los totales de hoy/ayer con el cálculo del servidor cuando lo tiene; la
  // lista de pagos, el arqueo y el resto de días siguen siendo siempre el cálculo local de `cajaDelDia`.
  manejar('cobranzas:caja', (fecha, sucursales) => exito(cajaConCache(fecha, sucursales, exigirVista('cobranzas'))))
  manejar('cobranzas:registrarPagoManual', (datos) => {
    const resultado = registrarPagoManual(datos, exigirEdicion('cobranzas'))
    if (datos.estadoCobro !== 'IMPUTADO') resolverTicketDelPago(resultado.pagoId)
    return exito(resultado.caja)
  })
  manejar('cobranzas:exportarCaja', async (fecha, sucursales) => {
    const archivo = planillaDeLaCaja(fecha, sucursales, exigirVista('cobranzas'))
    return exito(await guardarBinarioComo({ ...archivo, descripcion: 'Planilla de caja' }, ventanaActual()))
  })
  // La caja chica la carga quien pueda editar Cobranzas, y sólo la de su mostrador si es empleado
  // (la sucursal se revisa adentro, en `sucursalParaLaCaja`).
  manejar('cobranzas:guardarMovimientoCaja', (datos) => exito(cargarMovimientoDeCaja(datos, exigirEdicion('cobranzas'))))
  manejar('cobranzas:borrarMovimientoCaja', (movimientoId) => exito(quitarMovimientoDeCaja(movimientoId, exigirEdicion('cobranzas'))))
  manejar('cobranzas:revisarPago', (pagoId, revisado) => exito(revisarPago(pagoId, revisado, exigirEdicion('cobranzas'))))
  manejar('cobranzas:numeroDeTicket', (pagoId, numero) => exito(numeroDeTicketDelPago(pagoId, numero, exigirEdicion('cobranzas'))))
  manejar('cobranzas:anularPago', (pagoId, motivo) => exito(anularPago(pagoId, motivo, exigirEdicion('cobranzas'))))
  manejar('cobranzas:mora', (filtros) => {
    exigirVista('cobranzas')
    return exito(mora(filtros))
  })
  manejar('cobranzas:avisarMora', (filaId) => exito(avisarMora(filaId, exigirEdicion('cobranzas'))))
  // Imputados es una pestaña de Cartera que trabaja sobre los pagos: se pide cualquiera de los dos.
  // La rendición del mes se ve y se rinde ENTERA, con las cuatro sucursales, sea cual sea el rol: la
  // sucursal es un filtro de la pantalla como la compañía. Es a propósito distinto de la caja del día
  // de acá arriba (ver `imputados` en servicios/cobranzas.ts).
  // Lo calcula el servidor (esta migración), una sola vez para toda la agencia, cuando ya tiene un cálculo para
  // el período pedido; si no, `imputadosConCache`/`comisionesConCache` caen al cálculo local de
  // siempre. La lista de pagos de Imputados y `cambiarResultado()` siguen siendo 100% locales — ver la
  // cabecera de servicios/cobranzasDesdeCache.ts.
  manejar('cobranzas:imputados', (periodo, companias, sucursales) => {
    const actor = exigirVista('cartera', 'cobranzas')
    return exito(imputadosConCache(periodo, companias, sucursales, veLosNumerosDeLaAgencia(actor.rol)))
  })
  manejar('cobranzas:cambiarResultado', (pagoId, resultado, companias, sucursales) =>
    exito(cambiarResultado(pagoId, resultado, companias, exigirEdicion('cartera', 'cobranzas'), sucursales)),
  )
  manejar('cobranzas:comisiones', (periodo) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('cobranzas')
    return exito(comisionesConCache(periodo))
  })

  // Ticketeadora térmica: la usa y la configura todo el mostrador. No pide rol ni permiso sobre
  // Administración a propósito: es la impresora que tiene la PC delante, y quien cobra es quien se da
  // cuenta de que hay que cambiarla, apagarla o dejar de gastar papel.
  manejar('impresora:estado', async () => {
    exigirSesion()
    return exito(await configuracionDeImpresora())
  })
  manejar('impresora:guardar', async (datos) => {
    exigirSesion()
    return exito(await guardarConfiguracionDeImpresora(datos))
  })
  manejar('impresora:prueba', async () => {
    const actor = exigirSesion()
    await imprimirTicketDePrueba(actor.sucursal.nombre)
    return exito(null)
  })
  // Las direcciones del encabezado del ticket, una por sucursal.
  // Todo el mundo ve y edita la de la sucursal en la que está asignado y ninguna otra: la impresora
  // que tiene delante imprime esa y nada más, y poder tocar la de Lanús desde Dock Sud sólo sirve para
  // romper el ticket de un mostrador en el que uno no está. Vale igual para un administrador: está
  // asignado a un local como cualquiera. La única excepción es el superadministrador, que es quien
  // ordena el encabezado de toda la agencia y por eso las ve todas. El recorte se hace acá, no en la
  // pantalla.
  const miSucursalSalvoSuperAdmin = (): string | null => {
    const actor = exigirSesion()
    return actor.rol === 'SUPER_ADMIN' ? null : actor.sucursal.nombre
  }
  manejar('impresora:direcciones', () => exito(direccionesDeTicket(miSucursalSalvoSuperAdmin())))
  // Guardar el encabezado lo hace cualquiera (el de SU sucursal) y viaja a todas las computadoras: hasta
  // ahora había que cargar el teléfono de Lanús en cada máquina, y con que una quedara vieja salían
  // comprobantes con un número que ya no atiende nadie.
  manejar('impresora:guardarDirecciones', async (direcciones) => {
    const actor = exigirSesion()
    const propia = miSucursalSalvoSuperAdmin()
    guardarDireccionesDeTicket(direcciones, propia)
    // La publicación mezcla con lo que hay en el servidor y puede traerse el encabezado bueno de las
    // otras sucursales, así que la lista que vuelve a la pantalla se lee DESPUÉS de publicar.
    await publicarTicketSinRomper(actor.nombre, propia)
    return exito(direccionesDeTicket(propia))
  })
  // El «sí» del cartel que pregunta si imprimir: lo toca quien cobró, con los mismos permisos con los
  // que registró el pago. No lanza si la impresora falla: el motivo queda anotado y el pago ya está.
  manejar('impresora:imprimirPago', async (pagoId, copias) => {
    exigirEdicion('cartera', 'clientes', 'cobranzas')
    return exito(await imprimirTicketDePago(enteroPositivo(pagoId, 'El pago'), copias))
  })
  // Corregir el correlativo lo puede hacer cualquiera con sesión, igual que el resto de esta pantalla:
  // es la numeración del papel que tiene esta PC delante.
  manejar('impresora:establecerNumeroDeTicket', async (numero) => {
    exigirSesion()
    return exito(await establecerNumeroDeTicket(enteroPositivo(numero, 'El número de ticket')))
  })

  // Plantilla del aviso por WhatsApp: la lee cualquiera (sale en cada aviso), la edita Administración.
  manejar('config:plantillaAviso', () => {
    exigirSesion()
    return exito({ texto: plantillaDeAviso() })
  })
  manejar('config:guardarPlantillaAviso', async (texto) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    // Viaja con el catálogo de compañías: es el mensaje que la agencia le manda al cliente y no tiene
    // por qué ser distinto según desde qué mostrador se apriete «Avisar».
    const plantilla = guardarPlantillaDeAviso(texto)
    await publicarSinRomper('companias', actor.nombre)
    return exito(plantilla)
  })

  // El canal en vivo con la base de la agencia (14.0). Va sin sesión a propósito, como
  // `auth:estadoDeAcceso`: es la primera pregunta que hace la pantalla al montarse (el banner de
  // arriba de todo) y no dice nada de nadie, sólo si hay con quién hablar. Los cambios posteriores
  // llegan solos por el evento del mismo nombre, que emite `vivo/canal.ts`.
  manejar('conexion:estado', () => exito(canal().estado()))

  // La foto y el color de cada persona (14.0). Listar sale del espejo local, así que contesta igual sin
  // internet: las caras se tienen que seguir viendo («ver sí, tocar no» vale también para ellas).
  manejar('perfiles:listar', () => {
    exigirSesion()
    return exito(perfilesLocales())
  })
  // Mi propio perfil lo cambia cualquiera que tenga sesión: la foto y el color son de la persona, no de
  // un módulo, y no hay ningún área que puedan «editar» o no. El candado de la conexión va a mano por
  // eso mismo: el perfil vive en el servidor y es de las cinco computadoras.
  manejar('perfiles:guardarMio', async (datos) => {
    const actor = exigirSesion()
    canal().exigirConexion()
    return exito(await subirMiPerfil(actor, datos))
  })
  // El de OTRA persona, en cambio, es de administradores: se usa para la foto del que no se la carga y
  // para desempatar dos que quieren el mismo color. El servidor lo vuelve a controlar.
  manejar('perfiles:guardarDe', async (clave, datos) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    canal().exigirConexion()
    return exito(await subirPerfilDe(actor, clave, datos))
  })

  // La presencia (14.0). `vivo:foco` es lo ÚNICO que escribe sin candado de conexión, a propósito: sin
  // canal el frame no sale y no pasa nada —un foco que no llegó no descoloca ningún dato—, mientras que
  // trabar la pantalla por eso apagaría el glow de las otras computadoras cada vez que parpadea el wifi.
  manejar('vivo:foco', (foco) => {
    exigirSesion()
    reportarFoco(leerFoco(foco))
    return exito(null)
  })
  manejar('vivo:presencia', () => {
    exigirSesion()
    return exito(presenciaActual())
  })

  // Las llamadas de voz (14.0). Llamar es escribir en la conversación —queda el renglón de la llamada en
  // el hilo de los dos—, así que va con `exigirEdicion('mensajes')`, igual que el zumbido. Atender,
  // rechazar y colgar NO: si a alguien le cortaron el permiso mientras hablaba, tiene que poder cortar.
  manejar('llamadas:invitar', (conversacionId) => exito(invitarALlamar(exigirEdicion('mensajes'), conversacionId)))
  manejar('llamadas:aceptar', () => {
    exigirSesion()
    return exito(aceptarLlamada())
  })
  manejar('llamadas:rechazar', () => {
    exigirSesion()
    return exito(rechazarLlamada())
  })
  manejar('llamadas:colgar', () => {
    exigirSesion()
    return exito(colgarLlamada())
  })
  // La señalización va y viene decenas de veces por llamada (un candidato ICE por cada camino de red que
  // aparece): no valida nada más que la sesión y descarta lo que no sea de la llamada en curso.
  manejar('llamadas:senal', (llamadaId, senal) => {
    exigirSesion()
    mandarSenalDeLlamada(llamadaId, senal)
    return exito(null)
  })
  manejar('llamadas:ice', () => {
    exigirSesion()
    return exito(configuracionIce())
  })
  manejar('llamadas:estado', () => {
    exigirSesion()
    return exito(estadoDeLaLlamada())
  })

  // Sincronización con la hoja de Google. El estado y el «sincronizar ahora» son de la barra superior
  // y los usa todo el equipo; el panel con el detalle y los reintentos, no.
  manejar('sincronizacion:estado', () => {
    exigirSesion()
    return exito(estadoDeSincronizacion())
  })
  manejar('sincronizacion:panel', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(panelDeSincronizacion())
  })
  manejar('sincronizacion:ahora', async (completa) => {
    exigirSesion()
    // El botón «sincronizar ahora» no tiene nada que hacer con el canal caído: no hay con quién
    // hablar. Decirlo con el mismo cartel que el resto es mejor que un reintento que no puede salir.
    canal().exigirConexion()
    return exito(await sincronizarAhora(completa === true))
  })
  manejar('sincronizacion:reintentar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(volverAIntentar())
  })
  manejar('sincronizacion:respaldarAhora', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await respaldarAhora())
  })

  // Respaldos del GENERAL DE CLIENTES guardados en el servidor.
  //
  // Mirarlos y pedir uno nuevo es de administradores, igual que el resto de Administración. RESTAURAR
  // es del SUPER_ADMIN y de nadie más, con el mismo criterio que el borrado definitivo: rebobinar pisa
  // la base de las CINCO computadoras y descarta todo lo que se cargó desde ese día, así que no es una
  // acción que pueda salir de un botón que alguien tocó sin querer. No es un permiso configurable a
  // propósito: si se pudiera encender desde una pantalla, alcanzaría con distraerse una vez.
  manejar('respaldos:listar', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await listarRespaldosDelVps())
  })
  manejar('respaldos:crear', async () => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await crearRespaldoEnElVps(actor))
  })
  manejar('respaldos:restaurar', async (id) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    return exito(await restaurarRespaldoDelVps(id, actor))
  })

  // Clientes: los trabaja todo el equipo que tenga el módulo. Nada de acá borra en forma definitiva,
  // así que no hace falta pedir rol.
  //
  // El buscador y la ficha se usan también desde Pólizas y Presupuestos (para elegir a quién se le
  // emite): por eso admiten el permiso de cualquiera de esos tres módulos y no sólo el de Clientes.
  manejar('clientes:listar', (filtros) => {
    exigirVista('clientes')
    return exito(listarClientes(filtros))
  })
  // Siniestros no está en la lista aunque también busque gente: tiene su propio buscador acotado
  // (`siniestros:buscar`, que trae sólo a los que tienen póliza y sin datos de deuda).
  manejar('clientes:buscar', (busqueda) => {
    exigirVista('clientes', 'polizas', 'presupuestos', 'cobranzas')
    return exito(buscarClientes(busqueda))
  })
  manejar('clientes:ficha', (clienteId) => {
    exigirVista('clientes', 'polizas', 'presupuestos')
    return exito(fichaDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  // Las localidades ya cargadas: sólo sugerencias para el formulario de dirección. Se pide el mismo
  // permiso que la ficha porque la dirección se carga desde el alta y también desde Pólizas.
  manejar('clientes:localidades', () => {
    exigirVista('clientes', 'polizas', 'presupuestos')
    return exito(localidadesConocidas())
  })
  // El alta de un cliente sale de un solo lado (Clientes → «Nuevo cliente»), así que pide el permiso
  // de Clientes y nada más. Convertir un lead también da de alta un cliente, y por eso el canal
  // `leads:convertir` exige las dos puntas: si acá se aceptara `leads`, ese control no serviría.
  manejar('clientes:crear', (datos) => exito(crearCliente(datos, exigirEdicion('clientes'))))
  manejar('clientes:editar', (clienteId, datos) =>
    exito(editarCliente(enteroPositivo(clienteId, 'El cliente'), datos, exigirEdicion('clientes'))),
  )
  manejar('clientes:agregarNota', (clienteId, textoDeLaNota) =>
    exito(agregarNota(enteroPositivo(clienteId, 'El cliente'), textoDeLaNota, exigirEdicion('clientes'))),
  )
  manejar('clientes:crearTarea', (datos) => exito(crearTarea(datos, exigirEdicion('clientes', 'tareas'))))
  manejar('clientes:cambiarEstadoDeTarea', (tareaId, estado) =>
    exito(cambiarEstadoDeTarea(enteroPositivo(tareaId, 'La tarea'), estado, exigirEdicion('clientes', 'tareas'))),
  )
  manejar('clientes:cuotasDelMes', (clienteId) => {
    exigirVista('clientes', 'cartera', 'cobranzas')
    return exito(cuotasDelClienteEnElMes(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('clientes:deudores', (filtros) => {
    exigirVista('clientes', 'cobranzas')
    return exito(buscarDeudores(filtros))
  })
  // Como en Reportes: la pantalla manda `ruta` en null y el diálogo se abre acá; la prueba de humo
  // manda la ruta, porque un diálogo del sistema no se puede manejar desde afuera.
  manejar('clientes:exportarDeudores', async (filtros, formato, ruta) => {
    exigirVista('clientes', 'cobranzas')
    const archivo = archivoDeDeudores(filtros, formato)
    const destino = typeof ruta === 'string' && ruta.trim() ? ruta.trim() : null
    if (destino) return exito(guardarEn(destino, archivo.contenido))
    if (typeof archivo.contenido === 'string') {
      return exito(await guardarComo({ ...archivo, contenido: archivo.contenido }, ventanaActual()))
    }
    return exito(await guardarBinarioComo({ ...archivo, contenido: archivo.contenido }, ventanaActual(), 'Guardar el listado de deudores'))
  })

  // Siniestros: los trabaja quien tenga el módulo. Borrar un documento sí pide administrador: es definitivo.
  manejar('siniestros:crear', (datos) => exito(crearSiniestro(datos, exigirEdicion('siniestros'))))
  manejar('siniestros:listar', (filtros) => {
    exigirVista('siniestros')
    return exito(listarSiniestros(filtros))
  })
  manejar('siniestros:ficha', (siniestroId) => {
    exigirVista('siniestros')
    return exito(fichaDeSiniestro(enteroPositivo(siniestroId, 'El siniestro')))
  })
  manejar('siniestros:buscar', (busqueda) => {
    exigirVista('siniestros')
    return exito(buscarParaSiniestro(busqueda))
  })
  manejar('siniestros:alta', (datos) => exito(altaDeSiniestro(datos, exigirEdicion('siniestros'))))
  manejar('siniestros:cambiarEstado', (siniestroId, estado) => exito(cambiarEstadoDeSiniestro(siniestroId, estado, exigirEdicion('siniestros'))))
  manejar('siniestros:editar', (siniestroId, campo, valor) => exito(editarSiniestro(siniestroId, campo, valor, exigirEdicion('siniestros'))))
  manejar('siniestros:agregarObservacion', (siniestroId, textoDeLaObservacion) =>
    exito(agregarObservacion(siniestroId, textoDeLaObservacion, exigirEdicion('siniestros'))),
  )
  manejar('siniestros:adjuntar', async (siniestroId, rutas, categoria, detalle) => {
    const actor = exigirEdicion('siniestros')
    const id = enteroPositivo(siniestroId, 'El siniestro')
    // La categoría se valida ANTES de abrir el diálogo: elegir seis fotos y recién ahí enterarse de que
    // faltaba decir qué son sería hacer el trabajo dos veces.
    elegirCategoria(categoria, detalle)
    if (rutas !== null && rutas !== undefined) return exito(await agregarAdjuntos(id, rutas, categoria, detalle, actor))
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí los documentos del siniestro',
      buttonLabel: 'Adjuntar',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Documentos y fotos', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    // Cancelar el diálogo no es un error: se devuelve la ficha como estaba.
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(fichaDeSiniestro(id))
    return exito(await agregarAdjuntos(id, elegido.filePaths, categoria, detalle, actor))
  })
  manejar('siniestros:adjuntarArchivos', async (siniestroId, archivos, categoria, detalle) =>
    exito(await agregarArchivosDeSiniestro(enteroPositivo(siniestroId, 'El siniestro'), archivos, categoria, detalle, exigirEdicion('siniestros'))),
  )
  manejar('siniestros:abrirAdjunto', async (adjuntoId) => {
    exigirVista('siniestros')
    const error = await shell.openPath(await rutaDelAdjunto(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('siniestros:borrarAdjunto', (adjuntoId) => {
    exigirEdicion('siniestros')
    return exito(borrarAdjunto(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  manejar('siniestros:crearTarea', (datos) => exito(crearTareaDeSiniestro(datos, exigirEdicion('siniestros'))))
  manejar('siniestros:cambiarEstadoDeTarea', (tareaId, estado) =>
    exito(cambiarEstadoDeTareaDeSiniestro(tareaId, estado, exigirEdicion('siniestros'))),
  )

  // Riesgos varios, AMP y las reglas de cobertura son pestañas de Cartera: van con ese permiso.
  manejar('riesgos:listar', () => {
    exigirVista('cartera')
    return exito(listarRiesgos())
  })
  manejar('riesgos:editar', (riesgoId, campo, valor) => exito(editarRiesgo(riesgoId, campo, valor, exigirEdicion('cartera'))))
  manejar('riesgos:crear', (datos) => exito(crearRiesgo(datos, exigirEdicion('cartera'))))

  // AMP: las ampliaciones pendientes.
  manejar('amp:listar', (incluirResueltas) => {
    exigirVista('cartera')
    return exito(listarAmp(incluirResueltas))
  })
  manejar('amp:cambiarResuelto', (ampId, resuelto, incluirResueltas) =>
    exito(cambiarResueltoDeAmp(ampId, resuelto, incluirResueltas, exigirEdicion('cartera'))),
  )

  // Pólizas. Las consultas que alimentan otras pantallas (la ficha del cliente, el presupuesto, el
  // formulario de póliza) admiten el permiso de cualquiera de esos módulos.
  manejar('polizas:listar', (filtros) => {
    exigirVista('polizas')
    return exito(listarPolizas(filtros))
  })
  manejar('polizas:ver', (polizaId) => {
    exigirVista('polizas')
    return exito(verPoliza(enteroPositivo(polizaId, 'La póliza')))
  })
  manejar('polizas:deCliente', (clienteId) => {
    exigirVista('polizas', 'clientes', 'renovaciones')
    return exito(polizasDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('polizas:vehiculosDeCliente', (clienteId) => {
    exigirVista('polizas', 'clientes', 'presupuestos')
    return exito(vehiculosDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('polizas:catalogos', () => {
    exigirVista('polizas', 'clientes', 'presupuestos', 'renovaciones')
    return exito(catalogosDePoliza())
  })
  manejar('polizas:validarCobertura', (compania, cobertura, anioVehiculo) => {
    exigirVista('polizas', 'presupuestos', 'renovaciones')
    return exito(validarCobertura(compania, cobertura, anioVehiculo))
  })
  // El servicio es el que decide si hace falta un administrador para saltear la advertencia de
  // cobertura: es una regla de negocio, no un permiso de pantalla.
  manejar('polizas:crear', (datos) => exito(crearPoliza(datos, exigirEdicion('polizas'))))
  manejar('polizas:editar', (polizaId, datos) => exito(editarPoliza(enteroPositivo(polizaId, 'La póliza'), datos, exigirEdicion('polizas'))))
  // Fotos y documentos de la póliza (12.6). Ver los documentos de una póliza es ver la póliza; borrar
  // uno es definitivo y queda para ADMIN y SUPER_ADMIN, como en siniestros y tareas.
  manejar('polizas:adjuntos', (polizaId) => {
    exigirVista('polizas')
    return exito(adjuntosDePoliza(polizaId))
  })
  manejar('polizas:adjuntarArchivos', async (polizaId, archivos) =>
    exito(await agregarArchivosDePoliza(enteroPositivo(polizaId, 'La póliza'), archivos, exigirEdicion('polizas'))),
  )
  manejar('polizas:adjuntar', async (polizaId, rutas) => {
    const actor = exigirEdicion('polizas')
    const id = enteroPositivo(polizaId, 'La póliza')
    if (rutas !== null && rutas !== undefined) return exito(await agregarAdjuntosDePoliza(id, rutas, actor))
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí las fotos y documentos de la póliza',
      buttonLabel: 'Adjuntar',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Fotos y documentos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(adjuntosDePoliza(id))
    return exito(await agregarAdjuntosDePoliza(id, elegido.filePaths, actor))
  })
  manejar('polizas:abrirAdjunto', async (adjuntoId) => {
    exigirVista('polizas')
    const error = await shell.openPath(await rutaDelAdjuntoDePoliza(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('polizas:borrarAdjunto', (adjuntoId) => {
    exigirEdicion('polizas')
    return exito(borrarAdjuntoDePoliza(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  manejar('polizas:darDeBaja', (polizaId, datos) =>
    exito(darDeBajaPoliza(enteroPositivo(polizaId, 'La póliza'), datos, exigirEdicion('polizas'))),
  )

  // Reglas de cobertura: las consulta todo el equipo mientras atiende, las carga el SUPER_ADMIN.
  manejar('reglas:matriz', () => exito(matrizDeCobertura(exigirVista('cartera'))))
  manejar('reglas:vigentes', () => {
    exigirVista('cartera', 'polizas', 'presupuestos', 'renovaciones')
    return exito(reglasVigentes())
  })
  manejar('reglas:crear', (datos) => {
    exigirEdicion('cartera')
    return exito(crearRegla(datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('reglas:editar', (id, datos) => {
    exigirEdicion('cartera')
    return exito(editarRegla(enteroPositivo(id, 'La regla'), datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('reglas:borrar', (id) => {
    exigirEdicion('cartera')
    return exito(borrarRegla(enteroPositivo(id, 'La regla'), exigirRol('SUPER_ADMIN')))
  })

  // Módulo Compañías: las cinco listas de consulta del mostrador. Se miran con el permiso del módulo
  // y se cargan sólo con el del SUPER_ADMIN, igual que la matriz de coberturas: son la referencia
  // contra la que se cotiza, y una lista que cualquiera puede tocar deja de serlo.
  manejar('referencias:listas', () => exito(listasDeCompanias(exigirVista('companias'))))
  manejar('referencias:antiguedad', (anio) => {
    exigirVista('companias')
    return exito(consultarAntiguedad(String(anio ?? '')))
  })
  manejar('referencias:guardarOrganizador', (id, datos) => {
    exigirEdicion('companias')
    return exito(guardarOrganizador(id === null ? null : enteroPositivo(id, 'El organizador'), datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:borrarOrganizador', (id) => {
    exigirEdicion('companias')
    return exito(borrarOrganizador(enteroPositivo(id, 'El organizador'), exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:moverOrganizador', (id, direccion) => {
    exigirEdicion('companias')
    if (direccion !== 'arriba' && direccion !== 'abajo') throw new ErrorDeNegocio('No se entendió hacia dónde mover el organizador.')
    return exito(moverOrganizador(enteroPositivo(id, 'El organizador'), direccion, exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:guardarPrecio', (id, datos) => {
    exigirEdicion('companias')
    return exito(guardarPrecio(id === null ? null : enteroPositivo(id, 'El precio'), datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:borrarPrecio', (id) => {
    exigirEdicion('companias')
    return exito(borrarPrecio(enteroPositivo(id, 'El precio'), exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:guardarGrua', (id, datos) => {
    exigirEdicion('companias')
    return exito(guardarGrua(id === null ? null : enteroPositivo(id, 'La grúa'), datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:borrarGrua', (id) => {
    exigirEdicion('companias')
    return exito(borrarGrua(enteroPositivo(id, 'La grúa'), exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:guardarClausula', (id, datos) => {
    exigirEdicion('companias')
    return exito(guardarClausula(id === null ? null : enteroPositivo(id, 'La cláusula'), datos, exigirRol('SUPER_ADMIN')))
  })
  manejar('referencias:borrarClausula', (id) => {
    exigirEdicion('companias')
    return exito(borrarClausula(enteroPositivo(id, 'La cláusula'), exigirRol('SUPER_ADMIN')))
  })
  // Publicar pisa las listas de las otras cuatro computadoras: es del SUPER_ADMIN, como cargarlas.
  manejar('referencias:estadoCompartido', async () => {
    exigirVista('companias')
    return exito(await estadoCompartidoDeReferencias())
  })
  manejar('referencias:publicar', async () => {
    exigirEdicion('companias')
    const actor = exigirRol('SUPER_ADMIN')
    return exito(await publicarReferencias(actor.nombre))
  })
  manejar('referencias:adoptar', async () => {
    const actor = exigirVista('companias')
    // Se pide con VISTA porque es «traerme lo del servidor», pero pisa las listas locales con lo que
    // baja: sin canal ni siquiera hay de dónde traerlas (14.0).
    canal().exigirConexion()
    // Desde el botón sí se pisa lo local: es alguien eligiendo quedarse con lo del servidor.
    const resultado = await adoptarReferenciasDelVps({ pisarLoLocal: true })
    return exito({ ...resultado, listas: listasDeCompanias(actor) })
  })

  // Renovaciones: la bandeja la trabaja quien tenga el módulo, incluidos los empleados.
  manejar('renovaciones:bandeja', () => {
    exigirVista('renovaciones')
    return exito(bandejaDeRenovaciones())
  })
  manejar('renovaciones:sugerencia', (polizaId) => {
    exigirVista('renovaciones')
    return exito(datosSugeridosDeRenovacion(enteroPositivo(polizaId, 'La póliza')))
  })
  manejar('renovaciones:actualizar', (polizaId, venceEl, datos) =>
    exito(actualizarSeguimiento(enteroPositivo(polizaId, 'La póliza'), venceEl, datos, exigirEdicion('renovaciones'))),
  )
  manejar('renovaciones:renovar', (polizaId, datos) => exito(renovar(enteroPositivo(polizaId, 'La póliza'), datos, exigirEdicion('renovaciones'))))
  manejar('renovaciones:noRenueva', (polizaId, datos) =>
    exito(noRenueva(enteroPositivo(polizaId, 'La póliza'), datos, exigirEdicion('renovaciones'))),
  )

  // Leads: la consulta que todavía no es cliente.
  manejar('leads:listar', (filtros) => {
    exigirVista('leads')
    return exito(listarLeads(filtros))
  })
  manejar('leads:ficha', (leadId) => {
    exigirVista('leads')
    return exito(fichaDeLead(enteroPositivo(leadId, 'La consulta')))
  })
  manejar('leads:crear', (datos) => exito(crearLead(datos, exigirEdicion('leads'))))
  manejar('leads:editar', (leadId, datos) => exito(editarLead(enteroPositivo(leadId, 'La consulta'), datos, exigirEdicion('leads'))))
  manejar('leads:cambiarEstado', (leadId, estado) => exito(cambiarEstadoDeLead(leadId, estado, exigirEdicion('leads'))))
  manejar('leads:agregarNota', (leadId, texto) => exito(agregarNotaDeLead(leadId, texto, exigirEdicion('leads'))))
  // Convertir da de alta un cliente: hace falta poder editar las dos puntas.
  manejar('leads:convertir', (leadId) => {
    exigirEdicion('clientes')
    return exito(convertirLeadEnCliente(leadId, exigirEdicion('leads')))
  })

  // Presupuestos
  manejar('presupuestos:listar', (filtros) => {
    exigirVista('presupuestos')
    return exito(listarPresupuestos(filtros))
  })
  manejar('presupuestos:ficha', (presupuestoId) => {
    exigirVista('presupuestos')
    return exito(fichaDePresupuesto(enteroPositivo(presupuestoId, 'El presupuesto')))
  })
  manejar('presupuestos:crear', (datos) => exito(crearPresupuesto(datos, exigirEdicion('presupuestos'))))
  manejar('presupuestos:guardar', (presupuestoId, datos) =>
    exito(guardarPresupuesto(enteroPositivo(presupuestoId, 'El presupuesto'), datos, exigirEdicion('presupuestos'))),
  )
  manejar('presupuestos:enviar', (presupuestoId) => exito(enviarPresupuesto(presupuestoId, exigirEdicion('presupuestos'))))
  manejar('presupuestos:aceptar', (presupuestoId, opcionId) => exito(aceptarPresupuesto(presupuestoId, opcionId, exigirEdicion('presupuestos'))))
  manejar('presupuestos:rechazar', (presupuestoId, motivo) => exito(rechazarPresupuesto(presupuestoId, motivo, exigirEdicion('presupuestos'))))
  manejar('presupuestos:guardarPdf', async (presupuestoId) => {
    exigirVista('presupuestos')
    const papel = presupuestoParaImprimir(enteroPositivo(presupuestoId, 'El presupuesto'))
    return exito(await guardarHtmlComoPdf(papel.html, papel.nombreDeArchivo, ventanaActual()))
  })
  manejar('presupuestos:imprimir', async (presupuestoId) => {
    exigirVista('presupuestos')
    const papel = presupuestoParaImprimir(enteroPositivo(presupuestoId, 'El presupuesto'))
    return exito(await imprimirHtmlConDialogo(papel.html))
  })
  // Las cotizaciones en PDF que manda cada compañía. Verlas es ver el presupuesto; borrar una queda
  // para ADMIN y SUPER_ADMIN, como en pólizas y siniestros.
  manejar('presupuestos:adjuntos', (presupuestoId) => {
    exigirVista('presupuestos')
    return exito(adjuntosDePresupuesto(presupuestoId))
  })
  manejar('presupuestos:adjuntarArchivos', async (presupuestoId, archivos) =>
    exito(await agregarArchivosDePresupuesto(enteroPositivo(presupuestoId, 'El presupuesto'), archivos, exigirEdicion('presupuestos'))),
  )
  manejar('presupuestos:adjuntar', async (presupuestoId, rutas) => {
    const actor = exigirEdicion('presupuestos')
    const id = enteroPositivo(presupuestoId, 'El presupuesto')
    if (rutas !== null && rutas !== undefined) return exito(await agregarAdjuntosDePresupuesto(id, rutas, actor))
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí la cotización de la compañía',
      buttonLabel: 'Adjuntar',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Cotizaciones', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(adjuntosDePresupuesto(id))
    return exito(await agregarAdjuntosDePresupuesto(id, elegido.filePaths, actor))
  })
  manejar('presupuestos:abrirAdjunto', async (adjuntoId) => {
    exigirVista('presupuestos')
    const error = await shell.openPath(await rutaDelAdjuntoDePresupuesto(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('presupuestos:borrarAdjunto', (adjuntoId) => {
    exigirEdicion('presupuestos')
    return exito(borrarAdjuntoDePresupuesto(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN')))
  })

  // Tareas: los pendientes internos.
  manejar('tareas:listar', (filtros) => {
    exigirVista('tareas')
    return exito(listarTareas(filtros))
  })
  manejar('tareas:ficha', (tareaId) => exito(fichaDeTarea(enteroPositivo(tareaId, 'La tarea'), exigirVista('tareas'))))
  manejar('tareas:crear', (datos) => exito(crearTareaCompleta(datos, exigirEdicion('tareas'))))
  manejar('tareas:editar', (tareaId, datos) => exito(editarTarea(enteroPositivo(tareaId, 'La tarea'), datos, exigirEdicion('tareas'))))
  manejar('tareas:cambiarEstado', (tareaId, estado) => exito(cambiarEstadoDeTareaDelModulo(tareaId, estado, exigirEdicion('tareas'))))
  manejar('tareas:comentar', (tareaId, texto) => exito(agregarComentario(tareaId, texto, exigirEdicion('tareas'))))
  manejar('tareas:adjuntar', async (tareaId, rutas) => {
    const actor = exigirEdicion('tareas')
    const id = enteroPositivo(tareaId, 'La tarea')
    // La pantalla manda `null` y el diálogo se abre acá; la prueba de humo manda las rutas, porque un
    // diálogo del sistema no se puede manejar desde afuera.
    if (rutas !== null) return exito(await agregarAdjuntosDeTarea(id, rutas, actor))

    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí los documentos de la tarea',
      buttonLabel: 'Adjuntar',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Documentos y fotos', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(fichaDeTarea(id, actor))
    return exito(await agregarAdjuntosDeTarea(id, elegido.filePaths, actor))
  })
  manejar('tareas:adjuntarArchivos', async (tareaId, archivos) =>
    exito(await agregarArchivosDeTarea(enteroPositivo(tareaId, 'La tarea'), archivos, exigirEdicion('tareas'))),
  )
  manejar('tareas:abrirAdjunto', async (adjuntoId) => {
    exigirVista('tareas')
    const error = await shell.openPath(await rutaDelAdjuntoDeTarea(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('tareas:borrarAdjunto', (adjuntoId) => {
    exigirEdicion('tareas')
    return exito(borrarAdjuntoDeTarea(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  // Las de uno mismo y la campana: son de Inicio y de la barra superior, y las tareas se asignan
  // también desde la ficha del cliente y la del siniestro.
  manejar('tareas:mias', () => exito(misTareas(exigirVista('tareas', 'clientes', 'siniestros'))))
  manejar('tareas:avisos', () => exito(avisosDeTareas(exigirVista('tareas', 'clientes', 'siniestros'))))
  manejar('tareas:marcarVistos', () => exito(marcarAvisosVistos(exigirVista('tareas', 'clientes', 'siniestros'))))

  // Mensajería interna: el chat entre los usuarios de la agencia (12.8).
  //
  // El control de acceso es `exigirVista('mensajes')` / `exigirEdicion('mensajes')`, salvo el registro,
  // que además es del superadministrador. Escribir un mensaje es «editar»: alguien con el módulo en
  // «sólo ver» puede leer lo que le mandan y no puede contestar, que es lo que la agencia entendería
  // por sólo ver.
  manejar('mensajes:conversaciones', () => exito(conversacionesDeMensajeria(exigirVista('mensajes'))))
  manejar('mensajes:contactos', () => exito(contactosDeMensajeria(exigirVista('mensajes'))))
  manejar('mensajes:abrirCon', async (clave) => exito(await abrirConversacionCon(exigirEdicion('mensajes'), clave)))
  manejar('mensajes:crearGrupo', async (titulo, claves) => exito(await crearGrupoDeMensajes(exigirEdicion('mensajes'), titulo, claves)))
  manejar('mensajes:hilo', async (conversacionId, antesDeId) =>
    exito(await hiloDeMensajes(exigirVista('mensajes'), conversacionId, antesDeId)),
  )
  manejar('mensajes:enviar', (conversacionId, cuerpo, archivos) => {
    const mensaje = encolarMensaje(exigirEdicion('mensajes'), { conversacionId, cuerpo, archivos })
    // El cartero está esperando en el long-poll: se lo despierta para que el mensaje salga ahora y no
    // dentro de veinticinco segundos.
    apurarAlCartero()
    return exito(mensaje)
  })
  manejar('mensajes:enviarConArchivos', async (conversacionId, cuerpo, rutas, archivos) => {
    const actor = exigirEdicion('mensajes')
    // La pantalla manda `null` y el diálogo se abre acá; la prueba de humo manda las rutas, porque un
    // diálogo del sistema no se puede manejar desde afuera.
    if (rutas !== null) {
      const mensaje = encolarMensaje(actor, { conversacionId, cuerpo, rutas, archivos })
      apurarAlCartero()
      return exito(mensaje)
    }
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí los archivos para mandar',
      buttonLabel: 'Mandar',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Fotos y videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'mp4', 'mov', 'avi', 'mkv'] },
        { name: 'Documentos', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'] },
        { name: 'Audio', extensions: ['mp3', 'm4a', 'ogg', 'wav', 'opus'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) {
      throw new ErrorDeNegocio('No se eligió ningún archivo.')
    }
    const mensaje = encolarMensaje(actor, { conversacionId, cuerpo, rutas: elegido.filePaths, archivos })
    apurarAlCartero()
    return exito(mensaje)
  })
  // El zumbido sale por su cuenta y no por la cola: `zumbar` habla con el servidor en el momento. Por
  // eso no hay `apurarAlCartero()` acá —no hay nada esperando— y por eso es `async`.
  manejar('mensajes:zumbar', async (conversacionId) => exito(await zumbar(exigirEdicion('mensajes'), conversacionId)))
  // La reacción tampoco pasa por la cola: habla con el servidor en el momento, como el zumbido (14.0).
  manejar('mensajes:reaccionar', async (mensajeId, emoji) =>
    exito(await reaccionarA(exigirEdicion('mensajes'), mensajeId, emoji)),
  )
  manejar('mensajes:reintentar', (mensajeId) => {
    const mensaje = reintentarMensaje(exigirEdicion('mensajes'), mensajeId)
    apurarAlCartero()
    return exito(mensaje)
  })
  manejar('mensajes:marcarLeidos', (conversacionId) => {
    const actor = exigirVista('mensajes')
    // El tilde azul viaja: el que escribió tiene que verlo del otro lado. Sin canal no se marca nada,
    // porque un «leído» que se queda en esta computadora es peor que no tenerlo (14.0).
    canal().exigirConexion()
    return exito(marcarConversacionLeida(actor, conversacionId))
  })
  manejar('mensajes:avisos', () => exito(avisosDeMensajeria(exigirVista('mensajes'))))
  manejar('mensajes:borrar', async (mensajeId) => {
    await eliminarMensajePropio(exigirEdicion('mensajes'), mensajeId)
    return exito(null)
  })
  manejar('mensajes:abrirAdjunto', async (adjuntoId) => {
    exigirVista('mensajes')
    const error = await shell.openPath(await rutaDelAdjuntoDeMensaje(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el archivo: ${error}`)
    return exito(null)
  })
  manejar('mensajes:contenidoDeAdjunto', async (adjuntoId) => {
    exigirVista('mensajes')
    return exito(await contenidoDeAdjuntoDeMensaje(adjuntoId))
  })
  manejar('mensajes:borrarAdjunto', (adjuntoId) => exito(borrarAdjuntoDeMensaje(exigirEdicion('mensajes'), adjuntoId)))
  manejar('mensajes:estado', () => exito(estadoDeMensajeria(exigirVista('mensajes'))))
  // El registro de todo lo que se dijo en la agencia. Se pide el rol acá además de en el servidor: un
  // dato que llega al renderer ya está afuera, y no ofrecerlo en la pantalla no es lo mismo que no darlo.
  manejar('mensajes:registro', async (filtros) => exito(await registroDeMensajes(exigirRol('SUPER_ADMIN'), filtros)))

  // Métricas: los números de la agencia.
  // Los agregados de plata de la agencia (lo recaudado del mes, su evolución, el reparto por medio de
  // pago) no viajan a un empleado. Se decide acá y no en la pantalla: un dato que llega al renderer ya
  // está afuera, y ocultarlo con un `if` en el JSX no lo oculta, sólo no lo dibuja.
  //
  // Lo calcula el servidor (esta migración), una sola vez para toda la agencia, igual que ya hacía el podio desde
  // la 13.2: `tableroConCache`/`estadisticasConCache` leen el último cálculo que llegó por el aviso en
  // vivo y, mientras no haya ninguno todavía (o el período pedido no esté), caen al cálculo local de
  // siempre (`tableroDeMetricasLocal`/`estadisticasDeCarteraLocal` en servicios/metricas.ts), que sigue
  // viva justamente para eso y para cotejar contra el servidor mientras dura la migración.
  manejar('metricas:tablero', (filtros) => {
    const actor = exigirVista('metricas')
    return exito(tableroConCache(filtros, veLosNumerosDeLaAgencia(actor.rol)))
  })
  // Estadísticas es la pestaña de Cartera con los mismos números en tabla.
  manejar('metricas:estadisticas', (periodo, sucursales) => {
    const actor = exigirVista('metricas', 'cartera')
    return exito(estadisticasConCache(periodo, sucursales, veLosNumerosDeLaAgencia(actor.rol)))
  })
  // El podio: sólo pide que haya alguien loggeado, sin permiso de área. Es la competencia entre
  // sucursales por altas, no un número de la agencia, y el pedido del cliente fue justamente que la
  // vea cualquiera —lo tenga habilitado en Métricas o no—, para que el primero quiera seguir primero.
  //
  // Lo calcula el servidor (13.2), una sola vez para toda la agencia: esta computadora sólo relee lo
  // último que le llegó por el canal en vivo (ver vivo/grilla.ts) y le agrega la frescura, que
  // sale del mismo indicador de conexión que ya usa la barra superior (`motor.estado().situacion`), no
  // de uno nuevo. `null` es «todavía no llegó ningún podio a esta computadora».
  manejar('metricas:podio', () => {
    exigirSesion()
    const snap = leerSnapshotDeMetrica('podio')
    if (!snap) return exito(null)
    const frescura: FrescuraDeMetrica = estadoDeSincronizacion().situacion === 'sin-conexion' ? 'DESCONECTADA' : 'AL_DIA'
    const payload = snap.payload as Omit<PodioMensual, 'calculadoEn' | 'recibidoEnEstaComputadora' | 'frescura'>
    return exito({
      ...payload,
      calculadoEn: snap.servidorCalculadoEn,
      recibidoEnEstaComputadora: snap.recibidoEn,
      frescura,
    })
  })
  // El detalle del podio —qué pólizas son esas altas— pide Cartera, que es de donde sale el dato. El
  // podio se ve sin permiso porque es un número de una carrera; una lista con el nombre de cada cliente
  // ya es el listado de Cartera, y llegar a él por el atajo del podio sería una puerta de atrás.
  manejar('metricas:altas', (periodo, sucursal) => {
    exigirVista('cartera')
    return exito(altasConCache(periodo, sucursal))
  })

  // Reportes: exportar lo que ya se ve en pantalla. Un reporte junta datos de varios módulos, así que
  // se pide el permiso del módulo Reportes y nada más.
  manejar('reportes:catalogo', () => {
    exigirVista('reportes')
    return exito(catalogoDeReportes())
  })

  // «General Excel»: el mismo dato del módulo, en planilla. Se pide el permiso del MÓDULO —Cartera
  // para la cartera, Cobranzas para la mora— y no el de Reportes: si no, sería una puerta de atrás
  // para mirar lo que a alguien le sacaron de la barra lateral.
  manejar('excel:catalogo', () => {
    const actor = exigirSesion()
    return exito(catalogoDeExcel((area) => puedeVerElArea(actor, area)))
  })
  manejar('excel:filas', (pedido) => {
    const areas = areasDelReporte(pedido?.reporteId ?? '')
    if (areas.length === 0) throw new ErrorDeNegocio('Ese listado no se puede ver como planilla.')
    exigirVista(...areas)
    return exito(filasDeReporte(pedido))
  })
  // Bajar el .xlsx de lo que ya está en pantalla pide lo mismo que verlo. Con el permiso de Reportes
  // el botón le fallaría siempre a quien tiene el módulo y no tiene Reportes, que es justo el recorte
  // que la agencia haría para que un empleado no se baje la cartera entera.
  manejar('excel:exportar', async (pedido) => {
    const areas = areasDelReporte(pedido?.reporteId ?? '')
    if (areas.length === 0) throw new ErrorDeNegocio('Ese listado no se puede bajar como planilla.')
    exigirVista(...areas)
    const archivo = xlsxDelReporte(pedido)
    return exito(await guardarBinarioComo({ ...archivo, descripcion: 'Planilla de Excel' }, ventanaActual()))
  })
  manejar('reportes:vistaPrevia', (pedido) => {
    exigirVista('reportes')
    return exito(vistaPreviaDeReporte(pedido))
  })
  // La pantalla manda `ruta` en null y el diálogo se abre acá; la prueba de humo manda la ruta,
  // porque un diálogo del sistema no se puede manejar desde afuera. Es lo mismo que hace adjuntar.
  manejar('reportes:exportar', async (pedido, formato, ruta) => {
    exigirVista('reportes')
    const archivo =
      formato === 'pdf'
        ? await (async () => {
            const papel = htmlDelReporte(pedido)
            return { nombre: papel.nombre, contenido: await pdfDelHtml(papel.html), descripcion: 'PDF' }
          })()
        : { ...xlsxDelReporte(pedido), descripcion: 'Planilla de Excel' }
    const destino = typeof ruta === 'string' && ruta.trim() ? ruta.trim() : null
    if (destino) return exito(guardarEn(destino, archivo.contenido))
    return exito(await guardarBinarioComo(archivo, ventanaActual(), 'Guardar el reporte'))
  })
  manejar('reportes:planillaClasica', async (opciones, ruta) => {
    exigirVista('reportes')
    const archivo = xlsxDePlanillaClasica(opciones)
    const destino = typeof ruta === 'string' && ruta.trim() ? ruta.trim() : null
    if (destino) return exito(guardarEn(destino, archivo.contenido))
    return exito(await guardarBinarioComo({ ...archivo, descripcion: 'Planilla de Excel' }, ventanaActual(), 'Guardar la planilla clásica'))
  })

  // Marketing: las plantillas las edita un administrador (son lo que la agencia le dice al cliente);
  // los segmentos los arma cualquiera, pero borrar uno que usa todo el equipo sí pide administrador.
  manejar('marketing:plantillas', () => {
    exigirVista('marketing')
    return exito(listarPlantillas())
  })
  manejar('marketing:crearPlantilla', (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    return exito(crearPlantilla(datos))
  })
  manejar('marketing:editarPlantilla', (clave, datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    return exito(editarPlantilla(clave, datos))
  })
  manejar('marketing:borrarPlantilla', (clave) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    return exito(borrarPlantilla(clave))
  })
  manejar('marketing:segmento', (segmentoId, filtros, plantillaClave) => {
    exigirVista('marketing')
    return exito(resultadoDeSegmento(segmentoId, filtros, plantillaClave))
  })
  manejar('marketing:guardarSegmento', (segmentoId, datos) => exito(guardarSegmento(segmentoId, datos, exigirEdicion('marketing'))))
  manejar('marketing:borrarSegmento', (segmentoId) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    return exito(borrarSegmento(segmentoId))
  })
  manejar('marketing:avisar', (filaId, segmentoId, filtros, plantillaClave) =>
    exito(avisarDeSegmento(filaId, segmentoId, filtros, plantillaClave, exigirEdicion('marketing'))),
  )

  // Abrir un enlace en el navegador del sistema (WhatsApp). Sólo http/https.
  // --- Catálogo de vehículos -------------------------------------------------
  //
  // Los desplegables los consulta cualquiera que pueda cargar una póliza o un presupuesto: son datos
  // públicos de un catálogo de autos, no de la agencia. Configurar el proveedor y bajar el catálogo,
  // en cambio, es de administradores: son credenciales y una descarga de decenas de miles de filas.
  manejar('vehiculos:estado', () => {
    exigirVista('polizas', 'presupuestos', 'administracion')
    return exito(estadoDelCatalogo())
  })
  // Guardar las credenciales es, para el superadministrador, guardarlas PARA TODAS LAS COMPUTADORAS:
  // se escriben acá y salen para el VPS en el mismo movimiento. Que el servidor no conteste no puede
  // deshacer el guardado local —quedó bien escrito— así que el motivo viaja en la respuesta y la
  // pantalla lo muestra con el botón para reintentar.
  //
  // Las carga SÓLO el superadministrador. Antes un ADMIN podía cargarlas en su computadora sin
  // publicarlas, y eso era exactamente el problema que se quería sacar: una máquina con credenciales
  // distintas a las de las otras cuatro, sin que nadie se entere.
  manejar('vehiculos:guardarCredenciales', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    guardarCredencialesDeVehiculos(datos)
    const estado = estadoDelCatalogo()
    const compartido = await publicarSinRomper('vehiculos', actor.nombre)
    return exito({
      estado,
      compartido,
      detalle: compartido.error
        ? 'Quedaron guardadas en esta computadora, pero no se pudieron mandar al servidor.'
        : 'Guardadas y mandadas al servidor: el resto de las computadoras las va a tomar al abrir el programa.',
    })
  })
  // Reintento manual de la publicación, para cuando el guardado la encontró sin conexión.
  manejar('vehiculos:publicar', async () => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    return exito(await publicarVehiculosEnElVps(actor.nombre))
  })
  manejar('vehiculos:estadoCompartido', async () => {
    exigirVista('administracion')
    return exito(await estadoCompartidoDeVehiculos())
  })
  // Traer a mano lo que cargó el superadministrador, sin esperar al próximo arranque.
  manejar('vehiculos:adoptar', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    const resultado = await adoptarVehiculosDelVps()
    return exito({ ...resultado, estado: estadoDelCatalogo(), compartido: await estadoCompartidoDeVehiculos() })
  })
  manejar('vehiculos:borrarCredenciales', async (tambienDelServidor) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    borrarCredencialesDeVehiculos()
    // Sacarlas del servidor es aparte y sólo del superadministrador: borrarlas de una computadora
    // tiene que poder hacerse sin dejar sin catálogo a las otras cuatro.
    if (tambienDelServidor === true) {
      if (actor.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('Sacarlas del servidor lo hace el superadministrador.')
      await borrarVehiculosDelVps()
    }
    return exito({ estado: estadoDelCatalogo(), compartido: await estadoCompartidoDeVehiculos() })
  })
  manejar('vehiculos:probar', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await probarProveedorDeVehiculos())
  })

  // Cartera → Galeno NOVEDADES (15.4). Distinto canal que la API REST de Galeno de más abajo: esto es
  // la sincronización con el portal, que corre en el VPS; acá se baja lo que cambió y se aplica a la
  // cartera. Los cuatro primeros van por el permiso de CARTERA —quien atiende el mostrador tiene que
  // poder resolver la bandeja— y la credencial, por Administración y sólo el superadministrador.
  manejar('galenoNovedades:estado', async () => {
    exigirVista('cartera')
    return exito(await estadoDeGaleno())
  })
  manejar('galenoNovedades:bandeja', async () => {
    exigirVista('cartera')
    return exito(await bandejaDeGaleno())
  })
  manejar('galenoNovedades:aplicar', async (id, clienteId, crearElCliente) => {
    const actor = exigirEdicion('cartera')
    return exito(await aplicarNovedadDeGaleno({ id, clienteId: clienteId ?? null, crearElCliente }, actor))
  })
  manejar('galenoNovedades:descartar', async (id, motivo) => {
    const actor = exigirEdicion('cartera')
    await descartarNovedadDeGaleno(id, motivo, actor)
    return exito(null)
  })
  manejar('galenoNovedades:drenar', async () => {
    const actor = exigirEdicion('cartera')
    return exito(await drenarGaleno(actor))
  })
  manejar('galenoNovedades:sincronizar', async () => {
    exigirEdicion('cartera')
    return exito(await sincronizarGaleno())
  })
  manejar('galenoNovedades:probar', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await probarGalenoNovedades())
  })
  manejar('galenoNovedades:estadoCompartido', async () => {
    exigirVista('administracion')
    return exito(await estadoCompartidoDeGaleno())
  })
  manejar('galenoNovedades:guardarCredenciales', async (datos) => {
    // Sólo el superadministrador: es la credencial del portal de Galeno de la agencia entera, y con
    // ella se ve toda la cartera de la compañía.
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    return exito(await guardarCredencialesDeGaleno(datos, actor))
  })
  manejar('vehiculos:refrescar', async (tipo) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await refrescarCatalogo(tipo, (progreso) => emitirATodas('vehiculos:progreso', progreso)))
  })
  manejar('vehiculos:marcas', (tipo) => {
    exigirVista('polizas', 'presupuestos', 'cartera')
    return exito(marcasDelCatalogo(tipo))
  })
  manejar('vehiculos:modelos', (tipo, marcaId) => {
    exigirVista('polizas', 'presupuestos', 'cartera')
    return exito(modelosDelCatalogo(tipo, marcaId))
  })
  manejar('vehiculos:lineas', (tipo, marcaId, modeloId) => {
    exigirVista('polizas', 'presupuestos', 'cartera')
    return exito(lineasDelCatalogo(tipo, marcaId, modeloId))
  })
  manejar('vehiculos:anios', (tipo, marcaId, modeloId, lineaId) => {
    exigirVista('polizas', 'presupuestos', 'cartera')
    return exito(aniosDeLaLinea(tipo, marcaId, modeloId, lineaId))
  })
  manejar('vehiculos:resolver', (tipo, marcaId, modeloId, lineaId, anio) => {
    exigirVista('polizas', 'presupuestos', 'cartera')
    return exito(resolverVehiculoDelCatalogo(tipo, marcaId, modeloId, lineaId, anio))
  })

  // --- Galeno Seguros ----------------------------------------------------------
  //
  // Las credenciales las carga sólo un administrador, igual que el catálogo de vehículos y la app de
  // Meta. Cotizar y sus listas de valores las puede usar cualquiera que trabaje con Presupuestos —es
  // lo que reemplaza cargar la cobertura a mano—; emitir, en cambio, pide EDITAR Presupuestos: crea
  // una póliza real contra un tercero. Las Consultas, la Cuenta Corriente, los Contratos de ART y la
  // Impresión son reportes de sólo lectura y van con el mismo permiso que el resto de Administración.
  manejar('galeno:estado', async () => {
    exigirVista('administracion')
    return exito(await estadoGaleno())
  })
  manejar('galeno:guardarCredenciales', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await guardarGaleno(datos, actor))
  })
  manejar('galeno:borrarCredenciales', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await borrarGaleno())
  })
  manejar('galeno:probar', async () => {
    exigirVista('administracion')
    return exito(await probarGaleno())
  })
  manejar('galeno:planesComerciales', async (tipoVehiculo) => {
    exigirVista('presupuestos')
    return exito(await planesComercialesGaleno(tipoVehiculo))
  })
  manejar('galeno:marcas', async (tipoVehiculo) => {
    exigirVista('presupuestos')
    return exito(await marcasGaleno(tipoVehiculo))
  })
  manejar('galeno:modelos', async (marcaCodigo) => {
    exigirVista('presupuestos')
    return exito(await modelosGaleno(marcaCodigo))
  })
  manejar('galeno:anios', async (marcaCodigo, modeloCodigo) => {
    exigirVista('presupuestos')
    return exito(await aniosGaleno(marcaCodigo, modeloCodigo))
  })
  manejar('galeno:subModelos', async (marcaCodigo, modeloCodigo, anio) => {
    exigirVista('presupuestos')
    return exito(await subModelosGaleno(marcaCodigo, modeloCodigo, anio))
  })
  manejar('galeno:tiposDePersona', async () => {
    exigirVista('presupuestos')
    return exito(await tiposDePersonaGaleno())
  })
  manejar('galeno:codigoPostal', async (tipoVehiculo, codigoPostal) => {
    exigirVista('presupuestos')
    return exito(await codigoPostalGaleno(tipoVehiculo, codigoPostal))
  })
  manejar('galeno:modosDeFacturacion', async (tipoVehiculo, planComercialCodigo) => {
    exigirVista('presupuestos')
    return exito(await modosDeFacturacionGaleno(tipoVehiculo, planComercialCodigo))
  })
  manejar('galeno:condicionesDePago', async (tipoVehiculo, modoFacturacionCodigo) => {
    exigirVista('presupuestos')
    return exito(await condicionesDePagoGaleno(tipoVehiculo, modoFacturacionCodigo))
  })
  manejar('galeno:formasDePago', async (tipoVehiculo, modoFacturacionCodigo, planComercialCodigo) => {
    exigirVista('presupuestos')
    return exito(await formasDePagoGaleno(tipoVehiculo, modoFacturacionCodigo, planComercialCodigo))
  })
  manejar('galeno:equipoGnc', async () => {
    exigirVista('presupuestos')
    return exito(await equipoGncGaleno())
  })
  manejar('galeno:equiposDeRastreo', async () => {
    exigirVista('presupuestos')
    return exito(await equiposDeRastreoGaleno())
  })
  manejar('galeno:clausulasDeAjuste', async () => {
    exigirVista('presupuestos')
    return exito(await clausulasDeAjusteGaleno())
  })
  manejar('galeno:accesorios', async () => {
    exigirVista('presupuestos')
    return exito(await accesoriosGaleno())
  })
  manejar('galeno:categoriasIva', async () => {
    exigirVista('presupuestos')
    return exito(await categoriasIvaGaleno())
  })
  manejar('galeno:codigosIIBB', async () => {
    exigirVista('presupuestos')
    return exito(await codigosIIBBGaleno())
  })
  manejar('galeno:tiposDeUso', async () => {
    exigirVista('presupuestos')
    return exito(await tiposDeUsoGaleno())
  })
  manejar('galeno:tiposDeDocumento', async () => {
    exigirVista('presupuestos')
    return exito(await tiposDeDocumentoGaleno())
  })
  manejar('galeno:nacionalidades', async () => {
    exigirVista('presupuestos')
    return exito(await nacionalidadesGaleno())
  })
  manejar('galeno:sexos', async () => {
    exigirVista('presupuestos')
    return exito(await sexosGaleno())
  })
  manejar('galeno:estadosCiviles', async () => {
    exigirVista('presupuestos')
    return exito(await estadosCivilesGaleno())
  })
  manejar('galeno:bancos', async () => {
    exigirVista('presupuestos')
    return exito(await bancosGaleno())
  })
  manejar('galeno:tarjetasDeCredito', async () => {
    exigirVista('presupuestos')
    return exito(await tarjetasDeCreditoGaleno())
  })
  manejar('galeno:cotizar', async (datos) => {
    exigirEdicion('presupuestos')
    return exito(await cotizarGaleno(datos))
  })
  manejar('galeno:emitir', async (datos) => {
    exigirEdicion('presupuestos')
    return exito(await emitirGaleno(datos))
  })
  manejar('galeno:emitirConInspeccion', async (datos) => {
    exigirEdicion('presupuestos')
    return exito(await emitirConInspeccionGaleno(datos))
  })
  manejar('galeno:reporte', async (tipo, filtros) => {
    exigirVista('administracion')
    return exito(await reporteGaleno(tipo, filtros))
  })
  manejar('galeno:detalleDePoliza', async (rama, poliza, nroRiesgo) => {
    exigirVista('administracion')
    return exito(await detalleDePolizaGaleno(rama, poliza, nroRiesgo))
  })
  manejar('galeno:detalleDeLiquidaciones', async (filtros) => {
    exigirVista('administracion')
    return exito(await detalleDeLiquidacionesGaleno(filtros))
  })
  manejar('galeno:imprimir', async (pedido) => {
    exigirVista('administracion')
    const documento = await imprimirGaleno(pedido)
    const error = await shell.openPath(documento.ruta)
    if (error) console.error('[galeno] No se pudo abrir el PDF impreso:', error)
    return exito(documento)
  })

  // --- Multicotizador ---------------------------------------------------------
  //
  // Cotizar en todas las compañías es mirar precios: alcanza con ver el Multicotizador. Lo que de verdad
  // escribe algo —armar el presupuesto, emitir— va por sus propios canales (presupuestos:crear,
  // galeno:emitir), que ya piden editar Presupuestos.
  manejar('multicotizador:aseguradoras', () => {
    exigirVista('multicotizador')
    return exito(aseguradorasDelMulticotizador())
  })
  manejar('multicotizador:localidades', async (tipoVehiculo, codigoPostal) => {
    exigirVista('multicotizador')
    return exito(await localidadesDelMulticotizador(tipoVehiculo, codigoPostal))
  })
  manejar('multicotizador:cotizar', async (pedido) => {
    const actor = exigirVista('multicotizador')
    return exito(await cotizarEnAseguradora(pedido, veLosNumerosDeLaAgencia(actor.rol)))
  })

  // --- Marketing → Redes -----------------------------------------------------
  //
  // Publicar es EDITAR Marketing: sale en nombre de la agencia y se ve desde afuera, pero acotado a
  // la sucursal de quien publica (el servidor lo vuelve a validar). Cargar la app de Meta y vincular
  // o desvincular la cuenta de una sucursal, en cambio, son credenciales y por eso son sólo del
  // SUPER_ADMIN — no de cualquier administrador, a diferencia de antes.
  // Mirar la pestaña alcanza con ver Marketing: tiene que poder abrirse aunque no haya nada cargado,
  // para que la pantalla explique qué falta en vez de romperse.
  // El panorama de las cuentas lo mira Marketing → Redes y también Administración → Redes sociales:
  // un administrador sin Marketing tiene que poder verlo desde ahí (antes la tarjeta quedaba girando).
  manejar('redes:panel', async () => {
    const actor = exigirVista('marketing', 'administracion')
    return exito(await panelDeRedes(actor))
  })
  manejar('redes:estadoMeta', async () => {
    exigirVista('marketing', 'administracion')
    return exito({ ...estadoMeta(), compartido: await estadoCompartidoDeMeta() })
  })
  // La app de Meta y su dirección de vuelta las carga sólo el superadministrador: viajan a todas las
  // computadoras, y la dirección de vuelta tiene que ser EXACTAMENTE la misma en las cinco y en el
  // panel de Meta. Una sola distinta rompe el login de Facebook con un mensaje que no explica nada.
  manejar('redes:guardarMeta', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    const estado = guardarMeta(datos)
    return exito({ ...estado, compartido: await publicarSinRomper('meta', actor.nombre) })
  })
  manejar('redes:borrarMeta', async () => {
    exigirRol('SUPER_ADMIN')
    exigirEdicion('administracion')
    const estado = borrarMeta()
    // Sacarla de esta computadora y dejarla en el servidor la devolvería en el próximo arranque.
    await borrarMetaDelVps().catch((error) => console.error('[ajustes] No se pudo sacar la app de Meta del servidor:', error))
    return exito({ ...estado, compartido: await estadoCompartidoDeMeta() })
  })
  // Vincular/desvincular deja atada (o suelta) la cuenta de una sucursal: sólo el superadministrador,
  // porque de ahí en más cualquier admin o empleado de esa sucursal va a poder publicar con ella.
  manejar('redes:vincular', async (sucursal) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('marketing')
    return exito(await vincularConMeta(ventanaActual(), actor, String(sucursal ?? '')))
  })
  manejar('redes:elegirPagina', async (paginaId) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('marketing')
    await elegirPaginaVinculada(paginaId, actor)
    return exito(await panelDeRedes(actor))
  })
  manejar('redes:desvincular', async (sucursal) => {
    const actor = exigirRol('SUPER_ADMIN')
    exigirEdicion('marketing')
    await desvincularDeMeta(actor, String(sucursal ?? ''))
    return exito(await panelDeRedes(actor))
  })
  manejar('redes:elegirArchivo', async () => {
    exigirEdicion('marketing')
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí la foto o el video para publicar',
      buttonLabel: 'Usar este archivo',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [
        { name: 'Fotos y videos', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'mov'] },
        { name: 'Fotos', extensions: ['jpg', 'jpeg', 'png'] },
        { name: 'Videos', extensions: ['mp4', 'mov'] },
      ],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(null)
    return exito(await revisarArchivoParaPublicar(elegido.filePaths[0]!))
  })
  manejar('redes:publicar', async (pedido) => {
    const actor = exigirEdicion('marketing')
    return exito(await publicarEnRed(pedido, actor))
  })
  manejar('redes:cuotaInstagram', async (sucursal) => {
    const actor = exigirVista('marketing')
    return exito(await cuotaDeInstagram(actor, sucursal))
  })
  manejar('redes:publicaciones', async (sucursal) => {
    const actor = exigirVista('marketing')
    return exito(await publicaciones(actor, sucursal))
  })
  // Comentarios: mirarlos alcanza con ver Marketing; responder, ocultar o eliminar piden edición,
  // igual que publicar (y con el mismo corte por sucursal, que revalida el servidor).
  manejar('redes:comentarios', async (sucursal, soloSinResponder) => {
    const actor = exigirVista('marketing')
    return exito(await comentarios(actor, sucursal, soloSinResponder))
  })
  manejar('redes:comentarios:responder', async (comentarioId, mensaje) => {
    const actor = exigirEdicion('marketing')
    return exito(await responderComentario(actor, comentarioId, mensaje))
  })
  manejar('redes:comentarios:ocultar', async (comentarioId) => {
    const actor = exigirEdicion('marketing')
    return exito(await ocultarComentario(actor, comentarioId))
  })
  manejar('redes:comentarios:mostrar', async (comentarioId) => {
    const actor = exigirEdicion('marketing')
    return exito(await mostrarComentario(actor, comentarioId))
  })
  manejar('redes:comentarios:eliminar', async (comentarioId) => {
    const actor = exigirEdicion('marketing')
    await eliminarComentario(actor, comentarioId)
    return exito(null)
  })
  // Mensajes privados: mismo criterio que comentarios. La ventana de 24 horas ya viene resuelta en
  // `conversacion.puedeResponder`; acá no hace falta volver a mirarla.
  manejar('redes:conversaciones', async (sucursal) => {
    const actor = exigirVista('marketing')
    return exito(await conversaciones(actor, sucursal))
  })
  manejar('redes:conversaciones:mensajes', async (conversacionId) => {
    const actor = exigirVista('marketing')
    return exito(await mensajesDeConversacion(actor, conversacionId))
  })
  manejar('redes:conversaciones:responder', async (conversacionId, mensaje) => {
    const actor = exigirEdicion('marketing')
    return exito(await responderConversacion(actor, conversacionId, mensaje))
  })

  // El control remoto de las computadoras de la agencia. Lo mira CUALQUIER rol: quien tiene el
  // problema delante es el mostrador, y hacerle pedir a un administrador la dirección de la consola
  // no protege nada —entrar pide su propia clave del otro lado, que es como tiene que ser para un
  // acceso a todas las máquinas—; sólo demora el arreglo.
  manejar('mesh:estado', async () => {
    exigirSesion()
    return exito(await estadoDelMesh())
  })

  // «Reportar error» de Inicio. Lo usa cualquier rol y sin permiso sobre ningún módulo: el que tiene el
  // problema delante es el que lo puede contar, y hacerle pedir permiso para avisar de un error sería
  // exactamente la forma de no enterarse nunca.
  manejar('soporte:elegirImagenes', async () => {
    exigirSesion()
    return exito(await elegirImagenesDelReporte(ventanaActual()))
  })
  manejar('soporte:pegarImagen', () => {
    exigirSesion()
    return exito(imagenDelPortapapeles())
  })
  manejar('soporte:reportar', async (reporte) => {
    const actor = exigirSesion()
    // El reporte abre un issue en GitHub: sin canal no sale, y quedarse esperando el envío es peor
    // que decirle a la persona que lo mande cuando vuelva internet (14.0).
    canal().exigirConexion()
    return exito(
      await enviarReporteDeError(reporte, {
        quien: actor.nombre,
        sucursal: actor.sucursal.nombre,
        version: app.getVersion(),
      }),
    )
  })

  manejar('sistema:abrirEnlace', async (url) => {
    exigirSesion()
    if (!/^https?:\/\//i.test(url)) throw new ErrorDeNegocio('Sólo se pueden abrir direcciones http o https.')
    await shell.openExternal(url)
    return exito(null)
  })

  // Información de la aplicación
  manejar('app:info', () => exito(infoApp()))

  // Actualizaciones automáticas
  manejar('actualizaciones:estado', () => exito(estadoDeActualizacion()))
  manejar('actualizaciones:buscarAhora', () => {
    buscarActualizaciones()
    return exito(estadoDeActualizacion())
  })
  // El «Actualizar ahora» del cartel: recién ahí se baja el instalador.
  manejar('actualizaciones:actualizarAhora', () => {
    actualizarAhora()
    return exito(estadoDeActualizacion())
  })
  // El «Dejar para después»: no baja nada, sólo lo anota para que lo vea el superadministrador.
  manejar('actualizaciones:posponer', (version) => {
    posponerActualizacion(version)
    return exito(null)
  })
  manejar('actualizaciones:instalarAhora', () => {
    instalarActualizacion()
    return exito(null)
  })
  // Sólo lo ve un superadministrador, igual que el resto de la pantalla de Usuarios.
  manejar('actualizaciones:estadoDeSucursales', async () => {
    exigirRol('SUPER_ADMIN')
    return exito(await estadoDeActualizacionesPorSucursal())
  })

  // Ayuda: el PDF de una pantalla de ayuda, por el mismo camino que ya usa el presupuesto.
  manejar('ayuda:guardarPdf', async (pedido) => {
    exigirSesion()
    return exito(await guardarHtmlComoPdf(pedido.html, pedido.nombreDeArchivo, ventanaActual()))
  })
}
