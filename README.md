# DM Gestión

Aplicación de escritorio para Windows de **Seguros Daniel Martínez**.
Electron + React + TypeScript + Vite + Tailwind, con base de datos local SQLite.

**Desde la v12.0.0 el GENERAL DE CLIENTES vive en la base de datos del VPS de la agencia**
(el mismo servidor de dmartinezseguros.com): todas las computadoras sincronizan contra ella y la
hoja de Google dejó de ser la fuente de verdad. Ver «La base en el VPS (Fase 12)», más abajo.

## Comandos

```bash
npm install       # instala dependencias (better-sqlite3 trae binarios listos, no compila nada)
npm run dev       # desarrollo con recarga automática (usuarios locales: sin DM_GESTION_VPS_URL no toca ningún servidor)
npm run prueba    # las pruebas propias, sin tocar ninguna base real ni GitHub
npm run dist      # genera el instalador NSIS en release/, sin publicarlo (para probarlo local)
npm run humo:usuarios            # la base de usuarios compartida contra la app real y un simulador
npm run humo:usuarios -- --real  # lo mismo contra el repositorio real, en un archivo de prueba que se borra al final
```

## Primer ingreso

**En la computadora que inicializa la base compartida** (la primera, una sola vez): al arrancar se crea
el usuario **daniel** con la contraseña **cambiar123** (rol SUPER_ADMIN) y la aplicación obliga a
cambiarla al entrar. Después, desde Administración → Usuarios, el botón **Subir usuarios** publica
los usuarios de esa computadora en el servidor de la agencia (ver «Base de usuarios compartida» más
abajo).

**En cualquier otra computadora**: la primera vez hace falta internet, porque el usuario y la
contraseña se comprueban contra la base compartida. A partir de ahí, el último que ingresó con
conexión puede volver a entrar sin internet durante 30 días.

## Las sucursales

Son **cuatro y sólo cuatro**, y la lista vive en un único lugar: `src/shared/sucursales.ts`.

| Sucursal | Cómo aparece escrita en la hoja |
| --- | --- |
| **Dock Sud** | `DOCK SUD`, `DOCKSUD`, `AVELLANEDA` |
| **Lanús** | `LANUS`, `Lanús` |
| **Sarandí** | `SARANDI`, `Sarandí` |
| **Daniel** | `DANIEL` |

**Dock Sud y Avellaneda son el mismo mostrador**: la agencia lo nombra de las dos maneras y la planilla
escribe cualquiera de las dos. Todo lo que entra —la importación, una consulta cargada a mano, un
cliente nuevo, el usuarios.json de GitHub— se guarda con el nombre de la izquierda, así que el
desplegable ofrece cuatro opciones y no una por cada forma de escribirlas.

Un texto que no sea ninguna de las cuatro **no crea una sucursal nueva**:

- En la hoja se guarda tal cual y queda listado en el informe de importación, bajo «SUCURSALES FUERA DE
  CATÁLOGO». La fila se ve igual; lo único que no tiene es el id del catálogo.
- En el `usuarios.json` de GitHub se rechaza el archivo entero con el nombre que no existe, igual que
  un rol inventado. Antes se creaba la sucursal en esa computadora y sólo en esa, y el mismo mostrador
  terminaba partido en dos.

La comparación se hace **en JavaScript, nunca en el SQL**: `UPPER()` y `COLLATE NOCASE` de SQLite sólo
tocan el ASCII, así que `UPPER('Lanús')` devuelve `'LANúS'` y no empata con el `LANUS` de la planilla.

## Las ramas

Son **siete y sólo siete**, y la lista vive en un único lugar: `src/shared/ramas.ts`. Es cómo vende la
agencia, y es lo que ofrece el filtro «Rama» de la Planilla del mes, Bajas, Pólizas, Deudores y
Segmentos.

| Rama | Cómo puede venir escrita |
| --- | --- |
| **AUTO** | `AUTO`, `AUTOMOVIL`, `SEDAN`, `HATCHBACK`, `COUPE`, `CABRIOLET`, `RURAL`, `MONOVOLUMEN`, `SUV` |
| **MOTO** | `MOTO`, `MOTOCICLETA`, `MOTOVEHICULO` |
| **PICK UP** | `PICK UP`, `PICKUP`, `CAMIONETA`, `DOBLE CABINA` |
| **CAMION** | `CAMION`, `CHASIS`, `TRACTOR`, `VOLCADOR` |
| **SCOOTER** | `SCOOTER`, `CICLOMOTOR` |
| **MOTO ELÉCTRICA** | `MOTO ELÉCTRICA`, `MOTO ELECTRICA` (sin tilde), `MOTO E`, `ELECTRICA` |
| **TRAILER** | `TRAILER`, `ACOPLADO`, `REMOLQUE`, `CASA RODANTE` |

**No es lo mismo que la CATEGORÍA.** La categoría (`CATEGORIAS_DE_VEHICULO`, en `tipos.ts`) la decide
el catálogo de vehículos y tiene quince valores de carrocería (SEDAN, HATCHBACK, SUV, FURGON, MICRO…).
La rama es cómo vende el mostrador, y son estas siete. Una es de la base, la otra es de la agencia.

La rama de una fila se deduce en dos pasos, y el orden importa:

1. **Gana el tipo del riesgo** cuando ya nombra una rama concreta. Es lo que escribió la agencia en la
   hoja (`PICK UP`, `TRAILER`, `MOTO ELECTRICA`) y nadie la conoce mejor que ella.
2. **Afina la categoría** cuando el tipo es genérico. Una pick up cargada desde «Nueva póliza» sale del
   catálogo con `tipo = 'AUTO'` y `categoria = 'PICKUP'`: sin este paso el filtro «Pick up»
   encontraría sólo las que vinieron tipeadas de la hoja, y devolvería cero para la mitad de la
   cartera sin ninguna explicación.

Afinar **nunca cruza familias**: un AUTO puede terminar en PICK UP o CAMION, y una MOTO en SCOOTER,
pero una categoría de moto no convierte a un auto en scooter aunque el dato venga mezclado.

Un vehículo que no es de ninguna de las siete —un `HOGAR`, una `BICICLETA`, un `FURGON`— **no crea una
rama nueva**: se guarda tal cual y el desplegable lo lista aparte, abajo de las siete, para que esa
fila siga teniendo una opción que la traiga. Los sinónimos, en cambio, se pliegan antes de armar la
lista: la base puede tener `CAMIONETA` y el desplegable ofrece «PICK UP» y nada más.

La comparación se hace **en JavaScript, nunca en el SQL**, por lo mismo que las sucursales.

## Los filtros eligen de a varias

Todos los desplegables de filtro de la aplicación guardan una **lista**, no un valor: «Compañías: ATM y
Metropol», «Sucursal: Dock Sud y Daniel». El contrato está en `src/shared/filtros.ts` y es uno solo
para las dos puntas:

- **La lista vacía es «todas»**, que es exactamente lo que quería decir el `''` de antes.
- `listaDeFiltro` acepta también un texto suelto, así que un `filtros_json` guardado con la forma
  vieja —o una computadora a medio actualizar— no se queda sin filtro en silencio.
- El control es `FiltroMultiple` (`src/renderer/componentes/`), un botón con panel de casillas. No es
  un `<select multiple>`: ése se maneja con Ctrl, no dice cuántas hay elegidas y no entra en una barra
  de una línea.

Lo que **no** elige de a varios, y por qué:

- **Los contadores y las pestañas** (Vencen hoy, el estado del cliente, el estado del siniestro): cada
  uno muestra su número, y elegir de a varios haría que el cartel y la tabla dijeran cosas distintas.
- **El selector de mes**: elige qué planilla se está mirando, no filtra dentro de ella.
- **El «Vencimiento» de un segmento de Marketing** (vencidas / esta semana / este mes): es un horizonte
  y sus opciones se contienen unas a otras —«esta semana» está adentro de «este mes»—, así que tildar
  dos no acota nada, sólo confunde.

En los resultados que viajan por IPC, `sucursales` y `companias` son **siempre las opciones** del
desplegable; lo elegido se llama `sucursalesElegidas` y `companiasElegidas`.

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
- `config.json`: credenciales de Google (cuenta de servicio y URL de la hoja; desde la v12 sólo para
  la migración inicial y Drive) y, opcionalmente, un bloque `vps` que pisa la URL o el token del
  puente con el servidor. Nunca va al repositorio.
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

## La base en el VPS (Fase 12)

Desde la **v12.0.0** el bus compartido entre las computadoras ya no es la hoja de Google: es la
**base de datos PostgreSQL del VPS de la agencia**, detrás de los endpoints `/api/dmg` del servidor
de `dmartinezseguros.com` (repositorio `Seguros_Daniel_Martinez`, módulo `server/src/modules/dmg/`).

Cómo funciona, en corto:

- **Nada de la lógica cambió.** El servidor expone la misma semántica de grilla que Google
  (pestañas ordenadas, filas numeradas base 1, celdas de texto) y `FuenteVps`
  (`src/main/vps/fuenteVps.ts`) implementa la misma interfaz `FuenteHoja` de siempre: el motor de
  sincronización, la cola, los conflictos y el importador corren tal cual, sólo cambió el transporte.
  Sin internet se sigue trabajando local y la cola espera, igual que siempre.
