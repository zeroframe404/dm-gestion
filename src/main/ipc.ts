// Registro de los canales IPC. Cada manejador implementa la firma declarada en shared/canales.ts.
// Los errores esperables (ErrorDeNegocio) vuelven como `{ ok: false, error }`; el resto se registra
// en consola y se devuelve un mensaje genérico para no filtrar detalles internos al renderer.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ArgumentosDe, DatosDeEvento, NombreCanal, NombreEvento, RespuestaDe } from '../shared/canales'
import { veLosNumerosDeLaAgencia } from '../shared/permisos'
import type { InfoApp, Resultado } from '../shared/tipos'
import { carpetaDatos, rutaBaseDeDatos, rutaConfig } from './rutas'
import { cambiarClave, ingresar, salir } from './servicios/auth'
import { comprobarAcceso, conectarEmisor, estadoDeAcceso, estadoDeUsuarios, subirLocales } from './servicios/baseDeUsuarios'
import {
  bajasDelMes,
  cerrarMes,
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
  avisarMora,
  cajaDelDia,
  cambiarResultado,
  comisiones,
  csvDeLaCaja,
  imputados,
  mora,
  registrarPagoManual,
} from './servicios/cobranzas'
import { guardarBinarioComo, guardarComo, guardarEn } from './servicios/exportacion'
import { guardarHtmlComoPdf, imprimirHtmlConDialogo, pdfDelHtml } from './servicios/impresion'
import { estadisticasDeCartera, tableroDeMetricas } from './servicios/metricas'
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
  desvincularDeMeta,
  elegirPaginaVinculada,
  panelDeRedes,
  publicarEnRed,
  revisarArchivoParaPublicar,
  vincularConMeta,
} from './servicios/redes'
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
  adoptarVehiculosDelVps,
  borrarVehiculosDelVps,
  estadoCompartidoDeVehiculos,
  publicarVehiculosEnElVps,
} from './servicios/ajustesCompartidos'
import { guardarPlantillaDeAviso, plantillaDeAviso } from './servicios/plantillas'
import { historialDeFila } from './servicios/historial'
import {
  arrancarSincronizacion,
  detenerSincronizacion,
  estadoDeSincronizacion,
  panelDeSincronizacion,
  respaldarAhora,
  sincronizarAhora,
  volverAIntentar,
} from './servicios/sincronizacion'
import { eliminarRegistro, vistaPreviaDeEliminacion } from './servicios/eliminacion'
import { ErrorDeNegocio } from './servicios/errores'
import { estadoDelMesh } from './servicios/mesh'
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
  puedeVer as puedeVerElArea,
} from './servicios/permisos'
import { exigirRol, exigirSesion, sesion } from './servicios/sesion'
import { listarSucursales } from './servicios/sucursales'
import { buscarActualizaciones, estadoDeActualizacion, instalarActualizacion } from './servicios/updater'
import { cambiarActivo, crearUsuario, editarUsuario, listarUsuarios, resetearClave } from './servicios/usuarios'
import { enteroPositivo } from './servicios/validacion'

type Manejador<C extends NombreCanal> = (...args: ArgumentosDe<C>) => RespuestaDe<C> | Promise<RespuestaDe<C>>

const MENSAJE_ERROR_GENERICO = 'Ocurrió un error inesperado. Revisá el registro de la aplicación.'

