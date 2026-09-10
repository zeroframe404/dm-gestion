// El canal en vivo (14.0) de punta a punta: dos computadoras, un WebSocket cada una contra el mismo
// servidor, y lo que escribe una tiene que aparecer sola en la otra.
//
// Qué se prueba acá y no en `sincronizacion-en-vivo.prueba.ts`: ahí el socket no está —se le pasa la
// foto a `vivo/grilla.ts` a mano, para poder afirmar con precisión qué se baja y qué no—. Acá está
// todo el camino: el saludo con el token, la bienvenida, el aviso que difunde el servidor cuando
// alguien escribe, la caída del canal en el medio y la reconciliación al volver. Es la prueba que
// falla si un día se rompe el protocolo, la que no puede detectar ninguna de las otras.
//
// LAS DOS COMPUTADORAS COMPARTEN EL PROCESO, y eso obliga a dos cuidados que no existen en el
// programa de verdad:
//
//   - La base «actual» es una sola (`usarBaseDeDatos`). Por eso lo que llega por el canal lo aplica
//     UNA sola de las dos —Beto— y la de Ana no se toca en toda la prueba: así el `en(beto.db)` vale
//     de punta a punta y ningún `await` se encuentra con la base cambiada abajo.
//   - `vivo/grilla.ts` también tiene estado de módulo (los pendientes, la última foto). Con una sola
//     computadora aplicando, ese estado es el de Beto y de nadie más.
//   - El mapa de versiones conocidas (`sincronizacion/versiones.ts`) TAMBIÉN es de módulo, y es el
//     de Beto. Por eso lo que escribe Ana se hace tocando la base del simulador y no mandándole el
//     pedido con `ana.fuente`: una escritura por HTTP desde este proceso pasaría por
//     `adoptarVersionesPropias`, y Beto se quedaría creyendo que la versión que acaba de nacer ya la
//     conocía. Desde el lado de Beto da exactamente lo mismo: lo que ve es la base con una versión
//     nueva, la haya escrito quien la haya escrito.
import assert from 'node:assert/strict'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { PuenteDeMensajes } from '../src/main/mensajeria/puente'
import { planillaDelMes } from '../src/main/servicios/cartera'
import { SinConexion } from '../src/main/servicios/errores'
import { guardarConversacion, guardarMensaje, hiloDe } from '../src/main/servicios/mensajeria'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { perfilesLocales, subirMiPerfil } from '../src/main/usuarios/perfiles'
import { CanalEnVivo } from '../src/main/vivo/canal'
import { reiniciarLaGrilla } from '../src/main/vivo/grilla'
import { olvidarLosPerfiles, perfilDe } from '../src/main/vivo/perfiles'
import { olvidarLaPresencia, presenciaActual } from '../src/main/vivo/presencia'
import type { DelServidor, EventoDeLlamada } from '../src/main/vivo/protocolo'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { claveDeCelda, indexarPresencia } from '../src/shared/presencia'
import type { SesionUsuario } from '../src/shared/tipos'
import { baseDePrueba, importar } from './ayuda'

const TOKEN = 'prueba'

/** Una foto de perfil de mentira: lo que importa es que vuelva byte por byte, no que sea un JPEG. */
const FOTO_DE_PERFIL = 'data:image/jpeg;base64,' + Buffer.from('la cara de Beto').toString('base64')

const ANA: SesionUsuario = {
  id: 1,
  nombre: 'Ana Ruiz',
  usuario: 'ana',
  rol: 'EMPLEADO',
  sucursal: { id: 1, nombre: 'Lanús' },
  debeCambiarClave: false,
}

const BETO: SesionUsuario = {
  id: 2,
  nombre: 'Beto Díaz',
  usuario: 'beto',
  rol: 'EMPLEADO',
  sucursal: { id: 2, nombre: 'Dock Sud' },
  debeCambiarClave: false,
}

/** La hoja de la agencia, con la columna `_ID` que la aplicación escribe al final. */
function hojaDeLaAgencia() {
  return [
    {
      titulo: 'AGOSTO 2026',
      valores: [
        ['LOCAL', 'NOMBRE', 'COMPANIA', 'PATENTE', 'CUOTA', '_ID'],
        ['DOCK SUD', 'PEREZ JUAN', 'RIVADAVIA', 'AA123BB', '15300', 'id-perez'],
        ['LANUS', 'GOMEZ ANA', 'RIVADAVIA', 'AC456DD', '12000', 'id-gomez'],
      ],
    },
    { titulo: 'BAJAS AGOSTO 2026', valores: [['NOMBRE', 'COMPANIA', 'PATENTE', 'MOTIVO', '_ID']] },
    { titulo: 'SINIESTROS', valores: [['FECHA', 'NOMBRE', 'COMPANIA', 'PATENTE', 'DETALLE', '_ID']] },
  ]
}

interface Computadora {
  quien: SesionUsuario
  db: BaseDeDatos
  fuente: FuenteVps
  motor: MotorDeSincronizacion
  canal: CanalEnVivo
  /** Todo lo que llegó por el socket, en orden: es contra esto que se afirma el protocolo. */
  recibidos: DelServidor[]
}

/** Deja activa esta base: el banco comparte una sola entre todos los archivos. */
function en(db: BaseDeDatos): void {
  usarBaseDeDatos(db)
}

