// Mapeo de encabezados de la fila 1 a campos del modelo, POR NOMBRE y nunca por letra de columna.
// Cada campo tiene una lista de sinónimos ya normalizados (ver normalizarTexto): sin tildes, sin
// puntuación, en mayúsculas. Para agregar una variante nueva alcanza con sumarla a la lista.
import type { ColumnaMapeada, TipoPestana } from '../../shared/tipos'
import { letraColumna, limpiar, normalizarTexto } from './normalizar'

export type Campo =
  | 'nombre'
  | 'documento'
  | 'telefono'
  | 'email'
  | 'direccion'
  | 'localidad'
  | 'sucursal'
  | 'fecha_nacimiento'
  | 'compania'
  | 'numero_poliza'
  | 'cobertura'
  | 'prima'
  | 'forma_pago'
  | 'productor'
  | 'estado'
  | 'vigencia_desde'
  | 'vigencia_hasta'
  | 'alta'
  | 'cuota'
  | 'dia_vencimiento'
  | 'aviso'
  | 'fecha_envio'
  | 'avisar_vto'
  | 'pago'
  | 'observaciones'
  | 'marca'
  | 'modelo'
  | 'anio'
  | 'patente'
  | 'motor'
  | 'chasis'
  | 'tipo_vehiculo'
  | 'uso'
  | 'color'
  | 'suma_asegurada'
  | 'motivo'
  | 'fecha_baja'
  | 'mes'
  | 'tipo_riesgo'
  | 'fecha'
  | 'fecha_carga'
  | 'emision'
  | 'resuelto'
  | 'numero_siniestro'
  | 'descripcion'
  | 'importe'
  | 'medio_pago'
  | 'resultado'
  // El estado del COBRO de un pago (PAGO / IMPUTADO): lo escribe la aplicación en APP PAGOS cuando
  // hay algo que decir. No es el RESULTADO de la rendición.
  | 'cobro'
  | 'detalle'
  | 'franquicia'
  | 'incluye'
  // Campos de las tres pestañas que escribe la aplicación (APP LEADS, APP PRESUPUESTOS, APP TAREAS).
  // No aparecen en ninguna pestaña del Excel de la agencia: son las columnas que la Fase 8 necesita
  // para que lo comercial se pueda mirar también desde Google.
  | 'origen'
  | 'interes'
  | 'usuario'
  | 'numero_presupuesto'
  | 'version'
  | 'opciones'
  | 'precio'
  | 'titulo'
  | 'responsable'
  | 'vence'
  | 'prioridad'
  | 'vinculo'
  // Las dos pestañas de la 12.6: APP ADJUNTOS (fotos y documentos) y APP COMENTARIOS (comentarios
  // de tareas y observaciones de siniestros). Son columnas que sólo escribe y lee la aplicación.
  | 'tipo_registro'
  | 'archivo_nombre'
  | 'categoria'
  | 'archivo'
  | 'tamano'
  | 'sha256'
  | 'texto'

