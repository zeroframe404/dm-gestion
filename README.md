# DM Gestión

Aplicación de escritorio para Windows de **Seguros Daniel Martínez**.
Electron + React + TypeScript + Vite + Tailwind, con base de datos local SQLite.

## Comandos

```bash
npm install       # instala dependencias (better-sqlite3 trae binarios listos, no compila nada)
npm run dev       # desarrollo con recarga automática (usuarios locales: sin DM_GESTION_TOKEN_DATOS no toca GitHub)
npm run prueba    # 302 pruebas propias, sin tocar ninguna hoja real ni GitHub
npm run dist      # genera el instalador NSIS en release/, sin publicarlo (para probarlo local)
npm run humo:usuarios            # la base de usuarios compartida contra la app real y un simulador de GitHub
npm run humo:usuarios -- --real  # lo mismo contra el repositorio real, en un archivo de prueba que se borra al final
```

## Primer ingreso

**En la computadora que inicializa la base compartida** (la primera, una sola vez): al arrancar se crea
el usuario **daniel** con la contraseña **cambiar123** (rol SUPER_ADMIN) y la aplicación obliga a
cambiarla al entrar. Después, desde Administración → Usuarios, el botón **Subir usuarios** publica
los usuarios de esa computadora en GitHub (ver «Base de usuarios compartida» más abajo).

**En cualquier otra computadora**: la primera vez hace falta internet, porque el usuario y la
contraseña se comprueban contra la base compartida. A partir de ahí, el último que ingresó con
conexión puede volver a entrar sin internet durante 30 días.

## Datos locales

Todo queda en la carpeta `%APPDATA%/dm-gestion/`:

- `dm.db`: base de datos SQLite. La tabla `usuarios` es un **espejo sin contraseñas** de la base
  compartida (sólo nombre, rol, sucursal y estado; `clave_hash` queda vacío), porque pagos, tareas,
  siniestros y el historial la referencian por id.
- `credencial.bin`: la credencial del **último usuario que ingresó con internet** en esta computadora,
  cifrada por Windows (`safeStorage`/DPAPI, atada a la cuenta de Windows). Guarda el hash bcrypt de su
  contraseña (nunca la contraseña) y su perfil; permite entrar sin internet por 30 días. Se borra sola si
  ese usuario fue desactivado o le cambiaron la contraseña. Borrar la carpeta `sesion/` la deja ilegible
  (ahí vive la clave de cifrado): hará falta un ingreso con internet.
- `config.json`: credenciales de Google (cuenta de servicio y URL de la hoja). Nunca va al repositorio.
- `informes/`: una copia en texto de cada informe de importación.
- `adjuntos/<siniestro>/`: los documentos de cada siniestro (la denuncia, el presupuesto del taller, las fotos).
- `respaldos/`: los últimos 30 respaldos diarios de la hoja en `.xlsx`.

### Migraciones: una versión publicada NO se edita

El esquema vive en `src/main/db/migraciones.ts`. El runner corre sólo las versiones mayores a
`PRAGMA user_version`, así que **una migración que ya salió en un instalador nunca se vuelve a mirar**. Si
se le agrega una sentencia adentro en vez de escribir una versión nueva, las PCs que ya pasaron por esa
versión se quedan sin ese cambio para siempre, mientras que una instalación desde cero lo tiene. Es lo que
pasó con `filas_crudas.huella`: la base quedó en `user_version = 11` sin la columna, la aplicación abría
normal y la importación fallaba con «table filas_crudas has no column named huella».

Para cambiar el esquema, **agregá una versión nueva al final de `MIGRACIONES`**. Hay dos redes de seguridad:

- `reconciliarEsquema` (`src/main/db/esquema.ts`) corre en cada arranque después de las migraciones: arma
  el esquema esperado en una base en memoria, lo compara con el real y agrega las tablas, columnas e
  índices que falten (y repite las sentencias de datos de esa migración, así una tabla repuesta no vuelve
  vacía). En una base sana no toca nada y tarda menos de 20 ms. Si tuvo que reparar algo lo anota en
  **Administración → Sincronización**.
- `pruebas/esquema.prueba.ts` guarda la huella del esquema que deja cada versión (en
  `pruebas/esquema-congelado.ts`). Si alguien edita una migración vieja, `npm run prueba` falla y explica
  qué hacer. Los comentarios y el formato no cuentan: sólo cambia la huella si cambia el esquema.

## Importar desde Google

**Administración → Importar desde Google** lee completa la hoja configurada en «Conexión con Google».

Cómo funciona, en corto:

- **Las columnas se buscan por el nombre del encabezado de la fila 1**, nunca por su letra: cada mes las
  puso en otro lugar. Los sinónimos están en `src/main/importacion/encabezados.ts`; para aceptar una
  variante nueva («OB. DE COBERTURAS», «LOCAL», «D.N.I.») alcanza con sumarla a la lista del campo.
- **La planilla mensual más nueva define el estado actual**: de ella salen clientes, vehículos y pólizas
  activas. Las planillas viejas sólo aportan sus cuotas del mes, y las pestañas «BAJAS», las bajas.
- **Cada fila recibe un `_ID`** en una columna al final de su pestaña, que después queda oculta. Ése es
  el identificador que permite volver a correr la importación sin duplicar nada, y es la base de la
  sincronización de la Fase 4. La columna se escribe sólo en las filas que todavía no lo tienen.
- **Los valores se guardan tal cual están** («A/D», «---», textos en la cuota). Los espacios sobrantes se
  limpian únicamente para comparar; además se derivan columnas auxiliares (`cuota_monto`, `pago_fecha`)
  que no reemplazan al texto original.
- **Los datos raros no frenan la importación**: fechas imposibles, cuotas no numéricas, DNI repetidos,
  sucursales fuera de catálogo y demás quedan listados en el informe, que se puede descargar.
- Si la cuenta de servicio no tiene permiso de **editor**, no se puede escribir el `_ID`; en ese caso se
  avisa y no se guardan las filas nuevas, porque la corrida siguiente las duplicaría.
- Una fila borrada de la hoja **no se borra de la base**: queda marcada en `filas_crudas.en_la_hoja = 0`
  (el histórico se conserva). Las demás tablas se cruzan con esa marca por `fila_id`.

### Probar con los datos reales, sin credenciales

Si la hoja está compartida por link, se puede bajar una copia y correr el importador contra ella sin
cuenta de servicio y sin escribir una sola celda en Google (el `_ID` se escribe sobre la copia en
memoria). La carpeta tiene que tener un `mapeo.json` con `[{ nombre, archivo }]` y los CSV al lado:

```bash
npm run prueba:copia -- <carpeta> --analizar   # dónde está la fila de encabezados de cada pestaña
npm run prueba:copia -- <carpeta>              # importa y deja informe.txt en esa carpeta
npm run prueba:copia -- <carpeta> --dos-veces  # verifica que volver a importar no duplique nada
```

### Probar sin tocar la hoja real

`npm run prueba` corre el banco de pruebas contra una hoja simulada en memoria que replica la
estructura de la real (`pruebas/hoja-de-prueba.ts`): planillas mensuales con las columnas corridas de un
mes al otro, sus «BAJAS», y AMP, RIESGOS VARIOS, IMPUTADOS, SINIESTROS, CONTADOR, SEGUROS ACT y
COBERTURA, con datos raros a propósito. También levanta un servidor local que simula la API de Google
para probar el cliente sin salir a internet.

## Cartera (la planilla del mes)

**Cartera → Planilla del mes** es la pantalla de todos los días: la misma hoja de Excel, con el semáforo
calculado solo y las acciones de un clic.