function esperar(ms: number): Promise<void> {
  return new Promise((seguir) => setTimeout(seguir, ms))
}

/**
 * Una computadora de la agencia: base propia en memoria ya importada, su motor y su canal.
 *
 * `aplicaLoQueLlega` decide si esta computadora hace lo que hace el programa de verdad al recibir una
 * foto (bajar lo que cambió) o si sólo la anota. Ver el encabezado: en el banco eso lo hace una sola.
 */
async function unaComputadora(
  simulador: VpsSimulado,
  quien: SesionUsuario,
  aplicaLoQueLlega: boolean,
): Promise<Computadora> {
  // `credencialesDelPuente` fuera de Electron lee estas dos, y de ahí salen las que usa `vivo/grilla.ts`
  // para traer las métricas.
  process.env.DM_GESTION_VPS_URL = simulador.url
  process.env.DM_GESTION_VPS_TOKEN = TOKEN
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  const fuente = new FuenteVps({ urlBase: simulador.url, token: TOKEN })
  await importar(db, fuente)
  const importarPestanas = async (pestanas?: string[]) => {
    usarBaseDeDatos(db)
    const { id } = db
      .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
      .get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente, importacionId: id, soloPestanas: pestanas })
  }
  const motor = new MotorDeSincronizacion({ crearFuente: () => fuente, importar: importarPestanas })
  motor.encender()

  const recibidos: DelServidor[] = []
  const canal = new CanalEnVivo({
    credenciales: { urlBase: simulador.url, token: TOKEN },
    version: '14.0.0',
    motor: () => motor,
    // La que APLICA usa el reparto de verdad del canal (`espiar` mira y deja pasar): así lo que esta
    // prueba verifica es el renglón que une el socket con el resto del programa —el `case 'grilla'` y
    // el `reconciliar()` de la bienvenida—, que es justo lo que no prueba nadie más. Con un `despachar`
    // propio, que lo REEMPLAZA, se puede borrar `reconciliar` entero y la prueba sigue en verde.
    //
    // Lo único que el espía agrega al programa es el `en(db)`: allá hay una base por computadora y acá
    // una sola para las dos, y el reparto que viene atrás tiene que encontrar la de esta computadora.
    ...(aplicaLoQueLlega
      ? {
          espiar: (mensaje: DelServidor) => {
            recibidos.push(mensaje)
            usarBaseDeDatos(db)
          },
        }
      : { despachar: (mensaje: DelServidor) => recibidos.push(mensaje) }),
  })
  return { quien, db, fuente, motor, canal, recibidos }
}

/** Espera a que el canal quede conectado, o falla diciendo en qué quedó. */
async function esperarConexion(pc: Computadora, tope = 5_000): Promise<void> {
  const arranque = Date.now()
  while (Date.now() - arranque < tope) {
    if (pc.canal.estado().situacion === 'conectado') return
    await esperar(20)
  }
  assert.fail(`el canal de ${pc.quien.usuario} no se conectó: ${JSON.stringify(pc.canal.estado())}`)
}

/**
 * Espera a que `mirar()` devuelva lo esperado. Devuelve cuánto tardó, que es lo que se afirma.
 *
 * Acepta que `mirar()` sea asincrónico: lo que hay que mirar a veces es una consulta que devuelve una
 * promesa (el hilo de una conversación), y escribir dos esperas iguales sería peor.
 */
async function esperarHasta(
  mirar: () => string | undefined | Promise<string | undefined>,
  esperado: string,
  tope: number,
): Promise<number> {
  const arranque = Date.now()
  while (Date.now() - arranque < tope) {
    if ((await mirar()) === esperado) return Date.now() - arranque
    await esperar(20)
  }
  assert.equal(await mirar(), esperado, `no llegó en ${tope} ms`)
  return Date.now() - arranque
}

/** La cuota de un cliente en la planilla de la base ACTUAL. Hay que hacer `en(db)` antes. */
function cuotaDe(nombre: string): string | undefined {
  return planillaDelMes(null).filas.find((fila) => (fila.nombre ?? '').includes(nombre))?.cuota ?? undefined
}

function cerrar(pc: Computadora): void {
  en(pc.db)
  pc.canal.parar()
  pc.motor.apagar()
  pc.db.close()
}

function limpiarElEntorno(): void {
  reiniciarLaGrilla()
  delete process.env.DM_GESTION_VPS_URL
  delete process.env.DM_GESTION_VPS_TOKEN
}

