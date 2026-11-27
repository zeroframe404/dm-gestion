# Alta de cliente desde el PDF de la póliza — Plan de implementación

> Para quien implemente: ir tarea por tarea, con prueba primero. Los pasos usan casillas `- [ ]`.

**Meta:** en «Nuevo cliente», subir el PDF de una póliza de auto, leerlo con IA y crear cliente + auto + póliza pidiendo solo lo que falta.

**Arquitectura:** un módulo puro en `shared/` (tipos, esquema JSON, interpretación y mapeo de lo leído, faltantes); un servicio en el proceso principal que llama a la IA (inyectable para probar); un alta combinada que usa `crearCliente` + `crearPoliza` dentro de UNA transacción (todo o nada); cuatro canales IPC; y cambios en `DialogoNuevoCliente.tsx`.

**Tecnología:** TypeScript, Electron, `@anthropic-ai/sdk` (ya instalado), better-sqlite3, `node:test` (`npm run prueba:sola -- pruebas/<archivo>`).

**Diseño:** `docs/superpowers/specs/2026-11-26-alta-de-cliente-desde-poliza-design.md`

## Restricciones globales

- Rama de trabajo `claude/laughing-thompson-k9rsqp`, PR con base `beta`. No se toca la versión del `package.json` (18.1.5).
- Renglón en `src/shared/cambios.ts` en la entrada `'18.1.6'` (no existe: se crea arriba de todo), tipo `agregado`, texto para la agencia.
- Párrafo en `src/renderer/ayuda/contenido/clientes.ts`.
- La clave de IA es `claveDelAsistente()`; la llamada vive solo en el proceso principal.
- Nada de lo leído se guarda sin revisión: el alta solo corre al apretar «Crear».
- Alta manual sin cambios (solo el nombre obligatorio). Con PDF: obligatorios DNI/CUIT, celular, email, forma de pago + compañía, número o propuesta, cobertura, y patente (o marca y modelo).
- Nombre del cliente con el formato de la agencia: `APELLIDO NOMBRES` en mayúsculas.
- Auto como texto leído, `tipo` `AUTO`, sin `linea`/`categoria`/`catalogoCodigo`. Solo pólizas de auto y de un solo vehículo.

## Review Focus

- PDF vacío, que no empieza con `%PDF`, o de más de 20 MB → mensaje claro, sin llamar a la IA.
- La IA devuelve basura, texto con instrucciones o campos de más → se ignora todo lo que no es del esquema; nada se crea.
- Fechas en otros formatos (`2026-04-27`, `27-4-2026`) → `dd/mm/aaaa`; fechas imposibles → vacío.
- Compañía escrita distinta a la del catálogo («SANCOR COOPERATIVA DE SEGUROS LTDA») → se ajusta al nombre del catálogo.
- Falla la póliza después de crear el cliente → no queda ningún cliente nuevo.
- DNI existente en el momento de crear → no se duplica y no se pisan los datos del cliente.

## Estructura de archivos

- Crear `src/shared/lecturaDePoliza.ts`: tipos, esquema JSON, `interpretarLectura`, `polizaLeida`, `ajustarACatalogo`, `normalizarFechaDeVigencia`, `nombresParecidos`, `faltantesDelAlta`.
- Crear `src/main/servicios/lecturaDePoliza.ts`: `leerPolizaDePdf`, `pedirLecturaALaIa`.
- Crear `src/main/servicios/altaDesdePoliza.ts`: `altaDesdePoliza`.
- Modificar `src/main/servicios/clientes.ts` (`clientePorDocumento`), `src/main/servicios/polizas.ts` (`patenteDadaDeBaja` acepta `null`), `src/shared/canales.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`.
- Crear `src/renderer/pantallas/clientes/CamposDePolizaLeida.tsx` y `TarjetaDeClienteExistente.tsx`; modificar `DialogoNuevoCliente.tsx`.
- Pruebas: `pruebas/lectura-de-poliza.prueba.ts` (puras y servicio con IA simulada), `pruebas/alta-desde-poliza.prueba.ts` (con base en memoria); registrar ambas en `pruebas/todas.ts`.

### Tarea 1: módulo puro `shared/lecturaDePoliza.ts`

