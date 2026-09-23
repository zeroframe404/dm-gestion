// Riesgos varios: todo lo que no es automotor —combinado familiar, incendio, comercio, accidentes
// personales— tal como está en la pestaña RIESGOS VARIOS de la hoja.
//
// A diferencia de la planilla del mes, acá no hay período: es una tabla sola que se corrige encima. Por
// eso la edición es directa, celda por celda, y cada cambio viaja a la hoja por la misma cola que todo
// lo demás. El semáforo azul de TARJETA y CBU es el mismo de la Cartera: se calcula en la pantalla con
// `esDebitoAutomatico`, así la regla es una sola en toda la aplicación.
import {
  type CampoDeRiesgo,
  type DatosDeRiesgo,
  type FilaRiesgoVario,
  type ListadoRiesgos,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import {
  ahoraIso,
  generarId,
  interpretarFecha,
  interpretarNumero,
  limpiar,
  normalizarDocumento,
  normalizarPatente,
} from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { buscarPestana, nombreDePestana, pestanaDeLaFila } from './hojas'
import { sucursalesParaElegir } from './sucursales'
import { enteroPositivo, objeto, texto } from './validacion'

const NOMBRE_POR_DEFECTO = 'RIESGOS VARIOS'

function pestanaDeRiesgos(): string {
  return nombreDePestana('RIESGOS_VARIOS', NOMBRE_POR_DEFECTO)
}

/** Si la hoja no tiene una pestaña de riesgos usable, el alta se guarda igual y la pantalla lo explica. */
function hojaDeRiesgos() {
  return buscarPestana({
    tipo: 'RIESGOS_VARIOS',
    nombrePorDefecto: NOMBRE_POR_DEFECTO,
    minimos: ['nombre', 'numero_poliza'],
    encabezadosEsperados: 'LOCAL, EMISION, NOMBRE, VTO, FORMA DE PAGO, CIA, N° POLIZA, DESDE, HASTA, TEL y OBSERVACIONES',
  })
}

const SELECT_RIESGOS = `
  SELECT r.id, r.fila_id, r.cliente_id, COALESCE(r.cliente_nombre, cl.nombre) AS cliente_nombre,
         COALESCE(r.documento, cl.documento) AS documento, COALESCE(r.telefono, cl.telefono) AS telefono,
         r.sucursal_texto AS sucursal, r.emision, r.emision_iso, r.tipo_riesgo, r.descripcion, r.compania, r.numero_poliza,
         r.patente, r.prima, r.cuota, r.dia_vencimiento, r.vigencia_desde, r.vigencia_hasta,
         r.forma_pago, r.observaciones, r.creado_en_la_app
  FROM riesgos_varios r
  LEFT JOIN clientes cl ON cl.id = r.cliente_id
`

interface FilaCruda {
  id: number
  fila_id: string
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  sucursal: string | null
  emision: string | null
  emision_iso: string | null
  tipo_riesgo: string | null
  descripcion: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  prima: string | null
  cuota: string | null
  dia_vencimiento: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  forma_pago: string | null
  observaciones: string | null
  creado_en_la_app: number
}

function aFila(f: FilaCruda): FilaRiesgoVario {
  return {
    id: f.id,
    filaId: f.fila_id,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    documento: f.documento,
    telefono: f.telefono,
    sucursal: f.sucursal,
    emision: f.emision,
    emisionIso: f.emision_iso,
    tipoRiesgo: f.tipo_riesgo,
    descripcion: f.descripcion,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    patente: f.patente,
    prima: f.prima,
    cuota: f.cuota,
    diaVencimiento: f.dia_vencimiento,
    vigenciaDesde: f.vigencia_desde,
    vigenciaHasta: f.vigencia_hasta,
    formaPago: f.forma_pago,
    observaciones: f.observaciones,
    creadoEnLaApp: f.creado_en_la_app === 1,
  }
}

function todas(): FilaRiesgoVario[] {
  return (db().prepare(`${SELECT_RIESGOS} ORDER BY cliente_nombre, r.id`).all() as FilaCruda[]).map(aFila)
}

export function listarRiesgos(): ListadoRiesgos {
  const filas = todas()
  const unicos = (valores: Array<string | null>) => [...new Set(valores.map((v) => limpiar(v)).filter(Boolean))].sort()
  return {
    filas,
    total: filas.length,
    // La sucursal no sale de `unicos`: la lista también es la que se ofrece al editar la celda y al
    // dar de alta un riesgo, así que tiene que traer las cuatro de la agencia aunque ninguna fila las
    // tenga todavía —si no, en Sarandí no hay forma de cargar un riesgo a nombre de Sarandí—.
    sucursales: sucursalesParaElegir(filas.map((f) => f.sucursal)),
    companias: unicos(filas.map((f) => f.compania)),
    tiposDeRiesgo: unicos(filas.map((f) => f.tipoRiesgo)),
    // Las que ya se usan más las de siempre: la hoja acepta cualquier texto, el desplegable sólo sugiere.
    formasDePago: [...new Set([...unicos(filas.map((f) => f.formaPago)), 'CUPONERA', 'LOCAL', 'TARJETA', 'CBU', 'EFECTIVO', 'TRANSFERENCIA'])].sort(),
    avisoDeSincronizacion: hojaDeRiesgos().aviso,
  }
}

function buscarRiesgo(id: number): FilaCruda {
  const fila = db().prepare(`${SELECT_RIESGOS} WHERE r.id = ?`).get(id) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese riesgo.')
  return fila
}

// ---------------------------------------------------------------------------
// Edición directa
// ---------------------------------------------------------------------------

/** Cada columna editable: dónde se guarda, cómo se llama en la hoja y cómo se la nombra en el historial. */
const DESTINOS: Record<CampoDeRiesgo, { columna: string; campoDeLaHoja: string; nombre: string; esFecha?: boolean }> = {
  sucursal: { columna: 'sucursal_texto', campoDeLaHoja: 'sucursal', nombre: 'LOCAL' },
  emision: { columna: 'emision', campoDeLaHoja: 'emision', nombre: 'EMISION', esFecha: true },
  clienteNombre: { columna: 'cliente_nombre', campoDeLaHoja: 'nombre', nombre: 'TITULAR' },
  documento: { columna: 'documento', campoDeLaHoja: 'documento', nombre: 'DNI/CUIT' },
  telefono: { columna: 'telefono', campoDeLaHoja: 'telefono', nombre: 'TELEFONO' },
  tipoRiesgo: { columna: 'tipo_riesgo', campoDeLaHoja: 'tipo_riesgo', nombre: 'RIESGO' },
  descripcion: { columna: 'descripcion', campoDeLaHoja: 'descripcion', nombre: 'DETALLE' },
  compania: { columna: 'compania', campoDeLaHoja: 'compania', nombre: 'COMPAÑIA' },
  numeroPoliza: { columna: 'numero_poliza', campoDeLaHoja: 'numero_poliza', nombre: 'POLIZA' },
  patente: { columna: 'patente', campoDeLaHoja: 'patente', nombre: 'PATENTE' },
  prima: { columna: 'prima', campoDeLaHoja: 'prima', nombre: 'PRIMA' },
  cuota: { columna: 'cuota', campoDeLaHoja: 'cuota', nombre: 'CUOTA' },
  diaVencimiento: { columna: 'dia_vencimiento', campoDeLaHoja: 'dia_vencimiento', nombre: 'DIA DE VTO' },
  formaPago: { columna: 'forma_pago', campoDeLaHoja: 'forma_pago', nombre: 'FORMA DE PAGO' },
  vigenciaDesde: { columna: 'vigencia_desde', campoDeLaHoja: 'vigencia_desde', nombre: 'DESDE' },
  vigenciaHasta: { columna: 'vigencia_hasta', campoDeLaHoja: 'vigencia_hasta', nombre: 'HASTA' },
  observaciones: { columna: 'observaciones', campoDeLaHoja: 'observaciones', nombre: 'OBSERVACIONES' },
}

/** Nombre de la propiedad de la fila leída que corresponde a cada columna. */
function comoSeLee(columna: string): string {
  return columna === 'sucursal_texto' ? 'sucursal' : columna
}

export function editarRiesgo(riesgoId: number, campo: unknown, valor: unknown, actor: SesionUsuario): FilaRiesgoVario {
  const clave = limpiar(campo) as CampoDeRiesgo
  const destino = DESTINOS[clave]
  if (!destino) throw new ErrorDeNegocio('Esa columna no se puede editar.')
  const fila = buscarRiesgo(enteroPositivo(riesgoId, 'El riesgo'))
  const nuevo = limpiar(valor).slice(0, 500)
  const anterior = limpiar((fila as unknown as Record<string, unknown>)[comoSeLee(destino.columna)])
  if (nuevo === anterior) return aFila(fila)

  const derivadas: Record<string, string | number | null> = {}
  if (destino.esFecha && nuevo) {
    const anio = new Date().getFullYear()
    const fecha = interpretarFecha(nuevo, anio, anio)
    if (!fecha.iso) throw new ErrorDeNegocio(`«${nuevo}» no es una fecha válida. Usá el formato día/mes/año.`)
    derivadas[`${destino.columna}_iso`] = fecha.iso
  } else if (destino.esFecha) {
    derivadas[`${destino.columna}_iso`] = null
  }
  if (clave === 'cuota') derivadas.cuota_monto = interpretarNumero(nuevo)

  const asignaciones = [`${destino.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`)]
  db()
    .prepare(`UPDATE riesgos_varios SET ${asignaciones.join(', ')}, actualizado_en = @ahora WHERE id = @id`)
    .run({ valor: nuevo || null, ...derivadas, ahora: ahoraIso(), id: fila.id })

  // A la pestaña donde el riesgo VIVE, no a la principal del tipo: con dos pestañas de riesgos la
  // corrección de una fila de la segunda encolaba contra la primera y la subida no la encontraba.
  const pestana = pestanaDeLaFila(fila.fila_id, 'RIESGOS_VARIOS', NOMBRE_POR_DEFECTO)
  encolar({ operacion: 'actualizar', pestana, filaId: fila.fila_id, campos: { [destino.campoDeLaHoja]: nuevo } }, actor)
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'riesgos_varios',
    registroId: fila.id,
    filaId: fila.fila_id,
    campo: destino.nombre,
    valorAnterior: anterior || null,
    valorNuevo: nuevo || null,
  })
  return aFila(buscarRiesgo(fila.id))
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/**
 * Alta simple: el titular y la compañía son lo único obligatorio. Todo lo demás se completa después
 * editando la celda, igual que en la hoja, porque un riesgo se carga apenas se vende y los papeles
 * (número de póliza, vigencias) llegan más tarde.
 */