test('canal en vivo: lo que se escribe en la base aparece en la otra computadora en menos de un segundo', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const ana = await unaComputadora(simulador, ANA, false)
  const beto = await unaComputadora(simulador, BETO, true)

  try {
    // La grilla que aplica lo que llega es la de Beto: se reinicia con SU base activa.
    en(beto.db)
    reiniciarLaGrilla()
    ana.canal.arrancar(ANA)
    beto.canal.arrancar(BETO)
    await esperarConexion(ana)
    await esperarConexion(beto)

    // 1. El saludo: el servidor contesta con la foto de la grilla, los perfiles y quién está.
    const bienvenida = beto.recibidos.find((mensaje) => mensaje.t === 'bienvenida')
    assert.ok(bienvenida && bienvenida.t === 'bienvenida', 'el canal tiene que empezar con una bienvenida')
    assert.equal(bienvenida.generacion, 1)
    assert.ok(bienvenida.conexionId, 'la conexión tiene id')
    assert.equal(simulador.conexiones.size, 2, 'las dos computadoras están conectadas')

    // 2. Un color por persona, que es lo que después pinta el glow: dos personas nunca comparten uno.
    const colores = [...simulador.perfiles.values()].map((perfil) => perfil.color)
    assert.equal(colores.length, 2)
    assert.notEqual(colores[0], colores[1], 'cada persona tiene su color')

    // 3. Ana escribe. En la 13.x esto tardaba hasta cinco minutos (el reloj de la bajada de
    //    seguridad) o hasta que el long-poll contestara; ahora el servidor avisa y Beto baja sólo la
    //    pestaña que cambió.
    en(beto.db)
    assert.equal(cuotaDe('PEREZ'), '15300', 'Beto todavía ve lo de antes')
    const arranque = Date.now()
    simulador.editarDirecto('AGOSTO 2026', 2, 4, '18000')
    simulador.marcarCambiada('AGOSTO 2026')
    const tardanza = await esperarHasta(() => cuotaDe('PEREZ'), '18000', 2_000)
    assert.ok(tardanza < 1_000, `tiene que llegar en menos de un segundo, tardó ${tardanza} ms`)
    assert.ok(Date.now() - arranque >= tardanza)

    // 4. Y llegó por el canal, no por casualidad: el frame `grilla` con la versión nueva está.
    const aviso = beto.recibidos.filter((mensaje) => mensaje.t === 'grilla').at(-1)
    assert.ok(aviso && aviso.t === 'grilla', 'tiene que haber llegado un aviso de grilla')
    assert.equal(aviso.versiones['AGOSTO 2026'], 1, 'con la versión que dejó la escritura de Ana')
  } finally {
    cerrar(beto)
    cerrar(ana)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})

test('canal en vivo: la computadora que se queda sin canal reconcilia sola al volver', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const ana = await unaComputadora(simulador, ANA, false)
  const beto = await unaComputadora(simulador, BETO, true)

  try {
    en(beto.db)
    reiniciarLaGrilla()
    ana.canal.arrancar(ANA)
    beto.canal.arrancar(BETO)
    await esperarConexion(ana)
    await esperarConexion(beto)

    // Le desenchufan el cable a Beto: el servidor le corta el socket sin saludo de despedida, que es
    // lo que pasa de verdad cuando se corta internet (nadie manda un FIN).
    assert.equal(simulador.cerrarConexionesDe('beto'), 1, 'se le cortó la conexión a Beto')
    await esperar(50)
    assert.notEqual(beto.canal.estado().situacion, 'conectado', 'Beto se quedó sin canal')

    // Y mientras está caído, Ana carga un pago. Beto no se entera de nada: no hay a quién avisarle.
    const avisosAntes = beto.recibidos.filter((mensaje) => mensaje.t === 'grilla').length
    simulador.editarDirecto('AGOSTO 2026', 3, 4, '13500')
    simulador.marcarCambiada('AGOSTO 2026')
    en(beto.db)
    assert.equal(cuotaDe('GOMEZ'), '12000', 'lo de Ana no llegó: el canal estaba cortado')

    // Al volver, la bienvenida trae la foto de cómo está la base HOY, y de esa comparación sale lo que
    // hay que bajar. Es lo que reemplazó al reloj de los cinco minutos: nadie pregunta cada tanto,
    // pero cada reconexión se pone al día enterita.
    await esperarConexion(beto)
    const tardanza = await esperarHasta(() => cuotaDe('GOMEZ'), '13500', 5_000)
    assert.ok(tardanza >= 0)
    assert.equal(
      beto.recibidos.filter((mensaje) => mensaje.t === 'grilla').length,
      avisosAntes,
      'no llegó ningún aviso de grilla mientras estuvo caído: lo trajo la reconciliación de la bienvenida',
    )
    assert.equal(beto.recibidos.filter((mensaje) => mensaje.t === 'bienvenida').length, 2, 'saludó de nuevo')
  } finally {
    cerrar(beto)
    cerrar(ana)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})

// El portero de «ver sí, tocar no» (14.0). Lo llama `permisos.ts` en cada operación que escribe, así
// que estas dos ramas son las que deciden si la agencia puede trabajar: la primera apaga el programa
// cuando de verdad no hay canal, la segunda es la que evita apagarlo en la máquina de desarrollo y en
// el banco de pruebas, donde no hay ningún puente configurado y no hay nada que proteger.
test('canal en vivo: exigirConexion frena la escritura sin canal y no molesta sin puente', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const beto = await unaComputadora(simulador, BETO, false)

  try {
    en(beto.db)
    reiniciarLaGrilla()
    beto.canal.arrancar(BETO)
    await esperarConexion(beto)

    // Con el canal abierto y recién saludado, se escribe.
    beto.canal.exigirConexion()

    // Con el canal cerrado, no: es el banner rojo y los botones apagados.
    beto.canal.parar()
    assert.throws(() => beto.canal.exigirConexion(), SinConexion, 'sin canal no se puede escribir')

    // Sin puente configurado no exige nada. Es la máquina de desarrollo y es el resto de este banco:
    // ahí no hay servidor al que conectarse, y trabar todo el programa no protegería a nadie.
    const sinPuente = new CanalEnVivo({ credenciales: null })
    assert.equal(sinPuente.estado().situacion, 'sin-puente')
    sinPuente.exigirConexion()
  } finally {
    cerrar(beto)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})