- **Tabla virtualizada**: con 2.400 filas abre en ~0,1 s y dibuja sólo las ~20 que se ven.
- **Edición directa**: doble clic en una celda. `FORMA DE PAGO`, `SUCURSAL`, `COMPAÑÍA`, `COBERTURA` y
  `VEHICULO` traen desplegable, pero se puede escribir cualquier cosa (validación suave, como la hoja).
  Cada cambio queda en la tabla `historial` con quién, cuándo, qué campo y qué había antes.
- **Semáforo** (`src/shared/semaforo.ts`, con sus propias pruebas):

  | Color | Cuándo |
  |---|---|
  | 🟢 Al día | la cuota tiene fecha en `CUANDO PAGO` o se registró el pago desde la app |
  | 🔵 Débito automático | `FORMA DE PAGO` es TARJETA o CBU |
  | 🟡 Vence pronto | faltan 4 a 7 días, **o** ya venció pero todavía corre la cobertura financiera |
  | 🟠 Urgente | faltan 1 a 3 días, **o** es el último día de cobertura financiera |
  | 🔴 Vencido | vence hoy, o venció y la compañía ya no lo cubre |

  Los **días de cobertura financiera** son por compañía y se editan en **Administración → Compañías**.
  Vienen cargados con los que usa la agencia (ATM 7, RIVADAVIA 7, EQUIDAD 5, METROPOL 3, AGROSALTA 0…);
  una compañía nueva arranca en 30.
- **Acciones por fila**: «Avisar» abre WhatsApp con la plantilla configurable (`{nombre}`, `{cuota}`,
  `{vencimiento}`) y deja la fila en `ENVIADO` con la fecha; «Registrar pago» llena `CUANDO PAGO` y crea
  el pago; «Dar de baja» pide motivo y nota y mueve la póliza a **Bajas** del mes.
- **Meses anteriores**: se ven completos pero de sólo lectura. **Cerrar mes** (ADMIN/SUPER_ADMIN) crea el
  mes siguiente copiando las pólizas activas, igual que duplicar la hoja: conserva cuota, vencimiento,
  forma de pago y observaciones, y vacía el pago y el aviso.

### Probar la pantalla

```bash
npm run humo -- <carpeta-de-datos> [usuario] [clave]
```

Abre la aplicación contra esa carpeta de datos (en desarrollo, la variable `DM_GESTION_CARPETA_DATOS`
permite usar una distinta de `%APPDATA%/dm-gestion`), entra, va a Cartera y comprueba que la planilla
abra, que la tabla esté virtualizada, que se desplace fluida y que «Cerrar mes» aparezca sólo para
administradores.

## Sincronización con Google (Fase 4)

La aplicación y la hoja se mantienen iguales solas, usando la columna `_ID` como clave fila a fila.

- **Subida**: cada cambio se anota en `cola_sync` en el mismo momento en que se toca algo, y un proceso
  en segundo plano la vacía cada 10 segundos. Escribe **sólo valores** (no toca formatos ni colores) y
  agrupa todo: una tanda de 200 cambios usa 2 llamadas a Google, no 200. Los reintentos son
  exponenciales (10 s, 20 s, 40 s… hasta 10 minutos) y los errores que no se arreglan reintentando
  («esa pestaña no existe») quedan marcados para que alguien los mire.
- **Bajada**: al abrir sesión, cada 5 minutos y con «Sincronizar ahora». Compara cada fila contra la
  huella de la última vez y sólo toca lo que cambió: la hoja entera (25 pestañas, 28.000 filas) se
  revisa en ~400 ms con **3 llamadas**. Las filas que alguien cargó a mano en Google reciben su `_ID` y
  se incorporan con la importación completa.
- **Bajas**: la fila se agrega a la pestaña «BAJAS …» y se elimina de la planilla del mes, igual que el
  cortar y pegar de siempre.
- **Sin internet**: todo sigue funcionando, la cola espera y se vacía sola al volver la conexión. El
  indicador de la barra superior muestra verde «Sincronizado hace X», amarillo «N cambios por subir» o
  rojo «Sin conexión — trabajando local».
- **Conflictos**: nunca se baja con cambios locales sin subir, así que lo más reciente no se pisa. Si
  igual un mismo campo cambió de los dos lados, el que pierde queda en `historial` marcado como
  «pisado por sincronización» y aparece en los movimientos de la pantalla de Sincronización.
- **Respaldo**: la primera vez que la aplicación está abierta después de las 20:00 exporta la hoja a
  `.xlsx` en `%APPDATA%/dm-gestion/respaldos/` (conserva 30) y sube una copia a la carpeta
  «Respaldos DM» del Drive. Si Drive falla, la copia local igual queda guardada.

**Cuota de Google**: la subida usa como mucho 4 llamadas por tanda (6 tandas por minuto = 24) y la
bajada 3 cada 5 minutos. Bien por debajo de las ~50 por minuto.

**Ojo con la cuenta de servicio y Drive**: una cuenta de servicio no tiene espacio propio en Drive. Para
que el respaldo suba, creá la carpeta «Respaldos DM» con tu cuenta de Google y compartila con el correo
de la cuenta de servicio como editor.

## Clientes, Pólizas y Renovaciones (Fase 5)

Tres módulos nuevos en la barra lateral, más la subpestaña **Cartera → Reglas de cobertura**.

### Clientes

- **Listado** con buscador (nombre, DNI/CUIT, patente, número de póliza o teléfono) y filtros de
  sucursal y compañía. Se ve cuántos resultados hay sobre el total de la cartera.
- **Cuatro vistas de la cartera**, arriba de todo, cada una con su número: **Todos**, **Activos sin
  deuda**, **Activos con deuda** y **Bajas**. Se toca una y el listado queda en esa. Los números se
  calculan con la búsqueda y los filtros puestos, así que dicen de antemano cuántos va a traer cada
  una. («Sin pólizas» aparece sólo si hay alguno: son altas a las que todavía no se les cargó la
  primera póliza.)
- **«Con deuda»** es tener alguna cuota del mes abierto sin pagar que **no** se cobre sola: las de
  TARJETA o CBU nunca figuran con deuda, con la misma regla que usa el semáforo de la planilla.
- **«Baja»** es haber tenido pólizas y no tener ninguna activa. El que nunca tuvo ninguna no es una
  baja: figura como «Sin pólizas».

#### Buscar deudores

El botón **«Buscar deudores»** del listado abre la ventana que arma la lista de a quién hay que
cobrarle. Se tilda lo que haga falta y la lista se rehace sola:

- **Mes**: arranca en el mes abierto (el que se está cobrando) y se puede mirar cualquier mes anterior
  o **todos los meses** juntos, que es donde aparecen las deudas viejas.
- **Sucursal**, **compañía** y **forma de pago**: se tildan de a varias. Sin tildar ninguna entran
  todas.
- **Días de vencimiento**: los 31 días, para tildar **sueltos y en cualquier orden** —«los que vencen
  el 1, el 3 y el 5»—, que es para lo que existe esta ventana. Cada día muestra cuántas deudas tiene,
  así se tilda sabiendo dónde hay algo, y el contador no cambia al tildar otro día.
- **Las que se cobran solas** (débito automático, CBU, tarjeta) quedan afuera por omisión, igual que
  en el resto de la aplicación. Pero **si se tilda una forma de pago, manda lo tildado**: pedir
  TARJETA es querer ver justamente las tarjetas que no entraron.
