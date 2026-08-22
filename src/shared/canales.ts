// Contrato tipado de los canales IPC: cada canal declara sus argumentos y su respuesta.
// El proceso principal implementa exactamente estas firmas y la precarga las expone.
import type {
  AceptacionDePresupuesto,
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
  FiltrosMora,
  ListadoMora,
  RendicionImputados,
  ResultadoImputacion,
  ResumenComisiones,
  CambioDeClave,
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
  ResumenCierreDeMes,
  CredencialesIngreso,
  DatosConexionGoogle,
  DatosEdicionUsuario,
  DatosNuevoUsuario,
  EstadoConexionGoogle,
  EstadoDeAcceso,
  EstadoDeUsuarios,
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
  CatalogoDeReportes,
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

  'config:estadoGoogle': () => Resultado<EstadoConexionGoogle>
  'config:guardarGoogle': (datos: DatosConexionGoogle) => Resultado<EstadoConexionGoogle>

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
  'cartera:registrarPago': (filaId: string, datos: DatosDePago) => Resultado<FilaCartera>
  'cartera:darDeBaja': (filaId: string, datos: DatosDeBaja) => Resultado<null>
  'cartera:deshacerBaja': (bajaId: number) => Resultado<FilaBaja[]>
  'cartera:bajas': (periodo: string | null) => Resultado<FilaBaja[]>
  'cartera:cerrarMes': () => Resultado<ResumenCierreDeMes>
  'cartera:historialDeFila': (filaId: string) => Resultado<EntradaHistorial[]>

  'companias:listar': () => Resultado<Compania[]>
  'companias:editar': (id: number, datos: DatosDeCompania) => Resultado<Compania>

  // Cobranzas: la caja del día, la mora, la rendición de imputados y las comisiones.
  'cobranzas:caja': (fecha: string | null, sucursal: string) => Resultado<CajaDelDia>
  /** Alta manual de un pago. Con `cuotaFilaId` paga una fila de la planilla del mes. */
  'cobranzas:registrarPagoManual': (datos: DatosDePagoManual) => Resultado<CajaDelDia>
  /** Abre el diálogo «Guardar como» con el día en CSV. Devuelve la ruta o null si se canceló. */
  'cobranzas:exportarCaja': (fecha: string | null, sucursal: string) => Resultado<{ ruta: string | null }>
  'cobranzas:mora': (filtros: FiltrosMora) => Resultado<ListadoMora>
  /** El mismo WhatsApp de la planilla, también para cuotas de meses ya cerrados. */
  'cobranzas:avisarMora': (filaId: string) => Resultado<AvisoDeMora>
  'cobranzas:imputados': (periodo: string | null, compania: string) => Resultado<RendicionImputados>
  'cobranzas:cambiarResultado': (pagoId: number, resultado: ResultadoImputacion, compania: string) => Resultado<RendicionImputados>
  /** Sólo ADMIN y SUPER_ADMIN. */
  'cobranzas:comisiones': (periodo: string | null) => Resultado<ResumenComisiones>

  // Ticketeadora térmica (opcional): sólo ADMIN y SUPER_ADMIN la configuran.
  'impresora:estado': () => Resultado<ConfigImpresora>
  'impresora:guardar': (datos: DatosDeImpresora) => Resultado<ConfigImpresora>
  'impresora:prueba': () => Resultado<null>

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
   */
  'siniestros:adjuntar': (siniestroId: number, rutas: string[] | null) => Resultado<FichaSiniestro>
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
  'metricas:estadisticas': (periodo: string | null, sucursal: string) => Resultado<EstadisticasDeCartera>

  // Reportes: el centro de exportación.
  'reportes:catalogo': () => Resultado<CatalogoDeReportes>
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

  'sistema:abrirEnlace': (url: string) => Resultado<null>

  'app:info': () => Resultado<InfoApp>

  // Actualizaciones: chequeo automático (al abrir y cada 4 horas) más el botón manual de Acerca de.
  'actualizaciones:estado': () => Resultado<EstadoActualizacion>
  'actualizaciones:buscarAhora': () => Resultado<EstadoActualizacion>
  'actualizaciones:instalarAhora': () => Resultado<null>
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
}

export type NombreCanal = keyof Canales
export type ArgumentosDe<C extends NombreCanal> = Parameters<Canales[C]>
export type RespuestaDe<C extends NombreCanal> = ReturnType<Canales[C]>

export type NombreEvento = keyof Eventos
export type DatosDeEvento<E extends NombreEvento> = Eventos[E]
