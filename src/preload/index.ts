// Precarga: expone al renderer una API mínima y tipada (`window.dm`) a través de contextBridge.
// El renderer nunca toca ipcRenderer directamente ni tiene acceso a Node.
import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron'
import type { ApiDm } from '../shared/api'
import type { ArgumentosDe, DatosDeEvento, NombreCanal, NombreEvento, RespuestaDe } from '../shared/canales'

function invocar<C extends NombreCanal>(canal: C, ...args: ArgumentosDe<C>): Promise<RespuestaDe<C>> {
  return ipcRenderer.invoke(canal, ...args) as Promise<RespuestaDe<C>>
}

/** Suscribe a un evento del proceso principal y devuelve la función para desuscribirse. */
function suscribir<E extends NombreEvento>(evento: E, escuchar: (datos: DatosDeEvento<E>) => void): () => void {
  const oyente = (_evento: IpcRendererEvent, datos: DatosDeEvento<E>) => escuchar(datos)
  ipcRenderer.on(evento, oyente)
  return () => {
    ipcRenderer.removeListener(evento, oyente)
  }
}

const api: ApiDm = {
  auth: {
    ingresar: (datos) => invocar('auth:ingresar', datos),
    salir: () => invocar('auth:salir'),
    sesion: () => invocar('auth:sesion'),
    cambiarClave: (datos) => invocar('auth:cambiarClave', datos),
    estadoDeAcceso: (comprobar) => invocar('auth:estadoDeAcceso', comprobar),
    alCambiarAcceso: (escuchar) => suscribir('auth:estadoDeAcceso', escuchar),
    alCerrarSesion: (escuchar) => suscribir('auth:sesionCerrada', escuchar),
    alActualizarSesion: (escuchar) => suscribir('auth:sesionActualizada', escuchar),
  },
  sucursales: {
    listar: () => invocar('sucursales:listar'),
  },
  usuarios: {
    listar: () => invocar('usuarios:listar'),
    crear: (datos) => invocar('usuarios:crear', datos),
    editar: (id, datos) => invocar('usuarios:editar', id, datos),
    cambiarActivo: (id, activo) => invocar('usuarios:cambiarActivo', id, activo),
    resetearClave: (id, claveTemporal) => invocar('usuarios:resetearClave', id, claveTemporal),
    estado: (comprobar) => invocar('usuarios:estado', comprobar),
    subirLocales: () => invocar('usuarios:subirLocales'),
  },
  permisos: {
    mios: () => invocar('permisos:mios'),
    matriz: () => invocar('permisos:matriz'),
    guardar: (permisos) => invocar('permisos:guardar', permisos),
    alCambiar: (escuchar) => suscribir('permisos:cambiaron', escuchar),
  },
  eliminacion: {
    vistaPrevia: (tipo, id) => invocar('eliminacion:vistaPrevia', tipo, id),
    borrar: (tipo, id) => invocar('eliminacion:borrar', tipo, id),
  },
  config: {
    estadoGoogle: () => invocar('config:estadoGoogle'),
    guardarGoogle: (datos) => invocar('config:guardarGoogle', datos),
    plantillaAviso: () => invocar('config:plantillaAviso'),
    guardarPlantillaAviso: (texto) => invocar('config:guardarPlantillaAviso', texto),
  },
  vps: {
    estado: () => invocar('vps:estado'),
    migrar: () => invocar('vps:migrar'),
  },
  importacion: {
    vistaPrevia: () => invocar('importacion:vistaPrevia'),
    iniciar: () => invocar('importacion:iniciar'),
    cancelar: () => invocar('importacion:cancelar'),
    estado: () => invocar('importacion:estado'),
    guardarInforme: (importacionId) => invocar('importacion:guardarInforme', importacionId),
    abrirCarpetaInformes: () => invocar('importacion:abrirCarpetaInformes'),
    alProgresar: (escuchar) => suscribir('importacion:progreso', escuchar),
    alTerminar: (escuchar) => suscribir('importacion:terminada', escuchar),
  },
  cartera: {
    planilla: (periodo) => invocar('cartera:planilla', periodo),
    editarCelda: (filaId, campo, valor) => invocar('cartera:editarCelda', filaId, campo, valor),
    prepararAviso: (filaId) => invocar('cartera:prepararAviso', filaId),
    marcarAvisado: (filaId) => invocar('cartera:marcarAvisado', filaId),
    registrarPago: (filaId, datos) => invocar('cartera:registrarPago', filaId, datos),
    imputarAdelanto: (filaId) => invocar('cartera:imputarAdelanto', filaId),
    darDeBaja: (filaId, datos) => invocar('cartera:darDeBaja', filaId, datos),
    deshacerBaja: (bajaId) => invocar('cartera:deshacerBaja', bajaId),
    reactivarBaja: (bajaId, cambios) => invocar('cartera:reactivarBaja', bajaId, cambios),
    bajas: (periodo) => invocar('cartera:bajas', periodo),
    cerrarMes: () => invocar('cartera:cerrarMes'),
    historialDeFila: (filaId) => invocar('cartera:historialDeFila', filaId),
  },
  rechazos: {
    avisar: (polizaId, datos) => invocar('rechazos:avisar', polizaId, datos),
    listar: (filtros) => invocar('rechazos:listar', filtros),
    cambiarEstado: (rechazoId, estado, filtros) => invocar('rechazos:cambiarEstado', rechazoId, estado, filtros),
    avisos: () => invocar('rechazos:avisos'),
    marcarVistos: () => invocar('rechazos:marcarVistos'),
    resolver: (rechazoId) => invocar('rechazos:resolver', rechazoId),
  },
  companias: {
    listar: () => invocar('companias:listar'),
    editar: (id, datos) => invocar('companias:editar', id, datos),
  },
  cobranzas: {
    caja: (fecha, sucursales) => invocar('cobranzas:caja', fecha, sucursales),
    registrarPagoManual: (datos) => invocar('cobranzas:registrarPagoManual', datos),
    exportarCaja: (fecha, sucursales) => invocar('cobranzas:exportarCaja', fecha, sucursales),
    mora: (filtros) => invocar('cobranzas:mora', filtros),
    avisarMora: (filaId) => invocar('cobranzas:avisarMora', filaId),
    imputados: (periodo, companias) => invocar('cobranzas:imputados', periodo, companias),
    cambiarResultado: (pagoId, resultado, companias) => invocar('cobranzas:cambiarResultado', pagoId, resultado, companias),
    comisiones: (periodo) => invocar('cobranzas:comisiones', periodo),
  },
  impresora: {
    estado: () => invocar('impresora:estado'),
    guardar: (datos) => invocar('impresora:guardar', datos),
    prueba: () => invocar('impresora:prueba'),
    imprimirPago: (pagoId, copias) => invocar('impresora:imprimirPago', pagoId, copias),
    establecerNumeroDeTicket: (numero) => invocar('impresora:establecerNumeroDeTicket', numero),
    direcciones: () => invocar('impresora:direcciones'),
    guardarDirecciones: (direcciones) => invocar('impresora:guardarDirecciones', direcciones),
    alPedirTicket: (escuchar) => suscribir('impresora:preguntar', escuchar),
  },
  clientes: {
    listar: (filtros) => invocar('clientes:listar', filtros),
    buscar: (busqueda) => invocar('clientes:buscar', busqueda),
    ficha: (clienteId) => invocar('clientes:ficha', clienteId),
    localidades: () => invocar('clientes:localidades'),
    crear: (datos) => invocar('clientes:crear', datos),
    editar: (clienteId, datos) => invocar('clientes:editar', clienteId, datos),
    agregarNota: (clienteId, texto) => invocar('clientes:agregarNota', clienteId, texto),
    crearTarea: (datos) => invocar('clientes:crearTarea', datos),
    cambiarEstadoDeTarea: (tareaId, estado) => invocar('clientes:cambiarEstadoDeTarea', tareaId, estado),
    cuotasDelMes: (clienteId) => invocar('clientes:cuotasDelMes', clienteId),
    deudores: (filtros) => invocar('clientes:deudores', filtros),
    exportarDeudores: (filtros, formato, ruta) => invocar('clientes:exportarDeudores', filtros, formato, ruta),
  },
  siniestros: {
    crear: (datos) => invocar('siniestros:crear', datos),
    listar: (filtros) => invocar('siniestros:listar', filtros),
    ficha: (siniestroId) => invocar('siniestros:ficha', siniestroId),
    buscar: (busqueda) => invocar('siniestros:buscar', busqueda),
    alta: (datos) => invocar('siniestros:alta', datos),
    cambiarEstado: (siniestroId, estado) => invocar('siniestros:cambiarEstado', siniestroId, estado),
    editar: (siniestroId, campo, valor) => invocar('siniestros:editar', siniestroId, campo, valor),
    agregarObservacion: (siniestroId, texto) => invocar('siniestros:agregarObservacion', siniestroId, texto),
    adjuntar: (siniestroId, rutas, categoria, detalle) =>
      invocar('siniestros:adjuntar', siniestroId, rutas, categoria, detalle),
    abrirAdjunto: (adjuntoId) => invocar('siniestros:abrirAdjunto', adjuntoId),
    borrarAdjunto: (adjuntoId) => invocar('siniestros:borrarAdjunto', adjuntoId),
    crearTarea: (datos) => invocar('siniestros:crearTarea', datos),
    cambiarEstadoDeTarea: (tareaId, estado) => invocar('siniestros:cambiarEstadoDeTarea', tareaId, estado),
  },
  riesgos: {
    listar: () => invocar('riesgos:listar'),
    editar: (riesgoId, campo, valor) => invocar('riesgos:editar', riesgoId, campo, valor),
    crear: (datos) => invocar('riesgos:crear', datos),
  },
  amp: {
    listar: (incluirResueltas) => invocar('amp:listar', incluirResueltas),
    cambiarResuelto: (ampId, resuelto, incluirResueltas) => invocar('amp:cambiarResuelto', ampId, resuelto, incluirResueltas),
  },
  polizas: {
    listar: (filtros) => invocar('polizas:listar', filtros),
    ver: (polizaId) => invocar('polizas:ver', polizaId),
    deCliente: (clienteId) => invocar('polizas:deCliente', clienteId),
    vehiculosDeCliente: (clienteId) => invocar('polizas:vehiculosDeCliente', clienteId),
    catalogos: () => invocar('polizas:catalogos'),
    validarCobertura: (compania, cobertura, anioVehiculo) => invocar('polizas:validarCobertura', compania, cobertura, anioVehiculo),
    crear: (datos) => invocar('polizas:crear', datos),
    editar: (polizaId, datos) => invocar('polizas:editar', polizaId, datos),
    darDeBaja: (polizaId, datos) => invocar('polizas:darDeBaja', polizaId, datos),
  },
  reglas: {
    matriz: () => invocar('reglas:matriz'),
    crear: (datos) => invocar('reglas:crear', datos),
    editar: (id, datos) => invocar('reglas:editar', id, datos),
    borrar: (id) => invocar('reglas:borrar', id),
    vigentes: () => invocar('reglas:vigentes'),
  },
  referencias: {
    listas: () => invocar('referencias:listas'),
    antiguedad: (anio) => invocar('referencias:antiguedad', anio),
    guardarOrganizador: (id, datos) => invocar('referencias:guardarOrganizador', id, datos),
    borrarOrganizador: (id) => invocar('referencias:borrarOrganizador', id),
    moverOrganizador: (id, direccion) => invocar('referencias:moverOrganizador', id, direccion),
    guardarPrecio: (id, datos) => invocar('referencias:guardarPrecio', id, datos),
    borrarPrecio: (id) => invocar('referencias:borrarPrecio', id),
    guardarGrua: (id, datos) => invocar('referencias:guardarGrua', id, datos),
    borrarGrua: (id) => invocar('referencias:borrarGrua', id),
    guardarClausula: (id, datos) => invocar('referencias:guardarClausula', id, datos),
    borrarClausula: (id) => invocar('referencias:borrarClausula', id),
    estadoCompartido: () => invocar('referencias:estadoCompartido'),
    publicar: () => invocar('referencias:publicar'),
    adoptar: () => invocar('referencias:adoptar'),
  },
  renovaciones: {
    bandeja: () => invocar('renovaciones:bandeja'),
    sugerencia: (polizaId) => invocar('renovaciones:sugerencia', polizaId),
    actualizar: (polizaId, venceEl, datos) => invocar('renovaciones:actualizar', polizaId, venceEl, datos),
    renovar: (polizaId, datos) => invocar('renovaciones:renovar', polizaId, datos),
    noRenueva: (polizaId, datos) => invocar('renovaciones:noRenueva', polizaId, datos),
  },
  sincronizacion: {
    estado: () => invocar('sincronizacion:estado'),
    panel: () => invocar('sincronizacion:panel'),
    ahora: (completa) => invocar('sincronizacion:ahora', completa),
    reintentar: () => invocar('sincronizacion:reintentar'),
    respaldarAhora: () => invocar('sincronizacion:respaldarAhora'),
    alCambiarEstado: (escuchar) => suscribir('sincronizacion:estado', escuchar),
  },
  leads: {
    listar: (filtros) => invocar('leads:listar', filtros),
    ficha: (leadId) => invocar('leads:ficha', leadId),
    crear: (datos) => invocar('leads:crear', datos),
    editar: (leadId, datos) => invocar('leads:editar', leadId, datos),
    cambiarEstado: (leadId, estado) => invocar('leads:cambiarEstado', leadId, estado),
    agregarNota: (leadId, texto) => invocar('leads:agregarNota', leadId, texto),
    convertir: (leadId) => invocar('leads:convertir', leadId),
  },
  presupuestos: {
    listar: (filtros) => invocar('presupuestos:listar', filtros),
    ficha: (presupuestoId) => invocar('presupuestos:ficha', presupuestoId),
    crear: (datos) => invocar('presupuestos:crear', datos),
    guardar: (presupuestoId, datos) => invocar('presupuestos:guardar', presupuestoId, datos),
    enviar: (presupuestoId) => invocar('presupuestos:enviar', presupuestoId),
    aceptar: (presupuestoId, opcionId) => invocar('presupuestos:aceptar', presupuestoId, opcionId),
    rechazar: (presupuestoId, motivo) => invocar('presupuestos:rechazar', presupuestoId, motivo),
    guardarPdf: (presupuestoId) => invocar('presupuestos:guardarPdf', presupuestoId),
    imprimir: (presupuestoId) => invocar('presupuestos:imprimir', presupuestoId),
  },
  tareas: {
    listar: (filtros) => invocar('tareas:listar', filtros),
    ficha: (tareaId) => invocar('tareas:ficha', tareaId),
    crear: (datos) => invocar('tareas:crear', datos),
    editar: (tareaId, datos) => invocar('tareas:editar', tareaId, datos),
    cambiarEstado: (tareaId, estado) => invocar('tareas:cambiarEstado', tareaId, estado),
    comentar: (tareaId, texto) => invocar('tareas:comentar', tareaId, texto),
    adjuntar: (tareaId, rutas) => invocar('tareas:adjuntar', tareaId, rutas),
    abrirAdjunto: (adjuntoId) => invocar('tareas:abrirAdjunto', adjuntoId),
    borrarAdjunto: (adjuntoId) => invocar('tareas:borrarAdjunto', adjuntoId),
    mias: () => invocar('tareas:mias'),
    avisos: () => invocar('tareas:avisos'),
    marcarVistos: () => invocar('tareas:marcarVistos'),
    alCompletarse: (escuchar) => suscribir('tareas:completada', escuchar),
    alCambiarDeAfuera: (escuchar) => suscribir('tareas:cambiaron', escuchar),
  },
  metricas: {
    tablero: (filtros) => invocar('metricas:tablero', filtros),
    estadisticas: (periodo, sucursales) => invocar('metricas:estadisticas', periodo, sucursales),
  },
  reportes: {
    catalogo: () => invocar('reportes:catalogo'),
    vistaPrevia: (pedido) => invocar('reportes:vistaPrevia', pedido),
    exportar: (pedido, formato, ruta) => invocar('reportes:exportar', pedido, formato, ruta),
    planillaClasica: (opciones, ruta) => invocar('reportes:planillaClasica', opciones, ruta),
  },
  excel: {
    catalogo: () => invocar('excel:catalogo'),
    filas: (pedido) => invocar('excel:filas', pedido),
    exportar: (pedido) => invocar('excel:exportar', pedido),
  },
  marketing: {
    plantillas: () => invocar('marketing:plantillas'),
    crearPlantilla: (datos) => invocar('marketing:crearPlantilla', datos),
    editarPlantilla: (clave, datos) => invocar('marketing:editarPlantilla', clave, datos),
    borrarPlantilla: (clave) => invocar('marketing:borrarPlantilla', clave),
    segmento: (segmentoId, filtros, plantillaClave) => invocar('marketing:segmento', segmentoId, filtros, plantillaClave),
    guardarSegmento: (segmentoId, datos) => invocar('marketing:guardarSegmento', segmentoId, datos),
    borrarSegmento: (segmentoId) => invocar('marketing:borrarSegmento', segmentoId),
    avisar: (filaId, segmentoId, filtros, plantillaClave) => invocar('marketing:avisar', filaId, segmentoId, filtros, plantillaClave),
  },
  vehiculos: {
    estado: () => invocar('vehiculos:estado'),
    guardarCredenciales: (datos) => invocar('vehiculos:guardarCredenciales', datos),
    publicar: () => invocar('vehiculos:publicar'),
    estadoCompartido: () => invocar('vehiculos:estadoCompartido'),
    adoptar: () => invocar('vehiculos:adoptar'),
    borrarCredenciales: (tambienDelServidor) => invocar('vehiculos:borrarCredenciales', tambienDelServidor),
    probar: () => invocar('vehiculos:probar'),
    refrescar: (tipo) => invocar('vehiculos:refrescar', tipo),
    marcas: (tipo) => invocar('vehiculos:marcas', tipo),
    modelos: (tipo, marcaId) => invocar('vehiculos:modelos', tipo, marcaId),
    lineas: (tipo, marcaId, modeloId) => invocar('vehiculos:lineas', tipo, marcaId, modeloId),
    anios: (tipo, marcaId, modeloId, lineaId) => invocar('vehiculos:anios', tipo, marcaId, modeloId, lineaId),
    resolver: (tipo, marcaId, modeloId, lineaId, anio) => invocar('vehiculos:resolver', tipo, marcaId, modeloId, lineaId, anio),
    alProgresar: (escuchar) => suscribir('vehiculos:progreso', escuchar),
  },
  redes: {
    panel: () => invocar('redes:panel'),
    estadoMeta: () => invocar('redes:estadoMeta'),
    guardarMeta: (datos) => invocar('redes:guardarMeta', datos),
    borrarMeta: () => invocar('redes:borrarMeta'),
    vincular: (sucursal) => invocar('redes:vincular', sucursal),
    elegirPagina: (paginaId) => invocar('redes:elegirPagina', paginaId),
    desvincular: (sucursal) => invocar('redes:desvincular', sucursal),
    elegirArchivo: () => invocar('redes:elegirArchivo'),
    publicar: (pedido) => invocar('redes:publicar', pedido),
    publicaciones: (sucursal) => invocar('redes:publicaciones', sucursal),
    cuotaInstagram: (sucursal) => invocar('redes:cuotaInstagram', sucursal),
    comentarios: (sucursal, soloSinResponder) => invocar('redes:comentarios', sucursal, soloSinResponder),
    comentarioResponder: (comentarioId, mensaje) => invocar('redes:comentarios:responder', comentarioId, mensaje),
    comentarioOcultar: (comentarioId) => invocar('redes:comentarios:ocultar', comentarioId),
    comentarioMostrar: (comentarioId) => invocar('redes:comentarios:mostrar', comentarioId),
    comentarioEliminar: (comentarioId) => invocar('redes:comentarios:eliminar', comentarioId),
    conversaciones: (sucursal) => invocar('redes:conversaciones', sucursal),
    conversacionMensajes: (conversacionId) => invocar('redes:conversaciones:mensajes', conversacionId),
    conversacionResponder: (conversacionId, mensaje) => invocar('redes:conversaciones:responder', conversacionId, mensaje),
  },
  sistema: {
    abrirEnlace: (url) => invocar('sistema:abrirEnlace', url),
  },
  // El zoom se aplica acá mismo: `webFrame` es del renderer y la precarga corre en su proceso.
  // Se acota entre 50 % y 300 % para que un valor raro guardado en esta computadora no deje la
  // ventana en un tamaño del que no se pueda salir con los botones. Los pasos que ofrece la interfaz
  // van de 0,7 a 2 (`ESCALAS`, en src/renderer/vista.ts): si alguna vez se amplían, hay que ampliar
  // también este acotado o el paso nuevo se recorta en silencio.
  vista: {
    fijarZoom: (escala) => webFrame.setZoomFactor(Math.min(3, Math.max(0.5, escala))),
  },
  soporte: {
    elegirImagenes: () => invocar('soporte:elegirImagenes'),
    pegarImagen: () => invocar('soporte:pegarImagen'),
    reportar: (reporte) => invocar('soporte:reportar', reporte),
  },
  mesh: {
    estado: () => invocar('mesh:estado'),
  },
  app: {
    info: () => invocar('app:info'),
  },
  actualizaciones: {
    estado: () => invocar('actualizaciones:estado'),
    buscarAhora: () => invocar('actualizaciones:buscarAhora'),
    instalarAhora: () => invocar('actualizaciones:instalarAhora'),
    alCambiarEstado: (escuchar) => suscribir('actualizaciones:estado', escuchar),
  },
  ayuda: {
    guardarPdf: (pedido) => invocar('ayuda:guardarPdf', pedido),
  },
}

contextBridge.exposeInMainWorld('dm', api)