- Cada fila es una **cuota impaga**, no una persona: quien tiene dos pólizas atrasadas debe dos veces
  y hay que cobrarle las dos. Abajo se dice cuántas deudas son, cuántas personas distintas y el total.
- **Exportar .xlsx** para trabajarlo en Excel y **Exportar .txt** para imprimirlo o mandarlo por
  mensaje (sale en columnas de ancho fijo, con los filtros usados en el encabezado y el total al pie).
  Los dos abren «Guardar como» y salen con los mismos filtros que se ven en pantalla.
- **Ficha** con seis pestañas: Datos (editables), Vehículos, Pólizas, Pagos, Siniestros y Notas.
  Las pólizas van separadas en **Activas** e **Histórico**, y las del histórico muestran el motivo y la
  fecha de la baja.
- **Alta sin duplicados**: si el DNI/CUIT ya existe, no se crea nada. Aparece el cliente que ya estaba
  —con su sucursal, su teléfono y cuántas pólizas activas tiene— y dos caminos: abrir esa ficha o
  volver a editar sin perder lo cargado. El documento se compara normalizado, así que «20-30111222-3»,
  «30.111.222» y «30111222» son la misma persona.
- Desde la ficha, las cuatro acciones que se hacen con el cliente delante:
  - **Nueva póliza**: abre el formulario de alta con el cliente ya elegido.
  - **Registrar pago**: muestra las cuotas del mes abierto de ese cliente y cobra la que se elija (con
    una sola cuota va directo). Es el mismo pago que la Planilla del mes, así que llena `CUANDO PAGO` y
    queda en verde en la planilla.
  - **Cargar siniestro**: fecha, número, qué pasó, estado e importe, imputado a una de sus pólizas
    vigentes o sin imputar si todavía no se sabe. Queda en la pestaña Siniestros y sube a la pestaña
    SINIESTROS de la hoja. El seguimiento completo llega con el módulo Siniestros.
  - **Nueva tarea**: título, detalle, responsable y vencimiento.

### Pólizas

- **Listado por póliza** (no por cliente) con compañía, número, cobertura, vehículo, cuota, vigencia y
  **estado**. El estado no está en ninguna columna de la hoja: se calcula con `activa` y la vigencia —
  ACTIVA, VENCIDA (la vigencia ya pasó) o BAJA (se dio de baja). Una póliza sin vigencia cargada sigue
  activa: no se puede afirmar que venció.
- **Alta y edición en una sola pantalla**: cliente (buscador), vehículo (uno de los del cliente o uno
  nuevo), compañía, cobertura, forma de pago, cuota, día de vencimiento, número de póliza o propuesta,
  vigencia, AVISAR VTO y observaciones. Compañía, cobertura y forma de pago sugieren lo que ya se usa
  pero dejan escribir cualquier cosa, como la planilla.
- **Advertencia de antigüedad**: apenas están cargados compañía, cobertura y año del vehículo se
  compara contra la matriz de reglas y, si el vehículo es más viejo de lo que esa compañía acepta,
  aparece el aviso en el momento (por ejemplo: «SANCOR no acepta TERCEROS COMPLETO para un vehículo
  modelo 1995 (31 años de antigüedad): toma desde el modelo 2011»). Se puede continuar igual sólo con
  la confirmación de un ADMIN o SUPER_ADMIN, y queda anotado en el historial.
- La validación **degrada bien a propósito**: sin regla cargada para esa combinación, sin límite en la
  regla, o con el año del vehículo ilegible, no se advierte nada y la póliza se guarda normal.

### Reglas de cobertura (Cartera → Reglas de cobertura)

La matriz de qué antigüedad acepta cada compañía para cada cobertura. La edita **sólo el SUPER_ADMIN**.

**Arranca vacía de límites, y es correcto**: la pestaña «COBERTURA» de la planilla real no es una tabla
sino una matriz de resumen (compañías en un eje, coberturas en el otro, celdas combinadas) sin
encabezados en la primera fila, así que el importador no la puede mapear y sus filas quedan sólo en los
datos crudos. Intentar interpretarla sería frágil y se rompería en silencio. Entonces:

- La pantalla lista **qué combinaciones de compañía + cobertura ya están en uso en la cartera y todavía
  no tienen regla**, ordenadas por cantidad de pólizas, con un botón para cargarlas. Es lo que hace que
  sirva desde el primer día aunque la matriz esté vacía.
- Un panel plegable **«Lo que dice la hoja»** muestra las filas crudas de esa pestaña, tal cual, para
  copiar los valores sin adivinar.
- Se carga **antigüedad máxima** (en años) **o año mínimo**, no los dos. Vacío significa «esta compañía
  no pone límite», que es un valor válido y frecuente.

### Renovaciones

- **Bandeja** con las pólizas cuya vigencia HASTA cae en los próximos **60 días**, agrupadas por semana
  («Esta semana», «La semana que viene», «Semana del 8 de sep al 14 de sep»). También entran las que
  vencieron hace poco y siguen activas: son las que más urge atender y si no aparecen se pierden.
- Por fila: **responsable** (un usuario), **estado del trámite** (pendiente / en gestión / renovada / no
  renueva) y **nota**. El seguimiento no se crea hasta que alguien toca la fila: abrir la bandeja no
  escribe en la base.
- **Etiqueta destacada** cuando las observaciones piden aumentar al renovar. Se reconoce la idea, no el
  texto exacto: «20% aumentar cuando se renueva», «aumentar 20 % al renovar» y «SUBE 15% EN LA
  RENOVACION» valen igual.
- **Renovar** crea la vigencia nueva (propone un año más y la cuota anterior —ya aumentada si las
  observaciones lo piden—, todo editable) y deja la anterior como histórica, enganchada por
  `poliza_anterior_id`. No se le inventa una baja con motivo: no se dio de baja, se renovó.
- **No renueva** da de baja la póliza con el motivo elegido y cierra el trámite.

Todo respeta los roles y escribe en `historial` y en `cola_sync`, así que los cambios suben a la hoja
como cualquier otro.

### Probar la Fase 5

```bash
npm run sembrar -- <carpeta>       # arma una carpeta de datos con la hoja simulada ya importada
npm run humo:fase5 -- <carpeta>    # abre la app de verdad y recorre los cuatro criterios (24 pasos)
npm run humo:deudores -- <carpeta> # los estados del listado y «Buscar deudores», con exportación (18 pasos)
```

`sembrar` importa **dos veces** (primero hasta julio, después con agosto) porque es lo que pasa mes a
mes: recién así queda una póliza dada de baja y la ficha tiene histórico. Además acerca cuatro
vencimientos y le pone un límite de antigüedad a una regla, para que la bandeja y la advertencia tengan
algo que mostrar.

**Una limitación heredada del importador, que conviene tener presente**: los clientes, vehículos y
pólizas se crean desde la planilla mensual **más nueva**. Alguien que se fue hace varios meses y nunca
volvió a aparecer queda en la base como filas de meses viejos y como baja, pero sin ficha propia. Los
que se dieron de baja mientras la aplicación venía corriendo sí tienen ficha e histórico completos.

## Cobranzas e Imputados (Fase 6)

El módulo **Cobranzas** mira los mismos pagos de tres maneras: por día (la caja), por mes (la
rendición) y por compañía (las comisiones). Todos salen de la tabla `pagos`, que se llena tanto con
«Registrar pago» de la Cartera como con el alta manual de la caja.

### Caja del día

Por **sucursal y fecha**: hora, cliente, DNI, compañía, póliza, patente, importe, medio de pago y
quién cobró. Arriba, el total del día y el subtotal por cada medio de pago.