// ---------------------------------------------------------------------------
// La presencia y los perfiles de punta a punta (Fase C3)
// ---------------------------------------------------------------------------
//
// Lo que se prueba acá y no en `colaboracion-en-vivo.prueba.ts`: allá el canal es de mentira y lo que
// se afirma es qué DECIDE esta computadora. Acá está el contrato con el servidor: que el frame `foco`
// se convierta en una foto de `presencia` para las demás, que al cortarse el cable la persona
// desaparezca de esa foto, y que `PUT /api/dmg/perfiles/mio` conteste `{perfil}` y difunda `{t:'perfil'}`.
// Ninguna de esas tres cosas la puede descubrir el compilador: son dos programas distintos poniéndose
// de acuerdo sobre unos nombres.

test('presencia: lo que Ana mira aparece en la pantalla de Beto, y al cortarse el cable desaparece', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const ana = await unaComputadora(simulador, ANA, false)
  const beto = await unaComputadora(simulador, BETO, true)

  try {
    en(beto.db)
    reiniciarLaGrilla()
    olvidarLaPresencia()
    ana.canal.arrancar(ANA)
    beto.canal.arrancar(BETO)
    await esperarConexion(ana)
    await esperarConexion(beto)

    // Ana entra a corregir la cuota de Pérez. El frame sale de su canal tal como lo arma
    // `main/vivo/presencia.ts`, y el servidor tiene que devolver una foto ENTERA de la presencia.
    ana.canal.enviar({
      t: 'foco',
      foco: { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'id-perez', campo: 'cuota', editando: true },
    })
    await esperarHasta(() => presenciaActual().find((quien) => quien.clave === 'ana')?.foco?.tipo, 'celda', 2_000)

    const anaEnLaFoto = presenciaActual().find((quien) => quien.clave === 'ana')!
    assert.equal(anaEnLaFoto.nombre, 'Ana Ruiz')
    assert.deepEqual(anaEnLaFoto.foco, {
      tipo: 'celda',
      pestana: 'AGOSTO 2026',
      filaId: 'id-perez',
      campo: 'cuota',
      editando: true,
    })
    // Y con eso la pantalla de Beto sabe qué celda pintar y quién la traba: es lo que hace el glow.
    const indice = indexarPresencia(presenciaActual())
    assert.deepEqual(indice.get(claveDeCelda('id-perez', 'cuota'))?.map((quien) => quien.clave), ['ana'])

    // Le desenchufan el cable a Ana. La presencia vive pegada a la CONEXIÓN: se va con ella, sin que
    // nadie tenga que avisar nada, que es lo que impide que queden celdas pintadas para siempre.
    assert.equal(simulador.cerrarConexionesDe('ana'), 1)
    await esperarHasta(() => String(presenciaActual().some((quien) => quien.clave === 'ana')), 'false', 2_000)
    assert.equal(indexarPresencia(presenciaActual()).get(claveDeCelda('id-perez', 'cuota')), undefined)
  } finally {
    olvidarLaPresencia()
    cerrar(beto)
    cerrar(ana)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})

test('perfiles: la foto y el color van y vuelven, y un color tomado se rechaza con 409', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const ana = await unaComputadora(simulador, ANA, false)
  const beto = await unaComputadora(simulador, BETO, true)

  try {
    en(beto.db)
    reiniciarLaGrilla()
    olvidarLosPerfiles()
    ana.canal.arrancar(ANA)
    beto.canal.arrancar(BETO)
    await esperarConexion(ana)
    await esperarConexion(beto)

    // Beto se pone una foto y elige el color 7. Lo que vuelve es lo que la pantalla muestra sin
    // esperar el ida y vuelta del canal, y lo que queda en el espejo para verlo sin internet.
    const guardado = await subirMiPerfil(BETO, { color: 7, foto: FOTO_DE_PERFIL })
    assert.equal(guardado.clave, 'beto')
    assert.equal(guardado.color, 7)
    assert.equal(guardado.foto, FOTO_DE_PERFIL, 'la foto vuelve como data URL, no como bytes')
    assert.deepEqual(
      perfilesLocales().find((perfil) => perfil.clave === 'beto'),
      { clave: 'beto', color: 7, foto: FOTO_DE_PERFIL, version: guardado.version },
    )

    // Y además el servidor lo difunde: en las otras computadoras la cara nueva aparece sola.
    await esperarHasta(() => String(perfilDe('beto')?.color), '7', 2_000)
    assert.equal(perfilDe('beto')?.foto, FOTO_DE_PERFIL)
    assert.ok(
      beto.recibidos.some((mensaje) => mensaje.t === 'perfil' && mensaje.perfil.clave === 'beto'),
      'el cambio de perfil viaja por el canal',
    )

    // Y al revés, que es lo que pasa de verdad en la agencia: Ana elige su color en SU computadora y en
    // la de Beto el anillo se repinta solo. Del lado de Beto no hay ningún pedido: lo único que llegó
    // fue el frame `perfil`, y de ahí sale tanto lo que muestra la pantalla como lo que queda en el
    // espejo para la próxima vez que abra sin internet.
    en(ana.db)
    const deAna = await subirMiPerfil(ANA, { color: 3 })
    assert.equal(deAna.color, 3)
    en(beto.db)
    await esperarHasta(() => String(perfilDe('ana')?.color), '3', 2_000)
    en(beto.db)
    assert.equal(
      perfilesLocales().find((perfil) => perfil.clave === 'ana')?.color,
      3,
      'el color de Ana también quedó en el espejo de Beto',
    )

    // El color es único: es lo que hace que un anillo diga quién está sin leer ningún nombre. El 409
    // llega con el texto del servidor y la pantalla lo muestra tal cual («elegí otro»).
    await assert.rejects(subirMiPerfil(ANA, { color: 7 }), /ya lo está usando/)
    assert.equal(perfilDe('ana')?.color, 3, 'el color de Ana no se movió')
    assert.equal(perfilDe('beto')?.color, 7, 'y el de Beto tampoco: el rechazado no pisa nada')
  } finally {
    olvidarLosPerfiles()
    cerrar(beto)
    cerrar(ana)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})

