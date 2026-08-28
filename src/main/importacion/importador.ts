// Orquestador de la importación. No depende de Electron: recibe la base y una FuenteHoja, así se puede
// probar en Node contra un servidor simulado.
//
// Reglas de negocio que implementa:
//  - La planilla mensual más NUEVA define el estado actual: de ella salen clientes, vehículos y pólizas activas.
//  - Las planillas más viejas sólo aportan sus cuotas_mes; las pestañas de bajas, sus bajas históricas.
//  - Cliente único por DNI/CUIT (si se repite, se unifica y se guardan todas sus pólizas).
//  - Los valores se guardan tal cual; sólo se limpian espacios sobrantes al comparar.
//  - Cada fila recibe un _ID estable en la hoja; re-importar no duplica nada.
//  - Los datos raros se registran en el informe y NO frenan la importación.
import type { BaseDeDatos } from '../db/base'
import { claveDeSucursal, sucursalCanonica, sucursalesEnTexto } from '../../shared/sucursales'
import {
  NOMBRE_TIPO_PESTANA,
  type EstadoImportacion,
  type EstadoPestanaImportada,
  type InformeImportacion,
  type ProblemaImportacion,
  type ProgresoImportacion,
  type ProgresoPestana,
  type ResumenPestana,
  type TipoPestana,
  type TotalesImportacion,
} from '../../shared/tipos'
import {
  columnaIdPorContenido,
  columnaLibreParaId,
  repiteEncabezados,
  ENCABEZADO_ID,
  mapearEncabezados,
  type Campo,
  type MapeoDeColumnas,
} from './encabezados'
import type { FuenteHoja, PestanaDeHoja } from './fuente'
import {
  ahoraIso,
  esTextoDeCuotaConocido,
  generarId,
  interpretarAviso,
  interpretarDiaDeVencimiento,
  interpretarEntero,
  interpretarFecha,
  interpretarFechaDePeriodo,
  interpretarNumero,
  letraColumna,
  limpiar,
  normalizarDocumento,
  normalizarNumeroPoliza,
  normalizarPatente,
  normalizarTexto,
  esMarcadorDeSinPatente,
} from './normalizar'
import {
  FILAS_PARA_ENCABEZADOS,
  resolverLayouts,
  TIPOS_CON_MAPEO,
  type Layout,
  type PestanaParaLayout,
} from './layouts'
import { clasificarPestanas, periodoDesdeTextoDeMes, revisarCoherenciaDePeriodos, type PestanaClasificada } from './pestanas'
import { huellaDeFila } from '../sincronizacion/hoja'

export interface OpcionesImportacion {
  db: BaseDeDatos
  fuente: FuenteHoja
  importacionId: number
  alProgresar?: (progreso: ProgresoImportacion) => void
  estaCancelada?: () => boolean
  anioActual?: number
}

/** Cantidad máxima de problemas que se listan uno por uno; el resto sólo se cuenta. */
const LIMITE_PROBLEMAS_LISTADOS = 3000

/** Cuántos problemas del MISMO tipo se listan uno por uno (el resto sólo se cuenta). */
const LIMITE_PROBLEMAS_POR_TIPO = 200

type PestanaTrabajo = PestanaDeHoja & PestanaClasificada

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function oNulo(texto: string): string | null {
  return texto === '' ? null : texto
}

/** Una fila de datos con acceso por campo (según el mapeo de encabezados de su pestaña). */
class Fila {
  constructor(
    private readonly mapeo: MapeoDeColumnas,
    readonly celdas: string[],
    /** Número de fila en la hoja (la 1 es el encabezado). */
    readonly numero: number,
    readonly id: string,
    /** Columna donde va el _ID de esta pestaña (no cuenta como dato de la fila). */
    readonly columnaDelId: number = -1,
  ) {}

  /**
   * Valor del campo. Si varias columnas caen en el mismo campo hay dos casos:
   *  - se suman (APELLIDO + NOMBRE, dos OBS): se concatenan en orden;
   *  - son alternativas (DNI + CUIT, PAGO + FECHA DE PAGO): se usa la primera que tenga algo.
   */
  valor(campo: Campo): string {
    const indice = this.mapeo.porCampo.get(campo)
    if (indice === undefined) return ''
    let principal = limpiar(this.celdas[indice])
    if (!principal) {
      for (const alternativa of this.mapeo.alternativas.get(campo) ?? []) {
        const valor = limpiar(this.celdas[alternativa])
        if (valor) {
          principal = valor
          break
        }
      }
    }
    const extras = this.mapeo.extras.get(campo)
    if (!extras || extras.length === 0) return principal
    const separador = campo === 'nombre' ? ' ' : ' | '
    return [principal, ...extras.map((i) => limpiar(this.celdas[i]))].filter(Boolean).join(separador)
  }

  /** true si la fila repite el texto de los encabezados (pasa cuando se repite el título a mitad de la hoja). */
  repiteLosEncabezados(): boolean {
    return repiteEncabezados(this.celdas, this.mapeo.encabezados)
  }

  /** true si la pestaña tiene una columna para ese campo (aunque esta fila la tenga vacía). */
  tieneColumna(campo: Campo): boolean {
    return this.mapeo.porCampo.has(campo)
  }

  /** true si el mapeo de la pestaña no reconoció ninguna columna. */
  sinMapeo(): boolean {
    return this.mapeo.porCampo.size === 0
  }

  /** true si ninguna columna mapeada tiene algo cargado en esta fila. */
  sinCamposMapeados(): boolean {
    for (const indice of this.mapeo.porCampo.values()) if (limpiar(this.celdas[indice])) return false
    return true
  }

  /** Todas las celdas tal cual, por encabezado original. Las columnas sin encabezado van como "(columna X)". */
  crudo(): Record<string, string> {
    const datos: Record<string, string> = {}
    const cantidad = Math.max(this.mapeo.encabezados.length, this.celdas.length)
    for (let i = 0; i < cantidad; i++) {
      if (i === this.columnaDelId || this.mapeo.columnasId.includes(i)) continue
      const encabezado = this.mapeo.encabezados[i] ?? ''
      const valor = this.celdas[i] ?? ''
      if (!encabezado && valor === '') continue
      let clave = encabezado || `(columna ${letraColumna(i)})`
      if (clave in datos) clave = `${clave} (${letraColumna(i)})`
      datos[clave] = valor
    }
    return datos
  }
}

interface Identidad {
  nombre: string
  nombreNormalizado: string
  documento: string
  documentoNormalizado: string
  documentoValido: boolean
  patente: string
  patenteNormalizada: string
  compania: string
  companiaNormalizada: string
  numero: string
  numeroNormalizado: string
  numeroValido: boolean
}

/**
 * Sentencias para «anclar» un registro al _ID de la fila que lo originó. Si la clave calculada cambia
 * (se corrigió el DNI, se patentó un 0KM, la póliza recibió número) se renombra el registro existente
 * en vez de crear uno nuevo al lado.
 */
function sentenciasDeAncla(db: BaseDeDatos, tabla: 'clientes' | 'vehiculos' | 'polizas') {
  return {
    porFila: db.prepare(`SELECT id, clave FROM ${tabla} WHERE fila_id = ?`),
    porClave: db.prepare(`SELECT id FROM ${tabla} WHERE clave = ?`),
    renombrar: db.prepare(`UPDATE ${tabla} SET clave = @clave, actualizado_en = @ahora WHERE id = @id`),
    soltarFila: db.prepare(`UPDATE ${tabla} SET fila_id = NULL WHERE id = ?`),
  }
}

type SentenciasDeAncla = ReturnType<typeof sentenciasDeAncla>

