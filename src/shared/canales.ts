// Contrato tipado de los canales IPC: cada canal declara sus argumentos y su respuesta.
// El proceso principal implementa exactamente estas firmas y la precarga las expone.
import type { TipoEliminable, ResultadoDeEliminacion, VistaPreviaDeEliminacion } from './eliminacion'
import type { MatrizPermisos } from './permisos'
import type {
  TipoPestana,
  // Mensajería interna (12.8).
  AdjuntoDeMensaje,
  AvisosDeMensajes,
  ContactoDeMensajeria,
  ConversacionInterna,
  EstadoDeMensajeria,
  FiltrosDelLogDeMensajes,
  HiloDeMensajes,
  LogDeMensajes,
  MensajeInterno,
  AdjuntoDePoliza,
  AdjuntoDePresupuesto,
  ArchivoParaAdjuntar,
  AceptacionDePresupuesto,
  InformeDeDuplicados,
  ResultadoDeFusion,
  ResultadoDeFusionDePolizas,
  ComentarioDeRed,
  ConsultaDeAntiguedad,
  ConversacionDeRed,
  DatosDeClausula,
  DatosDeGrua,
  DatosDeOrganizador,
  DatosDePrecio,
  EstadoDeReferencias,
  ListasDeCompanias,
  AvisosDeTareas,
  DatosDeEdicionDeTarea,
  DatosDeLead,
  DatosDePresupuesto,
  DatosDeTareaCompleta,
  EnvioDePresupuesto,
  EstadoLead,
  FichaLead,
  FichaPresupuesto,
  FichaTarea,
  FilaTarea,
  FiltrosLeads,
  FiltrosPresupuestos,
  FiltrosTareas,
  ListadoLeads,
  ListadoPresupuestos,
  ListadoTareas,
  ResultadoConversion,
  AvisoDeCobertura,
  AvisoPreparado,
  BandejaRenovaciones,
  CatalogosDePoliza,
  CuotasDelCliente,
  DatosDeSiniestro,
  SiniestroDeCliente,
  CandidatoDeSiniestro,
  CategoriaDeAdjunto,
  DatosDeRiesgo,
  DatosDeTareaDeSiniestro,
  EstadoSiniestro,
  FichaSiniestro,
  FiltrosSiniestros,
  ListadoAmp,
  ListadoRiesgos,
  ListadoSiniestros,
  CampoDeRiesgo,
  DatosDeCliente,
  DatosDePoliza,
  DatosDeRegla,
  DatosDeRenovacion,
  DatosDeSeguimiento,
  DatosDeTarea,
  EstadoTarea,
  FichaCliente,
  FilaCliente,
  FiltrosClientes,
  FiltrosDeudores,
  FiltrosPolizas,
  FormatoDeDeudores,
  ListadoClientes,
  ListadoDeudores,
  ListadoPolizas,
  MatrizDeCobertura,
  MensajeDeRed,
  NotaDeCliente,
  PolizaDeCliente,
  ReglaDeCobertura,
  ResultadoAltaCliente,
  TareaDeCliente,
  VehiculoDeCliente,
  AvisoDeMora,
  CajaDelDia,
  ConfigImpresora,
  DatosDeCompania,
  DatosDeImpresora,
  DatosDeMovimientoDeCaja,
  DatosDePagoManual,
  DireccionDeSucursal,
  FiltrosMora,
  ListadoMora,
  ArchivoParaPublicar,
  AdopcionDeCredencialesDeVehiculos,
  DatosDelProveedorDeVehiculos,
  EstadoDeAjusteCompartido,
  // Cartera → Galeno: las novedades del portal que el VPS consulta cada quince minutos (15.4).
  CredencialesDeGaleno,
  EstadoDeGalenoNovedades,
  FilaDeBandejaDeGaleno,
  PruebaDeGalenoNovedades,
  ResumenDeAplicacionDeGaleno,
  ResumenDePasadaDeGaleno,
  EstadoDeCredencialesDeVehiculos,
  EstadoDelCatalogo,
  EstadoDelMesh,
  ImagenDeReporte,
  ReporteCreado,
  ReporteDeError,
  GuardadoDeCredencialesDeVehiculos,
  LineaDeCatalogo,
  OpcionDeCatalogo,
  ProgresoDeCatalogo,
  PruebaDelProveedor,
  TipoDeVehiculo,
  VehiculoDelCatalogo,
  DatosDeMeta,
  EstadoDeMeta,
  PanelDeRedes,
  PedidoDePublicacion,
  PedidoDeTicket,
  PublicacionDeRed,
  VinculacionPendiente,
  TareaCompletada,
  RendicionImputados,
  ResultadoImputacion,
  ResumenComisiones,
  CambioDeClave,
  CambiosDeReactivacion,
  CampoEditable,
  Compania,
  DatosDeBaja,
  DatosDePago,
  EntradaHistorial,
  EstadoActualizacion,
  EstadoDeActualizacionDeSucursal,
  EstadoSincronizacion,
  EstadoDeConexion,
  PanelSincronizacion,
  FilaBaja,
  FilaCartera,
  FilaRiesgoVario,
  PlanillaDelMes,
  PlantillaAviso,
  ResultadoDeReactivacion,
  ResumenCierreDeMes,
  // Avisos de rechazo del débito automático.
  AvisosDeRechazos,
  DatosDeRechazo,
  EstadoDeRechazo,
  FilaRechazo,
  FiltrosRechazos,
  ListadoRechazos,
  CredencialesIngreso,
  DatosConexionGoogle,
  DatosEdicionUsuario,
  DatosNuevoUsuario,
  EstadoConexionGoogle,
  EstadoDeGoogleEnLaAgencia,
  RespaldoDelVps,
  ResumenDeRestauracion,
  EstadoMigracionVps,
  ResumenMigracionVps,
  EstadoDeAcceso,
  EstadoDeUsuarios,
  MatrizDePermisos,
  MisPermisos,
  SesionCerrada,
  EstadoImportador,
  InfoApp,
  InformeImportacion,
  ProgresoImportacion,
  Resultado,
  SesionUsuario,
  Sucursal,
  Usuario,
  VistaPreviaHoja,
  // Fase 9: métricas, reportes y marketing.
  AvisoDeSegmento,
  CatalogoDeExcel,
  CatalogoDeReportes,
  FilasDeReporte,
  DatosDePlantilla,
  DatosDeSegmento,
  DetalleDeAltas,
  EstadisticasDeCartera,
  FiltrosDeSegmento,
  FiltrosMetricas,
  FormatoDeReporte,
  OpcionesPlanillaClasica,
  PedidoDeReporte,
  PlantillaDeMensaje,
  PodioMensual,
  ResultadoDeSegmento,
  TableroMetricas,
  VistaPreviaDeReporte,
  // Perfiles, presencia y llamadas de voz (14.0).
  ConfiguracionDeIce,
  DatosDePerfil,
  EstadoDeLlamada,
  PerfilDeUsuario,
  SenalDeLlamada,
  SenalParaMandar,
  // Galeno Seguros: cotización, emisión, consultas, cuenta corriente y ART.
  CodigoPostalGaleno,
  CotizacionGaleno,
  DatosDeCotizacionGaleno,
  DatosDeEmisionGaleno,
  DatosDeGaleno,
  EmisionGaleno,
  EstadoDeGaleno,
  FiltrosDeReporteGaleno,
  ImpresionGaleno,
  OpcionGaleno,
  PedidoDeImpresionGaleno,
  PruebaDeGaleno,
  ReporteDeGaleno,
  ReporteGaleno,
  SubModeloGaleno,
} from './tipos'
// El foco y la presencia son del protocolo del canal, que es la copia exacta de lo que declara el
// servidor (14.0). Se toman de ahí y no se vuelven a escribir acá: sólo el tipo, así que la flecha se
// borra al compilar, igual que la de `shared/presencia.ts`.
import type { Foco, Presente } from '../main/vivo/protocolo'

/** Llamados renderer → main (request/response). */
export interface Canales {
  'auth:ingresar': (datos: CredencialesIngreso) => Resultado<SesionUsuario>
  'auth:salir': () => Resultado<null>
  'auth:sesion': () => Resultado<SesionUsuario | null>
  'auth:cambiarClave': (datos: CambioDeClave) => Resultado<SesionUsuario>
  /** Estado de la base de usuarios compartida. Con `comprobar` sale a GitHub (hasta 8 s); si no, devuelve lo último que se sabe. */
  'auth:estadoDeAcceso': (comprobar: boolean) => Resultado<EstadoDeAcceso>

  'sucursales:listar': () => Resultado<Sucursal[]>