// ---------------------------------------------------------------------------
// Las llamadas de voz de punta a punta (Fase E4)
// ---------------------------------------------------------------------------
//
// Acá se prueba el CONTRATO de la señalización, no el audio: quién recibe qué frame y con qué nombres.
// El audio va punto a punto por WebRTC y sólo se puede probar en el humo manual, con dos máquinas y
// auriculares; lo que sí se puede romper sin que nadie se entere es el protocolo —que el servidor
// convierta `invitar` en `timbrar`, que conteste `ocupado` en vez de hacer sonar un segundo teléfono,
// que el `sdp` llegue tal cual— y eso es exactamente lo que ninguna otra prueba mira.
//
// Van con TELÉFONOS y no con las computadoras de arriba porque `main/vivo/llamadas.ts` tiene estado de
// módulo (hay una llamada por proceso, no por base): dos computadoras de este banco compartirían la
// misma máquina de estados y no se podría afirmar nada de las dos a la vez. Lo que decide cada
// computadora con lo que le llega ya está probado en `colaboracion-en-vivo.prueba.ts`.

const CARO: SesionUsuario = {
  id: 3,
  nombre: 'Caro Vega',
  usuario: 'caro',
  rol: 'EMPLEADO',
  sucursal: { id: 1, nombre: 'Lanús' },
  debeCambiarClave: false,
}

interface Telefono {
  quien: SesionUsuario
  canal: CanalEnVivo
  /** Los eventos de llamada que llegaron por el socket, en orden. */
  eventos: EventoDeLlamada[]
}

/** Un teléfono: el canal y nada más. Sin base ni motor, que para la señalización no hacen falta. */
function unTelefono(simulador: VpsSimulado, quien: SesionUsuario): Telefono {
  const eventos: EventoDeLlamada[] = []
  const canal = new CanalEnVivo({
    credenciales: { urlBase: simulador.url, token: TOKEN },
    version: '14.0.0',
    despachar: (mensaje: DelServidor) => {
      if (mensaje.t === 'llamada') eventos.push(mensaje.evento)
    },
  })
  canal.arrancar(quien)
  return { quien, canal, eventos }
}

async function esperarElTelefono(telefono: Telefono, tope = 5_000): Promise<void> {
  const arranque = Date.now()
  while (Date.now() - arranque < tope) {
    if (telefono.canal.estado().situacion === 'conectado') return
    await esperar(20)
  }
  assert.fail(`el canal de ${telefono.quien.usuario} no se conectó`)
}

/** Espera a que a este teléfono le llegue un evento de este tipo y lo devuelve. */
async function esperarEvento<T extends EventoDeLlamada['tipo']>(
  telefono: Telefono,
  tipo: T,
  tope = 2_000,
): Promise<Extract<EventoDeLlamada, { tipo: T }>> {
  const arranque = Date.now()
  while (Date.now() - arranque < tope) {
    const encontrado = telefono.eventos.find((evento) => evento.tipo === tipo)
    if (encontrado) return encontrado as Extract<EventoDeLlamada, { tipo: T }>
    await esperar(20)
  }
  assert.fail(
    `a ${telefono.quien.usuario} no le llegó ningún «${tipo}» en ${tope} ms; llegó: ` +
      JSON.stringify(telefono.eventos.map((evento) => evento.tipo)),
  )
}

/** La conversación de a dos donde queda el renglón de la llamada. Se arma directo en el simulador. */
function unaDirectaEnElServidor(simulador: VpsSimulado, id: string, unos: SesionUsuario[]): void {
  simulador.conversaciones.set(id, {
    id,
    tipo: 'DIRECTA',
    titulo: null,
    claveDirecta: unos.map((quien) => quien.usuario).sort().join('|'),
    creadoPor: unos[0]!.usuario,
    creadoEn: new Date().toISOString(),
    ultimoMensajeEn: null,
    participantes: unos.map((quien) => ({ clave: quien.usuario, nombre: quien.nombre, salioEn: null })),
  })
}