- Abre en el día de hoy y en la sucursal de quien entró, que es el caso normal del mostrador.
- La sucursal de la caja es **la del mostrador donde entró la plata**, no la del cliente: un cliente de
  Lanús que paga en Dock Sud suma a la caja de Dock Sud (`pagos.sucursal_cobro`).
- **Exportar el día** guarda un CSV con punto y coma y BOM, listo para abrir de un doble clic en Excel.
- **Registrar pago** busca al cliente, ofrece sus cuotas del mes abierto y —si se elige una— cobra por
  el mismo camino que la Cartera, así la fila queda paga y en verde. También admite un pago suelto,
  para un riesgo vario o para alguien que todavía no está en la planilla.
- Los pagos sin importe numérico (un «A/D» venido de la hoja) se listan pero no suman al total, y se
  avisa cuántos son.

### Mora

Las cuotas **vencidas sin pago de todos los meses**, ordenadas de la más atrasada a la más nueva, con
días de atraso, cuota, teléfono y el mismo **Avisar** por WhatsApp de la planilla.

- Filtros por sucursal, compañía y rango de atraso: **1-7**, **8-30** y **+30** días. El «+30» sólo
  tiene sentido mirando varios meses: dentro de un mes solo no puede haber atrasos mayores.
- **No entran las pólizas dadas de baja** (a un ex cliente no se lo persigue por WhatsApp) ni las de
  **débito automático**, que se cobran solas; hay una casilla para incluirlas cuando el débito no entró.
- Una cuota de un **mes ya cerrado** se puede avisar igual, pero su planilla no se toca: el aviso queda
  en el historial en vez de escribir ENVIADO en un mes que es de sólo lectura.

### Imputados (la rendición mensual)

La misma pantalla se ve en **Cobranzas → Imputados** y en **Cartera → Imputados**: es el equivalente de
la hoja IMPUTADOS y tiene que ser una sola.

Selector de mes y compañía y, por cada pago, fecha, cliente, póliza, importe, medio y **RESULTADO**
editable (vacío, IMPUTADO, OK, REVISAR, MAL), con los contadores arriba. El RESULTADO se sincroniza con
la hoja, y lo que la contadora escriba allá vuelve en la próxima bajada.

Dos cosas que hacen falta saber:

- **Los pagos que cobra la aplicación se agregan a la pestaña IMPUTADOS de la hoja.** Si no, el mes
  siguiente la rendición mostraría sólo lo que alguien cargó a mano.
- **La pestaña IMPUTADOS de la hoja real NO es una tabla por fila** (es una matriz de resumen con años
  y totales). Cuando es así, la pantalla lo dice y todo queda guardado sólo en DM Gestión: no se
  escriben filas sueltas en una planilla que no las espera. Lo mismo si la pestaña existe como tabla
  pero le falta la columna RESULTADO. Para sincronizar hay que armar en la hoja una pestaña IMPUTADOS
  con encabezados FECHA, NOMBRE, DNI, CIA, POLIZA, IMPORTE, MEDIO DE PAGO, MES y RESULTADO, e importarla.

### Comisiones

Sólo para ADMIN y SUPER_ADMIN. El **porcentaje de comisión de cada compañía** se carga en
**Administración → Compañías**, al lado de los días de cobertura financiera; en **Cobranzas →
Comisiones** se ve, por mes y compañía, la suma cobrada y la comisión estimada.

Es una **estimación**: la liquidación de verdad la manda cada compañía y puede diferir. Las compañías
con cobranza en el mes y sin porcentaje cargado se listan aparte, para que no pasen por cero sin que
nadie se entere.

### Ticket (opcional)

**Administración → Impresora** configura la ticketeadora térmica de 80 mm (POS-80): se elige la
impresora de la lista que devuelve Windows, se ajusta el ancho del papel y se puede imprimir una
prueba. Con el ticket activo, cada pago registrado imprime en silencio un comprobante con
«SEGUROS DANIEL MARTÍNEZ», la sucursal, la fecha y hora, el cliente, la patente, la póliza, el importe,
el medio y quién atendió.

**El ticket nunca puede frenar un cobro**: se manda a imprimir en segundo plano y, si falla, el pago ya
está guardado y el motivo queda anotado en esa misma pantalla. Sin impresora configurada no se imprime
nada y todo funciona igual.

### Probar la Fase 6

```bash
npm run sembrar -- <carpeta>       # la misma carpeta de datos de la Fase 5
npm run humo:fase6 -- <carpeta>    # abre la app de verdad y recorre los criterios (19 pasos)
```

La prueba de humo registra tres pagos, comprueba que la caja los sume bien por medio de pago, revisa
que la mora liste sólo cuotas realmente vencidas y arme el WhatsApp, marca dos pagos como IMPUTADO
desde la pantalla y verifica que el cambio quede camino a la hoja, carga un porcentaje de comisión y,
por último, configura una impresora inexistente para comprobar que el cobro se registra igual.

No hace clic en «Avisar» a propósito: abriría WhatsApp en el navegador de quien corre la prueba.

## Siniestros, Riesgos varios y AMP (Fase 7)

Los siniestros dejan de ser filas sueltas y pasan a ser **fichas con seguimiento**, sin perder la vista
de lista mensual de siempre. Además, **Cartera → Riesgos varios** se vuelve editable y aparece
**Cartera → AMP** con las ampliaciones pendientes.

### Siniestros

**El listado** es la misma tabla de la hoja —sucursal, compañía, póliza, cobertura, asegurado, patente,
fecha de carga, fecha del siniestro, N° de siniestro y observaciones— con selector de mes, buscador
(asegurado, patente, N° de siniestro o de póliza) y filtros por sucursal, compañía y estado.

- **El mes es el de la FECHA DE CARGA**, que es como se lleva la lista en la hoja. Los siniestros que
  vinieron sin esa columna caen en el mes en que ocurrieron, que es lo más cercano que se puede saber.
- **La palabra ROBO va destacada en rojo**, como en la hoja, y hay un filtro «Sólo robos». Se reconoce
  como palabra entera (ROBO, ROBARON, HURTO), así que «BRAZO ROBOTIZADO» no pinta la fila.
- Los contadores de arriba (CARGADO / EN TRÁMITE / ESPERANDO DOCUMENTACIÓN / CERRADO) filtran de un
  clic y cuentan **dentro de lo que se está mirando**, pero sin el filtro de estado: si no, tocar uno
  vaciaría los otros tres y no se podría volver.

**El alta rápida** es la del teléfono sonando: se busca por patente, apellido, DNI o número de póliza y
se elige la póliza; compañía, número, cobertura, patente y sucursal **se completan solos**. Lo único
que hay que escribir es qué pasó y cuándo. Si la póliza figura vencida o dada de baja se avisa en el
momento, pero se puede cargar igual: el siniestro existe aunque la póliza esté discutida.

**La ficha** tiene:

- **Estado del trámite**: CARGADO → EN TRÁMITE → ESPERANDO DOCUMENTACIÓN → CERRADO. La columna ESTADO
  de la hoja trae veinte años de textos distintos («ABIERTO», «PERITADO», «PAGADO», «FALTA
  DOCUMENTACION»), así que se los lleva a esos cuatro con una tabla de sinónimos y el texto original se
  sigue mostrando al lado hasta que alguien toque el desplegable. Lo que no se reconoce se muestra como
  CARGADO: está denunciado y todavía no se sabe más.
- **Línea de tiempo de observaciones**, cada una con su fecha y el usuario que la escribió. No se editan
  ni se borran: se agregan. La denuncia misma es la primera entrada, así la ficha nunca arranca vacía.
  El resumen de la línea de tiempo se escribe en la columna OBSERVACIONES de la hoja (hasta 900
  caracteres), para que quien mire la planilla vea lo mismo que quien mira la ficha.