  'usuarios:listar': () => Resultado<Usuario[]>
  'usuarios:crear': (datos: DatosNuevoUsuario) => Resultado<Usuario>
  'usuarios:editar': (id: number, datos: DatosEdicionUsuario) => Resultado<Usuario>
  'usuarios:cambiarActivo': (id: number, activo: boolean) => Resultado<Usuario>
  'usuarios:resetearClave': (id: number, claveTemporal: string) => Resultado<Usuario>
  /** Estado de la base compartida para la pantalla Usuarios. Con `comprobar` sincroniza primero. */
  'usuarios:estado': (comprobar: boolean) => Resultado<EstadoDeUsuarios>
  /** Inicializa la base compartida con los usuarios de esta computadora. Sólo si todavía no existe. */
  'usuarios:subirLocales': () => Resultado<EstadoDeUsuarios>

  // Permisos por rol (Administración → Permisos). La matriz la mira cualquiera con sesión abierta
  // —para saber qué puede hacer— y la edita sólo el SUPER_ADMIN.
  /** Lo que puede el usuario con la sesión abierta, área por área. */
  'permisos:mios': () => Resultado<MisPermisos>
  'permisos:matriz': () => Resultado<MatrizDePermisos>
  'permisos:guardar': (permisos: MatrizPermisos) => Resultado<MatrizDePermisos>

  // Borrado definitivo y puntual de un registro (el botón de la papelera). Sólo el SUPER_ADMIN: lo
  // exige ipc.ts, y shared/eliminacion.ts explica por qué no es un permiso configurable.
  /** Qué se lleva puesto el borrado. Es lo que el cartel muestra antes de confirmar; no toca nada. */
  'eliminacion:vistaPrevia': (tipo: TipoEliminable, id: number) => Resultado<VistaPreviaDeEliminacion>
  'eliminacion:borrar': (tipo: TipoEliminable, id: number) => Resultado<ResultadoDeEliminacion>

  // Cartera → Duplicados (12.6): lo que la sincronización dejó repetido. Mirar pide ver Cartera o
  // Clientes; juntar dos fichas o sacar un renglón repetido pide editar, y lo puede hacer cualquier
  // rol —lo pidió la agencia—, SÓLO sobre lo que el detector señaló (el servicio lo vuelve a mirar).
  'duplicados:listar': () => Resultado<InformeDeDuplicados>
  'duplicados:fusionarClientes': (sobrevivienteId: number, duplicadoId: number) => Resultado<ResultadoDeFusion>
  'duplicados:fusionarPolizas': (sobrevivienteId: number, duplicadaId: number) => Resultado<ResultadoDeFusionDePolizas>
  'duplicados:vistaPreviaCuota': (cuotaId: number) => Resultado<VistaPreviaDeEliminacion>
  'duplicados:sacarCuota': (cuotaId: number) => Resultado<ResultadoDeEliminacion>
  'duplicados:vistaPreviaBaja': (bajaId: number) => Resultado<VistaPreviaDeEliminacion>
  'duplicados:sacarBaja': (bajaId: number) => Resultado<ResultadoDeEliminacion>

  'config:estadoGoogle': () => Resultado<EstadoConexionGoogle>
  'config:guardarGoogle': (datos: DatosConexionGoogle) => Resultado<EstadoConexionGoogle>
  /**
   * Si la agencia tiene cargada la conexión con Google y si esta computadora la tiene. Lo pide TODO el
   * equipo (la credencial es obligatoria y sin ella no suben los respaldos ni los adjuntos), así que a
   * diferencia de `config:estadoGoogle` no lleva ni el correo de la cuenta ni la URL de la hoja.
   */
  'config:googleEnLaAgencia': () => Resultado<EstadoDeGoogleEnLaAgencia>
  /** El botón «Traerla ahora»: baja del VPS lo que cargó el superadministrador. Lo puede tocar cualquiera. */
  'config:traerGoogle': () => Resultado<EstadoDeGoogleEnLaAgencia>

  // La base del GENERAL DE CLIENTES en el VPS (v12): estado y migración inicial.
  'vps:estado': () => Resultado<EstadoMigracionVps>
  'vps:migrar': () => Resultado<ResumenMigracionVps>

  'importacion:vistaPrevia': () => Resultado<VistaPreviaHoja>
  'importacion:iniciar': () => Resultado<{ importacionId: number }>
  'importacion:cancelar': () => Resultado<null>
  'importacion:estado': () => Resultado<EstadoImportador>
  /** Abre el diálogo «Guardar como». Devuelve la ruta elegida o null si se canceló. */
  'importacion:guardarInforme': (importacionId: number) => Resultado<{ ruta: string | null }>
  'importacion:abrirCarpetaInformes': () => Resultado<null>

  'cartera:planilla': (periodo: string | null) => Resultado<PlanillaDelMes>
  'cartera:editarCelda': (filaId: string, campo: CampoEditable, valor: string) => Resultado<FilaCartera>
  /** Marca la fila como avisada y devuelve la dirección de WhatsApp lista para abrir. */
  'cartera:prepararAviso': (filaId: string) => Resultado<AvisoPreparado>
  /** Deja la fila como ENVIADO (y en «Avisados hoy») sin abrir WhatsApp. */
  'cartera:marcarAvisado': (filaId: string) => Resultado<FilaCartera>
  'cartera:registrarPago': (filaId: string, datos: DatosDePago) => Resultado<FilaCartera>
  /**
   * Imputa a la fila el pago adelantado que la esperaba (se cobró el mes anterior para este mes y
   * quedó pendiente): la fila queda paga con la fecha de ese cobro.
   */
  'cartera:imputarAdelanto': (filaId: string) => Resultado<FilaCartera>
  'cartera:darDeBaja': (filaId: string, datos: DatosDeBaja) => Resultado<null>
  /** Deshace una baja recién hecha en la aplicación: la fila vuelve al mes del que salió. */
  'cartera:deshacerBaja': (bajaId: number) => Resultado<FilaBaja[]>
  /**
   * «Poner vigente»: la póliza vuelve a la cartera en el mes abierto, sin cargarla de nuevo. Sirve
   * también para las bajas importadas de la hoja (el cliente que se fue en julio y vuelve en septiembre).
   * `cambios` corrige compañía, póliza/propuesta, cuota, fecha de venc y forma de pago al mismo tiempo:
   * es el caso del cliente que vuelve con otra compañía o con la cuota ya distinta.
   */
  'cartera:reactivarBaja': (bajaId: number, cambios?: CambiosDeReactivacion) => Resultado<ResultadoDeReactivacion>
  /** `periodo`: un mes puntual, `null` las bajas sin mes y `''` TODAS las bajas de cualquier mes. */
  'cartera:bajas': (periodo: string | null) => Resultado<FilaBaja[]>
  'cartera:cerrarMes': () => Resultado<ResumenCierreDeMes>
  'cartera:historialDeFila': (filaId: string) => Resultado<EntradaHistorial[]>
  /**
   * Deshace una entrada del historial (una edición de celda o un aviso marcado a mano) y devuelve la
   * fila ya actualizada. `EntradaHistorial.puedeDeshacerse` dice cuándo tiene sentido ofrecerlo.
   */
  'cartera:deshacerHistorial': (entradaId: number) => Resultado<FilaCartera>

  // Avisos de rechazo del débito automático: le rebotó el CBU a alguien y la sucursal que lo atiende
  // tiene que enterarse para llamarlo.
  /** Avisa a la sucursal de que a esta póliza le rebotó el débito. */
  'rechazos:avisar': (polizaId: number, datos: DatosDeRechazo) => Resultado<FilaRechazo>
  'rechazos:listar': (filtros: FiltrosRechazos) => Resultado<ListadoRechazos>
  'rechazos:cambiarEstado': (rechazoId: number, estado: EstadoDeRechazo, filtros: FiltrosRechazos) => Resultado<ListadoRechazos>
  /** Lo que mira la campana de rechazos: lo sin resolver de la sucursal de quien entró. */
  'rechazos:avisos': () => Resultado<AvisosDeRechazos>
  /** Abrir la campana cuenta como enterarse: lo pendiente de la sucursal pasa a «visto». */
  'rechazos:marcarVistos': () => Resultado<AvisosDeRechazos>
  /** Dar por resuelto un aviso desde la propia campana, sin ir a la pantalla. */
  'rechazos:resolver': (rechazoId: number) => Resultado<AvisosDeRechazos>

  'companias:listar': () => Resultado<Compania[]>
  'companias:editar': (id: number, datos: DatosDeCompania) => Resultado<Compania>