test('llamadas: Ana llama, a Beto le suena, se hablan, y al colgar queda el renglón en la conversación', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  simulador.timbreDeLlamadaMs = 60_000
  await simulador.escuchar()
  unaDirectaEnElServidor(simulador, 'c-ana-beto', [ANA, BETO])
  const ana = unTelefono(simulador, ANA)
  const beto = unTelefono(simulador, BETO)
  const caro = unTelefono(simulador, CARO)

  try {
    await esperarElTelefono(ana)
    await esperarElTelefono(beto)
    await esperarElTelefono(caro)

    // 1. Ana invita. El servidor NO reenvía la invitación tal cual: la convierte en el timbre del otro
    //    lado, con el nombre de quien llama adentro (el que atiende no lo tiene de dónde sacar).
    ana.canal.enviar({
      t: 'llamada',
      evento: { tipo: 'invitar', llamadaId: 'l-1', para: 'beto', conversacionId: 'c-ana-beto' },
    })
    const timbre = await esperarEvento(beto, 'timbrar')
    assert.deepEqual(timbre, {
      tipo: 'timbrar',
      llamadaId: 'l-1',
      de: { clave: 'ana', nombre: 'Ana Ruiz' },
      conversacionId: 'c-ana-beto',
    })
    assert.equal(ana.eventos.length, 0, 'al que llama no le vuelve nada mientras suena')

    // 2. Beto atiende y Ana se entera.
    beto.canal.enviar({ t: 'llamada', evento: { tipo: 'aceptar', llamadaId: 'l-1' } })
    assert.deepEqual(await esperarEvento(ana, 'aceptar'), { tipo: 'aceptar', llamadaId: 'l-1' })

    // 3. La señalización de WebRTC pasa TAL CUAL, en los dos sentidos: el servidor no sabe nada de SDP.
    ana.canal.enviar({ t: 'llamada', evento: { tipo: 'sdp', llamadaId: 'l-1', sdp: { type: 'offer', sdp: 'v=0 de Ana' } } })
    const oferta = await esperarEvento(beto, 'sdp')
    assert.deepEqual(oferta.sdp, { type: 'offer', sdp: 'v=0 de Ana' })
    beto.canal.enviar({ t: 'llamada', evento: { tipo: 'ice', llamadaId: 'l-1', candidato: { candidate: 'candidato de Beto', sdpMid: '0' } } })
    const candidato = await esperarEvento(ana, 'ice')
    assert.deepEqual(candidato.candidato, { candidate: 'candidato de Beto', sdpMid: '0' })

    // 4. Caro llama a Beto mientras habla: ocupado al instante y el teléfono de Beto no suena de nuevo.
    caro.canal.enviar({
      t: 'llamada',
      evento: { tipo: 'invitar', llamadaId: 'l-2', para: 'beto', conversacionId: 'c-ana-beto' },
    })
    const ocupado = await esperarEvento(caro, 'rechazar')
    assert.equal(ocupado.llamadaId, 'l-2')
    assert.equal(ocupado.motivo, 'ocupado')
    assert.equal(beto.eventos.filter((evento) => evento.tipo === 'timbrar').length, 1, 'no le sonó una segunda')

    // 5. Ana corta. Al otro le llega el corte y en la conversación queda el renglón que escribe el
    //    servidor: la duración y el motivo los sabe él, que es el único que vio los dos lados.
    ana.canal.enviar({ t: 'llamada', evento: { tipo: 'colgar', llamadaId: 'l-1', motivo: 'terminada' } })
    const corte = await esperarEvento(beto, 'colgar')
    assert.equal(corte.motivo, 'terminada')
    // Y al que cortó no le vuelve el eco: ya cerró su `RTCPeerConnection` antes de mandar el frame
    // (`colgarLlamada` en `main/vivo/llamadas.ts` corta primero y avisa después), así que devolvérselo
    // sólo serviría para que la máquina de estados tuviera que aprender a descartar su propio corte.
    assert.equal(ana.eventos.filter((evento) => evento.tipo === 'colgar').length, 0, 'el que corta ya lo sabe')
    const renglon = simulador.mensajes.find((mensaje) => mensaje.tipo === 'LLAMADA')
    assert.ok(renglon, 'la llamada deja su renglón en la conversación')
    assert.equal(renglon.conversacionId, 'c-ana-beto')
    assert.equal(renglon.autorClave, 'ana')
    assert.match(renglon.cuerpo, /^Llamada de voz · \d+:\d\d$/)
  } finally {
    ana.canal.parar()
    beto.canal.parar()
    caro.canal.parar()
    await simulador.cerrar()
  }
})