/** Sinónimos generales (normalizados). El orden importa: ante un sinónimo repetido gana el primer campo. */
const SINONIMOS: Record<Campo, string[]> = {
  nombre: ['NOMBRE', 'APELLIDO Y NOMBRE', 'NOMBRE Y APELLIDO', 'APELLIDO NOMBRE', 'NOMBRE APELLIDO', 'APELLIDOS Y NOMBRES', 'NOMBRES Y APELLIDOS', 'ASEGURADO', 'ASEGURADO A', 'ASEG', 'ASEG A', 'CLIENTE', 'TOMADOR', 'TITULAR', 'APELLIDO', 'NOMBRE COMPLETO', 'RAZON SOCIAL', 'CLIENTES'],
  documento: ['DNI', 'CUIT', 'CUIL', 'DNI CUIT', 'DNI O CUIT', 'DNI CUIL', 'CUIT CUIL', 'DNI CUIT CUIL', 'DOCUMENTO', 'DOC', 'NRO DOC', 'N DOC', 'NRO DOCUMENTO', 'NUMERO DE DOCUMENTO', 'N DOCUMENTO', 'DNI N', 'NRO DNI', 'N DNI'],
  telefono: ['TELEFONO', 'TELEFONOS', 'TEL', 'CELULAR', 'CEL', 'WHATSAPP', 'WSP', 'WPP', 'CONTACTO', 'TELEFONO CELULAR', 'TEL CEL', 'NRO TELEFONO', 'N TELEFONO', 'TE', 'NUMERO DE TELEFONO'],
  email: ['EMAIL', 'E MAIL', 'MAIL', 'CORREO', 'CORREO ELECTRONICO', 'EMAILS'],
  direccion: ['DIRECCION', 'DOMICILIO', 'DOM', 'CALLE', 'DIRECCION COMPLETA'],
  localidad: ['LOCALIDAD', 'CIUDAD', 'PARTIDO', 'BARRIO', 'ZONA'],
  sucursal: ['LOCAL', 'SUCURSAL', 'SUC', 'OFICINA', 'SEDE', 'AGENCIA'],
  fecha_nacimiento: ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO', 'NACIMIENTO', 'F NAC', 'FEC NAC', 'F NACIMIENTO', 'FECHA NAC', 'FEC NACIMIENTO', 'CUMPLEANOS'],
  compania: ['COMPANIA', 'CIA', 'COMP', 'ASEGURADORA', 'EMPRESA', 'COMPANIA ASEGURADORA', 'CIA ASEGURADORA', 'COMPANIAS', 'COMPANY'],
  numero_poliza: ['POLIZA', 'N POLIZA', 'NRO POLIZA', 'NUMERO POLIZA', 'NUMERO DE POLIZA', 'N DE POLIZA', 'NRO DE POLIZA', 'POLIZA N', 'POLIZA NRO', 'POLIZA NUMERO', 'NUM POLIZA', 'NO POLIZA', 'POL', 'POLIZAS', 'N DE POLIZAS', 'NUMERO'],
  cobertura: ['COBERTURA', 'COB', 'TIPO DE COBERTURA', 'TIPO COBERTURA', 'PLAN', 'COBERTURAS', 'TIPO DE SEGURO', 'TIPO SEGURO'],
  prima: ['PRIMA', 'PREMIO', 'PREMIO MENSUAL', 'PRIMA MENSUAL', 'PREMIO TOTAL', 'PRIMA TOTAL', 'PREMIO ANUAL', 'PRIMA ANUAL'],
  forma_pago: ['FORMA DE PAGO', 'FORMA PAGO', 'MODO DE PAGO', 'FP', 'F PAGO', 'TIPO DE PAGO', 'MEDIO DE PAGO', 'MEDIO PAGO', 'COBRO', 'FORMA DE COBRO', 'MODALIDAD DE PAGO', 'MODALIDAD'],
  productor: ['PRODUCTOR', 'VENDEDOR', 'ASESOR', 'PAS', 'PRODUCTORA', 'VENDEDORA', 'QUIEN LO TRAJO'],
  estado: ['ESTADO', 'SITUACION', 'ESTADO POLIZA', 'ESTADO DE LA POLIZA', 'STATUS'],
  vigencia_desde: ['VIGENCIA', 'VIGENCIA DESDE', 'DESDE', 'INICIO', 'INICIO VIGENCIA', 'INICIO DE VIGENCIA', 'VIG DESDE', 'FECHA INICIO', 'VIGENCIA INICIO', 'VIG', 'FECHA DE INICIO', 'COMIENZO'],
  vigencia_hasta: ['HASTA', 'VIGENCIA HASTA', 'FIN VIGENCIA', 'FIN DE VIGENCIA', 'VIG HASTA', 'VENCIMIENTO POLIZA', 'VTO POLIZA', 'FECHA FIN', 'VIGENCIA FIN', 'FIN', 'FECHA DE FIN', 'VENCE POLIZA', 'VENCIMIENTO DE POLIZA'],
  alta: ['ALTA', 'FECHA ALTA', 'FECHA DE ALTA', 'F ALTA', 'INGRESO', 'FECHA INGRESO', 'FECHA DE INGRESO', 'ALTA POLIZA'],
  cuota: ['CUOTA', 'CUOTA MENSUAL', 'IMPORTE CUOTA', 'VALOR CUOTA', 'VALOR DE CUOTA', 'CUOTAS', 'MONTO CUOTA', 'IMPORTE DE CUOTA', 'CUOTA MES', 'MONTO'],
  dia_vencimiento: ['VENCIMIENTO', 'VTO', 'VENC', 'DIA DE VENCIMIENTO', 'DIA VTO', 'DIA VENCIMIENTO', 'VENCE', 'DIA', 'DIA DE VTO', 'FECHA VTO', 'FECHA DE VENCIMIENTO', 'FECHA DE VENC', 'FECHA VENC', 'F DE VENC', 'VENCIMIENTO CUOTA', 'VTO CUOTA', 'VENCIMIENTOS', 'DIA DE PAGO', 'DIA PAGO'],
  aviso: ['AVISO', 'AVISOS', 'OB AVISOS', 'OBS AVISOS', 'AVISO ENVIADO', 'AVISADO', 'MENSAJE', 'RECORDATORIO', 'AVISO WSP', 'ENVIADO', 'SE AVISO', 'AVISE', 'AVISADOS'],
  fecha_envio: ['FECHA DE ENVIO', 'FECHA ENVIO', 'ENVIADO EL', 'FECHA DEL AVISO'],
  avisar_vto: ['AVISAR VTO', 'AVISAR VENCIMIENTO', 'AVISAR'],
  pago: ['PAGO', 'PAGOS', 'FECHA DE PAGO', 'FECHA PAGO', 'PAGADO', 'COBRADO', 'ABONO', 'ABONADO', 'FECHA COBRO', 'CUANDO PAGO', 'FECHA EN QUE PAGO', 'PAGO EL', 'F DE PAGO', 'FECHA DEL PAGO'],
  observaciones: ['OBSERVACIONES', 'OBSERVACION', 'OBS', 'OB', 'OB DE COBERTURAS', 'OBS DE COBERTURAS', 'OB COBERTURAS', 'OBS COBERTURAS', 'OBSERVACIONES DE COBERTURA', 'OBSERVACIONES DE COBERTURAS', 'OBSERVACIONES COBERTURA', 'NOTAS', 'NOTA', 'COMENTARIOS', 'COMENTARIO', 'ACLARACIONES', 'ACLARACION', 'OBSERV', 'OBSERVACIONES GENERALES', 'OBS DE PAGOS', 'AVISOS DE PAGOS', 'OB DE PAGOS', 'OBSERVACIONES DE PAGOS'],
  marca: ['MARCA', 'MARCA VEHICULO', 'MARCA DEL VEHICULO', 'MARCAS'],
  modelo: ['MODELO', 'UNIDAD', 'MODELO VEHICULO', 'MARCA Y MODELO', 'MARCA MODELO', 'MODELO MARCA', 'MARCA MOD', 'VEHICULO MODELO', 'AUTOMOTOR', 'RODADO', 'MODELO DEL VEHICULO', 'VEHICULOS', 'MOVIL'],
  anio: ['ANO', 'ANIO', 'MODELO ANO', 'ANO MODELO', 'ANO DEL VEHICULO', 'ANO VEHICULO', 'ANO DEL AUTO', 'ANO FABRICACION', 'ANO DE FABRICACION'],
  patente: ['PATENTE', 'DOMINIO', 'CHAPA', 'PAT', 'PATENTE DOMINIO', 'NRO PATENTE', 'N PATENTE', 'PATENTES', 'DOMINIOS', 'MATRICULA'],
  motor: ['MOTOR', 'N MOTOR', 'NRO MOTOR', 'NUMERO DE MOTOR', 'NUMERO MOTOR', 'N DE MOTOR'],
  chasis: ['CHASIS', 'N CHASIS', 'NRO CHASIS', 'NUMERO DE CHASIS', 'NUMERO CHASIS', 'CUADRO', 'N DE CHASIS', 'CHASSIS'],
  tipo_vehiculo: ['TIPO', 'VEHICULO', 'TIPO DE VEHICULO', 'TIPO VEHICULO', 'TIPO DE UNIDAD', 'CARROCERIA', 'AUTO O MOTO'],
  uso: ['USO', 'USO DEL VEHICULO', 'DESTINO', 'USO VEHICULO'],
  color: ['COLOR'],
  suma_asegurada: ['SUMA ASEGURADA', 'SUMA', 'VALOR ASEGURADO', 'VALOR DEL VEHICULO', 'VALOR VEHICULO', 'SUMA ASEG', 'VALOR AUTO'],
  motivo: ['MOTIVO', 'MOTIVO DE BAJA', 'MOTIVO BAJA', 'CAUSA', 'RAZON', 'MOTIVOS', 'POR QUE', 'PORQUE', 'CAUSA DE BAJA'],
  fecha_baja: ['FECHA DE BAJA', 'FECHA BAJA', 'BAJA', 'F BAJA', 'FECHA DE LA BAJA', 'DIA DE BAJA', 'BAJA EL'],
  mes: ['MES', 'PERIODO', 'MES DE BAJA', 'MES BAJA', 'MES PAGO', 'MES DE PAGO', 'MES ABONADO', 'MES QUE PAGA', 'MES CUOTA', 'PERIODO PAGADO'],
  tipo_riesgo: ['RIESGO', 'TIPO DE RIESGO', 'RAMO', 'BIEN ASEGURADO', 'BIEN', 'SEGURO', 'PRODUCTO', 'TIPO RIESGO', 'RIESGOS', 'RUBRO'],
  fecha: ['FECHA', 'FECHA SINIESTRO', 'FECHA DEL SINIESTRO', 'FECHA DE SINIESTRO', 'FECHA IMPUTACION', 'FECHA DE IMPUTACION', 'FECHA DE OCURRENCIA', 'FECHA OCURRENCIA', 'FECHA DENUNCIA', 'FECHA DE DENUNCIA', 'FECHA DE COBRO'],
  // Cuándo se cargó el siniestro en la agencia, que no es cuándo pasó: son dos columnas distintas.
  fecha_carga: ['FECHA DE CARGA', 'FECHA CARGA', 'CARGA', 'CARGADO EL', 'FECHA DE LA CARGA', 'F CARGA'],
  emision: ['EMISION', 'FECHA DE EMISION', 'FECHA EMISION', 'EMITIDA', 'EMITIDO', 'F EMISION', 'EMISION POLIZA'],
  resuelto: ['RESUELTO', 'RESUELTA', 'RESUELTOS', 'LISTO', 'HECHO', 'TERMINADO', 'FINALIZADO'],
  numero_siniestro: ['SINIESTRO', 'N SINIESTRO', 'NRO SINIESTRO', 'NUMERO DE SINIESTRO', 'NUMERO SINIESTRO', 'N DE SINIESTRO', 'NRO DE SINIESTRO', 'STRO', 'N STRO', 'NRO STRO', 'SINIESTRO N', 'SINIESTRO NRO'],
  descripcion: ['DESCRIPCION', 'HECHO', 'TIPO DE SINIESTRO', 'TIPO SINIESTRO', 'DANOS', 'DANO', 'RELATO', 'QUE PASO', 'DESCRIPCION DEL HECHO', 'DESCRIPCION DEL SINIESTRO', 'DETALLE DEL SINIESTRO'],
  importe: ['IMPORTE', 'TOTAL', 'IMPORTE PAGADO', 'IMPORTE ABONADO', 'IMPORTE COBRADO', 'IMPORTES', 'MONTO PAGADO', 'MONTO ABONADO', 'SUMA PAGADA', 'IMPORTE $'],
  medio_pago: ['MEDIO', 'MEDIOS', 'VIA', 'CANAL', 'FORMA', 'MEDIO DE COBRO', 'COMO PAGO', 'COMO PAGA', 'PAGO POR', 'PAGO CON'],
  // El RESULTADO de la rendición mensual: vacío, IMPUTADO, OK, REVISAR o MAL.
  resultado: ['RESULTADO', 'RESULTADOS', 'RTDO', 'ESTADO DE IMPUTACION', 'ESTADO IMPUTACION', 'IMPUTACION', 'IMPUTADO', 'CONCILIACION', 'CONCILIADO', 'RENDICION'],
  cobro: ['COBRO', 'ESTADO DEL COBRO', 'ESTADO COBRO', 'COBRADO AL CLIENTE', 'COBRO AL CLIENTE'],
  detalle: ['DETALLE', 'CONCEPTO', 'DETALLES', 'CONCEPTOS', 'ITEM', 'DESCRIPCION DETALLE'],
  franquicia: ['FRANQUICIA', 'FRANQ', 'DEDUCIBLE', 'FRANQUICIAS'],
  incluye: ['INCLUYE', 'CUBRE', 'COBERTURAS INCLUIDAS', 'INCLUSIONES', 'QUE CUBRE', 'QUE INCLUYE', 'ALCANCE', 'INCLUIDO'],
  origen: ['ORIGEN', 'COMO LLEGO', 'CANAL DE CONTACTO', 'DE DONDE VINO', 'POR DONDE ENTRO', 'FUENTE'],
  interes: ['QUE ASEGURA', 'QUE QUIERE ASEGURAR', 'QUE BUSCA', 'INTERES', 'CONSULTA', 'PEDIDO'],
  usuario: ['CARGADO POR', 'CREADO POR', 'ATENDIO', 'ATENDIDO POR', 'USUARIO', 'QUIEN CARGO', 'QUIEN ATENDIO'],
  numero_presupuesto: ['N PRESUPUESTO', 'NRO PRESUPUESTO', 'NUMERO DE PRESUPUESTO', 'PRESUPUESTO N', 'PRESUPUESTO NRO'],
  version: ['VERSION', 'VER', 'REVISION'],
  opciones: ['OPCIONES', 'OPCIONES COTIZADAS', 'COTIZACIONES', 'COTIZACION'],
  precio: ['PRECIO', 'PRECIO DESDE', 'PRECIO MENSUAL', 'MEJOR PRECIO'],
  titulo: ['TITULO', 'TAREA', 'ASUNTO'],
  responsable: ['ASIGNADO A', 'ASIGNADA A', 'ASIGNADO', 'RESPONSABLE', 'LE TOCA A', 'A CARGO DE'],
  vence: ['VENCE EL', 'FECHA LIMITE', 'PARA CUANDO', 'LIMITE'],
  prioridad: ['PRIORIDAD', 'URGENCIA', 'IMPORTANCIA'],
  vinculo: ['VINCULO', 'VINCULADA A', 'RELACIONADA CON', 'DE QUE FICHA'],
  tipo_registro: ['TIPO DE REGISTRO', 'TIPO DE FICHA'],
  archivo_nombre: ['NOMBRE DEL ARCHIVO', 'NOMBRE ARCHIVO'],
  categoria: ['CATEGORIA', 'QUE DOCUMENTO ES', 'CLASE DE DOCUMENTO'],
  archivo: ['ARCHIVO', 'ID DEL ARCHIVO', 'ARCHIVO EN EL SERVIDOR'],
  tamano: ['TAMANO', 'PESO', 'BYTES'],
  sha256: ['SHA256', 'SHA-256', 'HUELLA DEL ARCHIVO'],
  texto: ['TEXTO', 'COMENTARIO', 'MENSAJE'],
}

