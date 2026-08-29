// Forma de la API que la precarga expone al renderer como `window.dm`.
import type { ArgumentosDe, DatosDeEvento, NombreCanal, NombreEvento, RespuestaDe } from './canales'

/** Convierte la firma síncrona de un canal en la función asíncrona que ve el renderer. */
type Remota<C extends NombreCanal> = (...args: ArgumentosDe<C>) => Promise<RespuestaDe<C>>

/** Suscripción a un evento del proceso principal. Devuelve la función para desuscribirse. */
type Suscripcion<E extends NombreEvento> = (escuchar: (datos: DatosDeEvento<E>) => void) => () => void

export interface ApiDm {
  auth: {
    ingresar: Remota<'auth:ingresar'>
    salir: Remota<'auth:salir'>
    sesion: Remota<'auth:sesion'>
    cambiarClave: Remota<'auth:cambiarClave'>
    estadoDeAcceso: Remota<'auth:estadoDeAcceso'>
    alCambiarAcceso: Suscripcion<'auth:estadoDeAcceso'>
    alCerrarSesion: Suscripcion<'auth:sesionCerrada'>
    alActualizarSesion: Suscripcion<'auth:sesionActualizada'>
  }
  sucursales: {
    listar: Remota<'sucursales:listar'>
  }
  usuarios: {
    listar: Remota<'usuarios:listar'>
    crear: Remota<'usuarios:crear'>
    editar: Remota<'usuarios:editar'>
    cambiarActivo: Remota<'usuarios:cambiarActivo'>
    resetearClave: Remota<'usuarios:resetearClave'>
    estado: Remota<'usuarios:estado'>
    subirLocales: Remota<'usuarios:subirLocales'>
  }
  permisos: {
    mios: Remota<'permisos:mios'>
    matriz: Remota<'permisos:matriz'>
    guardar: Remota<'permisos:guardar'>
    alCambiar: Suscripcion<'permisos:cambiaron'>
  }
  config: {
    estadoGoogle: Remota<'config:estadoGoogle'>
    guardarGoogle: Remota<'config:guardarGoogle'>
    plantillaAviso: Remota<'config:plantillaAviso'>
    guardarPlantillaAviso: Remota<'config:guardarPlantillaAviso'>
  }
  vps: {
    estado: Remota<'vps:estado'>
    migrar: Remota<'vps:migrar'>
  }
  cartera: {
    planilla: Remota<'cartera:planilla'>
    editarCelda: Remota<'cartera:editarCelda'>
    prepararAviso: Remota<'cartera:prepararAviso'>
    marcarAvisado: Remota<'cartera:marcarAvisado'>
    registrarPago: Remota<'cartera:registrarPago'>
    darDeBaja: Remota<'cartera:darDeBaja'>
    deshacerBaja: Remota<'cartera:deshacerBaja'>
    reactivarBaja: Remota<'cartera:reactivarBaja'>
    bajas: Remota<'cartera:bajas'>
    cerrarMes: Remota<'cartera:cerrarMes'>
    historialDeFila: Remota<'cartera:historialDeFila'>
  }
  rechazos: {
    avisar: Remota<'rechazos:avisar'>
    listar: Remota<'rechazos:listar'>
    cambiarEstado: Remota<'rechazos:cambiarEstado'>
    avisos: Remota<'rechazos:avisos'>
    marcarVistos: Remota<'rechazos:marcarVistos'>
    resolver: Remota<'rechazos:resolver'>
  }
  companias: {
    listar: Remota<'companias:listar'>
    editar: Remota<'companias:editar'>
  }
  cobranzas: {
    caja: Remota<'cobranzas:caja'>
    registrarPagoManual: Remota<'cobranzas:registrarPagoManual'>
    exportarCaja: Remota<'cobranzas:exportarCaja'>
    mora: Remota<'cobranzas:mora'>
    avisarMora: Remota<'cobranzas:avisarMora'>
    imputados: Remota<'cobranzas:imputados'>
    cambiarResultado: Remota<'cobranzas:cambiarResultado'>
    comisiones: Remota<'cobranzas:comisiones'>
  }
  impresora: {
    estado: Remota<'impresora:estado'>
    guardar: Remota<'impresora:guardar'>
    prueba: Remota<'impresora:prueba'>
    imprimirPago: Remota<'impresora:imprimirPago'>
    direcciones: Remota<'impresora:direcciones'>
    guardarDirecciones: Remota<'impresora:guardarDirecciones'>
    /** El cartel de «¿imprimo el comprobante?» después de registrar un pago. */
    alPedirTicket: Suscripcion<'impresora:preguntar'>
  }
  clientes: {
    listar: Remota<'clientes:listar'>
    buscar: Remota<'clientes:buscar'>
    ficha: Remota<'clientes:ficha'>
    crear: Remota<'clientes:crear'>
    editar: Remota<'clientes:editar'>
    agregarNota: Remota<'clientes:agregarNota'>
    crearTarea: Remota<'clientes:crearTarea'>
    cambiarEstadoDeTarea: Remota<'clientes:cambiarEstadoDeTarea'>
    cuotasDelMes: Remota<'clientes:cuotasDelMes'>
    deudores: Remota<'clientes:deudores'>
    exportarDeudores: Remota<'clientes:exportarDeudores'>
  }
  siniestros: {
    crear: Remota<'siniestros:crear'>
    listar: Remota<'siniestros:listar'>
    ficha: Remota<'siniestros:ficha'>
    buscar: Remota<'siniestros:buscar'>
    alta: Remota<'siniestros:alta'>
    cambiarEstado: Remota<'siniestros:cambiarEstado'>
    editar: Remota<'siniestros:editar'>
    agregarObservacion: Remota<'siniestros:agregarObservacion'>
    adjuntar: Remota<'siniestros:adjuntar'>
    abrirAdjunto: Remota<'siniestros:abrirAdjunto'>
    borrarAdjunto: Remota<'siniestros:borrarAdjunto'>
    crearTarea: Remota<'siniestros:crearTarea'>
    cambiarEstadoDeTarea: Remota<'siniestros:cambiarEstadoDeTarea'>
  }
  riesgos: {
    listar: Remota<'riesgos:listar'>
    editar: Remota<'riesgos:editar'>
    crear: Remota<'riesgos:crear'>
  }
  amp: {
    listar: Remota<'amp:listar'>
    cambiarResuelto: Remota<'amp:cambiarResuelto'>
  }
  polizas: {
    listar: Remota<'polizas:listar'>
    ver: Remota<'polizas:ver'>
    deCliente: Remota<'polizas:deCliente'>
    vehiculosDeCliente: Remota<'polizas:vehiculosDeCliente'>
    catalogos: Remota<'polizas:catalogos'>
    validarCobertura: Remota<'polizas:validarCobertura'>
    crear: Remota<'polizas:crear'>
    editar: Remota<'polizas:editar'>
    darDeBaja: Remota<'polizas:darDeBaja'>
  }
  reglas: {
    matriz: Remota<'reglas:matriz'>
    crear: Remota<'reglas:crear'>
    editar: Remota<'reglas:editar'>
    borrar: Remota<'reglas:borrar'>
    vigentes: Remota<'reglas:vigentes'>
  }
  renovaciones: {
    bandeja: Remota<'renovaciones:bandeja'>
    sugerencia: Remota<'renovaciones:sugerencia'>
    actualizar: Remota<'renovaciones:actualizar'>
    renovar: Remota<'renovaciones:renovar'>
    noRenueva: Remota<'renovaciones:noRenueva'>
  }
  sincronizacion: {
    estado: Remota<'sincronizacion:estado'>
    panel: Remota<'sincronizacion:panel'>
    ahora: Remota<'sincronizacion:ahora'>
    reintentar: Remota<'sincronizacion:reintentar'>
    respaldarAhora: Remota<'sincronizacion:respaldarAhora'>
    alCambiarEstado: Suscripcion<'sincronizacion:estado'>
  }
  leads: {
    listar: Remota<'leads:listar'>
    ficha: Remota<'leads:ficha'>
    crear: Remota<'leads:crear'>
    editar: Remota<'leads:editar'>
    cambiarEstado: Remota<'leads:cambiarEstado'>
    agregarNota: Remota<'leads:agregarNota'>
    convertir: Remota<'leads:convertir'>
  }
  presupuestos: {
    listar: Remota<'presupuestos:listar'>
    ficha: Remota<'presupuestos:ficha'>
    crear: Remota<'presupuestos:crear'>
    guardar: Remota<'presupuestos:guardar'>
    enviar: Remota<'presupuestos:enviar'>
    aceptar: Remota<'presupuestos:aceptar'>
    rechazar: Remota<'presupuestos:rechazar'>
    guardarPdf: Remota<'presupuestos:guardarPdf'>
    imprimir: Remota<'presupuestos:imprimir'>
  }
  tareas: {
    listar: Remota<'tareas:listar'>
    ficha: Remota<'tareas:ficha'>
    crear: Remota<'tareas:crear'>
    editar: Remota<'tareas:editar'>
    cambiarEstado: Remota<'tareas:cambiarEstado'>
    comentar: Remota<'tareas:comentar'>
    adjuntar: Remota<'tareas:adjuntar'>
    abrirAdjunto: Remota<'tareas:abrirAdjunto'>
    borrarAdjunto: Remota<'tareas:borrarAdjunto'>
    mias: Remota<'tareas:mias'>
    avisos: Remota<'tareas:avisos'>
    marcarVistos: Remota<'tareas:marcarVistos'>
    /** Alguien terminó una tarea: suena el aviso y las pantallas abiertas se refrescan. */
    alCompletarse: Suscripcion<'tareas:completada'>
  }
  metricas: {
    tablero: Remota<'metricas:tablero'>
    estadisticas: Remota<'metricas:estadisticas'>
  }
  reportes: {
    catalogo: Remota<'reportes:catalogo'>
    vistaPrevia: Remota<'reportes:vistaPrevia'>
    exportar: Remota<'reportes:exportar'>
    planillaClasica: Remota<'reportes:planillaClasica'>
  }
  marketing: {
    plantillas: Remota<'marketing:plantillas'>
    crearPlantilla: Remota<'marketing:crearPlantilla'>
    editarPlantilla: Remota<'marketing:editarPlantilla'>
    borrarPlantilla: Remota<'marketing:borrarPlantilla'>
    segmento: Remota<'marketing:segmento'>
    guardarSegmento: Remota<'marketing:guardarSegmento'>
    borrarSegmento: Remota<'marketing:borrarSegmento'>
    avisar: Remota<'marketing:avisar'>
  }
  sistema: {
    abrirEnlace: Remota<'sistema:abrirEnlace'>
  }
  importacion: {
    vistaPrevia: Remota<'importacion:vistaPrevia'>
    iniciar: Remota<'importacion:iniciar'>
    cancelar: Remota<'importacion:cancelar'>
    estado: Remota<'importacion:estado'>
    guardarInforme: Remota<'importacion:guardarInforme'>
    abrirCarpetaInformes: Remota<'importacion:abrirCarpetaInformes'>
    alProgresar: Suscripcion<'importacion:progreso'>
    alTerminar: Suscripcion<'importacion:terminada'>
  }
  app: {
    info: Remota<'app:info'>
  }
  actualizaciones: {
    estado: Remota<'actualizaciones:estado'>
    buscarAhora: Remota<'actualizaciones:buscarAhora'>
    instalarAhora: Remota<'actualizaciones:instalarAhora'>
    alCambiarEstado: Suscripcion<'actualizaciones:estado'>
  }
  ayuda: {
    guardarPdf: Remota<'ayuda:guardarPdf'>
  }
}