function prepararSentencias(db: BaseDeDatos) {
  return {
    anclaClientes: sentenciasDeAncla(db, 'clientes'),
    anclaVehiculos: sentenciasDeAncla(db, 'vehiculos'),
    anclaPolizas: sentenciasDeAncla(db, 'polizas'),
    filaCruda: db.prepare(`
      INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, importacion_id, en_la_hoja, vista_en, sheet_id, huella, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @tipo_pestana, @periodo, @numero_fila, @datos_json, @importacion_id, 1, @ahora, @sheet_id, @huella, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, tipo_pestana = excluded.tipo_pestana, periodo = excluded.periodo,
        numero_fila = excluded.numero_fila, datos_json = excluded.datos_json,
        importacion_id = excluded.importacion_id, en_la_hoja = 1, vista_en = excluded.vista_en,
        sheet_id = excluded.sheet_id, huella = excluded.huella,
        actualizado_en = excluded.actualizado_en`),

    // Filas que estaban en esta pestaña y ya no aparecen: se marcan, nunca se borran.
    marcarFilasQueYaNoEstan: db.prepare(`
      UPDATE filas_crudas SET en_la_hoja = 0
      WHERE pestana = @pestana AND en_la_hoja = 1 AND (vista_en IS NULL OR vista_en <> @ahora)`),

    /** En qué pestaña se registró un _ID: sirve para saber quién es el dueño cuando aparece repetido. */
    pestanaDeFila: db.prepare('SELECT pestana FROM filas_crudas WHERE fila_id = ?'),

    // Primera vez que aparece el cliente en esta corrida: lo que dice la planilla más nueva manda.
    clienteCompleto: db.prepare(`
      INSERT INTO clientes (clave, documento, documento_normalizado, nombre, telefono, email, direccion, localidad,
                            sucursal_id, sucursal_texto, fecha_nacimiento, fila_id, pestana_origen, creado_en, actualizado_en)
      VALUES (@clave, @documento, @documento_normalizado, @nombre, @telefono, @email, @direccion, @localidad,
              @sucursal_id, @sucursal_texto, @fecha_nacimiento, @fila_id, @pestana_origen, @ahora, @ahora)
      ON CONFLICT(clave) DO UPDATE SET
        documento = COALESCE(excluded.documento, clientes.documento),
        documento_normalizado = COALESCE(excluded.documento_normalizado, clientes.documento_normalizado),
        nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE clientes.nombre END,
        telefono = COALESCE(excluded.telefono, clientes.telefono),
        email = COALESCE(excluded.email, clientes.email),
        direccion = COALESCE(excluded.direccion, clientes.direccion),
        localidad = COALESCE(excluded.localidad, clientes.localidad),
        -- El texto manda, pero el id sólo se pisa si se pudo resolver: una sucursal escrita como no
        -- está en el catálogo devuelve texto sin id (ver resolverSucursal), y con el CASE de antes ese
        -- texto borraba el id que ya estaba bien resuelto.
        sucursal_id = COALESCE(excluded.sucursal_id, clientes.sucursal_id),
        sucursal_texto = COALESCE(excluded.sucursal_texto, clientes.sucursal_texto),
        fecha_nacimiento = COALESCE(excluded.fecha_nacimiento, clientes.fecha_nacimiento),
        fila_id = excluded.fila_id, pestana_origen = excluded.pestana_origen, actualizado_en = excluded.actualizado_en
      RETURNING id`),

    // Un cliente que existía sólo por nombre recibe su documento (en vez de crear un duplicado).
    migrarClaveCliente: db.prepare(`
      UPDATE clientes SET clave = @clave, documento = @documento, documento_normalizado = @documento_normalizado, actualizado_en = @ahora
      WHERE id = @id AND (documento_normalizado IS NULL OR documento_normalizado = '')`),

    // Filas siguientes del mismo cliente en la corrida (otra póliza): sólo completan lo que falta.
    clienteCompletar: db.prepare(`
      UPDATE clientes SET
        nombre = CASE WHEN nombre = '' THEN @nombre ELSE nombre END,
        telefono = COALESCE(telefono, @telefono),
        email = COALESCE(email, @email),
        direccion = COALESCE(direccion, @direccion),
        localidad = COALESCE(localidad, @localidad),
        sucursal_id = COALESCE(sucursal_id, @sucursal_id),
        sucursal_texto = COALESCE(sucursal_texto, @sucursal_texto),
        fecha_nacimiento = COALESCE(fecha_nacimiento, @fecha_nacimiento)
      WHERE id = @id`),

    /**
     * Completa la sucursal de un cliente que no la tiene. Sólo rellena el hueco: nunca pisa una
     * sucursal ya cargada. Hace falta porque `guardarCliente` corre únicamente para la planilla MÁS
     * NUEVA, y si a esa pestaña le falta la columna LOCAL —el caso de un mes recién duplicado a mano—
     * ningún cliente llega a tener sucursal, ni siquiera los que sí la tienen en los meses anteriores.
     */
    completarSucursalDelCliente: db.prepare(`
      UPDATE clientes SET
        sucursal_id = COALESCE(sucursal_id, @sucursal_id),
        sucursal_texto = @sucursal_texto
      WHERE id = @id AND (sucursal_texto IS NULL OR TRIM(sucursal_texto) = '')`),

    clientePorClave: db.prepare('SELECT id FROM clientes WHERE clave = ?'),
    titularDeVehiculo: db.prepare('SELECT cliente_id FROM vehiculos WHERE clave = ?'),

    vehiculo: db.prepare(`
      INSERT INTO vehiculos (clave, patente, patente_normalizada, marca, modelo, anio, anio_numero, motor, chasis, tipo, uso, color,
                             suma_asegurada, cliente_id, fila_id, creado_en, actualizado_en)
      VALUES (@clave, @patente, @patente_normalizada, @marca, @modelo, @anio, @anio_numero, @motor, @chasis, @tipo, @uso, @color,
              @suma_asegurada, @cliente_id, @fila_id, @ahora, @ahora)
      ON CONFLICT(clave) DO UPDATE SET
        patente = COALESCE(excluded.patente, vehiculos.patente),
        patente_normalizada = COALESCE(excluded.patente_normalizada, vehiculos.patente_normalizada),
        marca = COALESCE(excluded.marca, vehiculos.marca),
        modelo = COALESCE(excluded.modelo, vehiculos.modelo),
        anio = COALESCE(excluded.anio, vehiculos.anio),
        anio_numero = COALESCE(excluded.anio_numero, vehiculos.anio_numero),
        motor = COALESCE(excluded.motor, vehiculos.motor),
        chasis = COALESCE(excluded.chasis, vehiculos.chasis),
        tipo = COALESCE(excluded.tipo, vehiculos.tipo),
        uso = COALESCE(excluded.uso, vehiculos.uso),
        color = COALESCE(excluded.color, vehiculos.color),
        suma_asegurada = COALESCE(excluded.suma_asegurada, vehiculos.suma_asegurada),
        cliente_id = COALESCE(excluded.cliente_id, vehiculos.cliente_id),
        fila_id = excluded.fila_id, actualizado_en = excluded.actualizado_en
      RETURNING id`),

    poliza: db.prepare(`
      INSERT INTO polizas (clave, fila_id, cliente_id, vehiculo_id, compania, numero, numero_normalizado, cobertura, prima, prima_monto,
                           forma_pago, productor, estado_texto, vigencia_desde, vigencia_hasta, vigencia_desde_iso, vigencia_hasta_iso,
                           alta, avisar_vto, observaciones, periodo_origen, pestana_origen,
                           activa, creado_en, actualizado_en)
      VALUES (@clave, @fila_id, @cliente_id, @vehiculo_id, @compania, @numero, @numero_normalizado, @cobertura, @prima, @prima_monto,
              @forma_pago, @productor, @estado_texto, @vigencia_desde, @vigencia_hasta, @vigencia_desde_iso, @vigencia_hasta_iso,
              @alta, @avisar_vto, @observaciones, @periodo_origen, @pestana_origen,
              1, @ahora, @ahora)
      ON CONFLICT(clave) DO UPDATE SET
        fila_id = excluded.fila_id, cliente_id = excluded.cliente_id, vehiculo_id = excluded.vehiculo_id,
        compania = excluded.compania, numero = excluded.numero, numero_normalizado = excluded.numero_normalizado,
        cobertura = excluded.cobertura, prima = excluded.prima, prima_monto = excluded.prima_monto,
        forma_pago = excluded.forma_pago, productor = excluded.productor, estado_texto = excluded.estado_texto,
        vigencia_desde = excluded.vigencia_desde, vigencia_hasta = excluded.vigencia_hasta,
        vigencia_desde_iso = excluded.vigencia_desde_iso, vigencia_hasta_iso = excluded.vigencia_hasta_iso,
        alta = excluded.alta, avisar_vto = excluded.avisar_vto, observaciones = excluded.observaciones,
        periodo_origen = excluded.periodo_origen, pestana_origen = excluded.pestana_origen,
        activa = 1, actualizado_en = excluded.actualizado_en
      RETURNING id`),

    polizasParaIndice: db.prepare(`
      SELECT p.id, p.clave, p.numero_normalizado, v.patente_normalizada, c.documento_normalizado
      FROM polizas p
      LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
      LEFT JOIN clientes c ON c.id = p.cliente_id`),

    inactivarPolizas: db.prepare(`UPDATE polizas SET activa = 0, actualizado_en = @ahora WHERE activa = 1 AND actualizado_en <> @ahora`),

    cuota: db.prepare(`
      INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania, numero_poliza, patente,
                              sucursal_texto, cuota, cuota_monto, dia_vencimiento, dia_vencimiento_numero, aviso, aviso_enviado, pago, pago_fecha,
                              observaciones, forma_pago, fecha_envio, avisar_vto, creado_en, actualizado_en)
      VALUES (@fila_id, @periodo, @pestana, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania, @numero_poliza, @patente,
              @sucursal_texto, @cuota, @cuota_monto, @dia_vencimiento, @dia_vencimiento_numero, @aviso, @aviso_enviado, @pago, @pago_fecha,
              @observaciones, @forma_pago, @fecha_envio, @avisar_vto, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        periodo = excluded.periodo, pestana = excluded.pestana,
        poliza_id = COALESCE(excluded.poliza_id, cuotas_mes.poliza_id), cliente_id = COALESCE(excluded.cliente_id, cuotas_mes.cliente_id),
        cliente_nombre = excluded.cliente_nombre, documento = excluded.documento, compania = excluded.compania,
        numero_poliza = excluded.numero_poliza, patente = excluded.patente,
        -- Una pestaña SIN columna de sucursal no sabe nada de sucursales: no puede borrar la que ya
        -- estaba. Fila.valor() devuelve '' tanto si la columna no existe como si la celda está vacía y
        -- oNulo() convierte las dos en NULL, así que sin este CASE una hoja a la que le falta la
        -- columna LOCAL dejaba sin sucursal, en silencio, a todas las filas que ya la tenían.
        sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE cuotas_mes.sucursal_texto END,
        cuota = excluded.cuota, cuota_monto = excluded.cuota_monto, dia_vencimiento = excluded.dia_vencimiento,
        dia_vencimiento_numero = excluded.dia_vencimiento_numero, aviso = excluded.aviso, aviso_enviado = excluded.aviso_enviado,
        pago = excluded.pago, pago_fecha = excluded.pago_fecha, observaciones = excluded.observaciones,
        forma_pago = excluded.forma_pago, fecha_envio = excluded.fecha_envio, avisar_vto = excluded.avisar_vto,
        actualizado_en = excluded.actualizado_en`),

    baja: db.prepare(`
      INSERT INTO bajas (fila_id, pestana, periodo, mes_texto, poliza_id, cliente_id, cliente_nombre, documento, compania, numero_poliza,
                         patente, sucursal_texto, motivo, fecha_baja, fecha_baja_iso, observaciones, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @periodo, @mes_texto, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania, @numero_poliza,
              @patente, @sucursal_texto, @motivo, @fecha_baja, @fecha_baja_iso, @observaciones, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, periodo = excluded.periodo, mes_texto = excluded.mes_texto,
        poliza_id = COALESCE(excluded.poliza_id, bajas.poliza_id), cliente_id = COALESCE(excluded.cliente_id, bajas.cliente_id), cliente_nombre = excluded.cliente_nombre, documento = excluded.documento,
        compania = excluded.compania, numero_poliza = excluded.numero_poliza, patente = excluded.patente,
        sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE bajas.sucursal_texto END, motivo = excluded.motivo,
        fecha_baja = excluded.fecha_baja, fecha_baja_iso = excluded.fecha_baja_iso, observaciones = excluded.observaciones,
        actualizado_en = excluded.actualizado_en`),

    // Los avisos de rechazo del débito. Es la única pestaña APP que se lee de vuelta a su tabla, y es
    // lo que hace que el aviso cargado en una sucursal llegue a la computadora de la otra. Lo que ya se
    // sabe acá manda sobre lo que trae la hoja salvo en el estado, que es justamente lo que la otra
    // sucursal cambia (COALESCE al revés dejaría un aviso resuelto como pendiente para siempre).
    rechazo: db.prepare(`
      INSERT INTO rechazos_debito (fila_id, pestana, poliza_id, cliente_id, cliente_nombre, documento, telefono, compania,
                                   numero_poliza, patente, forma_pago, cuota, periodo, sucursal_texto, motivo, nota,
                                   estado, fecha, avisado_por, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @poliza_id, @cliente_id, @cliente_nombre, @documento, @telefono, @compania,
              @numero_poliza, @patente, @forma_pago, @cuota, @periodo, @sucursal_texto, @motivo, @nota,
              @estado, @fecha, @avisado_por, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana,
        poliza_id = COALESCE(excluded.poliza_id, rechazos_debito.poliza_id),
        cliente_id = COALESCE(excluded.cliente_id, rechazos_debito.cliente_id),
        cliente_nombre = excluded.cliente_nombre, documento = excluded.documento, telefono = excluded.telefono,
        compania = excluded.compania, numero_poliza = excluded.numero_poliza, patente = excluded.patente,
        forma_pago = excluded.forma_pago, cuota = excluded.cuota, periodo = excluded.periodo,
        sucursal_texto = excluded.sucursal_texto, motivo = excluded.motivo, nota = excluded.nota,
        estado = excluded.estado, fecha = excluded.fecha, avisado_por = excluded.avisado_por,
        actualizado_en = excluded.actualizado_en`),

    riesgo: db.prepare(`
      INSERT INTO riesgos_varios (fila_id, pestana, cliente_id, cliente_nombre, documento, telefono, sucursal_texto, emision, emision_iso,
                                  tipo_riesgo, descripcion,
                                  compania, numero_poliza, patente, prima, cuota, cuota_monto, dia_vencimiento, aviso, pago,
                                  vigencia_desde, vigencia_hasta, forma_pago, observaciones, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @cliente_id, @cliente_nombre, @documento, @telefono, @sucursal_texto, @emision, @emision_iso,
              @tipo_riesgo, @descripcion,
              @compania, @numero_poliza, @patente, @prima, @cuota, @cuota_monto, @dia_vencimiento, @aviso, @pago,
              @vigencia_desde, @vigencia_hasta, @forma_pago, @observaciones, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, cliente_id = excluded.cliente_id, cliente_nombre = excluded.cliente_nombre, documento = excluded.documento,
        telefono = excluded.telefono, sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE riesgos_varios.sucursal_texto END, emision = excluded.emision, emision_iso = excluded.emision_iso,
        tipo_riesgo = excluded.tipo_riesgo,
        descripcion = excluded.descripcion, compania = excluded.compania, numero_poliza = excluded.numero_poliza, patente = excluded.patente,
        prima = excluded.prima, cuota = excluded.cuota, cuota_monto = excluded.cuota_monto, dia_vencimiento = excluded.dia_vencimiento,
        aviso = excluded.aviso, pago = excluded.pago, vigencia_desde = excluded.vigencia_desde, vigencia_hasta = excluded.vigencia_hasta,
        forma_pago = excluded.forma_pago, observaciones = excluded.observaciones, actualizado_en = excluded.actualizado_en`),

    amp: db.prepare(`
      INSERT INTO amp (fila_id, pestana, cliente_id, poliza_id, sucursal_texto, fecha, fecha_iso, cliente_nombre, documento, telefono,
                       forma_pago, patente, marca, modelo, compania, numero_poliza, detalle, vencimiento, vencimiento_iso,
                       observaciones, resuelto, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @sucursal_texto, @fecha, @fecha_iso, @cliente_nombre, @documento, @telefono,
              @forma_pago, @patente, @marca, @modelo, @compania, @numero_poliza, @detalle, @vencimiento, @vencimiento_iso,
              @observaciones, @resuelto, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, cliente_id = COALESCE(excluded.cliente_id, amp.cliente_id),
        poliza_id = COALESCE(excluded.poliza_id, amp.poliza_id), sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE amp.sucursal_texto END,
        fecha = excluded.fecha, fecha_iso = excluded.fecha_iso, cliente_nombre = excluded.cliente_nombre,
        documento = excluded.documento, telefono = excluded.telefono, forma_pago = excluded.forma_pago,
        patente = excluded.patente, marca = excluded.marca, modelo = excluded.modelo, compania = excluded.compania,
        numero_poliza = excluded.numero_poliza, detalle = excluded.detalle, vencimiento = excluded.vencimiento,
        vencimiento_iso = excluded.vencimiento_iso, observaciones = excluded.observaciones,
        -- El tilde de «resuelto» sólo lo manda la hoja si la pestaña TIENE esa columna. Cuando no la
        -- tiene, la lista se lleva en DM Gestión y una importación no puede destildar lo ya resuelto.
        resuelto = CASE WHEN @hay_columna_resuelto = 1 THEN excluded.resuelto ELSE amp.resuelto END,
        actualizado_en = excluded.actualizado_en`),

    siniestro: db.prepare(`
      INSERT INTO siniestros (fila_id, pestana, cliente_id, poliza_id, fecha, fecha_iso, fecha_carga, fecha_carga_iso, cliente_nombre,
                              documento, patente, sucursal_texto,
                              compania, numero_poliza, cobertura, numero_siniestro, descripcion, estado, importe, observaciones,
                              creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @fecha, @fecha_iso, @fecha_carga, @fecha_carga_iso, @cliente_nombre,
              @documento, @patente, @sucursal_texto,
              @compania, @numero_poliza, @cobertura, @numero_siniestro, @descripcion, @estado, @importe, @observaciones,
              @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, cliente_id = COALESCE(excluded.cliente_id, siniestros.cliente_id),
        poliza_id = COALESCE(excluded.poliza_id, siniestros.poliza_id), fecha = excluded.fecha,
        fecha_iso = excluded.fecha_iso, fecha_carga = excluded.fecha_carga, fecha_carga_iso = excluded.fecha_carga_iso,
        cliente_nombre = excluded.cliente_nombre, documento = excluded.documento, patente = excluded.patente,
        sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE siniestros.sucursal_texto END, compania = excluded.compania, numero_poliza = excluded.numero_poliza,
        cobertura = excluded.cobertura,
        numero_siniestro = excluded.numero_siniestro, descripcion = excluded.descripcion, estado = excluded.estado, importe = excluded.importe,
        observaciones = excluded.observaciones, actualizado_en = excluded.actualizado_en`),

    regla: db.prepare(`
      INSERT INTO reglas_cobertura (fila_id, pestana, compania, cobertura, incluye, franquicia, detalle, observaciones, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @compania, @cobertura, @incluye, @franquicia, @detalle, @observaciones, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, compania = excluded.compania, cobertura = excluded.cobertura, incluye = excluded.incluye,
        franquicia = excluded.franquicia, detalle = excluded.detalle, observaciones = excluded.observaciones, actualizado_en = excluded.actualizado_en`),

    pago: db.prepare(`
      INSERT INTO pagos (fila_id, pestana, cliente_id, poliza_id, fecha, fecha_iso, cliente_nombre, documento, compania, numero_poliza,
                         patente, sucursal_texto, importe, importe_monto, medio, periodo_texto, periodo, observaciones, resultado, creado_en, actualizado_en)
      VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @fecha, @fecha_iso, @cliente_nombre, @documento, @compania, @numero_poliza,
              @patente, @sucursal_texto, @importe, @importe_monto, @medio, @periodo_texto, @periodo, @observaciones, @resultado, @ahora, @ahora)
      ON CONFLICT(fila_id) DO UPDATE SET
        pestana = excluded.pestana, cliente_id = COALESCE(excluded.cliente_id, pagos.cliente_id),
        poliza_id = COALESCE(excluded.poliza_id, pagos.poliza_id), fecha = excluded.fecha,
        fecha_iso = excluded.fecha_iso, cliente_nombre = excluded.cliente_nombre, documento = excluded.documento, compania = excluded.compania,
        numero_poliza = excluded.numero_poliza, patente = excluded.patente, sucursal_texto = CASE WHEN @sucursal_mapeada = 1 THEN excluded.sucursal_texto ELSE pagos.sucursal_texto END, importe = excluded.importe,
        importe_monto = excluded.importe_monto, medio = excluded.medio, periodo_texto = excluded.periodo_texto, periodo = excluded.periodo,
        observaciones = excluded.observaciones,
        -- El RESULTADO sólo lo manda la hoja si la pestaña TIENE columna RESULTADO. Cuando no la tiene,
        -- la rendición se lleva a mano en DM Gestión (así lo avisa la pantalla de Imputados) y una
        -- importación no puede borrarla.
        resultado = CASE WHEN @hay_columna_resultado = 1 THEN excluded.resultado ELSE pagos.resultado END,
        actualizado_en = excluded.actualizado_en`),

    sucursales: db.prepare('SELECT id, nombre FROM sucursales'),
    contar: (tabla: string) => db.prepare(`SELECT COUNT(*) AS total FROM ${tabla}`),
    contarPolizasActivas: db.prepare('SELECT COUNT(*) AS total FROM polizas WHERE activa = 1'),
  }
}