- **Documentos adjuntos**: se copian a `%APPDATA%/dm-gestion/adjuntos/<siniestro>/` y se abren con un
  clic. Si hay conexión con Google se sube además una copia a la carpeta **«Adjuntos DM»** del Drive de
  la cuenta de servicio; que eso falle no pierde nada —el archivo local ya está guardado y el motivo
  queda a la vista en la ficha. Dos archivos con el mismo nombre no se pisan: el segundo queda como
  «(2)». Borrar un documento es definitivo, así que lo hacen sólo ADMIN y SUPER_ADMIN.
- **Tareas vinculadas**, con responsable y vencimiento, contadas en el listado mientras estén pendientes.
- Los datos de la hoja se corrigen con **doble clic**. El caso de todos los días es el número de
  siniestro: la compañía lo da dos días después de la denuncia.

Desde la pestaña Siniestros de la ficha del cliente se abre la ficha del siniestro con un clic.

**Ojo con la carpeta de Drive**: igual que con los respaldos, una cuenta de servicio no tiene espacio
propio en Drive. Para que los adjuntos suban, creá la carpeta «Adjuntos DM» con tu cuenta de Google y
compartila con el correo de la cuenta de servicio como editor. Sin eso, los documentos quedan
guardados localmente y la ficha lo dice.

### Riesgos varios (Cartera → Riesgos varios)

La tabla de la pestaña RIESGOS VARIOS —sucursal, emisión, titular, riesgo, día de VTO, forma de pago,
compañía, póliza, cuota, desde, hasta, teléfono y observaciones— con **edición directa** (doble clic en
la celda, con desplegable de lo que ya se usa pero dejando escribir cualquier cosa) y **alta simple**.

- El **semáforo azul** es el mismo de la planilla del mes: TARJETA y CBU se cobran solos, así que van
  marcados y no hay que perseguirlos. La regla vive en un solo lugar (`esDebitoAutomatico`).
- No hay período: es una tabla sola que se corrige encima, así que no hay selector de mes ni meses de
  sólo lectura.
- El alta pide **sólo el titular y la compañía**: un riesgo se carga apenas se vende y los papeles
  llegan después. Si el titular ya es cliente de la agencia, el riesgo queda colgado de su ficha.
- Todo cambio queda en `historial` y sale a la hoja por la misma cola que el resto.

### AMP (Cartera → AMP)

La lista chica de ampliaciones pendientes: sucursal, fecha, nombre, forma de pago, patente, marca,
modelo, fecha de vencimiento y qué se amplía. Ordenada por lo que vence antes.

- El **tilde de «resuelto»** saca la fila de la lista. Nada se borra: destildarla la devuelve, y
  «Ver también las resueltas» muestra el histórico completo con quién la resolvió y cuándo.
- **El tilde es de la aplicación.** La pestaña AMP de la hoja no siempre tiene una columna donde
  ponerlo, y no se le van a escribir columnas nuevas a una planilla que no las espera: si la columna
  RESUELTO está, el tilde viaja; si no, queda en DM Gestión y la pantalla lo explica. Volver a importar
  **no destilda** lo que ya se había resuelto acá.

### Probar la Fase 7

```bash
npm run sembrar -- <carpeta>       # la misma carpeta de datos de las fases 5 y 6
npm run humo:fase7 -- <carpeta>    # abre la app de verdad y recorre los criterios (25 pasos)
```

La prueba de humo carga un siniestro buscando por patente y comprueba que los datos de la póliza se
completen solos, le agrega una observación y un adjunto y verifica que queden en la línea de tiempo con
el usuario, cambia el estado, le vincula una tarea, edita un riesgo vario y tilda una ampliación.

Sobre el criterio «el siniestro nuevo aparece en la pestaña SINIESTROS de la hoja»: la carpeta sembrada
no tiene credenciales de Google —a propósito, la prueba no puede escribir en una hoja real—, así que lo
que comprueba es que la fila quedó encolada como «crear» contra esa pestaña, con sus campos ya
traducidos a columnas. Ése es exactamente el mecanismo que la sube en cuanto hay conexión, y es lo mismo
que el banco de pruebas verifica de punta a punta contra la hoja simulada (`npm run prueba`).

## Leads, Presupuestos y Tareas (Fase 8)

Lo comercial que hoy vive en papelitos y en chats sin contestar. Son módulos **nuevos**: no existen en
el Excel de la agencia, así que DM Gestión les crea sus propias pestañas en la hoja (ver más abajo).

### Leads (las consultas)

Tarjetas, no tabla: una consulta son cuatro datos y una charla, y lo que hay que ver de un vistazo es a
quién falta contestarle y qué quería.

- **Lo que se carga**: nombre, teléfono, sucursal, qué quiere asegurar (texto libre, escrito como lo
  dijo) y tipo de vehículo, **cómo llegó** (WhatsApp / vino al local / recomendado / redes / otro) y el
  estado. El DNI/CUIT y el email son optativos, pero cargar el documento vale la pena: es lo que
  después evita duplicar al cliente.
- **El embudo**: NUEVO → EN CHARLA → COTIZADO → GANADO / PERDIDO. Se cambia desde la misma tarjeta. Las
  cerradas (GANADO y PERDIDO) se esconden salvo que se pidan: ya no son trabajo pendiente.
- **Las notas** quedan fechadas y firmadas, y se acumulan. Nada se edita ni se borra: se agrega.
- **Botón de WhatsApp** en cada tarjeta, con el teléfono ya en el formato que espera `wa.me`.
- **«Convertir en cliente»** es el botón que justifica el módulo: crea el cliente con los datos que ya
  están escritos acá y ofrece abrir el formulario de póliza nueva. Si ese DNI/CUIT ya es de un cliente
  **no se duplica**: se usa el que está y se dice por qué (la misma regla del alta de Clientes).

### Presupuestos

Un vehículo y las compañías que se cotizaron para él.

- **Las opciones** son filas que se agregan y se sacan: compañía, cobertura, precio mensual y un
  comentario. La más barata se muestra primero y el listado deja ver el «desde» sin abrir nada.
- **«Enviar por WhatsApp»** arma el mensaje solo —saludo, el vehículo, una línea por opción con su
  comentario, y el cierre— y lo deja en ENVIADO. El mensaje se ve entero en la ficha **antes** de
  mandarlo; sin asteriscos ni negritas, que en WhatsApp de escritorio quedan feas.
- **«Guardar en PDF» / «Imprimir»** sacan una hoja A4 con el nombre de la aseguradora, los datos, la
  tabla de opciones y el pie que aclara que un presupuesto no es cobertura.
- **Al aceptar** se marca cuál eligió el cliente y se ofrece cargar la póliza precargada. Si el
  presupuesto era de una consulta sin convertir, se avisa que primero hay que convertirla.
- **Versiones**: tocar un presupuesto ya ENVIADO **no lo edita**, crea la versión siguiente y deja la
  anterior tal cual, con los precios que el cliente ya recibió. En BORRADOR sí se edita en el lugar:
  todavía no lo vio nadie. El listado muestra sólo la versión vigente; el tilde «con versiones
  anteriores» trae la historia.
- Cargarle un presupuesto a una consulta la deja **COTIZADA** sola.

### Tareas

Los pendientes del equipo. La tabla existía desde la Fase 5 (se crean desde la ficha del cliente y del
siniestro); acá está el módulo propio.