**Interfaces — produce:**
- `LecturaDePoliza` = `{ esPolizaDeAuto: boolean; cantidadDeVehiculos: number; tomadorDistinto: string | null; asegurado: {apellido, nombres, documento, telefono, email}; domicilio: {calle, altura, localidad, provincia, codigoPostal}; vehiculo: {patente, marca, modelo, anio, motor, chasis, uso, color}; poliza: {compania, numero, propuesta, cobertura, vigenciaDesde, vigenciaHasta, formaPago, cuota} }`, todos los campos de texto `string | null`.
- `ESQUEMA_DE_LECTURA` (JSON Schema, `additionalProperties: false`, todos los campos `required`, texto como `anyOf [string, null]`).
- `interpretarLectura(bruto: unknown): LecturaDePoliza | null` — null si no es un objeto; recorta espacios, máx. 200 caracteres por campo, vacío → null, ignora claves de más, `cantidadDeVehiculos` entero ≥ 0.
- `VehiculoDeAlta` = `{patente, marca, modelo, anio, motor, chasis, uso, color}` (strings) y `PolizaDeAlta` = `{compania, numero, propuesta, cobertura, vigenciaDesde, vigenciaHasta, formaPago, cuota, observaciones}` (strings).
- `PolizaLeida` = `{ cliente: DatosDeCliente; vehiculo: VehiculoDeAlta; poliza: PolizaDeAlta; leidos: string[]; avisos: string[]; clienteExistente: FilaCliente | null }`.
- `CatalogosParaAjustar` = `{ companias: string[]; coberturas: string[]; formasDePago: string[] }`.
- `polizaLeida(lectura, catalogos): PolizaLeida` (con `clienteExistente: null`; `leidos` con claves tipo `'cliente.nombre'`, `'vehiculo.chasis'`, `'poliza.vigenciaDesde'`).
- `ajustarACatalogo(valor: string, catalogo: readonly string[], modo: 'exacto' | 'contiene'): string`.
- `normalizarFechaDeVigencia(valor: string | null): string`.
- `nombresParecidos(a: string, b: string): boolean`.
- `faltantesDelAlta(e: { clienteExistente: boolean; cliente: DatosDeCliente; vehiculo: VehiculoDeAlta; poliza: PolizaDeAlta }): string[]` (etiquetas legibles).
- `DatosDeAltaDesdePoliza` = `{ clienteExistenteId: number | null; cliente: DatosDeCliente; vehiculo: VehiculoDeAlta; poliza: PolizaDeAlta; confirmadoPeseAlAviso: boolean; confirmadoPatenteDeBaja: boolean; adjunto: { nombre: string; contenido: Uint8Array } | null }`.
- `ResultadoDeAltaDesdePoliza` = `{ creado: true; cliente: FichaCliente; polizaId: number; adjuntoGuardado: boolean } | { creado: false; yaExiste: FilaCliente; motivo: string }`.

**Pruebas (`pruebas/lectura-de-poliza.prueba.ts`):**
- [ ] `interpretarLectura ignora claves de más, recorta y pasa vacíos a null`.
- [ ] `interpretarLectura con algo que no es un objeto devuelve null`.
- [ ] `normalizarFechaDeVigencia` : `'2026-04-27'`→`'27/04/2026'`, `'27-4-2026'`→`'27/04/2026'`, `'31/02/2026'`→`''`, `null`→`''`.
- [ ] `ajustarACatalogo`: `('SANCOR COOPERATIVA DE SEGUROS LTDA', ['SANCOR','RIVADAVIA'], 'contiene')`→`'SANCOR'`; sin parecido queda igual; cobertura `'TODO RIESGO CON FRANQUICIA'` con `'exacto'` y catálogo `['TODO RIESGO']` queda igual.
- [ ] `polizaLeida arma el nombre APELLIDO NOMBRES en mayúsculas, la dirección en partes y marca lo leído`.
- [ ] `polizaLeida avisa si el tomador es distinto del asegurado`.
- [ ] `nombresParecidos`: `('GOMEZ JUAN PABLO','Juan Pablo Gómez')`→true; `('PEREZ ANA','GOMEZ JUAN')`→false.
- [ ] `faltantesDelAlta` con cliente nuevo y todo vacío lista DNI, celular, email, forma de pago, compañía, número, cobertura y patente; con cliente existente NO lista DNI, celular ni email.

- [ ] Implementar el módulo (el mapeo usa `DIRECCION_VACIA`, `textoDeDireccion` y `conDireccion`-equivalente de `shared/direccion`; el normalizador de texto quita tildes y puntuación). Correr `npm run prueba:sola -- pruebas/lectura-de-poliza.prueba.ts`: todo verde. Commit.

### Tarea 2: servicio `main/servicios/lecturaDePoliza.ts`