class TrabajoDeImportacion {
  private readonly db: BaseDeDatos
  private readonly fuente: FuenteHoja
  private readonly importacionId: number
  private readonly alProgresar: (progreso: ProgresoImportacion) => void
  private readonly estaCancelada: () => boolean
  private readonly anioActual: number
  /** Marca de tiempo única de la corrida: todo lo que toca esta importación lleva este actualizado_en. */
  private readonly ahora = ahoraIso()
  private readonly iniciadaEn = this.ahora
  private readonly sentencias: ReturnType<typeof prepararSentencias>

  private hojaId = ''
  private hojaTitulo = ''
  private pestanas: PestanaTrabajo[] = []
  private masNueva: PestanaTrabajo | null = null
  private periodoPorMes = new Map<number, string>()
  private layouts = new Map<string, Layout>()

  private resumenes: ResumenPestana[] = []
  private progresoPestanas: ProgresoPestana[] = []
  private problemas: ProblemaImportacion[] = []
  private problemasPorTipo: Record<string, number> = {}
  private problemasOmitidos = 0
  private sucursalesDesconocidas: Record<string, number> = {}
  private avisos: string[] = []
  private estado: EstadoImportacion = 'EN_CURSO'
  private errorFatal: string | null = null
  private polizasInactivadas = 0
  private filasQueYaNoEstan = 0
  /** Se prende si Google rechaza la primera escritura: no se vuelve a intentar en las demás pestañas. */
  private hojaSoloLectura = false
  /** Los períodos deducidos no cierran: por las dudas no se toca el estado activo/inactivo. */
  private periodosIncoherentes = false
  /** Filas con datos de la planilla más nueva y de la anterior: alimentan el freno de seguridad. */
  private porcentajeMaximo = 0
  private filasDeLaMasNueva = 0
  private filasDeLaMensualAnterior = 0
  /** Cuotas ya escritas en esta corrida, por póliza y período: detecta la misma póliza dos veces en el mes. */
  private cuotasPorPolizaYPeriodo = new Map<string, number>()

  private sucursales = new Map<string, number>()
  /** Valores de planillas leídas al elegir la más nueva, para no pedirlas dos veces a Google. */
  private valoresCacheados = new Map<string, string[][]>()
  private polizasActivasAntes = 0
  private idsVistos = new Map<string, string>()
  private clientesEnCorrida = new Map<string, { id: number; nombre: string; fila: number }>()
  /** Claves NOM: que corresponden a más de una persona: no sirven para atribuir filas históricas. */
  private clientesAmbiguosPorNombre = new Set<string>()
  private patentesEnCorrida = new Map<string, string>()
  private vehiculosSinPatenteEnCorrida = new Map<string, number>()
  private polizasEnCorrida = new Map<string, number>()
  private polizaPorNumero = new Map<string, number | null>()
  private polizaPorPatente = new Map<string, number | null>()
  private polizaPorDocumentoYPatente = new Map<string, number | null>()
  private polizaPorDocumento = new Map<string, number | null>()

  constructor(opciones: OpcionesImportacion) {
    this.db = opciones.db
    this.fuente = opciones.fuente
    this.importacionId = opciones.importacionId
    this.alProgresar = opciones.alProgresar ?? (() => undefined)
    this.estaCancelada = opciones.estaCancelada ?? (() => false)
    this.anioActual = opciones.anioActual ?? new Date().getFullYear()
    this.sentencias = prepararSentencias(this.db)
  }

  async ejecutar(): Promise<InformeImportacion> {
    try {
      await this.preparar()
      for (const pestana of this.ordenDeProceso()) {
        if (this.estaCancelada()) {
          this.estado = 'CANCELADA'
          this.marcarRestantesComoOmitidas()
          this.avisos.push('La importación se canceló: no se actualizó el estado activo/inactivo de las pólizas. Volvé a correrla completa.')
          break
        }
        await this.procesarPestana(pestana)
      }
      if (this.estado === 'EN_CURSO') {
        this.emitirProgreso('consolidando', 'Consolidando pólizas activas y totales…')
        this.consolidar()
        const huboError = this.resumenes.some((r) => r.estado === 'error') || this.hojaSoloLectura
        this.estado = huboError ? 'CON_ERRORES' : 'COMPLETA'
      }
    } catch (error) {
      this.estado = 'FALLIDA'
      this.errorFatal = mensajeDe(error)
      this.marcarRestantesComoOmitidas()
    }
    const informe = this.armarInforme()
    this.emitirProgreso('terminada', 'Importación terminada.')
    return informe
  }

  // ---------------------------------------------------------------------------
  // Preparación
  // ---------------------------------------------------------------------------
  private async preparar(): Promise<void> {
    this.emitirProgreso('preparando', 'Leyendo la estructura de la hoja…')
    const estructura = await this.fuente.estructura()
    this.hojaId = estructura.hojaId
    this.hojaTitulo = estructura.titulo

    const clasificadas = clasificarPestanas(
      estructura.pestanas.map((p) => ({ titulo: p.titulo, indice: p.indice })),
      this.anioActual,
    )
    this.pestanas = estructura.pestanas.map((p) => {
      const c = clasificadas.find((x) => x.titulo === p.titulo && x.indice === p.indice)!
      return { ...p, ...c }
    })

    // La lista de pestañas se muestra antes de salir a leer las candidatas: leer la planilla más nueva
    // puede tardar y la pantalla no puede quedarse en blanco.
    this.progresoPestanas = this.pestanas.map((p) => ({ titulo: p.titulo, tipo: p.tipo, estado: 'pendiente', filas: null, detalle: null }))
    this.emitirProgreso('pestanas', `Se detectaron ${this.pestanas.length} pestañas.`)

    const inferidas: string[] = []
    for (const p of this.pestanas) {
      if (p.tipo !== 'MENSUAL' || !p.periodo || p.mes === null) continue
      const existente = this.periodoPorMes.get(p.mes)
      if (!existente || p.periodo > existente) this.periodoPorMes.set(p.mes, p.periodo)
      if (p.anioInferido) inferidas.push(`«${p.titulo}» → ${p.periodo}`)
    }
    for (const p of this.pestanas) {
      if (p.tipo === 'BAJAS' && p.anioInferido && p.periodo) inferidas.push(`«${p.titulo}» → ${p.periodo}`)
    }
    if (inferidas.length > 0) {
      this.avisos.push(`Planillas sin año en el título; se dedujo por el orden de las pestañas: ${inferidas.join(', ')}. Si alguna está mal, renombrá la pestaña con el año (por ejemplo «ENERO 2026»).`)
    }

    // Si los períodos no cierran, algo se movió de lugar o hay un año mal escrito: se avisa y, por las
    // dudas, esta corrida no cambia el estado activo/inactivo de la cartera.
    const incoherencias = revisarCoherenciaDePeriodos(this.pestanas, this.anioActual)
    if (incoherencias.length > 0) {
      this.periodosIncoherentes = true
      for (const aviso of incoherencias) this.avisos.push(aviso)
      this.avisos.push('Como los períodos no cierran, no se tocó el estado activo/inactivo de las pólizas en esta corrida.')
    }

    this.polizasActivasAntes = (this.sentencias.contarPolizasActivas.get() as { total: number }).total
    // La clave no lleva espacios ni tildes: en la hoja conviven «DOCK SUD», «DOCKSUD» y «LANUS».
    for (const fila of this.sentencias.sucursales.all() as Array<{ id: number; nombre: string }>) {
      this.sucursales.set(claveDeSucursal(fila.nombre), fila.id)
    }
    this.cargarIndicesDePolizas()

    this.emitirProgreso('pestanas', 'Revisando los encabezados de cada pestaña…')
    await this.resolverLayouts()

    this.masNueva = await this.elegirMasNuevaConDatos()
    if (!this.masNueva) {
      this.avisos.push('No se encontró ninguna planilla mensual (ENERO, FEBRERO, …): no se crean clientes, vehículos ni pólizas.')
    }

    const conocidasSinTabla = this.pestanas.filter((p) => !TIPOS_CON_MAPEO.includes(p.tipo) && p.tipo !== 'OTRA')
    if (conocidasSinTabla.length > 0) {
      this.avisos.push(`Pestañas que se guardan completas en filas crudas pero todavía no tienen mapeo a una tabla: ${conocidasSinTabla.map((p) => `«${p.titulo}» (${NOMBRE_TIPO_PESTANA[p.tipo]})`).join(', ')}.`)
    }
    const desconocidas = this.pestanas.filter((p) => p.tipo === 'OTRA')
    if (desconocidas.length > 0) {
      this.avisos.push(`Pestañas con un nombre que no se reconoce (se guardan completas en filas crudas): ${desconocidas.map((p) => `«${p.titulo}»`).join(', ')}. Si alguna es una planilla mensual, renombrala con el mes y el año.`)
      for (const p of desconocidas) {
        this.problema(p.titulo, null, null, 'pestaña no reconocida', `«${p.titulo}» no se reconoce como planilla mensual, bajas, riesgos, siniestros, imputados ni cobertura`)
      }
    }

    // El orden definitivo ya se sabe: la más nueva primero.
    const porTitulo = new Map(this.progresoPestanas.map((p) => [p.titulo, p]))
    this.progresoPestanas = this.ordenDeProceso().map((p) => porTitulo.get(p.titulo) ?? { titulo: p.titulo, tipo: p.tipo, estado: 'pendiente', filas: null, detalle: null })
    this.emitirProgreso('pestanas', `Planilla más nueva: ${this.masNueva?.titulo ?? '(ninguna)'}.`)
  }

