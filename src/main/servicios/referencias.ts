// Las cinco listas del módulo Compañías: lo que se mira mientras alguien espera del otro lado.
//
// Qué son. No describen ninguna póliza de nadie: describen lo que ofrece el mercado. A quién hay que
// escribirle para pedir precio, cuánto sale la responsabilidad civil en cada compañía, hasta qué
// modelo toma cada una, cuántos kilómetros de grúa da y qué ampara cada cobertura. Es lo que hoy vive
// en un cuaderno, en una captura de WhatsApp o en la cabeza del que atiende hace diez años.
//
// De dónde salen. Se cargan a mano, como la matriz de reglas de cobertura y por el mismo motivo: en
// la planilla de la agencia no hay ninguna pestaña que sea una tabla con estos datos, y la que se le
// parece (COBERTURA) es un cuadro de resumen con celdas combinadas que el importador no mapea. Nada
// de esto se encola para subir a la hoja, porque no hay dónde escribirlo.
//
// Cómo llegan a las otras computadoras. Por el puente de ajustes del VPS (ver referenciasCompartidas.ts),
// no por la planilla. La regla de ese puente es «la última publicación gana», que acá alcanza porque
// las carga una sola persona.
//
// La quinta lista —Antigüedad— no está en ninguna tabla: se calcula sobre `reglas_cobertura`, que ya
// existe y es la que avisa al emitir una póliza. Tener dos matrices de antigüedad habría sido tener
// dos respuestas para la misma pregunta.
import { anioMinimoDe } from '../../shared/polizas'
import { hoyLocal } from '../../shared/semaforo'
import type {
  ClausulaDeCobertura,
  CompaniaSegunAntiguedad,
  ConsultaDeAntiguedad,
  CoberturaSegunAntiguedad,
  DatosDeClausula,
  DatosDeGrua,
  DatosDeOrganizador,
  DatosDePrecio,
  GruaDeCompania,
  ListasDeCompanias,
  Organizador,
  PrecioDeCompania,
  ReglaDeCobertura,
  SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarTexto } from '../importacion/normalizar'
import { telefonoParaWhatsapp } from './cartera'
import { ErrorDeNegocio } from './errores'
import { registrarCambio, type AccionHistorial } from './historial'
import { puedeEditar } from './permisos'
import { reglasVigentes } from './reglas'
import { objeto, texto } from './validacion'

/** Todo cambio de las listas se anota en el historial con esta acción. */
const ACCION: AccionHistorial = 'referencia'

/** Ordena como se leen los nombres en castellano, con acentos y ñ en su lugar. */
const comparar = (a: string, b: string) => a.localeCompare(b, 'es-AR')

function anioDeHoy(): number {
  return Number(hoyLocal().slice(0, 4))
}

/** Campo de texto que puede quedar vacío: vacío se guarda como NULL, no como cadena vacía. */
function opcional(valor: unknown, campo: string, maximo: number): string | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  return texto(limpio, campo, 1, maximo)
}

// ---------------------------------------------------------------------------
// Organizadores
// ---------------------------------------------------------------------------

interface FilaOrganizador {
  id: number
  nombre: string
  companias: string | null
  telefono: string | null
  email: string | null
  horario: string | null
  observaciones: string | null
  orden: number
  activo: number
}

const SELECT_ORGANIZADORES = `
  SELECT id, nombre, companias, telefono, email, horario, observaciones, orden, activo
  FROM organizadores
`

function aOrganizador(fila: FilaOrganizador): Organizador {
  // El enlace se arma acá y no en la pantalla para que sea el mismo que usa el resto del programa:
  // un teléfono escrito «11 4567-8901» y otro «+54 9 11 4567 8901» tienen que abrir la misma charla.
  const telefono = telefonoParaWhatsapp(fila.telefono)
  return {
    id: fila.id,
    nombre: fila.nombre,
    companias: fila.companias,
    telefono: fila.telefono,
    email: fila.email,
    horario: fila.horario,
    observaciones: fila.observaciones,
    orden: fila.orden,
    activo: fila.activo === 1,
    whatsapp: telefono ? `https://wa.me/${telefono}` : null,
  }
}

/**
 * Los organizadores en el orden en que se les escribe. `orden` manda; el nombre desempata para que
 * dos cargados el mismo día no se muevan solos de lugar entre una consulta y la siguiente.
 */
export function listarOrganizadores(): Organizador[] {
  const filas = db().prepare(`${SELECT_ORGANIZADORES} ORDER BY orden, id`).all() as FilaOrganizador[]
  return filas.map(aOrganizador)
}

interface OrganizadorValidado {
  nombre: string
  companias: string | null
  telefono: string | null
  email: string | null
  horario: string | null
  observaciones: string | null
  activo: boolean
}

