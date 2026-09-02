// Contrato tipado de los canales IPC: cada canal declara sus argumentos y su respuesta.
// El proceso principal implementa exactamente estas firmas y la precarga las expone.
import type { TipoEliminable, ResultadoDeEliminacion, VistaPreviaDeEliminacion } from './eliminacion'
import type { MatrizPermisos } from './permisos'
import type {
  AceptacionDePresupuesto,
  ConsultaDeAntiguedad,
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
  DatosDePagoManual,
  DireccionDeSucursal,
  FiltrosMora,
  ListadoMora,
  ArchivoParaPublicar,
  AdopcionDeCredencialesDeVehiculos,
  DatosDelProveedorDeVehiculos,
  EstadoDeAjusteCompartido,
  EstadoDeCredencialesDeVehiculos,
  EstadoDelCatalogo,
  EstadoDelMesh,
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
  EstadoSincronizacion,
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
  EstadisticasDeCartera,
  FiltrosDeSegmento,
  FiltrosMetricas,
  FormatoDeReporte,
  OpcionesPlanillaClasica,
  PedidoDeReporte,
  PlantillaDeMensaje,
  ResultadoDeSegmento,
  TableroMetricas,
  VistaPreviaDeReporte,
} from './tipos'

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

  'config:estadoGoogle': () => Resultado<EstadoConexionGoogle>
  'config:guardarGoogle': (datos: DatosConexionGoogle) => Resultado<EstadoConexionGoogle>

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
  /** Abre el diálogo «Guardar como» con el día en CSV. Devuelve la ruta o null si se canceló. */
  'cobranzas:exportarCaja': (fecha: string | null, sucursales: string[]) => Resultado<{ ruta: string | null }>
  'cobranzas:mora': (filtros: FiltrosMora) => Resultado<ListadoMora>
  /** El mismo WhatsApp de la planilla, también para cuotas de meses ya cerrados. */
  'cobranzas:avisarMora': (filaId: string) => Resultado<AvisoDeMora>
  'cobranzas:imputados': (periodo: string | null, companias: string[]) => Resultado<RendicionImputados>
  'cobranzas:cambiarResultado': (pagoId: number, resultado: ResultadoImputacion, companias: string[]) => Resultado<RendicionImputados>
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

  'sincronizacion:estado': () => Resultado<EstadoSincronizacion>
  'sincronizacion:panel': () => Resultado<PanelSincronizacion>
  /** Sube lo pendiente y baja lo que haya. Con `completa`, relee todas las pestañas. */
  'sincronizacion:ahora': (completa: boolean) => Resultado<EstadoSincronizacion>
  'sincronizacion:reintentar': () => Resultado<number>
  'sincronizacion:respaldarAhora': () => Resultado<boolean>

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

  // Tareas
  'tareas:listar': (filtros: FiltrosTareas) => Resultado<ListadoTareas>
  'tareas:ficha': (tareaId: number) => Resultado<FichaTarea>
  'tareas:crear': (datos: DatosDeTareaCompleta) => Resultado<FilaTarea>
  'tareas:editar': (tareaId: number, datos: DatosDeEdicionDeTarea) => Resultado<FichaTarea>
  'tareas:cambiarEstado': (tareaId: number, estado: EstadoTarea) => Resultado<FilaTarea>
  'tareas:comentar': (tareaId: number, texto: string) => Resultado<FichaTarea>
  /** Con `rutas` en null abre el diálogo para elegir los archivos, que es lo que hace la pantalla. */
  'tareas:adjuntar': (tareaId: number, rutas: string[] | null) => Resultado<FichaTarea>
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

  // Marketing → Redes: publicar en la Página de Facebook de la agencia y en su Instagram. El App ID y
  // el App Secret se cargan en Administración; el token de la Página nunca sale del proceso principal.
  'redes:panel': () => Resultado<PanelDeRedes>
  'redes:estadoMeta': () => Resultado<EstadoDeMeta>
  'redes:guardarMeta': (datos: DatosDeMeta) => Resultado<EstadoDeMeta>
  'redes:borrarMeta': () => Resultado<EstadoDeMeta>
  /** Abre el ingreso de Facebook. Con una sola Página vincula sola; con varias, hay que elegir. */
  'redes:vincular': () => Resultado<VinculacionPendiente>
  'redes:elegirPagina': (paginaId: string) => Resultado<PanelDeRedes>
  'redes:desvincular': () => Resultado<PanelDeRedes>
  /** Abre el diálogo para elegir la foto y la revisa. null si se canceló. */
  'redes:elegirArchivo': () => Resultado<ArchivoParaPublicar | null>
  'redes:publicar': (pedido: PedidoDePublicacion) => Resultado<PanelDeRedes>

  'sistema:abrirEnlace': (url: string) => Resultado<null>

  // --- Control remoto de las computadoras (MeshCentral) ---
  /** Mide si la consola contesta. El link se abre después con 'sistema:abrirEnlace'. */
  'mesh:estado': () => Resultado<EstadoDelMesh>

  'app:info': () => Resultado<InfoApp>

  // Actualizaciones: chequeo automático (al abrir y cada 4 horas) más el botón manual de Acerca de.
  'actualizaciones:estado': () => Resultado<EstadoActualizacion>
  'actualizaciones:buscarAhora': () => Resultado<EstadoActualizacion>
  'actualizaciones:instalarAhora': () => Resultado<null>

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
   * El carril rápido de la sincronización bajó tareas nuevas o cambiadas de otra computadora. No lleva
   * datos: es un «volvé a preguntar» para la campana, el contador de la barra lateral y el listado, que
   * si no tendrían que esperar a su propio reloj para enterarse.
   */
  'tareas:cambiaron': null
}

export type NombreCanal = keyof Canales
export type ArgumentosDe<C extends NombreCanal> = Parameters<Canales[C]>
export type RespuestaDe<C extends NombreCanal> = ReturnType<Canales[C]>

export type NombreEvento = keyof Eventos
export type DatosDeEvento<E extends NombreEvento> = Eventos[E]