- **La URL y el token van embebidos** (`src/main/servicios/config.ts`, mismo criterio que
  `UPDATE_TOKEN`): las PCs se actualizan y quedan conectadas sin configurar nada. El token tiene que
  coincidir con el `DMG_SYNC_TOKEN` del `.env` del VPS, y desde la v12.4 es también el que abre la base
  de usuarios: es una sola puerta para todo lo compartido.
- **Primero se actualizan TODAS las computadoras a la v12, después se migra.** Una PC que siga en
  1.0.x escribe en Google sin ningún aviso, y lo que cargue después de la migración no llega al VPS
  (habría que repetirlo a mano en una PC al día). El ciclo de actualización automática es de hasta
  4 horas; con «Acerca de → Buscar actualizaciones» se adelanta en cada PC.
- **La migración inicial se hace una sola vez**, desde una sola PC, en
  **Administración → Base de datos → «Migrar el GENERAL DE CLIENTES al VPS»** (SUPER_ADMIN, con la
  conexión con Google todavía configurada): lee la hoja completa por última vez, la publica en el
  VPS en tres fases y corre una reimportación de alineación. Hasta que la migración no está hecha,
  la sincronización avisa «la base del VPS todavía no está inicializada» y todo sigue local.
- **Google queda para dos cosas**: la migración (una vez) y Drive (respaldos y adjuntos), mientras
  la cuenta de servicio siga cargada. El respaldo diario ahora se arma desde la base del VPS con el
  generador de `.xlsx` propio; la copia a Drive se mantiene si Google está configurado.
- **La hoja de Google se mantiene «pareja» sola, pero desde el servidor** (12.0.2 / servidor 12.1):
  el VPS refleja cada cambio de la base hacia la hoja (espejo de una sola vía, módulo
  `server/src/modules/dmg/espejo.*` del repo web). El programa NUNCA escribe ni lee la hoja: la
  agencia puede seguir mirándola desde Google como copia de lectura, y lo que alguien escriba a
  mano ahí se pisa en la próxima pasada del espejo.
- **La planilla del mes nuevo se crea sola** (12.0.2): «Cerrar mes» (y la primera baja del mes)
  dejan filas para una pestaña que todavía no existe, y el motor la crea al final de la base
  copiando los encabezados de la pestaña más nueva del mismo tipo (`asegurarPestanasDelMes` en
  `src/main/sincronizacion/pestanasApp.ts`). Hasta la v11 esto era «duplicar la pestaña en
  Google»; ya no hay dónde duplicarla.
- **En desarrollo nunca se toca el VPS real**: sin `DM_GESTION_VPS_URL` la sincronización queda
  apagada (como antes sin credenciales de Google) y el humo corre así, local. Las pruebas del
  transporte usan `scripts/vps-simulado.mjs`, el simulador local del puente (mismo patrón que
  `github-simulado.mjs`); `DM_GESTION_VPS_URL`/`DM_GESTION_VPS_TOKEN` permiten apuntar la app de
  desarrollo a ese simulador.
- **En el servidor**: token compartido por encabezado `Authorization`, Postgres sin exponer a
  internet (todo entra por el 443), y la migración inicial rechazada con 409 si ya se hizo.

Las secciones que siguen («Importar desde Google», «Sincronización con Google») describen mecánica
que sigue existiendo tal cual, pero desde la v12 la fuente es la base del VPS: la pantalla de
importación se llama ahora **Reimportar la base** y el ciclo de subida/bajada habla con el servidor.

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

## La vista: zoom, columnas y barra lateral

Tres preferencias de **interfaz**, todas guardadas en el `localStorage` de **cada computadora** y no en
el usuario ni en la base. Es a propósito: el mismo usuario entra en la notebook de 14" del mostrador y
en el monitor grande de la oficina, y espera que cada máquina se acuerde de lo suyo. Es el mismo
criterio que ya usaba el volumen de los avisos (`src/renderer/sonidos/index.ts`).

Tres archivos, con una responsabilidad cada uno:

- `src/renderer/vista.ts`: las reglas puras —los pasos del zoom, cómo se lee lo guardado, cuánto hay
  que juntar con la rueda para que valga un paso, qué columnas quedan a la vista—. No toca `window`,
  así que se prueba en Node (`pruebas/vista.prueba.ts`).
- `src/renderer/preferencias.ts`: el único que lee y escribe el `localStorage`, y el único que le pide
  el zoom a la precarga.
- `src/renderer/zoom.ts`: el zoom vivo —cuánto está puesto, quién lo cambia y los atajos—, fuera de
  React.

### Zoom (`dm.vista.zoom`)

Nueve pasos, de 70 % a 200 %, en el control «− 100 % +» de la barra superior. Además andan **Ctrl +**,
**Ctrl −**, **Ctrl 0** y **Ctrl + rueda del mouse**.

El valor vive en `zoom.ts` y no en el estado de un componente, por dos motivos concretos:

- Los atajos tienen que andar **también en la pantalla de ingreso y en la de cambiar la contraseña**,
  donde no hay barra superior. Alguien que dejó la pantalla al 175 % y cerró sesión no tiene ningún
  botón a mano: Ctrl 0 es su única salida, y por eso los listeners se instalan en `main.tsx` y no en
  un componente. Es también la salida cuando el zoom es tan grande que el propio control queda fuera
  de la ventana.
- Se cambia desde tres lugares —los botones, el teclado y la rueda—, así que el número que se muestra
  se suscribe al valor en vez de tener el suyo.

**La rueda junta antes de mover.** `Ctrl + rueda` no avanza un paso por evento sino cada 100 px
acumulados (`RUEDA_POR_PASO`). Con el mouse da lo mismo —una muesca ya son ~100 px— pero en el
touchpad de la notebook, que es justamente la máquina del caso, Chromium manda el pellizco como
decenas de eventos de unos pocos píxeles: un paso por evento hacía que un solo gesto recorriera los
nueve pasos y terminara en el extremo.

Lo hace el zoom de Chromium (`webFrame.setZoomFactor`, en la precarga) y **no** una transformación de
CSS. La diferencia importa: los anchos de la tabla virtual están en píxeles y los diálogos se
posicionan con `fixed`, así que escalar por CSS dejaría la planilla igual de ancha y los carteles fuera
de lugar. Con el zoom del navegador entra todo, incluidas las barras de desplazamiento.

Los atajos se manejan en el renderer y no con un menú de Electron porque la versión publicada arranca
sin menú (`Menu.setApplicationMenu(null)` en `src/main/index.ts`), y sin menú Chromium se queda sin los
Ctrl + / − / 0 de fábrica. Se descarta `Alt` a propósito: en el teclado español AltGr es Ctrl + Alt, y
sin esa salida cualquier símbolo escrito con AltGr haría zoom en el medio de una celda. La escala
guardada se aplica en `main.tsx` antes de dibujar: si se aplicara desde un componente, la pantalla
aparecería al 100 % y saltaría.

`webFrame` está disponible en la precarga aunque la ventana corra con `sandbox: true`: en Electron 43
el módulo `electron` que ve una precarga sandboxeada expone `contextBridge`, `crashReporter`,
`ipcRenderer`, `nativeImage`, `sharedTexture`, `webFrame` y `webUtils`, y nada más.

`window.dm.vista` es lo único de la API de la precarga que **no** pasa por IPC. Mandarlo al proceso
principal sería un viaje de ida y vuelta para algo que se toca con la rueda del mouse.

### Columnas (`dm.vista.columnas.<tabla>`)

El botón **«Columnas»** abre un desplegable con una casilla por columna. Lo que se apaga se guarda por
tabla y por computadora. Está en Cartera, Clientes, Pólizas y Mora —que dibujan la tabla con
`TablaVirtual`— y también en Cobranzas → Caja del día, Siniestros, Renovaciones y Presupuestos, que
tienen su `<table>` escrita a mano: ahí el desplegable usa el mismo `useColumnasElegidas` y cada `<th>`
y cada `<td>` se dibuja según las columnas que quedaron a la vista (claves `cobranzas-caja`,
`siniestros`, `renovaciones` y `presupuestos`).

En todas, la columna que dice de quién es la fila —el asegurado, el cliente— va con `siempre: true` y
no se puede apagar, igual que la última de Renovaciones y Siniestros, que es donde están los botones
que cierran el trámite y la marca de que la fila se abre.

**La columna del nombre es la primera y la única fija** (`fija: true`, `siempre: true` en
`ColumnaTabla`): queda pegada a la izquierda al correr la tabla en horizontal y no se puede apagar. La
planilla del mes tenía cuatro columnas fijas —Alerta, Acciones, Sucursal y Nombre, 702 px— que se
comían la pantalla antes de mostrar un solo dato; ahora la fija es una sola, de 240 px, y el resto pasa
por debajo.

Dos reglas que están probadas y conviene no perder:

- Lo guardado se **sanea** contra las columnas que existen hoy. Si una versión le cambia el id a una
  columna, o convierte en obligatoria una que alguien había escondido, lo viejo se descarta en vez de
  esconder un fantasma.
- Si de tanto apagar no quedara **ninguna** columna, se muestran todas. No se llega ahí tocando el
  desplegable (el nombre no se apaga), pero sí editando el `localStorage` a mano: una tabla sin columnas
  es una pantalla de la que no se sale más.

En `TablaVirtual` las columnas fijas se apilan en el orden en que están declaradas y **tienen que ser
las primeras**: una fija declarada después de una suelta se dibujaría encima de otra.

**General Excel** no tiene este botón a propósito: esa pantalla imita una hoja de cálculo (columna A, B,
C, cursor de celda, copiar un rango) y esconder columnas rompería justamente eso.