export function crearRiesgo(datos: DatosDeRiesgo, actor: SesionUsuario): ListadoRiesgos {
  const d = objeto(datos, 'Los datos del riesgo')
  const nombre = texto(d.clienteNombre, 'El titular', 1, 160)
  const compania = texto(d.compania, 'La compañía', 1, 80)

  const emisionEscrita = limpiar(d.emision)
  let emisionIso: string | null = null
  if (emisionEscrita) {
    const anio = new Date().getFullYear()
    const fecha = interpretarFecha(emisionEscrita, anio, anio)
    if (!fecha.iso) throw new ErrorDeNegocio(`«${emisionEscrita}» no es una fecha de emisión válida.`)
    emisionIso = fecha.iso
  }

  const cuota = limpiar(d.cuota)
  const patente = limpiar(d.patente)
  const filaId = generarId()
  const pestana = pestanaDeRiesgos()
  const ahora = ahoraIso()

  // Si el titular ya es cliente de la agencia, el riesgo queda colgado de su ficha.
  const documento = limpiar(d.documento)
  const cliente = db()
    .prepare(`SELECT id FROM clientes WHERE (@documento <> '' AND documento_normalizado = @documento) OR UPPER(nombre) = @nombre LIMIT 1`)
    .get({ documento: normalizarDocumento(documento), nombre: nombre.toUpperCase() }) as { id: number } | undefined

  const valores = {
    fila_id: filaId,
    pestana,
    cliente_id: cliente?.id ?? null,
    cliente_nombre: nombre,
    documento: documento || null,
    telefono: limpiar(d.telefono) || null,
    sucursal_texto: limpiar(d.sucursal) || actor.sucursal.nombre,
    emision: emisionEscrita || null,
    emision_iso: emisionIso,
    tipo_riesgo: limpiar(d.tipoRiesgo) || null,
    descripcion: limpiar(d.descripcion) || null,
    compania,
    numero_poliza: limpiar(d.numeroPoliza) || null,
    patente: patente ? normalizarPatente(patente) || patente : null,
    prima: limpiar(d.prima) || null,
    cuota: cuota || null,
    cuota_monto: interpretarNumero(cuota),
    dia_vencimiento: limpiar(d.diaVencimiento) || null,
    forma_pago: limpiar(d.formaPago) || null,
    vigencia_desde: limpiar(d.vigenciaDesde) || null,
    vigencia_hasta: limpiar(d.vigenciaHasta) || null,
    observaciones: limpiar(d.observaciones) || null,
    ahora,
  }

  const id = db().transaction(() => {
    const resultado = db()
      .prepare(
        `INSERT INTO riesgos_varios (fila_id, pestana, cliente_id, cliente_nombre, documento, telefono, sucursal_texto,
                                     emision, emision_iso, tipo_riesgo, descripcion, compania, numero_poliza, patente,
                                     prima, cuota, cuota_monto, dia_vencimiento, forma_pago, vigencia_desde, vigencia_hasta,
                                     observaciones, creado_en_la_app, creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @cliente_id, @cliente_nombre, @documento, @telefono, @sucursal_texto,
                 @emision, @emision_iso, @tipo_riesgo, @descripcion, @compania, @numero_poliza, @patente,
                 @prima, @cuota, @cuota_monto, @dia_vencimiento, @forma_pago, @vigencia_desde, @vigencia_hasta,
                 @observaciones, 1, @ahora, @ahora)`,
      )
      .run(valores)
    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'RIESGOS_VARIOS', periodo: null })
    return Number(resultado.lastInsertRowid)
  })()

  encolar(
    {
      operacion: 'crear',
      pestana,
      filaId,
      campos: {
        sucursal: valores.sucursal_texto ?? '',
        emision: valores.emision ?? '',
        nombre,
        documento: valores.documento ?? '',
        telefono: valores.telefono ?? '',
        tipo_riesgo: valores.tipo_riesgo ?? '',
        descripcion: valores.descripcion ?? '',
        compania,
        numero_poliza: valores.numero_poliza ?? '',
        patente: valores.patente ?? '',
        prima: valores.prima ?? '',
        cuota: valores.cuota ?? '',
        dia_vencimiento: valores.dia_vencimiento ?? '',
        forma_pago: valores.forma_pago ?? '',
        vigencia_desde: valores.vigencia_desde ?? '',
        vigencia_hasta: valores.vigencia_hasta ?? '',
        observaciones: valores.observaciones ?? '',
      },
    },
    actor,
  )

  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'riesgos_varios',
    registroId: id,
    filaId,
    campo: 'RIESGO NUEVO',
    valorAnterior: null,
    valorNuevo: `${nombre} · ${compania}${valores.tipo_riesgo ? ` · ${valores.tipo_riesgo}` : ''}`,
  })
  return listarRiesgos()
}
