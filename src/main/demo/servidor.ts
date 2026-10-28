// El «VPS» de la versión de demostración: el mismo simulador del puente /api/dmg que usan las pruebas
// (`scripts/vps-simulado.mjs`), corriendo ADENTRO del programa y escuchando sólo en 127.0.0.1.
//
// Por qué un servidor y no un modo «sin servidor». El programa de verdad hace casi todo contra el VPS:
// la base del GENERAL DE CLIENTES, los usuarios, los ajustes compartidos, el canal en vivo (presencia,
// avisos, llamadas), la mensajería, los adjuntos y los respaldos. Sin servidor, la demo mostraría la
// mitad del programa apagado. Con el simulador, el programa no sabe que es una demo: ingresa, baja la
// base, la importa y sincroniza exactamente como en la agencia, y quien la prueba ve el producto entero.
//
// Lo que NO hace, a propósito: no guarda nada en disco. Cada vez que se abre la demo arranca de cero con
// los mismos datos de ejemplo (fechados a hoy), y la carpeta local se limpia al arrancar (ver `rutas.ts`).
// Así una demostración nunca queda «rota» por lo que tocó la anterior.
import { createHash } from 'node:crypto'
import { hashSync } from 'bcryptjs'
import { app } from 'electron'
import { VpsSimulado } from '../../../scripts/vps-simulado.mjs'
import { CLAVE_DE_LA_DEMO, EJEMPLO_URL_DEL_VPS, TOKEN_DE_LA_DEMO, USUARIOS_DE_LA_DEMO, type EstadoDeLaDemo, type UsuarioDeLaDemo } from '../../shared/demo'
import { permisosPorDefecto } from '../../shared/permisos'
import { claveDeSucursal, sucursalCanonica, SUCURSALES } from '../../shared/sucursales'
import { plantillaDeAvisoFirmada } from '../../shared/tipos'
import { normalizarTexto } from '../importacion/normalizar'
import { diasPorDefectoDe, mesesDeRenovacionPorDefectoDe } from '../servicios/companias'
import { escribirDocumento, FORMATO_ACTUAL, type DocumentoUsuarios } from '../usuarios/documento'
import { armarDatosDeLaDemo, COMPANIAS_DE_LA_DEMO } from './datos'
import { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO } from './identidad'

let servidor: VpsSimulado | null = null
let armadaEn = ''
/** Lucía y Jorge «con el programa abierto» (ver `CompaneroVirtual`). Se apagan con el servidor. */
let companeros: CompanerosVirtuales | null = null

/** La dirección y el token del servidor de la demo, o null si todavía no arrancó. */
export function credencialesDeLaDemo(): { urlBase: string; token: string } | null {
  if (!servidor?.url) return null
  return { urlBase: servidor.url, token: servidor.token }
}

export function estadoDeLaDemo(): EstadoDeLaDemo | null {
  if (!servidor) return null
  let filas = 0
  for (const pestana of servidor.pestanas) filas += pestana.filas.size
  return {
    urlDelServidor: servidor.url,
    armadaEn,
    pestanas: servidor.pestanas.length,
    filas,
    usuarios: USUARIOS_DE_LA_DEMO.length,
  }
}

/**
 * Arma los datos de ejemplo y levanta el servidor. Tiene que terminar ANTES de preparar la base de
 * usuarios y de que se abra la ventana: todo lo que viene después pregunta por las credenciales del VPS.
 */
export async function arrancarServidorDeLaDemo(hoy = new Date()): Promise<void> {
  if (servidor) return
  const datos = armarDatosDeLaDemo(hoy)
  const nuevo = new VpsSimulado({ token: TOKEN_DE_LA_DEMO, pestanas: datos.pestanas })
  // El simulador de las pruebas contesta al instante y corta el timbre enseguida; en una demo las
  // esperas tienen que ser las de verdad.
  nuevo.timbreDeLlamadaMs = 45_000
  nuevo.esperaEntreZumbidosMs = 10_000
  nuevo.cargarVehiculos(datos.vehiculos as Parameters<VpsSimulado['cargarVehiculos']>[0], hoy.toISOString().slice(0, 10))
  nuevo.usuarios = {
    texto: escribirDocumento(documentoDeUsuarios(hoy)),
    version: 1,
    actualizadoEn: hoy.toISOString(),
    actualizadoPor: null,
    mensaje: 'Usuarios de la demo',
  }
  sembrarAjustes(nuevo, hoy)
  sembrarLecturasDeLasApis(nuevo, datos.vehiculos, hoy)
  // El manejador de mensajes SIN el parche de abajo: es el que usan la siembra y los compañeros
  // virtuales, que no son «alguien que entra» y no tienen que gastarle la primera vuelta a nadie.
  const atenderMensajes = nuevo.atenderMensajes.bind(nuevo)
  sembrarConversaciones(nuevo, atenderMensajes, hoy)
  entregarLoUltimoAlEntrar(nuevo, atenderMensajes)
  // Un respaldo del día, para que «Respaldos del servidor» no abra vacía.
  nuevo.guardarRespaldo('DIARIO', null)
  await nuevo.escuchar(0)
  servidor = nuevo
  armadaEn = hoy.toISOString()
  companeros = new CompanerosVirtuales(nuevo, atenderMensajes)
  companeros.arrancar()
  console.log(`[demo] Servidor de demostración en ${nuevo.url} (${datos.pestanas.length} pestañas).`)
}

export async function pararServidorDeLaDemo(): Promise<void> {
  const actual = servidor
  servidor = null
  companeros?.parar()
  companeros = null
  if (actual) await actual.cerrar()
}

// ---------------------------------------------------------------------------
// Lo que el servidor de una agencia ya tiene cargado
// ---------------------------------------------------------------------------