/**
 * Ajustes por tipo de pestaña: el mismo encabezado significa cosas distintas según dónde esté.
 * "PAGO" en una planilla mensual es cuándo pagó; en IMPUTADOS "MEDIO DE PAGO" es el medio, etc.
 */
const AJUSTES_POR_TIPO: Partial<Record<TipoPestana, Record<string, Campo>>> = {
  MENSUAL: {
    IMPORTE: 'cuota',
    VALOR: 'cuota',
    'MEDIO DE PAGO': 'forma_pago',
    DETALLE: 'observaciones',
    FECHA: 'pago',
    'FECHA DE COBRO': 'pago',
    'FECHA COBRO': 'pago',
    COBRADO: 'pago',
    COBRO: 'pago',
  },
  BAJAS: {
    FECHA: 'fecha_baja',
    BAJA: 'fecha_baja',
    DETALLE: 'observaciones',
    DESCRIPCION: 'motivo',
  },
  RIESGOS_VARIOS: {
    // En RIESGOS VARIOS la fecha suelta es la de emisión de la póliza, no un vencimiento.
    FECHA: 'emision',
    DETALLE: 'descripcion',
    DESCRIPCION: 'descripcion',
    IMPORTE: 'cuota',
    VALOR: 'cuota',
    TIPO: 'tipo_riesgo',
    'MEDIO DE PAGO': 'forma_pago',
  },
  SINIESTROS: {
    TIPO: 'descripcion',
    DETALLE: 'descripcion',
    FECHA: 'fecha',
    'FECHA DE CARGA': 'fecha_carga',
    'FECHA CARGA': 'fecha_carga',
    CARGA: 'fecha_carga',
    // Cómo titula la agencia la columna del trámite. Van acá y no en la lista general porque en una
    // planilla MENSUAL «TRÁMITE» o «GESTIÓN» no son el estado de nada: sin este ajuste, una pestaña
    // SINIESTROS con la columna llamada de otra manera importaba todas las filas sin estado y las
    // cuatro fichas quedaban en CARGADO.
    'ESTADO DEL TRAMITE': 'estado',
    'ESTADO TRAMITE': 'estado',
    'ESTADO DEL SINIESTRO': 'estado',
    'ESTADO SINIESTRO': 'estado',
    TRAMITE: 'estado',
    GESTION: 'estado',
    SEGUIMIENTO: 'estado',
  },
  // AMP es la lista de ampliaciones pendientes: el nombre del cliente, qué se amplía y para cuándo.
  AMP: {
    FECHA: 'fecha',
    AMPLIACION: 'descripcion',
    AMPLIACIONES: 'descripcion',
    DETALLE: 'descripcion',
    TIPO: 'descripcion',
    'FECHA DE VTO': 'dia_vencimiento',
    'FECHA DE VENCIMIENTO': 'dia_vencimiento',
    'FECHA VTO': 'dia_vencimiento',
    VTO: 'dia_vencimiento',
    VENCIMIENTO: 'dia_vencimiento',
  },
  PAGOS: {
    'FORMA DE PAGO': 'medio_pago',
    'FORMA PAGO': 'medio_pago',
    'TIPO DE PAGO': 'medio_pago',
    'MEDIO DE PAGO': 'medio_pago',
    FECHA: 'fecha',
    'FECHA DE PAGO': 'fecha',
    'FECHA PAGO': 'fecha',
    'FECHA DE COBRO': 'fecha',
    'FECHA COBRO': 'fecha',
    COBRADO: 'fecha',
    PAGO: 'fecha',
    DETALLE: 'observaciones',
    CONCEPTO: 'observaciones',
    VALOR: 'importe',
    MONTO: 'importe',
    CUOTA: 'importe',
    // En IMPUTADOS la columna de estado es el resultado de la rendición, no el estado de la póliza.
    ESTADO: 'resultado',
    SITUACION: 'resultado',
    // Quién cobró: la columna que escribe la aplicación en APP PAGOS.
    'COBRADO POR': 'usuario',
    // Si el cliente pagó o si la agencia le imputó la cuota a la compañía y falta cobrarle: también
    // la escribe la aplicación en APP PAGOS.
    COBRO: 'cobro',
  },
  COBERTURA: {
    DESCRIPCION: 'detalle',
    TIPO: 'cobertura',
    PLAN: 'cobertura',
    NOMBRE: 'cobertura',
  },
  // Las pestañas que escribe la aplicación. Sus encabezados los pone DM Gestión al crearlas, así que
  // acá se los ata uno por uno: no se deja nada librado al índice general, donde «NUMERO» es el de la
  // póliza y «VENCE» es el día de vencimiento de una cuota.
  APP_LEADS: {
    FECHA: 'fecha',
    TIPO: 'tipo_vehiculo',
    'TIPO DE VEHICULO': 'tipo_vehiculo',
    NOTAS: 'observaciones',
    ESTADO: 'estado',
  },
  APP_PRESUPUESTOS: {
    FECHA: 'fecha',
    NUMERO: 'numero_presupuesto',
    'N PRESUPUESTO': 'numero_presupuesto',
    ESTADO: 'estado',
    TIPO: 'tipo_vehiculo',
    'PRECIO DESDE': 'precio',
    DESDE: 'precio',
  },
  APP_TAREAS: {
    FECHA: 'fecha',
    VENCE: 'vence',
    VENCIMIENTO: 'vence',
    'FECHA LIMITE': 'vence',
    DESCRIPCION: 'descripcion',
    DETALLE: 'descripcion',
    ESTADO: 'estado',
  },
  // En APP ADJUNTOS, TIPO es de qué ficha cuelga el archivo (POLIZA / SINIESTRO / TAREA) y NOMBRE es
  // el nombre del archivo, no el de un cliente: acá no hay clientes, hay archivos.
  APP_ADJUNTOS: {
    FECHA: 'fecha',
    TIPO: 'tipo_registro',
    VINCULO: 'vinculo',
    DESCRIPCION: 'descripcion',
    NOMBRE: 'archivo_nombre',
    CATEGORIA: 'categoria',
    ARCHIVO: 'archivo',
    TAMANO: 'tamano',
    SHA256: 'sha256',
  },
  APP_COMENTARIOS: {
    FECHA: 'fecha',
    TIPO: 'tipo_registro',
    VINCULO: 'vinculo',
    USUARIO: 'usuario',
    TEXTO: 'texto',
  },
  // En los rechazos, FECHA es el día del aviso y MES el de la cuota que rebotó. ESTADO es en qué anda
  // el aviso (PENDIENTE / VISTO / RESUELTO), no el estado de la póliza.
  APP_RECHAZOS: {
    FECHA: 'fecha',
    MES: 'mes',
    ESTADO: 'estado',
    MOTIVO: 'motivo',
    OBSERVACIONES: 'observaciones',
    'FORMA DE PAGO': 'forma_pago',
  },
}