  // Cobranzas: la caja del día, la mora, la rendición de imputados y las comisiones.
  'cobranzas:caja': (fecha: string | null, sucursales: string[]) => Resultado<CajaDelDia>
  /** Alta manual de un pago. Con `cuotaFilaId` paga una fila de la planilla del mes. */
  'cobranzas:registrarPagoManual': (datos: DatosDePagoManual) => Resultado<CajaDelDia>
  /**
   * Abre el diálogo «Guardar como» con el día en un .xlsx con la forma de la planilla de caja de la
   * agencia. Devuelve la ruta o null si se canceló.
   */
  'cobranzas:exportarCaja': (fecha: string | null, sucursales: string[]) => Resultado<{ ruta: string | null }>
  /** Carga (o corrige) un renglón de la caja chica: la apertura, un gasto, una bajada o el cierre. */
  'cobranzas:guardarMovimientoCaja': (datos: DatosDeMovimientoDeCaja) => Resultado<CajaDelDia>
  /** Saca un renglón de la caja chica (un gasto mal cargado, una bajada que no fue). */
  'cobranzas:borrarMovimientoCaja': (movimientoId: number) => Resultado<CajaDelDia>
  /** El tilde de REVISIÓN DE PAGO de la planilla de caja. Devuelve la caja del día de ese pago. */
  'cobranzas:revisarPago': (pagoId: number, revisado: boolean) => Resultado<CajaDelDia>
  /** El número del comprobante (columna NRO TICKET), para cargarlo o corregirlo a mano. */
  'cobranzas:numeroDeTicket': (pagoId: number, numero: string) => Resultado<CajaDelDia>
  /** Anula un pago cargado por error: lo saca de la caja, la rendición y la hoja. */
  'cobranzas:anularPago': (pagoId: number, motivo: string) => Resultado<CajaDelDia>
  'cobranzas:mora': (filtros: FiltrosMora) => Resultado<ListadoMora>
  /** El mismo WhatsApp de la planilla, también para cuotas de meses ya cerrados. */
  'cobranzas:avisarMora': (filaId: string) => Resultado<AvisoDeMora>
  'cobranzas:imputados': (periodo: string | null, companias: string[], sucursales: string[]) => Resultado<RendicionImputados>
  'cobranzas:cambiarResultado': (
    pagoId: number,
    resultado: ResultadoImputacion,
    companias: string[],
    sucursales: string[],
  ) => Resultado<RendicionImputados>
  /** Sólo ADMIN y SUPER_ADMIN. */
  'cobranzas:comisiones': (periodo: string | null) => Resultado<ResumenComisiones>

  // Ticketeadora térmica (opcional). La configura cualquiera que tenga sesión: es la impresora del
  // mostrador, y quien cobra es quien se da cuenta de que hay que cambiarla o desactivarla.
  'impresora:estado': () => Resultado<ConfigImpresora>
  'impresora:guardar': (datos: DatosDeImpresora) => Resultado<ConfigImpresora>
  'impresora:prueba': () => Resultado<null>
  /** Las direcciones que encabezan el ticket, una por sucursal. */
  'impresora:direcciones': () => Resultado<DireccionDeSucursal[]>
  'impresora:guardarDirecciones': (direcciones: DireccionDeSucursal[]) => Resultado<DireccionDeSucursal[]>
  /**
   * El «sí» del cartel que pregunta si imprimir. Lo usa quien cobra, no un administrador. `copias` es
   * cuántos tickets sacar (1 o 2); sin mandarlo se usa lo guardado en Administración → Impresora.
   * Devuelve false si no había nada que imprimir (impresora apagada o el ticket falló: el motivo queda
   * en Administración → Impresora).
   */
  'impresora:imprimirPago': (pagoId: number, copias?: number) => Resultado<boolean>
  /** Corrige el número del próximo ticket, por ejemplo después de cambiar el rollo. */
  'impresora:establecerNumeroDeTicket': (numero: number) => Resultado<ConfigImpresora>

  'config:plantillaAviso': () => Resultado<PlantillaAviso>
  'config:guardarPlantillaAviso': (texto: string) => Resultado<PlantillaAviso>

  /**
   * En qué anda el canal en vivo con la base de la agencia (14.0). Lo pide el proveedor de conexión
   * del renderer al montarse, para no arrancar en blanco: después se entera de los cambios por el
   * evento del mismo nombre. Sin sesión abierta también contesta —el Login mira si hay servidor— y
   * por eso no exige nada más que estar del otro lado del IPC.
   */
  'conexion:estado': () => Resultado<EstadoDeConexion>

  // La foto y el color de cada persona de la agencia (14.0). La lista sale del espejo local, así que
  // contesta igual sin internet; los dos «guardar» hablan con el servidor, que es el que cuida que no
  // haya dos personas con el mismo color.
  'perfiles:listar': () => Resultado<PerfilDeUsuario[]>
  'perfiles:guardarMio': (datos: DatosDePerfil) => Resultado<PerfilDeUsuario>
  /** El perfil de OTRA persona: es de administradores (la foto del que no se la carga, un color repetido). */
  'perfiles:guardarDe': (clave: string, datos: DatosDePerfil) => Resultado<PerfilDeUsuario>

  /**
   * En qué está trabajando esta computadora (14.0): la celda, la ficha o la pantalla donde está parada
   * la persona. Es lo único que escribe SIN exigir conexión: sin canal el frame no sale y listo, un foco
   * que no llegó no descoloca ningún dato (ver `ipc.ts`).
   */
  'vivo:foco': (foco: Foco | null) => Resultado<null>
  /** Quién está conectado y en qué. La foto completa, tal como la mandó el servidor. */
  'vivo:presencia': () => Resultado<Presente[]>

  // Llamadas de voz de a dos (14.0). La señalización pasa por el canal; el audio va derecho de una
  // computadora a la otra y lo maneja el renderer, que es el dueño de la RTCPeerConnection.
  'llamadas:invitar': (conversacionId: number) => Resultado<EstadoDeLlamada>
  'llamadas:aceptar': () => Resultado<EstadoDeLlamada>
  'llamadas:rechazar': () => Resultado<EstadoDeLlamada>
  'llamadas:colgar': () => Resultado<EstadoDeLlamada>
  /** Lo que produjo la RTCPeerConnection para la otra punta: la oferta o la respuesta, y los candidatos. */
  'llamadas:senal': (llamadaId: string, senal: SenalParaMandar) => Resultado<null>
  /** Los STUN y el TURN del VPS, tal como vinieron en el saludo del canal. Null si todavía no saludó. */
  'llamadas:ice': () => Resultado<ConfiguracionDeIce | null>
  'llamadas:estado': () => Resultado<EstadoDeLlamada>

  'sincronizacion:estado': () => Resultado<EstadoSincronizacion>
  'sincronizacion:panel': () => Resultado<PanelSincronizacion>
  /** Sube lo pendiente y baja lo que haya. Con `completa`, relee todas las pestañas. */
  'sincronizacion:ahora': (completa: boolean) => Resultado<EstadoSincronizacion>
  'sincronizacion:reintentar': () => Resultado<number>
  'sincronizacion:respaldarAhora': () => Resultado<boolean>

  // Respaldos del GENERAL DE CLIENTES guardados EN EL SERVIDOR. Son otra cosa que los .xlsx de
  // `sincronizacion:respaldarAhora`, que son de esta computadora: éstos los hace el reloj del VPS y
  // se pueden rebobinar.
  /** Los últimos que guardó el servidor, del más nuevo al más viejo. */
  'respaldos:listar': () => Resultado<RespaldoDelVps[]>
  /** Guarda uno ahora mismo, sin esperar al reloj. Es idempotente por día. */
  'respaldos:crear': () => Resultado<RespaldoDelVps[]>
  /** Rebobina: deja la base del servidor —y la de esta computadora— como estaban ese día. */
  'respaldos:restaurar': (id: number) => Resultado<ResumenDeRestauracion>

  // Clientes: el listado, la ficha y el alta sin duplicados. Los trabaja todo el equipo.
  'clientes:listar': (filtros: FiltrosClientes) => Resultado<ListadoClientes>
  /** Buscador del formulario de póliza: pocas filas, para el desplegable. */
  'clientes:buscar': (busqueda: string) => Resultado<FilaCliente[]>
  'clientes:ficha': (clienteId: number) => Resultado<FichaCliente>
  /** Si el DNI/CUIT ya existe devuelve el cliente existente en vez de duplicarlo. */
  /** Las localidades ya cargadas, para sugerirlas al escribir una dirección. */
  'clientes:localidades': () => Resultado<string[]>
  'clientes:crear': (datos: DatosDeCliente) => Resultado<ResultadoAltaCliente>
  'clientes:editar': (clienteId: number, datos: DatosDeCliente) => Resultado<FichaCliente>
  'clientes:agregarNota': (clienteId: number, texto: string) => Resultado<NotaDeCliente[]>
  'clientes:crearTarea': (datos: DatosDeTarea) => Resultado<TareaDeCliente[]>
  'clientes:cambiarEstadoDeTarea': (tareaId: number, estado: EstadoTarea) => Resultado<TareaDeCliente[]>
  /** Las cuotas del mes abierto del cliente: lo que se puede pagar desde su ficha. */
  'clientes:cuotasDelMes': (clienteId: number) => Resultado<CuotasDelCliente>
  /** Buscador de deudores: las cuotas impagas que pasan los filtros del diálogo. */
  'clientes:deudores': (filtros: FiltrosDeudores) => Resultado<ListadoDeudores>
  /**
   * El mismo listado en .xlsx o .txt. Con `ruta` en null abre «Guardar como» y devuelve la ruta
   * elegida (o null si se canceló); con una ruta escribe ahí, que es lo que hace la prueba de humo.
   */
  'clientes:exportarDeudores': (
    filtros: FiltrosDeudores,
    formato: FormatoDeDeudores,
    ruta: string | null,
  ) => Resultado<{ ruta: string | null }>