  /**
   * La planilla más nueva es la de mayor período QUE TENGA DATOS: una pestaña del mes próximo creada con
   * sólo los encabezados (o con encabezados irreconocibles) no puede definir la cartera ni inactivar pólizas.
   */
  private async elegirMasNuevaConDatos(): Promise<PestanaTrabajo | null> {
    const candidatas = this.pestanas
      .filter((p) => p.tipo === 'MENSUAL' && p.periodo)
      .sort((a, b) => b.periodo!.localeCompare(a.periodo!) || b.indice - a.indice)

    const ocultas = candidatas.filter((p) => p.oculta)
    if (ocultas.length > 0) {
      this.avisos.push(`Planillas mensuales ocultas en Google (no se toman como la más nueva): ${ocultas.map((p) => `«${p.titulo}»`).join(', ')}.`)
    }

    let elegida: PestanaTrabajo | null = null
    for (const candidata of candidatas.filter((p) => !p.oculta)) {
      if (this.estaCancelada()) return null
      this.actualizarPestana(candidata.titulo, 'leyendo', null, 'buscando la planilla más nueva')
      const valores = await this.fuente.leerValores(candidata.titulo)
      this.valoresCacheados.set(candidata.titulo, valores)
      this.actualizarPestana(candidata.titulo, 'pendiente', null, null)
      const mapeo = mapearEncabezados(valores[0] ?? [], 'MENSUAL')
      const reconoceIdentidad = mapeo.porCampo.has('nombre') || mapeo.porCampo.has('documento') || mapeo.porCampo.has('patente')
      const filasConDatos = valores.slice(1).filter((fila) => fila.some((valor, i) => !mapeo.columnasId.includes(i) && limpiar(valor) !== '')).length
      if (reconoceIdentidad && filasConDatos > 0) {
        elegida = candidata
        this.filasDeLaMasNueva = filasConDatos
        // Referencia para el freno de seguridad: cuántas filas traía la planilla del mes anterior.
        const anterior = candidatas.find((p) => p.periodo! < candidata.periodo!)
        if (anterior) {
          const valoresAnterior = this.valoresCacheados.get(anterior.titulo) ?? (await this.fuente.leerValores(anterior.titulo))
          this.valoresCacheados.set(anterior.titulo, valoresAnterior)
          const mapeoAnterior = mapearEncabezados(valoresAnterior[0] ?? [], 'MENSUAL')
          this.filasDeLaMensualAnterior = valoresAnterior.slice(1).filter((fila) => fila.some((valor, i) => !mapeoAnterior.columnasId.includes(i) && limpiar(valor) !== '')).length
        }
        break
      }
      this.avisos.push(
        `La planilla «${candidata.titulo}» (${candidata.periodo}) ${filasConDatos === 0 ? 'no tiene filas con datos' : 'no tiene columnas de nombre, documento ni patente reconocibles'}: no se la toma como planilla más nueva.`,
      )
    }
    return elegida
  }

  /**
   * Averigua, para cada pestaña, en qué fila están sus encabezados. En la hoja real hay pestañas cuyo
   * título ocupa las primeras filas (SINIESTROS empieza en la 4) y pestañas de BAJAS que directamente
   * NO tienen fila de encabezados: arrancan con datos y usan las mismas columnas que otra pestaña.
   */
  private async resolverLayouts(): Promise<void> {
    const entradas: PestanaParaLayout[] = []
    for (const p of this.pestanas) {
      if (this.estaCancelada()) return
      try {
        entradas.push({ titulo: p.titulo, tipo: p.tipo, filas: await this.fuente.leerPrimerasFilas(p.titulo, FILAS_PARA_ENCABEZADOS) })
      } catch (error) {
        this.problema(p.titulo, null, null, 'no se pudo leer la pestaña', mensajeDe(error))
      }
    }

    const resultado = resolverLayouts(entradas)
    this.layouts = resultado.layouts
    for (const aviso of resultado.avisos) this.avisos.push(aviso)
    for (const { titulo, detalle } of resultado.sinResolver) {
      this.problema(titulo, null, null, 'pestaña sin encabezados', detalle)
    }
  }

  /** Pólizas ya existentes en la base (de corridas anteriores) para poder enlazar históricos. */
  private cargarIndicesDePolizas(): void {
    const filas = this.sentencias.polizasParaIndice.all() as Array<{
      id: number
      clave: string
      numero_normalizado: string | null
      patente_normalizada: string | null
      documento_normalizado: string | null
    }>
    for (const fila of filas) {
      this.indexarPoliza(fila.id, fila.numero_normalizado ?? '', fila.patente_normalizada ?? '', fila.documento_normalizado ?? '')
    }
  }

  private indexarPoliza(id: number, numero: string, patente: string, documento: string): void {
    const registrar = (mapa: Map<string, number | null>, clave: string) => {
      if (!clave) return
      const existente = mapa.get(clave)
      if (existente === undefined) mapa.set(clave, id)
      else if (existente !== id) mapa.set(clave, null) // ambigua: más de una póliza con la misma clave
    }
    registrar(this.polizaPorNumero, numero)
    registrar(this.polizaPorPatente, patente)
    registrar(this.polizaPorDocumento, documento)
    if (documento && patente) registrar(this.polizaPorDocumentoYPatente, `${documento}|${patente}`)
  }

  /** La más nueva primero (define clientes y pólizas), después el resto de mensuales en orden, bajas y demás. */
  private ordenDeProceso(): PestanaTrabajo[] {
    const orden: PestanaTrabajo[] = []
    if (this.masNueva) orden.push(this.masNueva)
    const mensuales = this.pestanas
      .filter((p) => p.tipo === 'MENSUAL' && p !== this.masNueva)
      .sort((a, b) => (a.periodo ?? '').localeCompare(b.periodo ?? '') || a.indice - b.indice)
    orden.push(...mensuales)
    // Las APP_* van al final: son las que escribe la aplicación y no aportan clientes ni pólizas, pero
    // igual se leen para que sus filas queden en los datos crudos y conserven su lugar en la hoja.
    const prioridad: TipoPestana[] = [
      'BAJAS',
      'RIESGOS_VARIOS',
      'PAGOS',
      'SINIESTROS',
      'COBERTURA',
      'SEGUROS_ACT',
      'AMP',
      'CONTADOR',
      'APP_LEADS',
      'APP_PRESUPUESTOS',
      'APP_TAREAS',
      'APP_RECHAZOS',
      'OTRA',
    ]
    for (const tipo of prioridad) {
      orden.push(...this.pestanas.filter((p) => p.tipo === tipo).sort((a, b) => a.indice - b.indice))
    }
    return orden
  }

  // ---------------------------------------------------------------------------
  // Progreso e informe
  // ---------------------------------------------------------------------------
  private emitirProgreso(fase: ProgresoImportacion['fase'], mensaje: string): void {
    const total = this.progresoPestanas.length
    const terminadas = this.progresoPestanas.filter((p) => p.estado === 'lista' || p.estado === 'error' || p.estado === 'omitida').length
    const enCurso = this.progresoPestanas.some((p) => p.estado === 'leyendo' || p.estado === 'escribiendo_ids' || p.estado === 'guardando') ? 0.5 : 0
    let porcentaje = 0
    if (fase === 'pestanas') porcentaje = total === 0 ? 0 : Math.round(((terminadas + enCurso) / total) * 96)
    else if (fase === 'consolidando') porcentaje = 98
    else if (fase === 'terminada') porcentaje = 100
    // Nunca hacia atrás: mientras se busca la planilla más nueva las pestañas cambian de estado de ida
    // y de vuelta, y una barra que retrocede parece un error.
    this.porcentajeMaximo = Math.max(this.porcentajeMaximo, porcentaje)
    porcentaje = this.porcentajeMaximo
    this.alProgresar({
      importacionId: this.importacionId,
      fase,
      porcentaje,
      mensaje,
      pestanas: this.progresoPestanas.map((p) => ({ ...p })),
    })
  }

  private actualizarPestana(titulo: string, estado: EstadoPestanaImportada, filas: number | null, detalle: string | null): void {
    const entrada = this.progresoPestanas.find((p) => p.titulo === titulo)
    if (entrada) {
      entrada.estado = estado
      entrada.filas = filas
      entrada.detalle = detalle
    }
    const mensajes: Record<EstadoPestanaImportada, string> = {
      pendiente: `«${titulo}» pendiente`,
      leyendo: `Leyendo «${titulo}»…`,
      escribiendo_ids: `Escribiendo la columna _ID en «${titulo}»…`,
      guardando: `Guardando «${titulo}» en la base local…`,
      lista: `«${titulo}» lista`,
      error: `Error en «${titulo}»`,
      omitida: `«${titulo}» omitida`,
    }
    this.emitirProgreso('pestanas', mensajes[estado])
  }

  private marcarRestantesComoOmitidas(): void {
    const motivo = this.estado === 'CANCELADA' ? 'cancelada' : 'no se procesó'
    for (const p of this.progresoPestanas) {
      if (p.estado === 'pendiente') {
        p.estado = 'omitida'
        p.detalle = motivo
      }
    }
    // El informe tiene que listar TODAS las pestañas, también las que no llegaron a procesarse: si no,
    // una corrida cortada parece que hubiera terminado bien con menos pestañas de las que hay.
    for (const p of this.ordenDeProceso()) {
      if (this.resumenes.some((r) => r.titulo === p.titulo)) continue
      this.resumenes.push({
        titulo: p.titulo,
        tipo: p.tipo,
        periodo: p.periodo,
        estado: 'omitida',
        filasLeidas: 0,
        filasConDatos: 0,
        idsNuevos: 0,
        idsExistentes: 0,
        columnaId: null,
        columnas: [],
        registros: {},
        problemas: 0,
        error: motivo,
      })
    }
  }

  private problema(pestana: string, fila: number | null, filaId: string | null, tipo: string, detalle: string): void {
    const cantidad = (this.problemasPorTipo[tipo] ?? 0) + 1
    this.problemasPorTipo[tipo] = cantidad
    const resumen = this.resumenes.find((r) => r.titulo === pestana)
    if (resumen) resumen.problemas++
    // Dos topes: uno global y otro POR TIPO, para que un problema sistemático (una sucursal fuera de
    // catálogo repetida 900 veces) no tape las fechas imposibles y las cuotas raras, que son las que
    // el usuario tiene que ir a corregir a mano.
    if (this.problemas.length < LIMITE_PROBLEMAS_LISTADOS && cantidad <= LIMITE_PROBLEMAS_POR_TIPO) {
      this.problemas.push({ pestana, fila, filaId, tipo, detalle })
    } else {
      this.problemasOmitidos++
    }
  }

  private contar(resumen: ResumenPestana, tabla: string, cantidad = 1): void {
    resumen.registros[tabla] = (resumen.registros[tabla] ?? 0) + cantidad
  }