function validarOrganizador(datos: DatosDeOrganizador): OrganizadorValidado {
  const crudos = objeto(datos, 'Los datos del organizador')
  return {
    nombre: texto(crudos.nombre, 'El nombre del organizador', 1, 120),
    companias: opcional(crudos.companias, 'Las compañías que cotiza', 300),
    telefono: opcional(crudos.telefono, 'El teléfono', 60),
    email: opcional(crudos.email, 'El correo', 160),
    horario: opcional(crudos.horario, 'El horario', 160),
    observaciones: opcional(crudos.observaciones, 'Las observaciones', 500),
    activo: crudos.activo !== false,
  }
}

/** Resumen de un organizador para el historial, para entenderlo sin abrir la pantalla. */
function resumenDeOrganizador(organizador: { nombre: string; telefono: string | null; activo: boolean }): string {
  const partes = [organizador.nombre]
  if (organizador.telefono) partes.push(organizador.telefono)
  if (!organizador.activo) partes.push('sin usar')
  return partes.join(' · ')
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

interface FilaPrecio {
  id: number
  compania: string
  cobertura: string
  rama: string | null
  precio: number
  vigente_desde: string | null
  observaciones: string | null
}

const SELECT_PRECIOS = `
  SELECT id, compania, cobertura, rama, precio, vigente_desde, observaciones
  FROM precios_companias
`

function aPrecio(fila: FilaPrecio): PrecioDeCompania {
  return {
    id: fila.id,
    compania: fila.compania,
    cobertura: fila.cobertura,
    rama: fila.rama,
    precio: fila.precio,
    vigenteDesde: fila.vigente_desde,
    observaciones: fila.observaciones,
  }
}

/**
 * Los precios ordenados por cobertura y, dentro de cada una, del más barato al más caro. Es el orden
 * en que se lee la lista en el mostrador: la pregunta nunca es «cuánto sale en ATM», es «cuál es la
 * más barata para responsabilidad civil».
 */
export function listarPrecios(): PrecioDeCompania[] {
  const filas = db().prepare(SELECT_PRECIOS).all() as FilaPrecio[]
  return filas
    .map(aPrecio)
    .sort((a, b) => comparar(a.cobertura, b.cobertura) || a.precio - b.precio || comparar(a.compania, b.compania))
}

/**
 * Un importe de una lista de precios. Se acepta con coma o con punto («18.500,50» y «18500.5») porque
 * en el mostrador se copia de donde esté; lo que no se acepta es un cero o un negativo, que no serían
 * un precio sino un dato a medio cargar.
 */
function importe(valor: unknown, campo: string): number {
  const limpio = limpiar(valor).replace(/\s+/g, '')
  if (!limpio) throw new ErrorDeNegocio(`${campo} no puede quedar vacío.`)
  // «18.500,50» es argentino: el punto separa miles y la coma, decimales. «18500.5» es como lo
  // escribe una planilla. Se distinguen por cuál de los dos signos viene último.
  const normalizado = limpio.lastIndexOf(',') > limpio.lastIndexOf('.') ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) {
    throw new ErrorDeNegocio(`${campo} tiene que ser un número, con centavos o sin ellos (por ejemplo 18500 o 18500,50).`)
  }
  const numero = Number(normalizado)
  if (!(numero > 0)) throw new ErrorDeNegocio(`${campo} tiene que ser mayor que cero.`)
  if (numero > 100_000_000) throw new ErrorDeNegocio(`${campo} quedó demasiado alto: revisá si no sobra un cero.`)
  return Math.round(numero * 100) / 100
}

/** Una fecha 'AAAA-MM-DD', o null si el campo quedó vacío (que es válido: no siempre se sabe). */
function fecha(valor: unknown, campo: string): string | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) throw new ErrorDeNegocio(`${campo} tiene que ser una fecha.`)
  const [anio, mes, dia] = limpio.split('-').map(Number) as [number, number, number]
  const fechaReal = new Date(Date.UTC(anio, mes - 1, dia))
  // Date acomoda solo un 31 de febrero: comparando de vuelta se detecta que la fecha no existía.
  if (fechaReal.getUTCFullYear() !== anio || fechaReal.getUTCMonth() !== mes - 1 || fechaReal.getUTCDate() !== dia) {
    throw new ErrorDeNegocio(`${campo} no es una fecha que exista.`)
  }
  if (anio < 2000 || anio > anioDeHoy() + 1) {
    throw new ErrorDeNegocio(`${campo} tiene que estar entre 2000 y ${anioDeHoy() + 1}.`)
  }
  return limpio
}

interface PrecioValidado {
  compania: string
  cobertura: string
  rama: string | null
  precio: number
  vigenteDesde: string | null
  observaciones: string | null
}