function documentoDeUsuarios(hoy: Date): DocumentoUsuarios {
  const ahora = hoy.toISOString()
  // Costo bajo a propósito: son seis hashes al abrir la demo y la contraseña es pública.
  const claveHash = hashSync(CLAVE_DE_LA_DEMO, 8)
  return {
    formato: FORMATO_ACTUAL,
    siguienteId: USUARIOS_DE_LA_DEMO.length + 1,
    usuarios: USUARIOS_DE_LA_DEMO.map((usuario, indice) => ({
      id: indice + 1,
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      claveHash,
      rol: usuario.rol,
      sucursal: usuario.sucursal,
      activo: true,
      debeCambiarClave: false,
      creadoEn: ahora,
      actualizadoEn: ahora,
    })),
    permisos: permisosPorDefecto(),
  }
}

/**
 * Los ajustes compartidos que un servidor de agencia ya tiene cargados, para que ninguna pantalla de la
 * demo abra vacía ni con el cartel amarillo de «todavía no se compartió»:
 *
 * - Las cuentas de las APIs de las compañías, como las dejaría el superadministrador. Son de mentira: en
 *   la demo ningún adaptador sale a internet (ver `demo/aseguradoras.ts`), pero así las pantallas de
 *   «API aseguradoras» se ven configuradas, que es como las va a ver la agencia.
 * - `companias`: la comisión de cada compañía (sin ella Cobranzas → Comisiones da $ 0,00).
 * - `ticket`, `meta`, `referencias` y `actualizaciones_sucursales`: ver cada función.
 *
 * La huella es la MISMA cuenta que hace el servidor al guardar (SHA-256 del JSON del valor), y los
 * valores tienen exactamente la forma —y el orden de claves y de filas— que cada computadora vuelve a
 * armar después de adoptarlos (`valorCompartidoDeCompanias`, `valorCompartidoDelTicket`,
 * `instantaneaDeReferencias`…). Así, apenas se adoptan, cada pantalla dice «al día» y no «desactualizada».
 * La prueba `pruebas/demo-servidor.prueba.ts` lo verifica contra una base de verdad.
 */
function sembrarAjustes(simulador: VpsSimulado, hoy: Date): void {
  const valores: Record<string, object> = {
    atmApi: { ambiente: 'desarrollo', usuario: 'demo.productor', clave: 'demo-clave', vendedor: '00001' },
    mercantilApi: {
      ambiente: 'desarrollo',
      usuario: 'demo.productor',
      clave: 'demo-clave',
      claveDeSuscripcion: 'demo-suscripcion-0000',
      productor: '12345',
    },
    equidadApi: {
      ambiente: 'prueba',
      urlBase: 'https://demo.equidad.invalid/servlet/',
      usuario: 'demo.productor',
      clave: 'demo-clave',
      usuarioDeServicio: 'demo.servicio',
      claveDeServicio: 'demo-clave-servicio',
      productor: '12345',
      rama: '4',
      empresa: '1',
    },
    galenoApi: { usuario: 'demo.productor', clave: 'demo-clave', productor: '12345' },
    companias: ajusteDeCompanias(),
    ticket: ajusteDelTicket(),
    // La app de Facebook e Instagram, de ejemplo: la demo no habla con Meta (`redes/meta.ts` corta antes
    // de salir y `demo/redes.ts` contesta en su lugar), pero sin esto la tarjeta de Redes sociales decía
    // a la vez «la app está cargada» y «el servidor todavía no tiene la app de Meta».
    meta: { appId: '1234567890123456', appSecret: 'demo-secreto-de-la-app', urlDeRedireccion: `${EJEMPLO_URL_DEL_VPS}/meta/vuelta` },
    referencias: ajusteDeReferencias(hoy),
    actualizaciones_sucursales: ajusteDeActualizaciones(hoy),
  }
  for (const [clave, valor] of Object.entries(valores)) {
    simulador.ajustes.set(clave, {
      clave,
      valor,
      huella: createHash('sha256').update(JSON.stringify(valor)).digest('hex'),
      actualizadoEn: hoy.toISOString(),
      actualizadoPor: 'Martina Demo',
    })
  }
}

/** Lo que gana la agencia por compañía, en %. Inventado pero en el rango de la plaza (10 a 25 %). */
const COMISIONES: Record<string, number> = {
  SANCOR: 18,
  ATM: 22,
  RIVADAVIA: 20,
  'SAN CRISTOBAL': 17,
  'FEDERACION PATRONAL': 16,
  'MERCANTIL ANDINA': 19,
  GALENO: 21,
  ZURICH: 14,
  EQUIDAD: 23,
  'RIO URUGUAY': 20,
  AGROSALTA: 25,
  METROPOL: 22.5,
}

/**
 * El catálogo de compañías con su comisión: la forma de `valorCompartidoDeCompanias` (servicios/
 * companias.ts), ordenado por nombre normalizado. Los días de cobertura y los meses de renovación son los
 * mismos que pondría `sincronizarCompanias` al verlas en la cartera; la plantilla del aviso es la de
 * fábrica firmada por la agencia de demostración, que es la que deja `refirmarPlantillas` en la base.
 */
function ajusteDeCompanias(): object {
  const companias = COMPANIAS_DE_LA_DEMO.map((nombre) => ({
    nombre,
    nombreNormalizado: normalizarTexto(nombre),
    diasCoberturaFinanciera: diasPorDefectoDe(nombre),
    comisionPorcentaje: COMISIONES[nombre] ?? 15,
    mesesRenovacion: mesesDeRenovacionPorDefectoDe(nombre),
    activa: true,
  })).sort((a, b) => (a.nombreNormalizado < b.nombreNormalizado ? -1 : a.nombreNormalizado > b.nombreNormalizado ? 1 : 0))
  return { version: 1, companias, plantillaAviso: plantillaDeAvisoFirmada(NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO) }
}

/** «AVELLANEDA» guardada a mano y «Dock Sud» del catálogo son el mismo mostrador (como en ticket.ts). */
function identidadDeSucursal(nombre: string): string {
  return claveDeSucursal(sucursalCanonica(nombre) ?? nombre)
}