/** Campos que tienen sentido en cada tipo de pestaña. Los demás quedan sólo en los datos crudos. */
const CAMPOS_POR_TIPO: Record<TipoPestana, Campo[] | 'todos'> = {
  MENSUAL: ['nombre', 'documento', 'telefono', 'email', 'direccion', 'localidad', 'sucursal', 'fecha_nacimiento', 'compania', 'numero_poliza', 'cobertura', 'prima', 'forma_pago', 'productor', 'estado', 'vigencia_desde', 'vigencia_hasta', 'alta', 'cuota', 'dia_vencimiento', 'aviso', 'fecha_envio', 'avisar_vto', 'pago', 'observaciones', 'marca', 'modelo', 'anio', 'patente', 'motor', 'chasis', 'tipo_vehiculo', 'uso', 'color', 'suma_asegurada'],
  BAJAS: ['nombre', 'documento', 'telefono', 'sucursal', 'compania', 'numero_poliza', 'cobertura', 'patente', 'marca', 'modelo', 'motivo', 'fecha_baja', 'mes', 'observaciones', 'cuota', 'productor'],
  RIESGOS_VARIOS: ['nombre', 'documento', 'telefono', 'email', 'direccion', 'localidad', 'sucursal', 'emision', 'tipo_riesgo', 'descripcion', 'compania', 'numero_poliza', 'prima', 'cuota', 'vigencia_desde', 'vigencia_hasta', 'forma_pago', 'dia_vencimiento', 'aviso', 'pago', 'observaciones', 'productor', 'estado', 'patente', 'marca', 'modelo'],
  SINIESTROS: ['fecha', 'fecha_carga', 'nombre', 'documento', 'telefono', 'sucursal', 'patente', 'marca', 'modelo', 'compania', 'numero_poliza', 'cobertura', 'numero_siniestro', 'descripcion', 'estado', 'importe', 'observaciones'],
  PAGOS: ['fecha', 'nombre', 'documento', 'sucursal', 'compania', 'numero_poliza', 'patente', 'importe', 'medio_pago', 'mes', 'observaciones', 'cuota', 'resultado', 'usuario', 'cobro'],
  COBERTURA: ['compania', 'cobertura', 'incluye', 'franquicia', 'detalle', 'observaciones', 'prima'],
  CONTADOR: 'todos',
  SEGUROS_ACT: 'todos',
  AMP: ['sucursal', 'fecha', 'nombre', 'documento', 'telefono', 'forma_pago', 'patente', 'marca', 'modelo', 'compania', 'numero_poliza', 'descripcion', 'dia_vencimiento', 'observaciones', 'resuelto'],
  APP_LEADS: ['fecha', 'sucursal', 'nombre', 'telefono', 'documento', 'email', 'origen', 'interes', 'tipo_vehiculo', 'estado', 'observaciones', 'usuario'],
  APP_PRESUPUESTOS: ['fecha', 'numero_presupuesto', 'version', 'sucursal', 'nombre', 'telefono', 'documento', 'patente', 'marca', 'modelo', 'anio', 'tipo_vehiculo', 'opciones', 'precio', 'estado', 'observaciones', 'usuario'],
  APP_TAREAS: ['fecha', 'titulo', 'descripcion', 'responsable', 'sucursal', 'vence', 'prioridad', 'estado', 'vinculo', 'usuario'],
  APP_RECHAZOS: ['fecha', 'sucursal', 'nombre', 'documento', 'telefono', 'compania', 'numero_poliza', 'patente', 'forma_pago', 'cuota', 'mes', 'motivo', 'observaciones', 'estado', 'usuario'],
  APP_ADJUNTOS: ['fecha', 'tipo_registro', 'vinculo', 'descripcion', 'archivo_nombre', 'categoria', 'archivo', 'tamano', 'sha256', 'usuario'],
  APP_COMENTARIOS: ['fecha', 'tipo_registro', 'vinculo', 'usuario', 'texto'],
  OTRA: 'todos',
}