function validarPrecio(datos: DatosDePrecio): PrecioValidado {
  const crudos = objeto(datos, 'Los datos del precio')
  return {
    compania: texto(crudos.compania, 'La compañía', 1, 120),
    cobertura: texto(crudos.cobertura, 'La cobertura', 1, 120),
    rama: opcional(crudos.rama, 'La rama', 60),
    precio: importe(crudos.precio, 'El precio'),
    vigenteDesde: fecha(crudos.vigenteDesde, 'La fecha desde la que rige el precio'),
    observaciones: opcional(crudos.observaciones, 'Las observaciones', 500),
  }
}

// ---------------------------------------------------------------------------
// Grúas
// ---------------------------------------------------------------------------

interface FilaGrua {
  id: number
  compania: string
  cobertura: string
  kilometros: number | null
  auxilio: string | null
  observaciones: string | null
}

const SELECT_GRUAS = `
  SELECT id, compania, cobertura, kilometros, auxilio, observaciones
  FROM gruas_companias
`

function aGrua(fila: FilaGrua): GruaDeCompania {
  return {
    id: fila.id,
    compania: fila.compania,
    cobertura: fila.cobertura,
    kilometros: fila.kilometros,
    auxilio: fila.auxilio,
    observaciones: fila.observaciones,
  }
}

export function listarGruas(): GruaDeCompania[] {
  const filas = db().prepare(SELECT_GRUAS).all() as FilaGrua[]
  return filas.map(aGrua).sort((a, b) => comparar(a.compania, b.compania) || comparar(a.cobertura, b.cobertura))
}

interface GruaValidada {
  compania: string
  cobertura: string
  kilometros: number | null
  auxilio: string | null
  observaciones: string | null
}

/**
 * Los kilómetros de grúa. Vacío es ILIMITADA y es un valor real: hay compañías que no ponen tope en
 * todo riesgo. Lo que no existe es una grúa de cero kilómetros, así que el cero se rechaza en vez de
 * guardarse como si dijera algo.
 */
function kilometros(valor: unknown): number | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  if (!/^\d{1,5}$/.test(limpio)) {
    throw new ErrorDeNegocio('Los kilómetros tienen que ser un número entero. Dejalo vacío si la grúa es ilimitada.')
  }
  const numero = Number(limpio)
  if (numero < 1 || numero > 20_000) {
    throw new ErrorDeNegocio('Los kilómetros tienen que estar entre 1 y 20000. Dejalo vacío si la grúa es ilimitada.')
  }
  return numero
}

function validarGrua(datos: DatosDeGrua): GruaValidada {
  const crudos = objeto(datos, 'Los datos de la grúa')
  return {
    compania: texto(crudos.compania, 'La compañía', 1, 120),
    cobertura: texto(crudos.cobertura, 'La cobertura', 1, 120),
    kilometros: kilometros(crudos.kilometros),
    auxilio: opcional(crudos.auxilio, 'El auxilio', 300),
    observaciones: opcional(crudos.observaciones, 'Las observaciones', 500),
  }
}

/** Los kilómetros en el idioma del mostrador: es lo que se lee por teléfono y lo que va al historial. */
function kilometrosEnPalabras(kms: number | null): string {
  return kms === null ? 'grúa ilimitada' : `${kms} km`
}

// ---------------------------------------------------------------------------
// Cláusulas de cada cobertura
// ---------------------------------------------------------------------------

interface FilaClausula {
  id: number
  compania: string | null
  cobertura: string
  clausula: string
  ampara: number
  detalle: string | null
  orden: number
}

const SELECT_CLAUSULAS = `
  SELECT id, compania, cobertura, clausula, ampara, detalle, orden
  FROM clausulas_coberturas
`

function aClausula(fila: FilaClausula): ClausulaDeCobertura {
  return {
    id: fila.id,
    compania: fila.compania,
    cobertura: fila.cobertura,
    clausula: fila.clausula,
    ampara: fila.ampara === 1,
    detalle: fila.detalle,
    orden: fila.orden,
  }
}

/**
 * Las cláusulas agrupadas como se leen: por cobertura, primero lo que ampara y después lo que queda
 * afuera. Dentro de cada grupo manda `orden`, que es como las escribió quien las cargó.
 */
export function listarClausulas(): ClausulaDeCobertura[] {
  const filas = db().prepare(SELECT_CLAUSULAS).all() as FilaClausula[]
  return filas
    .map(aClausula)
    .sort(
      (a, b) =>
        comparar(a.cobertura, b.cobertura) ||
        Number(b.ampara) - Number(a.ampara) ||
        a.orden - b.orden ||
        comparar(a.clausula, b.clausula),
    )
}

interface ClausulaValidada {
  compania: string | null
  cobertura: string
  clausula: string
  ampara: boolean
  detalle: string | null
}

