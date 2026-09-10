// Un servidor local que simula el puente /api/dmg del VPS (la base del GENERAL DE CLIENTES),
// con la misma semántica de grilla que el servidor real: pestañas ordenadas, filas numeradas
// base 1, celdas de texto, y la migración inicial en tres fases. Lo usan las pruebas y el humo,
// igual que github-simulado.mjs simula la base de usuarios.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

/** Las mismas claves que acepta el servidor real: es una lista blanca, no un almacén libre. */
const CLAVES_DE_AJUSTE = new Set(['vehiculos', 'referencias', 'google', 'meta', 'ticket', 'companias'])

const TOKEN_POR_DEFECTO = 'prueba'

/** La ruta del canal en vivo (14.0), la misma que `src/main/vivo/protocolo.ts`. */
const RUTA_DEL_CANAL = '/api/dmg/vivo'
/** Cuántos colores tiene la paleta de la presencia: los índices que reparte `asegurarPerfil`. */
const COLORES_DE_LA_PALETA = 12
/** Cada cuánto le pide latir el servidor al cliente. El mismo número que el protocolo. */
const LATIDO_DEL_CANAL_MS = 20_000

function comoTexto(valor) {
  if (valor === null || valor === undefined) return ''
  return String(valor)
}

function normalizarFila(fila) {
  return Array.isArray(fila) ? fila.map(comoTexto) : []
}

/**
 * Una copia de la que nadie puede tirar del hilo. El Map se copia Y las celdas también: `editarDirecto`
 * muta el arreglo de celdas en su lugar, así que con un `new Map(filas)` a secas los dos apuntarían al
 * MISMO arreglo y una edición posterior se filtraría dentro del respaldo. Justamente lo que estas
 * pruebas existen para descubrir.
 */
function copiaProfunda(pestana) {
  const filas = new Map()
  for (const [numero, celdas] of pestana.filas) filas.set(numero, [...celdas])
  return { ...pestana, filas }
}

export class VpsSimulado {
  constructor(opciones = {}) {
    this.token = opciones.token ?? TOKEN_POR_DEFECTO
    /** @type {Array<{sheetId: number, titulo: string, indice: number, columnas: number, oculta: boolean, columnasOcultas: number[], filas: Map<number, string[]>}>} */
    this.pestanas = []
    this.inicializada = false
    /**
     * El aviso en vivo: la versión de cada pestaña (sube en cada escritura) y la generación (sube
     * cuando la hoja se reemplaza entera). Igual que el servidor real, salvo que `/novedades` NO
     * espera: contesta al instante, porque una prueba que espera veinticinco segundos por vuelta no
     * la corre nadie. Es la misma decisión que ya se había tomado con las novedades de mensajería.
     */
    this.versiones = new Map()
    this.generacion = 1
    /**
     * Las métricas que el servidor ya calculó (el podio de sucursales, 13.2): clave → {version,
     * calculadoEn, payload}. Van en el mismo aviso de `/novedades` que las pestañas, con su propia
     * versión, y se leen aparte por `GET /api/dmg/metricas/:clave` — ver `cargarMetricaDirecto`.
     */
    this.metricas = new Map()
    /** Las pestañas que se bajaron enteras (sin `hastaFila`), en orden. */
    this.pestanasLeidas = []
    this.proximoSheetId = 1
    this.servidor = null
    this.url = ''
    /** Respuestas forzadas antes de responder bien: [{estado, mensaje}] */
    this.fallasIniciales = []
    /** Si está puesto, toda llamada responde esto. */
    this.errorFijo = null
    /** No responder nunca (para probar el timeout). */
    this.colgar = false
    this.intercambios = []
    this.llamadas = {
      estructura: 0, leer: 0, celdas: 0, agregar: 0, borrar: 0, pestanas: 0, tramos: 0, estado: 0,
      novedades: 0, metricasLeidas: 0,
      ajusteLeido: 0, ajusteConsultado: 0, ajusteGuardado: 0,
      usuariosLeidos: 0, usuariosGuardados: 0,
      respaldosListados: 0, respaldosCreados: 0, respaldosRestaurados: 0,
      mensajesConversaciones: 0, mensajesEnviados: 0, mensajesNovedades: 0,
      mensajesEntregados: 0, mensajesLeidos: 0, mensajesRegistro: 0,
    }
    /**
     * El freno del zumbido, en milisegundos. El servidor de verdad usa diez segundos; la prueba lo
     * puede bajar a cero para verificar los dos lados (que frena, y que después deja).
     */
    this.esperaEntreZumbidosMs = 10_000
    /** La mensajería interna (12.8): conversaciones, mensajes y acuses, en memoria. */
    this.conversaciones = new Map()
    this.mensajes = []
    /** `${mensajeId}|${usuarioClave}` → { entregadoEn, leidoEn }. Es también la cola de reparto. */
    this.acuses = new Map()
    /**
     * Las reacciones (14.0): `mensajeId` → Map(clave → emoji). Una persona reacciona UNA vez a cada
     * mensaje, así que el Map de adentro tiene la clave como llave y no una lista: es la misma forma
     * que la clave primaria `(mensaje_id, clave)` del espejo de la aplicación.
     */
    this.reacciones = new Map()
    this.ordenDeMensajes = 1
    /** Los respaldos guardados, del más nuevo al más viejo. */
    this.respaldos = []
    /** Los adjuntos subidos (12.6): id → ficha + bytes. */
    this.adjuntos = new Map()
    /** El tope por archivo del servidor simulado: chico, para poder probar el 413. */
    this.topeDeAdjunto = 8 * 1024 * 1024
    this.proximoRespaldoId = 1
    /** Los mensajes con los que se guardó la base de usuarios: lo que antes era el mensaje del commit. */
    this.mensajesDeUsuarios = []
    /** Los ajustes compartidos, por clave. */
    this.ajustes = new Map()
    /** La base de usuarios de la agencia: el documento entero y su versión (el candado optimista). */
    this.usuarios = null

    // --- El canal en vivo (14.0) -----------------------------------------------------------------
    //
    // Desde la 14.0 el servidor AVISA en vez de dejarse preguntar: un WebSocket por computadora, por
    // el que viajan señales («la grilla cambió», «tenés mensajes») y la presencia. El simulador lo
    // levanta de verdad —con `ws`, enganchado al mismo servidor http— porque lo que las pruebas de
    // dos computadoras necesitan verificar es justamente el camino completo: que lo que escribe una
    // le llegue a la otra sola, sin que nadie pregunte.
    /** El `WebSocketServer` del canal; existe recién desde `escuchar()`. */
    this.servidorDelCanal = null
    /** Las conexiones ya saludadas: conexionId → {id, socket, actor, color, foco, desde}. */
    this.conexiones = new Map()
    /** Los perfiles de la agencia (color y foto), por clave. El color lo reparte `asegurarPerfil`. */
    this.perfiles = new Map()
    /**
     * Los eventos de señalización de llamadas que llegaron por el canal, en orden.
     *
     * Se llama `llamadasDeVoz` y no `llamadas` porque ese nombre ya es de los contadores de pedidos
     * HTTP (`llamadas.celdas`, `llamadas.leer`…), que usan medio banco de pruebas.
     */
    this.llamadasDeVoz = []
    /**
     * Las llamadas abiertas (14.0): `llamadaId` → { de, para, conversacionId, situacion, desde }.
     *
     * El servidor es el único que ve los DOS lados, y por eso es el que decide el «ocupado», el corte
     * por falta de respuesta y el texto del mensaje que queda en la conversación. Las computadoras
     * sólo saben lo suyo.
     */
    this.llamadasAbiertas = new Map()
    /**
     * Cuánto suena el teléfono antes de darlo por perdido, en milisegundos. Igual que el freno del
     * zumbido, las pruebas lo bajan: cuarenta y cinco segundos de espera no los corre nadie.
     */
    this.timbreDeLlamadaMs = 45_000
    /** Lo que el saludo manda como configuración de WebRTC. Sin TURN, igual que un VPS sin secreto. */
    this.ice = { stun: ['stun:stun.l.google.com:19302'], turn: null }
    this.proximaConexion = 1

    for (const pestana of opciones.pestanas ?? []) {
      this.cargarPestanaDirecto(pestana)
    }
    if ((opciones.pestanas ?? []).length > 0) this.inicializada = true
  }

  cargarPestanaDirecto({ titulo, valores = [], oculta = false, columnasOcultas = [] }) {
    const filas = new Map()
    valores.forEach((fila, indice) => {
      const celdas = normalizarFila(fila)
      if (celdas.some((celda) => celda !== '')) filas.set(indice + 1, celdas)
    })
    this.pestanas.push({
      sheetId: this.proximoSheetId++,
      titulo,
      indice: this.pestanas.length,
      columnas: Math.max(26, ...valores.map((fila) => (Array.isArray(fila) ? fila.length : 0))),
      oculta: Boolean(oculta),
      columnasOcultas: [...columnasOcultas],
      filas,
    })
  }

  /**
   * Guarda una foto de las pestañas tal como están. El día sale de la fecha real, igual que el
   * servidor; en una prueba todos caen el mismo día, así que el motivo es lo que los distingue.
   */
  guardarRespaldo(motivo, hechoPor) {
    const dia = new Date().toISOString().slice(0, 10)
    const yaEstaba = this.respaldos.find((r) => r.dia === dia && r.motivo === motivo)
    if (yaEstaba && motivo !== 'ANTES_DE_RESTAURAR') return { respaldo: yaEstaba, yaEstaba: true }
    const foto = this.pestanas.map(copiaProfunda)
    const respaldo = {
      id: yaEstaba ? yaEstaba.id : this.proximoRespaldoId++,
      dia,
      motivo,
      fecha: new Date().toISOString(),
      hechoPor,
      pestanas: foto,
    }
    if (yaEstaba) this.respaldos[this.respaldos.indexOf(yaEstaba)] = respaldo
    else this.respaldos.unshift(respaldo)
    return { respaldo, yaEstaba: false }
  }

  /** La ficha que viaja: cuenta las pestañas y las filas, y no lleva el volcado adentro. */
  fichaDeRespaldo(respaldo) {
    const filas = respaldo.pestanas.reduce((suma, pestana) => suma + pestana.filas.size, 0)
    return {
      id: respaldo.id,
      dia: respaldo.dia,
      motivo: respaldo.motivo,
      fecha: respaldo.fecha,
      tamano: filas * 40,
      pestanas: respaldo.pestanas.length,
      filas,
      hechoPor: respaldo.hechoPor,
    }
  }