/** Índice inverso sinónimo → campo (se arma una sola vez). */
const INDICE_GENERAL = new Map<string, Campo>()
/**
 * Segundo índice, sin los espacios: la normalización convierte la puntuación en espacios, así que
 * «D.N.I.» llega como "D N I" y «C.U.I.T.» como "C U I T". Comparando también sin espacios, esas
 * variantes caen en DNI y CUIT. Se consulta sólo si falló la coincidencia exacta.
 */
const INDICE_COMPACTO = new Map<string, Campo>()
for (const [campo, sinonimos] of Object.entries(SINONIMOS) as Array<[Campo, string[]]>) {
  for (const sinonimo of sinonimos) {
    if (!INDICE_GENERAL.has(sinonimo)) INDICE_GENERAL.set(sinonimo, campo)
    const compacto = sinonimo.replace(/ /g, '')
    if (!INDICE_COMPACTO.has(compacto)) INDICE_COMPACTO.set(compacto, campo)
  }
}

export const ENCABEZADO_ID = '_ID'

export interface MapeoDeColumnas {
  columnas: ColumnaMapeada[]
  /** Índice de columna por campo (sólo los que se pudieron asignar). */
  porCampo: Map<Campo, number>
  /**
   * Columnas adicionales que caen en un campo que admite varias ("APELLIDO" + "NOMBRE",
   * "OBS" + "OB. DE COBERTURAS", dos teléfonos): sus valores se concatenan al leer.
   */
  extras: Map<Campo, number[]>
  /**
   * Columnas de respaldo: caen en el mismo campo pero NO se concatenan («DNI» + «CUIT»,
   * «PAGO» + «FECHA DE PAGO»). Se usa la primera que tenga algo cargado en esa fila.
   */
  alternativas: Map<Campo, number[]>
  /** Índice de la columna _ID si ya existe en la hoja (la primera, si hay más de una). */
  columnaId: number | null
  /** Todas las columnas tituladas _ID: no cuentan como datos de la fila. */
  columnasId: number[]
  /** Encabezados originales, limpios, por índice. */
  encabezados: string[]
}

