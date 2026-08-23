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

  // Conexión con Google: SUPER_ADMIN y ADMIN
  manejar('config:estadoGoogle', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(estadoGoogle())
  })
  manejar('config:guardarGoogle', (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(guardarGoogle(datos))
  })

  // Importación desde Google Sheets: SUPER_ADMIN y ADMIN
  manejar('importacion:vistaPrevia', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(await vistaPreviaDeHoja())
  })
  manejar('importacion:iniciar', () => exito(iniciarImportacion(exigirRol('SUPER_ADMIN', 'ADMIN'))))
  manejar('importacion:cancelar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    cancelarImportacion()
    return exito(null)
  })
  manejar('importacion:estado', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(estadoDelImportador())
  })
  manejar('importacion:guardarInforme', async (importacionId) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    const ventana = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    return exito(await guardarInforme(enteroPositivo(importacionId, 'La importación'), ventana))
  })
  manejar('importacion:abrirCarpetaInformes', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    abrirCarpetaInformes()
    return exito(null)
  })

  // Cartera: la planilla del mes. Todo el equipo puede trabajarla; cerrar el mes y deshacer una baja no.
  manejar('cartera:planilla', (periodo) => {
    exigirSesion()
    return exito(planillaDelMes(periodo))
  })
  manejar('cartera:editarCelda', (filaId, campo, valor) => exito(editarCelda(filaId, campo, valor, exigirSesion())))
  manejar('cartera:prepararAviso', (filaId) => exito(prepararAviso(filaId, exigirSesion())))
  manejar('cartera:registrarPago', (filaId, datos) => {
    const fila = registrarPago(filaId, datos, exigirSesion())
    imprimirTicketEnSegundoPlano(idDelPagoDeLaCuota(filaId))
    return exito(fila)
  })
  manejar('cartera:darDeBaja', (filaId, datos) => exito(darDeBaja(filaId, datos, exigirSesion())))
  manejar('cartera:deshacerBaja', (bajaId) => exito(deshacerBaja(enteroPositivo(bajaId, 'La baja'), exigirRol('SUPER_ADMIN', 'ADMIN'))))
  manejar('cartera:bajas', (periodo) => {
    exigirSesion()
    return exito(bajasDelMes(periodo))
  })
  manejar('cartera:cerrarMes', () => exito(cerrarMes(exigirRol('SUPER_ADMIN', 'ADMIN'))))
  manejar('cartera:historialDeFila', (filaId) => {
    exigirSesion()
    return exito(historialDeFila(filaId))
  })

  // Compañías y sus días de cobertura financiera: SUPER_ADMIN y ADMIN
  // El listado incluye el porcentaje de comisión, que es información de la agencia: no sale de acá
  // para un empleado, aunque la pantalla que lo usa ya sea sólo de administradores.
  manejar('companias:listar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(listarCompanias())
  })
  manejar('companias:editar', (id, datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(editarCompania(id, datos))
  })

  // Cobranzas: la caja y la mora las trabaja todo el equipo; las comisiones, no.
  manejar('cobranzas:caja', (fecha, sucursal) => {
    exigirSesion()
    return exito(cajaDelDia(fecha, sucursal))
  })
  manejar('cobranzas:registrarPagoManual', (datos) => {
    const resultado = registrarPagoManual(datos, exigirSesion())
    imprimirTicketEnSegundoPlano(resultado.pagoId)
    return exito(resultado.caja)
  })
  manejar('cobranzas:exportarCaja', async (fecha, sucursal) => {
    exigirSesion()
    const archivo = csvDeLaCaja(fecha, sucursal)
    return exito(await guardarComo({ ...archivo, descripcion: 'Planilla CSV' }, ventanaActual()))
  })
  manejar('cobranzas:mora', (filtros) => {
    exigirSesion()
    return exito(mora(filtros))
  })
  manejar('cobranzas:avisarMora', (filaId) => exito(avisarMora(filaId, exigirSesion())))
  manejar('cobranzas:imputados', (periodo, compania) => {
    exigirSesion()
    return exito(imputados(periodo, compania))
  })
  manejar('cobranzas:cambiarResultado', (pagoId, resultado, compania) =>
    exito(cambiarResultado(pagoId, resultado, compania, exigirSesion())),
  )
  manejar('cobranzas:comisiones', (periodo) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(comisiones(periodo))
  })

  // Ticketeadora térmica: la configura un administrador, la usa todo el mostrador.
  manejar('impresora:estado', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(await configuracionDeImpresora())
  })
  manejar('impresora:guardar', async (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(await guardarConfiguracionDeImpresora(datos))
  })
  manejar('impresora:prueba', async () => {
    const actor = exigirRol('SUPER_ADMIN', 'ADMIN')
    await imprimirTicketDePrueba(actor.sucursal.nombre, actor.nombre)
    return exito(null)
  })

  // Plantilla del aviso por WhatsApp
  manejar('config:plantillaAviso', () => {
    exigirSesion()
    return exito({ texto: plantillaDeAviso() })
  })
  manejar('config:guardarPlantillaAviso', (texto) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(guardarPlantillaDeAviso(texto))
  })

  // Sincronización con la hoja de Google
  manejar('sincronizacion:estado', () => {
    exigirSesion()
    return exito(estadoDeSincronizacion())
  })
  manejar('sincronizacion:panel', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(panelDeSincronizacion())
  })
  manejar('sincronizacion:ahora', async (completa) => {
    exigirSesion()
    return exito(await sincronizarAhora(completa === true))
  })
  manejar('sincronizacion:reintentar', () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(volverAIntentar())
  })
  manejar('sincronizacion:respaldarAhora', async () => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(await respaldarAhora())
  })

  // Clientes: los trabaja todo el equipo. Nada de acá borra en forma definitiva, así que no hace falta
  // pedir rol; alcanza con tener la sesión abierta.
  manejar('clientes:listar', (filtros) => {
    exigirSesion()
    return exito(listarClientes(filtros))
  })
  manejar('clientes:buscar', (busqueda) => {
    exigirSesion()
    return exito(buscarClientes(busqueda))
  })
  manejar('clientes:ficha', (clienteId) => {
    exigirSesion()
    return exito(fichaDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('clientes:crear', (datos) => exito(crearCliente(datos, exigirSesion())))
  manejar('clientes:editar', (clienteId, datos) =>
    exito(editarCliente(enteroPositivo(clienteId, 'El cliente'), datos, exigirSesion())),
  )
  manejar('clientes:agregarNota', (clienteId, textoDeLaNota) =>
    exito(agregarNota(enteroPositivo(clienteId, 'El cliente'), textoDeLaNota, exigirSesion())),
  )
  manejar('clientes:crearTarea', (datos) => exito(crearTarea(datos, exigirSesion())))
  manejar('clientes:cambiarEstadoDeTarea', (tareaId, estado) =>
    exito(cambiarEstadoDeTarea(enteroPositivo(tareaId, 'La tarea'), estado, exigirSesion())),
  )
  manejar('clientes:cuotasDelMes', (clienteId) => {
    exigirSesion()
    return exito(cuotasDelClienteEnElMes(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('clientes:deudores', (filtros) => {
    exigirSesion()
    return exito(buscarDeudores(filtros))
  })
  // Como en Reportes: la pantalla manda `ruta` en null y el diálogo se abre acá; la prueba de humo
  // manda la ruta, porque un diálogo del sistema no se puede manejar desde afuera.
  manejar('clientes:exportarDeudores', async (filtros, formato, ruta) => {
    exigirSesion()
    const archivo = archivoDeDeudores(filtros, formato)
    const destino = typeof ruta === 'string' && ruta.trim() ? ruta.trim() : null
    if (destino) return exito(guardarEn(destino, archivo.contenido))
    if (typeof archivo.contenido === 'string') {
      return exito(await guardarComo({ ...archivo, contenido: archivo.contenido }, ventanaActual()))
    }
    return exito(await guardarBinarioComo({ ...archivo, contenido: archivo.contenido }, ventanaActual(), 'Guardar el listado de deudores'))
  })

  // Siniestros: los trabaja todo el equipo. Borrar un documento sí pide administrador: es definitivo.
  manejar('siniestros:crear', (datos) => exito(crearSiniestro(datos, exigirSesion())))
  manejar('siniestros:listar', (filtros) => {
    exigirSesion()
    return exito(listarSiniestros(filtros))
  })
  manejar('siniestros:ficha', (siniestroId) => {
    exigirSesion()
    return exito(fichaDeSiniestro(enteroPositivo(siniestroId, 'El siniestro')))
  })
  manejar('siniestros:buscar', (busqueda) => {
    exigirSesion()
    return exito(buscarParaSiniestro(busqueda))
  })
  manejar('siniestros:alta', (datos) => exito(altaDeSiniestro(datos, exigirSesion())))
  manejar('siniestros:cambiarEstado', (siniestroId, estado) => exito(cambiarEstadoDeSiniestro(siniestroId, estado, exigirSesion())))
  manejar('siniestros:editar', (siniestroId, campo, valor) => exito(editarSiniestro(siniestroId, campo, valor, exigirSesion())))
  manejar('siniestros:agregarObservacion', (siniestroId, textoDeLaObservacion) =>
    exito(agregarObservacion(siniestroId, textoDeLaObservacion, exigirSesion())),
  )
  manejar('siniestros:adjuntar', async (siniestroId, rutas) => {
    const actor = exigirSesion()
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
    exigirSesion()
    const error = await shell.openPath(rutaDelAdjunto(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('siniestros:borrarAdjunto', (adjuntoId) => exito(borrarAdjunto(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN'))))
  manejar('siniestros:crearTarea', (datos) => exito(crearTareaDeSiniestro(datos, exigirSesion())))
  manejar('siniestros:cambiarEstadoDeTarea', (tareaId, estado) =>
    exito(cambiarEstadoDeTareaDeSiniestro(tareaId, estado, exigirSesion())),
  )

  // Riesgos varios: se ven y se editan como la planilla del mes, sin pedir rol.
  manejar('riesgos:listar', () => {
    exigirSesion()
    return exito(listarRiesgos())
  })
  manejar('riesgos:editar', (riesgoId, campo, valor) => exito(editarRiesgo(riesgoId, campo, valor, exigirSesion())))
  manejar('riesgos:crear', (datos) => exito(crearRiesgo(datos, exigirSesion())))

  // AMP: las ampliaciones pendientes.
  manejar('amp:listar', (incluirResueltas) => {
    exigirSesion()
    return exito(listarAmp(incluirResueltas))
  })
  manejar('amp:cambiarResuelto', (ampId, resuelto, incluirResueltas) =>
    exito(cambiarResueltoDeAmp(ampId, resuelto, incluirResueltas, exigirSesion())),
  )

  // Pólizas
  manejar('polizas:listar', (filtros) => {
    exigirSesion()
    return exito(listarPolizas(filtros))
  })
  manejar('polizas:ver', (polizaId) => {
    exigirSesion()
    return exito(verPoliza(enteroPositivo(polizaId, 'La póliza')))
  })
  manejar('polizas:deCliente', (clienteId) => {
    exigirSesion()
    return exito(polizasDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('polizas:vehiculosDeCliente', (clienteId) => {
    exigirSesion()
    return exito(vehiculosDeCliente(enteroPositivo(clienteId, 'El cliente')))
  })
  manejar('polizas:catalogos', () => {
    exigirSesion()
    return exito(catalogosDePoliza())
  })
  manejar('polizas:validarCobertura', (compania, cobertura, anioVehiculo) => {
    exigirSesion()
    return exito(validarCobertura(compania, cobertura, anioVehiculo))
  })
  // El servicio es el que decide si hace falta un administrador para saltear la advertencia de
  // cobertura: es una regla de negocio, no un permiso de pantalla.
  manejar('polizas:crear', (datos) => exito(crearPoliza(datos, exigirSesion())))
  manejar('polizas:editar', (polizaId, datos) => exito(editarPoliza(enteroPositivo(polizaId, 'La póliza'), datos, exigirSesion())))
  manejar('polizas:darDeBaja', (polizaId, datos) =>
    exito(darDeBajaPoliza(enteroPositivo(polizaId, 'La póliza'), datos, exigirSesion())),
  )

  // Reglas de cobertura: las consulta todo el equipo mientras atiende, las carga el SUPER_ADMIN.
  manejar('reglas:matriz', () => exito(matrizDeCobertura(exigirSesion())))
  manejar('reglas:vigentes', () => {
    exigirSesion()
    return exito(reglasVigentes())
  })
  manejar('reglas:crear', (datos) => exito(crearRegla(datos, exigirRol('SUPER_ADMIN'))))
  manejar('reglas:editar', (id, datos) => exito(editarRegla(enteroPositivo(id, 'La regla'), datos, exigirRol('SUPER_ADMIN'))))
  manejar('reglas:borrar', (id) => exito(borrarRegla(enteroPositivo(id, 'La regla'), exigirRol('SUPER_ADMIN'))))

  // Renovaciones: la bandeja la trabaja todo el equipo, incluidos los empleados.
  manejar('renovaciones:bandeja', () => {
    exigirSesion()
    return exito(bandejaDeRenovaciones())
  })
  manejar('renovaciones:sugerencia', (polizaId) => {
    exigirSesion()
    return exito(datosSugeridosDeRenovacion(enteroPositivo(polizaId, 'La póliza')))
  })
  manejar('renovaciones:actualizar', (polizaId, venceEl, datos) =>
    exito(actualizarSeguimiento(enteroPositivo(polizaId, 'La póliza'), venceEl, datos, exigirSesion())),
  )
  manejar('renovaciones:renovar', (polizaId, datos) => exito(renovar(enteroPositivo(polizaId, 'La póliza'), datos, exigirSesion())))
  manejar('renovaciones:noRenueva', (polizaId, datos) =>
    exito(noRenueva(enteroPositivo(polizaId, 'La póliza'), datos, exigirSesion())),
  )

  // Leads: la consulta que todavía no es cliente. La trabaja todo el equipo, sin pedir rol.
  manejar('leads:listar', (filtros) => {
    exigirSesion()
    return exito(listarLeads(filtros))
  })
  manejar('leads:ficha', (leadId) => {
    exigirSesion()
    return exito(fichaDeLead(enteroPositivo(leadId, 'La consulta')))
  })
  manejar('leads:crear', (datos) => exito(crearLead(datos, exigirSesion())))
  manejar('leads:editar', (leadId, datos) => exito(editarLead(enteroPositivo(leadId, 'La consulta'), datos, exigirSesion())))
  manejar('leads:cambiarEstado', (leadId, estado) => exito(cambiarEstadoDeLead(leadId, estado, exigirSesion())))
  manejar('leads:agregarNota', (leadId, texto) => exito(agregarNotaDeLead(leadId, texto, exigirSesion())))
  manejar('leads:convertir', (leadId) => exito(convertirLeadEnCliente(leadId, exigirSesion())))

  // Presupuestos
  manejar('presupuestos:listar', (filtros) => {
    exigirSesion()
    return exito(listarPresupuestos(filtros))
  })
  manejar('presupuestos:ficha', (presupuestoId) => {
    exigirSesion()
    return exito(fichaDePresupuesto(enteroPositivo(presupuestoId, 'El presupuesto')))
  })
  manejar('presupuestos:crear', (datos) => exito(crearPresupuesto(datos, exigirSesion())))
  manejar('presupuestos:guardar', (presupuestoId, datos) =>
    exito(guardarPresupuesto(enteroPositivo(presupuestoId, 'El presupuesto'), datos, exigirSesion())),
  )
  manejar('presupuestos:enviar', (presupuestoId) => exito(enviarPresupuesto(presupuestoId, exigirSesion())))
  manejar('presupuestos:aceptar', (presupuestoId, opcionId) => exito(aceptarPresupuesto(presupuestoId, opcionId, exigirSesion())))
  manejar('presupuestos:rechazar', (presupuestoId, motivo) => exito(rechazarPresupuesto(presupuestoId, motivo, exigirSesion())))
  manejar('presupuestos:guardarPdf', async (presupuestoId) => {
    exigirSesion()
    const papel = presupuestoParaImprimir(enteroPositivo(presupuestoId, 'El presupuesto'))
    return exito(await guardarHtmlComoPdf(papel.html, papel.nombreDeArchivo, ventanaActual()))
  })
  manejar('presupuestos:imprimir', async (presupuestoId) => {
    exigirSesion()
    const papel = presupuestoParaImprimir(enteroPositivo(presupuestoId, 'El presupuesto'))
    return exito(await imprimirHtmlConDialogo(papel.html))
  })

  // Tareas: los pendientes internos. Las ve y las trabaja todo el equipo.
  manejar('tareas:listar', (filtros) => {
    exigirSesion()
    return exito(listarTareas(filtros))
  })
  manejar('tareas:ficha', (tareaId) => exito(fichaDeTarea(enteroPositivo(tareaId, 'La tarea'), exigirSesion())))
  manejar('tareas:crear', (datos) => exito(crearTareaCompleta(datos, exigirSesion())))
  manejar('tareas:editar', (tareaId, datos) => exito(editarTarea(enteroPositivo(tareaId, 'La tarea'), datos, exigirSesion())))
  manejar('tareas:cambiarEstado', (tareaId, estado) => exito(cambiarEstadoDeTareaDelModulo(tareaId, estado, exigirSesion())))
  manejar('tareas:comentar', (tareaId, texto) => exito(agregarComentario(tareaId, texto, exigirSesion())))
  manejar('tareas:adjuntar', async (tareaId, rutas) => {
    const actor = exigirSesion()
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
    exigirSesion()
    const error = await shell.openPath(rutaDelAdjuntoDeTarea(adjuntoId))
    if (error) throw new ErrorDeNegocio(`No se pudo abrir el documento: ${error}`)
    return exito(null)
  })
  manejar('tareas:borrarAdjunto', (adjuntoId) => exito(borrarAdjuntoDeTarea(adjuntoId, exigirRol('SUPER_ADMIN', 'ADMIN'))))
  manejar('tareas:mias', () => exito(misTareas(exigirSesion())))
  manejar('tareas:avisos', () => exito(avisosDeTareas(exigirSesion())))
  manejar('tareas:marcarVistos', () => exito(marcarAvisosVistos(exigirSesion())))

  // Métricas: los números de la agencia. Los mira todo el equipo, igual que la planilla.
  manejar('metricas:tablero', (filtros) => {
    exigirSesion()
    return exito(tableroDeMetricas(filtros))
  })
  manejar('metricas:estadisticas', (periodo, sucursal) => {
    exigirSesion()
    return exito(estadisticasDeCartera(periodo, sucursal))
  })

  // Reportes: exportar lo que ya se ve en pantalla. No hay nada acá que un empleado no pueda mirar
  // desde su listado, así que alcanza con la sesión abierta.
  manejar('reportes:catalogo', () => {
    exigirSesion()
    return exito(catalogoDeReportes())
  })
  manejar('reportes:vistaPrevia', (pedido) => {
    exigirSesion()
    return exito(vistaPreviaDeReporte(pedido))
  })
  // La pantalla manda `ruta` en null y el diálogo se abre acá; la prueba de humo manda la ruta,
  // porque un diálogo del sistema no se puede manejar desde afuera. Es lo mismo que hace adjuntar.
  manejar('reportes:exportar', async (pedido, formato, ruta) => {
    exigirSesion()
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
    exigirSesion()
    const archivo = xlsxDePlanillaClasica(opciones)
    const destino = typeof ruta === 'string' && ruta.trim() ? ruta.trim() : null
    if (destino) return exito(guardarEn(destino, archivo.contenido))
    return exito(await guardarBinarioComo({ ...archivo, descripcion: 'Planilla de Excel' }, ventanaActual(), 'Guardar la planilla clásica'))
  })

  // Marketing: las plantillas las edita un administrador (son lo que la agencia le dice al cliente);
  // los segmentos los arma cualquiera, pero borrar uno que usa todo el equipo sí pide administrador.
  manejar('marketing:plantillas', () => {
    exigirSesion()
    return exito(listarPlantillas())
  })
  manejar('marketing:crearPlantilla', (datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(crearPlantilla(datos))
  })
  manejar('marketing:editarPlantilla', (clave, datos) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(editarPlantilla(clave, datos))
  })
  manejar('marketing:borrarPlantilla', (clave) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(borrarPlantilla(clave))
  })
  manejar('marketing:segmento', (segmentoId, filtros, plantillaClave) => {
    exigirSesion()
    return exito(resultadoDeSegmento(segmentoId, filtros, plantillaClave))
  })
  manejar('marketing:guardarSegmento', (segmentoId, datos) => exito(guardarSegmento(segmentoId, datos, exigirSesion())))
  manejar('marketing:borrarSegmento', (segmentoId) => {
    exigirRol('SUPER_ADMIN', 'ADMIN')
    return exito(borrarSegmento(segmentoId))
  })
  manejar('marketing:avisar', (filaId, segmentoId, filtros, plantillaClave) =>
    exito(avisarDeSegmento(filaId, segmentoId, filtros, plantillaClave, exigirSesion())),
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