/** El encabezado del ticket de cada sucursal: direcciones y teléfonos inventados, en la forma de `valorCompartidoDelTicket`. */
function ajusteDelTicket(): object {
  const DIRECCIONES: Record<string, { direccion: string; telefono: string }> = {
    'Dock Sud': { direccion: 'Av. Debenedetti 1450, Dock Sud', telefono: '11-4201-0000' },
    Lanús: { direccion: 'Av. Hipólito Yrigoyen 4300, Lanús Oeste', telefono: '11-4241-0000' },
    Sarandí: { direccion: 'Av. Mitre 3900, Sarandí', telefono: '11-4204-0000' },
    Daniel: { direccion: 'Av. Belgrano 800, Avellaneda (atención con turno)', telefono: '11-5263-0000' },
  }
  const direcciones = SUCURSALES.map((sucursal) => ({ sucursal, ...DIRECCIONES[sucursal]! })).sort((a, b) =>
    identidadDeSucursal(a.sucursal).localeCompare(identidadDeSucursal(b.sucursal)),
  )
  return { direcciones }
}

/** La misma normalización que arma las claves de las listas (referenciasCompartidas.ts). */
function claveDeReferencia(...partes: unknown[]): string {
  return partes
    .map((valor) =>
      String(valor ?? '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim(),
    )
    .join('|')
}

function porClave<T>(filas: T[], clave: (fila: T) => string): T[] {
  return filas
    .map((fila) => ({ fila, clave: clave(fila) }))
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map(({ fila }) => fila)
}

/**
 * Las cuatro listas del módulo Compañías (organizadores, precios, grúas y cláusulas), como las publica el
 * superadministrador: la instantánea de `referenciasCompartidas.ts`, con las columnas en su orden fijo y
 * las filas ordenadas por la misma clave con la que la base las vuelve a leer.
 */
function ajusteDeReferencias(hoy: Date): object {
  const vigenteDesde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const organizadores = porClave(
    [
      { nombre: 'Organización Del Sur', companias: 'SANCOR, ZURICH, SAN CRISTOBAL', telefono: '11-4222-0000', email: 'cotizaciones@ejemplo.com.ar', horario: 'Lunes a viernes de 9 a 18', observaciones: 'Contesta rápido por WhatsApp', orden: 1, activo: 1 },
      { nombre: 'Broker Riachuelo', companias: 'RIVADAVIA, FEDERACION PATRONAL, MERCANTIL ANDINA', telefono: '11-4209-0000', email: 'riachuelo@ejemplo.com.ar', horario: 'Lunes a viernes de 10 a 17', observaciones: null, orden: 2, activo: 1 },
      { nombre: 'Productores Asociados Avellaneda', companias: 'ATM, EQUIDAD, RIO URUGUAY', telefono: '11-4203-0000', email: 'pasav@ejemplo.com.ar', horario: 'Lunes a sábado de 9 a 13', observaciones: 'Para motos, el mejor precio', orden: 3, activo: 1 },
      { nombre: 'Gestoría Wilde', companias: 'AGROSALTA, METROPOL', telefono: '11-4206-0000', email: null, horario: 'Mañanas', observaciones: 'Sólo renovaciones manuales', orden: 4, activo: 1 },
    ],
    (fila) => claveDeReferencia(fila.nombre),
  )
  // El RC de lista de cada compañía para auto y para moto, que es el piso con el que se compara todo.
  const RC_AUTO: Record<string, number> = { SANCOR: 38_900, ATM: 31_500, RIVADAVIA: 34_200, 'SAN CRISTOBAL': 37_600, 'FEDERACION PATRONAL': 36_800, 'MERCANTIL ANDINA': 35_900, GALENO: 33_700, ZURICH: 42_300, EQUIDAD: 30_900, 'RIO URUGUAY': 32_400, AGROSALTA: 29_800, METROPOL: 31_100 }
  const RC_MOTO: Record<string, number> = { ATM: 14_900, RIVADAVIA: 16_200, 'RIO URUGUAY': 15_300, EQUIDAD: 14_400, 'SAN CRISTOBAL': 17_800, GALENO: 16_600, METROPOL: 15_100, AGROSALTA: 13_900 }
  const precios = porClave(
    [
      ...Object.entries(RC_AUTO).map(([compania, precio]) => ({ compania, cobertura: 'RC', rama: 'AUTO', precio, vigente_desde: vigenteDesde, observaciones: null })),
      ...Object.entries(RC_MOTO).map(([compania, precio]) => ({ compania, cobertura: 'RC', rama: 'MOTO', precio, vigente_desde: vigenteDesde, observaciones: compania === 'ATM' ? 'Hasta 150 cc' : null })),
    ],
    (fila) => claveDeReferencia(fila.compania, fila.cobertura, fila.rama),
  )
  // Kilómetros de grúa: null es ILIMITADA, que es un valor real y frecuente.
  const KM: Record<string, [number | null, number | null]> = { SANCOR: [300, null], ATM: [100, 300], RIVADAVIA: [200, 500], 'SAN CRISTOBAL': [300, null], 'FEDERACION PATRONAL': [250, null], 'MERCANTIL ANDINA': [200, 400], GALENO: [150, 300], ZURICH: [500, null], EQUIDAD: [100, 200], 'RIO URUGUAY': [100, 250], AGROSALTA: [80, 150], METROPOL: [100, 200] }
  const gruas = porClave(
    Object.entries(KM).flatMap(([compania, [terceros, todoRiesgo]]) => [
      { compania, cobertura: 'TERCEROS COMPLETO', kilometros: terceros, auxilio: 'Auxilio mecánico 24 h', observaciones: null },
      { compania, cobertura: 'TODO RIESGO C/FRANQUICIA', kilometros: todoRiesgo, auxilio: 'Auxilio mecánico 24 h y cerrajería', observaciones: todoRiesgo === null ? 'Sin límite de kilómetros' : null },
    ]),
    (fila) => claveDeReferencia(fila.compania, fila.cobertura),
  )
  // Qué ampara cada cobertura. `compania` en null vale para todas; cargar la compañía es para la excepción.
  const clausulas = porClave(
    [
      { compania: null, cobertura: 'RC', clausula: 'Responsabilidad civil hacia terceros', ampara: 1, detalle: 'Daños a personas y cosas de terceros', opciones: null, orden: 1 },
      { compania: null, cobertura: 'RC', clausula: 'Daños al propio vehículo', ampara: 0, detalle: 'No cubre ningún daño propio', opciones: null, orden: 2 },
      { compania: null, cobertura: 'TERCEROS COMPLETO', clausula: 'Robo e incendio total', ampara: 1, detalle: null, opciones: null, orden: 1 },
      { compania: null, cobertura: 'TERCEROS COMPLETO', clausula: 'Robo e incendio parcial', ampara: 1, detalle: null, opciones: null, orden: 2 },
      { compania: null, cobertura: 'TERCEROS COMPLETO', clausula: 'Granizo', ampara: 0, detalle: 'Sólo en el Premium', opciones: null, orden: 3 },
      { compania: null, cobertura: 'TERCEROS COMPLETO PREMIUM', clausula: 'Granizo', ampara: 1, detalle: 'Hasta el 20 % de la suma asegurada', opciones: null, orden: 1 },
      { compania: null, cobertura: 'TERCEROS COMPLETO PREMIUM', clausula: 'Cristales y cerraduras', ampara: 1, detalle: null, opciones: null, orden: 2 },
      { compania: null, cobertura: 'TODO RIESGO C/FRANQUICIA', clausula: 'Daños propios por accidente', ampara: 1, detalle: 'Con la franquicia de la póliza', opciones: null, orden: 1 },
      { compania: 'ZURICH', cobertura: 'TODO RIESGO C/FRANQUICIA', clausula: 'Auto sustituto', ampara: 1, detalle: 'Hasta 10 días por siniestro', opciones: null, orden: 2 },
    ],
    (fila) => claveDeReferencia(fila.compania, fila.cobertura, fila.clausula),
  )
  return { version: 1, organizadores, precios, gruas, clausulas }
}

/** La versión de este programa (la de la demo), o una de muestra afuera de Electron (el banco de pruebas). */
function versionDelPrograma(): string {
  return (app as typeof app | undefined)?.getVersion?.() ?? '0.0.0-demo'
}

/** La versión anterior a la del programa, para la sucursal que dejó la actualización «para después». */
function versionAnterior(version: string): string {
  const [base = '0.0.0'] = version.split('-')
  const [mayor = 0, menor = 0, parche = 0] = base.split('.').map((parte) => Number.parseInt(parte, 10) || 0)
  if (parche > 0) return `${mayor}.${menor}.${parche - 1}`
  if (menor > 0) return `${mayor}.${menor - 1}.0`
  return `${Math.max(0, mayor - 1)}.0.0`
}

/**
 * Qué versión tiene cada sucursal (`estadoDeActualizaciones.ts`), para que la columna «Versión del
 * programa» de Usuarios no diga «Sin datos todavía». Tres al día y la de Daniel una atrás, con la
 * actualización dejada para después: es lo que esa columna está para mostrar.
 */
function ajusteDeActualizaciones(hoy: Date): object {
  const version = versionDelPrograma()
  const hace = (minutos: number) => new Date(hoy.getTime() - minutos * 60_000).toISOString()
  const sucursales = SUCURSALES.map((sucursal) =>
    sucursal === 'Daniel'
      ? { sucursal, version: versionAnterior(version), reportadoEn: hace(95), rechazoVersion: version, rechazadoEn: hace(26 * 60) }
      : { sucursal, version, reportadoEn: hace(sucursal === 'Dock Sud' ? 5 : sucursal === 'Lanús' ? 40 : 12), rechazoVersion: null, rechazadoEn: null },
  ).sort((a, b) => a.sucursal.localeCompare(b.sucursal))
  return { sucursales }
}

/**
 * «Lo que leyó el servidor» en Administración → Catálogo de vehículos: dos lecturas de las APIs de las
 * aseguradoras ya hechas (la de anoche y la de la noche anterior) y la que corre al tocar «Leer las APIs
 * ahora». Sin `alLeerLasApis` el simulador terminaba la lectura sin devolver nada y el botón giraba un
 * momento y no decía ni que sí ni que no.
 */
function sembrarLecturasDeLasApis(simulador: VpsSimulado, vehiculos: Array<Record<string, unknown>>, hoy: Date): void {
  const motos = vehiculos.filter((vehiculo) => vehiculo.tipo === 'MOTO').length
  const autos = vehiculos.length - motos
  let numero = 0
  const lectura = (cuando: Date, minutos: number, estado: 'PUBLICADA' | 'SIN_CAMBIOS', altas: number, cambios: number) => {
    const galeno = vehiculos.length
    const atm = Math.round(autos * 0.85) + motos
    const mercantil = Math.round(autos * 0.7)
    const leidas = galeno + atm + mercantil
    // Las versiones que traen dos o tres compañías cuentan una sola vez en el catálogo; las que no
    // traen años no entran.
    const sinAnios = 9
    return {
      id: `demo-lectura-${++numero}`,
      fuente: 'ASEGURADORAS',
      edicion: `${cuando.getFullYear()}-${String(cuando.getMonth() + 1).padStart(2, '0')}-${String(cuando.getDate()).padStart(2, '0')}`,
      estado,
      leidas,
      aceptadas: vehiculos.length,
      descartadas: sinAnios,
      altas,
      cambios,
      bajas: 0,
      mensaje: null,
      iniciadaEn: cuando.toISOString(),
      terminadaEn: new Date(cuando.getTime() + minutos * 60_000).toISOString(),
      detalle: {
        autos,
        motos,
        descartesPorMotivo: { 'sin-anios': sinAnios },
        fuentes: [
          { id: 'GALENO', nombre: 'Galeno', estado: 'LEIDA', versiones: galeno, autos, motos, pedidos: 420, fallidos: 0, mensaje: null },
          { id: 'ATM', nombre: 'ATM Seguros', estado: 'LEIDA', versiones: atm, autos: atm - motos, motos, pedidos: 310, fallidos: 0, mensaje: null },
          { id: 'MERCANTIL', nombre: 'Mercantil Andina', estado: 'LEIDA', versiones: mercantil, autos: mercantil, motos: 0, pedidos: 260, fallidos: 0, mensaje: null },
        ],
      },
    }
  }
  const aLas = (diasAtras: number, hora: number, minuto: number) => {
    const fecha = new Date(hoy)
    fecha.setDate(fecha.getDate() - diasAtras)
    fecha.setHours(hora, minuto, 0, 0)
    return fecha
  }
  // Del más nuevo al más viejo, como las devuelve el servidor.
  ;(simulador as VpsSimulado & { importacionesDeVehiculos?: unknown[] }).importacionesDeVehiculos = [
    lectura(aLas(0, 4, 10), 7, 'PUBLICADA', 6, 14),
    lectura(aLas(1, 4, 10), 6, 'SIN_CAMBIOS', 0, 0),
  ]
  // La de ahora: el catálogo ya es el de anoche, así que vuelve «sin cambios», que es lo que contestaría
  // el servidor de verdad leyendo dos veces el mismo día. Termina en el momento en que se la pide.
  simulador.alLeerLasApis = () => lectura(new Date(Date.now() - 10_000), 10 / 60, 'SIN_CAMBIOS', 0, 0)
}

interface MensajeDeEjemplo {
  de: string
  texto: string
  /** Minutos antes de ahora. */
  hace: number
}

interface ConversacionDeEjemplo {
  id: string
  /** Null = conversación directa entre los dos participantes. */
  titulo: string | null
  participantes: string[]
  mensajes: MensajeDeEjemplo[]
}

const CONVERSACIONES: ConversacionDeEjemplo[] = [
  {
    id: 'demo-grupo-mostradores',
    titulo: 'Mostradores',
    participantes: ['demo', 'admin', 'lucia', 'jorge', 'sofia', 'daniel'],
    mensajes: [
      { de: 'demo', texto: 'Buen día a todos. Hoy cierra la cobranza del mes: revisen la lista de deudores antes de las 18.', hace: 300 },
      { de: 'sofia', texto: 'En Lanús quedan 6 sin pagar, ya les mandé WhatsApp a todos.', hace: 285 },
      { de: 'lucia', texto: 'Sarandí al día salvo dos débitos rechazados: ya los cargué en Rechazos, así les salta el aviso.', hace: 270 },
      { de: 'jorge', texto: '¿Alguien tiene la lista de precios nueva de ATM? El multicotizador ya la trae, ¿no?', hace: 120 },
      { de: 'admin', texto: 'Sí, cotiza directo contra la API. No hace falta la planilla.', hace: 115 },
      { de: 'daniel', texto: 'Mañana paso por Dock Sud a buscar las pólizas impresas.', hace: 25 },
    ],
  },
  {
    id: 'demo-directa-demo-lucia',
    titulo: null,
    participantes: ['demo', 'lucia'],
    mensajes: [
      { de: 'lucia', texto: 'Martina, entró un siniestro de una Hilux en Sarandí. Ya lo cargué con las fotos.', hace: 95 },
      { de: 'demo', texto: 'Perfecto, asignámelo como tarea así lo sigo con la compañía.', hace: 90 },
      { de: 'lucia', texto: 'Listo, te quedó en Tareas con vencimiento el viernes.', hace: 12 },
    ],
  },
  {
    id: 'demo-directa-admin-sofia',
    titulo: null,
    participantes: ['admin', 'sofia'],
    mensajes: [
      { de: 'admin', texto: 'Sofi, ¿pudiste hacer el arqueo de caja de ayer?', hace: 1500 },
      { de: 'sofia', texto: 'Sí, cerró justo. Lo dejé cargado en Caja.', hace: 1490 },
    ],
  },
  {
    id: 'demo-directa-demo-admin',
    titulo: null,
    participantes: ['demo', 'admin'],
    mensajes: [
      { de: 'admin', texto: 'Las renovaciones de la semana que viene ya están en la bandeja, hay dos con aumento a avisar.', hace: 40 },
    ],
  },
  {
    // Para que Daniel también entre con algo sin leer (ver `sembrarConversaciones`).
    id: 'demo-directa-daniel-jorge',
    titulo: null,
    participantes: ['daniel', 'jorge'],
    mensajes: [
      { de: 'daniel', texto: 'Jorge, ¿me separás las pólizas impresas de mis clientes de Quilmes?', hace: 70 },
      { de: 'jorge', texto: 'Sí, te las dejo en un sobre en el mostrador de Dock Sud.', hace: 20 },
    ],
  },
]

/**
 * Unas conversaciones del chat interno, entre los usuarios de la demo. Pasan por el mismo manejador
 * que un mensaje de verdad (así tienen la forma exacta que espera el programa) y después se les corre
 * la fecha hacia atrás.
 *
 * Lo viejo queda entregado y leído. Lo ÚLTIMO de cada conversación queda sin entregar y sin leer para
 * TODOS sus destinatarios, no sólo para Martina: quien prueba la demo cambia de usuario para ver los
 * roles, y Carlos, Lucía o Daniel tienen que entrar con el contador de la campana y del chat encendido
 * igual que ella. (Cómo le llega al resto el historial, en `entregarLoUltimoAlEntrar`.)
 */
function sembrarConversaciones(simulador: VpsSimulado, atenderMensajes: VpsSimulado['atenderMensajes'], hoy: Date): void {
  const sinRespuesta = () => undefined
  const busqueda = new URLSearchParams()
  const haceMinutos = (minutos: number) => new Date(hoy.getTime() - minutos * 60_000).toISOString()
  let numero = 0

  for (const conversacion of CONVERSACIONES) {
    const [creador, ...otros] = conversacion.participantes
    if (!creador) continue
    if (conversacion.titulo) {
      atenderMensajes(
        'POST',
        '/api/dmg/mensajes/conversaciones/grupo',
        { actor: actorDe(creador), id: conversacion.id, titulo: conversacion.titulo, participantes: otros.map((clave) => ({ clave, nombre: nombreDe(clave) })) },
        sinRespuesta,
        busqueda,
      )
    } else {
      const otro = otros[0] ?? ''
      atenderMensajes(
        'POST',
        '/api/dmg/mensajes/conversaciones/directa',
        { actor: actorDe(creador), id: conversacion.id, clave: otro, nombre: nombreDe(otro) },
        sinRespuesta,
        busqueda,
      )
    }
    const ficha = simulador.conversaciones.get(conversacion.id)
    if (ficha) ficha.creadoEn = haceMinutos(Math.max(...conversacion.mensajes.map((m) => m.hace)) + 5)

    conversacion.mensajes.forEach((mensaje, indice) => {
      const id = `demo-mensaje-${++numero}`
      atenderMensajes('POST', '/api/dmg/mensajes', { actor: actorDe(mensaje.de), id, conversacionId: conversacion.id, cuerpo: mensaje.texto }, sinRespuesta, busqueda)
      const guardado = simulador.mensajes.find((m) => m.id === id)
      if (!guardado) return
      guardado.creadoEn = haceMinutos(mensaje.hace)
      guardado.enviadoEn = guardado.creadoEn
      if (ficha) ficha.ultimoMensajeEn = guardado.creadoEn
      // Lo último queda pendiente para todos: es la cola de reparto tal como la deja un mensaje recién
      // mandado, y lo que hace que cada uno lo reciba como novedad (con su aviso) al entrar.
      if (indice === conversacion.mensajes.length - 1) return
      for (const [clave, acuse] of simulador.acuses) {
        if (!clave.startsWith(`${id}|`)) continue
        acuse.entregadoEn = haceMinutos(mensaje.hace - 1)
        acuse.leidoEn = haceMinutos(Math.max(0, mensaje.hace - 2))
      }
    })
  }
}

function nombreDe(clave: string): string {
  return USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)?.nombre ?? clave
}