/** Campos donde dos columnas no se pisan sino que se suman. */
const CAMPOS_ACUMULABLES: Campo[] = ['nombre', 'observaciones', 'telefono', 'descripcion', 'incluye']

/**
 * Cuando dos columnas caen en el mismo campo, gana la que esté antes en esta lista, no la que esté
 * más a la izquierda. Hace falta de verdad: en la planilla de JULIO conviven «FECHA DE PAGO» (la fecha
 * del cupón, cargada en las 2.300 filas) y «CUANDO PAGO» (cuándo pagó de verdad, en 57). Sin esto,
 * la planilla daba a todo el mundo por pagado.
 */
const PREFERENCIAS: Partial<Record<Campo, string[]>> = {
  pago: ['CUANDO PAGO', 'FECHA EN QUE PAGO', 'PAGO EL', 'FECHA DEL PAGO', 'FECHA DE PAGO', 'FECHA PAGO', 'PAGADO', 'COBRADO', 'PAGO'],
  dia_vencimiento: ['DIA DE VTO', 'DIA DE VENCIMIENTO', 'DIA VTO', 'FECHA DE VENCIMIENTO', 'FECHA DE VENC', 'VENCIMIENTO', 'VTO'],
  aviso: ['OB AVISOS', 'AVISO ENVIADO', 'AVISO', 'AVISOS'],
  nombre: ['APELLIDO Y NOMBRE', 'NOMBRE Y APELLIDO', 'NOMBRE COMPLETO', 'ASEGURADO', 'TITULAR', 'CLIENTE', 'NOMBRE'],
  documento: ['DNI CUIT', 'DNI', 'CUIT', 'DOCUMENTO'],
}