### Barra lateral (`dm.vista.barraLateral`)

La flecha de arriba de la barra azul la achica de 272 px a una tira de 64 px con sólo los iconos; el
nombre de cada módulo queda en el `title`. Son dos columnas más de la planilla a la vista en la notebook
del mostrador.

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
  `{vencimiento}`) y deja la fila en `ENVIADO` con la fecha; «Avisado» (el tilde) deja exactamente lo
  mismo en la planilla —`ENVIADO`, la fecha de hoy y la fila en AVISADOS HOY— **sin** abrir WhatsApp,
  para cuando ya se avisó por teléfono, en el mostrador o desde el celular (no necesita teléfono
  cargado); «Registrar pago» llena `CUANDO PAGO` y crea el pago; «Avisar rechazo del débito» (el
  triángulo) le manda el aviso a la sucursal del cliente (ver **Rechazos**, más abajo); «Dar de baja»
  pide motivo y nota y mueve la póliza a **Bajas** del mes.
- **Propuesta**: la columna `PROPUESTA`, al lado de `POLIZA`, guarda el número que dan algunas compañías
  antes de emitir. Vive en `polizas.propuesta` (la misma que edita **Pólizas**), así que se ve en la
  ficha del cliente y sigue estando el mes que viene, pero **no se encola**: la hoja no tiene esa
  columna y una entrada sin destino quedaría para siempre en «no se pudo».
- **Filtros**: buscador por nombre, patente, póliza o DNI, y desplegables por sucursal, forma de pago,
  compañía, **tipo de vehículo** (auto, moto, pick up… salen del catálogo `tiposDeVehiculo`) y color de
  alerta, más la casilla «Sólo con AVISAR VTO».
- **Los contadores de arriba filtran**, como en Siniestros, Tareas, Leads y Presupuestos: se toca
  VENCEN HOY, VENCIDOS, AVISADOS HOY, SE LES TERMINA LA COBERTURA o PAGADOS HOY y la tabla queda con
  esas filas (volver a tocarlo, o TOTAL, muestra el mes entero). El número lo calcula la misma
  condición con la que después se filtra, así el cartel y la tabla no pueden discrepar, y los
  contadores siempre cuentan sobre el mes completo aunque haya un filtro puesto: son el tablero del
  día, no un resumen de lo que se está mirando.
- **«Se les termina la cobertura»**, al lado de AVISADOS HOY: las cuotas ya vencidas y sin pago que la
  compañía **todavía** cubre. Son exactamente las que el semáforo pinta 🟡 «Cubierto N d» y 🟠 «Último
  día cob.», o sea `diasParaVencer < 0` y `finCobertura >= hoy`. Es la lista de a quién hay que llamar
  hoy, porque cuando se termina esa ventana el cliente queda sin seguro. Los días los pone cada
  compañía y salen de la misma configuración que el semáforo (ATM 7, RIVADAVIA 7, RÍO URUGUAY 7,
  EUROAMÉRICA 7, GALENO 7, EQUIDAD 5, METROPOL 3), contados desde la fecha de vencimiento. Las pagas y
  las de débito automático no entran: el semáforo no les calcula fin de cobertura.
- **Bajas** (`Cartera → Bajas`): la lista del mes con su propio buscador (nombre, patente, póliza, DNI,
  compañía, sucursal o teléfono). El selector de mes tiene una opción **«Todos los meses»** que junta
  las bajas de cualquier período en una sola lista: es lo que hace falta para encontrar —y reactivar—
  a alguien que se fue hace rato, sin tener que ir mes por mes. Dar de baja **no borra nada**: el
  cliente, el vehículo y la póliza siguen en la base (la póliza pasa a `activa = 0` y la fila del mes
  a `dada_de_baja = 1`).
  - **La baja guarda la foto completa de la fila**, no sólo nombre, DNI, compañía, póliza, patente,
    sucursal y motivo: también teléfono, email, dirección, localidad, vehículo entero (marca, modelo,
    año, motor, chasis, uso, color), cobertura, propuesta, prima, productor, vigencias, alta, cuota,
    día de vencimiento, forma de pago y observaciones. Se guarda en el momento de la baja porque es
    cómo estaba el día que se fue: si la póliza cambia después, la baja tiene que seguir diciendo lo
    de entonces. Haciendo clic en una fila se abre a la derecha ese panel completo.
  - Las bajas **importadas de la hoja** no tienen esa foto, así que lo que falta se completa con
    `COALESCE` desde la póliza, el cliente y el vehículo (`SELECT_BAJAS` en `servicios/cartera.ts`).
    Lo que ni la hoja ni la base tienen, no aparece: no se inventa.
  - **«Poner vigente»** (ADMIN/SUPER_ADMIN) devuelve la póliza a la cartera sin cargarla de nuevo: es
    el cliente que se fue en julio y vuelve en septiembre. Reactiva la póliza, reusa su fila del mes
    abierto si la tiene o le crea una con los últimos datos que tenía, y saca el renglón de la pestaña
    BAJAS de la hoja. El diálogo deja corregir de una vez **compañía, póliza, propuesta, cuota, fecha
    de vencimiento y forma de pago** —lo que haya cambiado mientras el cliente no estaba—; dejar los
    campos como están es no tocar nada. Cada campo se aplica con `editarCelda`, la misma función que
    usa la planilla para editar una celda. Sirve también para las bajas de la hoja, siempre que la
    baja esté enlazada a una póliza (`bajas.poliza_id`); si no lo está —alguien que se fue antes de la
    planilla más nueva, de quien no quedó ninguna póliza cargada— el botón no aparece y el servicio lo
    explica.
  - **«Deshacer»** es otra cosa y sigue igual: el «me equivoqué» del momento, sólo para las bajas
    hechas en la app, que devuelve la fila al mes del que salió.
- **Meses anteriores**: se ven completos, y de sólo lectura para un EMPLEADO; un ADMIN o SUPER_ADMIN los
  sigue viendo de lectura y escritura, para poder corregir algo (un pago mal cargado, una baja que se
  escapó) sin depender de que el mes siga abierto. **Cerrar mes** (ADMIN/SUPER_ADMIN) crea el mes
  siguiente copiando las pólizas activas, igual que duplicar la hoja: conserva cuota, vencimiento, forma
  de pago y observaciones, y vacía el pago y el aviso.

### Rechazos del débito automático (Cartera → Rechazos)

El problema: cuando la compañía rebota un débito, quien se entera **no** es quien atiende al cliente. El
archivo lo mira la administración y al cliente lo conoce su sucursal, así que el aviso viajaba por
WhatsApp suelto y se perdía.

- **Se avisa desde la póliza**: botón «Avisar rechazo del débito» arriba de una póliza (`Pólizas` →
  abrir una) y el mismo botón en la columna «Acciones» de la planilla del mes. Pide a qué sucursal
  avisarle (viene puesta la de la póliza), qué pasó (CBU rechazado, sin fondos, cuenta cerrada, CBU mal
  cargado, tarjeta rechazada, otro) y una nota. El aviso se lleva la foto del cliente y la cuota:
  teléfono, compañía, póliza, patente, forma de pago, cuota y mes.
- **Le llega a la sucursal**, no a una persona: un rechazo lo atiende cualquiera del mostrador. Aparece
  en la **campana del triángulo** de la barra de arriba a todos los que trabajan en esa sucursal, con
  el punto rojo mientras nadie lo abrió. Va aparte de la campana de tareas a propósito: una tarea es de
  una persona.
- **Tres estados**: `PENDIENTE` (nadie lo abrió; es el que enciende el punto), `VISTO` (lo abrieron,
  pero el cobro sigue sin resolverse: abrir la campana no es haber cobrado) y `RESUELTO` (se cobró o se
  corrigió el CBU). Se resuelve desde la campana o desde la pantalla, y «Volver a abrir» lo devuelve a
  pendiente.
- **Apretar el botón dos veces no manda dos avisos**: si esa póliza ya tiene uno sin resolver del mismo
  mes, se actualiza el que hay y vuelve a quedar pendiente.
- **Cómo cruza de una computadora a otra.** Cada sucursal tiene su propia base local, así que el aviso
  viaja por la hoja de Google en la pestaña **APP RECHAZOS**. Es la única de las pestañas que escribe la
  aplicación que además **se lee de vuelta a su tabla** (`guardarRechazo` en `importacion/importador.ts`):
  APP TAREAS también se lee de vuelta (ver **Tareas**); APP LEADS y APP PRESUPUESTOS son de ida nada más, para poder mirarlas
  desde Google. Además es la única pestaña de la app que entra en el **ciclo de bajada de todos los
  días** (`pestanasDeTodosLosDias` en `sincronizacion/motor.ts`): un aviso que tardara hasta la próxima
  bajada completa en aparecer no serviría para llamar a nadie. Lo que la sucursal avisada cambia
  después —el estado y la nota— vuelve por la bajada normal (`DESTINOS.APP_RECHAZOS` en `bajada.ts`).
- **`rechazos_debito.estado` no tiene `CHECK` ni `NOT NULL`**, igual que `pagos.resultado`: esa columna
  viaja a la hoja, donde cualquiera puede escribir «resuelto» en minúscula o vaciar la celda. Se guarda
  lo que venga y lo normaliza el servicio; una restricción ahí rompería la bajada.