  // Siniestros: el listado mensual, la ficha con seguimiento y el alta rápida.
  /** Alta desde la ficha del cliente: devuelve los siniestros de ese cliente. */
  'siniestros:crear': (datos: DatosDeSiniestro) => Resultado<SiniestroDeCliente[]>
  'siniestros:listar': (filtros: FiltrosSiniestros) => Resultado<ListadoSiniestros>
  'siniestros:ficha': (siniestroId: number) => Resultado<FichaSiniestro>
  /** Buscador del alta rápida: por patente, nombre, DNI o número de póliza. */
  'siniestros:buscar': (busqueda: string) => Resultado<CandidatoDeSiniestro[]>
  /** Alta desde el módulo: devuelve la ficha recién creada. */
  'siniestros:alta': (datos: DatosDeSiniestro) => Resultado<FichaSiniestro>
  'siniestros:cambiarEstado': (siniestroId: number, estado: EstadoSiniestro) => Resultado<FichaSiniestro>
  'siniestros:editar': (siniestroId: number, campo: string, valor: string) => Resultado<FichaSiniestro>
  'siniestros:agregarObservacion': (siniestroId: number, texto: string) => Resultado<FichaSiniestro>
  /**
   * Adjunta documentos: copia los archivos a la carpeta del siniestro y sube una copia al Drive si se
   * puede. Con `rutas` en null abre el diálogo para elegirlos, que es lo que hace la pantalla; con una
   * lista adjunta ésas (lo usa la prueba de humo, que no puede tocar un diálogo del sistema).
   *
   * `categoria` dice qué documento es (denuncia, cédula verde, constancia médica…) y vale para toda la
   * tanda. En «Otras documentaciones» hace falta además el `detalle`, que es el «indicando cuál».
   */
  'siniestros:adjuntar': (
    siniestroId: number,
    rutas: string[] | null,
    categoria: CategoriaDeAdjunto,
    detalle?: string,
  ) => Resultado<FichaSiniestro>
  /**
   * Los archivos que vienen de la pantalla (arrastrados, pegados o elegidos, ya achicados si eran
   * fotos): los bytes viajan por acá, no hay ruta en el disco. Es el camino de la 12.6.
   */
  'siniestros:adjuntarArchivos': (
    siniestroId: number,
    archivos: ArchivoParaAdjuntar[],
    categoria: CategoriaDeAdjunto,
    detalle?: string,
  ) => Resultado<FichaSiniestro>
  /** Abre el documento con el programa del sistema; si lo cargó otra computadora, lo baja del servidor antes. */
  'siniestros:abrirAdjunto': (adjuntoId: number) => Resultado<null>
  /** Borrar un documento es definitivo: sólo ADMIN y SUPER_ADMIN. */
  'siniestros:borrarAdjunto': (adjuntoId: number) => Resultado<FichaSiniestro>
  'siniestros:crearTarea': (datos: DatosDeTareaDeSiniestro) => Resultado<FichaSiniestro>
  'siniestros:cambiarEstadoDeTarea': (tareaId: number, estado: EstadoTarea) => Resultado<FichaSiniestro>

  // Riesgos varios (Cartera → Riesgos varios)
  'riesgos:listar': () => Resultado<ListadoRiesgos>
  'riesgos:editar': (riesgoId: number, campo: CampoDeRiesgo, valor: string) => Resultado<FilaRiesgoVario>
  'riesgos:crear': (datos: DatosDeRiesgo) => Resultado<ListadoRiesgos>

  // AMP: las ampliaciones pendientes (Cartera → AMP)
  'amp:listar': (incluirResueltas: boolean) => Resultado<ListadoAmp>
  'amp:cambiarResuelto': (ampId: number, resuelto: boolean, incluirResueltas: boolean) => Resultado<ListadoAmp>

  // Pólizas
  'polizas:listar': (filtros: FiltrosPolizas) => Resultado<ListadoPolizas>
  'polizas:ver': (polizaId: number) => Resultado<PolizaDeCliente>
  'polizas:deCliente': (clienteId: number) => Resultado<PolizaDeCliente[]>
  'polizas:vehiculosDeCliente': (clienteId: number) => Resultado<VehiculoDeCliente[]>
  'polizas:catalogos': () => Resultado<CatalogosDePoliza>
  /** Compañía + cobertura + año del vehículo contra la matriz de reglas. */
  'polizas:validarCobertura': (compania: string, cobertura: string, anioVehiculo: string) => Resultado<AvisoDeCobertura>
  'polizas:crear': (datos: DatosDePoliza) => Resultado<PolizaDeCliente>
  'polizas:editar': (polizaId: number, datos: DatosDePoliza) => Resultado<PolizaDeCliente>
  'polizas:darDeBaja': (polizaId: number, datos: DatosDeBaja) => Resultado<null>
  /** Fotos y documentos de la póliza (12.6): viven en el VPS y se ven desde cualquier computadora. */
  'polizas:adjuntos': (polizaId: number) => Resultado<AdjuntoDePoliza[]>
  'polizas:adjuntarArchivos': (polizaId: number, archivos: ArchivoParaAdjuntar[]) => Resultado<AdjuntoDePoliza[]>
  /** Con rutas del disco (el explorador de archivos, o la prueba de humo); `null` abre el explorador. */
  'polizas:adjuntar': (polizaId: number, rutas: string[] | null) => Resultado<AdjuntoDePoliza[]>
  'polizas:abrirAdjunto': (adjuntoId: number) => Resultado<null>
  'polizas:borrarAdjunto': (adjuntoId: number) => Resultado<AdjuntoDePoliza[]>

  // Reglas de cobertura: las ve todo el equipo, las edita sólo el SUPER_ADMIN.
  'reglas:matriz': () => Resultado<MatrizDeCobertura>
  'reglas:crear': (datos: DatosDeRegla) => Resultado<MatrizDeCobertura>
  'reglas:editar': (id: number, datos: DatosDeRegla) => Resultado<MatrizDeCobertura>
  'reglas:borrar': (id: number) => Resultado<MatrizDeCobertura>
  /** Las reglas ya armadas, para avisar en la pantalla mientras se completa el formulario. */
  'reglas:vigentes': () => Resultado<ReglaDeCobertura[]>

  // Módulo Compañías: las cinco listas de consulta del mostrador. Las mira todo el equipo que tenga
  // el módulo; las carga sólo el SUPER_ADMIN, igual que la matriz de coberturas.
  //
  // Todas las que escriben devuelven las listas enteras: son cortas (decenas de filas, no miles) y
  // devolverlas evita que la pantalla quede mostrando lo de antes después de guardar.
  'referencias:listas': () => Resultado<ListasDeCompanias>
  /** Qué le ofrece cada compañía a un vehículo de ese año, según la matriz de reglas de Cartera. */
  'referencias:antiguedad': (anio: string) => Resultado<ConsultaDeAntiguedad>
  'referencias:guardarOrganizador': (id: number | null, datos: DatosDeOrganizador) => Resultado<ListasDeCompanias>
  'referencias:borrarOrganizador': (id: number) => Resultado<ListasDeCompanias>
  /** Sube o baja un organizador en el orden en que se le escribe. */
  'referencias:moverOrganizador': (id: number, direccion: 'arriba' | 'abajo') => Resultado<ListasDeCompanias>
  'referencias:guardarPrecio': (id: number | null, datos: DatosDePrecio) => Resultado<ListasDeCompanias>
  'referencias:borrarPrecio': (id: number) => Resultado<ListasDeCompanias>
  'referencias:guardarGrua': (id: number | null, datos: DatosDeGrua) => Resultado<ListasDeCompanias>
  'referencias:borrarGrua': (id: number) => Resultado<ListasDeCompanias>
  'referencias:guardarClausula': (id: number | null, datos: DatosDeClausula) => Resultado<ListasDeCompanias>
  'referencias:borrarClausula': (id: number) => Resultado<ListasDeCompanias>
  /** Cómo están las listas en el servidor y si esta computadora tiene lo mismo. */
  'referencias:estadoCompartido': () => Resultado<EstadoDeReferencias>
  /** Manda las cuatro listas al VPS para que el resto de las computadoras las adopte. */
  'referencias:publicar': () => Resultado<EstadoDeReferencias>
  /** Trae del VPS lo que publicó el superadministrador y pisa lo de esta computadora. */
  'referencias:adoptar': () => Resultado<{ adoptadas: boolean; detalle: string; listas: ListasDeCompanias }>