test('llamadas: la que se corta el cable no queda abierta, y a la que no atiende le queda la perdida', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  simulador.timbreDeLlamadaMs = 60_000
  await simulador.escuchar()
  unaDirectaEnElServidor(simulador, 'c-ana-beto', [ANA, BETO])
  const ana = unTelefono(simulador, ANA)
  const beto = unTelefono(simulador, BETO)

  try {
    await esperarElTelefono(ana)
    await esperarElTelefono(beto)

    // Se hablan…
    ana.canal.enviar({
      t: 'llamada',
      evento: { tipo: 'invitar', llamadaId: 'l-3', para: 'beto', conversacionId: 'c-ana-beto' },
    })
    await esperarEvento(beto, 'timbrar')
    beto.canal.enviar({ t: 'llamada', evento: { tipo: 'aceptar', llamadaId: 'l-3' } })
    await esperarEvento(ana, 'aceptar')

    // …y a Ana le desenchufan el cable. La llamada vive pegada a la CONEXIÓN: el servidor la cierra y
    // se lo dice a Beto. Es el hecho del que depende `elCanalVolvio()` en `main/vivo/llamadas.ts`: la
    // computadora que vuelve no puede dar por buena una llamada que del otro lado ya no existe.
    assert.equal(simulador.cerrarConexionesDe('ana'), 1)
    const corte = await esperarEvento(beto, 'colgar')
    assert.equal(corte.motivo, 'desconexion')
    assert.equal(simulador.llamadasAbiertas.size, 0, 'no queda ninguna llamada abierta en el servidor')

    // Y una llamada a alguien que no tiene ninguna computadora prendida se contesta al instante: no
    // hay a quién hacerle sonar el teléfono, y la perdida queda escrita para cuando vuelva.
    beto.canal.enviar({
      t: 'llamada',
      evento: { tipo: 'invitar', llamadaId: 'l-4', para: 'ana', conversacionId: 'c-ana-beto' },
    })
    const sinRespuesta = await esperarEvento(beto, 'rechazar')
    assert.equal(sinRespuesta.motivo, 'sin-respuesta')
    const renglones = simulador.mensajes.filter((mensaje) => mensaje.tipo === 'LLAMADA').map((mensaje) => mensaje.cuerpo)
    assert.equal(renglones.length, 2, 'la que se cortó y la que no atendió nadie')
    // La que se cortó se había atendido, así que tiene duración; la otra nunca sonó.
    assert.match(renglones[0]!, /^Llamada de voz · \d+:\d\d$/)
    assert.equal(renglones[1], 'Llamada perdida')
  } finally {
    ana.canal.parar()
    beto.canal.parar()
    await simulador.cerrar()
  }
})

// El teléfono que suena y nadie atiende. Es la única de las tres decisiones del servidor que depende
// de un reloj, y va con `timbreDeLlamadaMs` en un cuarto de segundo en vez de los cuarenta y cinco
// del VPS: lo que hay que proteger es QUIÉN corta y a quiénes les avisa, no cuánto espera. Un banco de
// pruebas que se queda cuarenta y cinco segundos mirando un timbre no lo corre nadie.
test('llamadas: la que nadie atiende la corta el servidor, les llega a los dos y queda la perdida', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  simulador.timbreDeLlamadaMs = 250
  await simulador.escuchar()
  unaDirectaEnElServidor(simulador, 'c-ana-beto', [ANA, BETO])
  const ana = unTelefono(simulador, ANA)
  const beto = unTelefono(simulador, BETO)

  try {
    await esperarElTelefono(ana)
    await esperarElTelefono(beto)

    // Ana llama y a Beto le suena, pero Beto se fue del mostrador y no toca nada.
    ana.canal.enviar({
      t: 'llamada',
      evento: { tipo: 'invitar', llamadaId: 'l-5', para: 'beto', conversacionId: 'c-ana-beto' },
    })
    await esperarEvento(beto, 'timbrar')

    // Acá los DOS reciben el corte, y no como cuando alguien cuelga: nadie cortó, cortó el servidor, y
    // ninguna de las dos computadoras tiene manera de saberlo sola. A Ana le apaga el tono de llamada y
    // a Beto el timbre, que si no seguiría sonando en una oficina vacía.
    const paraAna = await esperarEvento(ana, 'rechazar')
    assert.equal(paraAna.llamadaId, 'l-5')
    assert.equal(paraAna.motivo, 'sin-respuesta')
    const paraBeto = await esperarEvento(beto, 'rechazar')
    assert.equal(paraBeto.motivo, 'sin-respuesta', 'al teléfono que sonaba también se le avisa')
    assert.equal(simulador.llamadasAbiertas.size, 0, 'no queda ninguna llamada abierta en el servidor')

    // Y queda escrita en la conversación, que es cómo Beto se entera de que lo llamaron.
    const renglon = simulador.mensajes.find((mensaje) => mensaje.tipo === 'LLAMADA')
    assert.ok(renglon, 'la llamada que nadie atendió también deja su renglón')
    assert.equal(renglon.conversacionId, 'c-ana-beto')
    assert.equal(renglon.autorClave, 'ana')
    assert.equal(renglon.cuerpo, 'Llamada perdida')
  } finally {
    ana.canal.parar()
    beto.canal.parar()
    await simulador.cerrar()
  }
})

// ---------------------------------------------------------------------------
// Las reacciones de punta a punta (Fase D)
// ---------------------------------------------------------------------------