- **Lo que tiene**: título, descripción, asignado a, sucursal, vence, prioridad (ALTA / NORMAL / BAJA),
  estado (PENDIENTE / EN CURSO / HECHA), comentarios y adjuntos.
- **El orden no se elige**: primero lo abierto, después lo urgente, después lo que vence antes. Es el
  orden en que hay que hacer las cosas. La pantalla arranca con «Las mías» puesto.
- **Sueltas o vinculadas**: una tarea puede colgar de un cliente, una póliza, un siniestro, una
  renovación, una consulta o un presupuesto. Desde la tarea se salta a la ficha y desde la ficha se ve
  lo que falta hacer.
- **En Inicio**, cada usuario ve sus pendientes apenas entra, con lo vencido en rojo y lo de hoy en
  ámbar. Si no tiene nada, la sección no aparece.
- **La campana** de la barra superior enciende un punto cuando te asignan algo que todavía no viste o
  cuando algo vence hoy; el número que se ve al lado es lo pendiente. Son dos cosas distintas a
  propósito: tener ocho tareas abiertas es normal y no tiene que gritar, que te acaben de asignar una
  sí. Abrirla cuenta como enterarse. Se refresca sola cada dos minutos, porque una tarea puede
  asignarla otra persona desde otra computadora y llega por la sincronización.
- La que uno se pone a sí mismo **no** enciende su propia campana.

### Las tres pestañas nuevas de la hoja

Leads, presupuestos y tareas no existen en el Excel de la agencia. Para que igual se puedan mirar desde
Google, DM Gestión crea **«APP LEADS»**, **«APP PRESUPUESTOS»** y **«APP TAREAS»** al final del archivo,
con sus encabezados, **la primera vez que hay algo que subir a alguna de ellas**.

- Se crean tarde a propósito: una hoja de una agencia que todavía no cargó ni un lead no tiene por qué
  llenarse de pestañas vacías.
- Se crean **al final**, nunca en el medio: el orden de las pestañas es lo que usa el importador para
  deducir el año de las planillas mensuales que no lo dicen en el título.
- Van en un solo sentido (la aplicación escribe, la hoja mira). Sus filas quedan anotadas como conocidas
  igual que las de cualquier otro módulo, así que volver a importar no las duplica ni dispara una
  importación completa.
- Las tareas de la Fase 5 —creadas antes de que la pestaña existiera— se quedan sin subir: no se inventa
  historia en la hoja.

### Probar la Fase 8

```bash
npm run sembrar -- <carpeta>       # la misma carpeta de datos de las fases anteriores
npm run humo:fase8 -- <carpeta>    # abre la app de verdad y recorre los criterios (20 pasos)
```

La carpeta sembrada trae ahora **un segundo usuario** (`lucia`, con la misma contraseña inicial), porque
el criterio de las tareas necesita dos personas: asignarle una a otro y comprobar que le llega.

La prueba de humo carga una consulta y la convierte en cliente comprobando campo por campo que salió con
los mismos datos, arma un presupuesto de tres opciones y verifica el mensaje de WhatsApp línea por
línea, lo manda, lo cambia después de enviado y comprueba que salga la versión 2 con la 1 intacta, le
asigna una tarea a otro usuario con comentario y adjunto, y verifica que las tres pestañas salgan
camino a la hoja.

Sobre el criterio «las pestañas aparecieron en la hoja de PRUEBA»: igual que en la Fase 7, la carpeta
sembrada no tiene credenciales de Google, así que la prueba de humo comprueba que las filas quedaron
encoladas contra APP LEADS, APP PRESUPUESTOS y APP TAREAS. La creación de las pestañas de verdad —al
final del archivo, con sus encabezados— la verifica el banco de pruebas de punta a punta contra la hoja
simulada (`npm run prueba`).

## Métricas, Reportes y Marketing (Fase 9)

Los números que hasta ahora se calculaban a mano en las pestañas **CONTADOR** y **SEGUROS ACT** de la
hoja, la exportación con el formato de siempre, y los mensajes de WhatsApp que la agencia manda todos
los días.

### Métricas

Tablero con dos filtros globales arriba —mes y sucursal— que valen para todo lo que hay debajo:

- **Seguros activos** por compañía y por sucursal, con cantidad y porcentaje. Es el equivalente de
  SEGUROS ACT.
- **Altas del mes**, **bajas del mes** con su desglose por motivo, y la **evolución de los últimos doce
  meses**. Es el equivalente de CONTADOR.
- **Cobranza del mes**: cobrado contra pendiente, y el reparto por medio de pago.
- **Siniestros abiertos** por compañía.

Tres definiciones, que son las que hacen que los números coincidan con la planilla y no con otra cosa:

- **Activos** de un mes = las filas de la planilla de ese mes que no están dadas de baja. Es exactamente
  lo que cuenta un COUNTIF sobre la pestaña del mes. No se filtra por «póliza activa» a propósito: eso
  dice cómo está la póliza **hoy**, y con eso un mes viejo mostraría menos pólizas de las que tuvo.
- **Altas** de un mes = las que están en ese mes y no estaban en el anterior, que es la cuenta que hace
  el contador comparando dos pestañas. La columna ALTA de la hoja está llena a medias y con fechas de
  todos los formatos, así que no sirve. Si no hay mes anterior cargado las altas van en cero y la
  pantalla lo dice.
- **Bajas** de un mes = las filas de la pestaña de BAJAS de ese mes, con su MOTIVO.

Los gráficos están dibujados a mano en SVG (`pantallas/metricas/graficos.tsx`): son cuatro formas
simples y no justifican traerse una librería de gráficos entera. Todos llevan además su lectura en
texto al lado, porque un gráfico que sólo se entiende mirándolo no le sirve a quien trabaja con la
planilla abierta al lado.

### Estadísticas (Cartera → Estadísticas)

Lo mismo, en tabla: por compañía y por sucursal, con activos, altas, bajas y pagos del mes elegido.
Existe para una cosa muy concreta —poner esta pantalla al lado de la hoja de Google y comprobar fila por
fila que los activos coinciden con los COUNTIF—, y por eso es tabular y sin gráficos.

### Reportes

Cada listado del programa ya tiene sus filtros en pantalla; lo que faltaba era poder sacar de ahí un
archivo. Se elige el módulo, se ajustan los filtros, se marcan las columnas que van y sale un **.xlsx**
o un **PDF**. La vista previa muestra las primeras filas antes de guardar nada.

Hay un reporte por listado: planilla del mes, bajas, clientes, pólizas, renovaciones, siniestros,
cobranza, mora, riesgos varios, leads, presupuestos y tareas. Cada uno declara una sola vez qué filtros
entiende y qué columnas tiene (`servicios/reportes.ts`), y el .xlsx y el PDF salen los dos de la misma
lista de filas: no hay dos caminos que puedan divergir.

El **.xlsx se escribe sin librerías**: un .xlsx es un ZIP con unos pocos XML adentro, y Node ya trae el
compresor. Está en `servicios/xlsx.ts` y hace lo que hace falta —varias pestañas, encabezados en negrita
congelados y con filtro, texto y números— y nada más: ni fórmulas, ni colores por celda, ni imágenes.

#### Planilla clásica

El reporte especial. Genera un .xlsx con el **formato exacto de la hoja mensual del GENERAL DE CLIENTES**:
las mismas 32 columnas y en el mismo orden (las de AGOSTO, que es la más completa), una pestaña por mes
elegido y su pestaña de BAJAS al lado, sin título ni resumen arriba. Es lo que se imprime y lo que se le
manda al contador. Se puede filtrar por sucursal, y el nombre del archivo lo dice.