function validarClausula(datos: DatosDeClausula): ClausulaValidada {
  const crudos = objeto(datos, 'Los datos de la cláusula')
  return {
    // Vacío es «vale para todas las compañías», que es el caso normal: las coberturas se arman casi
    // igual en todo el mercado y repetir la misma lista por compañía la haría imposible de mantener.
    compania: opcional(crudos.compania, 'La compañía', 120),
    cobertura: texto(crudos.cobertura, 'La cobertura', 1, 120),
    clausula: texto(crudos.clausula, 'La cláusula', 1, 200),
    ampara: crudos.ampara !== false,
    detalle: opcional(crudos.detalle, 'El detalle', 800),
  }
}

// ---------------------------------------------------------------------------
// Claves: lo que no puede repetirse en cada lista
// ---------------------------------------------------------------------------
//
// Se comparan normalizadas porque los nombres se escriben a mano y la hoja de la agencia ya trae
// «RUS» y «R.U.S.» como si fueran dos compañías. Un duplicado acá no da un error visible: da dos
// precios distintos para lo mismo, y quien atiende lee el que aparece primero.

function claveDeOrganizador(nombre: string): string {
  return normalizarTexto(nombre)
}

function claveDePrecio(compania: string, cobertura: string, rama: string | null): string {
  return [normalizarTexto(compania), normalizarTexto(cobertura), normalizarTexto(rama)].join('|')
}

function claveDeGrua(compania: string, cobertura: string): string {
  return [normalizarTexto(compania), normalizarTexto(cobertura)].join('|')
}

function claveDeClausula(compania: string | null, cobertura: string, clausula: string): string {
  return [normalizarTexto(compania), normalizarTexto(cobertura), normalizarTexto(clausula)].join('|')
}

/**
 * Traduce el choque de un UNIQUE a lo que hay que hacer para arreglarlo. Sin esto, guardar un precio
 * repetido devolvía «UNIQUE constraint failed: precios_companias.clave», que no le dice nada a nadie.
 */
function exigirClaveLibre(tabla: string, clave: string, exceptoId: number | null, aviso: string): void {
  const fila = db()
    .prepare(`SELECT id FROM ${tabla} WHERE clave = ? AND id <> ?`)
    .get(clave, exceptoId ?? 0) as { id: number } | undefined
  if (fila) throw new ErrorDeNegocio(aviso)
}

// ---------------------------------------------------------------------------
// Antigüedad: qué le ofrece cada compañía a un vehículo de ese año
// ---------------------------------------------------------------------------

/** El límite de una regla, escrito como se dice en el mostrador. */
function limiteEnPalabras(anioMinimo: number | null): string {
  return anioMinimo === null ? 'sin límite de antigüedad' : `desde el modelo ${anioMinimo}`
}

function aCoberturaSegunAntiguedad(regla: ReglaDeCobertura, anio: number | null, anioActual: number): CoberturaSegunAntiguedad {
  const minimo = anioMinimoDe(regla, anioActual)
  return {
    cobertura: regla.cobertura ?? '',
    // Sin límite cargado, la cobertura entra: es la misma decisión que toma el aviso al emitir una
    // póliza, que no advierte nada cuando la regla no dice hasta dónde llega.
    entra: minimo === null || anio === null || anio >= minimo,
    anioMinimo: minimo,
    limite: limiteEnPalabras(minimo),
    franquicia: regla.franquicia,
    observaciones: regla.observaciones,
  }
}

/**
 * El año que se consultó. Se acepta el modelo entero ('2011') y también el año escrito con dos
 * dígitos ('11'), que es como se tipea en el mostrador. Fuera de rango devuelve null y la pantalla
 * pide el año de nuevo en vez de contestar cualquier cosa.
 */
function anioConsultado(valor: unknown, anioActual: number): number | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  if (!/^\d{2}$|^\d{4}$/.test(limpio)) return null
  const numero = limpio.length === 2 ? 2000 + Number(limpio) : Number(limpio)
  if (numero < 1900 || numero > anioActual + 1) return null
  return numero
}

/**
 * Compañía por compañía, qué coberturas toman un vehículo de ese año y cuáles no.
 *
 * Es la vuelta de la misma matriz que ya avisa al emitir una póliza, leída al revés: allá se pregunta
 * «¿esta compañía me toma este auto?» con la compañía ya elegida, y acá «¿quién me toma este auto?»
 * con el auto adelante y la compañía todavía por elegir, que es la pregunta del que está cotizando.
 */