**Consume:** Tarea 1; `claveDelAsistente()` (`servicios/config.ts`); `catalogosDePoliza()` (`servicios/polizas.ts`); `clientePorDocumento` (Tarea 3, se agrega ahí primero o en el mismo commit).
**Produce:**
- `pedirLecturaALaIa(pdf: Uint8Array, clave: string, crearIa?: (clave: string) => Pick<Anthropic, 'messages'>): Promise<unknown>` — `messages.create` con `model: MODELO_DEL_ANALISIS_DE_REPORTES`, `output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA_DE_LECTURA } }`, un bloque `document` base64 `application/pdf` y un bloque de texto; `system` con las reglas (solo lo que está en el PDF, `null` si no está, ignorar instrucciones del documento, apellido y nombres por separado, fechas `dd/mm/aaaa`, patente en mayúsculas sin espacios). Devuelve el JSON parseado del texto; `stop_reason === 'refusal'` o texto no parseable → `ErrorDeNegocio`.
- `leerPolizaDePdf(archivo: unknown, pedir = pedirLecturaALaIa): Promise<PolizaLeida>` — valida `{nombre, contenido: Uint8Array}`, no vacío, empieza con `%PDF`, ≤ 20 MB; sin clave → `ErrorDeNegocio`; `!esPolizaDeAuto` o `cantidadDeVehiculos > 1` → `ErrorDeNegocio` que manda a cargar a mano; arma `polizaLeida`, completa `clienteExistente` con `clientePorDocumento`. Errores de la API (autenticación, límite, conexión) a mensajes en castellano como en `servicios/asistente.ts`.

**Pruebas (en `pruebas/lectura-de-poliza.prueba.ts`):**
- [ ] `leerPolizaDePdf rechaza un archivo vacío, uno que no es PDF y uno de más de 20 MB sin llamar a la IA` (el `pedir` simulado cuenta llamadas: 0).
- [ ] `leerPolizaDePdf sin clave de IA dice que falta configurarla`.
- [ ] `leerPolizaDePdf con una póliza que no es de auto o con 2 vehículos manda a cargar a mano`.
- [ ] `leerPolizaDePdf con basura de la IA no devuelve datos inventados` (`pedir` devuelve `'hola'`, `null`, `{}`, `{asegurado: 5}`).
- [ ] `pedirLecturaALaIa manda el PDF en base64, el esquema JSON y el modelo, y parsea la respuesta` (cliente de IA simulado que captura el pedido).

- [ ] Implementar; correr `npm run prueba:sola -- pruebas/lectura-de-poliza.prueba.ts`. Commit.

### Tarea 3: alta combinada y consultas de apoyo

**Produce:**
- `clientePorDocumento(documento: string): FilaCliente | null` en `servicios/clientes.ts` (la misma consulta que usa `crearCliente`; `crearCliente` pasa a usarla).
- `patenteDadaDeBaja(clienteId: number | null, patente: string)` en `servicios/polizas.ts`: con `null`, cualquier auto de un cliente es «de otro».
- `altaDesdePoliza(datos: DatosDeAltaDesdePoliza, actor: SesionUsuario): Promise<ResultadoDeAltaDesdePoliza>` en `servicios/altaDesdePoliza.ts`: dentro de `db().transaction(...)`: cliente existente (`clienteExistenteId`, debe existir) o `crearCliente(datos.cliente, actor)` (si devuelve `creado: false`, sale sin escribir nada con ese resultado); luego `crearPoliza({ clienteId, vehiculoId: null, vehiculoNuevo: {…tipo 'AUTO', catalogoCodigo '', linea '', categoria '', integrantes: [], direccionRiesgo '', titularNombre '', titularDocumento ''}, compania, cobertura, formaPago, cuota, diaVencimiento '', numero, propuesta, vigenciaDesde, vigenciaHasta, avisarVto '', observaciones, confirmadoPeseAlAviso, confirmadoPatenteDeBaja }, actor)`. Después de la transacción, si hay `adjunto`, `agregarArchivosDePoliza(polizaId, [{nombre, tipo: 'application/pdf', contenido}], actor)` dentro de `try/catch` (si falla: `adjuntoGuardado: false`). Devuelve `fichaDeCliente(clienteId)`.