  /** Sube la versión de una pestaña y la devuelve, como `marcarPestanaCambiada` del servidor real. */
  marcarCambiada(titulo) {
    const version = (this.versiones.get(titulo) ?? 0) + 1
    this.versiones.set(titulo, version)
    // 14.0: subir una versión es exactamente lo que el canal tiene que contar. Va acá adentro y no en
    // cada manejador porque todos los que escriben terminan pasando por esta línea, y un aviso que
    // hay que acordarse de mandar es un aviso que un día no se manda.
    this.avisarGrilla()
    return version
  }

  /** El mapa `{titulo: version}` de toda la hoja. Una pestaña que nunca se escribió cuenta como 0. */
  mapaDeVersiones() {
    const mapa = {}
    for (const pestana of this.pestanas) mapa[pestana.titulo] = this.versiones.get(pestana.titulo) ?? 0
    return mapa
  }

  /**
   * «El servidor terminó de recalcular una métrica» (13.2): sube su versión y guarda el resultado
   * nuevo, tal como lo haría un cierre de mes real. Es lo que usan las pruebas en vez de esperar a que
   * el simulador sepa calcular el podio de verdad —no hace falta: lo que se prueba acá es que el
   * cliente compara versiones y trae lo que cambió, no la cuenta en sí.
   */
  cargarMetricaDirecto(clave, payload) {
    const anterior = this.metricas.get(clave)
    const version = (anterior?.version ?? 0) + 1
    this.metricas.set(clave, { version, calculadoEn: new Date().toISOString(), payload })
    // La métrica viaja en la misma foto que las pestañas: el cliente compara las dos listas de una.
    this.avisarGrilla()
    return version
  }

  /** El mapa `{clave: version}` de las métricas que el servidor ya calculó alguna vez. */
  mapaDeVersionesDeMetricas() {
    const mapa = {}
    for (const [clave, metrica] of this.metricas) mapa[clave] = metrica.version
    return mapa
  }

  /**
   * La foto que viaja por el canal y que contesta `/novedades`: la generación, la versión de cada
   * pestaña y la de cada métrica. Es lo único que manda el servidor cuando algo cambia —los datos los
   * baja después el cliente, comparando contra lo que ya tiene—, y es lo que las pruebas le pasan a
   * `aplicarFotoDeLaGrilla` cuando quieren el mecanismo sin levantar un socket.
   */
  fotoDeLaGrilla() {
    return {
      generacion: this.generacion,
      versiones: this.mapaDeVersiones(),
      metricasVersiones: this.mapaDeVersionesDeMetricas(),
    }
  }

  /** La hoja se reemplazó entera (restaurar un respaldo, la migración inicial). */
  subirGeneracion() {
    this.generacion += 1
    this.avisarGrilla()
  }

  porTitulo(titulo) {
    return this.pestanas.find((pestana) => pestana.titulo === titulo) ?? null
  }

  porSheetId(sheetId) {
    return this.pestanas.find((pestana) => pestana.sheetId === sheetId) ?? null
  }

  maxNumero(pestana) {
    let maximo = 0
    for (const numero of pestana.filas.keys()) if (numero > maximo) maximo = numero
    return maximo
  }

  valoresDe(titulo, hastaFila) {
    const pestana = this.porTitulo(titulo)
    if (!pestana) return null
    const tope = hastaFila && hastaFila > 0 ? Math.min(this.maxNumero(pestana), hastaFila) : this.maxNumero(pestana)
    const valores = []
    for (let numero = 1; numero <= tope; numero++) valores.push(pestana.filas.get(numero) ?? [])
    return valores
  }

  // --- Renglones identificados por _ID (la misma semántica que el servidor real, 12.6) -------------

  /** La columna del _ID de una pestaña: la que dice quien llama, si no la del encabezado «_ID». */
  columnaIdDe(pestana, pedida) {
    if (Number.isInteger(pedida) && pedida >= 0) return pedida
    for (let numero = 1; numero <= 5; numero++) {
      const fila = pestana.filas.get(numero) ?? []
      const indice = fila.findIndex((celda) => comoTexto(celda).trim().toUpperCase() === '_ID')
      if (indice >= 0) return indice
    }
    return null
  }

  /** El primer renglón que lleva cada _ID. */
  renglonesPorId(pestana, columnaId) {
    const mapa = new Map()
    for (const numero of [...pestana.filas.keys()].sort((a, b) => a - b)) {
      const id = comoTexto((pestana.filas.get(numero) ?? [])[columnaId]).trim()
      if (id && !mapa.has(id)) mapa.set(id, numero)
    }
    return mapa
  }

  /** A qué renglón apunta un {numero, id}: al número si sigue llevando ese _ID, si no al que lo lleva hoy. */
  resolverRenglon(pestana, numero, id, columnaId) {
    if (!id || columnaId === null) return numero
    if (comoTexto((pestana.filas.get(numero) ?? [])[columnaId]).trim() === id) return numero
    return this.renglonesPorId(pestana, columnaId).get(id) ?? null
  }

  /**
   * Escribir una celda y nada más. Aparte de `editarDirecto` porque los manejadores de `/celdas` y de
   * `/tramos` escriben de a muchas y avisan UNA VEZ al final, cuando suben la versión (ver
   * `marcarCambiada`): pasando por `editarDirecto` mandarían un frame por celda.
   */
  ponerCelda(titulo, fila, columna, valor) {
    const pestana = this.porTitulo(titulo)
    if (!pestana) throw new Error(`No existe la pestaña ${titulo}`)
    const celdas = pestana.filas.get(fila) ?? []
    while (celdas.length <= columna) celdas.push('')
    celdas[columna] = comoTexto(valor)
    pestana.filas.set(fila, celdas)
  }

  /** Lo que la celda dice AHORA, para comparar contra el `previo` que manda quien escribe. */
  celdaActual(pestana, fila, columna) {
    return comoTexto((pestana.filas.get(fila) ?? [])[columna]).trim()
  }

  /** «Otra computadora» (o el panel web) cambió una celda directamente en la base. */
  editarDirecto(titulo, fila, columna, valor) {
    this.ponerCelda(titulo, fila, columna, valor)
    // Sin `marcarCambiada` la foto sale igual que antes y el cliente no baja nada: es a propósito. El
    // aviso está para que ninguna escritura quede muda, no para inventar una versión que el servidor
    // real tampoco subiría (quien edita a mano en la base tampoco toca las versiones).
    this.avisarGrilla()
  }

  // -------------------------------------------------------------------------
  // El canal en vivo (14.0)
  // -------------------------------------------------------------------------
  //
  // El mismo puerto y el mismo servidor http que el resto del puente: el `upgrade` de HTTP a WebSocket
  // se atiende a mano y sólo para `/api/dmg/vivo`, que es exactamente lo que hace el hub del VPS
  // (`WebSocketServer({ noServer: true })` + `server.on('upgrade')`). Va así y no con un puerto aparte
  // porque el cliente arma la URL del canal a partir de la del puente —le cambia `http` por `ws` y le
  // pega la ruta— y con dos puertos esa cuenta dejaría de valer y la prueba no probaría lo que el
  // programa hace de verdad.
  //
  // Lo que el simulador NO hace, a propósito: el corte del saludo a los cinco segundos y el latido del
  // servidor cada veinte. Son relojes que en una prueba sólo sirven para que tarde, y lo que sostienen
  // —que una conexión muda se cierre— no es lo que estas pruebas miran.

  /** Engancha el canal al servidor http ya levantado. Lo llama `escuchar()`. */
  engancharElCanal() {
    this.servidorDelCanal = new WebSocketServer({ noServer: true })
    this.servidor.on('upgrade', (pedido, socket, cabeza) => {
      const [ruta] = (pedido.url ?? '').split('?')
      // Cualquier otra ruta se corta a lo bruto, como el hub real: no hay ningún otro WebSocket acá.
      if (ruta !== RUTA_DEL_CANAL) return socket.destroy()
      this.servidorDelCanal.handleUpgrade(pedido, socket, cabeza, (enchufe) => this.atenderElCanal(enchufe))
    })
  }

  /**
   * Una conexión recién abierta. Todavía no cuenta como presente: entra en `conexiones` recién con el
   * `hola`, que es lo que trae quién es. Antes de eso no hay a quién mostrar ni a quién avisarle.
   */
  atenderElCanal(enchufe) {
    const conexion = {
      id: `cx-${this.proximaConexion++}`,
      socket: enchufe,
      actor: null,
      color: null,
      foco: null,
      desde: new Date().toISOString(),
    }
    enchufe.on('message', (crudo) => this.frameDelCanal(conexion, crudo))
    enchufe.on('close', () => {
      const estaba = this.conexiones.delete(conexion.id)
      this.alIrseUnaConexion(conexion)
      if (estaba) this.difundirPresencia()
    })
    // Un socket cortado a lo bruto (ver `cerrarConexionesDe`) emite `error` antes del `close`: sin
    // este oyente, Node lo trata como excepción no atendida y voltea la prueba entera.
    enchufe.on('error', () => undefined)
  }

  frameDelCanal(conexion, crudo) {
    let mensaje = null
    try {
      mensaje = JSON.parse(String(crudo))
    } catch {
      return this.rechazarLaConexion(conexion, 'protocolo', 'El frame no es JSON.')
    }
    if (!mensaje || typeof mensaje.t !== 'string') {
      return this.rechazarLaConexion(conexion, 'protocolo', 'El frame no dice qué es.')
    }

    if (mensaje.t === 'hola') {
      // El token viaja en el saludo y nunca en la URL, igual que en el servidor real: la URL queda
      // escrita en los registros del nginx de la agencia.
      if (mensaje.token !== this.token) {
        return this.rechazarLaConexion(conexion, 'token', 'Token del puente DM Gestión inválido.')
      }
      const clave = String(mensaje.actor?.clave ?? '').trim().toLowerCase()
      if (!clave) return this.rechazarLaConexion(conexion, 'actor', 'Falta quién se conecta.')
      conexion.actor = {
        clave,
        nombre: String(mensaje.actor?.nombre ?? clave),
        rol: String(mensaje.actor?.rol ?? 'EMPLEADO'),
        sucursal: String(mensaje.actor?.sucursal ?? ''),
      }
      conexion.color = this.asegurarPerfil(clave).color
      this.conexiones.set(conexion.id, conexion)
      this.mandarPorElCanal(conexion, {
        t: 'bienvenida',
        conexionId: conexion.id,
        ...this.fotoDeLaGrilla(),
        perfiles: [...this.perfiles.values()],
        presencia: this.presencia(),
        ice: this.ice,
        latidoCadaMs: LATIDO_DEL_CANAL_MS,
      })
      // Después del saludo, no antes: la foto de presencia que sale tiene que traer al que entró.
      this.difundirPresencia()
      return
    }

    if (!conexion.actor) {
      return this.rechazarLaConexion(conexion, 'protocolo', 'El primer frame tiene que ser el saludo.')
    }
    if (mensaje.t === 'latido') return this.mandarPorElCanal(conexion, { t: 'latido' })
    if (mensaje.t === 'foco') {
      conexion.foco = mensaje.foco ?? null
      return this.difundirPresencia()
    }
    if (mensaje.t === 'llamada') {
      this.llamadasDeVoz.push({ de: conexion.actor.clave, evento: mensaje.evento })
      return this.atenderLlamada(conexion, mensaje.evento ?? {})
    }
    return this.rechazarLaConexion(conexion, 'protocolo', `Frame desconocido: ${mensaje.t}.`)
  }