export function consultarAntiguedad(anioTexto: string): ConsultaDeAntiguedad {
  const anioActual = anioDeHoy()
  const anio = anioConsultado(anioTexto, anioActual)
  const reglas = reglasVigentes().filter((regla) => limpiar(regla.compania) && limpiar(regla.cobertura))

  const porCompania = new Map<string, { compania: string; reglas: ReglaDeCobertura[] }>()
  for (const regla of reglas) {
    const nombre = limpiar(regla.compania)
    const clave = normalizarTexto(nombre)
    const grupo = porCompania.get(clave)
    if (grupo) grupo.reglas.push(regla)
    else porCompania.set(clave, { compania: nombre, reglas: [regla] })
  }

  const companias: CompaniaSegunAntiguedad[] = [...porCompania.values()]
    .map((grupo) => {
      const evaluadas = grupo.reglas
        .map((regla) => aCoberturaSegunAntiguedad(regla, anio, anioActual))
        .sort((a, b) => comparar(a.cobertura, b.cobertura))
      return {
        compania: grupo.compania,
        acepta: evaluadas.filter((cobertura) => cobertura.entra),
        rechaza: evaluadas.filter((cobertura) => !cobertura.entra),
      }
    })
    // Arriba las que toman más coberturas: es por dónde se empieza a llamar.
    .sort((a, b) => b.acepta.length - a.acepta.length || comparar(a.compania, b.compania))

  return {
    anio,
    anioActual,
    antiguedad: anio === null ? null : anioActual - anio,
    companias,
    sinReglas: companiasSinReglas(porCompania),
  }
}

/**
 * Las compañías que la agencia ya trabaja y no tienen ni una regla cargada. Sin esta lista la pantalla
 * mentiría por omisión: «Metropol no aparece» se lee como «Metropol no toma este auto», cuando lo que
 * pasa es que nadie cargó todavía hasta qué modelo toma.
 */
function companiasSinReglas(conReglas: Map<string, { compania: string }>): string[] {
  const filas = db()
    .prepare(
      `SELECT DISTINCT compania FROM polizas
       WHERE activa = 1 AND TRIM(COALESCE(compania, '')) <> ''`,
    )
    .all() as Array<{ compania: string }>
  const faltantes = new Map<string, string>()
  for (const fila of filas) {
    const clave = normalizarTexto(fila.compania)
    if (!clave || conReglas.has(clave) || faltantes.has(clave)) continue
    faltantes.set(clave, limpiar(fila.compania))
  }
  return [...faltantes.values()].sort(comparar)
}

// ---------------------------------------------------------------------------
// Las listas enteras
// ---------------------------------------------------------------------------

/**
 * Las compañías y coberturas que ya se usan, para ofrecerlas en los formularios. Salen de la cartera
 * y de la matriz de reglas: elegir de una lista en vez de tipear es lo que evita que «RIVADAVIA» y
 * «Rivadavia Seguros» terminen siendo dos filas distintas de la misma lista de precios.
 */
function catalogos(): { companias: string[]; coberturas: string[] } {
  const base = db()
  const companias = new Map<string, string>()
  const coberturas = new Map<string, string>()
  const sumar = (mapa: Map<string, string>, valor: string | null) => {
    const limpio = limpiar(valor)
    const clave = normalizarTexto(limpio)
    if (!clave || mapa.has(clave)) return
    mapa.set(clave, limpio)
  }

  for (const fila of base
    .prepare(`SELECT DISTINCT compania, cobertura FROM polizas WHERE activa = 1`)
    .all() as Array<{ compania: string | null; cobertura: string | null }>) {
    sumar(companias, fila.compania)
    sumar(coberturas, fila.cobertura)
  }
  for (const fila of base.prepare('SELECT compania, cobertura FROM reglas_cobertura').all() as Array<{
    compania: string | null
    cobertura: string | null
  }>) {
    sumar(companias, fila.compania)
    sumar(coberturas, fila.cobertura)
  }
  // Lo que ya está cargado en estas mismas listas también cuenta: un organizador puede cotizar una
  // compañía que la agencia todavía no vendió, y esa compañía tiene que poder elegirse igual.
  for (const fila of base.prepare('SELECT compania, cobertura FROM precios_companias').all() as Array<{
    compania: string
    cobertura: string
  }>) {
    sumar(companias, fila.compania)
    sumar(coberturas, fila.cobertura)
  }
  for (const fila of base.prepare('SELECT compania, cobertura FROM gruas_companias').all() as Array<{
    compania: string
    cobertura: string
  }>) {
    sumar(companias, fila.compania)
    sumar(coberturas, fila.cobertura)
  }
  for (const fila of base.prepare('SELECT compania, cobertura FROM clausulas_coberturas').all() as Array<{
    compania: string | null
    cobertura: string
  }>) {
    sumar(companias, fila.compania)
    sumar(coberturas, fila.cobertura)
  }

  return {
    companias: [...companias.values()].sort(comparar),
    coberturas: [...coberturas.values()].sort(comparar),
  }
}

export function listasDeCompanias(actor: SesionUsuario): ListasDeCompanias {
  return {
    organizadores: listarOrganizadores(),
    precios: listarPrecios(),
    gruas: listarGruas(),
    clausulas: listarClausulas(),
    ...catalogos(),
    // Mismo criterio que la matriz de coberturas: la consulta todo el equipo, la carga una sola
    // persona. Una lista de precios que cualquiera puede tocar deja de ser una referencia.
    puedeEditar: actor.rol === 'SUPER_ADMIN' && puedeEditar(actor, 'companias'),
    anioActual: anioDeHoy(),
  }
}