  // ---------------------------------------------------------------------------
  // Procesamiento de una pestaña
  // ---------------------------------------------------------------------------
  private async procesarPestana(p: PestanaTrabajo): Promise<void> {
    const resumen: ResumenPestana = {
      titulo: p.titulo,
      tipo: p.tipo,
      periodo: p.periodo,
      estado: 'leyendo',
      filasLeidas: 0,
      filasConDatos: 0,
      idsNuevos: 0,
      idsExistentes: 0,
      columnaId: null,
      columnas: [],
      registros: {},
      problemas: 0,
      error: null,
    }
    this.resumenes.push(resumen)
    this.actualizarPestana(p.titulo, 'leyendo', null, null)

    try {
      const valores = this.valoresCacheados.get(p.titulo) ?? (await this.fuente.leerValores(p.titulo))
      this.valoresCacheados.delete(p.titulo)
      if (valores.length === 0) {
        resumen.estado = 'omitida'
        this.actualizarPestana(p.titulo, 'omitida', 0, 'pestaña vacía')
        return
      }

      // El layout se resolvió en la preparación: dice en qué fila están los encabezados (puede no ser la
      // 1) o, si la pestaña no tiene ninguna, cuál es el mapeo prestado de otra pestaña.
      const layout = this.layouts.get(p.titulo)
      const filaEncabezados = layout?.filaEncabezados ?? 0
      const encabezados = filaEncabezados >= 0 ? (valores[filaEncabezados] ?? []) : []
      const mapeo = layout?.mapeo ?? mapearEncabezados(encabezados, p.tipo)
      /** Índice (0-based) de la primera fila con datos. */
      const primeraFila = filaEncabezados + 1
      resumen.columnas = mapeo.columnas
      resumen.filasLeidas = Math.max(0, valores.length - primeraFila)
      if (layout?.prestadoDe) resumen.error = null
      this.revisarMapeo(p, mapeo, encabezados)

      // --- Columna _ID: se conserva la existente o se usa la primera columna vacía en todas las filas
      // después del último encabezado (nunca una columna sin encabezado que tenga datos más abajo).
      // En una pestaña sin encabezados no se puede escribir el título «_ID»: se la reconoce por contenido.
      const indiceId =
        (filaEncabezados < 0 ? columnaIdPorContenido(valores) : mapeo.columnaId) ?? mapeo.columnaId ?? columnaLibreParaId(valores)
      resumen.columnaId = letraColumna(indiceId)
      const columnasId = new Set<number>([...mapeo.columnasId, indiceId])
      const tieneDatosLaFila = (celdas: string[]) => celdas.some((valor, i) => !columnasId.has(i) && limpiar(valor) !== '')

      const ids: string[] = []
      let encabezadosRepetidos = 0
      /** Tramos contiguos de filas cuyo _ID hay que escribir en la hoja (no se pisa la columna entera). */
      const tramos: Array<{ fila: number; valores: string[] }> = []
      const agregarAEscribir = (fila: number, valor: string) => {
        const ultimo = tramos[tramos.length - 1]
        if (ultimo && ultimo.fila + ultimo.valores.length === fila) ultimo.valores.push(valor)
        else tramos.push({ fila, valores: [valor] })
      }
      const escribirTitulo = mapeo.columnaId === null && filaEncabezados >= 0
      if (escribirTitulo) agregarAEscribir(filaEncabezados + 1, ENCABEZADO_ID)

      for (let r = primeraFila; r < valores.length; r++) {
        const celdas = valores[r] ?? []
        let existente = limpiar(celdas[indiceId])
        // Una fila que repite los títulos a mitad de la planilla no es un dato: no lleva _ID ni se
        // guarda. Si le pusiéramos uno, la sincronización la vería como una fila nueva en cada ciclo.
        if (!tieneDatosLaFila(celdas)) {
          ids.push(existente)
          continue
        }
        if (repiteEncabezados(celdas, mapeo.encabezados)) {
          encabezadosRepetidos++
          ids.push(existente)
          continue
        }
        resumen.filasConDatos++
        if (existente) {
          const duenio = this.idsVistos.get(existente)
          if (duenio !== undefined) {
            // Alguien copió filas (o pestañas enteras) con su _ID: la copia recibe uno nuevo.
            this.problema(p.titulo, r + 1, existente, '_ID repetido', `el _ID ${existente} ya está en ${duenio}; se asignó uno nuevo a esta fila`)
            existente = ''
          } else {
            // Duplicar la pestaña del mes es el flujo normal para armar el mes nuevo: el _ID se lo queda
            // la pestaña donde ya estaba registrado y la copia arranca con identificadores propios.
            const registrada = this.sentencias.pestanaDeFila.get(existente) as { pestana: string } | undefined
            if (registrada && registrada.pestana !== p.titulo) {
              this.problema(p.titulo, r + 1, existente, '_ID de otra pestaña', `el _ID ${existente} ya estaba en «${registrada.pestana}» (¿se duplicó la pestaña?); esta fila recibe uno nuevo`)
              existente = ''
            }
          }
        }
        if (existente) {
          resumen.idsExistentes++
        } else {
          existente = generarId()
          resumen.idsNuevos++
          agregarAEscribir(r + 1, existente)
        }
        this.idsVistos.set(existente, `«${p.titulo}» fila ${r + 1}`)
        ids.push(existente)
      }

      // Última chance de cortar antes de tocar la hoja: después de escribir el _ID hay que guardar sí o sí.
      if (this.estaCancelada()) {
        resumen.estado = 'omitida'
        this.actualizarPestana(p.titulo, 'omitida', resumen.filasConDatos, 'cancelada antes de guardar')
        return
      }

      // --- Escritura en la hoja: en su propio try, porque un problema de permisos no puede tirar abajo
      // el guardado de una pestaña que ya se leyó bien.
      const escrituraOk = await this.escribirIds(p, resumen, indiceId, tramos, escribirTitulo)

      // --- Persistencia, una transacción por pestaña.
      this.actualizarPestana(p.titulo, 'guardando', resumen.filasConDatos, null)
      const filas: Fila[] = []
      let sinIdEstable = 0
      for (let r = primeraFila; r < valores.length; r++) {
        const id = ids[r - primeraFila] ?? ''
        const celdas = valores[r] ?? []
        if (!tieneDatosLaFila(celdas) || !id) continue
        // Si no se pudo escribir el _ID, sólo se guardan las filas que YA lo tenían en la hoja: guardar
        // una fila con un _ID que la hoja no conoce haría que la próxima corrida la duplique.
        const esNuevo = !limpiar(celdas[indiceId])
        if (!escrituraOk && esNuevo) {
          sinIdEstable++
          continue
        }
        filas.push(new Fila(mapeo, celdas, r + 1, id, indiceId))
      }
      if (encabezadosRepetidos > 0) {
        this.contar(resumen, 'filas_de_encabezado_repetidas', encabezadosRepetidos)
        this.problema(p.titulo, null, null, 'encabezados repetidos en el medio', `${encabezadosRepetidos} fila(s) repiten el texto de los encabezados a mitad de la planilla; no se toman como clientes`)
      }
      if (sinIdEstable > 0) {
        this.contar(resumen, 'filas_sin_id_no_guardadas', sinIdEstable)
        this.problema(p.titulo, null, null, 'filas sin _ID no guardadas', `${sinIdEstable} filas nuevas no se guardaron porque no se pudo escribir el _ID en la hoja`)
      }
      this.db.transaction(() => {
        for (const fila of filas) {
          this.guardarFilaCruda(p, fila)
          this.contar(resumen, 'filas_crudas')
          switch (p.tipo) {
            case 'MENSUAL':
              this.guardarFilaMensual(p, fila, resumen)
              break
            case 'BAJAS':
              this.guardarBaja(p, fila, resumen)
              break
            case 'RIESGOS_VARIOS':
              this.guardarRiesgoVario(p, fila, resumen)
              break
            case 'SINIESTROS':
              this.guardarSiniestro(p, fila, resumen)
              break
            case 'AMP':
              this.guardarAmp(p, fila, resumen)
              break
            case 'PAGOS':
              this.guardarPago(p, fila, resumen)
              break
            case 'COBERTURA':
              this.guardarReglaCobertura(p, fila, resumen)
              break
            case 'APP_RECHAZOS':
              this.guardarRechazo(p, fila, resumen)
              break
            default:
              break
          }
        }
        // Lo que estaba en esta pestaña y ya no aparece se marca como fuera de la hoja.
        const yaNoEstan = this.sentencias.marcarFilasQueYaNoEstan.run({ pestana: p.titulo, ahora: this.ahora }).changes
        if (yaNoEstan > 0) {
          this.filasQueYaNoEstan += yaNoEstan
          this.contar(resumen, 'filas_que_ya_no_estan', yaNoEstan)
        }
      })()

      resumen.estado = 'lista'
      this.actualizarPestana(p.titulo, 'lista', resumen.filasConDatos, resumen.problemas > 0 ? `${resumen.problemas} problemas` : null)
    } catch (error) {
      resumen.estado = 'error'
      resumen.error = mensajeDe(error)
      this.problema(p.titulo, null, null, 'error de pestaña', resumen.error)
      this.actualizarPestana(p.titulo, 'error', resumen.filasConDatos, resumen.error)
    }
  }

  /**
   * Escribe en la hoja los _ID que faltan (sólo los tramos nuevos, nunca la columna entera) y oculta la
   * columna si la acaba de crear. Devuelve false si la hoja no se pudo escribir: en ese caso las filas
   * sin _ID no se guardan, porque la próxima corrida no tendría cómo reconocerlas y las duplicaría.
   */
  private async escribirIds(
    p: PestanaTrabajo,
    resumen: ResumenPestana,
    indiceId: number,
    tramos: Array<{ fila: number; valores: string[] }>,
    columnaNueva: boolean,
  ): Promise<boolean> {
    if (tramos.length === 0) return true
    if (this.hojaSoloLectura) return false

    this.actualizarPestana(p.titulo, 'escribiendo_ids', resumen.filasConDatos, `${resumen.idsNuevos} _ID nuevos`)
    try {
      await this.fuente.asegurarColumnas(p.sheetId, indiceId + 1)
      await this.fuente.escribirTramos(p.titulo, indiceId, tramos)
    } catch (error) {
      this.hojaSoloLectura = true
      const mensaje = mensajeDe(error)
      this.avisos.push(
        `No se pudo escribir la columna _ID en la hoja: ${mensaje} — Compartí la hoja con la cuenta de servicio como EDITOR (no como lector) y volvé a correr la importación. Sin _ID no hay forma de reconocer las filas, así que las que todavía no lo tienen no se guardaron.`,
      )
      this.problema(p.titulo, null, null, 'no se pudo escribir el _ID', mensaje)
      return false
    }

    // Ocultar la columna es cosmético: si falla, se avisa pero no se pierde la pestaña.
    if (columnaNueva) {
      try {
        await this.fuente.ocultarColumna(p.sheetId, indiceId)
      } catch (error) {
        this.problema(p.titulo, null, null, 'no se pudo ocultar el _ID', mensajeDe(error))
      }
    }
    return true
  }

  /** Deja en el informe lo que el mapeo de encabezados no pudo resolver. */
  private revisarMapeo(p: PestanaTrabajo, mapeo: MapeoDeColumnas, encabezados: string[]): void {
    if (!TIPOS_CON_MAPEO.includes(p.tipo)) return
    if (mapeo.porCampo.size === 0) {
      this.problema(
        p.titulo,
        1,
        null,
        'encabezados no reconocidos',
        `Ningún encabezado de la fila 1 coincide con los campos de «${NOMBRE_TIPO_PESTANA[p.tipo]}»: ${encabezados.filter((e) => limpiar(e)).join(' | ')}`,
      )
      return
    }

    const sinMapeo = mapeo.columnas.filter((c) => c.encabezado !== '' && c.campo === null && (c.nota ?? '').startsWith('sin mapeo'))
    if (sinMapeo.length > 0) {
      this.problema(p.titulo, 1, null, 'columna sin mapeo', `${sinMapeo.length} columna(s) sin campo asignado (quedan sólo en los datos crudos): ${sinMapeo.map((c) => `${c.columna} «${c.encabezado}»`).join(', ')}`)
    }
    const repetidas = mapeo.columnas.filter((c) => (c.nota ?? '').includes('se usa aquella'))
    if (repetidas.length > 0) {
      this.problema(p.titulo, 1, null, 'columna repetida', `${repetidas.length} columna(s) repiten un campo ya asignado; se usan de respaldo: ${repetidas.map((c) => `${c.columna} «${c.encabezado}»`).join(', ')}`)
    }

    if (p.tipo === 'MENSUAL') {
      const faltan: string[] = []
      if (!mapeo.porCampo.has('nombre') && !mapeo.porCampo.has('documento')) faltan.push('nombre o documento')
      if (!mapeo.porCampo.has('cuota')) faltan.push('cuota')
      if (!mapeo.porCampo.has('dia_vencimiento')) faltan.push('día de vencimiento')
      if (faltan.length > 0) {
        this.problema(p.titulo, 1, null, 'columna clave no encontrada', `la planilla mensual no tiene columna de ${faltan.join(', ')}`)
      }
      // La sucursal no impide importar, pero si falta la columna la pantalla queda con la columna
      // «Sucursal» vacía y el filtro por sucursal no devuelve nada, sin decir por qué. Que se vea acá,
      // que es donde el usuario va a mirar («Columnas reconocidas por pestaña»).
      if (!mapeo.porCampo.has('sucursal')) {
        this.problema(
          p.titulo,
          1,
          null,
          'columna de sucursal no encontrada',
          'la planilla mensual no tiene columna LOCAL (ni SUCURSAL, SUC, OFICINA, SEDE o AGENCIA): las filas se ' +
            'quedan con la sucursal del cliente y, si el cliente tampoco la tiene, la columna sale en blanco',
        )
      }
    }
  }

  private guardarFilaCruda(p: PestanaTrabajo, fila: Fila): void {
    this.sentencias.filaCruda.run({
      fila_id: fila.id,
      pestana: p.titulo,
      tipo_pestana: p.tipo,
      periodo: p.periodo,
      numero_fila: fila.numero,
      datos_json: JSON.stringify(fila.crudo()),
      importacion_id: this.importacionId,
      // La huella y la pestaña de origen son lo que después usa la sincronización para saber, sin
      // rearmar nada, si esta fila cambió en la hoja.
      sheet_id: p.sheetId,
      huella: huellaDeFila(fila.celdas, fila.columnaDelId),
      ahora: this.ahora,
    })
  }

  // ---------------------------------------------------------------------------
  // Identidad de la fila y enlaces
  // ---------------------------------------------------------------------------
  private identificar(p: PestanaTrabajo, fila: Fila): Identidad {
    const nombre = fila.valor('nombre')
    const documento = fila.valor('documento')
    const documentoNormalizado = normalizarDocumento(documento)
    const documentoValido = documentoNormalizado.length >= 6 && documentoNormalizado.length <= 11
    if (documento && !documentoValido) {
      this.problema(p.titulo, fila.numero, fila.id, 'documento dudoso', `"${documento}" no parece un DNI/CUIT; el cliente se identifica por nombre`)
    }
    const patente = fila.valor('patente')
    const patenteNormalizada = normalizarPatente(patente)
    if (patente && !patenteNormalizada && !esMarcadorDeSinPatente(patente)) {
      this.problema(p.titulo, fila.numero, fila.id, 'patente ilegible', `"${patente}" no parece una patente; el vehículo no se identifica por dominio`)
    }
    const compania = fila.valor('compania')
    const numero = fila.valor('numero_poliza')
    const numeroNormalizado = normalizarNumeroPoliza(numero)
    return {
      nombre,
      nombreNormalizado: normalizarTexto(nombre),
      documento,
      documentoNormalizado,
      documentoValido,
      patente,
      patenteNormalizada,
      compania,
      companiaNormalizada: normalizarTexto(compania),
      numero,
      numeroNormalizado,
      numeroValido: numeroNormalizado.length >= 3 && /\d/.test(numeroNormalizado),
    }
  }

  /**
   * Prepara el registro que ya nació de esta misma fila para recibir la clave nueva. Devuelve true si
   * hubo que renombrarlo (el dato de identidad cambió en la hoja entre dos importaciones).
   */
  private anclarPorFila(ancla: SentenciasDeAncla, filaId: string, claveNueva: string): boolean {
    const actual = ancla.porFila.get(filaId) as { id: number; clave: string } | undefined
    if (!actual || actual.clave === claveNueva) return false
    const ocupada = ancla.porClave.get(claveNueva) as { id: number } | undefined
    if (ocupada) {
      // Ya existe otro registro con la clave nueva (dos filas terminaron siendo lo mismo): el viejo
      // suelta el _ID para que la fila quede asociada al que corresponde.
      ancla.soltarFila.run(actual.id)
    } else {
      ancla.renombrar.run({ clave: claveNueva, id: actual.id, ahora: this.ahora })
    }
    return true
  }