/** Quién manda un pedido de mensajería: la misma forma que arma `puente.ts` (clave, nombre y rol). */
function actorDe(clave: string): { clave: string; nombre: string; rol: string } {
  const usuario = USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)
  return { clave, nombre: nombreDe(clave), rol: usuario?.rol ?? 'EMPLEADO' }
}

/**
 * El historial que el reparto no trae, la PRIMERA vez que cada persona pide novedades.
 *
 * El reparto (`GET /mensajes/novedades`) entrega sólo lo que está pendiente para esa persona: lo ya
 * leído y lo que escribió ella misma no bajan nunca, y la app lo trae recién al abrir la conversación
 * (`traerHistorial` en servicios/mensajeria.ts). En la agencia eso no se nota, porque cada computadora
 * fue juntando su historial desde el primer día. En la demo la carpeta local arranca vacía y quien entra
 * como Carlos, Lucía o Daniel veía la lista de conversaciones con «Sin mensajes» aunque tuvieran charla.
 *
 * Por eso, sólo acá, la primera respuesta de novedades de cada persona lleva además el ÚLTIMO mensaje de
 * cada una de sus conversaciones, con sus acuses tal como están (lo leído llega leído y no enciende
 * nada). Con ése la lista ya tiene vista previa; el resto baja al abrirla, como siempre. Va el último y
 * no el historial entero para que el aviso de «te escribieron» no cuente como nuevo lo que no lo es.
 *
 * Se hace afuera del simulador, envolviendo su manejador, porque es una necesidad de la demo y no del
 * contrato que el simulador reproduce para las pruebas.
 */