  /** Le dice por qué y cierra, con el mismo código que el hub: 4401 lo que es de quién sos, 4400 la forma. */
  rechazarLaConexion(conexion, codigo, mensaje) {
    this.mandarPorElCanal(conexion, { t: 'error', codigo, mensaje })
    this.conexiones.delete(conexion.id)
    try {
      conexion.socket.close(codigo === 'protocolo' ? 4400 : 4401, codigo)
    } catch {
      // Un socket que ya se había ido. No hay a quién avisarle.
    }
  }

  mandarPorElCanal(conexion, mensaje) {
    try {
      conexion.socket.send(JSON.stringify(mensaje))
    } catch {
      // El otro lado se fue en el medio: lo va a decir el `close`, que es quien lo saca de presencia.
    }
  }

  /**
   * El color de una persona: el primer índice libre de la paleta.
   *
   * Con trece personas o más ya no queda ninguno libre y se reparte el que toque por orden de llegada.
   * El servidor real cae al color MENOS usado; acá alcanza con que no explote, porque la agencia tiene
   * cinco computadoras y lo que las pruebas miran es que dos personas distintas no compartan color.
   */
  asegurarPerfil(clave) {
    const guardado = this.perfiles.get(clave)
    if (guardado) return guardado
    const tomados = new Set([...this.perfiles.values()].map((perfil) => perfil.color))
    let color = this.perfiles.size % COLORES_DE_LA_PALETA
    for (let indice = 0; indice < COLORES_DE_LA_PALETA; indice++) {
      if (!tomados.has(indice)) {
        color = indice
        break
      }
    }
    const perfil = { clave, color, foto: null, version: 1, actualizadoEn: new Date().toISOString() }
    this.perfiles.set(clave, perfil)
    return perfil
  }

  /** Quién está conectado y en qué. Foto completa: con cinco computadoras no valen la pena los deltas. */
  presencia() {
    return [...this.conexiones.values()].map((conexion) => ({
      conexionId: conexion.id,
      clave: conexion.actor.clave,
      nombre: conexion.actor.nombre,
      sucursal: conexion.actor.sucursal,
      color: conexion.color,
      foco: conexion.foco,
      desde: conexion.desde,
    }))
  }

  difundirPresencia() {
    this.difundirPorElCanal({ t: 'presencia', presentes: this.presencia() })
  }

  // -------------------------------------------------------------------------
  // El relay de las llamadas de voz (14.0)
  // -------------------------------------------------------------------------
  //
  // El servidor no escucha ni un segundo de audio: eso va punto a punto entre las dos computadoras. Lo
  // único que hace es lo que ninguna de las dos puede hacer sola —ver los DOS lados—, y de ahí salen
  // las cuatro decisiones que toma: convertir la invitación en un timbre para el destinatario,
  // contestar «ocupado» cuando ya está hablando, cortar cuando nadie atiende, y escribir el renglón que
  // queda en la conversación cuando la llamada termina.
  //
  // Se simula de verdad y no se anota nada más porque el contrato que hay que proteger es justamente
  // ése: si el servidor reenviara `invitar` tal cual en vez de convertirlo en `timbrar`, o nombrara al
  // destinatario de otra manera, el teléfono no sonaría nunca y `npm run typecheck` seguiría en verde.

  /** Le manda un frame a TODAS las computadoras de una persona. Devuelve a cuántas les llegó. */
  mandarleA(clave, mensaje) {
    let llegaron = 0
    for (const conexion of this.conexiones.values()) {
      if (conexion.actor?.clave !== clave) continue
      this.mandarPorElCanal(conexion, mensaje)
      llegaron++
    }
    return llegaron
  }

  /** ¿Está en una llamada? Es lo que contesta «ocupado» sin hacer sonar nada del otro lado. */
  estaEnUnaLlamada(clave) {
    for (const llamada of this.llamadasAbiertas.values()) {
      if (llamada.de === clave || llamada.para === clave) return true
    }
    return false
  }

  pararElTimbreDe(llamada) {
    if (llamada.reloj) clearTimeout(llamada.reloj)
    llamada.reloj = null
  }

  atenderLlamada(conexion, evento) {
    const quien = conexion.actor.clave
    const tipo = String(evento?.tipo ?? '')
    if (tipo === 'invitar') return this.invitarAUnaLlamada(conexion, evento)

    const llamada = this.llamadasAbiertas.get(String(evento?.llamadaId ?? ''))
    // Un id que ya no existe —el otro cortó un instante antes, o es un candidato ICE que llegó tarde—
    // se descarta en silencio: contestar un error sólo serviría para ensuciar la bitácora.
    if (!llamada || (llamada.de !== quien && llamada.para !== quien)) return
    const otro = llamada.de === quien ? llamada.para : llamada.de

    if (tipo === 'aceptar') {
      if (llamada.situacion !== 'timbrando') return
      llamada.situacion = 'en-llamada'
      llamada.hablandoDesde = Date.now()
      this.pararElTimbreDe(llamada)
      return this.mandarleA(otro, { t: 'llamada', evento: { tipo: 'aceptar', llamadaId: llamada.id } })
    }
    if (tipo === 'sdp' || tipo === 'ice') {
      // La señalización pasa TAL CUAL. El servidor no sabe nada de SDP y no tiene por qué aprender.
      return this.mandarleA(otro, { t: 'llamada', evento })
    }
    if (tipo === 'rechazar' || tipo === 'colgar') {
      const motivo = evento?.motivo ?? (tipo === 'rechazar' ? 'rechazada' : 'terminada')
      return this.cerrarLlamada(llamada, motivo, quien)
    }
  }

  /**
   * «Llamá a Beto». La invitación NO se reenvía tal cual: se convierte en `timbrar`, que es lo único
   * que el otro lado sabe atender, y que además lleva el nombre de quien llama (el que invita conoce a
   * quién llama, el que atiende no tiene de dónde sacarlo).
   */
  invitarAUnaLlamada(conexion, evento) {
    const de = conexion.actor
    const llamadaId = String(evento?.llamadaId ?? '')
    const para = String(evento?.para ?? '').trim().toLowerCase()
    const conversacionId = String(evento?.conversacionId ?? '')
    if (!llamadaId || !para) return
    const cortarAlQueLlama = (motivo) =>
      this.mandarPorElCanal(conexion, { t: 'llamada', evento: { tipo: 'rechazar', llamadaId, motivo } })

    const llamada = {
      id: llamadaId,
      de: de.clave,
      deNombre: de.nombre,
      para,
      conversacionId,
      situacion: 'timbrando',
      desde: Date.now(),
      hablandoDesde: null,
      reloj: null,
    }

    // Ocupado: se contesta al instante y no suena nada del otro lado. Del lado del que llamó se
    // escucha el tono corto, como en cualquier teléfono.
    if (this.estaEnUnaLlamada(para) || this.estaEnUnaLlamada(de.clave)) {
      this.mensajeDeLaLlamada(llamada, 'ocupado')
      return cortarAlQueLlama('ocupado')
    }

    const timbres = this.mandarleA(para, {
      t: 'llamada',
      evento: { tipo: 'timbrar', llamadaId, de: { clave: de.clave, nombre: de.nombre }, conversacionId },
    })
    if (timbres === 0) {
      // No tiene ninguna computadora prendida: no hay a quién hacerle sonar el teléfono. La llamada
      // perdida queda igual en la conversación, que es cómo se entera cuando vuelve.
      this.mensajeDeLaLlamada(llamada, 'sin-respuesta')
      return cortarAlQueLlama('sin-respuesta')
    }

    this.llamadasAbiertas.set(llamada.id, llamada)
    llamada.reloj = setTimeout(() => this.cerrarLlamada(llamada, 'sin-respuesta', null), this.timbreDeLlamadaMs)
    llamada.reloj.unref?.()
  }

  /**
   * Se terminó. Se le avisa al que NO cortó (el que cortó ya lo sabe) y queda el renglón en la
   * conversación. `quienCorto` en null es el servidor cortando por su cuenta: ahí se les avisa a los dos.
   */
  cerrarLlamada(llamada, motivo, quienCorto) {
    if (!this.llamadasAbiertas.delete(llamada.id)) return
    this.pararElTimbreDe(llamada)
    // El que todavía no atendió RECHAZA y el que estaba hablando CUELGA: para el servidor es lo mismo,
    // pero del otro lado uno apaga un timbre y el otro corta una conversación.
    const tipo = llamada.situacion === 'timbrando' ? 'rechazar' : 'colgar'
    for (const clave of [llamada.de, llamada.para]) {
      if (clave === quienCorto) continue
      this.mandarleA(clave, { t: 'llamada', evento: { tipo, llamadaId: llamada.id, motivo } })
    }
    this.mensajeDeLaLlamada(llamada, motivo)
  }