  private claveCliente(ident: Identidad, filaId: string): string {
    if (ident.documentoValido) return `DOC:${ident.documentoNormalizado}`
    if (ident.nombreNormalizado) return `NOM:${ident.nombreNormalizado}`
    return `FILA:${filaId}`
  }

  private buscarCliente(ident: Identidad): number | null {
    const claves = [ident.documentoValido ? `DOC:${ident.documentoNormalizado}` : null, ident.nombreNormalizado ? `NOM:${ident.nombreNormalizado}` : null]
    for (const clave of claves) {
      if (!clave) continue
      // Un nombre que corresponde a dos personas distintas no sirve para atribuir nada.
      if (clave.startsWith('NOM:') && this.clientesAmbiguosPorNombre.has(clave)) continue
      const enCorrida = this.clientesEnCorrida.get(clave)
      if (enCorrida) return enCorrida.id
      const fila = this.sentencias.clientePorClave.get(clave) as { id: number } | undefined
      if (fila) return fila.id
    }
    return null
  }

  /**
   * Enlaza una fila histórica con una póliza conocida: por número, por documento+patente o por patente.
   * Si la fila TRAE número de póliza o patente y ninguna búsqueda por esos datos acertó, se devuelve null
   * en vez de adivinar: caer al "única póliza de este documento" enganchaba la cuota del auto a la moto.
   */
  private buscarPoliza(ident: Identidad): number | null {
    if (ident.numeroValido) {
      const exacta = this.polizasEnCorrida.get(`POL:${ident.companiaNormalizada}|${ident.numeroNormalizado}`)
      if (exacta !== undefined) return exacta
      const porNumero = this.polizaPorNumero.get(ident.numeroNormalizado)
      if (porNumero) return porNumero
    }
    if (ident.documentoValido && ident.patenteNormalizada) {
      const porAmbos = this.polizaPorDocumentoYPatente.get(`${ident.documentoNormalizado}|${ident.patenteNormalizada}`)
      if (porAmbos) return porAmbos
    }
    if (ident.patenteNormalizada) {
      const porPatente = this.polizaPorPatente.get(ident.patenteNormalizada)
      if (porPatente) return porPatente
    }
    // El último escalón sólo vale cuando la fila no trae ningún dato propio de la póliza.
    if (ident.documentoValido && !ident.numeroValido && !ident.patenteNormalizada) {
      const porDocumento = this.polizaPorDocumento.get(ident.documentoNormalizado)
      if (porDocumento) return porDocumento
    }
    return null
  }

  /**
   * El texto de la columna LOCAL escrito como lo escribe el catálogo: «AVELLANEDA» y «DOCK SUD» son el
   * mismo mostrador y los dos se guardan como «Dock Sud». Así el desplegable ofrece las cuatro
   * sucursales de la agencia y no una opción por cada forma de escribirlas. Lo que no es ninguna de las
   * cuatro se guarda tal cual y se lista en el informe.
   */
  private sucursalDeLaFila(fila: Fila): string {
    const texto = fila.valor('sucursal')
    return sucursalCanonica(texto) ?? texto
  }

  private resolverSucursal(p: PestanaTrabajo, fila: Fila, texto: string): number | null {
    if (!texto) return null
    const id = this.sucursales.get(claveDeSucursal(texto))
    if (id !== undefined) return id
    const clave = texto.toUpperCase()
    this.sucursalesDesconocidas[clave] = (this.sucursalesDesconocidas[clave] ?? 0) + 1
    this.problema(p.titulo, fila.numero, fila.id, 'sucursal fuera de catálogo', `"${texto}" no es ${sucursalesEnTexto()}; se guardó el texto tal cual`)
    return null
  }

  private anioDelPeriodo(periodo: string | null): number | null {
    return periodo ? Number(periodo.slice(0, 4)) : null
  }

  /**
   * Fila de totales al pie de la planilla: "TOTAL" (o "SUBTOTAL", "TOTAL DOCK SUD"…) en la columna del nombre,
   * o una fila sin ningún dato identificatorio pero con un importe en cuota/prima.
   */
  private esFilaDeTotales(ident: Identidad, fila: Fila): boolean {
    // Una fila con DNI, patente, compañía o número de póliza es un cliente, aunque se llame
    // «TOTAL AUSTRAL S.A.»: el texto del nombre sólo alcanza cuando no hay ningún otro dato.
    const sinDatosDePoliza = !ident.documentoValido && !ident.patenteNormalizada && !ident.numeroValido && !ident.companiaNormalizada
    if (sinDatosDePoliza && (/^(SUB ?)?TOTAL(ES)?\b/.test(ident.nombreNormalizado) || /^SUMA(TORIA)?\b/.test(ident.nombreNormalizado))) return true
    // Sin nombre, sin ningún dato de póliza y con un importe: es el subtotal al pie de la planilla.
    const sinIdentidad = sinDatosDePoliza && !ident.nombreNormalizado && !fila.valor('telefono')
    return sinIdentidad && (interpretarNumero(fila.valor('cuota')) !== null || interpretarNumero(fila.valor('prima')) !== null)
  }