// ---------------------------------------------------------------------------
// Alta, edición y baja
// ---------------------------------------------------------------------------
//
// Nada de lo que sigue llama a encolar(): estas listas no tienen pestaña en la planilla donde
// escribirse. Viajan a las otras computadoras por referenciasCompartidas.ts.

function exigirSuperAdmin(actor: SesionUsuario): void {
  if (actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('Las listas de las compañías las carga sólo el superadministrador.')
  }
}

/** El id de una fila que se está editando; falla claro si alguien la borró desde otra pantalla. */
function exigirFila(tabla: string, id: number, queEs: string): void {
  const fila = db().prepare(`SELECT id FROM ${tabla} WHERE id = ?`).get(id) as { id: number } | undefined
  if (!fila) throw new ErrorDeNegocio(`No se encontró ${queEs}. Actualizá la pantalla y probá de nuevo.`)
}

function anotar(
  actor: SesionUsuario,
  tabla: string,
  registroId: number | null,
  campo: string,
  antes: string | null,
  despues: string | null,
): void {
  registrarCambio(actor, { accion: ACCION, tabla, registroId, campo, valorAnterior: antes, valorNuevo: despues })
}

export function guardarOrganizador(id: number | null, datos: DatosDeOrganizador, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  const validado = validarOrganizador(datos)
  const clave = claveDeOrganizador(validado.nombre)
  exigirClaveLibre('organizadores', clave, id, `Ya hay un organizador cargado como «${validado.nombre}»: editá ése en lugar de cargar otro.`)

  const base = db()
  const ahora = ahoraIso()
  const valores = {
    clave,
    nombre: validado.nombre,
    companias: validado.companias,
    telefono: validado.telefono,
    email: validado.email,
    horario: validado.horario,
    observaciones: validado.observaciones,
    activo: validado.activo ? 1 : 0,
    ahora,
  }

  if (id === null) {
    // El orden nuevo va al final: quien lo cargó decide después con las flechas dónde ponerlo.
    const { siguiente } = base.prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM organizadores').get() as {
      siguiente: number
    }
    const resultado = base
      .prepare(
        `INSERT INTO organizadores (clave, nombre, companias, telefono, email, horario, observaciones, orden, activo, creado_en, actualizado_en)
         VALUES (@clave, @nombre, @companias, @telefono, @email, @horario, @observaciones, @orden, @activo, @ahora, @ahora)`,
      )
      .run({ ...valores, orden: siguiente })
    anotar(actor, 'organizadores', Number(resultado.lastInsertRowid), validado.nombre, null, resumenDeOrganizador(validado))
    return listasDeCompanias(actor)
  }

  exigirFila('organizadores', id, 'ese organizador')
  const antes = aOrganizador(base.prepare(`${SELECT_ORGANIZADORES} WHERE id = ?`).get(id) as FilaOrganizador)
  base
    .prepare(
      `UPDATE organizadores
       SET clave = @clave, nombre = @nombre, companias = @companias, telefono = @telefono, email = @email,
           horario = @horario, observaciones = @observaciones, activo = @activo, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({ ...valores, id })
  anotar(actor, 'organizadores', id, validado.nombre, resumenDeOrganizador(antes), resumenDeOrganizador(validado))
  return listasDeCompanias(actor)
}

export function borrarOrganizador(id: number, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  exigirFila('organizadores', id, 'ese organizador')
  const antes = aOrganizador(db().prepare(`${SELECT_ORGANIZADORES} WHERE id = ?`).get(id) as FilaOrganizador)
  db().prepare('DELETE FROM organizadores WHERE id = ?').run(id)
  anotar(actor, 'organizadores', id, antes.nombre, resumenDeOrganizador(antes), null)
  return listasDeCompanias(actor)
}

/**
 * Sube o baja un organizador en la lista intercambiando su orden con el de al lado. Se hace así —y no
 * renumerando todo— porque es un cambio de dos filas: si el programa se cierra en el medio, la lista
 * queda con dos organizadores en el mismo lugar, no descuajeringada.
 */
export function moverOrganizador(id: number, direccion: 'arriba' | 'abajo', actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  const lista = listarOrganizadores()
  const posicion = lista.findIndex((organizador) => organizador.id === id)
  if (posicion === -1) throw new ErrorDeNegocio('No se encontró ese organizador. Actualizá la pantalla y probá de nuevo.')

  const vecino = lista[direccion === 'arriba' ? posicion - 1 : posicion + 1]
  // Ya está primero (o último): no es un error, no hay nada que hacer.
  if (!vecino) return listasDeCompanias(actor)

  const actual = lista[posicion]!
  const base = db()
  const ahora = ahoraIso()
  const actualizar = base.prepare('UPDATE organizadores SET orden = ?, actualizado_en = ? WHERE id = ?')
  base.transaction(() => {
    // Dos organizadores pueden compartir `orden` (por ejemplo, los dos en 0 después de una adopción):
    // intercambiarlo no los movería. Se les da la posición en la lista, que siempre es distinta.
    actualizar.run(posicion, ahora, vecino.id)
    actualizar.run(direccion === 'arriba' ? posicion - 1 : posicion + 1, ahora, actual.id)
  })()

  anotar(actor, 'organizadores', actual.id, actual.nombre, `en el lugar ${posicion + 1}`, `en el lugar ${direccion === 'arriba' ? posicion : posicion + 2}`)
  return listasDeCompanias(actor)
}

/** Resumen de un precio para el historial: compañía, cobertura y cuánto. */
function resumenDePrecio(precio: { compania: string; cobertura: string; rama: string | null; precio: number }): string {
  const rama = precio.rama ? ` (${precio.rama})` : ''
  return `${precio.compania} · ${precio.cobertura}${rama} · $${precio.precio.toLocaleString('es-AR')}`
}

export function guardarPrecio(id: number | null, datos: DatosDePrecio, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  const validado = validarPrecio(datos)
  const clave = claveDePrecio(validado.compania, validado.cobertura, validado.rama)
  exigirClaveLibre(
    'precios_companias',
    clave,
    id,
    `Ya hay un precio cargado para ${validado.compania} · ${validado.cobertura}${validado.rama ? ` (${validado.rama})` : ''}: editá ése en lugar de cargar otro.`,
  )

  const base = db()
  const ahora = ahoraIso()
  const valores = {
    clave,
    compania: validado.compania,
    cobertura: validado.cobertura,
    rama: validado.rama,
    precio: validado.precio,
    vigente_desde: validado.vigenteDesde,
    observaciones: validado.observaciones,
    ahora,
  }

  if (id === null) {
    const resultado = base
      .prepare(
        `INSERT INTO precios_companias (clave, compania, cobertura, rama, precio, vigente_desde, observaciones, creado_en, actualizado_en)
         VALUES (@clave, @compania, @cobertura, @rama, @precio, @vigente_desde, @observaciones, @ahora, @ahora)`,
      )
      .run(valores)
    anotar(actor, 'precios_companias', Number(resultado.lastInsertRowid), `${validado.compania} · ${validado.cobertura}`, null, resumenDePrecio(validado))
    return listasDeCompanias(actor)
  }

  exigirFila('precios_companias', id, 'ese precio')
  const antes = aPrecio(base.prepare(`${SELECT_PRECIOS} WHERE id = ?`).get(id) as FilaPrecio)
  base
    .prepare(
      `UPDATE precios_companias
       SET clave = @clave, compania = @compania, cobertura = @cobertura, rama = @rama, precio = @precio,
           vigente_desde = @vigente_desde, observaciones = @observaciones, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({ ...valores, id })
  anotar(actor, 'precios_companias', id, `${validado.compania} · ${validado.cobertura}`, resumenDePrecio(antes), resumenDePrecio(validado))
  return listasDeCompanias(actor)
}