- **Quién puede qué**: avisar pide edición en Pólizas o en Cartera; mirar los avisos y darlos por
  resueltos, cualquiera de los dos módulos a la vista (es la sucursal la que atiende, no un
  administrador).

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
  revisa en ~400 ms con **3 llamadas**. Las filas que alguien cargó a mano en Google se incorporan con
  la importación completa, que es la que les escribe el `_ID` en la hoja.
- **Bajas**: la fila se agrega a la pestaña «BAJAS …» y se elimina de la planilla del mes, igual que el
  cortar y pegar de siempre. **Los borrados esperan un minuto antes de subir** (`ESPERA_DE_AGRUPADO_MS`)
  y, cuando sale uno, viajan con él todos los que estén esperando: borrar una fila en Google corre las
  de abajo y obliga a recalcular la planilla entera, así que dando de baja pólizas una atrás de otra la
  hoja se reestructuraba una vez por baja y se le trababa a quien tuviera «el general» abierto. Ahora
  las bajas de una misma seguidilla se aplican juntas, y las filas contiguas van en un solo
  `deleteDimension` (`tramosDeFilas`). «Sincronizar ahora» no espera: `apurarAgrupadas()` las larga en
  el momento.
- **Sin internet**: todo sigue funcionando, la cola espera y se vacía sola al volver la conexión. El
  indicador de la barra superior muestra verde «Sincronizado hace X», amarillo «N cambios por subir» o
  rojo «Sin conexión — trabajando local».
- **Conflictos**: antes de bajar se vacía la cola, y la fila que igual no llegó a subir queda afuera de
  esa bajada, así lo más reciente no se pisa. El resto de la hoja se actualiza igual: un cambio trabado
  no deja a toda la aplicación sin novedades. Si un mismo campo cambió de los dos lados, el que pierde
  queda en `historial` marcado como «pisado por sincronización» y aparece en los movimientos de la
  pantalla de Sincronización.
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

#### Buscar clientes

El botón **«Buscar clientes»** del listado abre la ventana que arma la lista de a quién hay que
cobrarle. Se tilda lo que haga falta y la lista se rehace sola:

- **Todos | Vencidos | Pagos**, arriba de todo: un toque que separa a las que ya pasaron su fecha de
  vencimiento de las que se cobran solas (débito, CBU, tarjeta, Mercado Pago) y no hay que llamar.
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
- **Alta y edición en una sola pantalla**: cliente (buscador), riesgo asegurado (uno de los del cliente
  o uno nuevo), compañía, cobertura, forma de pago, cuota, día de vencimiento, número de póliza o
  propuesta, vigencia, AVISAR VTO y observaciones. Compañía, cobertura y forma de pago sugieren lo que
  ya se usa pero dejan escribir cualquier cosa, como la planilla.
- **El riesgo no siempre es un auto.** «Cargar uno nuevo» arranca por el tipo (`TIPOS_DE_RIESGO` en
  `shared/tipos.ts`) y pide sólo lo que ese riesgo necesita:
  - **Auto / Moto**: como siempre (catálogo, patente, uso, color, motor, chasis). Son los únicos que
    van a la validación de antigüedad y los únicos con cobertura obligatoria.
  - **Bicicleta**: marca y número de cuadro (se guarda en `vehiculos.chasis`).
  - **Accidente personal**: las personas cubiertas, cada una con nombre completo y DNI (viene puesto el
    cliente como titular y se agregan las demás). Se guardan como JSON en `vehiculos.integrantes`.
  - **Hogar** e **Integral de comercio**: la dirección del riesgo (`direccion_riesgo`) y a nombre de
    quién está (`titular_nombre`).
  - **Otros**: nombre y DNI de la persona (`titular_nombre`, `titular_documento`).
  Todo vive en la tabla `vehiculos` (migración 19), que pasó a ser «los riesgos del cliente»: `tipo`
  dice qué es y `shared/riesgos.ts` lo nombra en una línea («Hogar · Mitre 1234») para el formulario,
  la ficha del cliente y el listado. A la planilla del mes viajan las columnas que ya existen (TIPO,
  MARCA, CHASIS…); la dirección y los integrantes no tienen columna en la hoja y quedan en la base.
- **Advertencia de antigüedad**: apenas están cargados compañía, cobertura y año del vehículo se
  compara contra la matriz de reglas y, si el vehículo es más viejo de lo que esa compañía acepta,
  aparece el aviso en el momento (por ejemplo: «SANCOR no acepta TERCEROS COMPLETO para un vehículo
  modelo 1995 (31 años de antigüedad): toma desde el modelo 2011»). Se puede continuar igual sólo con
  la confirmación de un ADMIN o SUPER_ADMIN, y queda anotado en el historial.
- La validación **degrada bien a propósito**: sin regla cargada para esa combinación, sin límite en la
  regla, o con el año del vehículo ilegible, no se advierte nada y la póliza se guarda normal.
- **«Avisar rechazo del débito»**, arriba de una póliza ya cargada: le manda el aviso a la sucursal que
  atiende al cliente para que lo llame y lo cobre a mano. Aparece también en las pólizas dadas de baja
  (al que anularon por falta de pago igual hay que llamarlo, y la baja suele ser la consecuencia del
  rechazo). Ver **Rechazos del débito automático**, más arriba.
- **«Dar de baja»** guarda la foto completa de la póliza en `bajas` y la manda a `Cartera → Bajas`. Si
  el cliente vuelve, «Poner vigente» la devuelve a la cartera sin cargarla de nuevo.

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
- **Sólo lo que se renueva a mano.** La mayoría de las compañías renueva sola; las que no, tienen
  cargado cada cuántos meses en `companias.meses_renovacion` (**Administración → Compañías**, columna
  «Renovación (meses)»): AGROSALTA 4, RIO URUGUAY / RUS 6, METROPOL 12, que vienen de fábrica y se
  cambian desde ahí. Vacío = renueva sola. La bandeja arranca mostrando sólo ésas —el desplegable
  «Todas las compañías» muestra el resto— y los contadores de arriba cuentan sobre lo que hay que
  trabajar, no sobre la cartera entera.
- Por fila: **responsable** (un usuario), **estado del trámite** (pendiente / en gestión / renovada / no
  renueva) y **nota**. El seguimiento no se crea hasta que alguien toca la fila: abrir la bandeja no
  escribe en la base.
- **Etiqueta destacada** cuando las observaciones piden aumentar al renovar. Se reconoce la idea, no el
  texto exacto: «20% aumentar cuando se renueva», «aumentar 20 % al renovar» y «SUBE 15% EN LA
  RENOVACION» valen igual.
- **Renovar** crea la vigencia nueva y deja la anterior como histórica, enganchada por
  `poliza_anterior_id`. No se le inventa una baja con motivo: no se dio de baja, se renovó. Propone
  todo editable: la vigencia corrida por los meses de la compañía (cuatro en Agrosalta, seis en Río
  Uruguay, doce en Metropol) y la cuota anterior —ya aumentada si las observaciones lo piden—, más el
  número de póliza y el de propuesta. Cuando la compañía no tiene plazo cargado, el plazo se deduce de
  la vigencia que está terminando —«igual eso lo dice la fin de vigencia»— siempre que dé uno de los
  habituales (3, 4, 6 o 12 meses); si no, un año.
- **No renueva** da de baja la póliza con el motivo elegido y cierra el trámite.

Todo respeta los roles y escribe en `historial` y en `cola_sync`, así que los cambios suben a la hoja
como cualquier otro.

### Probar la Fase 5