  // ---------------------------------------------------------------------------
  // Planilla mensual
  // ---------------------------------------------------------------------------
  private guardarFilaMensual(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    const ident = this.identificar(p, fila)
    if (this.esFilaDeTotales(ident, fila)) {
      this.problema(p.titulo, fila.numero, fila.id, 'fila de totales', `"${ident.nombre || '(sin nombre)'}" con importe ${fila.valor('cuota') || fila.valor('prima')}: no es una póliza; se guardó sólo en filas crudas`)
      return
    }
    if (!ident.nombreNormalizado && !ident.documentoValido && !ident.patenteNormalizada) {
      this.problema(p.titulo, fila.numero, fila.id, 'fila sin datos identificatorios', 'sin nombre, documento ni patente; se guardó sólo en filas crudas')
      return
    }

    // El año del vehículo se revisa en todas las planillas (aunque el vehículo sólo se cree desde la más nueva).
    const anioTexto = fila.valor('anio')
    const anioNumero = interpretarEntero(anioTexto, 1950, this.anioActual + 1)
    if (anioTexto && anioNumero === null) {
      this.problema(p.titulo, fila.numero, fila.id, 'año de vehículo dudoso', `"${anioTexto}" no es un año entre 1950 y ${this.anioActual + 1}`)
    }

    const esLaMasNueva = p === this.masNueva
    const sucursalTexto = this.sucursalDeLaFila(fila)
    const sucursalId = this.resolverSucursal(p, fila, sucursalTexto)

    let clienteId: number | null
    let polizaId: number | null
    if (esLaMasNueva) {
      clienteId = this.guardarCliente(p, fila, ident, sucursalId, sucursalTexto, resumen)
      const vehiculoId = this.guardarVehiculo(p, fila, ident, clienteId, anioNumero, resumen)
      polizaId = this.guardarPoliza(p, fila, ident, clienteId, vehiculoId, resumen)
    } else {
      clienteId = this.buscarCliente(ident)
      polizaId = this.buscarPoliza(ident)
      if (polizaId === null) this.contar(resumen, 'cuotas_sin_poliza_vigente')
      // Las mensuales viejas no crean clientes, pero sí saben de qué sucursal es cada uno. Si a la más
      // nueva le falta la columna LOCAL, son la única fuente que queda: sin esto, una computadora recién
      // instalada importa la hoja entera y termina con TODOS los clientes sin sucursal, y como la
      // planilla del mes se respalda en el cliente, la columna sale en blanco en todas las filas.
      if (clienteId !== null && sucursalTexto) {
        this.sentencias.completarSucursalDelCliente.run({ id: clienteId, sucursal_id: sucursalId, sucursal_texto: sucursalTexto })
      }
    }

    const cuota = fila.valor('cuota')
    const cuotaMonto = interpretarNumero(cuota)
    if (cuota && cuotaMonto === null) {
      if (esTextoDeCuotaConocido(cuota)) this.contar(resumen, 'cuotas_con_texto')
      else this.problema(p.titulo, fila.numero, fila.id, 'cuota no numérica', `"${cuota}" no es un importe ni un texto conocido (A/D, ---)`)
    }
    const diaTexto = fila.valor('dia_vencimiento')
    const dia = interpretarDiaDeVencimiento(diaTexto)
    if (diaTexto && dia === null) this.problema(p.titulo, fila.numero, fila.id, 'vencimiento ilegible', `"${diaTexto}" no tiene un día del mes`)
    const pagoTexto = fila.valor('pago')
    const pago = interpretarFechaDePeriodo(pagoTexto, p.periodo, this.anioActual)
    if (pago.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de pago inválida', pago.problema)

    this.sentencias.cuota.run({
      fila_id: fila.id,
      periodo: p.periodo ?? 'sin-periodo',
      pestana: p.titulo,
      poliza_id: polizaId,
      cliente_id: clienteId,
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      patente: oNulo(ident.patente),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      cuota: oNulo(cuota),
      cuota_monto: cuotaMonto,
      dia_vencimiento: oNulo(diaTexto),
      dia_vencimiento_numero: dia,
      aviso: oNulo(fila.valor('aviso')),
      aviso_enviado: interpretarAviso(fila.valor('aviso')),
      pago: oNulo(pagoTexto),
      pago_fecha: pago.iso,
      observaciones: oNulo(fila.valor('observaciones')),
      forma_pago: oNulo(fila.valor('forma_pago')),
      fecha_envio: oNulo(fila.valor('fecha_envio')),
      avisar_vto: oNulo(fila.valor('avisar_vto')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'cuotas_mes')

    // El pliego pide una fila por póliza y mes: si la planilla repite la póliza, se avisa (no se frena).
    if (polizaId !== null) {
      const clave = `${polizaId}|${p.periodo ?? 'sin-periodo'}`
      const anterior = this.cuotasPorPolizaYPeriodo.get(clave)
      if (anterior !== undefined) {
        this.problema(p.titulo, fila.numero, fila.id, 'póliza repetida en el mes', `la misma póliza (${ident.compania} ${ident.numero || ident.patente}) ya tenía una cuota de ${p.periodo} en la fila ${anterior}; quedaron las dos`)
      } else {
        this.cuotasPorPolizaYPeriodo.set(clave, fila.numero)
      }
    }
  }

  private guardarCliente(p: PestanaTrabajo, fila: Fila, ident: Identidad, sucursalId: number | null, sucursalTexto: string, resumen: ResumenPestana): number {
    const clave = this.claveCliente(ident, fila.id)
    if (!ident.documentoValido && !ident.documento) this.problema(p.titulo, fila.numero, fila.id, 'cliente sin documento', `"${ident.nombre || '(sin nombre)'}" no tiene DNI/CUIT; se identifica por nombre`)

    // La fila ya creó un cliente en otra corrida: si le corrigieron el DNI, se renombra ese registro.
    if (this.anclarPorFila(this.sentencias.anclaClientes, fila.id, clave)) this.contar(resumen, 'clientes_con_clave_corregida')

    // Si el cliente ya existía identificado sólo por nombre y ahora trae documento, se le asigna el
    // documento (misma fila de la base) en vez de crear un duplicado.
    const claveNombre = ident.nombreNormalizado ? `NOM:${ident.nombreNormalizado}` : null
    if (ident.documentoValido && claveNombre && !this.clientesEnCorrida.has(clave)) {
      const existentePorDocumento = this.sentencias.clientePorClave.get(clave) as { id: number } | undefined
      const porNombre = this.clientesEnCorrida.get(claveNombre)?.id ?? (this.sentencias.clientePorClave.get(claveNombre) as { id: number } | undefined)?.id
      if (!existentePorDocumento && porNombre !== undefined) {
        const cambios = this.sentencias.migrarClaveCliente.run({ id: porNombre, clave, documento: oNulo(ident.documento), documento_normalizado: ident.documentoNormalizado, ahora: this.ahora }).changes
        if (cambios > 0) {
          this.contar(resumen, 'clientes_con_documento_nuevo')
          this.problema(p.titulo, fila.numero, fila.id, 'cliente que pasó a tener documento', `a "${ident.nombre}", que estaba sin DNI/CUIT, se le asignó ${ident.documento}; revisá que sea la misma persona`)
        } else {
          // El cliente con ese nombre ya tenía OTRO documento: son dos personas con el mismo nombre.
          this.problema(p.titulo, fila.numero, fila.id, 'homónimos con documentos distintos', `hay otro cliente llamado "${ident.nombre}" con un DNI/CUIT distinto del de esta fila (${ident.documento}); se los trata como dos personas`)
          this.clientesAmbiguosPorNombre.add(claveNombre)
        }
      }
    }

    const datos = {
      clave,
      documento: oNulo(ident.documento),
      documento_normalizado: oNulo(ident.documentoNormalizado),
      nombre: ident.nombre,
      telefono: oNulo(fila.valor('telefono')),
      email: oNulo(fila.valor('email')),
      direccion: oNulo(fila.valor('direccion')),
      localidad: oNulo(fila.valor('localidad')),
      sucursal_id: sucursalId,
      sucursal_texto: oNulo(sucursalTexto),
      fecha_nacimiento: oNulo(fila.valor('fecha_nacimiento')),
      fila_id: fila.id,
      pestana_origen: p.titulo,
      ahora: this.ahora,
    }

    const visto = this.clientesEnCorrida.get(clave)
    if (!visto) {
      const { id } = this.sentencias.clienteCompleto.get(datos) as { id: number }
      const entrada = { id, nombre: ident.nombre, fila: fila.numero }
      this.clientesEnCorrida.set(clave, entrada)
      // Alias por nombre: las planillas viejas (o filas sin DNI) del mismo nombre enlazan con este cliente.
      // Si dos clientes con documentos distintos comparten el nombre, el alias se marca ambiguo.
      if (claveNombre) {
        const aliasPrevio = this.clientesEnCorrida.get(claveNombre)
        if (!aliasPrevio) this.clientesEnCorrida.set(claveNombre, entrada)
        else if (aliasPrevio.id !== id) this.clientesAmbiguosPorNombre.add(claveNombre)
      }
      this.contar(resumen, 'clientes')
      return id
    }

    // Misma clave en otra fila: se unifica (varias pólizas) y se completa lo que falte.
    this.sentencias.clienteCompletar.run({ ...datos, id: visto.id })
    if (!visto.nombre && ident.nombre) visto.nombre = ident.nombre
    const nombreVisto = normalizarTexto(visto.nombre)
    this.contar(resumen, 'clientes_unificados')
    if (clave.startsWith('NOM:')) {
      this.problema(p.titulo, fila.numero, fila.id, 'homónimos sin documento unificados', `"${ident.nombre}" aparece en las filas ${visto.fila} y ${fila.numero} sin DNI/CUIT; se trató como la misma persona`)
    } else if (nombreVisto && ident.nombreNormalizado && nombreVisto !== ident.nombreNormalizado) {
      this.problema(p.titulo, fila.numero, fila.id, 'DNI/CUIT repetido', `${ident.documento} está en la fila ${visto.fila} como "${visto.nombre}" y en la fila ${fila.numero} como "${ident.nombre}": son nombres distintos y se unificaron en el primero`)
    } else {
      this.problema(p.titulo, fila.numero, fila.id, 'DNI/CUIT repetido', `${ident.documento} aparece en las filas ${visto.fila} y ${fila.numero} ("${ident.nombre}"); se unificaron en un solo cliente con todas sus pólizas`)
    }
    return visto.id
  }

  private guardarVehiculo(p: PestanaTrabajo, fila: Fila, ident: Identidad, clienteId: number, anio: number | null, resumen: ResumenPestana): number | null {
    const marca = fila.valor('marca')
    const modelo = fila.valor('modelo')
    if (!ident.patenteNormalizada && !marca && !modelo) return null
    const anioTexto = fila.valor('anio')

    if (ident.patenteNormalizada) {
      const duenio = this.patentesEnCorrida.get(ident.patenteNormalizada)
      if (duenio !== undefined && duenio !== fila.id) {
        this.problema(p.titulo, fila.numero, fila.id, 'patente repetida en la planilla', `la patente ${ident.patente} también está en otra fila de esta planilla; se trata como el mismo vehículo`)
      } else {
        this.patentesEnCorrida.set(ident.patenteNormalizada, fila.id)
      }
    }

    // Sin patente, el vehículo se identifica por cliente + marca + modelo (más motor o chasis si están,
    // para no fundir dos unidades iguales del mismo titular), estable de un mes al otro.
    const motor = fila.valor('motor')
    const chasis = fila.valor('chasis')
    const distintivo = normalizarTexto(chasis) || normalizarTexto(motor)
    const claveVehiculo = ident.patenteNormalizada
      ? `PAT:${ident.patenteNormalizada}`
      : `CLI:${clienteId}|${normalizarTexto(marca)}|${normalizarTexto(modelo)}${distintivo ? `|${distintivo}` : ''}`
    if (this.anclarPorFila(this.sentencias.anclaVehiculos, fila.id, claveVehiculo)) this.contar(resumen, 'vehiculos_con_clave_corregida')
    if (!ident.patenteNormalizada && !distintivo) {
      const yaVisto = this.vehiculosSinPatenteEnCorrida.get(claveVehiculo)
      if (yaVisto !== undefined && yaVisto !== fila.numero) {
        this.problema(p.titulo, fila.numero, fila.id, 'vehículos sin patente iguales', `"${marca} ${modelo}" del mismo cliente ya estaba en la fila ${yaVisto} sin patente ni motor/chasis: se toman como el mismo vehículo`)
      } else {
        this.vehiculosSinPatenteEnCorrida.set(claveVehiculo, fila.numero)
      }
    }
    const titularPrevio = this.sentencias.titularDeVehiculo.get(claveVehiculo) as { cliente_id: number | null } | undefined
    if (titularPrevio?.cliente_id != null && titularPrevio.cliente_id !== clienteId) {
      this.problema(p.titulo, fila.numero, fila.id, 'vehículo que cambió de titular', `la patente ${ident.patente} figuraba a nombre de otro cliente; ahora queda a nombre de "${ident.nombre}"`)
    }
    const { id } = this.sentencias.vehiculo.get({
      clave: claveVehiculo,
      patente: oNulo(ident.patente),
      patente_normalizada: oNulo(ident.patenteNormalizada),
      marca: oNulo(marca),
      modelo: oNulo(modelo),
      anio: oNulo(anioTexto),
      anio_numero: anio,
      motor: oNulo(motor),
      chasis: oNulo(chasis),
      tipo: oNulo(fila.valor('tipo_vehiculo')),
      uso: oNulo(fila.valor('uso')),
      color: oNulo(fila.valor('color')),
      suma_asegurada: oNulo(fila.valor('suma_asegurada')),
      cliente_id: clienteId,
      fila_id: fila.id,
      ahora: this.ahora,
    }) as { id: number }
    this.contar(resumen, 'vehiculos')
    return id
  }

  private guardarPoliza(p: PestanaTrabajo, fila: Fila, ident: Identidad, clienteId: number, vehiculoId: number | null, resumen: ResumenPestana): number {
    let clave: string
    if (ident.numeroValido) clave = `POL:${ident.companiaNormalizada}|${ident.numeroNormalizado}`
    else if (ident.documentoValido && ident.patenteNormalizada) clave = `DOCPAT:${ident.documentoNormalizado}|${ident.patenteNormalizada}`
    else if (ident.nombreNormalizado && ident.patenteNormalizada) clave = `NOMPAT:${ident.nombreNormalizado}|${ident.patenteNormalizada}`
    else {
      clave = `FILA:${fila.id}`
      this.problema(p.titulo, fila.numero, fila.id, 'póliza sin identificador', 'sin número de póliza ni patente: si en otra planilla cambia de fila no se la va a reconocer')
    }
    const repetida = this.polizasEnCorrida.get(clave)
    if (repetida !== undefined) {
      // No se crea una segunda póliza activa: inflaría la cartera y el freno de seguridad. La fila queda
      // enganchada a la misma póliza y el informe avisa para que se revise en la hoja.
      this.problema(p.titulo, fila.numero, fila.id, 'póliza repetida en la planilla', `${ident.compania} ${ident.numero || ident.patente} aparece en más de una fila de esta planilla; las dos filas quedan en la misma póliza`)
      return repetida
    }
    if (this.anclarPorFila(this.sentencias.anclaPolizas, fila.id, clave)) this.contar(resumen, 'polizas_con_clave_corregida')

    const prima = fila.valor('prima')
    // Las vigencias vienen como texto («27/4/2026»). La bandeja de renovaciones y el estado de la
    // póliza necesitan la fecha de verdad, así que se derivan acá igual que `cuota_monto` o `pago_fecha`:
    // sin reemplazar al texto original. Para la de HASTA se corre un año la ventana de años aceptados,
    // porque una vigencia que termina el año que viene es lo normal, no una fecha fuera de rango.
    const anioBase = this.anioDelPeriodo(p.periodo) ?? p.anio ?? this.anioDelPeriodo(this.masNueva?.periodo ?? null)
    const desdeTexto = fila.valor('vigencia_desde')
    const hastaTexto = fila.valor('vigencia_hasta')
    const desdeIso = interpretarFecha(desdeTexto, anioBase, this.anioActual).iso
    const hastaIso = interpretarFecha(hastaTexto, anioBase, this.anioActual + 1).iso

    const { id } = this.sentencias.poliza.get({
      clave,
      fila_id: fila.id,
      cliente_id: clienteId,
      vehiculo_id: vehiculoId,
      compania: oNulo(ident.compania),
      numero: oNulo(ident.numero),
      numero_normalizado: oNulo(ident.numeroNormalizado),
      cobertura: oNulo(fila.valor('cobertura')),
      prima: oNulo(prima),
      prima_monto: interpretarNumero(prima),
      forma_pago: oNulo(fila.valor('forma_pago')),
      productor: oNulo(fila.valor('productor')),
      estado_texto: oNulo(fila.valor('estado')),
      vigencia_desde: oNulo(desdeTexto),
      vigencia_hasta: oNulo(hastaTexto),
      vigencia_desde_iso: desdeIso,
      vigencia_hasta_iso: hastaIso,
      alta: oNulo(fila.valor('alta')),
      avisar_vto: oNulo(fila.valor('avisar_vto')),
      observaciones: oNulo(fila.valor('observaciones')),
      periodo_origen: p.periodo ?? 'sin-periodo',
      pestana_origen: p.titulo,
      ahora: this.ahora,
    }) as { id: number }
    this.polizasEnCorrida.set(clave, id)
    this.indexarPoliza(id, ident.numeroNormalizado, ident.patenteNormalizada, ident.documentoValido ? ident.documentoNormalizado : '')
    this.contar(resumen, 'polizas')
    return id
  }

  // ---------------------------------------------------------------------------
  // Otras pestañas
  // ---------------------------------------------------------------------------
  private guardarBaja(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const mesTexto = fila.valor('mes')
    const anioMasNueva = this.anioDelPeriodo(this.masNueva?.periodo ?? null)
    let periodo = p.periodo ?? periodoDesdeTextoDeMes(mesTexto, this.periodoPorMes, p.anio ?? anioMasNueva)
    if (mesTexto && !periodo) this.problema(p.titulo, fila.numero, fila.id, 'mes ilegible', `"${mesTexto}" no se reconoce como mes`)
    const fechaTexto = fila.valor('fecha_baja')
    const fecha = interpretarFecha(fechaTexto, this.anioDelPeriodo(periodo) ?? p.anio ?? anioMasNueva, this.anioActual)
    if (fecha.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de baja inválida', fecha.problema)
    // Sin mes en el título ni en una columna, el período sale de la fecha de baja.
    if (!periodo && fecha.iso) periodo = fecha.iso.slice(0, 7)
    // El pliego pide las bajas «con motivo y mes»: si no hay forma de saber el mes, se informa.
    if (!periodo) this.problema(p.titulo, fila.numero, fila.id, 'baja sin mes', 'no se pudo determinar el mes de la baja (ni por el nombre de la pestaña, ni por una columna MES, ni por la fecha)')
    if (fila.tieneColumna('motivo') && !fila.valor('motivo')) {
      this.problema(p.titulo, fila.numero, fila.id, 'baja sin motivo', 'la fila no dice por qué se dio de baja')
    }
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)

    const polizaId = this.buscarPoliza(ident)
    this.sentencias.baja.run({
      fila_id: fila.id,
      pestana: p.titulo,
      periodo,
      mes_texto: oNulo(mesTexto),
      poliza_id: polizaId,
      cliente_id: this.buscarCliente(ident),
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      patente: oNulo(ident.patente),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      motivo: oNulo(fila.valor('motivo')),
      fecha_baja: oNulo(fechaTexto),
      fecha_baja_iso: fecha.iso,
      observaciones: oNulo(fila.valor('observaciones')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'bajas')
    if (polizaId === null) this.contar(resumen, 'bajas_sin_poliza_conocida')
  }

  /** Una fila donde ninguna columna reconocida tiene datos no se guarda como registro vacío. */
  private sinDatosUtiles(p: PestanaTrabajo, fila: Fila): boolean {
    if (!fila.sinCamposMapeados()) return false
    // Si la pestaña entera quedó sin encabezados ya está informada una vez: no hace falta repetirlo por fila.
    if (!fila.sinMapeo()) {
      this.problema(p.titulo, fila.numero, fila.id, 'fila sin campos reconocidos', 'ninguna columna con encabezado reconocido tiene datos; la fila queda sólo en los datos crudos')
    }
    return true
  }

  private guardarRiesgoVario(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const cuota = fila.valor('cuota')
    const cuotaMonto = interpretarNumero(cuota)
    if (cuota && cuotaMonto === null && !esTextoDeCuotaConocido(cuota)) this.problema(p.titulo, fila.numero, fila.id, 'cuota no numérica', `"${cuota}" no es un importe ni un texto conocido (A/D, ---)`)
    const clienteId = this.buscarCliente(ident)
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)
    const emisionTexto = fila.valor('emision')
    const emision = interpretarFecha(emisionTexto, null, this.anioActual)
    if (emision.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de emisión inválida', emision.problema)
    this.sentencias.riesgo.run({
      fila_id: fila.id,
      pestana: p.titulo,
      cliente_id: clienteId,
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      telefono: oNulo(fila.valor('telefono')),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      emision: oNulo(emisionTexto),
      emision_iso: emision.iso,
      tipo_riesgo: oNulo(fila.valor('tipo_riesgo')),
      descripcion: oNulo(fila.valor('descripcion')),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      patente: oNulo(ident.patente),
      prima: oNulo(fila.valor('prima')),
      cuota: oNulo(cuota),
      cuota_monto: cuotaMonto,
      dia_vencimiento: oNulo(fila.valor('dia_vencimiento')),
      aviso: oNulo(fila.valor('aviso')),
      pago: oNulo(fila.valor('pago')),
      vigencia_desde: oNulo(fila.valor('vigencia_desde')),
      vigencia_hasta: oNulo(fila.valor('vigencia_hasta')),
      forma_pago: oNulo(fila.valor('forma_pago')),
      observaciones: oNulo(fila.valor('observaciones')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'riesgos_varios')
    if (clienteId === null) this.contar(resumen, 'riesgos_sin_cliente_en_cartera')
  }

  private guardarSiniestro(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const fechaTexto = fila.valor('fecha')
    const fecha = interpretarFecha(fechaTexto, null, this.anioActual)
    if (fecha.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de siniestro inválida', fecha.problema)
    const cargaTexto = fila.valor('fecha_carga')
    const carga = interpretarFecha(cargaTexto, null, this.anioActual)
    if (carga.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de carga inválida', carga.problema)
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)
    this.sentencias.siniestro.run({
      fila_id: fila.id,
      pestana: p.titulo,
      cliente_id: this.buscarCliente(ident),
      poliza_id: this.buscarPoliza(ident),
      fecha: oNulo(fechaTexto),
      fecha_iso: fecha.iso,
      fecha_carga: oNulo(cargaTexto),
      fecha_carga_iso: carga.iso,
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      patente: oNulo(ident.patente),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      cobertura: oNulo(fila.valor('cobertura')),
      numero_siniestro: oNulo(fila.valor('numero_siniestro')),
      descripcion: oNulo(fila.valor('descripcion')),
      estado: oNulo(fila.valor('estado')),
      importe: oNulo(fila.valor('importe')),
      observaciones: oNulo(fila.valor('observaciones')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'siniestros')
  }

  /**
   * AMP: las ampliaciones pendientes. La fila trae el cliente y, si la patente está en la cartera, se
   * engancha con su póliza para poder abrirla desde la lista. La «fecha de vto» de esta pestaña es una
   * fecha entera (no un día del mes como en la planilla), así que se interpreta como tal.
   */
  private guardarAmp(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const fechaTexto = fila.valor('fecha')
    const fecha = interpretarFecha(fechaTexto, null, this.anioActual)
    if (fecha.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de AMP inválida', fecha.problema)
    const vencimientoTexto = fila.valor('dia_vencimiento')
    const vencimiento = interpretarFecha(vencimientoTexto, null, this.anioActual)
    if (vencimiento.problema) this.problema(p.titulo, fila.numero, fila.id, 'vencimiento de AMP inválido', vencimiento.problema)
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)
    this.sentencias.amp.run({
      fila_id: fila.id,
      pestana: p.titulo,
      cliente_id: this.buscarCliente(ident),
      poliza_id: this.buscarPoliza(ident),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      fecha: oNulo(fechaTexto),
      fecha_iso: fecha.iso,
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      telefono: oNulo(fila.valor('telefono')),
      forma_pago: oNulo(fila.valor('forma_pago')),
      patente: oNulo(ident.patente),
      marca: oNulo(fila.valor('marca')),
      modelo: oNulo(fila.valor('modelo')),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      detalle: oNulo(fila.valor('descripcion')),
      vencimiento: oNulo(vencimientoTexto),
      vencimiento_iso: vencimiento.iso,
      observaciones: oNulo(fila.valor('observaciones')),
      resuelto: interpretarAviso(fila.valor('resuelto')) === 1 ? 1 : 0,
      hay_columna_resuelto: fila.tieneColumna('resuelto') ? 1 : 0,
      ahora: this.ahora,
    })
    this.contar(resumen, 'amp')
  }

  private guardarPago(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const fechaTexto = fila.valor('fecha')
    const fecha = interpretarFecha(fechaTexto, null, this.anioActual)
    if (fecha.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de pago inválida', fecha.problema)
    const importe = fila.valor('importe')
    const importeMonto = interpretarNumero(importe)
    if (importe && importeMonto === null) this.problema(p.titulo, fila.numero, fila.id, 'importe no numérico', `"${importe}" no es un importe`)
    const mesTexto = fila.valor('mes')
    const periodo = periodoDesdeTextoDeMes(mesTexto, this.periodoPorMes, fecha.iso ? Number(fecha.iso.slice(0, 4)) : this.anioDelPeriodo(this.masNueva?.periodo ?? null)) ?? (fecha.iso ? fecha.iso.slice(0, 7) : null)
    if (mesTexto && !periodo) this.problema(p.titulo, fila.numero, fila.id, 'mes ilegible', `"${mesTexto}" no se reconoce como mes`)
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)
    this.sentencias.pago.run({
      fila_id: fila.id,
      pestana: p.titulo,
      cliente_id: this.buscarCliente(ident),
      poliza_id: this.buscarPoliza(ident),
      fecha: oNulo(fechaTexto),
      fecha_iso: fecha.iso,
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      patente: oNulo(ident.patente),
      sucursal_texto: oNulo(sucursalTexto),
      sucursal_mapeada: fila.tieneColumna('sucursal') ? 1 : 0,
      importe: oNulo(importe),
      importe_monto: importeMonto,
      medio: oNulo(fila.valor('medio_pago')),
      periodo_texto: oNulo(mesTexto),
      periodo,
      observaciones: oNulo(fila.valor('observaciones')),
      // El RESULTADO de la rendición se guarda tal cual está en la hoja; la pantalla lo normaliza.
      resultado: oNulo(fila.valor('resultado')),
      hay_columna_resultado: fila.tieneColumna('resultado') ? 1 : 0,
      ahora: this.ahora,
    })
    this.contar(resumen, 'pagos')
  }

  /**
   * Un aviso de rechazo del débito, tal como lo escribió la computadora que avisó. Es la vuelta del
   * viaje: el aviso se carga en una sucursal, sube a «APP RECHAZOS» y desde ahí baja acá, que es cómo
   * llega a la computadora de la sucursal avisada.
   *
   * El ESTADO se guarda normalizado a los tres que la aplicación entiende. Uno escrito a mano en la
   * hoja que no sea ninguno de ellos se toma como PENDIENTE: es lo prudente, porque de los tres es el
   * único que sigue a la vista.
   */
  private guardarRechazo(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    const ident = this.identificar(p, fila)
    const fechaTexto = fila.valor('fecha')
    const fecha = interpretarFecha(fechaTexto, null, this.anioActual)
    if (fecha.problema) this.problema(p.titulo, fila.numero, fila.id, 'fecha de aviso inválida', fecha.problema)
    const mesTexto = fila.valor('mes')
    const periodo =
      periodoDesdeTextoDeMes(mesTexto, this.periodoPorMes, this.anioDelPeriodo(this.masNueva?.periodo ?? null)) ??
      (/^\d{4}-\d{2}$/.test(mesTexto) ? mesTexto : null)
    const sucursalTexto = this.sucursalDeLaFila(fila)
    this.resolverSucursal(p, fila, sucursalTexto)
    const estado = normalizarTexto(fila.valor('estado'))
    this.sentencias.rechazo.run({
      fila_id: fila.id,
      pestana: p.titulo,
      poliza_id: this.buscarPoliza(ident),
      cliente_id: this.buscarCliente(ident),
      cliente_nombre: oNulo(ident.nombre),
      documento: oNulo(ident.documento),
      telefono: oNulo(fila.valor('telefono')),
      compania: oNulo(ident.compania),
      numero_poliza: oNulo(ident.numero),
      patente: oNulo(ident.patente),
      forma_pago: oNulo(fila.valor('forma_pago')),
      cuota: oNulo(fila.valor('cuota')),
      periodo,
      sucursal_texto: oNulo(sucursalTexto),
      motivo: oNulo(fila.valor('motivo')),
      nota: oNulo(fila.valor('observaciones')),
      estado: estado === 'RESUELTO' ? 'RESUELTO' : estado === 'VISTO' ? 'VISTO' : 'PENDIENTE',
      fecha: fecha.iso ?? (limpiar(fechaTexto) || this.ahora.slice(0, 10)),
      avisado_por: oNulo(fila.valor('usuario')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'rechazos_debito')
  }

  private guardarReglaCobertura(p: PestanaTrabajo, fila: Fila, resumen: ResumenPestana): void {
    if (this.sinDatosUtiles(p, fila)) return
    this.sentencias.regla.run({
      fila_id: fila.id,
      pestana: p.titulo,
      compania: oNulo(fila.valor('compania')),
      cobertura: oNulo(fila.valor('cobertura')),
      incluye: oNulo(fila.valor('incluye')),
      franquicia: oNulo(fila.valor('franquicia')),
      detalle: oNulo(fila.valor('detalle')),
      observaciones: oNulo(fila.valor('observaciones')),
      ahora: this.ahora,
    })
    this.contar(resumen, 'reglas_cobertura')
  }

  // ---------------------------------------------------------------------------
  // Cierre
  // ---------------------------------------------------------------------------
  private consolidar(): void {
    const resumenMasNueva = this.masNueva ? this.resumenes.find((r) => r.titulo === this.masNueva!.titulo) : undefined
    if (this.periodosIncoherentes) return
    if (this.hojaSoloLectura) {
      this.avisos.push('No se pudo escribir en la hoja: no se tocó el estado activo/inactivo de las pólizas.')
      return
    }
    if (resumenMasNueva?.estado === 'lista') {
      const polizasNuevas = resumenMasNueva.registros.polizas ?? 0
      // Referencia: lo que había activo antes o, en la primera corrida, las filas del mes anterior.
      const referencia = Math.max(this.polizasActivasAntes, this.filasDeLaMensualAnterior)
      if (this.filasDeLaMasNueva > 0 && polizasNuevas < this.filasDeLaMasNueva * 0.5) {
        this.avisos.push(`De las ${this.filasDeLaMasNueva} filas con datos de «${this.masNueva!.titulo}» sólo ${polizasNuevas} se pudieron leer como póliza: revisá el informe antes de dar por buena la cartera.`)
      }
      if (polizasNuevas === 0) {
        this.avisos.push(`La planilla más nueva «${this.masNueva!.titulo}» no generó ninguna póliza: por seguridad no se tocó el estado activo/inactivo de la cartera.`)
      } else if (referencia > 0 && polizasNuevas < referencia * 0.5) {
        // Freno de seguridad: una planilla a medio cargar no puede dejar la cartera sin pólizas vigentes.
        this.avisos.push(
          `La planilla más nueva «${this.masNueva!.titulo}» tiene ${polizasNuevas} pólizas y la referencia anterior era de ${referencia} (menos de la mitad): parece estar a medio cargar, así que por seguridad NO se inactivó ninguna póliza. Si la planilla está completa y es correcta, volvé a correr la importación cuando termines de cargarla.`,
        )
      } else {
        // Las pólizas que esta corrida no tocó ya no están en la planilla más nueva: dejan de estar activas.
        const resultado = this.sentencias.inactivarPolizas.run({ ahora: this.ahora })
        this.polizasInactivadas = resultado.changes
        if (this.polizasInactivadas > 0) this.avisos.push(`${this.polizasInactivadas} pólizas ya no figuran en «${this.masNueva!.titulo}» y quedaron inactivas (no se borran).`)
      }
    } else if (this.masNueva) {
      this.avisos.push(`La planilla más nueva «${this.masNueva.titulo}» no se pudo procesar: no se actualizó el estado activo/inactivo de las pólizas.`)
    }
  }

  private totales(): TotalesImportacion {
    const contar = (tabla: string) => (this.sentencias.contar(tabla).get() as { total: number }).total
    const problemas = Object.values(this.problemasPorTipo).reduce((suma, n) => suma + n, 0)
    return {
      clientes: contar('clientes'),
      vehiculos: contar('vehiculos'),
      polizas: (this.sentencias.contarPolizasActivas.get() as { total: number }).total,
      polizasInactivadas: this.polizasInactivadas,
      cuotasMes: contar('cuotas_mes'),
      bajas: contar('bajas'),
      riesgosVarios: contar('riesgos_varios'),
      siniestros: contar('siniestros'),
      amp: contar('amp'),
      reglasCobertura: contar('reglas_cobertura'),
      pagos: contar('pagos'),
      filasCrudas: contar('filas_crudas'),
      filasQueYaNoEstan: this.filasQueYaNoEstan,
      problemas,
    }
  }

  private armarInforme(): InformeImportacion {
    let totales: TotalesImportacion
    try {
      totales = this.totales()
    } catch {
      totales = { clientes: 0, vehiculos: 0, polizas: 0, polizasInactivadas: 0, cuotasMes: 0, bajas: 0, riesgosVarios: 0, siniestros: 0, amp: 0, reglasCobertura: 0, pagos: 0, filasCrudas: 0, filasQueYaNoEstan: 0, problemas: 0 }
    }
    return {
      id: this.importacionId,
      iniciadaEn: this.iniciadaEn,
      terminadaEn: ahoraIso(),
      estado: this.estado,
      hojaId: this.hojaId,
      hojaTitulo: this.hojaTitulo,
      pestanaMasNueva: this.masNueva?.titulo ?? null,
      pestanas: this.resumenes,
      totales,
      problemasPorTipo: this.problemasPorTipo,
      sucursalesDesconocidas: this.sucursalesDesconocidas,
      problemas: this.problemas,
      problemasOmitidos: this.problemasOmitidos,
      avisos: this.avisos,
      rutaInforme: null,
      error: this.errorFatal,
    }
  }
}

export async function ejecutarImportacion(opciones: OpcionesImportacion): Promise<InformeImportacion> {
  return new TrabajoDeImportacion(opciones).ejecutar()
}