export function borrarPrecio(id: number, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  exigirFila('precios_companias', id, 'ese precio')
  const antes = aPrecio(db().prepare(`${SELECT_PRECIOS} WHERE id = ?`).get(id) as FilaPrecio)
  db().prepare('DELETE FROM precios_companias WHERE id = ?').run(id)
  anotar(actor, 'precios_companias', id, `${antes.compania} · ${antes.cobertura}`, resumenDePrecio(antes), null)
  return listasDeCompanias(actor)
}

function resumenDeGrua(grua: { compania: string; cobertura: string; kilometros: number | null }): string {
  return `${grua.compania} · ${grua.cobertura} · ${kilometrosEnPalabras(grua.kilometros)}`
}

export function guardarGrua(id: number | null, datos: DatosDeGrua, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  const validado = validarGrua(datos)
  const clave = claveDeGrua(validado.compania, validado.cobertura)
  exigirClaveLibre(
    'gruas_companias',
    clave,
    id,
    `Ya hay una grúa cargada para ${validado.compania} · ${validado.cobertura}: editá ésa en lugar de cargar otra.`,
  )

  const base = db()
  const ahora = ahoraIso()
  const valores = {
    clave,
    compania: validado.compania,
    cobertura: validado.cobertura,
    kilometros: validado.kilometros,
    auxilio: validado.auxilio,
    observaciones: validado.observaciones,
    ahora,
  }

  if (id === null) {
    const resultado = base
      .prepare(
        `INSERT INTO gruas_companias (clave, compania, cobertura, kilometros, auxilio, observaciones, creado_en, actualizado_en)
         VALUES (@clave, @compania, @cobertura, @kilometros, @auxilio, @observaciones, @ahora, @ahora)`,
      )
      .run(valores)
    anotar(actor, 'gruas_companias', Number(resultado.lastInsertRowid), `${validado.compania} · ${validado.cobertura}`, null, resumenDeGrua(validado))
    return listasDeCompanias(actor)
  }

  exigirFila('gruas_companias', id, 'esa grúa')
  const antes = aGrua(base.prepare(`${SELECT_GRUAS} WHERE id = ?`).get(id) as FilaGrua)
  base
    .prepare(
      `UPDATE gruas_companias
       SET clave = @clave, compania = @compania, cobertura = @cobertura, kilometros = @kilometros,
           auxilio = @auxilio, observaciones = @observaciones, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({ ...valores, id })
  anotar(actor, 'gruas_companias', id, `${validado.compania} · ${validado.cobertura}`, resumenDeGrua(antes), resumenDeGrua(validado))
  return listasDeCompanias(actor)
}

export function borrarGrua(id: number, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  exigirFila('gruas_companias', id, 'esa grúa')
  const antes = aGrua(db().prepare(`${SELECT_GRUAS} WHERE id = ?`).get(id) as FilaGrua)
  db().prepare('DELETE FROM gruas_companias WHERE id = ?').run(id)
  anotar(actor, 'gruas_companias', id, `${antes.compania} · ${antes.cobertura}`, resumenDeGrua(antes), null)
  return listasDeCompanias(actor)
}

function resumenDeClausula(clausula: { compania: string | null; cobertura: string; clausula: string; ampara: boolean }): string {
  const alcance = clausula.compania ?? 'todas las compañías'
  return `${clausula.cobertura} · ${alcance} · ${clausula.ampara ? 'ampara' : 'NO ampara'} ${clausula.clausula}`
}

export function guardarClausula(id: number | null, datos: DatosDeClausula, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  const validado = validarClausula(datos)
  const clave = claveDeClausula(validado.compania, validado.cobertura, validado.clausula)
  exigirClaveLibre(
    'clausulas_coberturas',
    clave,
    id,
    `Ya hay una cláusula «${validado.clausula}» cargada en ${validado.cobertura}${validado.compania ? ` para ${validado.compania}` : ''}: editá ésa en lugar de cargar otra.`,
  )

  const base = db()
  const ahora = ahoraIso()
  const valores = {
    clave,
    compania: validado.compania,
    cobertura: validado.cobertura,
    clausula: validado.clausula,
    ampara: validado.ampara ? 1 : 0,
    detalle: validado.detalle,
    ahora,
  }

  if (id === null) {
    // El orden es por cobertura: la cláusula nueva va al final de SU cobertura, no al final de todas.
    const { siguiente } = base
      .prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM clausulas_coberturas WHERE cobertura = ?')
      .get(validado.cobertura) as { siguiente: number }
    const resultado = base
      .prepare(
        `INSERT INTO clausulas_coberturas (clave, compania, cobertura, clausula, ampara, detalle, orden, creado_en, actualizado_en)
         VALUES (@clave, @compania, @cobertura, @clausula, @ampara, @detalle, @orden, @ahora, @ahora)`,
      )
      .run({ ...valores, orden: siguiente })
    anotar(actor, 'clausulas_coberturas', Number(resultado.lastInsertRowid), `${validado.cobertura} · ${validado.clausula}`, null, resumenDeClausula(validado))
    return listasDeCompanias(actor)
  }

  exigirFila('clausulas_coberturas', id, 'esa cláusula')
  const antes = aClausula(base.prepare(`${SELECT_CLAUSULAS} WHERE id = ?`).get(id) as FilaClausula)
  base
    .prepare(
      `UPDATE clausulas_coberturas
       SET clave = @clave, compania = @compania, cobertura = @cobertura, clausula = @clausula,
           ampara = @ampara, detalle = @detalle, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({ ...valores, id })
  anotar(actor, 'clausulas_coberturas', id, `${validado.cobertura} · ${validado.clausula}`, resumenDeClausula(antes), resumenDeClausula(validado))
  return listasDeCompanias(actor)
}

export function borrarClausula(id: number, actor: SesionUsuario): ListasDeCompanias {
  exigirSuperAdmin(actor)
  exigirFila('clausulas_coberturas', id, 'esa cláusula')
  const antes = aClausula(db().prepare(`${SELECT_CLAUSULAS} WHERE id = ?`).get(id) as FilaClausula)
  db().prepare('DELETE FROM clausulas_coberturas WHERE id = ?').run(id)
  anotar(actor, 'clausulas_coberturas', id, `${antes.cobertura} · ${antes.clausula}`, resumenDeClausula(antes), null)
  return listasDeCompanias(actor)
}