/**
 * Campos donde una segunda columna es OTRA FUENTE DEL MISMO DATO y sirve de respaldo cuando la
 * principal está vacía: «DNI» + «CUIT» (las empresas tienen una y las personas la otra), dos teléfonos,
 * dos columnas de patente. En los demás campos, dos columnas parecidas suelen ser cosas distintas
 * («FECHA DE PAGO» es la del cupón y «CUANDO PAGO» es cuándo pagó): ahí la segunda NO se usa de
 * respaldo, porque daría por pagada a toda la cartera.
 */
const CAMPOS_CON_RESPALDO: Campo[] = [
  // Un nombre vacío deja la fila sin identificar: mejor tomar la otra columna de nombre que nada.
  'nombre',
  'documento',
  'telefono',
  'email',
  'direccion',
  'localidad',
  'sucursal',
  'patente',
  'numero_poliza',
  'compania',
  'marca',
  'modelo',
  'anio',
  'motor',
  'chasis',
  'cobertura',
  'productor',
]

/** Qué tan preferido es un encabezado para un campo: más chico, mejor. */
function rangoDePreferencia(campo: Campo, encabezado: string): number {
  const lista = PREFERENCIAS[campo]
  if (!lista) return Number.MAX_SAFE_INTEGER
  const normalizado = normalizarTexto(encabezado)
  const posicion = lista.indexOf(normalizado)
  return posicion === -1 ? Number.MAX_SAFE_INTEGER : posicion
}

/**
 * Sólo estos encabezados se suman entre sí en el campo `nombre`. Sin esta lista, «ASEGURADO» +
 * «TITULAR» (el que paga el débito) terminaban pegados en un solo nombre, fusionando dos personas.
 */
const PARTES_DE_NOMBRE = new Set(['APELLIDO', 'APELLIDOS', 'NOMBRE', 'NOMBRES', 'SEGUNDO NOMBRE', '2 NOMBRE', 'NOMBRE 2', 'APELLIDO MATERNO', 'APELLIDO PATERNO'])

function seSuman(campo: Campo, encabezadoExistente: string, encabezadoNuevo: string): boolean {
  if (!CAMPOS_ACUMULABLES.includes(campo)) return false
  if (campo !== 'nombre') return true
  return PARTES_DE_NOMBRE.has(normalizarTexto(encabezadoExistente)) && PARTES_DE_NOMBRE.has(normalizarTexto(encabezadoNuevo))
}

export function resolverCampo(encabezado: string, tipo: TipoPestana): Campo | null {
  const clave = normalizarTexto(encabezado)
  if (!clave) return null
  const compacta = clave.replace(/ /g, '')
  const ajustes = AJUSTES_POR_TIPO[tipo]
  const ajuste = ajustes?.[clave] ?? ajustes?.[compacta]
  const campo = ajuste ?? INDICE_GENERAL.get(clave) ?? INDICE_COMPACTO.get(compacta) ?? null
  if (!campo) return null
  const permitidos = CAMPOS_POR_TIPO[tipo]
  if (permitidos !== 'todos' && !permitidos.includes(campo)) return null
  return campo
}

/**
 * Asigna cada encabezado a un campo. Si dos columnas caen en el mismo campo, gana la primera y la
 * segunda queda sin mapear (con nota), para no pisar datos silenciosamente.
 */
export function mapearEncabezados(filaEncabezados: string[], tipo: TipoPestana): MapeoDeColumnas {
  const encabezados = filaEncabezados.map((valor) => limpiar(valor))
  const porCampo = new Map<Campo, number>()
  const extras = new Map<Campo, number[]>()
  const alternativas = new Map<Campo, number[]>()
  const columnas: ColumnaMapeada[] = []
  const columnasId: number[] = []
  let columnaId: number | null = null

  encabezados.forEach((encabezado, indice) => {
    const columna = letraColumna(indice)
    if (!encabezado) {
      columnas.push({ columna, encabezado, campo: null, nota: 'encabezado vacío' })
      return
    }
    if (encabezado.toUpperCase() === ENCABEZADO_ID) {
      columnasId.push(indice)
      // Si alguien pegó un bloque de columnas con su _ID, manda la primera y la otra se ignora.
      const repetida = columnaId !== null
      if (!repetida) columnaId = indice
      columnas.push({
        columna,
        encabezado,
        campo: '_id',
        nota: repetida ? `columna _ID repetida; se usa la ${letraColumna(columnaId!)}` : 'identificador de sincronización',
      })
      return
    }
    const campo = resolverCampo(encabezado, tipo)
    if (!campo) {
      columnas.push({ columna, encabezado, campo: null, nota: 'sin mapeo: queda sólo en los datos crudos' })
      return
    }
    const yaAsignada = porCampo.get(campo)
    if (yaAsignada !== undefined) {
      if (seSuman(campo, encabezados[yaAsignada] ?? '', encabezado)) {
        extras.set(campo, [...(extras.get(campo) ?? []), indice])
        columnas.push({ columna, encabezado, campo, nota: `se suma al campo ${campo} de la columna ${letraColumna(yaAsignada)}` })
      } else if (rangoDePreferencia(campo, encabezado) < rangoDePreferencia(campo, encabezados[yaAsignada] ?? '')) {
        // Ésta describe mejor el campo: pasa a ser la principal y la anterior se corre.
        porCampo.set(campo, indice)
        if (CAMPOS_CON_RESPALDO.includes(campo)) alternativas.set(campo, [yaAsignada, ...(alternativas.get(campo) ?? [])])
        const anterior = columnas[yaAsignada]
        if (anterior) {
          anterior.campo = null
          anterior.nota = `${campo} lo toma la columna ${columna} («${encabezado}»), que es más específica`
        }
        columnas.push({ columna, encabezado, campo, nota: `más específica que la columna ${letraColumna(yaAsignada)} para ${campo}` })
      } else if (CAMPOS_CON_RESPALDO.includes(campo)) {
        // Otra fuente del mismo dato: se usa en las filas donde la principal esté vacía.
        alternativas.set(campo, [...(alternativas.get(campo) ?? []), indice])
        columnas.push({ columna, encabezado, campo: null, nota: `repite el campo ${campo} de la columna ${letraColumna(yaAsignada)}; se usa aquella y ésta como respaldo` })
      } else {
        columnas.push({ columna, encabezado, campo: null, nota: `repite el campo ${campo} de la columna ${letraColumna(yaAsignada)}; se usa aquella` })
      }
      return
    }
    porCampo.set(campo, indice)
    columnas.push({ columna, encabezado, campo, nota: null })
  })

  return { columnas, porCampo, extras, alternativas, columnaId, columnasId, encabezados }
}