function entregarLoUltimoAlEntrar(simulador: VpsSimulado, atenderMensajes: VpsSimulado['atenderMensajes']): void {
  const yaEntraron = new Set<string>()
  simulador.atenderMensajes = (metodo, ruta, json, responder, busqueda) => {
    const clave = (busqueda.get('actorClave') ?? '').trim().toLowerCase()
    if (metodo !== 'GET' || ruta !== '/api/dmg/mensajes/novedades' || !clave || yaEntraron.has(clave)) {
      return atenderMensajes(metodo, ruta, json, responder, busqueda)
    }
    yaEntraron.add(clave)
    return atenderMensajes(
      metodo,
      ruta,
      json,
      (estado, datos) => {
        const novedades = datos as { mensajes?: Array<{ id: string }> } | null
        if (estado === 200 && Array.isArray(novedades?.mensajes)) {
          const lista = novedades.mensajes
          const yaVan = new Set(lista.map((mensaje) => mensaje.id))
          for (const conversacion of simulador.conversaciones.values()) {
            if (!conversacion.participantes.some((p) => p.clave === clave && !p.salioEn)) continue
            const consulta = new URLSearchParams(busqueda)
            consulta.set('conversacion', conversacion.id)
            atenderMensajes(
              'GET',
              '/api/dmg/mensajes/historial',
              null,
              (estadoDelHistorial, historial) => {
                const ultimo = (historial as { mensajes?: Array<{ id: string }> } | null)?.mensajes?.at(-1)
                if (estadoDelHistorial !== 200 || !ultimo || yaVan.has(ultimo.id)) return
                yaVan.add(ultimo.id)
                lista.push(ultimo)
              },
              consulta,
            )
          }
        }
        responder(estado, datos)
      },
      busqueda,
    )
  }
}