  // Renovaciones
  'renovaciones:bandeja': () => Resultado<BandejaRenovaciones>
  /** Lo que el diálogo de «Renovar» propone: +1 año y la cuota anterior, editables. */
  'renovaciones:sugerencia': (polizaId: number) => Resultado<DatosDeRenovacion>
  'renovaciones:actualizar': (polizaId: number, venceEl: string, datos: DatosDeSeguimiento) => Resultado<BandejaRenovaciones>
  'renovaciones:renovar': (polizaId: number, datos: DatosDeRenovacion) => Resultado<BandejaRenovaciones>
  'renovaciones:noRenueva': (polizaId: number, datos: DatosDeBaja) => Resultado<BandejaRenovaciones>

  // Leads: la consulta que todavía no es cliente. La trabaja todo el equipo.
  'leads:listar': (filtros: FiltrosLeads) => Resultado<ListadoLeads>
  'leads:ficha': (leadId: number) => Resultado<FichaLead>
  'leads:crear': (datos: DatosDeLead) => Resultado<FichaLead>
  'leads:editar': (leadId: number, datos: DatosDeLead) => Resultado<FichaLead>
  'leads:cambiarEstado': (leadId: number, estado: EstadoLead) => Resultado<FichaLead>
  'leads:agregarNota': (leadId: number, texto: string) => Resultado<FichaLead>
  /** Crea el cliente con los datos del lead (o devuelve el que ya existía con ese DNI/CUIT). */
  'leads:convertir': (leadId: number) => Resultado<ResultadoConversion>

  // Presupuestos
  'presupuestos:listar': (filtros: FiltrosPresupuestos) => Resultado<ListadoPresupuestos>
  'presupuestos:ficha': (presupuestoId: number) => Resultado<FichaPresupuesto>
  'presupuestos:crear': (datos: DatosDePresupuesto) => Resultado<FichaPresupuesto>
  /** En BORRADOR guarda encima; si ya está ENVIADO crea la versión siguiente. */
  'presupuestos:guardar': (presupuestoId: number, datos: DatosDePresupuesto) => Resultado<FichaPresupuesto>
  /** Devuelve la dirección de WhatsApp lista para abrir y lo deja en ENVIADO. */
  'presupuestos:enviar': (presupuestoId: number) => Resultado<EnvioDePresupuesto>
  'presupuestos:aceptar': (presupuestoId: number, opcionId: number) => Resultado<AceptacionDePresupuesto>
  'presupuestos:rechazar': (presupuestoId: number, motivo: string) => Resultado<FichaPresupuesto>
  /** Abre el diálogo «Guardar como» con el presupuesto en PDF. Devuelve la ruta o null si se canceló. */
  'presupuestos:guardarPdf': (presupuestoId: number) => Resultado<{ ruta: string | null }>
  /** Manda el presupuesto a la impresora que elija el usuario. false = se canceló el diálogo. */
  'presupuestos:imprimir': (presupuestoId: number) => Resultado<boolean>
  /** Las cotizaciones en PDF (u otro documento) que mandó cada compañía: viven en el VPS. */
  'presupuestos:adjuntos': (presupuestoId: number) => Resultado<AdjuntoDePresupuesto[]>
  'presupuestos:adjuntarArchivos': (presupuestoId: number, archivos: ArchivoParaAdjuntar[]) => Resultado<AdjuntoDePresupuesto[]>
  /** Con rutas del disco (el explorador de archivos, o la prueba de humo); `null` abre el explorador. */
  'presupuestos:adjuntar': (presupuestoId: number, rutas: string[] | null) => Resultado<AdjuntoDePresupuesto[]>
  'presupuestos:abrirAdjunto': (adjuntoId: number) => Resultado<null>
  'presupuestos:borrarAdjunto': (adjuntoId: number) => Resultado<AdjuntoDePresupuesto[]>

  // Mensajería interna (12.8): el chat entre los usuarios de la agencia.
  //
  // Todas las que escriben devuelven lo que la pantalla tiene que mostrar después, no un ok pelado:
  // es la misma regla que el resto del contrato y evita que quede dibujado lo de antes.
  'mensajes:conversaciones': () => Resultado<ConversacionInterna[]>
  /** Con quién se puede hablar: los usuarios activos de la agencia, menos uno mismo. */
  'mensajes:contactos': () => Resultado<ContactoDeMensajeria[]>
  /** Abre la conversación con alguien, o devuelve la que ya estaba. Necesita conexión. */
  'mensajes:abrirCon': (claveDelDestinatario: string) => Resultado<ConversacionInterna>
  'mensajes:crearGrupo': (titulo: string, claves: string[]) => Resultado<ConversacionInterna>
  /** El hilo. Con `antesDeId` trae los anteriores a ése, que es el «Ver mensajes anteriores». */
  'mensajes:hilo': (conversacionId: number, antesDeId: number | null) => Resultado<HiloDeMensajes>
  /**
   * Deja el mensaje en la cola y lo devuelve tal como se ve. NO espera al servidor: escribir nunca se
   * queda esperando a la red, y lo escrito sin internet sale solo cuando vuelve.
   */
  'mensajes:enviar': (conversacionId: number, cuerpo: string, archivos: ArchivoParaAdjuntar[]) => Resultado<MensajeInterno>
  /**
   * Manda con archivos elegidos en el diálogo del sistema: se leen en el proceso principal y no viajan
   * por IPC, que es lo que evita que un video de 200 MB congele la ventana.
   *
   * `archivos` son los que la persona ya había arrastrado o pegado antes de tocar el clip: van en el
   * mismo mensaje. Sin esto, abrir el diálogo con algo ya elegido lo perdería sin decir nada.
   */
  'mensajes:enviarConArchivos': (
    conversacionId: number,
    cuerpo: string,
    rutas: string[] | null,
    archivos: ArchivoParaAdjuntar[],
  ) => Resultado<MensajeInterno>
  /**
   * El zumbido: suena fuerte del otro lado y le sacude la ventana. NO pasa por la cola —sin conexión
   * devuelve error en vez de esperar—, porque un zumbido que llega media hora tarde no llama la
   * atención sobre nada. Devuelve el mensaje para que la pantalla lo dibuje en el hilo.
   */
  'mensajes:zumbar': (conversacionId: number) => Resultado<MensajeInterno>
  /**
   * La reacción de WhatsApp (14.0): pone el emoji, lo cambia o lo saca (con `null`, o con el mismo que
   * ya estaba). Tampoco pasa por la cola: una reacción es un tilde sobre algo de otro, y con el canal
   * caído no se manda. Devuelve el mensaje con su lista de reacciones al día.
   */
  'mensajes:reaccionar': (mensajeId: number, emoji: string | null) => Resultado<MensajeInterno>
  /** Volver a intentar uno que el servidor rechazó. */
  'mensajes:reintentar': (mensajeId: number) => Resultado<MensajeInterno>
  /** La confirmación de lectura: apaga el globito y se lo cuenta al servidor. */
  'mensajes:marcarLeidos': (conversacionId: number) => Resultado<AvisosDeMensajes>
  /** Lo que mira la campana de la barra superior. */
  'mensajes:avisos': () => Resultado<AvisosDeMensajes>
  'mensajes:borrar': (mensajeId: number) => Resultado<null>
  'mensajes:abrirAdjunto': (adjuntoId: number) => Resultado<null>
  /** El contenido de una imagen como `data:` URL. Es lo que hace que un GIF se mueva en la burbuja. */
  'mensajes:contenidoDeAdjunto': (adjuntoId: number) => Resultado<string>
  'mensajes:borrarAdjunto': (adjuntoId: number) => Resultado<AdjuntoDeMensaje[]>
  'mensajes:estado': () => Resultado<EstadoDeMensajeria>
  /** El registro de todos los mensajes de todos. Sólo SUPER_ADMIN; el corte lo hace el servidor. */
  'mensajes:registro': (filtros: FiltrosDelLogDeMensajes) => Resultado<LogDeMensajes>

