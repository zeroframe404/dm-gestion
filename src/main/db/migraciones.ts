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
  {
    version: 11,
    descripcion: 'Base de usuarios en GitHub: la tabla local pasa a ser un espejo sin contraseñas',
    sql: `
      -- Los usuarios viven en usuarios.json del repositorio privado de datos (ver src/main/usuarios/).
      -- La tabla local sigue existiendo porque ~15 tablas la referencian por id (pagos, historial, tareas,
      -- siniestros…), pero cuando la base remota está configurada guarda sólo el perfil: clave_hash queda
      -- vacío. remoto_id es el id estable del usuario en GitHub; NULL en las filas anteriores a esta
      -- versión hasta que la primera sincronización las enlaza por nombre de usuario.
      ALTER TABLE usuarios ADD COLUMN remoto_id INTEGER;
      CREATE UNIQUE INDEX idx_usuarios_remoto ON usuarios (remoto_id);
    `,
  },
  {
    version: 12,
    descripcion: 'Cada cuánto renueva cada compañía',
    sql: `
      -- La mayoría de las compañías renueva sola: la agencia no tiene que hacer nada y esas pólizas no
      -- van a la bandeja de renovaciones. Las que sí se renuevan a mano tienen acá cada cuántos meses:
      -- Agrosalta cada 4, Río Uruguay cada 6 y Metropol cada 12. NULL = renueva sola.
      ALTER TABLE companias ADD COLUMN meses_renovacion INTEGER;

      UPDATE companias SET meses_renovacion = 4
        WHERE meses_renovacion IS NULL AND nombre_normalizado LIKE 'AGROSALTA%';
      UPDATE companias SET meses_renovacion = 12
        WHERE meses_renovacion IS NULL AND nombre_normalizado LIKE 'METROPOL%';
      -- «RUS» es Río Uruguay Seguros: en la hoja aparece de las dos maneras.
      UPDATE companias SET meses_renovacion = 6
        WHERE meses_renovacion IS NULL AND (nombre_normalizado LIKE 'RIO URUGUAY%' OR nombre_normalizado = 'RUS' OR nombre_normalizado LIKE 'RUS %');
    `,
  },
  {
    version: 13,
    descripcion: 'Avisos de rechazo del débito automático y bajas con todos los datos de la cartera',
    sql: `
      -- Un aviso de rechazo: le rebotó el débito a alguien y la sucursal que lo atiende tiene que
      -- enterarse para llamarlo. Viaja a la hoja por la pestaña «APP RECHAZOS», igual que los leads y
      -- las tareas, así llega a la computadora de la otra sucursal.
      CREATE TABLE rechazos_debito (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- El _ID en la hoja. NULL mientras la fila todavía no se anotó para subir.
        fila_id TEXT UNIQUE,
        pestana TEXT,
        poliza_id INTEGER REFERENCES polizas(id),
        cliente_id INTEGER REFERENCES clientes(id),
        -- La fila de la planilla del mes cuya cuota rebotó, si el aviso salió de una.
        cuota_fila_id TEXT,
        cliente_nombre TEXT,
        documento TEXT,
        telefono TEXT,
        compania TEXT,
        numero_poliza TEXT,
        patente TEXT,
        forma_pago TEXT,
        cuota TEXT,
        periodo TEXT,
        -- A qué sucursal le llega el aviso. Es lo que decide quién lo ve en la campana.
        sucursal_texto TEXT,
        motivo TEXT,
        nota TEXT,
        -- Sin CHECK ni NOT NULL a propósito, igual que \`pagos.resultado\`: esta columna también viaja a
        -- la hoja, donde cualquiera puede escribir «resuelto» en minúscula o vaciar la celda. Se guarda
        -- lo que venga y lo normaliza el servicio; una restricción acá rompería la bajada.
        estado TEXT DEFAULT 'PENDIENTE',
        fecha TEXT NOT NULL,
        avisado_por TEXT,
        avisado_por_id INTEGER REFERENCES usuarios(id),
        visto_en TEXT,
        visto_por TEXT,
        resuelto_en TEXT,
        resuelto_por TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX idx_rechazos_sucursal ON rechazos_debito (sucursal_texto);
      CREATE INDEX idx_rechazos_estado ON rechazos_debito (estado);
      CREATE INDEX idx_rechazos_poliza ON rechazos_debito (poliza_id);

      -- La baja guardaba nada más que nombre, documento, compañía, póliza, patente, sucursal y motivo.
      -- Con eso, una póliza anulada perdía todo el resto de lo que decía la cartera. Ahora se guarda la
      -- foto completa de la fila en el momento de la baja: la póliza puede cambiar después, y lo que hay
      -- que poder mirar es cómo estaba cuando se fue.
      ALTER TABLE bajas ADD COLUMN telefono TEXT;
      ALTER TABLE bajas ADD COLUMN email TEXT;
      ALTER TABLE bajas ADD COLUMN direccion TEXT;
      ALTER TABLE bajas ADD COLUMN localidad TEXT;
      ALTER TABLE bajas ADD COLUMN cobertura TEXT;
      ALTER TABLE bajas ADD COLUMN propuesta TEXT;
      ALTER TABLE bajas ADD COLUMN cuota TEXT;
      ALTER TABLE bajas ADD COLUMN dia_vencimiento TEXT;
      ALTER TABLE bajas ADD COLUMN forma_pago TEXT;
      ALTER TABLE bajas ADD COLUMN prima TEXT;
      ALTER TABLE bajas ADD COLUMN productor TEXT;
      ALTER TABLE bajas ADD COLUMN vigencia_desde TEXT;
      ALTER TABLE bajas ADD COLUMN vigencia_hasta TEXT;
      ALTER TABLE bajas ADD COLUMN alta TEXT;
      ALTER TABLE bajas ADD COLUMN vehiculo_id INTEGER REFERENCES vehiculos(id);
      ALTER TABLE bajas ADD COLUMN tipo_vehiculo TEXT;
      ALTER TABLE bajas ADD COLUMN marca TEXT;
      ALTER TABLE bajas ADD COLUMN modelo TEXT;
      ALTER TABLE bajas ADD COLUMN anio TEXT;
      ALTER TABLE bajas ADD COLUMN motor TEXT;
      ALTER TABLE bajas ADD COLUMN chasis TEXT;
      ALTER TABLE bajas ADD COLUMN uso TEXT;
      ALTER TABLE bajas ADD COLUMN color TEXT;
    `,
  },
  {
    version: 14,
    descripcion: 'Recuperar la sucursal de los clientes a los que se les había borrado',
    sql: `
      -- No cambia la forma del esquema: repara datos.
      --
      -- La columna «Sucursal» de la planilla del mes salía en blanco en algunas computadoras y bien en
      -- otras. La fila del mes se respalda en el cliente, así que alcanzaba con que el cliente tampoco
      -- la tuviera. Y no la tenía por dos motivos que se sumaban: el UPSERT de cuotas_mes pisaba
      -- sucursal_texto con NULL cuando la pestaña del mes no traía la columna LOCAL (una pestaña recién
      -- duplicada a mano), y el cliente sólo aprende su sucursal de la planilla MÁS NUEVA, que era
      -- justamente la que no la traía. Las dos cosas ya están arregladas en el importador, pero las
      -- bases que ya se vaciaron no se arreglan solas: la sincronización sólo aplica lo que CAMBIÓ en
      -- la hoja, y la sucursal en la hoja no cambió nunca.
      --
      -- Acá se recupera de lo que la propia base todavía sabe: cualquier mes anterior del mismo cliente
      -- que sí tenga la sucursal cargada. Sólo rellena huecos; nunca pisa una sucursal ya cargada.
      UPDATE clientes
         SET sucursal_texto = (
               SELECT TRIM(c.sucursal_texto)
                 FROM cuotas_mes c
                WHERE c.cliente_id = clientes.id
                  AND TRIM(COALESCE(c.sucursal_texto, '')) <> ''
                ORDER BY c.periodo DESC
                LIMIT 1
             )
       WHERE TRIM(COALESCE(sucursal_texto, '')) = ''
         AND EXISTS (
               SELECT 1
                 FROM cuotas_mes c
                WHERE c.cliente_id = clientes.id
                  AND TRIM(COALESCE(c.sucursal_texto, '')) <> ''
             );

      -- Con el texto recuperado se vuelve a enganchar el id del catálogo, comparando como compara el
      -- resto de la aplicación: sin distinguir mayúsculas y sin que la tilde de «Lanús» moleste (UPPER()
      -- de SQLite sólo toca el ASCII, por eso se comparan las dos grafías a mano).
      UPDATE clientes
         SET sucursal_id = (
               SELECT s.id
                 FROM sucursales s
                WHERE UPPER(REPLACE(REPLACE(s.nombre, 'ú', 'u'), 'Ú', 'U')) =
                      UPPER(REPLACE(REPLACE(TRIM(clientes.sucursal_texto), 'ú', 'u'), 'Ú', 'U'))
                LIMIT 1
             )
       WHERE sucursal_id IS NULL
         AND TRIM(COALESCE(sucursal_texto, '')) <> '';
    `,
  },
  {
    version: 15,
    descripcion: 'Las cuatro sucursales: se siembra Sarandí y «Avellaneda» pasa a ser «Dock Sud»',
    sql: `
      -- La agencia tiene cuatro mostradores y la base traía tres. Faltaba Sarandí, y el de Dock Sud
      -- viajaba con dos nombres: la planilla escribe «AVELLANEDA» en unas pestañas y «DOCK SUD» en
      -- otras, así que el mismo local aparecía dos veces en cada desplegable y elegir uno escondía las
      -- filas del otro. Desde ahora el importador guarda siempre el nombre del catálogo (la lista vive
      -- en shared/sucursales.ts); acá se arregla lo que ya estaba escrito.
      INSERT OR IGNORE INTO sucursales (nombre) VALUES ('Dock Sud'), ('Lanús'), ('Sarandí'), ('Daniel');

      -- Cada UPDATE se compara con la misma clave que usa la aplicación: en mayúsculas, sin tildes y
      -- sin espacios. UPPER() de SQLite sólo sube el ASCII —a «Lanús» le deja la ú—, así que las
      -- vocales con tilde se reemplazan a mano. Un texto que no sea de los cuatro cae en el ELSE y
      -- queda tal cual estaba; volver a correr el UPDATE no cambia nada, que es lo que necesita la
      -- reconciliación de esquema (ver db/esquema.ts).
      UPDATE clientes
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE cuotas_mes
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE bajas
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE riesgos_varios
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE siniestros
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE pagos
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE pagos
         SET sucursal_cobro = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_cobro)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_cobro
                          END
       WHERE TRIM(COALESCE(sucursal_cobro, '')) <> '';

      UPDATE amp
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE leads
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE presupuestos
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE tareas
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE rechazos_debito
         SET sucursal_texto = CASE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(sucursal_texto)), 'ú', 'U'), 'Ú', 'U'), 'í', 'I'), 'Í', 'I'), ' ', '')
                            WHEN 'DOCKSUD' THEN 'Dock Sud'
                            WHEN 'AVELLANEDA' THEN 'Dock Sud'
                            WHEN 'LANUS' THEN 'Lanús'
                            WHEN 'SARANDI' THEN 'Sarandí'
                            WHEN 'DANIEL' THEN 'Daniel'
                            ELSE sucursal_texto
                          END
       WHERE TRIM(COALESCE(sucursal_texto, '')) <> '';

      -- Con el texto ya escrito como el catálogo, los que quedaron sin id lo recuperan. Es el caso de
      -- las filas que decían «Avellaneda»: no enganchaban con ninguna sucursal y guardaban el id vacío.
      UPDATE clientes
         SET sucursal_id = (SELECT s.id FROM sucursales s WHERE s.nombre = TRIM(clientes.sucursal_texto))
       WHERE sucursal_id IS NULL
         AND TRIM(COALESCE(sucursal_texto, '')) <> '';

      UPDATE leads
         SET sucursal_id = (SELECT s.id FROM sucursales s WHERE s.nombre = TRIM(leads.sucursal_texto))
       WHERE sucursal_id IS NULL
         AND TRIM(COALESCE(sucursal_texto, '')) <> '';
    `,
  },
  {
    version: 16,
    descripcion: 'Dirección del cliente en partes: calle, altura, provincia y código postal',
    sql: `
      -- Hasta acá la dirección era un renglón libre («Mitre 1234») y la localidad, otro campo suelto.
      -- Con eso alcanzaba para imprimir un ticket y no para nada más: no se podía buscar por
      -- localidad, ni saber si faltaba el código postal, ni que dos personas escribieran la misma
      -- calle igual. Las columnas nuevas guardan las partes; \`direccion\` y \`localidad\` siguen
      -- existiendo con el renglón armado, que es lo que ya usan el ticket, la hoja y los listados.
      --
      -- Todo entra como NULL: las 2.100 fichas que ya están siguen con su renglón libre y ninguna se
      -- toca. Se completan a medida que alguien abre el cliente y carga la dirección en el formulario
      -- nuevo. Convertir el texto viejo a partes con una expresión regular sería inventar datos.
      ALTER TABLE clientes ADD COLUMN calle TEXT;
      ALTER TABLE clientes ADD COLUMN calle2 TEXT;
      ALTER TABLE clientes ADD COLUMN altura TEXT;
      -- La dirección no tiene número de puerta. No es lo mismo que no habérselo preguntado todavía,
      -- y en el conurbano pasa: un pasaje, un barrio sin nomenclar.
      ALTER TABLE clientes ADD COLUMN sin_altura INTEGER NOT NULL DEFAULT 0 CHECK (sin_altura IN (0, 1));
      ALTER TABLE clientes ADD COLUMN provincia TEXT;
      ALTER TABLE clientes ADD COLUMN codigo_postal TEXT;
    `,
  },
  {
    version: 17,
    descripcion: 'Redes sociales: historial de lo publicado en Facebook e Instagram',
    sql: `
      -- Se guardan también las FALLIDAS, y ese es el punto de la tabla: el error que devuelve Meta se
      -- pierde apenas se cierra la pantalla, y sin él nadie puede averiguar por qué no salió el
      -- posteo. Con el motivo escrito, el problema se puede leer una semana después.
      --
      -- No se guarda el archivo: ya está subido a la red, y copiarlo de nuevo sólo engorda la carpeta
      -- de datos. Queda el nombre, que es lo que sirve para reconocerlo.
      --
      -- Es historial LOCAL: no sube a la hoja, igual que las plantillas y los segmentos.
      CREATE TABLE publicaciones_redes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        destino TEXT NOT NULL CHECK (destino IN ('FACEBOOK', 'INSTAGRAM')),
        estado TEXT NOT NULL CHECK (estado IN ('PUBLICADA', 'FALLIDA')),
        texto TEXT NOT NULL DEFAULT '',
        archivo TEXT,
        id_en_la_red TEXT,
        url TEXT,
        error TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        publicado_por TEXT NOT NULL,
        publicado_en TEXT NOT NULL
      );
      CREATE INDEX idx_publicaciones_redes_fecha ON publicaciones_redes (publicado_en);
    `,
  },
  {
    version: 18,
    descripcion: 'Catálogo de vehículos por API: la caché local y las columnas de línea y categoría',
    sql: `
      -- La caché del catálogo. Sin ella el selector saldría a internet para dibujar cada desplegable,
      -- y en el mostrador eso es medio segundo de espera por cada clic —y nada cuando se cae la
      -- conexión—. Con la caché, elegir un vehículo funciona igual sin internet.
      --
      -- Los ids del proveedor van como TEXT aunque InfoAuto use números: el día que haya otro
      -- proveedor no hay que rehacer las tablas por un tipo de dato.
      CREATE TABLE catalogo_marcas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('AUTO', 'MOTO')),
        marca_id TEXT NOT NULL,
        nombre TEXT NOT NULL,
        nombre_normalizado TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_catalogo_marcas_clave ON catalogo_marcas (proveedor, tipo, marca_id);
      CREATE INDEX idx_catalogo_marcas_nombre ON catalogo_marcas (tipo, nombre_normalizado);

      CREATE TABLE catalogo_modelos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('AUTO', 'MOTO')),
        marca_id TEXT NOT NULL,
        modelo_id TEXT NOT NULL,
        nombre TEXT NOT NULL,
        nombre_normalizado TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_catalogo_modelos_clave ON catalogo_modelos (proveedor, tipo, marca_id, modelo_id);
      CREATE INDEX idx_catalogo_modelos_marca ON catalogo_modelos (tipo, marca_id, nombre_normalizado);

      -- Una línea es la versión concreta, y es el único nivel que trae categoría y años. Se guardan
      -- las dos categorías: \`categoria\` es la nuestra ya traducida y \`categoria_cruda\` es lo que dijo
      -- la API, para poder corregir el mapeo sin volver a bajar decenas de miles de filas.
      CREATE TABLE catalogo_lineas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('AUTO', 'MOTO')),
        marca_id TEXT NOT NULL,
        modelo_id TEXT NOT NULL,
        linea_id TEXT NOT NULL,
        nombre TEXT NOT NULL,
        nombre_normalizado TEXT NOT NULL,
        anio_desde INTEGER,
        anio_hasta INTEGER,
        categoria TEXT,
        categoria_cruda TEXT,
        precio_lista INTEGER,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_catalogo_lineas_clave ON catalogo_lineas (proveedor, tipo, marca_id, modelo_id, linea_id);
      CREATE INDEX idx_catalogo_lineas_modelo ON catalogo_lineas (tipo, marca_id, modelo_id, nombre_normalizado);

      -- Cuándo se bajó cada mitad del catálogo y cómo salió. Una fila por tipo: la agencia puede tener
      -- contratados los autos y no las motos, y eso hay que poder decirlo en pantalla sin adivinar.
      CREATE TABLE catalogo_estado (
        tipo TEXT PRIMARY KEY CHECK (tipo IN ('AUTO', 'MOTO')),
        proveedor TEXT NOT NULL,
        refrescado_en TEXT,
        marcas INTEGER NOT NULL DEFAULT 0,
        modelos INTEGER NOT NULL DEFAULT 0,
        lineas INTEGER NOT NULL DEFAULT 0,
        ultimo_error TEXT
      );

      -- Las columnas nuevas del vehículo. Todo entra como NULL: los vehículos que ya están siguen con
      -- su marca y su modelo escritos a mano y ninguno se toca. Emparejar automáticamente ese texto
      -- libre contra el catálogo sería inventar: «FORD FIESTA» son catorce versiones distintas y
      -- elegir una por la agencia es peor que dejar el dato como está.
      --
      -- \`catalogo_codigo\` es lo que distingue un vehículo identificado de uno tipeado.
      ALTER TABLE vehiculos ADD COLUMN linea TEXT;
      ALTER TABLE vehiculos ADD COLUMN categoria TEXT;
      ALTER TABLE vehiculos ADD COLUMN catalogo_proveedor TEXT;
      ALTER TABLE vehiculos ADD COLUMN catalogo_codigo TEXT;
      CREATE INDEX idx_vehiculos_catalogo ON vehiculos (catalogo_codigo);
    `,
  },
  {
    version: 19,
    descripcion: 'Riesgos que no son vehículos: hogar, comercio, bicicleta, accidentes personales, otros',
    sql: `
      -- Una póliza no siempre asegura un auto. La tabla \`vehiculos\` pasa a guardar cualquier riesgo
      -- asegurado (sigue con su nombre: cambiárselo tocaría cada consulta, cada baja y la importación) y
      -- \`tipo\` dice qué es: AUTO y MOTO como hasta ahora, y desde acá también BICICLETA, ACCIDENTE
      -- PERSONAL, HOGAR, INTEGRAL DE COMERCIO y OTRO (ver TIPOS_DE_RIESGO en shared/tipos.ts).
      --
      -- Lo que cada riesgo necesita y no tenía columna:
      --  - la dirección de la casa o del local (hogar e integral de comercio);
      --  - a nombre de quién está (hogar, comercio y «otros»: no siempre es el cliente que paga);
      --  - las personas cubiertas por un accidentes personales, como JSON [{nombre, documento}], porque
      --    un seguro se contrata para cinco personas y hacen falta el DNI y el nombre de cada una.
      -- La bicicleta usa las columnas que ya estaban: la marca en \`marca\` y el número de cuadro en
      -- \`chasis\`, que es lo que es.
      ALTER TABLE vehiculos ADD COLUMN direccion_riesgo TEXT;
      ALTER TABLE vehiculos ADD COLUMN titular_nombre TEXT;
      ALTER TABLE vehiculos ADD COLUMN titular_documento TEXT;
      ALTER TABLE vehiculos ADD COLUMN integrantes TEXT;
    `,
  },
  {
    version: 20,
    descripcion: 'Pagos adelantados (la cuota del mes que viene) y cobros imputados (se paga a la compañía antes de que el cliente transfiera)',
    sql: `
      -- Estado del COBRO, que no es el RESULTADO de la rendición (\`resultado\`, lo que dice la contadora).
      --  - PAGO: el cliente pagó; es lo de siempre y lo que tiene todo lo que ya existía.
      --  - IMPUTADO: la agencia le imputó la cuota a la compañía (la pagó ella) y el cliente todavía no
      --    transfirió. Pasa con AGS en Dock Sud: primero se imputa, después el cliente manda la plata.
      --    Mientras está en IMPUTADO la fila del mes sigue sin CUANDO PAGO y no suma a la caja.
      ALTER TABLE pagos ADD COLUMN estado_cobro TEXT NOT NULL DEFAULT 'PAGO';

      -- Un pago ADELANTADO es el de la cuota del mes que viene, cobrado hoy (dos cuotas el mismo mes).
      -- Su \`periodo\` es el del mes que viene, así que la rendición lo rinde en ese mes. La columna dice
      -- qué se hace con él cuando se arma el mes siguiente (el cierre de mes):
      --  - ACREDITAR: la fila nueva nace paga, con la fecha del pago en CUANDO PAGO;
      --  - PENDIENTE: la fila nace sin pagar y con el pago a la vista, para imputarlo a mano.
      -- NULL es un pago común. Cuando el pago queda imputado a una fila, \`cuota_fila_id\` la apunta.
      ALTER TABLE pagos ADD COLUMN adelanto_modo TEXT;
      CREATE INDEX idx_pagos_adelanto ON pagos (poliza_id, periodo, adelanto_modo);
    `,
  },
  {
    version: 21,
    descripcion: 'El abogado y los datos del tercero del siniestro, y la categoría de cada documento adjunto',
    sql: `
      -- Lo que la ficha necesita para seguir un choque y la pestaña SINIESTROS de la hoja no tiene
      -- columna donde guardar. Vive sólo en DM Gestión, como la línea de tiempo, los adjuntos y las
      -- tareas: la hoja se entera por el resumen de observaciones, que sí viaja.
      --
      -- Son texto libre a propósito. En el mostrador la compañía del tercero llega como «Sancor, creo»
      -- y el teléfono con el prefijo o sin él; obligar a un formato haría perder el dato en vez de
      -- guardarlo. \`tercero_lesionados\` es lo único acotado (vacío, NO o SI) porque de eso depende que
      -- el trámite lleve constancia médica, y el detalle —quién y a qué hospital fue— va al lado.
      ALTER TABLE siniestros ADD COLUMN abogado TEXT;
      ALTER TABLE siniestros ADD COLUMN tercero_compania TEXT;
      ALTER TABLE siniestros ADD COLUMN tercero_telefono TEXT;
      ALTER TABLE siniestros ADD COLUMN tercero_patente TEXT;
      ALTER TABLE siniestros ADD COLUMN tercero_lesionados TEXT;
      ALTER TABLE siniestros ADD COLUMN tercero_lesionados_detalle TEXT;

      -- Qué es cada documento adjunto: denuncia, cédula verde, constancia médica… Los que ya estaban
      -- quedan sin categoría y se muestran como «Sin categoría» hasta que alguien los ordene.
      -- \`categoria_detalle\` es el «indicando cuál» de «Otras documentaciones».
      ALTER TABLE siniestro_adjuntos ADD COLUMN categoria TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN categoria_detalle TEXT;
    `,
  },
  {
    version: 22,
    descripcion: 'Las listas de las compañías: organizadores, precios, grúas y cláusulas de cada cobertura',
    sql: `
      -- Las cuatro listas del módulo Compañías. Son de REFERENCIA: no describen una póliza de nadie,
      -- describen lo que ofrece el mercado, y por eso ninguna tiene fila_id ni sale de la hoja. Las
      -- carga a mano el superadministrador (como la matriz de coberturas) y se comparten con las demás
      -- computadoras por el puente de ajustes del VPS, no por la planilla: en la planilla no hay
      -- ninguna pestaña donde escribirlas.
      --
      -- \`clave\` es el nombre normalizado (mayúsculas, sin acentos ni signos) de lo que no puede
      -- repetirse en cada lista. Está como UNIQUE y no como control en el código porque un duplicado
      -- acá no da un error visible: da dos precios distintos para la misma compañía y quien atiende
      -- lee el primero que encuentra.

      -- A quién le pide precio el bróker. \`orden\` es en qué orden se le escribe: la lista se recorre
      -- de arriba abajo mandando el mismo mensaje, y ese orden lo decide la agencia, no el alfabeto.
      CREATE TABLE organizadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        companias TEXT,
        telefono TEXT,
        email TEXT,
        horario TEXT,
        observaciones TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      -- El precio de lista de cada compañía para cada cobertura. La que más se mira es RESPONSABILIDAD
      -- CIVIL, que es el piso con el que se compara todo, pero la tabla no la privilegia: la cobertura
      -- es texto libre, igual que en las pólizas y en la matriz de reglas.
      --
      -- \`precio\` es REAL y no INTEGER porque una cuota puede tener centavos, y \`vigente_desde\` es el
      -- día desde el que rige esa lista: sin eso, un precio viejo se ve idéntico a uno de hoy.
      CREATE TABLE precios_companias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        compania TEXT NOT NULL,
        cobertura TEXT NOT NULL,
        rama TEXT,
        precio REAL NOT NULL,
        vigente_desde TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      CREATE INDEX idx_precios_compania ON precios_companias (compania);

      -- Cuántos kilómetros de grúa da cada compañía en cada cobertura. \`kilometros\` en NULL es
      -- ILIMITADA, que es un valor real y frecuente; la compañía que no tiene fila es la que todavía
      -- no se cargó, y la pantalla las distingue.
      CREATE TABLE gruas_companias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        compania TEXT NOT NULL,
        cobertura TEXT NOT NULL,
        kilometros INTEGER,
        auxilio TEXT,
        observaciones TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      CREATE INDEX idx_gruas_compania ON gruas_companias (compania);

      -- Qué ampara cada cobertura, cláusula por cláusula. \`compania\` en NULL es la cláusula que vale
      -- para todas: casi todas las coberturas se arman igual en el mercado y repetir la misma lista
      -- catorce veces la haría imposible de mantener. Cargar la compañía es para la excepción.
      --
      -- \`ampara\` en 0 es una EXCLUSIÓN, y está en la misma tabla a propósito: en el mostrador la
      -- pregunta que llega es «¿esto lo cubre?», y la respuesta útil incluye lo que no.
      CREATE TABLE clausulas_coberturas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        compania TEXT,
        cobertura TEXT NOT NULL,
        clausula TEXT NOT NULL,
        ampara INTEGER NOT NULL DEFAULT 1 CHECK (ampara IN (0, 1)),
        detalle TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );

      CREATE INDEX idx_clausulas_cobertura ON clausulas_coberturas (cobertura);
    `,
  },
  {
    version: 23,
    descripcion: 'Adjuntos en el VPS, comentarios que viajan, fotos de pólizas e índices que faltaban',
    sql: `
      -- 12.6: los adjuntos dejan de vivir sólo en el disco de la PC donde se cargaron. El archivo se
      -- sube al VPS (\`vps_id\` es su nombre allá) y la ficha viaja por la pestaña APP ADJUNTOS con
      -- \`fila_id\` = 'ADJ:<vps_id>', como cualquier otra fila. En la computadora que lo recibe,
      -- \`archivo\` queda VACÍO hasta que alguien lo abre y se baja (no hace falta que las cinco PC
      -- tengan las fotos de todos los autos).
      --
      -- \`vps_intentos\` y \`vps_proximo_intento\` son la espera creciente de la subida: un archivo que
      -- el servidor rechaza no se reintenta cada diez segundos para siempre. \`sha256\` es lo que el
      -- servidor comprueba al recibirlo y lo que esta PC comprueba al bajarlo. \`miniatura\` es la
      -- vista previa (un data: chico) que se calcula una vez, para que la ficha no la rehaga.
      ALTER TABLE siniestro_adjuntos ADD COLUMN fila_id TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN tipo TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN sha256 TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN ancho INTEGER;
      ALTER TABLE siniestro_adjuntos ADD COLUMN alto INTEGER;
      ALTER TABLE siniestro_adjuntos ADD COLUMN miniatura TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN vps_id TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN vps_subido_en TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN vps_error TEXT;
      ALTER TABLE siniestro_adjuntos ADD COLUMN vps_intentos INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE siniestro_adjuntos ADD COLUMN vps_proximo_intento TEXT;
      CREATE UNIQUE INDEX idx_siniestro_adjuntos_fila ON siniestro_adjuntos (fila_id) WHERE fila_id IS NOT NULL;
      CREATE INDEX idx_siniestro_adjuntos_vps ON siniestro_adjuntos (vps_subido_en, vps_proximo_intento);

      ALTER TABLE tarea_adjuntos ADD COLUMN fila_id TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN tipo TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN sha256 TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN ancho INTEGER;
      ALTER TABLE tarea_adjuntos ADD COLUMN alto INTEGER;
      ALTER TABLE tarea_adjuntos ADD COLUMN miniatura TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN vps_id TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN vps_subido_en TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN vps_error TEXT;
      ALTER TABLE tarea_adjuntos ADD COLUMN vps_intentos INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tarea_adjuntos ADD COLUMN vps_proximo_intento TEXT;
      CREATE UNIQUE INDEX idx_tarea_adjuntos_fila ON tarea_adjuntos (fila_id) WHERE fila_id IS NOT NULL;
      CREATE INDEX idx_tarea_adjuntos_vps ON tarea_adjuntos (vps_subido_en, vps_proximo_intento);

      -- Las fotos y documentos de una póliza: el auto, la moto, el frente de la póliza, la cédula.
      -- Mismo modelo que los otros dos, sin categoría (en una póliza el nombre alcanza).
      CREATE TABLE poliza_adjuntos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poliza_id INTEGER NOT NULL REFERENCES polizas(id),
        fila_id TEXT,
        nombre TEXT NOT NULL,
        archivo TEXT NOT NULL DEFAULT '',
        tipo TEXT,
        tamano INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        ancho INTEGER,
        alto INTEGER,
        miniatura TEXT,
        drive_id TEXT,
        drive_error TEXT,
        vps_id TEXT,
        vps_subido_en TEXT,
        vps_error TEXT,
        vps_intentos INTEGER NOT NULL DEFAULT 0,
        vps_proximo_intento TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_poliza_adjuntos ON poliza_adjuntos (poliza_id, id DESC);
      CREATE UNIQUE INDEX idx_poliza_adjuntos_fila ON poliza_adjuntos (fila_id) WHERE fila_id IS NOT NULL;
      CREATE INDEX idx_poliza_adjuntos_vps ON poliza_adjuntos (vps_subido_en, vps_proximo_intento);

      -- Los comentarios de las tareas y las observaciones de los siniestros viajan por APP COMENTARIOS,
      -- una fila cada uno, con \`fila_id\` = 'COM:<id>'. Los que ya estaban (sin fila_id) se registran
      -- al arrancar (ver servicios/adjuntos.ts, \`registrarLoQueNoViajo\`).
      ALTER TABLE tarea_comentarios ADD COLUMN fila_id TEXT;
      CREATE UNIQUE INDEX idx_tarea_comentarios_fila ON tarea_comentarios (fila_id) WHERE fila_id IS NOT NULL;
      ALTER TABLE siniestro_observaciones ADD COLUMN fila_id TEXT;
      CREATE UNIQUE INDEX idx_siniestro_observaciones_fila ON siniestro_observaciones (fila_id) WHERE fila_id IS NOT NULL;

      -- Índices que faltaban y que la planilla del mes, la cartera y las métricas recorrían a mano.
      -- \`pagos(cuota_fila_id)\` es el peor: la planilla del mes hacía un EXISTS por fila sobre \`pagos\`
      -- sin ningún índice que lo sostuviera.
      CREATE INDEX IF NOT EXISTS idx_pagos_cuota_fila ON pagos (cuota_fila_id);
      CREATE INDEX IF NOT EXISTS idx_cuotas_mes_periodo_baja ON cuotas_mes (periodo, dada_de_baja);
      CREATE INDEX IF NOT EXISTS idx_polizas_compania ON polizas (compania);
      CREATE INDEX IF NOT EXISTS idx_polizas_activa ON polizas (activa);
      CREATE INDEX IF NOT EXISTS idx_polizas_anterior ON polizas (poliza_anterior_id);
      CREATE INDEX IF NOT EXISTS idx_bajas_poliza_fecha ON bajas (poliza_id, fecha_baja_iso);
    `,
  },
  {
    version: 24,
    descripcion: 'El vínculo de cada tarea con una clave que todas las computadoras entienden, y las notas de los leads con fila en la base',
    sql: `
      -- Hasta la 12.6 el vínculo de una tarea viajaba a APP TAREAS como texto legible («Siniestro
      -- S-123 · Pérez»): en la otra computadora la tarea llegaba suelta, sin cliente, póliza ni
      -- siniestro, y la ficha del siniestro la mostraba vacía. La clave («SINIESTRO:<_ID>»,
      -- «POLIZA:<clave>», «CLIENTE:<clave>»…) es la identidad compartida, igual que en los adjuntos.
      ALTER TABLE tareas ADD COLUMN vinculo_clave TEXT;
      -- Lo mismo para el presupuesto: de qué consulta salió («LEAD:<_ID>»).
      ALTER TABLE presupuestos ADD COLUMN vinculo_clave TEXT;

      -- Las notas de las consultas (leads) viajan por APP COMENTARIOS como las observaciones de los
      -- siniestros, una fila cada una, con fila_id = 'COM:<id>'.
      ALTER TABLE lead_notas ADD COLUMN fila_id TEXT;
      CREATE UNIQUE INDEX idx_lead_notas_fila ON lead_notas (fila_id) WHERE fila_id IS NOT NULL;
    `,
  },
  {
    version: 25,
    descripcion: 'La mensajería interna: conversaciones, mensajes, acuses de entrega y lectura, adjuntos y la cola de salida',
    sql: `
      -- 12.8: el chat de la agencia. Hasta ahora, para avisarle algo a la otra sucursal había que
      -- llamar por teléfono o escribir por WhatsApp desde el celular personal: lo que se dijo no
      -- queda en ningún lado, el que atiende no lo puede buscar, y si esa persona se va de la
      -- agencia se lleva la conversación con ella. Acá los mensajes son de la agencia.
      --
      -- Dónde vive la verdad: en la base del VPS, no en esta tabla y no en la grilla del GENERAL DE
      -- CLIENTES. Esto es un ESPEJO local, para poder leer sin internet y para que un mensaje escrito
      -- con la conexión caída tenga dónde esperar. Por eso cada fila tiene su \`remoto_id\`: el UUID
      -- que la eligió esta computadora y con el que el servidor la conoce.
      --
      -- Por qué no viaja por la planilla como los siniestros y las tareas: la grilla mueve pestañas
      -- enteras cada treinta segundos y eso alcanza para una tarea, no para un chat. Los mensajes
      -- tienen su propio camino (\`/api/dmg/mensajes\`) y su propio carril, que trae lo nuevo en el
      -- momento en vez de cada media hora.

      -- Una charla: de a dos ('DIRECTA') o de varios ('GRUPO'). \`clave\` es la identidad estable de
      -- una charla directa —los dos usuarios ordenados, 'ana|beto'—: sin ella, si Ana y Beto se
      -- escriben al mismo tiempo desde dos mostradores, quedan dos conversaciones distintas para la
      -- misma charla y cada uno ve la mitad de lo que se dijeron.
      CREATE TABLE conversaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remoto_id TEXT NOT NULL,
        clave TEXT,
        tipo TEXT NOT NULL CHECK (tipo IN ('DIRECTA', 'GRUPO')),
        titulo TEXT,
        creado_por TEXT NOT NULL,
        ultimo_mensaje_en TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_conversaciones_remoto ON conversaciones (remoto_id);
      CREATE UNIQUE INDEX idx_conversaciones_clave ON conversaciones (clave) WHERE clave IS NOT NULL;
      CREATE INDEX idx_conversaciones_ultimo ON conversaciones (ultimo_mensaje_en DESC);

      -- Quién está en cada charla. Lo que identifica a la persona es \`usuario_clave\` (el usuario de
      -- ingreso en minúscula) y no \`usuario_id\`: el id es de ESTA base y la misma persona tiene otro
      -- número en las otras cuatro computadoras. El id local se guarda igual, para enganchar la ficha
      -- cuando se la conoce, y el nombre queda desnormalizado para que la charla siga legible aunque
      -- esa persona ya no esté en el listado.
      CREATE TABLE conversacion_participantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversacion_id INTEGER NOT NULL REFERENCES conversaciones(id),
        usuario_clave TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        salio_en TEXT,
        creado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_participantes_unico ON conversacion_participantes (conversacion_id, usuario_clave);
      CREATE INDEX idx_participantes_usuario ON conversacion_participantes (usuario_clave);

      -- Los mensajes. \`orden\` es el número que le puso el servidor: ordena el hilo igual en las cinco
      -- computadoras (el \`id\` local no sirve, porque cada base los numera como los fue recibiendo).
      -- Los que todavía no salieron de acá tienen orden NULL y van al final, que es donde va lo que
      -- se acaba de escribir.
      --
      -- \`estado\` es lo que dibuja el tilde. 'enCola' es de esta computadora y de nadie más; los otros
      -- cuatro los decide el servidor con los acuses.
      CREATE TABLE mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remoto_id TEXT NOT NULL,
        conversacion_id INTEGER NOT NULL REFERENCES conversaciones(id),
        orden INTEGER,
        autor_clave TEXT NOT NULL,
        autor_nombre TEXT NOT NULL,
        cuerpo TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'enCola' CHECK (estado IN ('enCola', 'enviado', 'entregado', 'leido', 'fallado')),
        error TEXT,
        intentos INTEGER NOT NULL DEFAULT 0,
        proximo_intento TEXT,
        eliminado_en TEXT,
        eliminado_por TEXT,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_mensajes_remoto ON mensajes (remoto_id);
      CREATE INDEX idx_mensajes_hilo ON mensajes (conversacion_id, orden, id);
      -- La consulta de la cola de salida: lo que se escribió acá y todavía no salió.
      CREATE INDEX idx_mensajes_cola ON mensajes (estado, proximo_intento);

      -- Quién recibió y quién leyó cada mensaje. Una fila por mensaje y por destinatario: en un grupo
      -- de cinco, un mensaje deja cuatro. Es lo que permite decir «leído por 2 de 4» en vez de un
      -- tilde que no explica nada, y es la misma tabla que tiene el servidor.
      CREATE TABLE mensaje_acuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mensaje_id INTEGER NOT NULL REFERENCES mensajes(id),
        usuario_clave TEXT NOT NULL,
        entregado_en TEXT,
        leido_en TEXT
      );
      CREATE UNIQUE INDEX idx_acuses_unico ON mensaje_acuses (mensaje_id, usuario_clave);

      -- Los adjuntos del mensaje. Las columnas son EXACTAMENTE las de poliza_adjuntos (migración 23)
      -- a propósito: así \`src/main/servicios/adjuntos.ts\` los sube al VPS, los reintenta con esperas
      -- crecientes, los baja cuando alguien los abre y los verifica al arrancar sin escribir una
      -- línea de eso de nuevo. \`fila_id\`, \`drive_id\` y \`drive_error\` quedan siempre en NULL —un
      -- mensaje no cuelga de una fila de la planilla y un chat privado no va al Drive de la agencia—
      -- pero las columnas tienen que estar igual: el SELECT de ese servicio las nombra por su nombre.
      CREATE TABLE mensaje_adjuntos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mensaje_id INTEGER NOT NULL REFERENCES mensajes(id),
        fila_id TEXT,
        nombre TEXT NOT NULL,
        archivo TEXT NOT NULL DEFAULT '',
        tipo TEXT,
        tamano INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        ancho INTEGER,
        alto INTEGER,
        miniatura TEXT,
        drive_id TEXT,
        drive_error TEXT,
        vps_id TEXT,
        vps_subido_en TEXT,
        vps_error TEXT,
        vps_intentos INTEGER NOT NULL DEFAULT 0,
        vps_proximo_intento TEXT,
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario_nombre TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_mensaje_adjuntos ON mensaje_adjuntos (mensaje_id, id DESC);
      CREATE UNIQUE INDEX idx_mensaje_adjuntos_fila ON mensaje_adjuntos (fila_id) WHERE fila_id IS NOT NULL;
      CREATE INDEX idx_mensaje_adjuntos_vps ON mensaje_adjuntos (vps_subido_en, vps_proximo_intento);
      -- El id del archivo en el servidor es único también acá: la fila que llegó del servidor y la que
      -- creó esta computadora son el mismo archivo, no dos.
      CREATE UNIQUE INDEX idx_mensaje_adjuntos_vps_id ON mensaje_adjuntos (vps_id) WHERE vps_id IS NOT NULL;

      -- Hasta dónde miró esta computadora los acuses de sus propios mensajes. Es el cursor del carril
      -- de mensajería y va en una fila sola, como estado_sync.
      CREATE TABLE mensajeria_estado (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor_acuses TEXT,
        ultimo_error TEXT,
        actualizado_en TEXT
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