function manejar<C extends NombreCanal>(canal: C, manejador: Manejador<C>): void {
  ipcMain.handle(canal, async (_evento, ...args: unknown[]) => {
    try {
      return await manejador(...(args as ArgumentosDe<C>))
    } catch (error) {
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

function emitirATodas<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
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
    return exito(sesion)
  })
  manejar('auth:salir', () => {
    salir()
    detenerSincronizacion()
    return exito(null)
  })
  manejar('auth:sesion', () => exito(sesion()))
  manejar('auth:cambiarClave', async (datos) => exito(await cambiarClave(datos, exigirSesion())))
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
  manejar('usuarios:crear', async (datos) => exito(await crearUsuario(datos, exigirRol('SUPER_ADMIN'))))
  manejar('usuarios:editar', async (id, datos) => exito(await editarUsuario(id, datos, exigirRol('SUPER_ADMIN'))))
  manejar('usuarios:cambiarActivo', async (id, activo) => exito(await cambiarActivo(id, activo, exigirRol('SUPER_ADMIN'))))
  manejar('usuarios:resetearClave', async (id, claveTemporal) =>
    exito(await resetearClave(id, claveTemporal, exigirRol('SUPER_ADMIN'))),
  )
  manejar('usuarios:estado', async (comprobar) => {
    exigirRol('SUPER_ADMIN')
    return exito(await estadoDeUsuarios(comprobar === true))
  })
  manejar('usuarios:subirLocales', async () => exito(await subirLocales(exigirRol('SUPER_ADMIN'))))

  // Permisos por rol. Qué puede hacer uno mismo lo puede preguntar cualquiera (es lo que el renderer
  // usa para mostrar u ocultar); la matriz entera la mira y la toca sólo el SUPER_ADMIN.
  manejar('permisos:mios', () => exito(misPermisos(exigirSesion())))
  manejar('permisos:matriz', () => exito(matrizDePermisos(exigirRol('SUPER_ADMIN'))))
  manejar('permisos:guardar', async (permisos) => exito(await guardarPermisos(permisos, exigirRol('SUPER_ADMIN'))))
  conectarAvisoDePermisos(() => {
    const actual = sesion()
    if (actual) emitirATodas('permisos:cambiaron', misPermisos(actual))
  })

  // Borrado definitivo y puntual: sólo el SUPER_ADMIN, sin excepción y sin permiso que lo habilite.
  // Se pide el rol también para MIRAR lo que se llevaría el borrado: el detalle de un cliente entero
  // (cuántos pagos, cuántos siniestros) no tiene por qué salir de acá para quien no puede borrarlo.
  manejar('eliminacion:vistaPrevia', (tipo, id) => exito(vistaPreviaDeEliminacion(tipo, id, exigirRol('SUPER_ADMIN'))))
  manejar('eliminacion:borrar', (tipo, id) => exito(eliminarRegistro(tipo, id, exigirRol('SUPER_ADMIN'))))

  // Conexión con Google: SUPER_ADMIN y ADMIN, y con permiso sobre Administración.
  manejar('config:estadoGoogle', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(estadoGoogle())
  })
  manejar('config:guardarGoogle', (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(guardarGoogle(datos))
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
    exigirVista('cartera')
    return exito(planillaDelMes(periodo))
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
    return exito(deshacerBaja(enteroPositivo(bajaId, 'La baja'), exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  // «Poner vigente» devuelve una póliza a la cartera. Como el cierre de mes y como deshacer una baja,
  // mueve la planilla de todos: pide administrador además del permiso de edición.
  manejar('cartera:reactivarBaja', (bajaId, cambios) => {
    exigirEdicion('cartera')
    return exito(reactivarBaja(enteroPositivo(bajaId, 'La baja'), exigirRol('SUPER_ADMIN', 'ADMIN'), cambios))
  })
  manejar('cartera:bajas', (periodo) => {
    exigirVista('cartera')
    return exito(bajasDelMes(periodo))
  })
  manejar('cartera:cerrarMes', async () => {
    exigirEdicion('cartera')
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    // Antes de cerrar se fuerza una sincronización completa: si otra computadora ya cerró el mes
    // hace un rato, la bajada trae sus filas y el «ya existe» corta acá, en vez de generar una
    // planilla entera duplicada. Sin conexión se sigue igual que siempre (se cierra local y sube
    // después): el freno es el de siempre, los períodos que esta computadora conoce.
    await sincronizarAhora(true).catch(() => undefined)
    return exito(cerrarMes(actor))
  })
  manejar('cartera:historialDeFila', (filaId) => {
    exigirVista('cartera')
    return exito(historialDeFila(filaId))
  })

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
  manejar('rechazos:marcarVistos', () => {
    exigirVista('cartera', 'polizas')
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
  // todas las sucursales.
  manejar('companias:editar', (id, datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(editarCompania(id, datos))
  })

  // Cobranzas: la caja y la mora las trabaja quien tenga el módulo; las comisiones siguen pidiendo
  // administrador, aunque un empleado tenga «editar» en Cobranzas.
  // La caja y la rendición de las OTRAS sucursales son de los administradores; un empleado mira y
  // rinde lo de su mostrador (ver `sucursalObligadaDe` en cobranzas.ts).
  manejar('cobranzas:caja', (fecha, sucursales) => exito(cajaDelDia(fecha, sucursales, exigirVista('cobranzas'))))
  manejar('cobranzas:registrarPagoManual', (datos) => {
    const resultado = registrarPagoManual(datos, exigirEdicion('cobranzas'))
    if (datos.estadoCobro !== 'IMPUTADO') resolverTicketDelPago(resultado.pagoId)
    return exito(resultado.caja)
  })
  manejar('cobranzas:exportarCaja', async (fecha, sucursales) => {
    const archivo = csvDeLaCaja(fecha, sucursales, exigirVista('cobranzas'))
    return exito(await guardarComo({ ...archivo, descripcion: 'Planilla CSV' }, ventanaActual()))
  })
  manejar('cobranzas:mora', (filtros) => {
    exigirVista('cobranzas')
    return exito(mora(filtros))
  })
  manejar('cobranzas:avisarMora', (filaId) => exito(avisarMora(filaId, exigirEdicion('cobranzas'))))
  // Imputados es una pestaña de Cartera que trabaja sobre los pagos: se pide cualquiera de los dos.
  manejar('cobranzas:imputados', (periodo, companias) => exito(imputados(periodo, companias, exigirVista('cartera', 'cobranzas'))))
  manejar('cobranzas:cambiarResultado', (pagoId, resultado, companias) =>
    exito(cambiarResultado(pagoId, resultado, companias, exigirEdicion('cartera', 'cobranzas'))),
  )
  manejar('cobranzas:comisiones', (periodo) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('cobranzas')
    return exito(comisiones(periodo))
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
  // Un empleado ve y edita la dirección de SU sucursal y ninguna otra: la impresora que tiene delante
  // imprime esa y nada más, y poder tocar la de Lanús desde Dock Sud sólo sirve para romper el ticket
  // de un mostrador en el que uno no está. El recorte se hace acá, no en la pantalla.
  const miSucursalSiEsEmpleado = (): string | null => {
    const actor = exigirSesion()
    return actor.rol === 'EMPLEADO' ? actor.sucursal.nombre : null
  }
  manejar('impresora:direcciones', () => exito(direccionesDeTicket(miSucursalSiEsEmpleado())))
  manejar('impresora:guardarDirecciones', (direcciones) => exito(guardarDireccionesDeTicket(direcciones, miSucursalSiEsEmpleado())))
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
  manejar('config:guardarPlantillaAviso', (texto) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(guardarPlantillaDeAviso(texto))
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
  manejar('siniestros:abrirAdjunto', async (adjuntoId) => {
    exigirVista('siniestros')
    const error = await shell.openPath(rutaDelAdjunto(adjuntoId))
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
  manejar('tareas:abrirAdjunto', async (adjuntoId) => {
    exigirVista('tareas')
    const error = await shell.openPath(rutaDelAdjuntoDeTarea(adjuntoId))
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

  // Métricas: los números de la agencia.
  // Los agregados de plata de la agencia (lo recaudado del mes, su evolución, el reparto por medio de
  // pago) no viajan a un empleado. Se decide acá y no en la pantalla: un dato que llega al renderer ya
  // está afuera, y ocultarlo con un `if` en el JSX no lo oculta, sólo no lo dibuja.
  manejar('metricas:tablero', (filtros) => {
    const actor = exigirVista('metricas')
    return exito(tableroDeMetricas(filtros, veLosNumerosDeLaAgencia(actor.rol)))
  })
  // Estadísticas es la pestaña de Cartera con los mismos números en tabla.
  manejar('metricas:estadisticas', (periodo, sucursales) => {
    const actor = exigirVista('metricas', 'cartera')
    return exito(estadisticasDeCartera(periodo, sucursales, veLosNumerosDeLaAgencia(actor.rol)))
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
  // Un ADMIN puede cargarlas en SU computadora pero no publicarlas: son las credenciales de toda la
  // agencia y pisar las de las otras cinco máquinas es del que manda.
  manejar('vehiculos:guardarCredenciales', async (datos) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    guardarCredencialesDeVehiculos(datos)
    const estado = estadoDelCatalogo()
    if (actor.rol !== 'SUPER_ADMIN') {
      return exito({
        estado,
        compartido: await estadoCompartidoDeVehiculos(),
        detalle: 'Quedaron guardadas en esta computadora. Mandarlas al resto lo hace el superadministrador.',
      })
    }
    try {
      return exito({
        estado,
        compartido: await publicarVehiculosEnElVps(actor.nombre),
        detalle: 'Guardadas y mandadas al servidor: el resto de las computadoras las va a tomar al abrir el programa.',
      })
    } catch (error) {
      return exito({
        estado,
        compartido: {
          ...(await estadoCompartidoDeVehiculos()),
          error: error instanceof Error ? error.message : String(error),
        },
        detalle: 'Quedaron guardadas en esta computadora, pero no se pudieron mandar al servidor.',
      })
    }
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

  // --- Marketing → Redes -----------------------------------------------------
  //
  // Publicar es EDITAR Marketing: sale en nombre de la agencia y se ve desde afuera. Cargar la app de
  // Meta, en cambio, es una credencial y por eso pide administrador, igual que la cuenta de Google.
  // Mirar la pestaña alcanza con ver Marketing: tiene que poder abrirse aunque no haya nada cargado,
  // para que la pantalla explique qué falta en vez de romperse.
  manejar('redes:panel', async () => {
    exigirVista('marketing')
    return exito(await panelDeRedes())
  })
  manejar('redes:estadoMeta', () => {
    exigirVista('marketing', 'administracion')
    return exito(estadoMeta())
  })
  manejar('redes:guardarMeta', (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(guardarMeta(datos))
  })
  manejar('redes:borrarMeta', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(borrarMeta())
  })
  // Vincular deja la cuenta de la agencia atada a esta computadora: es de administradores.
  manejar('redes:vincular', async () => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    return exito(await vincularConMeta(ventanaActual(), actor))
  })
  manejar('redes:elegirPagina', async (paginaId) => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    elegirPaginaVinculada(paginaId, actor)
    return exito(await panelDeRedes())
  })
  manejar('redes:desvincular', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('marketing')
    desvincularDeMeta()
    return exito(await panelDeRedes())
  })
  manejar('redes:elegirArchivo', async () => {
    exigirEdicion('marketing')
    const ventana = ventanaActual()
    const opciones = {
      title: 'Elegí la foto para publicar',
      buttonLabel: 'Usar esta foto',
      properties: ['openFile'] as Array<'openFile'>,
      // Sólo fotos: los videos y los reels necesitan otro camino y todavía no están.
      filters: [{ name: 'Fotos', extensions: ['jpg', 'jpeg', 'png'] }],
    }
    const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    if (elegido.canceled || elegido.filePaths.length === 0) return exito(null)
    return exito(await revisarArchivoParaPublicar(elegido.filePaths[0]!))
  })
  manejar('redes:publicar', async (pedido) => {
    const actor = exigirEdicion('marketing')
    return exito(await publicarEnRed(pedido, actor))
  })

  // El control remoto de las computadoras de la agencia. Mirar si está en línea lo puede hacer
  // cualquiera que vea Administración; entrar a la consola pide su propia clave del otro lado, que es
  // como tiene que ser para un acceso a todas las máquinas.
  manejar('mesh:estado', async () => {
    exigirVista('administracion')
    return exito(await estadoDelMesh())
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
  manejar('actualizaciones:instalarAhora', () => {
    instalarActualizacion()
    return exito(null)
  })

  // Ayuda: el PDF de una pantalla de ayuda, por el mismo camino que ya usa el presupuesto.
  manejar('ayuda:guardarPdf', async (pedido) => {
    exigirSesion()
    return exito(await guardarHtmlComoPdf(pedido.html, pedido.nombreDeArchivo, ventanaActual()))
  })
}