  // Tareas
  'tareas:listar': (filtros: FiltrosTareas) => Resultado<ListadoTareas>
  'tareas:ficha': (tareaId: number) => Resultado<FichaTarea>
  'tareas:crear': (datos: DatosDeTareaCompleta) => Resultado<FilaTarea>
  'tareas:editar': (tareaId: number, datos: DatosDeEdicionDeTarea) => Resultado<FichaTarea>
  'tareas:cambiarEstado': (tareaId: number, estado: EstadoTarea) => Resultado<FilaTarea>
  'tareas:comentar': (tareaId: number, texto: string) => Resultado<FichaTarea>
  /** Con `rutas` en null abre el diálogo para elegir los archivos, que es lo que hace la pantalla. */
  'tareas:adjuntar': (tareaId: number, rutas: string[] | null) => Resultado<FichaTarea>
  'tareas:adjuntarArchivos': (tareaId: number, archivos: ArchivoParaAdjuntar[]) => Resultado<FichaTarea>
  'tareas:abrirAdjunto': (adjuntoId: number) => Resultado<null>
  /** Borrar un documento es definitivo: sólo ADMIN y SUPER_ADMIN. */
  'tareas:borrarAdjunto': (adjuntoId: number) => Resultado<FichaTarea>
  /** Las tareas abiertas de quien está usando la aplicación: es lo que muestra Inicio. */
  'tareas:mias': () => Resultado<FilaTarea[]>
  /** Lo que mira la campana de la barra superior. */
  'tareas:avisos': () => Resultado<AvisosDeTareas>
  /** Abrir la campana cuenta como enterarse: apaga el punto de las tareas nuevas. */
  'tareas:marcarVistos': () => Resultado<AvisosDeTareas>

  // Métricas: el tablero con filtros globales y su versión tabular (Cartera → Estadísticas).
  'metricas:tablero': (filtros: FiltrosMetricas) => Resultado<TableroMetricas>
  'metricas:estadisticas': (periodo: string | null, sucursales: string[]) => Resultado<EstadisticasDeCartera>
  // El podio de sucursales por altas del mes: sin permiso de área, lo ve cualquiera que entró. Lo
  // calcula el servidor (13.2): `null` es «esta computadora todavía no recibió ningún podio», que hoy
  // es lo mismo que mostraba la pantalla mientras no había mes anterior cargado.
  'metricas:podio': () => Resultado<PodioMensual | null>
  /**
   * Qué pólizas son esas altas, una por una. A diferencia del podio, esto SÍ pide el permiso de
   * Cartera: el cartel muestra un número y esto muestra los nombres de los clientes, que es el dato de
   * Cartera y no una competencia. Sin ese recorte, el podio sería una puerta de atrás al listado.
   */
  'metricas:altas': (periodo: string | null, sucursal: string | null) => Resultado<DetalleDeAltas>

  // Reportes: el centro de exportación.
  'reportes:catalogo': () => Resultado<CatalogoDeReportes>

  // «General Excel»: los mismos datos de cada módulo, en formato planilla. El catálogo trae sólo las
  // áreas que quien pregunta puede ver, y las filas exigen el permiso de ESE módulo, no el de Reportes.
  'excel:catalogo': () => Resultado<CatalogoDeExcel>
  'excel:filas': (pedido: PedidoDeReporte) => Resultado<FilasDeReporte>
  /**
   * El .xlsx de lo que se está viendo. Va aparte de 'reportes:exportar' porque pide el permiso del
   * MÓDULO y no el de Reportes: la pantalla se abre con el permiso del módulo, así que exigir otro
   * para bajar lo mismo que ya está a la vista sería un botón que nunca funciona.
   */
  'excel:exportar': (pedido: PedidoDeReporte) => Resultado<{ ruta: string | null }>
  'reportes:vistaPrevia': (pedido: PedidoDeReporte) => Resultado<VistaPreviaDeReporte>
  /**
   * Con `ruta` en null abre el diálogo «Guardar como», que es lo que hace la pantalla, y devuelve la
   * ruta elegida (o null si se canceló). Con una ruta escribe ahí directamente: lo usa la prueba de
   * humo, que no puede manejar un diálogo del sistema desde afuera.
   */
  'reportes:exportar': (pedido: PedidoDeReporte, formato: FormatoDeReporte, ruta: string | null) => Resultado<{ ruta: string | null }>
  /** El .xlsx con el formato de la hoja de siempre: una pestaña por mes y su BAJAS. */
  'reportes:planillaClasica': (opciones: OpcionesPlanillaClasica, ruta: string | null) => Resultado<{ ruta: string | null }>

  // Marketing: las plantillas de WhatsApp y los segmentos guardados de la cartera.
  'marketing:plantillas': () => Resultado<PlantillaDeMensaje[]>
  'marketing:crearPlantilla': (datos: DatosDePlantilla) => Resultado<PlantillaDeMensaje[]>
  'marketing:editarPlantilla': (clave: string, datos: DatosDePlantilla) => Resultado<PlantillaDeMensaje[]>
  'marketing:borrarPlantilla': (clave: string) => Resultado<PlantillaDeMensaje[]>
  /** Con `segmentoId` en null se mira un filtro suelto, que es como se arman antes de guardarlos. */
  'marketing:segmento': (
    segmentoId: number | null,
    filtros: FiltrosDeSegmento | null,
    plantillaClave: string,
  ) => Resultado<ResultadoDeSegmento>
  'marketing:guardarSegmento': (segmentoId: number | null, datos: DatosDeSegmento) => Resultado<ResultadoDeSegmento>
  'marketing:borrarSegmento': (segmentoId: number) => Resultado<ResultadoDeSegmento>
  /** Avisar una fila del segmento: devuelve la dirección de WhatsApp lista para abrir. Uno a uno. */
  'marketing:avisar': (
    filaId: string,
    segmentoId: number | null,
    filtros: FiltrosDeSegmento | null,
    plantillaClave: string,
  ) => Resultado<AvisoDeSegmento>

  // Catálogo de vehículos (autos y motos por API). Los desplegables salen SIEMPRE de la caché local:
  // dibujar un desplegable no sale a internet. A internet se sale con 'vehiculos:refrescar'.
  'vehiculos:estado': () => Resultado<EstadoDelCatalogo>
  /**
   * Guarda las credenciales acá y —si lo hace el superadministrador— las manda al VPS en el mismo
   * movimiento, para que el resto de las computadoras las adopte al abrir el programa.
   */
  'vehiculos:guardarCredenciales': (datos: DatosDelProveedorDeVehiculos) => Resultado<GuardadoDeCredencialesDeVehiculos>
  /** Reintento manual de la publicación, para cuando el guardado la encontró sin conexión. */
  'vehiculos:publicar': () => Resultado<EstadoDeAjusteCompartido>
  /** Cómo está el ajuste en el VPS. Va aparte de 'vehiculos:estado' porque sale a la red. */
  'vehiculos:estadoCompartido': () => Resultado<EstadoDeAjusteCompartido>
  /** Trae a mano lo que cargó el superadministrador, sin esperar al próximo arranque. */
  'vehiculos:adoptar': () => Resultado<AdopcionDeCredencialesDeVehiculos>
  /** `tambienDelServidor` sólo lo puede pedir el superadministrador: deja sin catálogo a todas. */
  'vehiculos:borrarCredenciales': (tambienDelServidor?: boolean) => Resultado<EstadoDeCredencialesDeVehiculos>
  'vehiculos:probar': () => Resultado<PruebaDelProveedor>
  /** `tipo` en null refresca autos y motos. Puede tardar: el avance llega por 'vehiculos:progreso'. */
  'vehiculos:refrescar': (tipo: TipoDeVehiculo | null) => Resultado<EstadoDelCatalogo>
  'vehiculos:marcas': (tipo: TipoDeVehiculo) => Resultado<OpcionDeCatalogo[]>
  'vehiculos:modelos': (tipo: TipoDeVehiculo, marcaId: string) => Resultado<OpcionDeCatalogo[]>
  'vehiculos:lineas': (tipo: TipoDeVehiculo, marcaId: string, modeloId: string) => Resultado<LineaDeCatalogo[]>
  'vehiculos:anios': (tipo: TipoDeVehiculo, marcaId: string, modeloId: string, lineaId: string) => Resultado<number[]>
  /** El vehículo terminado, con la categoría que decide el catálogo y que no se puede elegir. */
  'vehiculos:resolver': (
    tipo: TipoDeVehiculo,
    marcaId: string,
    modeloId: string,
    lineaId: string,
    anio: string,
  ) => Resultado<VehiculoDelCatalogo>