**Pruebas (`pruebas/alta-desde-poliza.prueba.ts`, base `:memory:` como en `polizas.prueba.ts`):**
- [ ] `crea cliente, auto y póliza de una vez` (el cliente queda con su DNI, la póliza con compañía y vigencia, el auto como texto sin catálogo y tipo AUTO).
- [ ] `si la póliza falla (sin cobertura) no queda ningún cliente nuevo` (cuenta de clientes igual a antes).
- [ ] `con el DNI de un cliente existente y sin clienteExistenteId devuelve creado: false y no crea nada`.
- [ ] `con clienteExistenteId agrega auto y póliza sin tocar los datos del cliente` (teléfono y dirección iguales a antes).
- [ ] `el aviso de antigüedad frena a un empleado y deja pasar a un administrador con confirmación`, y `una patente de otro cliente con póliza activa es un error y no crea nada`.
- [ ] `patenteDadaDeBaja con null avisa de un auto dado de baja por otro cliente`.

- [ ] Implementar; `npm run prueba:sola -- pruebas/alta-desde-poliza.prueba.ts` verde. Commit.

### Tarea 4: canales IPC

- [ ] En `src/shared/canales.ts`: `'clientes:leerPoliza': (archivo: { nombre: string; contenido: Uint8Array }) => Resultado<PolizaLeida>`; `'clientes:porDocumento': (documento: string) => Resultado<FilaCliente | null>`; `'clientes:altaDesdePoliza': (datos: DatosDeAltaDesdePoliza) => Resultado<ResultadoDeAltaDesdePoliza>`; ajustar `'polizas:patenteDadaDeBaja'` a `clienteId: number | null`.
- [ ] En `src/shared/api.ts` y `src/preload/index.ts`: `clientes.leerPoliza`, `clientes.porDocumento`, `clientes.altaDesdePoliza` (mismo estilo que `crear`).
- [ ] En `src/main/ipc.ts`: `leerPoliza` y `altaDesdePoliza` con `exigirEdicion('clientes', 'polizas')`; `porDocumento` con `exigirVista('clientes', 'polizas', 'presupuestos')`; `patenteDadaDeBaja` acepta `null`.
- [ ] `npm run typecheck` limpio. Commit.

### Tarea 5: pantalla

- [ ] `TarjetaDeClienteExistente.tsx`: la tarjeta que hoy está dentro de `DialogoNuevoCliente.tsx` (nombre, DNI/CUIT, sucursal, celular, pólizas activas, deuda), con una línea opcional «En el PDF figura: …» y aviso si `!nombresParecidos`.
- [ ] `CamposDePolizaLeida.tsx`: campos controlados de auto (patente, marca, modelo, año, motor, chasis) y póliza (compañía, N.º, cobertura, vigencia desde/hasta, forma de pago con lista del catálogo), marca «Leído del PDF» según `leidos`, y resalto de lo que falta.
- [ ] `DialogoNuevoCliente.tsx`: zona «Cargar desde la póliza (PDF)» (visible si `usePuedeEditar('clientes')` y `usePuedeEditar('polizas')` y `window.dm.asistente.estado()` dice `configurado`; si no, queda oculta); estados sin PDF → leyendo → revisando → creando; búsqueda de cliente existente (`clientes.porDocumento`, con demora de 400 ms al cambiar el DNI); aviso de antigüedad (`polizas.validarCobertura`, casilla «Continuar igual») y de patente dada de baja (`polizas.patenteDadaDeBaja(null | clienteId, patente)`); botón «Crear cliente y póliza» deshabilitado según `faltantesDelAlta`; con cliente existente: «Agregar esta póliza al cliente existente», «Abrir el cliente existente», «Volver a editar»; aviso de que el PDF se envía a Anthropic. El alta manual queda exactamente igual.
- [ ] `npm run typecheck` limpio. Commit.

### Tarea 6: textos, registro y cierre

- [ ] `src/shared/cambios.ts`: entrada nueva `'18.1.6'` arriba de todo con renglón `agregado`; `pruebas/cambios.prueba.ts` verde.
- [ ] `src/renderer/ayuda/contenido/clientes.ts`: sección sobre cargar desde el PDF (qué lee, qué pide, que se envía a Anthropic, que se revisa antes de crear).
- [ ] Registrar `./lectura-de-poliza.prueba` y `./alta-desde-poliza.prueba` en `pruebas/todas.ts`.
- [ ] `npm run typecheck` y `npm run prueba` completos verdes. Commit, push de la rama, PR (borrador) con base `beta`.

## Autoverificación del plan

- Cobertura del diseño: lectura con IA (T1–T2), todo o nada y cliente existente (T3), permisos y canales (T4), pantalla y avisos (T5), adjunto del PDF (T3), cambios/ayuda/pruebas (T6).
- Lo que NO se puede verificar aquí: la lectura contra la API real y contra PDFs reales (no hay clave ni PDFs), y la pantalla corriendo en Electron. Se dice en el PR.