/**
 * Columna donde escribir _ID cuando no existe: la primera que esté vacía en TODAS las filas a partir del
 * último encabezado. Así nunca se pisa una columna sin encabezado que tenga datos más abajo.
 */
export function columnaLibreParaId(valores: string[][]): number {
  const encabezados = valores[0] ?? []
  let indice = primeraColumnaLibre(encabezados)
  const anchoMaximo = valores.reduce((maximo, fila) => Math.max(maximo, fila.length), 0)
  while (indice < anchoMaximo) {
    const libre = valores.every((fila) => limpiar(fila[indice]) === '')
    if (libre) break
    indice++
  }
  return indice
}

/**
 * Qué tan bien le calza un mapeo a unas filas de datos. Sirve para dos cosas: elegir cuál de las
 * primeras filas es la de encabezados, y —cuando la pestaña no tiene ninguna— decidir cuál de los
 * mapeos de las otras pestañas describe mejor sus columnas.
 *
 * Se puntúa lo que se puede verificar mirando el dato: un documento parece documento, una patente
 * parece patente, una cuota es un importe, un nombre tiene dos palabras.
 */
export function puntuarMapeoContraDatos(mapeo: MapeoDeColumnas, filas: string[][]): number {
  if (mapeo.porCampo.size === 0 || filas.length === 0) return 0
  const columna = (campo: Campo) => mapeo.porCampo.get(campo)
  const valores = (campo: Campo) => {
    const indice = columna(campo)
    if (indice === undefined) return []
    return filas.map((f) => limpiar(f[indice])).filter((v) => v !== '')
  }
  const proporcion = (lista: string[], cumple: (v: string) => boolean) =>
    lista.length === 0 ? 0 : lista.filter(cumple).length / lista.length

  let puntos = 0
  const documentos = valores('documento')
  if (documentos.length > 0) puntos += 3 * proporcion(documentos, (v) => /^\d{7,11}$/.test(v.replace(/\D+/g, '')))
  const patentes = valores('patente')
  if (patentes.length > 0) puntos += 3 * proporcion(patentes, (v) => /^[A-Z]{2,3}[\s-]?\d{3}[\s-]?[A-Z]{0,2}$/i.test(v))
  const cuotas = valores('cuota')
  if (cuotas.length > 0) puntos += 2 * proporcion(cuotas, (v) => /\d/.test(v) && /^[$\s]*[\d.,]+$/.test(v))
  const nombres = valores('nombre')
  if (nombres.length > 0) puntos += 2 * proporcion(nombres, (v) => /^[^\d]{5,}$/.test(v) && v.trim().includes(' '))
  const anios = valores('anio')
  if (anios.length > 0) puntos += proporcion(anios, (v) => /^(19|20)\d{2}$/.test(v))
  const telefonos = valores('telefono')
  if (telefonos.length > 0) puntos += proporcion(telefonos, (v) => v.replace(/\D+/g, '').length >= 8)
  return puntos
}

/** true si la fila repite el texto de los encabezados (pasa cuando el título se repite a mitad de la hoja). */
export function repiteEncabezados(celdas: string[], encabezados: string[]): boolean {
  let iguales = 0
  for (let i = 0; i < encabezados.length; i++) {
    const encabezado = normalizarTexto(encabezados[i])
    if (!encabezado) continue
    if (normalizarTexto(celdas[i]) === encabezado) iguales++
  }
  return iguales >= 3
}

/** Los _ID son 12 caracteres alfanuméricos en minúscula: se los reconoce sin encabezado. */
export const FORMATO_ID = /^[a-z0-9]{12}$/

/**
 * Columna de _ID de una pestaña que no tiene fila de encabezados: se busca por contenido, una columna
 * donde casi todo lo cargado tenga la forma de un identificador.
 */
export function columnaIdPorContenido(valores: string[][]): number | null {
  const ancho = valores.reduce((maximo, f) => Math.max(maximo, f.length), 0)
  for (let c = ancho - 1; c >= 0; c--) {
    let conDatos = 0
    let conForma = 0
    for (const fila of valores) {
      const valor = limpiar(fila[c])
      if (!valor) continue
      conDatos++
      if (FORMATO_ID.test(valor)) conForma++
    }
    if (conDatos >= 3 ? conForma / conDatos >= 0.9 : conDatos >= 1 && conForma === conDatos) return c
  }
  return null
}

/** Primera columna libre después del último encabezado no vacío (donde se escribe _ID si no existe). */
export function primeraColumnaLibre(encabezados: string[]): number {
  let ultimaConDatos = -1
  encabezados.forEach((encabezado, indice) => {
    if (limpiar(encabezado)) ultimaConDatos = indice
  })
  return ultimaConDatos + 1
}