  // Galeno Seguros: la cuenta, cotización, emisión y los reportes de sólo lectura (Consultas, Cuenta
  // Corriente y ART). El detalle de una API entera de un tercero — nombres de campo, formas de las
  // respuestas — vive en main/aseguradoras/galeno/*; acá sólo está el contrato con el renderer.
  'galeno:estado': () => Resultado<EstadoDeGaleno>
  'galeno:guardarCredenciales': (datos: DatosDeGaleno) => Resultado<EstadoDeGaleno>
  'galeno:borrarCredenciales': () => Resultado<EstadoDeGaleno>
  'galeno:probar': () => Resultado<PruebaDeGaleno>
  // Listas de valores para los diálogos de Cotizar y Emitir.
  'galeno:planesComerciales': (tipoVehiculo: TipoDeVehiculo) => Resultado<OpcionGaleno[]>
  'galeno:marcas': (tipoVehiculo: TipoDeVehiculo) => Resultado<OpcionGaleno[]>
  'galeno:modelos': (marcaCodigo: string) => Resultado<OpcionGaleno[]>
  'galeno:anios': (marcaCodigo: string, modeloCodigo: string) => Resultado<OpcionGaleno[]>
  'galeno:subModelos': (marcaCodigo: string, modeloCodigo: string, anio: string) => Resultado<SubModeloGaleno[]>
  'galeno:tiposDePersona': () => Resultado<OpcionGaleno[]>
  'galeno:codigoPostal': (tipoVehiculo: TipoDeVehiculo, codigoPostal: string) => Resultado<CodigoPostalGaleno[]>
  'galeno:modosDeFacturacion': (tipoVehiculo: TipoDeVehiculo, planComercialCodigo: string) => Resultado<OpcionGaleno[]>
  'galeno:condicionesDePago': (tipoVehiculo: TipoDeVehiculo, modoFacturacionCodigo: string) => Resultado<OpcionGaleno[]>
  'galeno:formasDePago': (tipoVehiculo: TipoDeVehiculo, modoFacturacionCodigo: string, planComercialCodigo: string) => Resultado<OpcionGaleno[]>
  'galeno:equipoGnc': () => Resultado<OpcionGaleno[]>
  'galeno:equiposDeRastreo': () => Resultado<OpcionGaleno[]>
  'galeno:clausulasDeAjuste': () => Resultado<OpcionGaleno[]>
  'galeno:accesorios': () => Resultado<OpcionGaleno[]>
  'galeno:categoriasIva': () => Resultado<OpcionGaleno[]>
  'galeno:codigosIIBB': () => Resultado<OpcionGaleno[]>
  'galeno:tiposDeUso': () => Resultado<OpcionGaleno[]>
  'galeno:tiposDeDocumento': () => Resultado<OpcionGaleno[]>
  'galeno:nacionalidades': () => Resultado<OpcionGaleno[]>
  'galeno:sexos': () => Resultado<OpcionGaleno[]>
  'galeno:estadosCiviles': () => Resultado<OpcionGaleno[]>
  'galeno:bancos': () => Resultado<OpcionGaleno[]>
  'galeno:tarjetasDeCredito': () => Resultado<OpcionGaleno[]>
  /** Guarda en el `solicitud`/`instalacion`/`cobertura` que se usan después para emitir. */
  'galeno:cotizar': (datos: DatosDeCotizacionGaleno) => Resultado<CotizacionGaleno>
  'galeno:emitir': (datos: DatosDeEmisionGaleno) => Resultado<EmisionGaleno>
  'galeno:emitirConInspeccion': (datos: DatosDeEmisionGaleno) => Resultado<EmisionGaleno>
  /** Uno solo para los ocho reportes de Consultas + Cuenta Corriente + ART: ver `ReporteDeGaleno`. */
  'galeno:reporte': (tipo: ReporteDeGaleno, filtros: FiltrosDeReporteGaleno) => Resultado<ReporteGaleno>
  /** El detalle de una póliza no es tabular (trae tomador, riesgos y cuotas anidados). */
  'galeno:detalleDePoliza': (rama: number, poliza?: string, nroRiesgo?: string) => Resultado<unknown>
  'galeno:detalleDeLiquidaciones': (filtros: FiltrosDeReporteGaleno) => Resultado<ReporteGaleno>
  /** Guarda el PDF en una carpeta temporal y devuelve la ruta; el renderer pide abrirlo aparte. */
  'galeno:imprimir': (pedido: PedidoDeImpresionGaleno) => Resultado<ImpresionGaleno>

  // Cartera → Galeno NOVEDADES (15.4). Distinto canal y distinto nombre que el bloque de arriba a
  // propósito: esto NO es la API REST de Galeno (cotización/emisión), es la sincronización con el
  // portal de Galeno que corre en el VPS —está siempre encendido y tiene una sola credencial—; esta
  // computadora baja lo que cambió y lo aplica a la cartera por `crearPoliza`/`editarPoliza`, que es
  // donde viven las reglas de la agencia.
  //
  // Ninguna baja es automática: una póliza anulada en Galeno se marca y se avisa, y la da de baja una
  // persona desde la pantalla de la póliza.
  'galenoNovedades:estado': () => Resultado<EstadoDeGalenoNovedades>
  /** Las novedades pendientes, ya emparejadas contra los clientes de esta computadora. */
  'galenoNovedades:bandeja': () => Resultado<FilaDeBandejaDeGaleno[]>
  /**
   * Aplica una novedad. Sin `clienteId` ni `crearElCliente` sólo funciona cuando el documento
   * emparejó con un único cliente; en cualquier otro caso hay que decir con cuál va.
   */
  'galenoNovedades:aplicar': (id: number, clienteId?: number | null, crearElCliente?: boolean) => Resultado<number | null>
  'galenoNovedades:descartar': (id: number, motivo: string) => Resultado<null>
  /** Aplica de una sola vez todo lo que no necesita a nadie. Es lo que corre al abrir el programa. */
  'galenoNovedades:drenar': () => Resultado<ResumenDeAplicacionDeGaleno>
  /** El botón «Sincronizar ahora»: fuerza una pasada en el servidor sin esperar los quince minutos. */
  'galenoNovedades:sincronizar': () => Resultado<ResumenDePasadaDeGaleno>
  /** Prueba las credenciales contra el portal de Galeno sin guardar ni tocar nada. */
  'galenoNovedades:probar': () => Resultado<PruebaDeGalenoNovedades>
  /** Cómo está la credencial del portal en el VPS, para Ajustes compartidos. */
  'galenoNovedades:estadoCompartido': () => Resultado<EstadoDeAjusteCompartido>
  /** Sólo el superadministrador: carga el usuario y la clave y los publica cifrados en el VPS. */
  'galenoNovedades:guardarCredenciales': (datos: CredencialesDeGaleno) => Resultado<EstadoDeAjusteCompartido>

  // Marketing → Redes: publicar en la Página de Facebook/Instagram de cada sucursal. El App ID y el
  // App Secret se cargan en Administración; el token de cada Página vive cifrado en el servidor del
  // VPS y esta computadora nunca lo guarda.
  'redes:panel': () => Resultado<PanelDeRedes>
  'redes:estadoMeta': () => Resultado<EstadoDeMeta>
  'redes:guardarMeta': (datos: DatosDeMeta) => Resultado<EstadoDeMeta>
  'redes:borrarMeta': () => Resultado<EstadoDeMeta>
  /** Abre el ingreso de Facebook para vincular la cuenta de esa sucursal. Sólo SUPER_ADMIN. */
  'redes:vincular': (sucursal: string) => Resultado<VinculacionPendiente>
  'redes:elegirPagina': (paginaId: string) => Resultado<PanelDeRedes>
  'redes:desvincular': (sucursal: string) => Resultado<PanelDeRedes>
  /** Abre el diálogo para elegir la foto y la revisa. null si se canceló. */
  'redes:elegirArchivo': () => Resultado<ArchivoParaPublicar | null>
  'redes:publicar': (pedido: PedidoDePublicacion) => Resultado<PanelDeRedes>
  /** El historial de publicaciones de una sucursal (la propia del actor, si no se pide otra). */
  'redes:publicaciones': (sucursal?: string) => Resultado<PublicacionDeRed[]>
  /** Cuántas publicaciones más admite Instagram hoy en la cuenta de esa sucursal. */
  'redes:cuotaInstagram': (sucursal?: string) => Resultado<number | null>
  /** La bandeja de comentarios de una sucursal (la propia del actor, si no se pide otra). */
  'redes:comentarios': (sucursal?: string, soloSinResponder?: boolean) => Resultado<ComentarioDeRed[]>
  'redes:comentarios:responder': (comentarioId: string, mensaje: string) => Resultado<ComentarioDeRed>
  'redes:comentarios:ocultar': (comentarioId: string) => Resultado<ComentarioDeRed>
  'redes:comentarios:mostrar': (comentarioId: string) => Resultado<ComentarioDeRed>
  'redes:comentarios:eliminar': (comentarioId: string) => Resultado<null>
  /** La bandeja de mensajes privados de una sucursal (la propia del actor, si no se pide otra). */
  'redes:conversaciones': (sucursal?: string) => Resultado<ConversacionDeRed[]>
  'redes:conversaciones:mensajes': (conversacionId: string) => Resultado<MensajeDeRed[]>
  'redes:conversaciones:responder': (conversacionId: string, mensaje: string) => Resultado<MensajeDeRed>