```bash
npm run sembrar -- <carpeta>       # arma una carpeta de datos con la hoja simulada ya importada
npm run humo:fase5 -- <carpeta>    # abre la app de verdad y recorre los cuatro criterios (24 pasos)
npm run humo:deudores -- <carpeta> # los estados del listado y «Buscar clientes», con exportación (18 pasos)
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
- **Quién ve qué caja es una regla de rol** (12.2): SUPER_ADMIN y ADMIN eligen cualquier sucursal o
  «Todas»; un EMPLEADO ve la caja de su mostrador y el desplegable queda fijo. Dos personas de la misma
  sucursal se ven entre sí (lo que cobra una aparece en la caja de la otra, ver «Los pagos viajan por
  APP PAGOS», más abajo). Lo mismo rige en Imputados: un empleado rinde sólo lo cobrado en su sucursal.
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

- **Los pagos que cobra la aplicación se agregan a la pestaña de pagos de la base.** Si no, el mes
  siguiente la rendición mostraría sólo lo que alguien cargó a mano, y la caja del día de las otras
  computadoras no los vería nunca.
- **Los pagos viajan por «APP PAGOS» (12.2).** La pestaña IMPUTADOS de la hoja real NO es una tabla por
  fila (es una matriz de resumen con años y totales), y hasta la 12.1 eso dejaba cada pago sólo en la
  computadora que lo cobró: en Lanús, lo que registraba un mostrador no aparecía en el otro. Ahora,
  cuando la base no tiene una IMPUTADOS que sea una tabla, la aplicación crea sola la pestaña
  **APP PAGOS** al final (como APP RECHAZOS) y los pagos van y vuelven por ahí, con la sucursal donde
  se cobró y quién cobró (`COBRADO POR`). Si la agencia tiene una IMPUTADOS por fila, se sigue usando
  ésa. Los pagos de antes de la 12.2 que nunca salieron de su computadora se encolan solos la primera
  vez que arranca la sincronización (`subirPagosRezagados`, en `pagos.ts`).

### Pago adelantado y cobro imputado (12.3)

Las dos cosas que «Registrar pago» pregunta además de fecha, importe y medio (el mismo formulario en
la Planilla del mes, en la ficha del cliente y en la Caja del día; ver `OpcionesDelPago.tsx`):

- **Qué cuota se paga.** Lo normal es la de este mes. Si el cliente viene a pagar dos cuotas el mismo
  mes, se elige «la de este mes y la del mes que viene» (o «sólo la del mes que viene», si ésta ya
  estaba paga). El adelanto es otro pago en `pagos`, con `_ID` fijo `PAGO:ADELANTO:<fila>` (adelantar
  dos veces corrige, no duplica), con el **período del mes que viene** (se rinde en el mes que paga y
  en la hoja viaja con MES y año: «SEPTIEMBRE 2026») y con `adelanto_modo`:
  - `ACREDITAR`: cuando **Cerrar mes** arme el mes siguiente, esa fila nace paga, con la fecha del cobro
    en CUANDO PAGO, y el pago queda apuntándola (`cuota_fila_id`).
  - `PENDIENTE`: la fila nace sin pagar y en violeta («Adelanto sin imputar»), con el contador
    «Adelantos sin imputar» y un botón de calendario que la imputa a mano (`imputarAdelanto`). Hasta
    entonces la fila **no** figura paga: es lo que pidió la agencia para controlar el general del mes.
- **El estado del cobro: PAGO o IMPUTADO.** Con AGS en Dock Sud primero se le imputa la cuota a la
  compañía (la paga la agencia) y el cliente transfiere después. Un pago `IMPUTADO` (`estado_cobro`)
  **no** escribe CUANDO PAGO, no suma a la caja del día ni a las métricas, y la fila queda en violeta
  («Imputado · falta cobrar»), en el contador «Imputados a cobrar» y en Mora con la marca. Cuando el
  cliente paga se vuelve a registrar como «Pagó» sobre la misma fila (mismo `_ID`, mismo pago) y recién
  ahí queda paga y suma en el día que pagó. El estado viaja por la columna **COBRO** de APP PAGOS, que
  se escribe sólo cuando hay algo que decir (un IMPUTADO, o un IMPUTADO que pasó a PAGO): una APP
  PAGOS armada antes de la 12.3 no la tiene, y así no avisa «columna faltante» por cada pago común.
  Para que el estado llegue a las otras computadoras en una hoja vieja, agregarle a mano la columna
  `COBRO` a APP PAGOS.

La condición «esta cuota tiene un pago que la cubre» (mora, deudores, métricas, ficha del cliente)
vive en un solo lugar, `PAGO_QUE_CUBRE_LA_CUOTA` en `pagos.ts`, y un IMPUTADO no cuenta.

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
  sí. Abrirla cuenta como enterarse.
- **El círculo rojo del menú**: el módulo «Tareas» de la barra lateral lleva un globito rojo con el
  número de pendientes en blanco. Con la barra achicada a iconos va pegado al icono, arriba a la
  derecha; con la barra ancha, al final del renglón. Sale del mismo contexto que la campana
  (`contexto/Tareas.tsx`), así que los dos números no se pueden contradecir, y lo que dice el círculo
  también va en el `title` y en el `aria-label`, porque un lector de pantalla no ve un globito.
- **Se asignan entre cualquiera**: la lista de responsables son todos los usuarios activos, sin mirar el
  rol. Un empleado le puede anotar una tarea al superadministrador y al revés; lo único que se rechaza
  es un responsable que no existe o que está dado de baja.
- **Llegan en el momento**: además de la bajada de los cinco minutos, el motor tiene un **carril rápido**
  que cada 30 segundos baja una sola pestaña, APP TAREAS (`ciclarTareas` en `sincronizacion/motor.ts`).
  Cuando trae algo emite `tareas:cambiaron`, y con ese aviso se vuelven a pedir la campana, el círculo
  del menú, el listado del módulo y las tareas de Inicio, sin esperar a ningún reloj. El carril rápido
  no toca la marca de «última bajada» ni dispara la importación completa: es una pestaña sola, no la
  bajada de la aplicación.
- La que uno se pone a sí mismo **no** enciende su propia campana.

### Las pestañas nuevas de la hoja

Leads, presupuestos, tareas y los avisos de rechazo del débito no existen en el Excel de la agencia.
Para que igual se puedan mirar desde Google, DM Gestión crea **«APP LEADS»**, **«APP PRESUPUESTOS»**,
**«APP TAREAS»**, **«APP RECHAZOS»** y **«APP PAGOS»** al final del archivo, con sus encabezados, **la
primera vez que hay algo que subir a alguna de ellas**.

- Se crean tarde a propósito: una hoja de una agencia que todavía no cargó ni un lead no tiene por qué
  llenarse de pestañas vacías.
- Se crean **al final**, nunca en el medio: el orden de las pestañas es lo que usa el importador para
  deducir el año de las planillas mensuales que no lo dicen en el título.
- APP LEADS y APP PRESUPUESTOS van en un solo sentido (la aplicación escribe, la hoja mira). Sus filas quedan
  anotadas como conocidas igual que las de cualquier otro módulo, así que volver a importar no las
  duplica ni dispara una importación completa.
- **«APP RECHAZOS» y «APP PAGOS» van en los dos sentidos**: se leen de vuelta (a `rechazos_debito` y a
  `pagos`) y entran en el ciclo de bajada de todos los días, porque son el camino por el que un aviso o
  un pago cargado en una sucursal llega a la computadora de la otra. Ver **Rechazos del débito
  automático** y **Cobranzas e Imputados**, más arriba.
- **«APP TAREAS» también se lee de vuelta** desde la v12.4: entra en el ciclo de todos los días y además
  tiene el carril rápido de 30 segundos, que es lo que hace que una tarea asignada desde otra sucursal
  aparezca en el momento. Ver **Tareas**, más arriba.
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

## Base de usuarios compartida (Fase 11, mudada al VPS en la v12.4)

Los usuarios ya no viven en cada computadora: viven en **el VPS de la agencia**, en el mismo servidor
que el GENERAL DE CLIENTES y detrás del mismo puente `/api/dmg` (endpoints `GET`/`POST
/api/dmg/usuarios`). Un usuario creado en una PC entra en todas; desactivarlo o cambiarle la
contraseña vale para todas. Código: `src/main/usuarios/` (documento, cliente del VPS, cliente de
GitHub, credencial cifrada, espejo local) y `src/main/servicios/baseDeUsuarios.ts` (la orquestación).

### Por qué se mudó, y qué pasó con GitHub

Hasta la v12.3 el documento era **`usuarios.json` del repositorio privado
`zeroframe404/dm-gestion-datos`**, y para llegar a él cada computadora llevaba embebido en el `.exe` un
token con permiso de **escritura** sobre ese repositorio. Andaba, pero repartía una credencial de
GitHub por máquina para leer un archivo que desde la v12 ya podía viajar por el puente que lleva la
cartera entera. Cinco computadoras con un token de escritura es una superficie que no hacía falta
tener.

`AlmacenGitHub` sigue en el código, pero como **semilla de la mudanza y nada más**: la primera
computadora que abre el programa después de actualizar encuentra el VPS sin documento, lee el
`usuarios.json` del repositorio y lo sube tal cual (`AlmacenVps.mudarDesdeLaSemilla`). De ahí en más
manda el VPS y GitHub no se vuelve a tocar. Es automático a propósito: pedirle a alguien que apriete un
botón de migración es pedirle que se acuerde de hacerlo **antes** de que otro intente ingresar.

Cuando la agencia ya esté migrada (Acerca de → «Base de usuarios» dice «Compartida · VPS
dmartinezseguros.com»), se vacía `TOKEN_DATOS` en `src/main/usuarios/github.ts`, se revoca el token en
GitHub y se publica con `--sin-base-de-usuarios`. El repositorio `dm-gestion-datos` queda como copia
histórica.

**El `sha` ahora es una versión.** Lo único que cambia para el servicio de usuarios: en GitHub era el
hash del blob y acá es el número de versión que devuelve el servidor. Sigue siendo opaco y sigue
haciendo lo mismo —el candado optimista—, así que `baseDeUsuarios.ts` no se enteró de la mudanza.

**En el servidor** (`Seguros_Daniel_Martinez`): tabla `dmg_usuarios`, una sola fila con el documento
entero cifrado con AES-256-GCM (la misma llave que los ajustes compartidos: `DMG_AJUSTES_CLAVE`, o el
`DMG_SYNC_TOKEN` si no está). Adentro hay hashes de bcrypt, que ya son hashes, pero es la lista de
quién entra a la agencia y un `pg_dump` no tiene por qué llevarla en claro.

### Cómo funciona

- **Con internet**, cada ingreso lee el documento del servidor, refresca el espejo local y compara la
  contraseña contra el hash bcrypt del documento.
- **Sin internet** entra sólo el **último usuario que ingresó con conexión en esa PC**, con la credencial
  cifrada (`credencial.bin`) y por 30 días. Los demás ven «Sin internet. En esta computadora sólo puede
  ingresar «daniel»…». Con la sesión abierta, cada 2 minutos se intenta confirmar contra el servidor; al
  confirmarse desaparece «Ingresaste sin internet» de la barra. Si en el medio lo desactivaron o le
  cambiaron la contraseña desde otra PC, la sesión se cierra con un aviso.
- **Administrar usuarios exige internet y una sesión confirmada**: crear, editar, desactivar y resetear
  se escriben en el servidor con el candado optimista de la versión (si otra PC escribió en el medio, se
  relee y se vuelve a aplicar; si la escritura se cortó sin respuesta, se relee y se comprueba si quedó).
  Cada escritura guarda su mensaje —quién, desde qué PC y con qué versión del programa—, el mismo texto
  que antes iba al mensaje del commit.
- **Un usuario nuevo** entra con la contraseña temporal que le puso el administrador y tiene que
  cambiarla con internet; hasta entonces no se guarda credencial para entrar sin conexión.
- Si el archivo está roto o no tiene ningún superadministrador activo, **no se refleja** (el espejo
  anterior se conserva) y el ingreso cae a la credencial guardada con el error a la vista del SUPER_ADMIN.

### Puesta en marcha

En una agencia que ya venía con la base en GitHub **no hay nada que hacer**: la primera computadora que
abra la v12.4 muda el documento sola. Lo único que hay que comprobar después es que Acerca de → «Base
de usuarios» diga «Compartida · VPS dmartinezseguros.com».

En una instalación desde cero:

1. En el `.env` del VPS tiene que estar `DMG_SYNC_TOKEN` (el mismo del puente de la cartera) y conviene
   fijar `DMG_AJUSTES_CLAVE`, que es la llave con la que se cifran el documento y los ajustes. Rotar el
   `DMG_SYNC_TOKEN` sin haber fijado antes `DMG_AJUSTES_CLAVE` deja los dos ilegibles.
2. Correr la migración de Prisma (`dmg_usuarios`).
3. En la computadora que tiene los usuarios de verdad, abrir el programa, ingresar y en
   **Administración → Usuarios → Subir usuarios**. Eso crea el documento. No se hace solo a propósito:
   una PC recién instalada subiría la semilla `daniel/cambiar123` y pisaría a los de verdad. Si la única
   cuenta es `daniel` con la contraseña inicial, primero hay que cambiarla.
4. Comprobar: Usuarios dice «Los usuarios se guardan en la base compartida…», y Acerca de → «Base de
   usuarios» dice «Compartida · VPS dmartinezseguros.com — última comprobación recién». Las demás PCs, al
   actualizarse, ingresan directo contra el servidor (su `daniel` local queda enganchado al de la base;
   los usuarios locales que no estén en la base quedan desactivados, sin contraseña).

### Rotar el token

El token del puente es uno solo y ya existía: se cambia en `VPS_TOKEN` (`src/main/servicios/config.ts`)
y en el `DMG_SYNC_TOKEN` del `.env` del servidor, y tienen que cambiar los dos a la vez. **Antes de
rotarlo hay que fijar `DMG_AJUSTES_CLAVE`** con el valor viejo, o el documento de usuarios y los ajustes
compartidos quedan cifrados con una llave que ya no se deriva de nada.

El token de GitHub (`TOKEN_DATOS`) ya no se rota: cuando la agencia terminó de migrar se vacía y se
revoca. Mientras tanto sólo lo usa la mudanza, y el programa no avisa más de su vencimiento porque el
del puente no vence.

### Recuperación de emergencia

- **El único superadministrador olvidó la contraseña**: `npm run clave-hash -- "contraseña nueva"`
  imprime el hash; hay que pegarlo en `claveHash` de ese usuario dentro del documento y poner
  `debeCambiarClave: true`. Como en el VPS el documento está cifrado, se edita desde el servidor: bajarlo
  con `GET /api/dmg/usuarios` (con el `DMG_SYNC_TOKEN` como Bearer), cambiar el hash y devolverlo con
  `POST /api/dmg/usuarios` mandando el mismo `shaPrevio` que trajo la lectura. Nunca borrar la fila: si
  no existe, las PCs lo tratan como «la base no está inicializada».
- **Una PC no puede entrar sin internet** («la copia guardada no se pudo leer», se borró `sesion/`, se
  cambió la cuenta de Windows): hace falta un ingreso con internet, nada más.
- **Probar la conexión** sin cerrar sesión: Acerca de → «Probar conexión».

### Qué NO protege esto (decisión de arquitectura, leer antes de confiar en los roles)

El token del puente viaja dentro del instalador, igual que `UPDATE_TOKEN`, y cualquiera que tenga el
programa puede extraerlo y reescribir el documento desde afuera (agregarse como SUPER_ADMIN, cambiar
contraseñas, bajar los hashes). **Los roles protegen contra errores, no contra un empleado
malintencionado con el instalador.** Es el precio de una sola credencial compartida entre las cinco
computadoras; la alternativa (una cuenta por persona contra el servidor) cambia el alcance.

Lo que sí mejoró con la mudanza: ya no hay un token de **GitHub** con permiso de escritura repartido por
máquina, así que el peor caso es reescribir el documento de usuarios y no tocar un repositorio. Y lo que
se mantiene: el token del puente no sirve para nada más que el puente, cada escritura guarda
quién/dónde/versión, las contraseñas sólo existen como bcrypt, el documento se guarda cifrado en el
servidor, y la sesión sin internet se arma desde la credencial cifrada y no desde la tabla local (que
cualquiera podría editar con un cliente SQLite).

### En desarrollo y en las pruebas

`npm run dev`, `sembrar` y todos los `humo:*` arrancan en **modo local** (usuarios en la tabla, como
antes) salvo que se defina `DM_GESTION_VPS_URL`, que es la misma variable con la que se apunta la
cartera al simulador: nunca al VPS de verdad. `DM_GESTION_VPS_TOKEN` cambia el token (por defecto, el
del simulador). Para la semilla de GitHub siguen valiendo `DM_GESTION_TOKEN_DATOS`,
`DM_GESTION_GITHUB_API` (un simulador local, o un puerto cerrado para «cortar internet») y
`DM_GESTION_ARCHIVO_DATOS` (otro archivo del repo, así `--real` no toca `usuarios.json`). Todas sólo
valen en desarrollo. Los simuladores están en `scripts/vps-simulado.mjs` y `scripts/github-simulado.mjs`,
y los usan las pruebas y el humo.

## Lo que se carga una vez y lo tienen todas (los ajustes compartidos)

Hasta la v12.3, la configuración de los servicios externos vivía en el `config.json` de cada
computadora y el encabezado del ticket en la base local de cada una. Eso significaba ir máquina por
máquina, y con que **una** quedara sin cargar esa sucursal trabajaba distinto sin que nadie se
enterara: la que no tenía la cuenta de Google no subía los adjuntos de los siniestros, la que no tenía
la app de Meta no podía publicar, la que tenía otra dirección de vuelta fallaba el login de Facebook
con un mensaje que no explica nada, y la que tenía el teléfono viejo imprimía comprobantes con un
número que ya no atiende nadie.

Desde la v12.4 todo eso viaja por el **puente de ajustes del VPS** (`src/main/servicios/ajustesCompartidos.ts`):
se carga una vez, el servidor lo guarda cifrado y el resto de las computadoras lo adopta sola al
arrancar.

| Qué | Dónde se carga | Quién lo carga |
| --- | --- | --- |
| Catálogo de vehículos (InfoAuto, Mercado Libre, DNRPA) | Administración → Catálogo de vehículos | Superadministrador |
| Conexión con Google (Drive: respaldos y adjuntos) | Administración → Google Drive | Superadministrador |
| App de Meta y **la dirección de vuelta** | Administración → Redes sociales | Superadministrador |
| Catálogo de compañías y la plantilla del aviso | Administración → Compañías | Administrador o superadministrador |
| Encabezado del ticket (dirección y teléfono) | Administración → Impresora | Cualquier rol, **el de su sucursal** |
| Las cuatro listas del módulo Compañías | Compañías → «Publicar para todas» | Superadministrador |

Tres reglas que ordenan todo esto:

1. **Guardar es guardar para todas.** No hay un segundo botón de «publicar» (salvo en el módulo
   Compañías, donde las listas son largas y se cargan de a poco): apretar «Guardar» escribe acá y sale
   para el servidor en el mismo movimiento.
2. **Que el servidor no conteste no deshace el guardado.** Lo local quedó bien escrito; el motivo
   vuelve en `compartido.error` y la pantalla lo muestra con el aviso de que el resto todavía no se
   enteró. Se reintenta guardando de nuevo.
3. **La adopción del arranque no pisa lo que se cargó acá y no llegó a viajar.** Cada computadora
   recuerda la huella de lo último que sincronizó (`ajuste_sincronizado_<clave>` en `configuracion`); si
   lo que tiene hoy no es esa huella, hay un cambio local sin publicar y el arranque lo respeta. Sin esa
   regla, el teléfono corregido con el servidor caído desaparecía a la mañana siguiente.

**El encabezado del ticket tiene una vuelta más.** Es el único que escriben todos, y cada uno ve sólo el
renglón de su sucursal. Si Lanús publicara la lista entera tal como la tiene guardada, mandaría también
su copia de la dirección de Dock Sud —que puede ser vieja— y borraría la corrección que Dock Sud hizo
esta mañana. Así que al publicar se lee lo que hay en el servidor y se le reemplaza **sólo** el renglón
de la sucursal de quien está guardando (`publicarEncabezadoDelTicket`). El superadministrador es la
excepción: ve las cuatro, así que lo que tiene en pantalla es lo que manda.

**La huella.** El servidor y cada computadora se comparan por el SHA-256 del JSON del valor, así que el
**orden de las claves importa** y por eso está escrito a mano en cada `valorCompartidoDe…`: dos objetos
con los mismos datos en distinto orden darían huellas distintas y la pantalla diría «desactualizada»
para siempre. Por lo mismo, las listas (compañías, direcciones) viajan ordenadas por una clave estable.

## Permisos por rol (Administración → Permisos)

Los tres roles siguen siendo los mismos (EMPLEADO, ADMIN, SUPER_ADMIN), pero ahora **qué ve y qué toca
cada uno se configura**, módulo por módulo, desde **Administración → Permisos** (sólo SUPER_ADMIN).

- Una fila por módulo (13: Cartera, Clientes, Leads, Presupuestos, Pólizas, Renovaciones, Siniestros,
  Cobranzas, Métricas, Reportes, Marketing, Tareas y Administración) y una columna por rol configurable
  (ADMIN y EMPLEADO). Cada cruce vale **`ninguno`** (el módulo no aparece en la barra lateral y sus
  llamados se rechazan), **`ver`** (se abre y se consulta, pero los botones que cambian algo quedan
  apagados) o **`editar`** (como siempre).
- **El SUPER_ADMIN no está en la matriz**: siempre tiene todo. Si pudiera sacarse permisos a sí mismo,
  la agencia se quedaría sin nadie que pueda devolvérselos.
- **Inicio y «Acerca de» no se configuran**: Inicio es la pantalla que queda cuando alguien no tiene
  ningún módulo, y «Acerca de» tiene la versión y el estado del acceso, que es lo primero que se
  pregunta cuando algo falla.
- **La matriz sólo restringe.** Todo lo que ya pedía rol lo sigue pidiendo: cerrar el mes, deshacer una
  baja, ver las comisiones, borrar un documento de un siniestro o de una tarea, cargar la matriz de
  coberturas, tocar las plantillas de Marketing y administrar usuarios siguen siendo de ADMIN o
  SUPER_ADMIN aunque a un empleado se le dé «ver y editar» en ese módulo.
- **Los valores por defecto son exactamente lo que hacía el programa antes**: ADMIN en `editar` en todo
  y EMPLEADO en `editar` en todo menos Administración, que arranca en `ninguno`. Una agencia que no
  entre nunca a esta pantalla no nota ninguna diferencia.

### Dónde vive la matriz

Va en el mismo **`usuarios.json` de GitHub** que los usuarios (campo `permisos`), porque tiene que valer
igual en todas las computadoras: se configura una vez y el resto la toma la próxima vez que lee el
archivo (la revalidación de la sesión, cada 15 minutos, o el ingreso siguiente). Se escribe por el mismo
camino que cualquier otro cambio de usuarios —lectura, aplicación y escritura con el candado del `sha`—
y cada cambio queda además en el `historial` local con quién lo hizo y qué cambió.

Cada lectura del archivo deja una copia en la tabla `configuracion` (`permisos_roles`). Esa copia es la
que rige cuando todavía no se pudo leer GitHub: al arrancar sin internet o al ingresar con la credencial
guardada, valen los permisos del último ingreso con conexión. Sin base compartida (desarrollo, o antes
de subir los usuarios) la copia local es la fuente de verdad, y sube con los usuarios al inicializar la
base compartida.

Código: `src/shared/permisos.ts` (áreas, niveles y valores por defecto; puro y compartido),
`src/main/servicios/permisos.ts` (qué rige ahora, `exigirVista`/`exigirEdicion` y el guardado),
`src/main/servicios/copiaDePermisos.ts` (la copia en `configuracion`) y
`src/renderer/contexto/Permisos.tsx` (lo que usa la interfaz para mostrar u ocultar).

> **Al actualizar las PCs:** el formato del archivo sigue siendo el 1 a propósito, así una versión
> anterior del programa lo sigue leyendo. Lo que una versión anterior **no** puede es conservar el campo
> `permisos` cuando escribe: si una PC sin actualizar da de alta o edita un usuario, la matriz vuelve a
> los valores por defecto y hay que volver a guardarla desde una PC al día. Con la actualización
> automática de la Fase 10 esto dura horas, pero conviene tenerlo presente el día que se publica.

### Quién controla qué

El renderer **no decide permisos**: sólo evita ofrecer botones que van a fallar. Cada canal IPC vuelve a
pedirlos en `src/main/ipc.ts` (`exigirVista('cartera')`, `exigirEdicion('siniestros')`…). Los canales que
alimentan a más de un módulo admiten el permiso de cualquiera de ellos, porque las pantallas se cruzan:
el formulario de póliza busca clientes, la ficha del cliente cobra una cuota de la planilla y la
rendición de Imputados se mira desde Cartera y desde Cobranzas.

### Probarlo

```bash
npm run prueba                      # pruebas/permisos.prueba.ts: valores por defecto, recortes,
                                    # copia local, matriz compartida y compatibilidad hacia atrás
