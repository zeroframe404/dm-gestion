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
      ajusteLeido: 0, ajusteConsultado: 0, ajusteGuardado: 0,
      usuariosLeidos: 0, usuariosGuardados: 0,
      respaldosListados: 0, respaldosCreados: 0, respaldosRestaurados: 0,
    }
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
      if (titulos.length === 0) return responder(400, { error: 'Indicá qué pestañas leer.' })
      const pestanas = []
      for (const titulo of titulos) {
        const valores = this.valoresDe(String(titulo), json.hastaFila)
        if (valores === null) return responder(400, { error: `La pestaña "${titulo}" no existe en la hoja del VPS.` })
        pestanas.push({ titulo, valores })
      }
      return responder(200, { pestanas })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/celdas') {
      this.llamadas.celdas++
      if (!this.exigirInicializada(responder)) return
      const columnaIdPorTitulo = json.columnaId && typeof json.columnaId === 'object' ? json.columnaId : {}
      const noEncontradas = []
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
      }
      return responder(200, { escritas, noEncontradas })
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
      return responder(200, { primeraFila, agregadas: siguiente - primeraFila, repetidas, numeros })
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
      if (!habiaAlmacenadas) return responder(200, { borradas: 0, noEncontradas })
      pestana.filas = new Map(
        restantes.map(([numero, celdas]) => {
          const corridas = borradas.filter((borrada) => borrada < numero).length
          return [numero - corridas, celdas]
        }),
      )
      return responder(200, { borradas: borradas.length, noEncontradas })
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
      return responder(200, { escritas, saltadas })
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