test('reacciones: el pulgar que pone Ana aparece en el hilo de Beto sin que nadie pregunte', async () => {
  const simulador = new VpsSimulado({ pestanas: hojaDeLaAgencia() })
  await simulador.escuchar()
  const ana = await unaComputadora(simulador, ANA, false)
  const beto = await unaComputadora(simulador, BETO, true)

  try {
    en(beto.db)
    reiniciarLaGrilla()
    unaDirectaEnElServidor(simulador, 'c-ana-beto', [ANA, BETO])
    simulador.mensajes.push({
      id: 'm-1',
      conversacionId: 'c-ana-beto',
      tipo: 'NORMAL',
      orden: 1,
      autorClave: 'beto',
      autorNombre: 'Beto Díaz',
      cuerpo: 'Llegó el pago de Pérez',
      creadoEn: new Date().toISOString(),
      enviadoEn: new Date().toISOString(),
      eliminadoEn: null,
      eliminadoPor: null,
      adjuntos: [],
    })

    // El espejo de Beto, con el mismo id remoto: es contra ese id que viaja la reacción.
    const conversacionId = guardarConversacion({
      id: 'c-ana-beto',
      tipo: 'DIRECTA',
      titulo: null,
      participantes: [
        { clave: 'ana', nombre: 'Ana Ruiz', salioEn: null },
        { clave: 'beto', nombre: 'Beto Díaz', salioEn: null },
      ],
      creadoPor: 'beto',
      creadoEn: 'hoy',
      ultimoMensajeEn: null,
    })
    guardarMensaje(
      {
        id: 'm-1',
        conversacionId: 'c-ana-beto',
        orden: 1,
        autorClave: 'beto',
        autorNombre: 'Beto Díaz',
        cuerpo: 'Llegó el pago de Pérez',
        creadoEn: 'hoy',
        enviadoEn: 'hoy',
        eliminadoEn: null,
        adjuntos: [],
        acuses: [],
      },
      'beto',
    )

    ana.canal.arrancar(ANA)
    beto.canal.arrancar(BETO)
    await esperarConexion(ana)
    await esperarConexion(beto)

    // Ana toca el pulgar. Va por HTTP con el cliente de verdad (`puenteDeMensajes().reaccionar`), que
    // es lo único que prueba que la ruta, el verbo y el nombre de los campos son los que el servidor
    // espera: si el servidor pidiera POST, o `/reacciones`, o `{reaccion}`, cada clic terminaría en un
    // «El servidor rechazó…» y ninguna otra prueba se enteraría.
    const puente = new PuenteDeMensajes({ urlBase: simulador.url, token: TOKEN })
    const actorAna = { clave: 'ana', nombre: 'Ana Ruiz', rol: 'EMPLEADO' as const }
    const puesta = await puente.reaccionar(actorAna, 'm-1', '👍')
    assert.deepEqual(puesta, {
      mensajeId: 'm-1',
      conversacionId: 'c-ana-beto',
      reacciones: [{ emoji: '👍', claves: ['ana'] }],
    })

    // Y del lado de Beto aparece sola: la difunde el canal, no el cartero. Una reacción no es un
    // mensaje —no suena la campana ni sube la conversación—, sólo se redibuja lo que ya está a la vista.
    en(beto.db)
    await esperarHasta(
      async () => (await hiloDe(BETO, conversacionId)).mensajes[0]?.reacciones?.[0]?.emoji,
      '👍',
      2_000,
    )
    const hilo = await hiloDe(BETO, conversacionId)
    assert.deepEqual(hilo.mensajes[0]!.reacciones, [
      { emoji: '👍', claves: ['ana'], nombres: ['Ana Ruiz'], mia: false },
    ])
    assert.ok(
      beto.recibidos.some((mensaje) => mensaje.t === 'reaccion' && mensaje.mensajeId === 'm-1'),
      'la reacción viaja por el canal',
    )

    // Y es un interruptor: el mismo emoji otra vez la saca, en el servidor y en el espejo.
    const sacada = await puente.reaccionar(actorAna, 'm-1', '👍')
    assert.deepEqual(sacada.reacciones, [])
    en(beto.db)
    await esperarHasta(
      async () => String((await hiloDe(BETO, conversacionId)).mensajes[0]?.reacciones?.length),
      '0',
      2_000,
    )

    // Y cambiar de emoji no suma una segunda pastilla: cada persona reacciona UNA vez a cada mensaje,
    // así que el corazón reemplaza al pulgar en lugar de convivir con él. Es la mitad del interruptor
    // que se rompe sin que se note —la de sacar deja la cuenta en cero y se ve enseguida; la de
    // reemplazar deja dos pastillas donde tenía que haber una y parece que anduvo—.
    await puente.reaccionar(actorAna, 'm-1', '👍')
    const cambiada = await puente.reaccionar(actorAna, 'm-1', '❤️')
    assert.deepEqual(cambiada.reacciones, [{ emoji: '❤️', claves: ['ana'] }])
    en(beto.db)
    await esperarHasta(
      async () => (await hiloDe(BETO, conversacionId)).mensajes[0]?.reacciones?.[0]?.emoji,
      '❤️',
      2_000,
    )
    const conCorazon = await hiloDe(BETO, conversacionId)
    assert.deepEqual(
      conCorazon.mensajes[0]!.reacciones,
      [{ emoji: '❤️', claves: ['ana'], nombres: ['Ana Ruiz'], mia: false }],
      'una sola pastilla: el espejo tiene que BORRAR el pulgar, no dejarlo al lado',
    )
  } finally {
    cerrar(beto)
    cerrar(ana)
    limpiarElEntorno()
    await simulador.cerrar()
  }
})
