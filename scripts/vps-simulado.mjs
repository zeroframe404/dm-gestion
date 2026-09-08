// Un servidor local que simula el puente /api/dmg del VPS (la base del GENERAL DE CLIENTES),
// con la misma semántica de grilla que el servidor real: pestañas ordenadas, filas numeradas
// base 1, celdas de texto, y la migración inicial en tres fases. Lo usan las pruebas y el humo,
// igual que github-simulado.mjs simula la base de usuarios.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

/** Las mismas claves que acepta el servidor real: es una lista blanca, no un almacén libre. */
const CLAVES_DE_AJUSTE = new Set(['vehiculos', 'referencias', 'google', 'meta', 'ticket', 'companias'])

const TOKEN_POR_DEFECTO = 'prueba'

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
      novedades: 0,
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
    return version
  }

  /** El mapa `{titulo: version}` de toda la hoja. Una pestaña que nunca se escribió cuenta como 0. */
  mapaDeVersiones() {
    const mapa = {}
    for (const pestana of this.pestanas) mapa[pestana.titulo] = this.versiones.get(pestana.titulo) ?? 0
    return mapa
  }

  /** La hoja se reemplazó entera (restaurar un respaldo, la migración inicial). */
  subirGeneracion() {
    this.generacion += 1
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

  /** «Otra computadora» (o el panel web) cambió una celda directamente en la base. */
  editarDirecto(titulo, fila, columna, valor) {
    const pestana = this.porTitulo(titulo)
    if (!pestana) throw new Error(`No existe la pestaña ${titulo}`)
    const celdas = pestana.filas.get(fila) ?? []
    while (celdas.length <= columna) celdas.push('')
    celdas[columna] = comoTexto(valor)
    pestana.filas.set(fila, celdas)
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
          return this.atender(pedido.method ?? 'GET', ruta ?? '', json, responder, new URLSearchParams(consulta ?? ''))
        } catch (error) {
          return responder(500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    })
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
    }
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
      for (const participante of conversacion.participantes) {
        if (participante.clave === actor.clave || participante.salioEn) continue
        this.acuses.set(`${mensaje.id}|${participante.clave}`, { entregadoEn: null, leidoEn: null })
      }
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
      }
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

    const borrado = /^\/api\/dmg\/mensajes\/([^/]+)\/eliminar$/.exec(ruta)
    if (metodo === 'POST' && borrado) {
      const mensaje = this.mensajes.find((cada) => cada.id === borrado[1])
      if (!mensaje) return responder(404, { error: 'Ese mensaje no existe.' })
      if (mensaje.autorClave !== actor.clave && actor.rol !== 'SUPER_ADMIN') {
        return responder(403, { error: 'Sólo se puede borrar un mensaje propio.' })
      }
      mensaje.eliminadoEn = mensaje.eliminadoEn ?? ahora
      mensaje.eliminadoPor = mensaje.eliminadoPor ?? actor.clave
      return responder(200, { eliminado: true })
    }

    return responder(404, { error: `El simulador no atiende ${metodo} ${ruta}.` })
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
      return responder(200, { generacion: this.generacion, versiones, cambiaron })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/celdas') {
      this.llamadas.celdas++
      if (!this.exigirInicializada(responder)) return
      const columnaIdPorTitulo = json.columnaId && typeof json.columnaId === 'object' ? json.columnaId : {}
      const noEncontradas = []
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
        this.editarDirecto(pestana.titulo, fila, celda.columna, celda.valor)
        if (celda.columna + 1 > pestana.columnas) pestana.columnas = celda.columna + 1
        escritas++
        tocadas.add(pestana.titulo)
      }
      const versiones = {}
      for (const titulo of tocadas) versiones[titulo] = this.marcarCambiada(titulo)
      return responder(200, { escritas, noEncontradas, versiones })
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
          this.editarDirecto(pestana.titulo, numero, Number(json.indiceColumna), valor)
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
    await new Promise((resolver) => this.servidor.close(resolver))
    this.servidor = null
  }
}
