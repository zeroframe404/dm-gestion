// Registro de los canales IPC. Cada manejador implementa la firma declarada en shared/canales.ts.
// Los errores esperables (ErrorDeNegocio) vuelven como `{ ok: false, error }`; el resto se registra
// en consola y se devuelve un mensaje genérico para no filtrar detalles internos al renderer.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ArgumentosDe, DatosDeEvento, NombreCanal, NombreEvento, RespuestaDe } from '../shared/canales'
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
  idDelPagoDeLaCuota,
  marcarAvisado,
  planillaDelMes,
  prepararAviso,
  registrarPago,
} from './servicios/cartera'
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
  catalogoDeReportes,
  htmlDelReporte,
  vistaPreviaDeReporte,
  xlsxDePlanillaClasica,
  xlsxDelReporte,
} from './servicios/reportes'
import { borrarPlantilla, crearPlantilla, editarPlantilla, listarPlantillas } from './servicios/plantillas'
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
import { configuracionDeImpresora, guardarConfiguracionDeImpresora, imprimirTicketDePago, imprimirTicketDePrueba } from './servicios/ticket'
import {
  agregarNota,
  buscarClientes,
  cambiarEstadoDeTarea,
  crearCliente,
  crearTarea,
  editarCliente,
  fichaDeCliente,
  listarClientes,
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
import { estadoGoogle, guardarGoogle } from './servicios/config'
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
import { ErrorDeNegocio } from './servicios/errores'
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
 * El ticket se manda a imprimir sin esperarlo: el pago ya está guardado y quien cobra no tiene que
 * quedarse mirando la impresora. Si falla, el motivo queda en Administración → Impresora.
 */
function imprimirTicketEnSegundoPlano(pagoId: number | null): void {
  if (pagoId === null) return
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
    imprimirTicketEnSegundoPlano(idDelPagoDeLaCuota(filaId))
    return exito(fila)
  })
  manejar('cartera:darDeBaja', (filaId, datos) => exito(darDeBaja(filaId, datos, exigirEdicion('cartera'))))
  manejar('cartera:deshacerBaja', (bajaId) => {
    exigirEdicion('cartera')
    return exito(deshacerBaja(enteroPositivo(bajaId, 'La baja'), exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  manejar('cartera:bajas', (periodo) => {
    exigirVista('cartera')
    return exito(bajasDelMes(periodo))
  })
  manejar('cartera:cerrarMes', () => {
    exigirEdicion('cartera')
    return exito(cerrarMes(exigirRol('SUPER_ADMIN', 'ADMIN')))
  })
  manejar('cartera:historialDeFila', (filaId) => {
    exigirVista('cartera')
    return exito(historialDeFila(filaId))
  })

  // Compañías y sus días de cobertura financiera: SUPER_ADMIN y ADMIN
  // El listado incluye el porcentaje de comisión, que es información de la agencia: no sale de acá
  // para un empleado, aunque la pantalla que lo usa ya sea sólo de administradores.
  manejar('companias:listar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(listarCompanias())
  })
  manejar('companias:editar', (id, datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(editarCompania(id, datos))
  })

  // Cobranzas: la caja y la mora las trabaja quien tenga el módulo; las comisiones siguen pidiendo
  // administrador, aunque un empleado tenga «editar» en Cobranzas.
  manejar('cobranzas:caja', (fecha, sucursal) => {
    exigirVista('cobranzas')
    return exito(cajaDelDia(fecha, sucursal))
  })
  manejar('cobranzas:registrarPagoManual', (datos) => {
    const resultado = registrarPagoManual(datos, exigirEdicion('cobranzas'))
    imprimirTicketEnSegundoPlano(resultado.pagoId)
    return exito(resultado.caja)
  })
  manejar('cobranzas:exportarCaja', async (fecha, sucursal) => {
    exigirVista('cobranzas')
    const archivo = csvDeLaCaja(fecha, sucursal)
    return exito(await guardarComo({ ...archivo, descripcion: 'Planilla CSV' }, ventanaActual()))
  })
  manejar('cobranzas:mora', (filtros) => {
    exigirVista('cobranzas')
    return exito(mora(filtros))
  })
  manejar('cobranzas:avisarMora', (filaId) => exito(avisarMora(filaId, exigirEdicion('cobranzas'))))
  // Imputados es una pestaña de Cartera que trabaja sobre los pagos: se pide cualquiera de los dos.
  manejar('cobranzas:imputados', (periodo, compania) => {
    exigirVista('cartera', 'cobranzas')
    return exito(imputados(periodo, compania))
  })
  manejar('cobranzas:cambiarResultado', (pagoId, resultado, compania) =>
    exito(cambiarResultado(pagoId, resultado, compania, exigirEdicion('cartera', 'cobranzas'))),
  )
  manejar('cobranzas:comisiones', (periodo) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('cobranzas')
    return exito(comisiones(periodo))
  })

  // Ticketeadora térmica: la configura un administrador, la usa todo el mostrador.
  manejar('impresora:estado', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirVista('administracion')
    return exito(await configuracionDeImpresora())
  })
  manejar('impresora:guardar', async (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    return exito(await guardarConfiguracionDeImpresora(datos))
  })
  manejar('impresora:prueba', async () => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    exigirEdicion('administracion')
    await imprimirTicketDePrueba(actor.sucursal.nombre, actor.nombre)
    return exito(null)
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
  manejar('siniestros:adjuntar', async (siniestroId, rutas) => {
    const actor = exigirEdicion('siniestros')
    const id = enteroPositivo(siniestroId, 'El siniestro')
    if (rutas !== null && rutas !== undefined) return exito(await agregarAdjuntos(id, rutas, actor))
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
    return exito(await agregarAdjuntos(id, elegido.filePaths, actor))
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
  manejar('metricas:tablero', (filtros) => {
    exigirVista('metricas')
    return exito(tableroDeMetricas(filtros))
  })
  // Estadísticas es la pestaña de Cartera con los mismos números en tabla.
  manejar('metricas:estadisticas', (periodo, sucursal) => {
    exigirVista('metricas', 'cartera')
    return exito(estadisticasDeCartera(periodo, sucursal))
  })

  // Reportes: exportar lo que ya se ve en pantalla. Un reporte junta datos de varios módulos, así que
  // se pide el permiso del módulo Reportes y nada más.
  manejar('reportes:catalogo', () => {
    exigirVista('reportes')
    return exito(catalogoDeReportes())
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