  /**
   * El renglón que queda en la conversación cuando la llamada termina («Llamada de voz · 3:12»,
   * «Llamada perdida»).
   *
   * Lo escribe el SERVIDOR y no la pantalla: la duración y el motivo los sabe él, que es el único que
   * vio los dos lados. La computadora que llamó se lo encuentra cuando pide el historial; a la otra le
   * llega como cualquier mensaje, con su acuse pendiente.
   */
  mensajeDeLaLlamada(llamada, motivo) {
    const conversacion = this.conversaciones.get(llamada.conversacionId)
    if (!conversacion) return null
    // Un id de conversación que no es de quien llama no deja nada escrito: el renglón es de la charla
    // de esas dos personas, y el servidor de verdad tampoco escribe en una conversación ajena.
    if (!conversacion.participantes.some((participante) => participante.clave === llamada.de && !participante.salioEn)) {
      return null
    }
    const ahora = new Date().toISOString()
    let cuerpo = 'Llamada perdida'
    if (llamada.hablandoDesde) {
      const segundos = Math.max(0, Math.round((Date.now() - llamada.hablandoDesde) / 1000))
      cuerpo = `Llamada de voz · ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
    } else if (motivo === 'ocupado') {
      cuerpo = 'Llamada no atendida: estaba ocupado'
    }
    const mensaje = {
      id: `llamada-${llamada.id}`,
      conversacionId: conversacion.id,
      tipo: 'LLAMADA',
      orden: this.ordenDeMensajes++,
      autorClave: llamada.de,
      autorNombre: llamada.deNombre,
      cuerpo,
      creadoEn: ahora,
      enviadoEn: ahora,
      eliminadoEn: null,
      eliminadoPor: null,
      adjuntos: [],
    }
    this.mensajes.push(mensaje)
    conversacion.ultimoMensajeEn = ahora
    const destinatarios = []
    for (const participante of conversacion.participantes) {
      if (participante.clave === mensaje.autorClave || participante.salioEn) continue
      this.acuses.set(`${mensaje.id}|${participante.clave}`, { entregadoEn: null, leidoEn: null })
      destinatarios.push(participante.clave)
    }
    this.avisarMensajes(destinatarios)
    return mensaje
  }

  /**
   * Se fue una computadora: sus llamadas se cierran con `desconexion`.
   *
   * El estado de una llamada vive pegado a la CONEXIÓN, no a la persona: la que vuelva va a tener un
   * `conexionId` nuevo y el saludo no dice una palabra de llamadas, así que no hay nada que retomar.
   * Es el hecho del que depende `elCanalVolvio()` en `src/main/vivo/llamadas.ts`.
   */
  alIrseUnaConexion(conexion) {
    const clave = conexion.actor?.clave
    if (!clave) return
    // Le puede quedar otra ventana abierta (la de la sucursal y la del mostrador): ahí no se cierra nada.
    for (const otra of this.conexiones.values()) {
      if (otra.actor?.clave === clave) return
    }
    for (const llamada of [...this.llamadasAbiertas.values()]) {
      if (llamada.de !== clave && llamada.para !== clave) continue
      this.cerrarLlamada(llamada, 'desconexion', clave)
    }
  }

  /** «Algo de la grilla cambió»: la señal, no los datos. El cliente compara y baja lo distinto. */
  avisarGrilla() {
    this.difundirPorElCanal({ t: 'grilla', ...this.fotoDeLaGrilla() })
  }

  /** «Hay algo tuyo en la mensajería», a las computadoras de esas personas. Los datos van por HTTP. */
  avisarMensajes(claves) {
    const aQuienes = new Set(claves.filter(Boolean))
    if (aQuienes.size === 0) return
    for (const conexion of this.conexiones.values()) {
      if (aQuienes.has(conexion.actor.clave)) this.mandarPorElCanal(conexion, { t: 'mensajes' })
    }
  }

  difundirPorElCanal(mensaje) {
    // Sin nadie conectado no hay ni que armar el JSON: la mayoría de las pruebas no abren el canal y
    // pasan por acá en cada escritura.
    if (this.conexiones.size === 0) return
    const texto = JSON.stringify(mensaje)
    for (const conexion of this.conexiones.values()) {
      try {
        conexion.socket.send(texto)
      } catch {
        // Ver `mandarPorElCanal`.
      }
    }
  }

  /**
   * Le corta el canal a una persona, sin saludo de despedida: es la computadora a la que le
   * desenchufaron el cable, no la que cierra sesión. Devuelve cuántas conexiones se cortaron.
   */
  cerrarConexionesDe(clave) {
    let cortadas = 0
    for (const conexion of [...this.conexiones.values()]) {
      if (conexion.actor.clave !== clave) continue
      this.conexiones.delete(conexion.id)
      // Antes del `terminate`: el `close` llega un rato después y la prueba que corta el cable quiere
      // ver el `colgar {desconexion}` del otro lado ya mismo, que es lo que hace el hub de verdad.
      this.alIrseUnaConexion(conexion)
      conexion.socket.terminate()
      cortadas++
    }
    if (cortadas > 0) this.difundirPresencia()
    return cortadas
  }

  async escuchar(puerto = 0) {
    this.servidor = createServer((pedido, respuesta) => {
      const trozos = []
      pedido.on('data', (trozo) => trozos.push(trozo))
      pedido.on('end', () => {
        if (this.colgar) return
        const crudo = Buffer.concat(trozos)
        const [ruta, consulta] = (pedido.url ?? '').split('?')
        this.intercambios.push({ metodo: pedido.method, ruta, autorizacion: pedido.headers.authorization ?? null })
        const responder = (estado, datos) => {
          respuesta.writeHead(estado, { 'content-type': 'application/json' })
          respuesta.end(JSON.stringify(datos))
        }
        // Los adjuntos van crudos (octet-stream), como en el servidor real: nada de JSON.parse acá.
        const esCrudo = (pedido.headers['content-type'] ?? '').startsWith('application/octet-stream')
        let json = {}
        if (!esCrudo && crudo.length > 0) {
          try {
            json = JSON.parse(crudo.toString('utf8'))
          } catch (error) {
            return responder(400, { error: `El cuerpo del pedido no se pudo leer: ${error.message}` })
          }
        }

        if (this.errorFijo) return responder(this.errorFijo.estado, { error: this.errorFijo.mensaje })
        const falla = this.fallasIniciales.shift()
        if (falla) return responder(falla.estado, { error: falla.mensaje })

        const autorizacion = pedido.headers.authorization ?? ''
        if (autorizacion !== `Bearer ${this.token}`) {
          return responder(401, { error: 'Token del puente DM Gestión inválido.' })
        }

        try {
          if (ruta.startsWith('/api/dmg/adjuntos')) return this.atenderAdjuntos(pedido, respuesta, ruta, crudo, responder)
          if (ruta.startsWith('/api/dmg/mensajes'))
            return this.atenderMensajes(pedido.method ?? 'GET', ruta, json, responder, new URLSearchParams(consulta ?? ''))
          if (ruta.startsWith('/api/dmg/perfiles'))
            return this.atenderPerfiles(pedido.method ?? 'GET', ruta, json, responder, new URLSearchParams(consulta ?? ''))
          return this.atender(pedido.method ?? 'GET', ruta ?? '', json, responder, new URLSearchParams(consulta ?? ''))
        } catch (error) {
          return responder(500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    })
    // El canal se engancha ANTES de escuchar: el `upgrade` tiene que estar puesto para el primer
    // pedido, no para el segundo.
    this.engancharElCanal()
    await new Promise((resolver) => this.servidor.listen(puerto, '127.0.0.1', resolver))
    const direccion = this.servidor.address()
    this.url = `http://127.0.0.1:${direccion.port}`
    return this.url
  }

  exigirInicializada(responder) {
    if (this.inicializada) return true
    responder(409, {
      error:
        'La base del GENERAL DE CLIENTES del VPS todavía no está inicializada. Hacé la migración desde DM Gestión (Administración → Base de datos).',
    })
    return false
  }

  /**
   * Los adjuntos (12.6): `PUT /api/dmg/adjuntos/:id` con el archivo crudo y los datos en encabezados
   * `x-dmg-*`, `GET` lo devuelve, `GET .../estado` la ficha, `DELETE` lo saca. Todo en memoria.
   */
  atenderAdjuntos(pedido, respuesta, ruta, crudo, responder) {
    const metodo = pedido.method ?? 'GET'
    const partes = /^\/api\/dmg\/adjuntos(?:\/([0-9a-f]{32}|[0-9a-f-]{36}))?(\/estado)?$/.exec(ruta)
    if (!partes) return responder(400, { error: 'El id del adjunto no es válido.' })
    const id = partes[1]
    const leer = (clave) => {
      const valor = pedido.headers[clave]
      if (typeof valor !== 'string' || !valor) return null
      try {
        return decodeURIComponent(valor)
      } catch {
        return valor
      }
    }
    if (metodo === 'GET' && !id) {
      return responder(200, { adjuntos: [...this.adjuntos.values()].map((a) => a.ficha) })
    }
    if (!id) return responder(404, { error: `Ruta desconocida: ${metodo} ${ruta}` })
    if (metodo === 'PUT') {
      this.llamadas.adjuntosSubidos = (this.llamadas.adjuntosSubidos ?? 0) + 1
      if (crudo.length === 0) return responder(400, { error: 'El adjunto llegó vacío.' })
      if (crudo.length > this.topeDeAdjunto) return responder(413, { error: `El archivo supera el máximo que acepta el servidor (${Math.floor(this.topeDeAdjunto / (1024 * 1024))} MB).` })
      const sha256 = createHash('sha256').update(crudo).digest('hex')
      const esperado = (leer('x-dmg-sha256') ?? '').toLowerCase()
      if (esperado && esperado !== sha256) return responder(400, { error: 'El adjunto llegó dañado: el contenido no coincide con lo que la aplicación calculó.' })
      const previo = this.adjuntos.get(id)
      if (previo) {
        if (previo.ficha.sha256 !== sha256) return responder(409, { error: 'Ya hay un adjunto con ese id y otro contenido: un adjunto no se reescribe.' })
        return responder(200, { ...previo.ficha, yaEstaba: true })
      }
      const ficha = {
        id,
        nombre: leer('x-dmg-nombre') ?? 'archivo',
        tipo: leer('x-dmg-tipo') ?? 'application/octet-stream',
        tamano: crudo.length,
        sha256,
        grupo: leer('x-dmg-grupo') ?? 'sin-grupo',
        subidoPor: leer('x-dmg-subido-por'),
        creadoEn: new Date().toISOString(),
      }
      this.adjuntos.set(id, { ficha, contenido: Buffer.from(crudo) })
      return responder(201, { ...ficha, yaEstaba: false })
    }
    const guardado = this.adjuntos.get(id)
    if (metodo === 'GET' && partes[2]) {
      return responder(200, guardado ? { existe: true, ficha: guardado.ficha, enDisco: true } : { existe: false, ficha: null, enDisco: false })
    }
    if (metodo === 'GET') {
      this.llamadas.adjuntosBajados = (this.llamadas.adjuntosBajados ?? 0) + 1
      if (!guardado) return responder(404, { error: 'Ese adjunto no existe.' })
      respuesta.writeHead(200, {
        'content-type': guardado.ficha.tipo,
        'content-length': String(guardado.contenido.length),
        'x-dmg-sha256': guardado.ficha.sha256,
        'x-dmg-nombre': encodeURIComponent(guardado.ficha.nombre),
      })
      return respuesta.end(guardado.contenido)
    }
    if (metodo === 'DELETE') {
      return responder(200, { borrado: this.adjuntos.delete(id) })
    }
    return responder(404, { error: `Ruta desconocida: ${metodo} ${ruta}` })
  }

  // -------------------------------------------------------------------------
  // Mensajería interna (12.8)
  // -------------------------------------------------------------------------
  //
  // Replica la semántica del servidor real, que es lo que hace que la prueba de dos computadoras
  // signifique algo: el id lo elige el cliente y reenviar no duplica, la conversación directa es única
  // por par, y cada mensaje deja un acuse por destinatario que es a la vez la cola de reparto.
  //
  // La única diferencia a propósito: `novedades` NO espera. En el servidor de verdad el pedido se
  // queda abierto hasta veinticinco segundos; acá contesta al instante, porque una prueba que espera
  // veinticinco segundos por vuelta no la corre nadie.

  claveDirectaDe(una, otra) {
    return [una, otra].sort().join('|')
  }

  actorDelPedido(json, busqueda) {
    const actor = json?.actor ?? {}
    const clave = String(actor.clave ?? busqueda.get('actorClave') ?? '').trim().toLowerCase()
    const nombre = String(actor.nombre ?? busqueda.get('actorNombre') ?? clave)
    const rol = String(actor.rol ?? busqueda.get('actorRol') ?? 'EMPLEADO')
    return { clave, nombre, rol }
  }

  conversacionParaLaApp(conversacion) {
    return {
      id: conversacion.id,
      tipo: conversacion.tipo,
      titulo: conversacion.titulo,
      participantes: conversacion.participantes.map((participante) => ({ ...participante })),
      creadoPor: conversacion.creadoPor,
      creadoEn: conversacion.creadoEn,
      ultimoMensajeEn: conversacion.ultimoMensajeEn,
    }
  }

  acusesDe(mensajeId) {
    const salida = []
    for (const [clave, acuse] of this.acuses) {
      if (!clave.startsWith(`${mensajeId}|`)) continue
      salida.push({
        mensajeId,
        usuarioClave: clave.slice(mensajeId.length + 1),
        entregadoEn: acuse.entregadoEn,
        leidoEn: acuse.leidoEn,
      })
    }
    return salida
  }

  mensajeParaLaApp(mensaje, conCuerpoBorrado = false) {
    const borrado = Boolean(mensaje.eliminadoEn) && !conCuerpoBorrado
    return {
      id: mensaje.id,
      conversacionId: mensaje.conversacionId,
      tipo: mensaje.tipo ?? 'NORMAL',
      orden: mensaje.orden,
      autorClave: mensaje.autorClave,
      autorNombre: mensaje.autorNombre,
      cuerpo: borrado ? '' : mensaje.cuerpo,
      creadoEn: mensaje.creadoEn,
      enviadoEn: mensaje.enviadoEn,
      eliminadoEn: mensaje.eliminadoEn,
      adjuntos: borrado ? [] : mensaje.adjuntos.map((adjunto) => ({ ...adjunto })),
      acuses: this.acusesDe(mensaje.id),
      // La lista COMPLETA, no el cambio (14.0): el espejo de cada computadora reemplaza lo que tenía.
      reacciones: this.reaccionesDe(mensaje.id),
    }
  }

  /** Las reacciones de un mensaje, agrupadas por emoji y en el orden en que se pusieron. */
  reaccionesDe(mensajeId) {
    const porEmoji = new Map()
    for (const [clave, emoji] of this.reacciones.get(mensajeId) ?? new Map()) {
      if (!porEmoji.has(emoji)) porEmoji.set(emoji, [])
      porEmoji.get(emoji).push(clave)
    }
    return [...porEmoji].map(([emoji, claves]) => ({ emoji, claves }))
  }

  conversacionesDe(clave) {
    return [...this.conversaciones.values()].filter((conversacion) =>
      conversacion.participantes.some((participante) => participante.clave === clave && !participante.salioEn),
    )
  }

  atenderMensajes(metodo, ruta, json, responder, busqueda) {
    const actor = this.actorDelPedido(json, busqueda)
    if (!actor.clave) return responder(400, { error: 'Falta quién manda el pedido (usuario y rol).' })
    const ahora = new Date().toISOString()

    if (metodo === 'GET' && ruta === '/api/dmg/mensajes/conversaciones') {
      this.llamadas.mensajesConversaciones++
      return responder(200, { conversaciones: this.conversacionesDe(actor.clave).map((c) => this.conversacionParaLaApp(c)) })
    }

    if (metodo === 'POST' && ruta === '/api/dmg/mensajes/conversaciones/directa') {
      const destino = String(json?.clave ?? '').trim().toLowerCase()
      if (!destino) return responder(400, { error: 'Falta a quién le querés escribir.' })
      if (destino === actor.clave) return responder(400, { error: 'No se puede abrir una conversación con uno mismo.' })
      const claveDirecta = this.claveDirectaDe(actor.clave, destino)
      const yaEsta = [...this.conversaciones.values()].find((c) => c.claveDirecta === claveDirecta)
      if (yaEsta) return responder(200, { conversacion: this.conversacionParaLaApp(yaEsta) })
      const conversacion = {
        id: String(json?.id ?? `sim-${this.conversaciones.size + 1}`),
        tipo: 'DIRECTA',
        titulo: null,
        claveDirecta,
        creadoPor: actor.clave,
        creadoEn: ahora,
        ultimoMensajeEn: null,
        participantes: [
          { clave: actor.clave, nombre: actor.nombre, salioEn: null },
          { clave: destino, nombre: String(json?.nombre ?? destino), salioEn: null },
        ],
      }
      this.conversaciones.set(conversacion.id, conversacion)
      // Del otro lado la conversación aparece sola: hasta la 13.x había que esperar la vuelta del
      // cartero, que era un long-poll de veinticinco segundos.
      this.avisarMensajes([destino])
      return responder(200, { conversacion: this.conversacionParaLaApp(conversacion) })
    }

    if (metodo === 'POST' && ruta === '/api/dmg/mensajes/conversaciones/grupo') {
      const titulo = String(json?.titulo ?? '').trim()
      if (!titulo) return responder(400, { error: 'El grupo necesita un nombre.' })
      const porClave = new Map([[actor.clave, actor.nombre]])
      for (const participante of json?.participantes ?? []) {
        const clave = String(participante?.clave ?? '').trim().toLowerCase()
        if (clave) porClave.set(clave, String(participante?.nombre ?? clave))
      }
      if (porClave.size < 2) return responder(400, { error: 'Un grupo necesita al menos otra persona.' })
      const conversacion = {
        id: String(json?.id ?? `sim-grupo-${this.conversaciones.size + 1}`),
        tipo: 'GRUPO',
        titulo,
        claveDirecta: null,
        creadoPor: actor.clave,
        creadoEn: ahora,
        ultimoMensajeEn: null,
        participantes: [...porClave].map(([clave, nombre]) => ({ clave, nombre, salioEn: null })),
      }
      this.conversaciones.set(conversacion.id, conversacion)
      this.avisarMensajes(conversacion.participantes.map((p) => p.clave).filter((clave) => clave !== actor.clave))
      return responder(200, { conversacion: this.conversacionParaLaApp(conversacion) })
    }

    if (metodo === 'POST' && ruta === '/api/dmg/mensajes') {
      this.llamadas.mensajesEnviados++
      const id = String(json?.id ?? '')
      const yaEsta = this.mensajes.find((mensaje) => mensaje.id === id)
      // Idempotencia por id: reintentar un envío cortado devuelve el que ya está.
      if (yaEsta) return responder(200, { mensaje: this.mensajeParaLaApp(yaEsta), yaEstaba: true })

      const conversacion = this.conversaciones.get(String(json?.conversacionId ?? ''))
      if (!conversacion) return responder(400, { error: 'El id de la conversación no es válido.' })
      if (!conversacion.participantes.some((p) => p.clave === actor.clave && !p.salioEn)) {
        return responder(403, { error: 'No participás de esa conversación.' })
      }
      // El zumbido: no lleva texto ni archivos, y tiene su propio freno. Es el mismo trato que le da
      // el servidor de verdad (`mensajes.service.ts`), porque la prueba tiene que fallar acá si un día
      // el cliente manda un zumbido con texto o dos seguidos.
      const tipo = json?.tipo === 'ZUMBIDO' ? 'ZUMBIDO' : 'NORMAL'
      const cuerpo = tipo === 'ZUMBIDO' ? '' : String(json?.cuerpo ?? '')
      const adjuntos = tipo === 'ZUMBIDO' ? [] : Array.isArray(json?.adjuntos) ? json.adjuntos : []
      if (tipo === 'NORMAL' && !cuerpo && adjuntos.length === 0) {
        return responder(400, { error: 'El mensaje está vacío.' })
      }
      if (tipo === 'ZUMBIDO') {
        const ultimo = [...this.mensajes]
          .reverse()
          .find((cada) => cada.conversacionId === conversacion.id && cada.autorClave === actor.clave && cada.tipo === 'ZUMBIDO')
        if (ultimo) {
          const faltan = this.esperaEntreZumbidosMs - (Date.now() - new Date(ultimo.creadoEn).getTime())
          if (faltan > 0) {
            return responder(429, { error: `Esperá ${Math.ceil(faltan / 1000)} segundos para mandar otro zumbido.` })
          }
        }
      }

      const mensaje = {
        id,
        conversacionId: conversacion.id,
        tipo,
        orden: this.ordenDeMensajes++,
        autorClave: actor.clave,
        autorNombre: actor.nombre,
        cuerpo,
        creadoEn: ahora,
        enviadoEn: json?.enviadoEn ?? null,
        eliminadoEn: null,
        eliminadoPor: null,
        adjuntos: adjuntos.map((adjunto) => ({
          id: String(adjunto.id),
          nombre: String(adjunto.nombre ?? 'archivo'),
          tipo: String(adjunto.tipo ?? 'application/octet-stream'),
          tamano: Number(adjunto.tamano ?? 0),
          sha256: String(adjunto.sha256 ?? ''),
          ancho: adjunto.ancho ?? null,
          alto: adjunto.alto ?? null,
          duracion: adjunto.duracion ?? null,
          miniatura: adjunto.miniatura ?? null,
        })),
      }
      this.mensajes.push(mensaje)
      conversacion.ultimoMensajeEn = ahora
      // Un acuse pendiente por cada destinatario: es la cola de reparto.
      const destinatarios = []
      for (const participante of conversacion.participantes) {
        if (participante.clave === actor.clave || participante.salioEn) continue
        this.acuses.set(`${mensaje.id}|${participante.clave}`, { entregadoEn: null, leidoEn: null })
        destinatarios.push(participante.clave)
      }
      // El aviso no lleva el mensaje: dice «hay algo tuyo» y el cartero lo pide por HTTP como siempre.
      this.avisarMensajes(destinatarios)
      return responder(201, { mensaje: this.mensajeParaLaApp(mensaje), yaEstaba: false })
    }

    if (metodo === 'GET' && ruta === '/api/dmg/mensajes/novedades') {
      this.llamadas.mensajesNovedades++
      const pendientes = []
      for (const mensaje of this.mensajes) {
        const acuse = this.acuses.get(`${mensaje.id}|${actor.clave}`)
        if (acuse && !acuse.entregadoEn) pendientes.push(this.mensajeParaLaApp(mensaje))
      }
      const desde = busqueda.get('desdeAcuses')
      const limite = desde ? new Date(desde).getTime() - 5_000 : 0
      const acuses = []
      for (const mensaje of this.mensajes) {
        if (mensaje.autorClave !== actor.clave) continue
        for (const acuse of this.acusesDe(mensaje.id)) {
          const cuando = acuse.leidoEn ?? acuse.entregadoEn
          if (!cuando || new Date(cuando).getTime() >= limite) acuses.push(acuse)
        }
      }
      return responder(200, {
        mensajes: pendientes,
        acuses,
        conversaciones: this.conversacionesDe(actor.clave).map((c) => this.conversacionParaLaApp(c)),
        cursorAcuses: ahora,
      })
    }

    if (metodo === 'POST' && (ruta === '/api/dmg/mensajes/entregados' || ruta === '/api/dmg/mensajes/leidos')) {
      const leidos = ruta.endsWith('leidos')
      if (leidos) this.llamadas.mensajesLeidos++
      else this.llamadas.mensajesEntregados++
      let marcados = 0
      /** A quién le cambió un tilde: al que escribió el mensaje, no al que acusa. */
      const autores = new Set()
      for (const id of json?.ids ?? []) {
        const acuse = this.acuses.get(`${id}|${actor.clave}`)
        if (!acuse) continue
        // Acusar dos veces no corre la hora: el «entregado a las 9:04» sigue diciendo 9:04.
        if (!acuse.entregadoEn) acuse.entregadoEn = ahora
        if (leidos && !acuse.leidoEn) {
          acuse.leidoEn = ahora
          marcados++
        } else if (!leidos) {
          marcados++
        }
        const mensaje = this.mensajes.find((cada) => cada.id === id)
        if (mensaje) autores.add(mensaje.autorClave)
      }
      this.avisarMensajes([...autores])
      return responder(200, { marcados })
    }

    if (metodo === 'GET' && ruta === '/api/dmg/mensajes/historial') {
      const conversacionId = busqueda.get('conversacion') ?? ''
      const conversacion = this.conversaciones.get(conversacionId)
      if (!conversacion) return responder(400, { error: 'El id de la conversación no es válido.' })
      if (!conversacion.participantes.some((p) => p.clave === actor.clave && !p.salioEn)) {
        return responder(403, { error: 'No participás de esa conversación.' })
      }
      const mensajes = this.mensajes
        .filter((mensaje) => mensaje.conversacionId === conversacionId)
        .map((mensaje) => this.mensajeParaLaApp(mensaje))
      return responder(200, { mensajes, hayMas: false })
    }

    if (metodo === 'GET' && ruta === '/api/dmg/mensajes/log') {
      this.llamadas.mensajesRegistro++
      if (actor.rol !== 'SUPER_ADMIN') {
        return responder(403, { error: 'El log de mensajes es sólo del superadministrador.' })
      }
      const texto = (busqueda.get('texto') ?? '').toLowerCase()
      const usuario = (busqueda.get('usuario') ?? '').toLowerCase()
      const renglones = this.mensajes
        .filter((mensaje) => {
          if (texto && !mensaje.cuerpo.toLowerCase().includes(texto)) return false
          if (!usuario) return true
          if (mensaje.autorClave === usuario) return true
          const conversacion = this.conversaciones.get(mensaje.conversacionId)
          return Boolean(conversacion?.participantes.some((p) => p.clave === usuario))
        })
        .map((mensaje) => {
          const conversacion = this.conversaciones.get(mensaje.conversacionId)
          return {
            // `true`: el registro muestra el cuerpo original aunque el mensaje esté borrado.
            mensaje: this.mensajeParaLaApp(mensaje, true),
            conversacion: {
              id: conversacion.id,
              tipo: conversacion.tipo,
              titulo: conversacion.titulo,
              participantes: conversacion.participantes.map((p) => ({ clave: p.clave, nombre: p.nombre })),
            },
            eliminadoPor: mensaje.eliminadoPor,
          }
        })
        .reverse()
      return responder(200, { renglones, total: renglones.length, pagina: 1, porPagina: 100 })
    }

    // Poner, cambiar o sacar MI reacción (14.0). Es un interruptor: el mismo emoji dos veces lo saca,
    // otro emoji reemplaza al que había. Una persona reacciona UNA vez a cada mensaje.
    //
    // Contesta la lista COMPLETA del mensaje y no el cambio, por lo mismo que el servidor de verdad:
    // dos personas reaccionando en el mismo instante no pueden dejar a nadie con la cuenta a medias.
    const reaccion = /^\/api\/dmg\/mensajes\/([^/]+)\/reaccion$/.exec(ruta)
    if (metodo === 'PUT' && reaccion) {
      this.llamadas.mensajesReaccionados = (this.llamadas.mensajesReaccionados ?? 0) + 1
      const mensaje = this.mensajes.find((cada) => cada.id === decodeURIComponent(reaccion[1]))
      if (!mensaje) return responder(404, { error: 'Ese mensaje no existe.' })
      if (mensaje.eliminadoEn) return responder(409, { error: 'Ese mensaje se borró: ya no se le puede reaccionar.' })
      const conversacion = this.conversaciones.get(mensaje.conversacionId)
      if (!conversacion?.participantes.some((p) => p.clave === actor.clave && !p.salioEn)) {
        return responder(403, { error: 'No participás de esa conversación.' })
      }
      const puestas = this.reacciones.get(mensaje.id) ?? new Map()
      const pedido = json?.emoji
      const emoji = typeof pedido === 'string' && pedido.trim() ? pedido.trim() : null
      if (!emoji || puestas.get(actor.clave) === emoji) puestas.delete(actor.clave)
      else puestas.set(actor.clave, emoji)
      this.reacciones.set(mensaje.id, puestas)

      const reacciones = this.reaccionesDe(mensaje.id)
      // Y se difunde por el canal a los participantes: del otro lado la pastilla aparece sola, sin que
      // nadie pregunte. Al que reaccionó no se le manda: ya tiene la respuesta del PUT en la mano.
      for (const participante of conversacion.participantes) {
        if (participante.clave === actor.clave || participante.salioEn) continue
        this.mandarleA(participante.clave, { t: 'reaccion', mensajeId: mensaje.id, conversacionId: conversacion.id, reacciones })
      }
      return responder(200, { mensajeId: mensaje.id, conversacionId: conversacion.id, reacciones })
    }

    const borrado = /^\/api\/dmg\/mensajes\/([^/]+)\/eliminar$/.exec(ruta)
    if (metodo === 'POST' && borrado) {
      const mensaje = this.mensajes.find((cada) => cada.id === borrado[1])
      if (!mensaje) return responder(404, { error: 'Ese mensaje no existe.' })
      if (mensaje.autorClave !== actor.clave && actor.rol !== 'SUPER_ADMIN') {
        return responder(403, { error: 'Sólo se puede borrar un mensaje propio.' })
      }
      mensaje.eliminadoEn = mensaje.eliminadoEn ?? ahora
      mensaje.eliminadoPor = mensaje.eliminadoPor ?? actor.clave
      const conversacion = this.conversaciones.get(mensaje.conversacionId)
      this.avisarMensajes((conversacion?.participantes ?? []).map((p) => p.clave).filter((clave) => clave !== actor.clave))
      return responder(200, { eliminado: true })
    }

    return responder(404, { error: `El simulador no atiende ${metodo} ${ruta}.` })
  }

  /**
   * Los perfiles de la agencia (14.0): la foto y el color de cada persona.
   *
   * `PUT /perfiles/mio` cambia el propio y `PUT /perfiles/:clave` el de otro (sólo administradores).
   * El color es ÚNICO: es lo que hace que el anillo de una celda diga quién está sin tener que leer un
   * nombre, así que pedir uno tomado se contesta con 409 y el texto que la pantalla muestra tal cual.
   */
  atenderPerfiles(metodo, ruta, json, responder, busqueda) {
    const actor = this.actorDelPedido(json, busqueda)
    if (!actor.clave) return responder(400, { error: 'Falta quién manda el pedido (usuario y rol).' })

    if (metodo === 'GET' && ruta === '/api/dmg/perfiles') {
      this.llamadas.perfilesLeidos = (this.llamadas.perfilesLeidos ?? 0) + 1
      return responder(200, { perfiles: [...this.perfiles.values()] })
    }

    const guardado = /^\/api\/dmg\/perfiles\/(.+)$/.exec(ruta)
    if (metodo !== 'PUT' || !guardado) return responder(404, { error: `El simulador no atiende ${metodo} ${ruta}.` })

    const pedazo = decodeURIComponent(guardado[1])
    const deQuien = pedazo === 'mio' ? actor.clave : pedazo.trim().toLowerCase()
    if (deQuien !== actor.clave && actor.rol !== 'ADMIN' && actor.rol !== 'SUPER_ADMIN') {
      return responder(403, { error: 'El perfil de otra persona lo cambia un administrador.' })
    }
    this.llamadas.perfilesGuardados = (this.llamadas.perfilesGuardados ?? 0) + 1

    const perfil = this.asegurarPerfil(deQuien)
    if (json?.color !== undefined) {
      const color = Number(json.color)
      if (!Number.isInteger(color) || color < 0 || color >= COLORES_DE_LA_PALETA) {
        return responder(400, { error: 'Ese color no existe en la paleta.' })
      }
      const tomado = [...this.perfiles.values()].find((cada) => cada.color === color && cada.clave !== deQuien)
      if (tomado) return responder(409, { error: `Ese color ya lo está usando ${tomado.clave}.` })
      perfil.color = color
    }
    if (json?.foto !== undefined) perfil.foto = json.foto === null ? null : String(json.foto)
    perfil.version++
    perfil.actualizadoEn = new Date().toISOString()

    // A las cinco computadoras, la que pidió el cambio incluida: la cara nueva aparece en todas sin que
    // nadie pregunte, y el que la cambió no depende de su propia respuesta para verla.
    this.difundirPorElCanal({ t: 'perfil', perfil: { ...perfil } })
    return responder(200, { perfil: { ...perfil } })
  }

  atender(metodo, ruta, json, responder, busqueda = new URLSearchParams()) {
    if (metodo === 'GET' && ruta === '/api/dmg/estado') {
      this.llamadas.estado++
      let filas = 0
      for (const pestana of this.pestanas) filas += pestana.filas.size
      return responder(200, {
        inicializada: this.inicializada,
        inicializada_en: this.inicializada ? '2026-08-28T00:00:00.000Z' : null,
        pestanas: this.pestanas.length,
        filas,
      })
    }
    if (metodo === 'GET' && ruta === '/api/dmg/estructura') {
      this.llamadas.estructura++
      if (!this.exigirInicializada(responder)) return
      return responder(200, {
        titulo: 'GENERAL DE CLIENTES (base del VPS)',
        pestanas: this.pestanas
          .slice()
          .sort((a, b) => a.indice - b.indice)
          .map((pestana) => ({
            sheetId: pestana.sheetId,
            titulo: pestana.titulo,
            indice: pestana.indice,
            filas: this.maxNumero(pestana),
            columnas: pestana.columnas,
            oculta: pestana.oculta,
            columnasOcultas: [...pestana.columnasOcultas],
          })),
      })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/leer') {
      this.llamadas.leer++
      if (!this.exigirInicializada(responder)) return
      const titulos = Array.isArray(json.titulos) ? json.titulos : []
      // Qué pestañas se bajaron ENTERAS, para poder afirmar que una bajada acotada bajó sólo las que
      // cambiaron y no la hoja entera. Contar llamadas no alcanza y mirar todos los títulos tampoco:
      // el contexto lee los encabezados de todas las pestañas (con `hastaFila`) y eso es barato y
      // pasa igual; lo que importa es qué pestaña se trajo con sus miles de renglones.
      if (json.hastaFila === undefined || json.hastaFila === null) this.pestanasLeidas.push(...titulos.map(String))
      if (titulos.length === 0) return responder(400, { error: 'Indicá qué pestañas leer.' })
      const pestanas = []
      for (const titulo of titulos) {
        const valores = this.valoresDe(String(titulo), json.hastaFila)
        if (valores === null) return responder(400, { error: `La pestaña "${titulo}" no existe en la hoja del VPS.` })
        pestanas.push({ titulo, valores })
      }
      return responder(200, { pestanas })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/novedades') {
      this.llamadas.novedades++
      // NO espera, a diferencia del servidor real (ver el comentario de arriba): con `espera` en lo
      // que sea, contesta al instante con el estado de ahora.
      const conocidas = json.versiones && typeof json.versiones === 'object' && !Array.isArray(json.versiones) ? json.versiones : {}
      const versiones = this.mapaDeVersiones()
      const cambiaron = Object.keys(versiones).filter((titulo) => conocidas[titulo] !== versiones[titulo])
      // metricasVersiones (13.2): igual que `versiones`, siempre el mapa entero de lo que el servidor
      // sabe; el cliente es quien compara contra lo que ya tiene guardado (ver sincronizacion/vigia.ts).
      return responder(200, { generacion: this.generacion, versiones, cambiaron, metricasVersiones: this.mapaDeVersionesDeMetricas() })
    }
    const metrica = /^\/api\/dmg\/metricas\/([^/]+)$/.exec(ruta)
    if (metodo === 'GET' && metrica) {
      this.llamadas.metricasLeidas++
      const guardada = this.metricas.get(decodeURIComponent(metrica[1]))
      if (!guardada) return responder(200, { disponible: false })
      return responder(200, { disponible: true, version: guardada.version, calculadoEn: guardada.calculadoEn, payload: guardada.payload })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/celdas') {
      this.llamadas.celdas++
      if (!this.exigirInicializada(responder)) return
      const columnaIdPorTitulo = json.columnaId && typeof json.columnaId === 'object' ? json.columnaId : {}
      const noEncontradas = []
      /**
       * Las celdas que llegaron con `previo` y ya decían otra cosa (14.0): no se escriben y vuelven
       * con lo que la base tiene hoy. Es «gana la base»: hasta la 13.x la escritura entraba igual y
       * pisaba el trabajo de la otra computadora, que se enteraba dos días después mirando el
       * historial. Un cliente viejo que no manda `previo` sigue escribiendo como siempre, que es lo
       * que sostiene el despliegue por partes.
       */
      const rechazadas = []
      const tocadas = new Set()
      let escritas = 0
      for (const celda of json.celdas ?? []) {
        const pestana = this.porTitulo(String(celda.titulo))
        if (!pestana) return responder(400, { error: `La pestaña "${celda.titulo}" no existe en la hoja del VPS.` })
        let fila = Number(celda.fila)
        const id = typeof celda.id === 'string' ? celda.id.trim() : ''
        if (id) {
          // Con _ID: se resuelve contra la pestaña tal como está, y si ya no está NO se crea un renglón.
          const resuelto = this.resolverRenglon(pestana, fila, id, this.columnaIdDe(pestana, columnaIdPorTitulo[pestana.titulo]))
          if (resuelto === null) {
            if (!noEncontradas.some((n) => n.titulo === pestana.titulo && n.id === id)) noEncontradas.push({ titulo: pestana.titulo, id })
            continue
          }
          fila = resuelto
        }
        if (celda.previo !== undefined && celda.previo !== null) {
          const actual = this.celdaActual(pestana, fila, Number(celda.columna))
          if (actual !== comoTexto(celda.previo).trim()) {
            rechazadas.push({ titulo: pestana.titulo, id, columna: Number(celda.columna), actual })
            continue
          }
        }
        this.ponerCelda(pestana.titulo, fila, celda.columna, celda.valor)
        if (celda.columna + 1 > pestana.columnas) pestana.columnas = celda.columna + 1
        escritas++
        tocadas.add(pestana.titulo)
      }
      // `marcarCambiada` es también lo que dispara el aviso del canal: si todas las celdas quedaron
      // rechazadas no se tocó nada y no hay nada que contarle a nadie.
      const versiones = {}
      for (const titulo of tocadas) versiones[titulo] = this.marcarCambiada(titulo)
      return responder(200, { escritas, noEncontradas, rechazadas, versiones })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/filas/agregar') {
      this.llamadas.agregar++
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porTitulo(String(json.titulo))
      if (!pestana) return responder(400, { error: `La pestaña "${json.titulo}" no existe en la hoja del VPS.` })
      const filas = Array.isArray(json.filas) ? json.filas : []
      if (filas.length === 0) return responder(400, { error: 'No hay filas para agregar.' })
      const primeraFila = this.maxNumero(pestana) + 1
      // Como el servidor real: la fila cuyo _ID ya está en la pestaña (o repetido en la tanda) no entra,
      // y la respuesta dice en qué renglón quedó cada una (null para la que se dejó afuera).
      const columnaId = this.columnaIdDe(pestana, null)
      const vistos = columnaId === null ? new Set() : new Set(this.renglonesPorId(pestana, columnaId).keys())
      const numeros = []
      let siguiente = primeraFila
      let repetidas = 0
      for (const fila of filas) {
        const celdas = normalizarFila(fila)
        const id = columnaId === null ? '' : comoTexto(celdas[columnaId]).trim()
        if (id && vistos.has(id)) {
          numeros.push(null)
          repetidas++
          continue
        }
        if (id) vistos.add(id)
        pestana.filas.set(siguiente, celdas)
        numeros.push(siguiente)
        siguiente++
      }
      const agregadas = siguiente - primeraFila
      return responder(200, {
        primeraFila,
        agregadas,
        repetidas,
        numeros,
        version: agregadas > 0 ? this.marcarCambiada(pestana.titulo) : null,
      })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/filas/borrar') {
      this.llamadas.borrar++
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porSheetId(Number(json.sheetId))
      if (!pestana) return responder(400, { error: `No hay ninguna pestaña con sheetId ${json.sheetId} en la hoja del VPS.` })
      const columnaId = this.columnaIdDe(pestana, Number.isInteger(json.columnaId) ? json.columnaId : null)
      const noEncontradas = []
      // Con `objetivos` mandan ellos y `filas` se ignora (ver el servidor real): sumar los números
      // borraría por posición el renglón que el _ID acaba de decir que ya no está.
      const objetivos = Array.isArray(json.objetivos) ? json.objetivos : []
      const numeros = objetivos.length > 0 ? [] : (json.filas ?? []).map(Number)
      for (const objetivo of objetivos) {
        const resuelto = this.resolverRenglon(pestana, Number(objetivo.numero), comoTexto(objetivo.id).trim(), columnaId)
        if (resuelto === null) noEncontradas.push(comoTexto(objetivo.id))
        else numeros.push(resuelto)
      }
      const borradas = [...new Set(numeros)].sort((a, b) => a - b)
      const habiaAlmacenadas = borradas.some((numero) => pestana.filas.has(numero))
      const restantes = [...pestana.filas.entries()].filter(([numero]) => !borradas.includes(numero)).sort((a, b) => a[0] - b[0])
      if (!habiaAlmacenadas) return responder(200, { borradas: 0, noEncontradas, version: null })
      pestana.filas = new Map(
        restantes.map(([numero, celdas]) => {
          const corridas = borradas.filter((borrada) => borrada < numero).length
          return [numero - corridas, celdas]
        }),
      )
      return responder(200, {
        borradas: borradas.length,
        noEncontradas,
        version: this.marcarCambiada(pestana.titulo),
      })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/pestanas') {
      this.llamadas.pestanas++
      if (!this.exigirInicializada(responder)) return
      const titulo = String(json.titulo ?? '').trim()
      // 409, como el servidor real: es el candado de «Cerrar mes» entre dos computadoras.
      if (this.porTitulo(titulo)) return responder(409, { error: `Ya existe una pestaña llamada "${titulo}".` })
      const encabezados = normalizarFila(json.encabezados)
      this.cargarPestanaDirecto({ titulo, valores: encabezados.length > 0 ? [encabezados] : [] })
      const pestana = this.porTitulo(titulo)
      return responder(200, {
        sheetId: pestana.sheetId,
        titulo: pestana.titulo,
        indice: pestana.indice,
        filas: encabezados.length > 0 ? 1 : 0,
        columnas: pestana.columnas,
        oculta: false,
        version: this.marcarCambiada(pestana.titulo),
      })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/columnas/asegurar') {
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porSheetId(Number(json.sheetId))
      if (!pestana) return responder(400, { error: `No hay ninguna pestaña con sheetId ${json.sheetId} en la hoja del VPS.` })
      pestana.columnas = Math.max(pestana.columnas, Number(json.cantidad) || 0)
      // Agregar una columna cambia la pestaña para todos, así que también se avisa: es el hueco que
      // el servidor real cierra llamando a `despertarPorLaGrilla()` acá.
      this.avisarGrilla()
      return responder(200, { columnas: pestana.columnas })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/tramos') {
      this.llamadas.tramos++
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porTitulo(String(json.titulo))
      if (!pestana) return responder(400, { error: `La pestaña "${json.titulo}" no existe en la hoja del VPS.` })
      let escritas = 0
      const saltadas = []
      for (const tramo of json.tramos ?? []) {
        const valores = Array.isArray(tramo.valores) ? tramo.valores : []
        const previos = Array.isArray(tramo.previos) ? tramo.previos : null
        valores.forEach((valor, desplazamiento) => {
          const numero = Number(tramo.fila) + desplazamiento
          // Con `previos`, sólo se escribe la celda que sigue diciendo lo que la computadora vio.
          if (previos) {
            const actual = comoTexto((pestana.filas.get(numero) ?? [])[Number(json.indiceColumna)]).trim()
            if (actual !== comoTexto(previos[desplazamiento]).trim()) {
              saltadas.push(numero)
              return
            }
          }
          this.ponerCelda(pestana.titulo, numero, Number(json.indiceColumna), valor)
          escritas++
        })
      }
      if (Number(json.indiceColumna) + 1 > pestana.columnas) pestana.columnas = Number(json.indiceColumna) + 1
      return responder(200, {
        escritas,
        saltadas,
        version: escritas > 0 ? this.marcarCambiada(pestana.titulo) : null,
      })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/columnas/ocultar') {
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porSheetId(Number(json.sheetId))
      if (!pestana) return responder(400, { error: `No hay ninguna pestaña con sheetId ${json.sheetId} en la hoja del VPS.` })
      if (!pestana.columnasOcultas.includes(Number(json.indiceColumna))) pestana.columnasOcultas.push(Number(json.indiceColumna))
      this.avisarGrilla()
      return responder(200, { ok: true })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/inicializar/comenzar') {
      if (this.inicializada) return responder(409, { error: 'La base del VPS ya está inicializada: la migración es una sola vez.' })
      this.pestanas = []
      this.proximoSheetId = 1
      return responder(200, { ok: true })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/inicializar/pestana') {
      if (this.inicializada) return responder(409, { error: 'La base del VPS ya está inicializada: la migración es una sola vez.' })
      const pestana = json.pestana ?? {}
      const titulo = String(pestana.titulo ?? '').trim()
      if (!titulo) return responder(400, { error: 'La pestaña necesita un título.' })
      if (this.porTitulo(titulo)) return responder(400, { error: `La pestaña "${titulo}" ya se cargó en esta migración.` })
      this.cargarPestanaDirecto({
        titulo,
        valores: Array.isArray(pestana.valores) ? pestana.valores : [],
        oculta: Boolean(pestana.oculta),
        columnasOcultas: Array.isArray(pestana.columnasOcultas) ? pestana.columnasOcultas : [],
      })
      return responder(200, { ok: true })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/inicializar/confirmar') {
      if (this.inicializada) return responder(409, { error: 'La base del VPS ya está inicializada: la migración es una sola vez.' })
      if (this.pestanas.length === 0) return responder(400, { error: 'No se cargó ninguna pestaña: no hay nada que confirmar.' })
      this.inicializada = true
      // La hoja se acaba de escribir entera: las computadoras tienen que olvidar lo que sabían.
      this.subirGeneracion()
      let filas = 0
      for (const pestana of this.pestanas) filas += pestana.filas.size
      return responder(200, { ok: true, pestanas: this.pestanas.length, filas })
    }
    // La base de usuarios de la agencia, que desde la v12.4 vive acá y no en GitHub. El servidor real
    // la guarda cifrada; acá alcanza con el texto en memoria, porque lo que las pruebas miran es el
    // contrato y el candado de la versión.
    if (ruta === '/api/dmg/usuarios' || ruta === '/api/dmg/usuarios/estado') {
      if (metodo === 'GET') {
        this.llamadas.usuariosLeidos++
        if (!this.usuarios) return responder(200, { documento: null })
        const ficha = {
          sha: String(this.usuarios.version),
          actualizadoEn: this.usuarios.actualizadoEn,
          actualizadoPor: this.usuarios.actualizadoPor,
        }
        return responder(200, { documento: ruta.endsWith('/estado') ? ficha : { ...ficha, texto: this.usuarios.texto } })
      }
      if (metodo === 'POST' && ruta === '/api/dmg/usuarios') {
        const texto = typeof json?.texto === 'string' ? json.texto : ''
        if (!texto.trim()) return responder(400, { error: 'La base de usuarios que se quiso guardar viene vacía.' })
        const previo = typeof json?.shaPrevio === 'string' && json.shaPrevio !== '' ? json.shaPrevio : null
        const versionActual = this.usuarios ? String(this.usuarios.version) : null
        if (previo !== versionActual) {
          return responder(409, {
            error: 'La base de usuarios cambió mientras se guardaba: hay que releerla y volver a aplicar el cambio.',
          })
        }
        this.llamadas.usuariosGuardados++
        const version = (this.usuarios?.version ?? 0) + 1
        this.usuarios = {
          texto,
          version,
          actualizadoEn: new Date().toISOString(),
          actualizadoPor: typeof json?.actualizadoPor === 'string' ? json.actualizadoPor : null,
          mensaje: typeof json?.mensaje === 'string' ? json.mensaje : null,
        }
        this.mensajesDeUsuarios.push(this.usuarios.mensaje ?? '')
        return responder(200, { sha: String(version) })
      }
    }
    // Ajustes compartidos: la credencial que el superadministrador carga una vez y el resto de las
    // computadoras adopta. El servidor real las guarda cifradas; acá alcanza con guardarlas en
    // memoria, porque lo que las pruebas miran es el contrato y la huella.
    const ajuste = /^\/api\/dmg\/ajustes\/([^/]+)(\/estado|\/borrar)?$/.exec(ruta)
    if (ajuste) {
      const clave = decodeURIComponent(ajuste[1])
      const cola = ajuste[2] ?? ''
      if (!CLAVES_DE_AJUSTE.has(clave)) {
        return responder(404, { error: `El puente DM Gestión no conoce el ajuste «${clave}».` })
      }
      const guardado = this.ajustes.get(clave) ?? null
      if (metodo === 'GET' && cola === '') {
        this.llamadas.ajusteLeido++
        return responder(200, { ajuste: guardado })
      }
      if (metodo === 'GET' && cola === '/estado') {
        this.llamadas.ajusteConsultado++
        return responder(200, { ajuste: guardado ? { ...guardado, valor: undefined } : null })
      }
      if (metodo === 'POST' && cola === '') {
        const valor = json?.valor
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
          return responder(400, { error: 'El ajuste tiene que ser un objeto.' })
        }
        this.llamadas.ajusteGuardado++
        const ficha = {
          clave,
          valor,
          huella: createHash('sha256').update(JSON.stringify(valor)).digest('hex'),
          actualizadoEn: new Date().toISOString(),
          actualizadoPor: typeof json?.actualizadoPor === 'string' ? json.actualizadoPor : null,
        }
        this.ajustes.set(clave, ficha)
        return responder(200, { ajuste: { ...ficha, valor: undefined } })
      }
      if (metodo === 'POST' && cola === '/borrar') {
        return responder(200, { borrado: this.ajustes.delete(clave) })
      }
    }
    // Respaldos del GENERAL DE CLIENTES. El servidor real guarda el volcado comprimido en Postgres;
    // acá alcanza con una copia profunda en memoria, porque lo que las pruebas miran es que rebobinar
    // rebobine de verdad: que lo que se cargó después del respaldo NO sobreviva a la restauración.
    if (ruta === '/api/dmg/respaldos' && metodo === 'GET') {
      this.llamadas.respaldosListados++
      const cuantos = Number(busqueda.get('cuantos')) || 3
      return responder(200, { respaldos: this.respaldos.slice(0, cuantos).map((r) => this.fichaDeRespaldo(r)) })
    }
    if (ruta === '/api/dmg/respaldos' && metodo === 'POST') {
      this.llamadas.respaldosCreados++
      const quien = typeof json?.hechoPor === 'string' ? json.hechoPor : null
      const { respaldo, yaEstaba } = this.guardarRespaldo('A_MANO', quien)
      return responder(200, { respaldo: this.fichaDeRespaldo(respaldo), yaEstaba })
    }
    const restaurar = /^\/api\/dmg\/respaldos\/(\d+)\/restaurar$/.exec(ruta)
    if (restaurar && metodo === 'POST') {
      this.llamadas.respaldosRestaurados++
      const guardado = this.respaldos.find((r) => r.id === Number(restaurar[1]))
      if (!guardado) return responder(404, { error: 'Ese respaldo ya no está en el servidor.' })
      const quien = typeof json?.hechoPor === 'string' ? json.hechoPor : null
      // Igual que el servidor real: primero la foto de cómo está AHORA, después se pisa.
      const { respaldo: previo } = this.guardarRespaldo('ANTES_DE_RESTAURAR', quien)
      this.pestanas = guardado.pestanas.map(copiaProfunda)
      // Rebobinar reemplaza la hoja entera y las versiones vuelven a empezar: sin subir la generación
      // una pestaña podría quedar valiendo lo mismo que antes y nadie se enteraría del rebobinado.
      this.versiones = new Map()
      this.subirGeneracion()
      return responder(200, {
        pestanas: this.pestanas.length,
        filas: this.pestanas.reduce((suma, pestana) => suma + pestana.filas.size, 0),
        respaldoPrevio: this.fichaDeRespaldo(previo),
      })
    }
    return responder(404, { error: `Ruta desconocida: ${metodo} ${ruta}` })
  }

  async cerrar() {
    if (!this.servidor) return
    // Primero los sockets del canal: un WebSocket abierto es una conexión viva, y `close()` del
    // servidor http espera a que las conexiones vivas terminen. Sin esto, cerrar el simulador al final
    // de una prueba con el canal abierto se queda esperando para siempre.
    for (const conexion of this.conexiones.values()) conexion.socket.terminate()
    this.conexiones.clear()
    // Los relojes del timbre son `unref`, así que no aguantan el proceso, pero dejarlos vivos haría
    // que una llamada de una prueba ya terminada se cierre encima de la siguiente.
    for (const llamada of this.llamadasAbiertas.values()) this.pararElTimbreDe(llamada)
    this.llamadasAbiertas.clear()
    if (this.servidorDelCanal) {
      await new Promise((resolver) => this.servidorDelCanal.close(resolver))
      this.servidorDelCanal = null
    }
    await new Promise((resolver) => this.servidor.close(resolver))
    this.servidor = null
  }
}