No reemplaza a la hoja de Google ni la modifica: es una copia de lo que hay hoy en DM Gestión, que
incluye los cambios que todavía no se subieron.

### Marketing

**Plantillas.** Los mensajes de WhatsApp que la agencia manda una y otra vez, con las variables
`{nombre}`, `{cuota}`, `{vencimiento}`, `{patente}` y `{compania}`. Cada una muestra al lado cómo le
llega al cliente. La plantilla **«Aviso de vencimiento»** es la que usa el botón «Avisar» de la Cartera y
de la Mora: se le cambia el texto y el botón manda el texto nuevo desde el clic siguiente. Por eso está
marcada y no se puede borrar (sí cambiar). Las edita un ADMIN; el resto del equipo las ve y las usa.

Una variable mal escrita se rechaza al guardar: «{Nombre}» llegaría tal cual al teléfono del cliente.

**Segmentos.** Un filtro guardado sobre la planilla del mes abierto —«forma de pago CUPONERA + vence
esta semana + Lanús»— que devuelve la lista de gente a la que hay que escribirle, con el mensaje ya
armado con la plantilla que se le haya puesto, un botón **Avisar** por fila y el contador de avisados.
Se guarda el filtro, no la lista: cada vez que se abre se recalcula sobre la cartera del momento.

**No hay envío masivo, y no es un olvido.** WhatsApp bloquea las cuentas que mandan tandas automáticas,
y la cuenta de la agencia es la misma con la que atiende todo el día. El envío es siempre uno a uno, con
un clic por persona, igual que el botón «Avisar» de siempre: lo que aporta el segmento es no tener que
buscar a quién le toca.

### Qué cambió en lo que ya estaba

- La plantilla del aviso se mudó de `configuracion.plantilla_aviso` a la tabla `plantillas_mensaje`. La
  migración se lleva el texto que la agencia ya tenía escrito: nadie tiene que volver a escribir su
  mensaje. Administración → Compañías la sigue editando igual que antes.
- `{patente}` y `{compania}` se pueden usar también en el aviso de la Cartera: antes sólo había tres
  variables.
- En Métricas, la sucursal de un pago importado cae a la del cliente cuando el pago no la trae: la
  pestaña IMPUTADOS de la hoja no tiene columna LOCAL, y si no toda la cobranza vieja aparecería junta
  en un «(sin sucursal)» que no le dice nada a nadie.

### Probar la Fase 9

```bash
npm run sembrar -- <carpeta>       # la misma carpeta de datos de las fases anteriores
npm run humo:fase9 -- <carpeta>    # abre la app de verdad y recorre los criterios (28 pasos)
```

La prueba de humo compara los activos por compañía del tablero contra el COUNTIF hecho sobre la misma
planilla del mes, genera la planilla clásica y la vuelve a abrir para verificar sus pestañas y sus 32
columnas, edita la plantilla de aviso y comprueba que «Avisar» mande el texto nuevo, y guarda un
segmento y lo compara contra el filtro equivalente aplicado a mano sobre la Cartera.

Sobre el criterio «la planilla clásica abre en Excel»: la prueba de humo no tiene Excel, así que
comprueba que el archivo sea un .xlsx de verdad y **deja el archivo generado en una carpeta temporal,
con la ruta impresa al final**, para abrirlo de un doble clic y mirarlo. Los canales de exportación
aceptan una ruta explícita justamente para esto: un diálogo «Guardar como» del sistema no se puede
manejar desde afuera (es el mismo mecanismo que usa `siniestros:adjuntar`).

## Instalador y actualizaciones automáticas (Fase 10)

Publicar una versión nueva es un solo comando; las PCs con la app instalada se actualizan solas,
sin que nadie tenga que reinstalar a mano.

### Publicar

Hay dos caminos. **El recomendado es el primero**: no necesita ninguna PC en particular ni tener el
proyecto instalado, y siempre publica lo mismo que hay en `master`.

**a) Desde GitHub (`.github/workflows/publicar.yml`).** Subís la versión en `package.json` y empujás el
tag; el resto lo hace una máquina Windows de GitHub Actions: corre el banco de pruebas, arma el
instalador y crea el Release.

```bash
npm version patch --no-git-tag-version   # 1.0.3 → 1.0.4 (también toca el package-lock.json)
git commit -am "1.0.4"
git push
git tag v1.0.4 && git push origin v1.0.4  # esto dispara la publicación
```

El tag y el `package.json` tienen que decir la misma versión: el workflow lo verifica antes de compilar
y corta si no coinciden. También se puede lanzar a mano desde la pestaña **Actions → Publicar → Run
workflow**. No hace falta configurar ningún secreto: usa el `GITHUB_TOKEN` de la propia corrida.

**b) Desde una PC con Windows**, si preferís tener el instalador a mano:

```powershell
$env:GH_TOKEN = (gh auth token)   # o pegá acá un token personal con permiso "repo"
npm run publicar                  # build + sube la versión del package.json como Release
npm run publicar:parche           # npm version patch (1.0.0 → 1.0.1) + build + publicación, todo junto
```

Los dos caminos terminan en el mismo lugar: `npm run dist` genera el instalador NSIS
(`DM-Gestion-Setup-X.Y.Z.exe`) con `electron-builder --publish never`, y `scripts/publicar.mjs` lo sube,
junto con `latest.yml` y el `.blockmap`, como GitHub Release del repositorio privado
`zeroframe404/dm-gestion` usando `gh release create` (en un solo llamado, que es atómico: con
`electron-builder --publish` se creaban dos Releases para el mismo tag y los archivos se repartían al
azar entre las dos copias). Publicando desde una PC, `GH_TOKEN` necesita permiso de
**escritura** sobre ese repo — como ya hay una sesión de `gh` logueada con scope `repo`, lo más
simple es `$env:GH_TOKEN = (gh auth token)`; también sirve un token personal propio con ese scope.

`npm run publicar:parche` exige el árbol de git limpio (lo pide `npm version`), porque de paso crea
el commit y el tag `vX.Y.Z` de la versión nueva.

### Cómo se actualizan las PCs

Al abrir el programa y cada 4 horas, si hay una versión nueva la descarga en segundo plano
(`electron-updater`, configurado en `src/main/servicios/updater.ts`) y muestra una barra fina
arriba de todo: «Hay una versión nueva (X.Y.Z). Se instalará al cerrar el programa», con un botón
**Reiniciar ahora** para no esperar. Si la descarga falla (sin internet, por ejemplo), no aparece
ningún aviso molesto: se reintenta solo en el próximo chequeo. **Administración → Acerca de**
muestra la versión actual, el canal y un botón **Buscar actualizaciones** para chequear sin
esperar el ciclo automático.

El chequeo usa un token de **sólo lectura** embebido en el código (`UPDATE_TOKEN`, en
`src/main/servicios/updater.ts`), separado del `GH_TOKEN` de publicar: así, aunque alguien lo
extraiga de un ejecutable instalado, no puede usarlo para escribir en el repositorio. Para
generarlo:

1. Entrá a [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
   (fine-grained personal access token) con la cuenta dueña del repositorio.
2. **Repository access** → **Only select repositories** → `zeroframe404/dm-gestion`.
3. **Permissions** → **Repository permissions** → `Contents: Read-only` (es lo único que hace
   falta para leer Releases y descargar sus archivos). No le des ningún otro permiso.
4. Generá el token y reemplazá `UPDATE_TOKEN` en `src/main/servicios/updater.ts`.

En desarrollo (`npm run dev`) las actualizaciones quedan desactivadas: no hay instalador del que
bajar nada, y Acerca de lo dice.

### Probar el ciclo completo

```powershell
npm run publicar                                  # publica 1.0.0
# instalar DM-Gestion-Setup-1.0.0.exe
# ... hacer un cambio ...
npm run publicar:parche                           # publica 1.0.1
# desde la app instalada, Acerca de → Buscar actualizaciones (para no esperar las 4 horas)
# aparece la barra de aviso; Reiniciar ahora deja la app en 1.0.1
```

## Base de usuarios compartida (Fase 11)

Los usuarios ya no viven en cada computadora: viven en **`usuarios.json` del repositorio privado
`zeroframe404/dm-gestion-datos`** (una «microbase» leída y escrita con la API Contents de GitHub).
Un usuario creado en una PC entra en todas; desactivarlo o cambiarle la contraseña vale para todas.
Código: `src/main/usuarios/` (documento, cliente de GitHub, credencial cifrada, espejo local) y
`src/main/servicios/baseDeUsuarios.ts` (la orquestación).

### Cómo funciona

- **Con internet**, cada ingreso lee el archivo (con ETag: si no cambió, GitHub responde 304 y no gasta
  cuota), refresca el espejo local y compara la contraseña contra el hash bcrypt del archivo.
- **Sin internet** entra sólo el **último usuario que ingresó con conexión en esa PC**, con la credencial
  cifrada (`credencial.bin`) y por 30 días. Los demás ven «Sin internet. En esta computadora sólo puede
  ingresar «daniel»…». Con la sesión abierta, cada 2 minutos se intenta confirmar contra GitHub; al
  confirmarse desaparece «Ingresaste sin internet» de la barra. Si en el medio lo desactivaron o le
  cambiaron la contraseña desde otra PC, la sesión se cierra con un aviso.
- **Administrar usuarios exige internet y una sesión confirmada**: crear, editar, desactivar y resetear
  se escriben en GitHub con el candado optimista del `sha` (si otra PC escribió en el medio, se relee y
  se vuelve a aplicar; si la escritura se cortó sin respuesta, se relee y se comprueba si quedó). Cada
  escritura es un commit con quién, desde qué PC y con qué versión: el historial del repo es la auditoría.
- **Un usuario nuevo** entra con la contraseña temporal que le puso el administrador y tiene que
  cambiarla con internet; hasta entonces no se guarda credencial para entrar sin conexión.
- Si el archivo está roto o no tiene ningún superadministrador activo, **no se refleja** (el espejo
  anterior se conserva) y el ingreso cae a la credencial guardada con el error a la vista del SUPER_ADMIN.

### Puesta en marcha (una sola vez, el dueño del repositorio)

1. El repositorio ya existe: `zeroframe404/dm-gestion-datos` (privado, con README). Si hubiera que
   recrearlo: `gh repo create zeroframe404/dm-gestion-datos --private --add-readme`. **Tiene que ser un
   repositorio aparte** del código: el token de acá escribe, y si escribiera en `dm-gestion` cualquier PC
   con el programa podría empujar código o publicar una versión que después instalarían todas.
2. Generar el token en https://github.com/settings/tokens?type=beta → *Only select repositories* →
   `dm-gestion-datos` → Repository permissions → **Contents: Read and write**, nada más. Elegir el
   vencimiento más largo que permita la pantalla y **anotarlo**; que no coincida con el de
   `UPDATE_TOKEN` (`src/main/servicios/updater.ts`), así nunca vencen los dos el mismo mes.
3. Pegarlo en `TOKEN_DATOS` de `src/main/usuarios/github.ts` y publicar (`npm run publicar:parche`).
   `publicar.mjs` se niega a publicar con el token vacío.
4. En la computadora que tiene los usuarios de verdad (hoy, la única instalada), abrir la versión nueva,
   ingresar y en **Administración → Usuarios → Subir usuarios**. Eso crea `usuarios.json`. No se hace
   solo a propósito: una PC recién instalada subiría la semilla `daniel/cambiar123` y pisaría a los de
   verdad. Si la única cuenta es `daniel` con la contraseña inicial, primero hay que cambiarla.
5. Comprobar: Usuarios dice «Los usuarios se guardan en la base compartida…», y Acerca de → «Base de
   usuarios» dice «Compartida · GitHub zeroframe404/dm-gestion-datos — última comprobación recién».
   Las demás PCs, al actualizarse, ingresan directo contra GitHub (su `daniel` local queda enganchado al
   de la base; los usuarios locales que no estén en la base quedan desactivados, sin contraseña).

### Rotar el token (vence, o se filtró)

El programa lee el vencimiento que informa GitHub y avisa en Usuarios y en Acerca de desde 30 días
antes. Si vence sin rotarlo, todas las PCs pasan a «sin acceso a la base de usuarios»: sólo entra el
último de cada PC, nadie administra y ninguna PC nueva puede ingresar.

1. Generar el token nuevo (mismos permisos). En `github.ts`: el nuevo a `TOKEN_DATOS`, el viejo a
   `TOKEN_DATOS_ANTERIOR`. Publicar.
2. Esperar a que todas las PCs se actualicen (el historial de commits de `usuarios.json` muestra la
   versión con la que escribe cada una).
3. Revocar el viejo en GitHub y vaciar `TOKEN_DATOS_ANTERIOR` en la versión siguiente.

### Recuperación de emergencia

- **El único superadministrador olvidó la contraseña**: `npm run clave-hash -- "contraseña nueva"`
  imprime el hash; editar `usuarios.json` en github.com, pegar el hash en `claveHash` de ese usuario y
  poner `debeCambiarClave: true`. Nunca borrar `usuarios.json`: si no existe, las PCs lo tratan como
  «la base no está inicializada».
- **Una PC no puede entrar sin internet** («la copia guardada no se pudo leer», se borró `sesion/`, se
  cambió la cuenta de Windows): hace falta un ingreso con internet, nada más.
- **Probar la conexión** sin cerrar sesión: Acerca de → «Probar conexión».

### Qué NO protege esto (decisión de arquitectura, leer antes de confiar en los roles)

El token viaja dentro del instalador, igual que `UPDATE_TOKEN`, y cualquiera que tenga el programa
puede extraerlo y reescribir `usuarios.json` desde afuera (agregarse como SUPER_ADMIN, cambiar
contraseñas, bajar los hashes). **Los roles protegen contra errores, no contra un empleado
malintencionado con el instalador.** Es el precio de una base sin servidor con una sola credencial
compartida; la alternativa (una cuenta de GitHub por persona, o un servicio intermedio) cambia el
alcance. Lo que sí se hace: el repositorio de datos está aparte del código, el token no tiene ningún
otro permiso, cada escritura queda en el historial con quién/dónde/versión, las contraseñas sólo
existen como bcrypt, y la sesión sin internet se arma desde la credencial cifrada y no desde la tabla
local (que cualquiera podría editar con un cliente SQLite).

### En desarrollo y en las pruebas

`npm run dev`, `sembrar` y todos los `humo:*` arrancan en **modo local** (usuarios en la tabla, como
antes) salvo que se defina `DM_GESTION_TOKEN_DATOS`; `DM_GESTION_GITHUB_API` apunta la API a un
simulador local (o a un puerto cerrado, para «cortar internet») y `DM_GESTION_ARCHIVO_DATOS` usa otro
archivo del repo (así `--real` no toca `usuarios.json`). Las tres variables sólo valen en desarrollo.
El simulador de la API Contents está en `scripts/github-simulado.mjs` y lo usan las pruebas y el humo.
