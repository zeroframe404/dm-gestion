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
import { planillaDelMes } from '../src/main/servicios/cartera'
import { SinConexion } from '../src/main/servicios/errores'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { CanalEnVivo } from '../src/main/vivo/canal'
import { reiniciarLaGrilla } from '../src/main/vivo/grilla'
import type { DelServidor } from '../src/main/vivo/protocolo'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import type { SesionUsuario } from '../src/shared/tipos'
import { baseDePrueba, importar } from './ayuda'

const TOKEN = 'prueba'

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

/** Espera a que `mirar()` devuelva lo esperado. Devuelve cuánto tardó, que es lo que se afirma. */
async function esperarHasta(mirar: () => string | undefined, esperado: string, tope: number): Promise<number> {
  const arranque = Date.now()
  while (Date.now() - arranque < tope) {
    if (mirar() === esperado) return Date.now() - arranque
    await esperar(20)
  }
  assert.equal(mirar(), esperado, `no llegó en ${tope} ms`)
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