// ---------------------------------------------------------------------------
// Los compañeros que siempre tienen el programa abierto
// ---------------------------------------------------------------------------
//
// En la demo hay una sola computadora: sin esto, el único conectado al canal en vivo era quien la estaba
// probando, y el chat, la presencia y las llamadas —que la pantalla Servidor (VPS) promociona— no se
// podían mostrar: el teléfono gris («no tiene el programa abierto»), nadie en línea en «Escribirle a
// alguien» y los mensajes en «leído por 0» para siempre.
//
// Lucía y Jorge se conectan de verdad: un WebSocket desde este proceso contra el canal del simulador, con
// el mismo saludo que manda la app (`vivo/canal.ts`). No se tocan las tripas del simulador para fingir
// presencia: si mañana cambia el protocolo, esto se rompe igual que se rompería la app, y se ve.
//
// Lo que hacen, y nada más: acusan recibo y lectura de lo que les escriben, contestan una frase corta en
// las conversaciones de a dos, y a una llamada la rechazan a los pocos segundos y dejan un mensaje (el
// audio va por WebRTC entre dos computadoras, y acá no hay otra). La mensajería la atienden llamando al
// manejador del simulador en el mismo proceso: es lo mismo que pedirlo por HTTP, sin el viaje.
//
// Si quien prueba la demo entra COMO Lucía o como Jorge, ese compañero se desconecta para no aparecer
// dos veces ni contestarle los mensajes a la persona real, y vuelve cuando ésta cierra sesión.

