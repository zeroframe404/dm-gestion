// Un servidor local que simula el puente /api/dmg del VPS (la base del GENERAL DE CLIENTES),
// con la misma semántica de grilla que el servidor real: pestañas ordenadas, filas numeradas
// base 1, celdas de texto, y la migración inicial en tres fases. Lo usan las pruebas y el humo,
// igual que github-simulado.mjs simula la base de usuarios.
import { createServer } from 'node:http'

const TOKEN_POR_DEFECTO = 'prueba'

function comoTexto(valor) {
  if (valor === null || valor === undefined) return ''
  return String(valor)
}

function normalizarFila(fila) {
  return Array.isArray(fila) ? fila.map(comoTexto) : []
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
    this.llamadas = { estructura: 0, leer: 0, celdas: 0, agregar: 0, borrar: 0, pestanas: 0, tramos: 0, estado: 0 }

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
      let cuerpo = ''
      pedido.on('data', (trozo) => (cuerpo += trozo))
      pedido.on('end', () => {
        if (this.colgar) return
        const json = cuerpo ? JSON.parse(cuerpo) : {}
        const [ruta] = (pedido.url ?? '').split('?')
        this.intercambios.push({ metodo: pedido.method, ruta, autorizacion: pedido.headers.authorization ?? null })
        const responder = (estado, datos) => {
          respuesta.writeHead(estado, { 'content-type': 'application/json' })
          respuesta.end(JSON.stringify(datos))
        }

        if (this.errorFijo) return responder(this.errorFijo.estado, { error: this.errorFijo.mensaje })
        const falla = this.fallasIniciales.shift()
        if (falla) return responder(falla.estado, { error: falla.mensaje })

        const autorizacion = pedido.headers.authorization ?? ''
        if (autorizacion !== `Bearer ${this.token}`) {
          return responder(401, { error: 'Token del puente DM Gestión inválido.' })
        }

        try {
          return this.atender(pedido.method ?? 'GET', ruta ?? '', json, responder)
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

  atender(metodo, ruta, json, responder) {
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
      for (const celda of json.celdas ?? []) {
        const pestana = this.porTitulo(String(celda.titulo))
        if (!pestana) return responder(400, { error: `La pestaña "${celda.titulo}" no existe en la hoja del VPS.` })
        this.editarDirecto(pestana.titulo, celda.fila, celda.columna, celda.valor)
        if (celda.columna + 1 > pestana.columnas) pestana.columnas = celda.columna + 1
      }
      return responder(200, { escritas: (json.celdas ?? []).length })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/filas/agregar') {
      this.llamadas.agregar++
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porTitulo(String(json.titulo))
      if (!pestana) return responder(400, { error: `La pestaña "${json.titulo}" no existe en la hoja del VPS.` })
      const filas = Array.isArray(json.filas) ? json.filas : []
      if (filas.length === 0) return responder(400, { error: 'No hay filas para agregar.' })
      const primeraFila = this.maxNumero(pestana) + 1
      filas.forEach((fila, indice) => {
        pestana.filas.set(primeraFila + indice, normalizarFila(fila))
      })
      return responder(200, { primeraFila })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/filas/borrar') {
      this.llamadas.borrar++
      if (!this.exigirInicializada(responder)) return
      const pestana = this.porSheetId(Number(json.sheetId))
      if (!pestana) return responder(400, { error: `No hay ninguna pestaña con sheetId ${json.sheetId} en la hoja del VPS.` })
      const borradas = [...new Set((json.filas ?? []).map(Number))].sort((a, b) => a - b)
      const habiaAlmacenadas = borradas.some((numero) => pestana.filas.has(numero))
      const restantes = [...pestana.filas.entries()].filter(([numero]) => !borradas.includes(numero)).sort((a, b) => a[0] - b[0])
      if (!habiaAlmacenadas) return responder(200, { borradas: 0 })
      pestana.filas = new Map(
        restantes.map(([numero, celdas]) => {
          const corridas = borradas.filter((borrada) => borrada < numero).length
          return [numero - corridas, celdas]
        }),
      )
      return responder(200, { borradas: borradas.length })
    }
    if (metodo === 'POST' && ruta === '/api/dmg/pestanas') {
      this.llamadas.pestanas++
      if (!this.exigirInicializada(responder)) return
      const titulo = String(json.titulo ?? '').trim()
      if (this.porTitulo(titulo)) return responder(400, { error: `Ya existe una pestaña llamada "${titulo}".` })
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
      for (const tramo of json.tramos ?? []) {
        const valores = Array.isArray(tramo.valores) ? tramo.valores : []
        valores.forEach((valor, desplazamiento) => {
          this.editarDirecto(pestana.titulo, Number(tramo.fila) + desplazamiento, Number(json.indiceColumna), valor)
          escritas++
        })
      }
      if (Number(json.indiceColumna) + 1 > pestana.columnas) pestana.columnas = Number(json.indiceColumna) + 1
      return responder(200, { escritas })
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
    return responder(404, { error: `Ruta desconocida: ${metodo} ${ruta}` })
  }

  async cerrar() {
    if (!this.servidor) return
    await new Promise((resolver) => this.servidor.close(resolver))
    this.servidor = null
  }
}
