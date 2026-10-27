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
import { hashSync } from 'bcryptjs'
import { VpsSimulado } from '../../../scripts/vps-simulado.mjs'
import { CLAVE_DE_LA_DEMO, TOKEN_DE_LA_DEMO, USUARIOS_DE_LA_DEMO, type EstadoDeLaDemo } from '../../shared/demo'
import { permisosPorDefecto } from '../../shared/permisos'
import { escribirDocumento, FORMATO_ACTUAL, type DocumentoUsuarios } from '../usuarios/documento'
import { armarDatosDeLaDemo } from './datos'

let servidor: VpsSimulado | null = null
let armadaEn = ''

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
  sembrarConversaciones(nuevo, hoy)
  // Un respaldo del día, para que «Respaldos del servidor» no abra vacía.
  nuevo.guardarRespaldo('DIARIO', null)
  await nuevo.escuchar(0)
  servidor = nuevo
  armadaEn = hoy.toISOString()
  console.log(`[demo] Servidor de demostración en ${nuevo.url} (${datos.pestanas.length} pestañas).`)
}

export async function pararServidorDeLaDemo(): Promise<void> {
  const actual = servidor
  servidor = null
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
 * Las cuentas de las APIs de las compañías, como las dejaría cargadas el superadministrador. Son de
 * mentira: en la demo ningún adaptador sale a internet (ver `demo/aseguradoras.ts`), pero con esto las
 * pantallas de «API aseguradoras» se ven configuradas, que es como las va a ver la agencia.
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
  }
  for (const [clave, valor] of Object.entries(valores)) {
    simulador.ajustes.set(clave, {
      clave,
      valor,
      huella: `demo-${clave}`,
      actualizadoEn: hoy.toISOString(),
      actualizadoPor: 'Martina Demo',
    })
  }
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
      { de: 'lucia', texto: 'Sarandí al día salvo dos débitos rechazados, los cargo como rechazo así le llega el aviso a Dock Sud.', hace: 270 },
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
]

/**
 * Unas conversaciones del chat interno, entre los usuarios de la demo. Pasan por el mismo manejador
 * que un mensaje de verdad (así tienen la forma exacta que espera el programa) y después se les corre
 * la fecha hacia atrás. Lo viejo queda leído; lo último que le escribieron a Martina queda sin leer,
 * para que se vea el contador de la campana y del chat al ingresar.
 */
function sembrarConversaciones(simulador: VpsSimulado, hoy: Date): void {
  const nombreDe = (clave: string) => USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)?.nombre ?? clave
  const actor = (clave: string) => {
    const usuario = USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)
    return { clave, nombre: nombreDe(clave), rol: usuario?.rol ?? 'EMPLEADO' }
  }
  const sinRespuesta = () => undefined
  const busqueda = new URLSearchParams()
  const haceMinutos = (minutos: number) => new Date(hoy.getTime() - minutos * 60_000).toISOString()
  let numero = 0

  for (const conversacion of CONVERSACIONES) {
    const [creador, ...otros] = conversacion.participantes
    if (!creador) continue
    if (conversacion.titulo) {
      simulador.atenderMensajes(
        'POST',
        '/api/dmg/mensajes/conversaciones/grupo',
        { actor: actor(creador), id: conversacion.id, titulo: conversacion.titulo, participantes: otros.map((clave) => ({ clave, nombre: nombreDe(clave) })) },
        sinRespuesta,
        busqueda,
      )
    } else {
      const otro = otros[0] ?? ''
      simulador.atenderMensajes(
        'POST',
        '/api/dmg/mensajes/conversaciones/directa',
        { actor: actor(creador), id: conversacion.id, clave: otro, nombre: nombreDe(otro) },
        sinRespuesta,
        busqueda,
      )
    }
    const ficha = simulador.conversaciones.get(conversacion.id)
    if (ficha) ficha.creadoEn = haceMinutos(Math.max(...conversacion.mensajes.map((m) => m.hace)) + 5)

    conversacion.mensajes.forEach((mensaje, indice) => {
      const id = `demo-mensaje-${++numero}`
      simulador.atenderMensajes('POST', '/api/dmg/mensajes', { actor: actor(mensaje.de), id, conversacionId: conversacion.id, cuerpo: mensaje.texto }, sinRespuesta, busqueda)
      const guardado = simulador.mensajes.find((m) => m.id === id)
      if (!guardado) return
      guardado.creadoEn = haceMinutos(mensaje.hace)
      guardado.enviadoEn = guardado.creadoEn
      if (ficha) ficha.ultimoMensajeEn = guardado.creadoEn
      const esElUltimo = indice === conversacion.mensajes.length - 1
      for (const [clave, acuse] of simulador.acuses) {
        if (!clave.startsWith(`${id}|`)) continue
        const destinatario = clave.slice(id.length + 1)
        // Lo último que le llegó a Martina (el usuario con el que se entra por defecto) queda sin leer.
        if (esElUltimo && destinatario === 'demo') continue
        acuse.entregadoEn = haceMinutos(mensaje.hace - 1)
        acuse.leidoEn = haceMinutos(Math.max(0, mensaje.hace - 2))
      }
    })
  }
}
