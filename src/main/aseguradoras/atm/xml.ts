// Lo mínimo de XML que hace falta para hablar con ATM: escribir el pedido y leer la respuesta.
//
// ATM contesta un SOAP con el resultado ADENTRO como XML (no como texto escapado), y sus tablas de
// parámetros pueden venir como XML también. Es un XML chato y sin atributos que importen, así que en
// vez de sumar una librería entera alcanza con este lector: elementos, texto, entidades, CDATA y
// comentarios. Es puro (sin red, sin disco) y se prueba solo en pruebas/atm.prueba.ts.

/** Un elemento del XML: su nombre sin prefijo de espacio de nombres, su texto y sus hijos. */
export interface NodoXml {
  nombre: string
  texto: string
  hijos: NodoXml[]
}

/** Escapa un texto para meterlo adentro de un elemento (o de otro XML, como el `doc_in` del SOAP). */
export function escaparXml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function desescaparXml(valor: string): string {
  return valor.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const codigo = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10)
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entera
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? entera
  })
}

/** «ns1:AUTOS_Cotizar_PHPResult» → «AUTOS_Cotizar_PHPResult». */
function sinPrefijo(nombre: string): string {
  const dos = nombre.indexOf(':')
  return dos >= 0 ? nombre.slice(dos + 1) : nombre
}

export class ErrorDeXml extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeXml'
  }
}

/**
 * Lee un documento XML y devuelve su elemento raíz. Tira `ErrorDeXml` si no está bien formado (una
 * etiqueta sin cerrar, una página de error en HTML…): mejor un error claro que una cotización a medias.
 */
export function leerXml(texto: string): NodoXml {
  const raiz: NodoXml = { nombre: '#documento', texto: '', hijos: [] }
  const pila: NodoXml[] = [raiz]
  let i = 0
  const largo = texto.length
  while (i < largo) {
    const abre = texto.indexOf('<', i)
    const tope = pila[pila.length - 1]!
    if (abre < 0) {
      tope.texto += desescaparXml(texto.slice(i))
      break
    }
    if (abre > i) tope.texto += desescaparXml(texto.slice(i, abre))
    if (texto.startsWith('<!--', abre)) {
      const fin = texto.indexOf('-->', abre + 4)
      if (fin < 0) throw new ErrorDeXml('Un comentario del XML no se cierra.')
      i = fin + 3
      continue
    }
    if (texto.startsWith('<![CDATA[', abre)) {
      const fin = texto.indexOf(']]>', abre + 9)
      if (fin < 0) throw new ErrorDeXml('Un bloque CDATA del XML no se cierra.')
      tope.texto += texto.slice(abre + 9, fin)
      i = fin + 3
      continue
    }
    if (texto.startsWith('<?', abre)) {
      const fin = texto.indexOf('?>', abre + 2)
      if (fin < 0) throw new ErrorDeXml('Una instrucción del XML no se cierra.')
      i = fin + 2
      continue
    }
    if (texto.startsWith('<!', abre)) {
      const fin = texto.indexOf('>', abre + 2)
      if (fin < 0) throw new ErrorDeXml('Una declaración del XML no se cierra.')
      i = fin + 1
      continue
    }
    const cierra = buscarFinDeEtiqueta(texto, abre + 1)
    if (cierra < 0) throw new ErrorDeXml('Una etiqueta del XML no se cierra.')
    const etiqueta = texto.slice(abre + 1, cierra)
    i = cierra + 1
    if (etiqueta.startsWith('/')) {
      const nombre = sinPrefijo(etiqueta.slice(1).trim())
      const abierto = pila.pop()
      if (!abierto || abierto === raiz || abierto.nombre !== nombre) {
        throw new ErrorDeXml(`El XML cierra <${nombre}> sin haberlo abierto.`)
      }
      continue
    }
    const autocerrada = etiqueta.endsWith('/')
    const cuerpo = autocerrada ? etiqueta.slice(0, -1) : etiqueta
    const nombre = sinPrefijo(cuerpo.trim().split(/\s/, 1)[0] ?? '')
    if (!nombre) throw new ErrorDeXml('El XML tiene una etiqueta sin nombre.')
    const nodo: NodoXml = { nombre, texto: '', hijos: [] }
    tope.hijos.push(nodo)
    if (!autocerrada) pila.push(nodo)
  }
  if (pila.length > 1) throw new ErrorDeXml(`El XML no cierra <${pila[pila.length - 1]!.nombre}>.`)
  const elementos = raiz.hijos
  if (elementos.length !== 1) throw new ErrorDeXml(elementos.length === 0 ? 'La respuesta no trae XML.' : 'El XML tiene más de un elemento raíz.')
  return elementos[0]!
}

/** El `>` que cierra la etiqueta que empieza en `desde`, sin confundirse con un `>` entre comillas. */
function buscarFinDeEtiqueta(texto: string, desde: number): number {
  let comilla: string | null = null
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i]
    if (comilla) {
      if (c === comilla) comilla = null
    } else if (c === '"' || c === "'") {
      comilla = c
    } else if (c === '>') {
      return i
    }
  }
  return -1
}

/** El primer hijo con ese nombre (sin distinguir mayúsculas), o undefined. */
export function hijo(nodo: NodoXml | undefined, nombre: string): NodoXml | undefined {
  const buscado = nombre.toLowerCase()
  return nodo?.hijos.find((h) => h.nombre.toLowerCase() === buscado)
}

/** Todos los hijos con ese nombre. */
export function hijos(nodo: NodoXml | undefined, nombre: string): NodoXml[] {
  const buscado = nombre.toLowerCase()
  return nodo?.hijos.filter((h) => h.nombre.toLowerCase() === buscado) ?? []
}

/** El texto de un hijo, sin espacios alrededor; '' si no está. */
export function textoDe(nodo: NodoXml | undefined, nombre: string): string {
  return hijo(nodo, nombre)?.texto.trim() ?? ''
}

/** El primer elemento con ese nombre en todo el árbol (en profundidad), o undefined. */
export function buscar(nodo: NodoXml, nombre: string): NodoXml | undefined {
  const buscado = nombre.toLowerCase()
  const pendientes = [nodo]
  while (pendientes.length > 0) {
    const actual = pendientes.shift()!
    if (actual.nombre.toLowerCase() === buscado) return actual
    pendientes.push(...actual.hijos)
  }
  return undefined
}

/**
 * Un elemento como objeto plano, para guardar «lo que contestó ATM» en el detalle técnico: las hojas
 * quedan como texto y los elementos repetidos, como lista.
 */
export function aObjeto(nodo: NodoXml): unknown {
  if (nodo.hijos.length === 0) return nodo.texto.trim()
  const porNombre = new Map<string, unknown[]>()
  for (const h of nodo.hijos) {
    const lista = porNombre.get(h.nombre) ?? []
    lista.push(aObjeto(h))
    porNombre.set(h.nombre, lista)
  }
  return Object.fromEntries([...porNombre].map(([nombre, valores]) => [nombre, valores.length === 1 ? valores[0] : valores]))
}
