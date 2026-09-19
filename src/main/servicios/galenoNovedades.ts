// Lo que llega de Galeno, aplicado a la cartera de la agencia.
//
// EL REPARTO DE TAREAS, Y POR QUÉ ES ASÍ
//
// El VPS consulta el portal de Galeno cada quince minutos, guarda lo que dice y calcula qué cambió.
// Eso corre allá porque el servidor está siempre encendido y tiene UNA sola credencial: si dependiera
// de que alguien abra el programa, un fin de semana largo no habría ninguna pasada.
//
// Pero el ALTA la aplica ESTA computadora, por `crearPoliza()`. Ahí viven las reglas de la agencia
// —la validación de cobertura por antigüedad, el catálogo de vehículos, los riesgos, los duplicados,
// el historial, la fila del mes— y reimplementarlas del lado del servidor sería tener dos verdades
// que empiezan iguales y divergen en tres meses.
//
// Consecuencia a tener presente: con las cinco computadoras apagadas, las novedades SE GUARDAN IGUAL
// en el VPS, pero entran a la cartera cuando alguien abre el programa. No se pierde nada y la cola se
// drena sola al abrir.
//
// LAS DOS REGLAS QUE NO SE NEGOCIAN
//
// 1. EL EMPAREJAMIENTO ES POR DOCUMENTO, NUNCA POR NOMBRE. «PEREZ JUAN» y «PEREZ, JUAN C.» son la
//    misma persona o dos distintas y no hay forma de saberlo desde el nombre. Con un solo cliente que
//    empareje por documento, el alta se aplica sola; con ninguno o con más de uno, va a la bandeja
//    para que una persona decida. Es el «mixto» que se pidió.
// 2. NINGUNA BAJA ES AUTOMÁTICA. Una póliza anulada en Galeno se marca y se avisa; `darDeBajaPoliza`
//    lo llama una persona desde la pantalla. Un error del lado de Galeno —o de este mapeo— no puede
//    borrar datos de la agencia.
import type {
  CredencialesDeGaleno,
  DatosDeCliente,
  DatosDePoliza,
  EstadoDeAjusteCompartido,
  EstadoDeGalenoNovedades,
  FilaDeBandejaDeGaleno,
  NovedadDeGaleno,
  PolizaDeGaleno,
  PruebaDeGalenoNovedades,
  ResolucionDeNovedadDeGaleno,
  ResumenDeAplicacionDeGaleno,
  ResumenDePasadaDeGaleno,
  SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { normalizarDocumento, normalizarNumeroPoliza } from '../importacion/normalizar'
import { crearCliente } from './clientes'
import { ErrorDeNegocio } from './errores'
import { crearPoliza, editarPoliza } from './polizas'
import { crearFuenteVps } from './sincronizacion'

/** El nombre con el que la agencia conoce a esta compañía en la planilla. */
const COMPANIA = 'GALENO'

function vps() {
  const fuente = crearFuenteVps()
  if (!fuente) {
    throw new ErrorDeNegocio(
      'Esta computadora no tiene configurada la base del VPS, que es donde se sincroniza Galeno.',
    )
  }
  return fuente
}

// ── Consultas ─────────────────────────────────────────────────────────────────────────────────

export async function estadoDeGaleno(): Promise<EstadoDeGalenoNovedades> {
  return vps().estadoDeGaleno()
}

export async function sincronizarGaleno(): Promise<ResumenDePasadaDeGaleno> {
  return vps().forzarPasadaDeGaleno()
}

// «GalenoNovedades» y no «Galeno» a secas: la API REST de Galeno (Administración → Galeno) ya tiene su
// propia `probarGaleno()`, que prueba OTRA credencial (la de esta computadora contra la API de Galeno,
// no el usuario del portal que consulta el VPS). Los dos módulos se importan juntos en ipc.ts.
export async function probarGalenoNovedades(): Promise<PruebaDeGalenoNovedades> {
  return vps().probarGaleno()
}

// ── La credencial ─────────────────────────────────────────────────────────────────────────────
//
// Va DERECHO al VPS y no se guarda en esta computadora, a diferencia del resto de los ajustes
// compartidos (`ajustesCompartidos.ts`). La razón es que acá ninguna computadora la usa: la usa el
// servidor, que es el que consulta Galeno. Guardar una copia en las cinco máquinas sería repartir una
// credencial que ninguna de las cinco necesita.
//
// Por eso tampoco hay `adoptar`: no hay nada que adoptar al arrancar.

export async function estadoCompartidoDeGaleno(): Promise<EstadoDeAjusteCompartido> {
  const fuente = crearFuenteVps()
  if (!fuente) return { enElServidor: false, actualizadoEn: null, actualizadoPor: null, alDia: false, error: null }
  try {
    const ficha = await fuente.estadoAjuste('galeno')
    if (!ficha) return { enElServidor: false, actualizadoEn: null, actualizadoPor: null, alDia: false, error: null }
    return {
      enElServidor: true,
      actualizadoEn: ficha.actualizadoEn,
      actualizadoPor: ficha.actualizadoPor,
      // Siempre al día: no hay copia local con la que pueda estar desfasada.
      alDia: true,
      error: null,
    }
  } catch (error) {
    return {
      enElServidor: false,
      actualizadoEn: null,
      actualizadoPor: null,
      alDia: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function guardarCredencialesDeGaleno(
  datos: CredencialesDeGaleno,
  actor: SesionUsuario,
): Promise<EstadoDeAjusteCompartido> {
  const usuario = (datos.usuario ?? '').trim()
  const clave = (datos.clave ?? '').trim()
  if (!usuario || !clave) {
    throw new ErrorDeNegocio('Hacen falta el usuario y la clave del portal de Galeno.')
  }

  await vps().guardarAjuste(
    'galeno',
    {
      usuario,
      clave,
      legajos: (datos.legajos ?? []).map((legajo) => String(legajo).trim()).filter(Boolean),
      ramas: (datos.ramas ?? []).map((rama) => String(rama).trim()).filter(Boolean),
      activo: datos.activo !== false,
    },
    actor.nombre ?? null,
  )

  return estadoCompartidoDeGaleno()
}

// ── Emparejar contra la cartera ───────────────────────────────────────────────────────────────

interface Candidato {
  clienteId: number
  nombre: string
  documento: string
}

/**
 * Los clientes que tienen ESE documento. `normalizarDocumento` hace que «20-12345678-3» y «12345678»
 * sean la misma persona, que es el mismo criterio con el que la agencia evita duplicados en el alta
 * manual (ver `crearCliente`): usar otro acá crearía justo los duplicados que ese criterio evita.
 */
function clientesConDocumento(documento: string): Candidato[] {
  const normalizado = normalizarDocumento(documento)
  if (!normalizado) return []
  return db()
    .prepare('SELECT id AS clienteId, nombre, documento FROM clientes WHERE documento_normalizado = ? ORDER BY id')
    .all(normalizado) as Candidato[]
}

/** La póliza de Galeno con ese número que ya esté cargada, si la hay. */
function polizaExistente(numero: string): number | null {
  const normalizado = normalizarNumeroPoliza(numero)
  if (!normalizado) return null
  const fila = db()
    .prepare(
      `SELECT id FROM polizas
       WHERE numero_normalizado = ? AND UPPER(compania) = ? AND activa = 1
       ORDER BY id LIMIT 1`,
    )
    .get(normalizado, COMPANIA) as { id: number } | undefined
  return fila?.id ?? null
}

/**
 * Qué se puede hacer con esta novedad, sin tocar nada todavía. La pantalla dibuja el resultado; el
 * drenado automático aplica sólo las `automatica`.
 */
export function resolverNovedad(novedad: NovedadDeGaleno): FilaDeBandejaDeGaleno {
  const poliza = novedad.datos
  const candidatos = clientesConDocumento(poliza.documento)
  const existente = polizaExistente(poliza.numeroPoliza)

  if (novedad.tipo === 'ANULACION') {
    return {
      novedad,
      resolucion: 'anulada-en-galeno',
      candidatos,
      polizaExistenteId: existente,
      detalle: existente
        ? `Galeno la anuló${poliza.fechaAnulacion ? ` el ${poliza.fechaAnulacion}` : ''}. La póliza sigue activa en la cartera.`
        : `Galeno la anuló${poliza.fechaAnulacion ? ` el ${poliza.fechaAnulacion}` : ''}. No está cargada en la cartera.`,
    }
  }

  // Una modificación sobre una póliza que ya está se aplica sola: el cliente ya está resuelto —es el
  // de la póliza— y no hay ninguna decisión que tomar.
  if (existente) {
    return {
      novedad,
      resolucion: 'automatica',
      candidatos,
      polizaExistenteId: existente,
      detalle: 'Ya está en la cartera: se actualiza con lo que dice Galeno.',
    }
  }

  if (candidatos.length === 1) {
    return {
      novedad,
      resolucion: 'automatica',
      candidatos,
      polizaExistenteId: null,
      detalle: `Se da de alta a nombre de ${candidatos[0]!.nombre}.`,
    }
  }

  if (candidatos.length === 0) {
    return {
      novedad,
      resolucion: 'falta-cliente',
      candidatos,
      polizaExistenteId: null,
      detalle: poliza.documento
        ? `No hay ningún cliente con el documento ${poliza.documento}.`
        : 'Galeno no mandó el documento del tomador.',
    }
  }

  return {
    novedad,
    resolucion: 'cliente-ambiguo',
    candidatos,
    polizaExistenteId: null,
    detalle: `Hay ${candidatos.length} clientes con ese documento: hay que elegir cuál.`,
  }
}

export async function bandejaDeGaleno(): Promise<FilaDeBandejaDeGaleno[]> {
  const novedades = await vps().pendientesDeGaleno()
  return novedades.map(resolverNovedad)
}

// ── Aplicar ───────────────────────────────────────────────────────────────────────────────────

/** Los datos de Galeno con la forma que espera `crearPoliza` / `editarPoliza`. */
function datosDePoliza(poliza: PolizaDeGaleno, clienteId: number, vehiculoId: number | null): DatosDePoliza {
  return {
    clienteId,
    vehiculoId,
    vehiculoNuevo:
      vehiculoId === null
        ? {
            patente: poliza.patente,
            marca: poliza.marca,
            modelo: poliza.modelo,
            // La versión del catálogo y el código del proveedor quedan vacíos a propósito: este
            // vehículo se tipeó desde Galeno, no se eligió del catálogo, y decir lo contrario haría
            // creer que la categoría —de la que dependen la prima y la cobertura— está verificada.
            linea: '',
            anio: poliza.anio,
            tipo: 'AUTO',
            categoria: '',
            catalogoCodigo: '',
            motor: poliza.motor,
            chasis: poliza.chasis,
            uso: '',
            color: '',
            direccionRiesgo: '',
            titularNombre: '',
            titularDocumento: '',
            integrantes: [],
          }
        : null,
    compania: COMPANIA,
    cobertura: poliza.cobertura,
    formaPago: poliza.formaPago,
    cuota: '',
    diaVencimiento: '',
    numero: poliza.numeroPoliza,
    propuesta: '',
    vigenciaDesde: poliza.vigenciaDesde,
    vigenciaHasta: poliza.vigenciaHasta,
    avisarVto: '',
    observaciones: observacionDeGaleno(poliza),
    // Nunca se confirma sola una advertencia de cobertura: si la cobertura no le corresponde a ese
    // vehículo, alguien tiene que verlo. Es lo que hace que la novedad caiga en la bandeja con el
    // motivo a la vista en vez de entrar mal a la cartera.
    confirmadoPeseAlAviso: false,
  }
}

function observacionDeGaleno(poliza: PolizaDeGaleno): string {
  const partes = ['Importada de Galeno']
  if (poliza.suplemento && poliza.suplemento !== '0') partes.push(`supl. ${poliza.suplemento}`)
  if (poliza.rama) partes.push(`rama ${poliza.rama}`)
  return partes.join(' · ')
}

function datosDeCliente(poliza: PolizaDeGaleno): DatosDeCliente {
  return {
    nombre: poliza.nombre,
    documento: poliza.documento,
    telefono: '',
    email: '',
    direccion: poliza.direccion,
    localidad: poliza.localidad,
    sucursal: '',
    fechaNacimiento: '',
    profesion: '',
    direccionDetalle: {
      calle: '',
      calle2: '',
      altura: '',
      sinAltura: false,
      localidad: poliza.localidad,
      provincia: '',
      codigoPostal: poliza.codigoPostal,
    },
  }
}

export interface PedidoDeAplicacion {
  id: number
  /** Con cuál cliente. Null quiere decir «el que emparejó solo», y para eso tiene que haber uno solo. */
  clienteId?: number | null
  /** true para crear el cliente con los datos que mandó Galeno. */
  crearElCliente?: boolean
}

/**
 * Aplicar UNA novedad.
 *
 * El orden importa y no es casual: PRIMERO se reclama la novedad contra el servidor y DESPUÉS se
 * escribe en la cartera. Al revés, dos computadoras que drenan la cola al mismo tiempo podrían crear
 * las dos la misma póliza y recién enterarse después. Si la escritura local falla, se le avisa al
 * servidor para que la novedad quede en ERROR con el motivo y se vea en la bandeja.
 */
export async function aplicarNovedad(pedido: PedidoDeAplicacion, actor: SesionUsuario): Promise<number | null> {
  const novedades = await vps().pendientesDeGaleno()
  const novedad = novedades.find((fila) => fila.id === pedido.id)
  if (!novedad) throw new ErrorDeNegocio('Esa novedad de Galeno ya no está pendiente.')

  if (novedad.tipo === 'ANULACION') {
    throw new ErrorDeNegocio(
      'Una póliza anulada en Galeno no se da de baja sola: abrí la póliza y dala de baja desde la cartera.',
    )
  }

  const fila = resolverNovedad(novedad)

  // Reclamar primero. Si otra computadora llegó antes, el servidor contesta 409 y acá no se escribe
  // nada: es toda la protección contra el alta doble.
  await vps().resolverNovedadDeGaleno({
    id: novedad.id,
    resultado: 'APLICADA',
    por: actor.nombre ?? null,
  })

  try {
    const polizaId = escribirEnLaCartera(pedido, fila, actor)
    // El id de la póliza se manda aparte: el reclamo ya pasó y esto es sólo para poder rastrearla
    // después. Que falle no invalida el alta, así que no se propaga.
    await vps()
      .resolverNovedadDeGaleno({
        id: novedad.id,
        resultado: 'APLICADA',
        por: actor.nombre ?? null,
        polizaDmgId: String(polizaId),
      })
      .catch(() => undefined)
    return polizaId
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    await vps()
      .resolverNovedadDeGaleno({ id: novedad.id, resultado: 'ERROR', por: actor.nombre ?? null, motivo })
      .catch(() => undefined)
    throw error
  }
}

function escribirEnLaCartera(pedido: PedidoDeAplicacion, fila: FilaDeBandejaDeGaleno, actor: SesionUsuario): number {
  const poliza = fila.novedad.datos

  // Ya está en la cartera: se actualiza en vez de duplicarla. Es el caso de una modificación y
  // también el de una póliza que alguien ya había cargado a mano antes de que llegara de Galeno.
  if (fila.polizaExistenteId !== null) {
    const actualizada = editarPoliza(
      fila.polizaExistenteId,
      datosDePoliza(poliza, clienteDeLaPoliza(fila.polizaExistenteId), vehiculoDeLaPoliza(fila.polizaExistenteId)),
      actor,
    )
    return actualizada.id
  }

  const clienteId = resolverCliente(pedido, fila, actor)
  return crearPoliza(datosDePoliza(poliza, clienteId, null), actor).id
}

function resolverCliente(pedido: PedidoDeAplicacion, fila: FilaDeBandejaDeGaleno, actor: SesionUsuario): number {
  if (pedido.clienteId) return pedido.clienteId

  if (pedido.crearElCliente) {
    const resultado = crearCliente(datosDeCliente(fila.novedad.datos), actor)
    // `crearCliente` no duplica por documento: si alguien lo cargó en el medio, devuelve el que ya
    // está y eso es exactamente lo que queremos.
    return resultado.creado ? resultado.cliente.id : resultado.yaExiste.id
  }

  if (fila.candidatos.length === 1) return fila.candidatos[0]!.clienteId

  throw new ErrorDeNegocio(
    fila.candidatos.length === 0
      ? 'No hay ningún cliente con ese documento: elegí uno o creá el cliente con los datos de Galeno.'
      : 'Hay más de un cliente con ese documento: elegí cuál.',
  )
}

function clienteDeLaPoliza(polizaId: number): number {
  const fila = db().prepare('SELECT cliente_id FROM polizas WHERE id = ?').get(polizaId) as
    | { cliente_id: number }
    | undefined
  if (!fila) throw new ErrorDeNegocio('La póliza que se iba a actualizar ya no está.')
  return fila.cliente_id
}

function vehiculoDeLaPoliza(polizaId: number): number | null {
  const fila = db().prepare('SELECT vehiculo_id FROM polizas WHERE id = ?').get(polizaId) as
    | { vehiculo_id: number | null }
    | undefined
  return fila?.vehiculo_id ?? null
}

export async function descartarNovedad(id: number, motivo: string, actor: SesionUsuario): Promise<void> {
  await vps().resolverNovedadDeGaleno({
    id,
    resultado: 'DESCARTADA',
    por: actor.nombre ?? null,
    motivo: motivo || null,
  })
}

/**
 * Aplicar de una sola vez todo lo que no necesita a nadie: las novedades cuyo documento emparejó con
 * un único cliente, y las modificaciones de pólizas que ya están. Es lo que corre solo cuando alguien
 * abre el programa.
 *
 * Lo que falla NO frena al resto: se cuenta y se sigue. Una póliza con un dato raro no puede dejar
 * las otras treinta sin entrar.
 */
export async function drenarGaleno(actor: SesionUsuario): Promise<ResumenDeAplicacionDeGaleno> {
  const bandeja = await bandejaDeGaleno()
  const resumen: ResumenDeAplicacionDeGaleno = { aplicadas: 0, pendientes: 0, fallidas: 0 }

  for (const fila of bandeja) {
    if (fila.resolucion !== 'automatica') {
      resumen.pendientes += 1
      continue
    }
    try {
      await aplicarNovedad({ id: fila.novedad.id }, actor)
      resumen.aplicadas += 1
    } catch (error) {
      resumen.fallidas += 1
      console.error(
        `[galeno] No se pudo aplicar la póliza ${fila.novedad.datos.numeroPoliza}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return resumen
}

/** Para la pantalla: cuántas hay de cada clase, sin bajar la cola dos veces. */
export function contarBandeja(bandeja: FilaDeBandejaDeGaleno[]): Record<ResolucionDeNovedadDeGaleno, number> {
  const cuenta: Record<ResolucionDeNovedadDeGaleno, number> = {
    automatica: 0,
    'falta-cliente': 0,
    'cliente-ambiguo': 0,
    'anulada-en-galeno': 0,
    error: 0,
  }
  for (const fila of bandeja) cuenta[fila.resolucion] += 1
  return cuenta
}
