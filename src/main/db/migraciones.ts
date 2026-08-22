// Migraciones del esquema. Se aplican en orden y se registra la versión con PRAGMA user_version.
import type { Database } from 'better-sqlite3'

interface Migracion {
  version: number
  descripcion: string
  sql: string
}

export const MIGRACIONES: Migracion[] = [
  {
    version: 1,
    descripcion: 'Sucursales y usuarios',
    sql: `
      CREATE TABLE sucursales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE
      );

      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
        clave_hash TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('SUPER_ADMIN', 'ADMIN', 'EMPLEADO')),
        sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        debe_cambiar_clave INTEGER NOT NULL DEFAULT 0 CHECK (debe_cambiar_clave IN (0, 1)),
        creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX idx_usuarios_sucursal ON usuarios (sucursal_id);
    `,
  },
  {
    version: 2,
    descripcion: 'Importación desde Google Sheets: cartera, cuotas, bajas, riesgos, siniestros, reglas y pagos',
    sql: `
      -- Corridas de importación y su informe.
      CREATE TABLE importaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        iniciada_en TEXT NOT NULL,
        terminada_en TEXT,
        estado TEXT NOT NULL CHECK (estado IN ('EN_CURSO', 'COMPLETA', 'CON_ERRORES', 'CANCELADA', 'FALLIDA')),
        hoja_id TEXT,
        hoja_titulo TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        informe_json TEXT,
        informe_texto TEXT,
        ruta_informe TEXT
      );

      -- Toda fila de toda pestaña, tal cual está en la hoja. Es la red de seguridad:
      -- nada se pierde aunque una columna no tenga mapeo. Clave: el _ID escrito en la hoja.
      CREATE TABLE filas_crudas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        tipo_pestana TEXT NOT NULL,
        periodo TEXT,
        numero_fila INTEGER NOT NULL,
        datos_json TEXT NOT NULL,
        importacion_id INTEGER REFERENCES importaciones(id),
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_filas_crudas_pestana ON filas_crudas (pestana);

      -- Cliente único por DNI/CUIT. clave = 'DOC:<dígitos>' o 'NOM:<nombre normalizado>' si no hay documento.
      CREATE TABLE clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        documento TEXT,
        documento_normalizado TEXT,
        nombre TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        direccion TEXT,
        localidad TEXT,
        sucursal_id INTEGER REFERENCES sucursales(id),
        sucursal_texto TEXT,
        fecha_nacimiento TEXT,
        fila_id TEXT,
        pestana_origen TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_clientes_documento ON clientes (documento_normalizado);

      CREATE TABLE vehiculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        patente TEXT,
        patente_normalizada TEXT,
        marca TEXT,
        modelo TEXT,
        anio TEXT,
        anio_numero INTEGER,
        motor TEXT,
        chasis TEXT,
        tipo TEXT,
        uso TEXT,
        color TEXT,
        suma_asegurada TEXT,
        cliente_id INTEGER REFERENCES clientes(id),
        fila_id TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_vehiculos_patente ON vehiculos (patente_normalizada);
      CREATE INDEX idx_vehiculos_cliente ON vehiculos (cliente_id);

      -- Pólizas activas según la planilla mensual más nueva.
      -- clave = 'POL:<cía>|<número>' o, si no hay número, 'DOCPAT:<doc>|<patente>', 'NOMPAT:<nombre>|<patente>', 'FILA:<_ID>'.
      CREATE TABLE polizas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        fila_id TEXT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        vehiculo_id INTEGER REFERENCES vehiculos(id),
        compania TEXT,
        numero TEXT,
        numero_normalizado TEXT,
        cobertura TEXT,
        prima TEXT,
        prima_monto REAL,
        forma_pago TEXT,
        productor TEXT,
        estado_texto TEXT,
        vigencia_desde TEXT,
        vigencia_hasta TEXT,
        alta TEXT,
        periodo_origen TEXT NOT NULL,
        pestana_origen TEXT NOT NULL,
        activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_polizas_cliente ON polizas (cliente_id);
      CREATE INDEX idx_polizas_vehiculo ON polizas (vehiculo_id);
      CREATE INDEX idx_polizas_numero ON polizas (numero_normalizado);

      -- Una fila por póliza y mes: lo que dice cada planilla mensual. Conserva los datos de la fila
      -- (nombre, documento, patente…) por si la póliza ya no existe en la planilla más nueva.
      CREATE TABLE cuotas_mes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        periodo TEXT NOT NULL,
        pestana TEXT NOT NULL,
        poliza_id INTEGER REFERENCES polizas(id),
        cliente_id INTEGER REFERENCES clientes(id),
        cliente_nombre TEXT,
        documento TEXT,
        compania TEXT,
        numero_poliza TEXT,
        patente TEXT,
        sucursal_texto TEXT,
        cuota TEXT,
        cuota_monto REAL,
        dia_vencimiento TEXT,
        dia_vencimiento_numero INTEGER,
        aviso TEXT,
        aviso_enviado INTEGER,
        pago TEXT,
        pago_fecha TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_cuotas_mes_poliza ON cuotas_mes (poliza_id);
      CREATE INDEX idx_cuotas_mes_periodo ON cuotas_mes (periodo);
      CREATE INDEX idx_cuotas_mes_cliente ON cuotas_mes (cliente_id);

      CREATE TABLE bajas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        periodo TEXT,
        mes_texto TEXT,
        poliza_id INTEGER REFERENCES polizas(id),
        cliente_id INTEGER REFERENCES clientes(id),
        cliente_nombre TEXT,
        documento TEXT,
        compania TEXT,
        numero_poliza TEXT,
        patente TEXT,
        sucursal_texto TEXT,
        motivo TEXT,
        fecha_baja TEXT,
        fecha_baja_iso TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_bajas_poliza ON bajas (poliza_id);
      CREATE INDEX idx_bajas_periodo ON bajas (periodo);

      CREATE TABLE riesgos_varios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        cliente_id INTEGER REFERENCES clientes(id),
        cliente_nombre TEXT,
        documento TEXT,
        telefono TEXT,
        sucursal_texto TEXT,
        tipo_riesgo TEXT,
        descripcion TEXT,
        compania TEXT,
        numero_poliza TEXT,
        patente TEXT,
        prima TEXT,
        cuota TEXT,
        cuota_monto REAL,
        dia_vencimiento TEXT,
        aviso TEXT,
        pago TEXT,
        vigencia_desde TEXT,
        vigencia_hasta TEXT,
        forma_pago TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_riesgos_varios_cliente ON riesgos_varios (cliente_id);

      CREATE TABLE siniestros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        cliente_id INTEGER REFERENCES clientes(id),
        poliza_id INTEGER REFERENCES polizas(id),
        fecha TEXT,
        fecha_iso TEXT,
        cliente_nombre TEXT,
        documento TEXT,
        patente TEXT,
        sucursal_texto TEXT,
        compania TEXT,
        numero_poliza TEXT,
        numero_siniestro TEXT,
        descripcion TEXT,
        estado TEXT,
        importe TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_siniestros_cliente ON siniestros (cliente_id);
      CREATE INDEX idx_siniestros_poliza ON siniestros (poliza_id);

      CREATE TABLE reglas_cobertura (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        compania TEXT,
        cobertura TEXT,
        incluye TEXT,
        franquicia TEXT,
        detalle TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      CREATE TABLE pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        cliente_id INTEGER REFERENCES clientes(id),
        poliza_id INTEGER REFERENCES polizas(id),
        fecha TEXT,
        fecha_iso TEXT,
        cliente_nombre TEXT,
        documento TEXT,
        compania TEXT,
        numero_poliza TEXT,
        patente TEXT,
        sucursal_texto TEXT,
        importe TEXT,
        importe_monto REAL,
        medio TEXT,
        periodo_texto TEXT,
        periodo TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_pagos_cliente ON pagos (cliente_id);
      CREATE INDEX idx_pagos_poliza ON pagos (poliza_id);
      CREATE INDEX idx_pagos_periodo ON pagos (periodo);
    `,
  },
  {
    version: 3,
    descripcion: 'Marca de las filas que ya no están en la hoja',
    sql: `
      -- Una fila que se borró de la hoja no se borra de la base (es el histórico), pero se marca
      -- para que las pantallas no la muestren como vigente y el informe la pueda contar.
      ALTER TABLE filas_crudas ADD COLUMN en_la_hoja INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE filas_crudas ADD COLUMN vista_en TEXT;
      CREATE INDEX idx_filas_crudas_en_la_hoja ON filas_crudas (en_la_hoja);

      -- El _ID de la fila que originó cada registro es su ancla: si en la hoja se corrige el DNI, se
      -- patenta un 0KM o la póliza recibe número, la clave calculada cambia pero la fila es la misma.
      -- Con esto se actualiza el registro existente en vez de crear un duplicado.
      -- Antes de crear los índices se desempata cualquier repetido que hubiera quedado de la v2.
      UPDATE clientes SET fila_id = NULL WHERE fila_id IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM clientes WHERE fila_id IS NOT NULL GROUP BY fila_id);
      UPDATE vehiculos SET fila_id = NULL WHERE fila_id IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM vehiculos WHERE fila_id IS NOT NULL GROUP BY fila_id);
      UPDATE polizas SET fila_id = NULL WHERE fila_id IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM polizas WHERE fila_id IS NOT NULL GROUP BY fila_id);

      CREATE UNIQUE INDEX idx_clientes_fila ON clientes (fila_id) WHERE fila_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_vehiculos_fila ON vehiculos (fila_id) WHERE fila_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_polizas_fila ON polizas (fila_id) WHERE fila_id IS NOT NULL;
    `,
  },
  {
    version: 4,
    descripcion: 'Cartera: compañías, historial y columnas de la planilla del mes',
    sql: `
      -- Compañías aseguradoras. «días de cobertura financiera» son los que la compañía sigue cubriendo
      -- al cliente después del vencimiento: definen el amarillo y el naranja del semáforo.
      CREATE TABLE companias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        nombre_normalizado TEXT NOT NULL UNIQUE,
        dias_cobertura_financiera INTEGER NOT NULL DEFAULT 30,
        activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      -- Preferencias de la aplicación (la plantilla del aviso, por ejemplo). Las credenciales de
      -- Google siguen en config.json, fuera de la base.
      CREATE TABLE configuracion (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      -- Todo cambio hecho desde la aplicación queda registrado acá.
      CREATE TABLE historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        accion TEXT NOT NULL,
        tabla TEXT NOT NULL,
        registro_id INTEGER,
        fila_id TEXT,
        campo TEXT NOT NULL,
        valor_anterior TEXT,
        valor_nuevo TEXT
      );
      CREATE INDEX idx_historial_fecha ON historial (fecha);
      CREATE INDEX idx_historial_fila ON historial (fila_id);

      -- Columnas de la planilla mensual que hasta ahora quedaban sólo en los datos crudos.
      ALTER TABLE cuotas_mes ADD COLUMN forma_pago TEXT;
      ALTER TABLE cuotas_mes ADD COLUMN fecha_envio TEXT;
      ALTER TABLE cuotas_mes ADD COLUMN avisar_vto TEXT;
      -- Marca las cuotas creadas por «Cerrar mes» (no vienen de la hoja).
      ALTER TABLE cuotas_mes ADD COLUMN creada_en_la_app INTEGER NOT NULL DEFAULT 0;
      -- La fila se dio de baja desde la aplicación: sale de la planilla y aparece en Bajas.
      ALTER TABLE cuotas_mes ADD COLUMN dada_de_baja INTEGER NOT NULL DEFAULT 0;

      -- La baja hecha desde la aplicación guarda su nota y se puede deshacer; las importadas, no.
      ALTER TABLE bajas ADD COLUMN nota TEXT;
      ALTER TABLE bajas ADD COLUMN hecha_en_la_app INTEGER NOT NULL DEFAULT 0;
      -- Qué fila de la planilla la originó, para poder deshacerla.
      ALTER TABLE bajas ADD COLUMN cuota_fila_id TEXT;
    `,
  },
  {
    version: 5,
    descripcion: 'Sincronización con Google Sheets: cola, eventos y estado',
    sql: `
      -- Lo que hay que subir a la hoja. Se llena en el mismo momento en que se toca algo en la app,
      -- así el trabajo nunca depende de que haya internet.
      CREATE TABLE cola_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creado_en TEXT NOT NULL,
        operacion TEXT NOT NULL CHECK (operacion IN ('actualizar', 'crear', 'borrar')),
        pestana TEXT NOT NULL,
        fila_id TEXT NOT NULL,
        -- Campos del modelo con su valor nuevo, en JSON. Se traducen a columnas al momento de subir,
        -- leyendo los encabezados de la pestaña: así aguanta que muevan las columnas de lugar.
        campos_json TEXT NOT NULL,
        intentos INTEGER NOT NULL DEFAULT 0,
        proximo_intento TEXT,
        ultimo_error TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'fallido')),
        usuario_nombre TEXT,
        subido_en TEXT
      );
      CREATE INDEX idx_cola_sync_estado ON cola_sync (estado, id);

      -- Bitácora de la sincronización: lo que se ve en Administración → Sincronización.
      CREATE TABLE eventos_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        tipo TEXT NOT NULL,
        detalle TEXT NOT NULL,
        filas INTEGER,
        duracion_ms INTEGER,
        con_error INTEGER NOT NULL DEFAULT 0 CHECK (con_error IN (0, 1))
      );
      CREATE INDEX idx_eventos_sync_fecha ON eventos_sync (id DESC);

      -- Marcas de la última bajada y subida, y del último respaldo.
      CREATE TABLE estado_sync (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      -- Dónde está cada fila en la hoja y qué se sabe de ella: la base de la comparación por _ID.
      ALTER TABLE filas_crudas ADD COLUMN sheet_id INTEGER;
      -- Huella de la fila tal como estaba en la hoja la última vez: comparar strings es mucho más
      -- barato que rearmar el objeto de 40 columnas por cada una de las 28.000 filas.
      ALTER TABLE filas_crudas ADD COLUMN huella TEXT;
    `,
  },
  {
    version: 6,
    descripcion: 'Clientes, pólizas y renovaciones: fechas de vigencia, notas, tareas y reglas de cobertura',
    sql: `
      -- Las vigencias vienen como texto de la hoja («27/4/2026»). Para la bandeja de renovaciones y el
      -- estado de la póliza hacen falta como fecha de verdad.
      ALTER TABLE polizas ADD COLUMN vigencia_desde_iso TEXT;
      ALTER TABLE polizas ADD COLUMN vigencia_hasta_iso TEXT;
      ALTER TABLE polizas ADD COLUMN propuesta TEXT;
      ALTER TABLE polizas ADD COLUMN avisar_vto TEXT;
      ALTER TABLE polizas ADD COLUMN observaciones TEXT;
      -- Cuando una póliza se renueva, la nueva apunta a la vieja.
      ALTER TABLE polizas ADD COLUMN poliza_anterior_id INTEGER REFERENCES polizas(id);
      ALTER TABLE polizas ADD COLUMN creada_en_la_app INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_polizas_hasta ON polizas (vigencia_hasta_iso);

      -- Qué antigüedad de vehículo acepta cada compañía para cada cobertura.
      ALTER TABLE reglas_cobertura ADD COLUMN antiguedad_maxima INTEGER;
      ALTER TABLE reglas_cobertura ADD COLUMN anio_minimo INTEGER;
      ALTER TABLE reglas_cobertura ADD COLUMN creada_en_la_app INTEGER NOT NULL DEFAULT 0;

      -- Notas libres del cliente.
      CREATE TABLE notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        texto TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_notas_cliente ON notas (cliente_id, id DESC);

      -- Tareas internas. El módulo completo llega en su fase; acá se crean desde la ficha del cliente.
      CREATE TABLE tareas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        detalle TEXT,
        cliente_id INTEGER REFERENCES clientes(id),
        poliza_id INTEGER REFERENCES polizas(id),
        responsable_id INTEGER REFERENCES usuarios(id),
        responsable_nombre TEXT,
        vence_el TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en gestion', 'hecha')),
        creado_por TEXT NOT NULL,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_tareas_cliente ON tareas (cliente_id, id DESC);

      -- Seguimiento de la renovación de cada póliza (una por póliza y vencimiento).
      CREATE TABLE renovaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poliza_id INTEGER NOT NULL REFERENCES polizas(id),
        vence_el TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en gestion', 'renovada', 'no renueva')),
        responsable_id INTEGER REFERENCES usuarios(id),
        responsable_nombre TEXT,
        nota TEXT,
        poliza_nueva_id INTEGER REFERENCES polizas(id),
        actualizado_por TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_renovaciones_poliza ON renovaciones (poliza_id, vence_el);
    `,
  },
  {
    version: 7,
    descripcion: 'Cobranzas: caja del día, rendición de imputados y comisiones por compañía',
    sql: `
      -- RESULTADO de la rendición mensual (la columna de la hoja IMPUTADOS): vacío, IMPUTADO, OK,
      -- REVISAR o MAL. Vacío es «todavía no se revisó», que es lo que cuentan los pendientes.
      ALTER TABLE pagos ADD COLUMN resultado TEXT;
      -- Quién cobró y en qué sucursal se cobró. La sucursal del cobro no es la del cliente: la caja es
      -- del mostrador donde entró la plata, y un cliente de Lanús puede pagar en Dock Sud.
      ALTER TABLE pagos ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
      ALTER TABLE pagos ADD COLUMN usuario_nombre TEXT;
      ALTER TABLE pagos ADD COLUMN sucursal_cobro TEXT;
      -- La fila de la planilla del mes que se pagó (null si es un pago suelto cargado en la caja).
      ALTER TABLE pagos ADD COLUMN cuota_fila_id TEXT;
      ALTER TABLE pagos ADD COLUMN hecho_en_la_app INTEGER NOT NULL DEFAULT 0;

      -- Los pagos que la aplicación ya había registrado antes de esta migración.
      UPDATE pagos SET hecho_en_la_app = 1 WHERE pestana = '(cargado en DM Gestión)';

      CREATE INDEX idx_pagos_fecha ON pagos (fecha_iso);
      CREATE INDEX idx_pagos_resultado ON pagos (resultado);
      -- El mes que rinde un pago es el de la columna MES o, si no se pudo leer, el de su fecha. La
      -- rendición y las comisiones agrupan por esa expresión, así que el índice tiene que ser sobre
      -- ella: uno sobre la columna periodo a secas no lo usa ninguna consulta y la tabla se recorre entera.
      CREATE INDEX idx_pagos_periodo_efectivo ON pagos (COALESCE(periodo, substr(fecha_iso, 1, 7)));

      -- Porcentaje de comisión que deja cada compañía. 0 = todavía no se cargó.
      ALTER TABLE companias ADD COLUMN comision_porcentaje REAL NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 8,
    descripcion: 'Siniestros con seguimiento, riesgos varios editables y AMP',
    sql: `
      -- La ficha del siniestro distingue dos fechas que en la hoja son columnas distintas: cuándo pasó
      -- (fecha del siniestro) y cuándo lo cargamos nosotros (fecha de carga).
      ALTER TABLE siniestros ADD COLUMN fecha_carga TEXT;
      ALTER TABLE siniestros ADD COLUMN fecha_carga_iso TEXT;
      ALTER TABLE siniestros ADD COLUMN cobertura TEXT;
      ALTER TABLE siniestros ADD COLUMN creado_en_la_app INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_siniestros_fecha ON siniestros (fecha_iso);

      -- Los que ya se habían cargado desde la ficha del cliente (Fase 5): su fila nació en la app.
      UPDATE siniestros SET creado_en_la_app = 1
       WHERE fila_id IN (SELECT fila_id FROM filas_crudas WHERE numero_fila = 0);

      -- La línea de tiempo del siniestro: cada observación con su fecha y quién la escribió. No se
      -- edita ni se borra, se agrega: es el relato de cómo viene el trámite.
      CREATE TABLE siniestro_observaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siniestro_id INTEGER NOT NULL REFERENCES siniestros(id),
        texto TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_siniestro_observaciones ON siniestro_observaciones (siniestro_id, id DESC);

      -- Documentos del siniestro. El archivo se copia a %APPDATA%/dm-gestion/adjuntos/<id>/ y, si hay
      -- conexión con Google, se sube además a la carpeta «Adjuntos DM» del Drive de la cuenta de servicio.
      CREATE TABLE siniestro_adjuntos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siniestro_id INTEGER NOT NULL REFERENCES siniestros(id),
        nombre TEXT NOT NULL,
        archivo TEXT NOT NULL,
        tamano INTEGER NOT NULL DEFAULT 0,
        drive_id TEXT,
        drive_error TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_siniestro_adjuntos ON siniestro_adjuntos (siniestro_id, id DESC);

      -- Una tarea puede colgar de un siniestro, además de un cliente o una póliza.
      ALTER TABLE tareas ADD COLUMN siniestro_id INTEGER REFERENCES siniestros(id);
      CREATE INDEX idx_tareas_siniestro ON tareas (siniestro_id, id DESC);

      -- Riesgos varios: la columna EMISION de la hoja y la marca de lo que nació acá.
      ALTER TABLE riesgos_varios ADD COLUMN emision TEXT;
      ALTER TABLE riesgos_varios ADD COLUMN emision_iso TEXT;
      ALTER TABLE riesgos_varios ADD COLUMN creado_en_la_app INTEGER NOT NULL DEFAULT 0;

      -- AMP: las ampliaciones pendientes. «resuelto» es de la aplicación (la hoja no siempre tiene esa
      -- columna): tildarlo saca la fila de la lista sin borrar nada.
      CREATE TABLE amp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        cliente_id INTEGER REFERENCES clientes(id),
        poliza_id INTEGER REFERENCES polizas(id),
        sucursal_texto TEXT,
        fecha TEXT,
        fecha_iso TEXT,
        cliente_nombre TEXT,
        documento TEXT,
        telefono TEXT,
        forma_pago TEXT,
        patente TEXT,
        marca TEXT,
        modelo TEXT,
        compania TEXT,
        numero_poliza TEXT,
        detalle TEXT,
        vencimiento TEXT,
        vencimiento_iso TEXT,
        observaciones TEXT,
        resuelto INTEGER NOT NULL DEFAULT 0 CHECK (resuelto IN (0, 1)),
        resuelto_en TEXT,
        resuelto_por TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_amp_resuelto ON amp (resuelto);
      CREATE INDEX idx_amp_cliente ON amp (cliente_id);
    `,
  },
  {
    version: 9,
    descripcion: 'Leads, presupuestos y tareas: lo comercial que hoy vive en papelitos y chats',
    sql: `
      -- LEADS. La consulta que todavía no es cliente: alguien preguntó cuánto sale asegurar algo. No
      -- existe en el Excel de la agencia, así que la pestaña de la hoja la crea la aplicación.
      -- 'estado' es el embudo (NUEVO → EN CHARLA → COTIZADO → GANADO/PERDIDO) y 'origen' es por dónde
      -- entró, que es lo que después dice qué canal trae ventas.
      CREATE TABLE leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        nombre TEXT NOT NULL,
        telefono TEXT,
        documento TEXT,
        documento_normalizado TEXT,
        email TEXT,
        sucursal_id INTEGER REFERENCES sucursales(id),
        sucursal_texto TEXT,
        -- Qué quiere asegurar, en las palabras del cliente («el Gol de mi hija», «la casa de Berazategui»).
        interes TEXT,
        tipo_vehiculo TEXT,
        origen TEXT NOT NULL DEFAULT 'OTRO' CHECK (origen IN ('WHATSAPP', 'LOCAL', 'RECOMENDADO', 'REDES', 'OTRO')),
        estado TEXT NOT NULL DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO', 'EN CHARLA', 'COTIZADO', 'GANADO', 'PERDIDO')),
        -- Cuando se convierte en cliente queda apuntando a su ficha: el lead no se borra nunca, es de
        -- dónde salió la venta.
        cliente_id INTEGER REFERENCES clientes(id),
        convertido_en TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_leads_estado ON leads (estado, id DESC);
      CREATE INDEX idx_leads_documento ON leads (documento_normalizado);
      CREATE INDEX idx_leads_cliente ON leads (cliente_id);

      -- Las notas con fecha de la charla: qué se le dijo, qué contestó, cuándo volver a llamar.
      CREATE TABLE lead_notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id),
        texto TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_lead_notas ON lead_notas (lead_id, id DESC);

      -- PRESUPUESTOS. Un vehículo y las compañías que se cotizaron para él.
      --
      -- Las versiones: tocar un presupuesto ya ENVIADO no lo edita, crea la versión siguiente y deja la
      -- anterior como estaba. Es a propósito: si el cliente tiene en el teléfono el mensaje con los
      -- precios de ayer, ese mensaje tiene que seguir existiendo tal cual acá. La versión vigente es la
      -- única que se lista por defecto; las anteriores quedan colgando de ella por presupuesto_anterior_id.
      CREATE TABLE presupuestos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL UNIQUE,
        pestana TEXT NOT NULL,
        -- Número visible, compartido por todas las versiones del mismo presupuesto ('P-0007').
        numero TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        presupuesto_anterior_id INTEGER REFERENCES presupuestos(id),
        vigente INTEGER NOT NULL DEFAULT 1 CHECK (vigente IN (0, 1)),
        lead_id INTEGER REFERENCES leads(id),
        cliente_id INTEGER REFERENCES clientes(id),
        cliente_nombre TEXT NOT NULL,
        telefono TEXT,
        documento TEXT,
        sucursal_texto TEXT,
        patente TEXT,
        marca TEXT,
        modelo TEXT,
        anio TEXT,
        tipo_vehiculo TEXT,
        observaciones TEXT,
        estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO')),
        enviado_en TEXT,
        aceptado_en TEXT,
        opcion_aceptada_id INTEGER,
        poliza_id INTEGER REFERENCES polizas(id),
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_presupuestos_estado ON presupuestos (vigente, estado, id DESC);
      CREATE INDEX idx_presupuestos_numero ON presupuestos (numero, version);
      CREATE INDEX idx_presupuestos_lead ON presupuestos (lead_id);
      CREATE INDEX idx_presupuestos_cliente ON presupuestos (cliente_id);

      -- Cada compañía cotizada. El precio se guarda como texto (tal cual se escribió, con su $ y sus
      -- puntos) y aparte como número, para ordenar y para marcar cuál es la más barata.
      CREATE TABLE presupuesto_opciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id),
        compania TEXT NOT NULL,
        cobertura TEXT NOT NULL,
        precio TEXT,
        precio_monto REAL,
        comentario TEXT,
        orden INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_presupuesto_opciones ON presupuesto_opciones (presupuesto_id, orden, id);

      -- TAREAS. La tabla existe desde la Fase 5 (se crean desde la ficha del cliente y del siniestro);
      -- acá se le suma lo que el módulo propio necesita: a quién le toca, dónde, para cuándo, con qué
      -- urgencia, de qué otra ficha cuelga y su lugar en la hoja.
      ALTER TABLE tareas ADD COLUMN sucursal_texto TEXT;
      ALTER TABLE tareas ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'NORMAL' CHECK (prioridad IN ('ALTA', 'NORMAL', 'BAJA'));
      ALTER TABLE tareas ADD COLUMN lead_id INTEGER REFERENCES leads(id);
      ALTER TABLE tareas ADD COLUMN presupuesto_id INTEGER REFERENCES presupuestos(id);
      ALTER TABLE tareas ADD COLUMN renovacion_id INTEGER REFERENCES renovaciones(id);
      ALTER TABLE tareas ADD COLUMN creado_por_id INTEGER REFERENCES usuarios(id);
      -- Su fila en la pestaña APP TAREAS de la hoja. Las tareas de la Fase 5 no tienen (nacieron antes
      -- de que la pestaña existiera) y se quedan sin subir: no se inventa historia en la hoja.
      ALTER TABLE tareas ADD COLUMN fila_id TEXT;
      ALTER TABLE tareas ADD COLUMN pestana TEXT;
      -- Cuándo el responsable vio que se la asignaron: es lo que apaga el punto rojo de la campana.
      ALTER TABLE tareas ADD COLUMN visto_en TEXT;

      CREATE UNIQUE INDEX idx_tareas_fila ON tareas (fila_id) WHERE fila_id IS NOT NULL;
      CREATE INDEX idx_tareas_responsable ON tareas (responsable_id, estado, vence_el);
      CREATE INDEX idx_tareas_vence ON tareas (estado, vence_el);
      CREATE INDEX idx_tareas_lead ON tareas (lead_id, id DESC);
      CREATE INDEX idx_tareas_presupuesto ON tareas (presupuesto_id, id DESC);

      CREATE TABLE tarea_comentarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tarea_id INTEGER NOT NULL REFERENCES tareas(id),
        texto TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_tarea_comentarios ON tarea_comentarios (tarea_id, id DESC);

      -- Mismos adjuntos que los del siniestro: copia local en %APPDATA% y, si hay Google, una copia
      -- en la carpeta «Adjuntos DM» del Drive.
      CREATE TABLE tarea_adjuntos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tarea_id INTEGER NOT NULL REFERENCES tareas(id),
        nombre TEXT NOT NULL,
        archivo TEXT NOT NULL,
        tamano INTEGER NOT NULL DEFAULT 0,
        drive_id TEXT,
        drive_error TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_tarea_adjuntos ON tarea_adjuntos (tarea_id, id DESC);
    `,
  },
  {
    version: 10,
    descripcion: 'Marketing: plantillas de mensajes y segmentos guardados de la cartera',
    sql: `
      -- Los mensajes de WhatsApp que la agencia manda una y otra vez. Hasta ahora había uno solo y
      -- vivía en configuracion.plantilla_aviso; acá pasan a ser varios, con nombre y con las mismas
      -- variables: {nombre}, {cuota}, {vencimiento}, {patente} y {compania}.
      --
      -- 'fija' es la del botón «Avisar» de la Cartera: se le puede cambiar el texto, pero no se borra
      -- ni cambia de clave, porque hay código que la busca por esa clave.
      CREATE TABLE plantillas_mensaje (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        texto TEXT NOT NULL,
        fija INTEGER NOT NULL DEFAULT 0 CHECK (fija IN (0, 1)),
        creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      -- La de vencimiento arranca con lo que ya estaba escrito en Administración → Compañías, si había
      -- algo: nadie tiene que volver a escribir su mensaje porque llegó una versión nueva.
      INSERT INTO plantillas_mensaje (clave, nombre, descripcion, texto, fija)
      VALUES (
        'aviso_vencimiento',
        'Aviso de vencimiento',
        'La que manda el botón «Avisar» de la planilla del mes y de la mora.',
        COALESCE(
          NULLIF(TRIM((SELECT valor FROM configuracion WHERE clave = 'plantilla_aviso')), ''),
          'Hola {nombre}, te recordamos que el {vencimiento} vence la cuota de tu seguro por \${cuota}. Cualquier duda escribinos. Seguros Daniel Martínez.'
        ),
        1
      );

      INSERT INTO plantillas_mensaje (clave, nombre, descripcion, texto, fija) VALUES
        ('cuota_vencida', 'Cuota vencida',
         'Para el que ya está en mora y todavía está dentro de la cobertura de la compañía.',
         'Hola {nombre}, nos figura impaga la cuota de {compania} que venció el {vencimiento} (\${cuota}). Pasá por el local o escribinos y lo resolvemos. Seguros Daniel Martínez.', 0),
        ('renovacion', 'Renovación de póliza',
         'Para avisar que la póliza vence y hay que renovarla.',
         'Hola {nombre}, está por vencer la póliza de {compania} de tu {patente}. Escribinos y la renovamos sin que se te corte la cobertura. Seguros Daniel Martínez.', 0),
        ('bienvenida', 'Bienvenida',
         'Para el cliente nuevo, apenas se emite la póliza.',
         'Hola {nombre}, ya está emitida tu póliza de {compania} para {patente}. Cualquier cosa que necesites escribinos por acá. Seguros Daniel Martínez.', 0);

      -- Un segmento es un filtro guardado sobre la cartera: «cuponera + vence esta semana + Lanús».
      -- Guarda el filtro, no la lista: la lista se recalcula cada vez que se abre, porque la cartera
      -- cambia todos los días.
      CREATE TABLE segmentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        descripcion TEXT,
        filtros_json TEXT NOT NULL,
        -- Con qué plantilla se le escribe a la gente de este segmento.
        plantilla_clave TEXT REFERENCES plantillas_mensaje(clave),
        usuario_id INTEGER REFERENCES usuarios(id),
        creado_por TEXT NOT NULL,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
    `,
  },
]

export function ejecutarMigraciones(db: Database): void {
  const versionActual = db.pragma('user_version', { simple: true }) as number
  const pendientes = MIGRACIONES.filter((migracion) => migracion.version > versionActual).sort(
    (a, b) => a.version - b.version,
  )

  for (const migracion of pendientes) {
    db.transaction(() => {
      db.exec(migracion.sql)
      db.pragma('user_version = ' + migracion.version)
    })()
    console.log('[db] Migración ' + migracion.version + ' aplicada: ' + migracion.descripcion)
  }
}