  'sistema:abrirEnlace': (url: string) => Resultado<null>

  // --- Control remoto de las computadoras (MeshCentral) ---
  /** Mide si la consola contesta. El link se abre después con 'sistema:abrirEnlace'. */
  'mesh:estado': () => Resultado<EstadoDelMesh>

  // --- Reportar un error (Inicio) ---
  /** El explorador de archivos, varias a la vez. Cancelar devuelve la lista vacía. */
  'soporte:elegirImagenes': () => Resultado<ImagenDeReporte[]>
  /** La captura que está en el portapapeles (Impr Pant), guardada como archivo. null si no hay ninguna. */
  'soporte:pegarImagen': () => Resultado<ImagenDeReporte | null>
  /** Manda el reporte al VPS, que abre el issue. Devuelve su número y su dirección. */
  'soporte:reportar': (reporte: ReporteDeError) => Resultado<ReporteCreado>

  'app:info': () => Resultado<InfoApp>

  // Actualizaciones: chequeo automático liviano (al abrir y cada 15 minutos) más el botón manual de
  // Acerca de. `actualizarAhora` dispara la descarga que el chequeo automático ya no arranca solo, y
  // `posponer` es el «Dejar para después» del cartel: no baja nada, sólo lo anota para el superadmin.
  'actualizaciones:estado': () => Resultado<EstadoActualizacion>
  'actualizaciones:buscarAhora': () => Resultado<EstadoActualizacion>
  'actualizaciones:actualizarAhora': () => Resultado<EstadoActualizacion>
  'actualizaciones:posponer': (version: string) => Resultado<null>
  'actualizaciones:instalarAhora': () => Resultado<null>
  /** Sólo para el superadministrador: qué versión tiene instalada cada sucursal y si rechazó alguna. */
  'actualizaciones:estadoDeSucursales': () => Resultado<EstadoDeActualizacionDeSucursal[]>

  /** El PDF (A4) de una pantalla de ayuda. Abre el diálogo «Guardar como»; null si se canceló. */
  'ayuda:guardarPdf': (pedido: { html: string; nombreDeArchivo: string }) => Resultado<{ ruta: string | null }>
}

/** Avisos main → renderer (push, sin respuesta). */
export interface Eventos {
  'importacion:progreso': ProgresoImportacion
  'importacion:terminada': InformeImportacion
  'sincronizacion:estado': EstadoSincronizacion
  'actualizaciones:estado': EstadoActualizacion
  'auth:estadoDeAcceso': EstadoDeAcceso
  'auth:sesionCerrada': SesionCerrada
  /** El proceso principal reescribió la sesión abierta con datos frescos de GitHub (rol, nombre, sucursal). */
  'auth:sesionActualizada': SesionUsuario
  /** Cambió la matriz de permisos (acá o en otra computadora): la pantalla tiene que reacomodarse. */
  'permisos:cambiaron': MisPermisos
  /** Se registró un pago y la impresora está en «preguntar»: hay que confirmar el comprobante. */
  'impresora:preguntar': PedidoDeTicket
  /** Cómo va la bajada del catálogo de vehículos: son decenas de miles de filas. */
  'vehiculos:progreso': ProgresoDeCatalogo
  /** Una tarea se dio por terminada: el renderer hace sonar el aviso y refresca lo que tenga a la vista. */
  'tareas:completada': TareaCompletada
  /**
   * Llegó al menos un mensaje nuevo de otra persona: el cartero ya lo guardó y ya confirmó su llegada.
   * No lleva datos —es un «volvé a preguntar»— porque la pantalla necesita el hilo entero y la campana
   * la lista de no leídos, y las dos se piden distinto. Éste es el evento que hace sonar el aviso: por
   * eso está separado del de abajo, que no suena.
   */
  'mensajes:llegaron': null
  /**
   * Cambió algo que no es un mensaje nuevo: se movió un tilde (entregado o leído), salió algo de la
   * cola o apareció una conversación. La pantalla se redibuja y NO suena nada. Un chat que suena cada
   * vez que el otro lee algo es un chat que se termina silenciando.
   */
  'mensajes:cambiaron': null
  /**
   * Alguien mandó un zumbido. La ventana ya se está sacudiendo (eso lo hace el proceso principal, que
   * es el único que la puede mover); esto es para que el renderer haga sonar el zumbido y muestre de
   * quién fue. Va aparte de `mensajes:llegaron` porque suena OTRO sonido: el zumbido no es la campana.
   */
  'mensajes:zumbido': { autor: string }
  /**
   * La sincronización bajó tareas nuevas o cambiadas de otra computadora. No lleva datos: es un «volvé
   * a preguntar» para la campana, el contador de la barra lateral y el listado, que si no tendrían que
   * esperar a su propio reloj para enterarse.
   */
  'tareas:cambiaron': null
  /**
   * Bajaron datos de otra computadora: estas pestañas cambiaron y la pantalla que muestre algo de
   * ellas se tiene que recargar sola. Es lo que hace que un cambio hecho en otra sucursal aparezca en
   * la pantalla abierta sin que nadie navegue a otro lado y vuelva.
   *
   * Lleva los títulos Y los tipos porque son dos cosas distintas: una pantalla no sabe nada de
   * «AGOSTO 2026» —el título cambia todos los meses— pero sí sabe que muestra la planilla mensual.
   * Los títulos van igual, para la bitácora y para el día que haga falta afinar el filtro.
   */
  'datos:cambiaron': { pestanas: string[]; tipos: TipoPestana[] }
  /**
   * Un cambio de esta computadora NO se escribió porque la base ya decía otra cosa (14.0): alguien lo
   * editó antes desde otro mostrador y, desde la 14.0, gana la base (ver `sincronizacion/subida.ts`).
   *
   * Lleva todo lo que hace falta para el cartel —«la cuota de PEREZ la cambió otra computadora a
   * $18.000; tu $19.000 no se guardó»— sin que la pantalla tenga que ir a buscar nada. Cuando el aviso
   * llega, la pestaña ya se está bajando: el valor que ganó aparece solo.
   */
  'datos:pisados': { pestana: string; filaId: string; campo: string; valorLocal: string; valorServidor: string }
  /**
   * El servidor terminó de calcular de nuevo una métrica (el podio de sucursales, por ahora) y esta
   * computadora ya guardó el resultado nuevo (ver servicios/metricasCache.ts): la pantalla que la
   * muestre puede volver a pedirla por su canal de siempre ('metricas:podio') y va a encontrar el dato
   * fresco. `claves` son los nombres de las métricas que cambiaron, para que cada pantalla filtre las
   * que le importan a ella y no se refresque por una que no mira.
   */
  'metricas:actualizaron': { claves: string[] }
  /**
   * Cambió la situación del canal en vivo con el VPS (14.0): conectado, reconectando, sin conexión o
   * sin puente configurado. Lo escuchan el banner de arriba de todo y los botones que escriben, que
   * desde la 14.0 se apagan cuando no hay canal («ver sí, tocar no»).
   */
  'conexion:estado': EstadoDeConexion
  /**
   * Cambió quién está conectado o en qué está trabajando (14.0). No lleva datos —es un «volvé a
   * preguntar»— a propósito: la foto de presencia la guarda el proceso principal y la pantalla la
   * pide entera cuando la necesita. La fase C le agrega el canal para pedirla.
   */
  'presencia:cambio': null
  /**
   * Alguien cambió su foto o su color, acá o en otra computadora (14.0). Mismo criterio que el de
   * arriba: la pantalla vuelve a pedir la lista de perfiles. La fase C le agrega el canal.
   */
  'perfiles:cambiaron': null
  /**
   * Se movió algo de una llamada de voz: entrante, aceptada, cortada (14.0).
   *
   * Lleva el estado entero —no un «volvé a preguntar»— y, cuando lo que llegó es señalización, la señal
   * adentro. Van juntos porque el orden importa: la oferta SDP de la otra punta no se puede aplicar
   * antes de saber que la llamada existe, y con dos avisos sueltos ese orden dependería de cómo Electron
   * despache los eventos.
   */
  'llamadas:evento': { estado: EstadoDeLlamada; senal: SenalDeLlamada | null }
}

export type NombreCanal = keyof Canales
export type ArgumentosDe<C extends NombreCanal> = Parameters<Canales[C]>
export type RespuestaDe<C extends NombreCanal> = ReturnType<Canales[C]>

export type NombreEvento = keyof Eventos
export type DatosDeEvento<E extends NombreEvento> = Eventos[E]