/** Lo que estos compañeros usan de un WebSocket: el global de Node 22 / Electron (ver `vivo/canal.ts`). */
interface SocketDelCompanero {
  readyState: number
  send(datos: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((evento: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

/** Quiénes, y qué contestan. Lucía es la del chat de ejemplo con Martina; Jorge, el otro mostrador de Dock Sud. */
const COMPANEROS: Array<{ clave: string; respuestas: string[]; ocupado: string }> = [
  {
    clave: 'lucia',
    respuestas: ['¡Dale! Ahora lo miro.', 'Perfecto, ya lo anoto.', 'Sí, en un rato te confirmo.', 'Listo, quedó cargado 👍'],
    ocupado: 'Perdón, estoy atendiendo a un cliente en el mostrador. ¿Me escribís por acá?',
  },
  {
    clave: 'jorge',
    respuestas: ['Dale, lo veo y te aviso.', 'Ok, ya me fijo.', 'Recibido, gracias.', 'Ahí lo reviso 👍'],
    ocupado: 'Ahora no puedo atender, tengo gente en el mostrador. Escribime y te contesto.',
  },
]

/** Cuánto tardan en leer y en contestar: lo que tarda una persona en mirar la pantalla. */
const LEEN_A_LOS_MS = 2_500
const CONTESTAN_A_LOS_MS = 7_000
const RECHAZAN_A_LOS_MS = 5_000
/** Una respuesta por conversación cada tanto, así una charla con ellos no se vuelve un ping-pong. */
const UNA_RESPUESTA_CADA_MS = 60_000
/** Cada cuánto se mira si quien prueba la demo entró como uno de ellos (o si ya salió). */
const REVISAR_CADA_MS = 3_000

class CompanerosVirtuales {
  private readonly lista: CompaneroVirtual[]
  private reloj: ReturnType<typeof setInterval> | null = null
  private activos = false

  constructor(
    private readonly simulador: VpsSimulado,
    atenderMensajes: VpsSimulado['atenderMensajes'],
  ) {
    const arrancaronEn = Date.now()
    this.lista = COMPANEROS.flatMap((companero) => {
      const usuario = USUARIOS_DE_LA_DEMO.find((u) => u.usuario === companero.clave)
      return usuario ? [new CompaneroVirtual(simulador, atenderMensajes, usuario, companero.respuestas, companero.ocupado, arrancaronEn, () => this.revisar())] : []
    })
  }

  arrancar(): void {
    this.activos = true
    this.revisar()
    this.reloj = setInterval(() => this.revisar(), REVISAR_CADA_MS)
    this.reloj.unref?.()
  }

  parar(): void {
    this.activos = false
    if (this.reloj) clearInterval(this.reloj)
    this.reloj = null
    for (const companero of this.lista) companero.desconectar()
  }

  /** Conecta a los que no tienen a nadie de carne y hueso usando su usuario, y desconecta a los que sí. */
  revisar(): void {
    if (!this.activos) return
    for (const companero of this.lista) {
      // A mitad del saludo (mandó el «hola» y todavía no le llegó la «bienvenida») su conexión ya figura
      // en el servidor pero él no sabe su id: se la tomaría por una persona y se desconectaría solo.
      if (companero.conectado && companero.conexionId === null) continue
      const hayUnaPersona = [...this.simulador.conexiones.values()].some(
        (conexion) => conexion.actor.clave === companero.usuario.usuario && conexion.id !== companero.conexionId,
      )
      if (hayUnaPersona) companero.desconectar()
      else companero.conectar()
    }
  }
}

class CompaneroVirtual {
  private socket: SocketDelCompanero | null = null
  private latido: ReturnType<typeof setInterval> | null = null
  private readonly relojes = new Set<ReturnType<typeof setTimeout>>()
  private readonly ultimaRespuesta = new Map<string, number>()
  private vueltas = 0
  conexionId: string | null = null

  constructor(
    private readonly simulador: VpsSimulado,
    private readonly atenderMensajes: VpsSimulado['atenderMensajes'],
    readonly usuario: UsuarioDeLaDemo,
    private readonly respuestas: string[],
    private readonly ocupado: string,
    /** Lo sembrado antes de esto es historia: no lo leen, así le queda sin leer a quien entre como ellos. */
    private readonly arrancaronEn: number,
    private readonly alCambiarLaPresencia: () => void,
  ) {}

  get conectado(): boolean {
    return this.socket !== null
  }

  private get actor(): { clave: string; nombre: string; rol: string } {
    return { clave: this.usuario.usuario, nombre: this.usuario.nombre, rol: this.usuario.rol }
  }

  conectar(): void {
    if (this.socket || !this.simulador.url) return
    const Constructor = (globalThis as { WebSocket?: new (url: string) => SocketDelCompanero }).WebSocket
    if (!Constructor) return
    let socket: SocketDelCompanero
    try {
      socket = new Constructor(`${this.simulador.url.replace(/^http/, 'ws')}/api/dmg/vivo`)
    } catch (error) {
      console.error(`[demo] ${this.usuario.nombre} no se pudo conectar al canal en vivo:`, error instanceof Error ? error.message : error)
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.enviar({
        t: 'hola',
        token: this.simulador.token,
        actor: { ...this.actor, sucursal: this.usuario.sucursal },
        app: versionDelPrograma(),
        versiones: {},
        generacion: null,
      })
    }
    socket.onmessage = (evento) => this.recibir(evento.data)
    // El `error` siempre viene con un `close` atrás, y es el `close` el que limpia.
    socket.onerror = () => undefined
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.conexionId = null
      this.pararElLatido()
    }
    // El servidor de verdad corta una conexión muda; el simulador no, pero se manda igual que la app.
    this.latido = setInterval(() => this.enviar({ t: 'latido' }), 20_000)
    this.latido.unref?.()
  }

  desconectar(): void {
    const socket = this.socket
    this.socket = null
    this.conexionId = null
    this.pararElLatido()
    for (const reloj of this.relojes) clearTimeout(reloj)
    this.relojes.clear()
    try {
      socket?.close()
    } catch {
      // Ya estaba cerrado.
    }
  }

  private pararElLatido(): void {
    if (this.latido) clearInterval(this.latido)
    this.latido = null
  }

  private enviar(frame: object): void {
    try {
      if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(frame))
    } catch {
      // Se cerró en el medio: lo dice el `close`.
    }
  }

  private despues(ms: number, accion: () => void): void {
    const reloj = setTimeout(() => {
      this.relojes.delete(reloj)
      if (this.socket) accion()
    }, ms)
    reloj.unref?.()
    this.relojes.add(reloj)
  }

  private recibir(crudo: unknown): void {
    let frame: { t?: string; conexionId?: string; evento?: { tipo?: string; llamadaId?: string; conversacionId?: string } } | null = null
    try {
      frame = JSON.parse(String(crudo))
    } catch {
      return
    }
    if (!frame?.t) return
    if (frame.t === 'bienvenida') {
      this.conexionId = frame.conexionId ?? null
      // Pudo haberle llegado algo mientras no estaba (quien probaba la demo era él).
      this.leer()
    } else if (frame.t === 'presencia') {
      this.alCambiarLaPresencia()
    } else if (frame.t === 'mensajes') {
      this.leer()
    } else if (frame.t === 'llamada' && frame.evento?.tipo === 'timbrar') {
      const { llamadaId, conversacionId } = frame.evento
      this.despues(RECHAZAN_A_LOS_MS, () => {
        this.enviar({ t: 'llamada', evento: { tipo: 'rechazar', llamadaId, motivo: 'rechazada' } })
        if (conversacionId) this.despues(2_000, () => this.escribir(conversacionId, this.ocupado))
      })
    }
  }

  /** Lo que le escribieron desde que arrancó la demo: acusa recibo ya, lectura en un ratito y contesta. */
  private leer(): void {
    let pendientes: Array<{ id: string; conversacionId: string; autorClave: string; tipo?: string; creadoEn: string }> = []
    this.atenderMensajes(
      'GET',
      '/api/dmg/mensajes/novedades',
      { actor: this.actor },
      (estado, datos) => {
        if (estado === 200) pendientes = (datos as { mensajes?: typeof pendientes }).mensajes ?? []
      },
      new URLSearchParams(),
    )
    const nuevos = pendientes.filter((mensaje) => new Date(mensaje.creadoEn).getTime() >= this.arrancaronEn - 1_000)
    if (!nuevos.length) return
    const ids = nuevos.map((mensaje) => mensaje.id)
    this.acusar('entregados', ids)
    this.despues(LEEN_A_LOS_MS, () => this.acusar('leidos', ids))

    const deAlguien = nuevos.filter((mensaje) => mensaje.tipo !== 'LLAMADA' && !COMPANEROS.some((c) => c.clave === mensaje.autorClave))
    for (const conversacionId of new Set(deAlguien.map((mensaje) => mensaje.conversacionId))) {
      const conversacion = this.simulador.conversaciones.get(conversacionId)
      // En los grupos leen y nada más: dos compañeros virtuales contestando a coro sería ruido.
      if (conversacion?.tipo !== 'DIRECTA') continue
      const antes = this.ultimaRespuesta.get(conversacionId) ?? 0
      if (Date.now() - antes < UNA_RESPUESTA_CADA_MS) continue
      this.ultimaRespuesta.set(conversacionId, Date.now())
      const fueUnZumbido = deAlguien.some((mensaje) => mensaje.conversacionId === conversacionId && mensaje.tipo === 'ZUMBIDO')
      const texto = fueUnZumbido ? '¡Acá estoy! ¿Qué pasó?' : (this.respuestas[this.vueltas++ % this.respuestas.length] ?? 'Dale.')
      this.despues(CONTESTAN_A_LOS_MS, () => this.escribir(conversacionId, texto))
    }
  }

  private acusar(cual: 'entregados' | 'leidos', ids: string[]): void {
    this.atenderMensajes('POST', `/api/dmg/mensajes/${cual}`, { actor: this.actor, ids }, () => undefined, new URLSearchParams())
  }

  private escribir(conversacionId: string, cuerpo: string): void {
    const id = `demo-${this.usuario.usuario}-${Date.now().toString(36)}-${this.vueltas++}`
    this.atenderMensajes(
      'POST',
      '/api/dmg/mensajes',
      { actor: this.actor, id, conversacionId, cuerpo, enviadoEn: new Date().toISOString() },
      () => undefined,
      new URLSearchParams(),
    )
  }
}