npm run sembrar -- "C:\dm-humo"     # carpeta con datos y una empleada («lucia», misma clave inicial)
npm run humo:permisos -- "C:\dm-humo"
```

El humo de permisos hace el recorrido completo: el superadministrador deja al empleado con Cartera en
«sólo ver» y Marketing y Clientes en «sin acceso», entra la empleada y se comprueba que esos módulos
desaparecieron de la barra, que la planilla abre en sólo lectura con las acciones apagadas y sin «Cerrar
mes», que Administración sigue abriendo con «Acerca de», y que el proceso principal rechaza igual la
edición y el acceso aunque se llame al canal a mano (incluida el alta de clientes, que no se cuela por el
permiso de Leads). Después asciende a esa usuaria a ADMIN con Administración en «sólo ver» y comprueba
que las secciones del módulo se ven con los campos apagados. Al final deja los permisos y el rol como
estaban, aunque algún paso haya fallado.

## Compañías (las cinco listas del mostrador)

Un módulo nuevo en la barra lateral, con las cinco cosas que hoy viven en un cuaderno, en una captura de
WhatsApp o en la cabeza del que atiende hace diez años. **No es el catálogo de compañías de
Administración**: aquél guarda los días de cobertura financiera y la comisión, que son cosas de la
agencia. Esto es lo que ofrece cada compañía, y lo mira todo el equipo que atiende.

| Pestaña | Qué contesta |
| --- | --- |
| **Organizadores** | A quién hay que escribirle para pedir precio, en el orden en que se le escribe. |
| **Precios** | Cuánto sale cada cobertura en cada compañía, con la más barata arriba. |
| **Antigüedad** | Se pone el año del vehículo y sale, compañía por compañía, qué le pueden vender. |
| **Grúas** | Cuántos kilómetros de remolque da cada compañía en cada cobertura. |
| **Cobertura** | Qué ampara cada cobertura y qué deja afuera, cláusula por cláusula. |

### Cuatro se cargan a mano y la quinta se calcula

**Antigüedad no tiene datos propios**: lee la matriz de `Cartera → Reglas de cobertura`, que es la misma
que avisa al emitir una póliza. Es a propósito. Si esta pantalla tuviera su propia lista habría dos
respuestas distintas para la misma pregunta, y la que frena una emisión sería la otra. Lo que hace es
leerla al revés: allá se pregunta «¿esta compañía me toma este auto?» con la compañía ya elegida, acá
«¿quién me toma este auto?» con el auto adelante, que es lo que se pregunta el que está cotizando.

Cuando una compañía trabaja en la cartera y no tiene ninguna regla cargada, la pantalla **la nombra
aparte** en vez de dejarla en silencio: que no aparezca no quiere decir que no tome el vehículo, quiere
decir que nadie cargó todavía hasta qué modelo lo toma. Es la diferencia entre «no» y «no sé», y
confundirlas hace perder una venta.

Las otras cuatro (organizadores, precios, grúas y cláusulas) **las carga el superadministrador**, igual
que la matriz de coberturas y por el mismo motivo: son la referencia contra la que se cotiza, y una
lista de precios que cualquiera puede tocar deja de ser una referencia. El resto del equipo las
consulta, y la pantalla lo dice en lugar de aparentar que está rota.

### Tres distinciones que la pantalla se toma en serio

- **Ilimitada no es sin cargar.** Una celda de grúa que dice «ilimitada» es una compañía que no pone
  tope; una que dice «sin cargar» es una pregunta que nadie hizo todavía. Prometer un remolque que no
  existe es peor que decir «dejame que averiguo».
- **Un precio sin fecha es un precio que no sirve.** La columna «Rige desde» es la más importante de
  Precios: un importe de hace cuatro meses se lee igual que uno de hoy. A los sesenta días la fila se
  marca sola, y la que no tiene fecha también.
- **Lo que no ampara está en la misma lista.** «Terceros completo no cubre el granizo» dicho en el
  momento evita un siniestro rechazado seis meses después, así que las exclusiones se cargan al lado de
  las coberturas y no en otro lado.

### Cómo llegan a las otras computadoras

Estas cuatro listas **no tienen pestaña en la planilla** donde escribirse (la que se le parece,
COBERTURA, es un cuadro de resumen con celdas combinadas), así que no viajan con la sincronización de
todos los días. Viajan por el **puente de ajustes del VPS**, el mismo por el que ya viajan las
credenciales del catálogo de vehículos: el superadministrador toca «Publicar para todas» y el resto de
las computadoras las adopta sola al arrancar. La barra de arriba del módulo dice en qué estado está.

La adopción del arranque **no pisa lo que se cargó acá y todavía no se publicó**. Sin esa regla, los
precios cargados una noche desaparecían a la mañana siguiente sin que nadie los hubiera borrado. Cuando
las dos puntas difieren, la barra lo dice y la decisión es de una persona: publicar lo de acá, o traer
lo de allá.

### Probarlo

```bash
npm run prueba   # pruebas/referencias.prueba.ts
```

Cubre el orden de los organizadores y sus flechas; que el precio se acepte con coma o con punto y que
el cero se rechace; que no haya dos filas para la misma compañía y cobertura aunque se escriban
distinto; que la grúa vacía sea ilimitada; que la consulta de antigüedad separe lo que se le vende a
ese modelo de lo que no y nombre aparte a las compañías sin reglas; que la huella con la que las
computadoras se comparan no cambie si no cambian los datos; que adoptar reemplace y no mezcle; que una
fila rota de lo publicado se saltee sola en vez de llevarse puesta la adopción entera; y que lo cargado
y no publicado cuente como pendiente.

## Eliminar registros (sólo el superadministrador)

Hasta acá el programa no borraba nada. Se daba de baja, se deshacía, se ponía vigente, se corregía: todo
reversible, y todo con el historial detrás. Pero un cliente cargado dos veces, un aviso de rechazo mandado
por error o una fila de la planilla que nunca tendría que haber existido no se arreglan dando de baja —dar
de baja es un hecho del negocio, no un botón de deshacer— y quedaban ahí para siempre.

Ahora hay un **botón rojo con una papelera** que borra un registro de la base de verdad. Es del
`SUPER_ADMIN` y de nadie más.

### Qué se puede borrar y dónde está el botón

| Tipo | Dónde | Qué se lleva puesto |
| --- | --- | --- |
| `cliente` | Clientes → ficha, arriba a la derecha | Vehículos, pólizas, cuotas de todos los meses, pagos, bajas, siniestros con sus documentos, notas, tareas, presupuestos, riesgos varios, AMP y avisos de rechazo |
| `poliza` | Pólizas → Editar póliza | Sus cuotas, pagos, bajas, siniestros, AMP, avisos de rechazo, tareas y el seguimiento de renovación |
| `cuota` | Cartera → Planilla del mes, panel de la derecha | Los pagos hechos contra esa fila, su baja y su aviso de rechazo |
| `baja` | Cartera → Bajas, en la fila y en el panel | Nada más que la baja |
| `rechazo` | Cartera → Rechazos, en la fila | Nada más que el aviso |
| `lead` | Leads → ficha | Sus notas y sus tareas |
| `presupuesto` | Presupuestos → ficha | **Todas** sus versiones, sus opciones y sus tareas |
| `siniestro` | Siniestros → ficha | Sus observaciones, sus documentos adjuntos y sus tareas |
| `riesgo` | Cartera → Riesgos varios, en la fila | Nada más que el riesgo |
| `amp` | Cartera → AMP, en la fila | Nada más que la ampliación |
| `tarea` | Tareas → ficha | Sus comentarios y sus adjuntos |

Para quien no es superadministrador el botón **no se dibuja**: no aparece apagado ni con un cartel de
«no tenés permiso», directamente no está (`BotonEliminar` devuelve `null`). Un botón que no se puede
tocar sólo sirve para que alguien lo intente.

### Los cinco segundos

El cartel de confirmación no es un «¿Estás seguro?». Antes de abrirlo se le pregunta al proceso principal
qué se lleva puesto el borrado y se muestra contado —«3 pólizas, 42 cuotas del mes, 12 pagos»—, con los
renglones que se sacan de la hoja de Google, los archivos que se borran del disco y las advertencias que
correspondan a ese tipo. El botón de confirmar arranca apagado y se enciende **a los cinco segundos**, con
la cuenta a la vista (`SEGUNDOS_PARA_CONFIRMAR`). Es el rato que separa «me equivoqué de fila» de «esto lo
quise borrar», y es más o menos lo que se tarda en leer la lista de arriba.

### Cómo está armado

- `src/shared/eliminacion.ts` — qué se puede borrar, cómo se llama cada cosa y los cinco segundos. Puro
  y compartido, como `permisos.ts`.
- `src/main/servicios/eliminacion.ts` — el trabajo. Cada tipo tiene un **plan**: título, lo que arrastra,
  los renglones de la hoja, los archivos, las advertencias y las sentencias. El mismo plan lo arma
  `vistaPreviaDeEliminacion` (que no lo ejecuta) y `eliminarRegistro` (que sí): lo que el cartel promete y
  lo que el borrado hace **no pueden separarse, son la misma cuenta**.
- `src/renderer/componentes/BotonEliminar.tsx` — el botón y el cartel con la cuenta regresiva.
- Canales `eliminacion:vistaPrevia` y `eliminacion:borrar`, los dos con `exigirRol('SUPER_ADMIN')` en
  `ipc.ts`. El servicio vuelve a controlar el rol por su cuenta: un borrado definitivo se merece que la
  regla esté escrita al lado de lo que borra.

Cuatro reglas que atraviesan todos los planes:

1. **Se borra lo que existe sólo por el registro y se desenlaza lo que tiene vida propia.** El lead del
   que salió la venta no se borra al borrar el cliente: queda sin cliente asociado, porque es de dónde vino
   una venta y las métricas del mes lo cuentan. Lo mismo el presupuesto que terminó en una póliza. Y el
   vehículo que también está en la póliza de otro cliente —el auto se vendió y el comprador se aseguró
   acá; la clave de un vehículo es la patente a secas— se desenlaza en vez de borrarse.
2. **El historial no se toca nunca.** Además, cada borrado le agrega una entrada con quién lo hizo, cuándo
   y la foto de lo que se fue.
3. **`filas_crudas` tampoco se toca.** Es lo que la bajada usa para reconocer un `_ID` de la hoja. Si se
   borrara, la fila que todavía está en Google se vería como «vino de otra computadora» y dispararía una
   importación completa que volvería a crear todo lo que se acaba de borrar. Queda como lápida hasta que
   la subida saque el renglón.
4. **Las claves foráneas están en ON y eso juega a favor.** Si un plan se olvidara de una tabla que apunta
   al registro, la transacción entera se cae y no se borra nada. Un borrado a medias sería mucho peor que
   uno que no se hizo.

### Lo que el cartel avisa, y por qué

- **La cola de subida.** Los renglones salen de la hoja recién cuando la sincronización llegue a subirlos
  (los borrados esperan hasta un minuto para viajar juntos, ver `ESPERA_DE_AGRUPADO_MS`). Hasta entonces,
  una importación completa volvería a crear lo que se borró. Sólo se avisa para los tipos que el
  importador sabe reconstruir desde la hoja: leads, presupuestos y tareas no se reimportan.
- **Las otras computadoras.** Cada PC tiene su propia base y lo único que viaja es la hoja. Cuando el
  renglón desaparece, la bajada de la otra máquina lo marca como «ya no está» pero **no borra** lo que ya
  tenía guardado. Hay que borrarlo también desde ahí.
- **Lo pendiente en la cola se cancela antes de encolar el borrado.** No es prolijidad: `subirTanda`
  recorre la cola por id, así que un «crear» pendiente se aplicaría primero y el «borrar» que va detrás
  busca la fila en el mapa de la hoja tal como estaba al empezar la tanda —donde la recién creada no
  figura— y se daría por hecho sin borrar nada. La fila quedaría en Google para siempre.
- **Borrar una baja no devuelve nada a la cartera.** Para eso están «Deshacer» y «Poner vigente». El
  cartel lo dice y manda al botón que corresponde.
- **Borrar la última fila que una póliza vigente tiene en el mes abierto la saca de la cartera para
  siempre.** `cerrarMes` arma el mes que viene copiando desde las filas del mes abierto: una póliza que
  se queda sin fila ahí no tiene de dónde copiarse y no se copia nunca más. Desaparece de la planilla,
  de la mora, de la caja y de los deudores mientras en Pólizas se la sigue viendo activa —nadie le cobra
  y nadie se entera— y para devolverla hay que darla de baja desde Pólizas y después «Poner vigente» en
  Bajas. El aviso es fino a propósito: si la planilla tiene DOS filas de la misma póliza (dos renglones
  en la hoja con distinto _ID), sacar la que sobra es justamente para lo que está la papelera, y ahí no
  corresponde. En un mes ya cerrado tampoco, porque el cierre sólo mira el mes más nuevo.
- **Los adjuntos del Drive no se borran**: la copia local sí, la de Google hay que sacarla desde Google.

### Probarlo

```bash
npm run prueba   # pruebas/eliminacion.prueba.ts
```

Treinta y dos casos. Cubre que un ADMIN y un EMPLEADO no puedan ni borrar ni mirar la vista previa; que
todos los tipos declarados tengan plan; que la cascada del cliente no deje filas huérfanas (con un
`PRAGMA foreign_key_check` al final, que es la única forma de probarlo de verdad); que una tabla nueva
que apunte al cliente y que ningún plan conozca tire la transacción entera sin borrar nada; que el
vehículo compartido y el lead convertido sobrevivan; que lo que el cartel promete sea exactamente lo que
se borra; que el renglón salga de la pestaña donde vive de verdad y no de la que dice la tabla; que lo
que ya no está en la hoja no se cuente; que un «crear» pendiente —o uno ya dado por perdido— salga de la
cola; que un borrado no cree pestañas; que los adjuntos se borren del disco; que el historial sobreviva;
y que la advertencia de la póliza vigente describa lo que de verdad pasa, cerrando el mes para
comprobarlo.
