# Alta de cliente desde el PDF de la póliza (con IA)

Fecha: 2026-11-26 · Estado: pendiente de aprobación · Rama de trabajo: `beta` (PR con base `beta`)

## Intención y por qué

El cliente de la agencia pidió que, al tocar **«Nuevo cliente»**, se pueda subir el **PDF de la póliza** y que el
programa lo lea con **IA** y complete solo los datos. Hoy esos datos se tipean a mano, lo que lleva tiempo y es
donde se cometen los errores (un DNI mal tipeado es un duplicado que después cuesta días). La referencia que pasó
es un video promocional de otra herramienta (Siga Seguros): «subí las pólizas y la IA captura cliente, póliza y
aseguradora; menos captura, más eficiencia». El video no muestra pantallas; la referencia real es el pedido.

Qué tiene que pasar:

1. Subir el PDF desde «Nuevo cliente».
2. El sistema lee la póliza y completa:
   - **Cliente:** nombre y apellido, dirección (y el DNI/CUIT, ver abajo).
   - **Vehículo:** los datos del auto, el chasis y el motor.
   - **Póliza:** la vigencia y la compañía (y el número de póliza y la cobertura, ver abajo).
3. Después pide **solo lo que la póliza no trae y es obligatorio**: teléfono, mail y forma de pago.

## Qué se agregó al pedido (y por qué)

Estos datos no estaban en la lista del cliente pero la póliza no se puede crear sin ellos; se leen igual:

- **DNI/CUIT:** es la regla de oro del programa (nunca dos personas con el mismo documento). Sin leerlo, no hay
  forma de detectar que el cliente ya existe.
- **Número de póliza** (o de propuesta): `validarDatos` en `polizas.ts` exige uno de los dos.
- **Cobertura:** es obligatoria en un vehículo (`exigirCoberturaDelVehiculo`) y la antigüedad se valida contra
  compañía + cobertura.
- **Patente:** es lo que identifica al vehículo (`claveDeVehiculo`), forma parte de «los datos del auto».

## Objetivos

- Subir un PDF de póliza de auto y llegar a un cliente + auto + póliza creados, tipeando solo lo que falte.
- Funcionar con cualquier aseguradora y con PDFs escaneados, sin un lector por compañía.
- Que lo leído se pueda revisar y corregir antes de guardar.
- Mantener las reglas de siempre: DNI no duplicado, patente dada de baja, cobertura obligatoria, aviso de antigüedad.

## No objetivos (versión 1)

- Pólizas que no son de auto (hogar, bicicleta, accidentes personales, comercio). Si el PDF no es de un auto se
  avisa y se sigue a mano.
- Más de un vehículo por PDF (flotas): se avisa y se carga a mano.
- Varios PDFs a la vez, ni importación masiva.
- Renovar o actualizar una póliza que ya existe a partir de un PDF nuevo.
- Leer fotos o imágenes sueltas: solo PDF.
- Lectores propios por aseguradora (opciones B y C, ver Enfoques).
- Tope de gasto de IA o registro de uso por usuario: no lo tiene ninguna otra función de IA del programa. Sí se
  evita lo obvio: el botón no se puede apretar dos veces y un mismo archivo no se vuelve a leer sin pedirlo. Si la
  agencia quiere un límite, es otro cambio. *(Decisión mía.)*

## Anti-objetivos (sería un fracaso aunque «funcione»)

- Que algo leído por la IA se guarde sin que una persona lo haya podido ver.
- Que se cree un cliente duplicado, o que el PDF pise datos de un cliente que ya existe.
- Que un dato inventado por la IA aparezca como si estuviera en el PDF: lo que no está, queda vacío.
- Que el alta manual (la de siempre) quede peor, más lenta o con más campos obligatorios.
- Que quede un cliente a medio crear (sin su póliza) por un error a la mitad.

## Restricciones

- **Reglas del proyecto (CLAUDE.md):** todo va a `beta`; el PR se abre con base `beta`. No se sube la versión del
  `package.json`. Se suma un renglón (tipo `agregado`, escrito para la agencia) en `src/shared/cambios.ts`, en la
  entrada del próximo parche (con `18.1.5` en el `package.json`, la entrada es `'18.1.6'`; si no existe se crea), en el mismo PR (`pruebas/cambios.prueba.ts` lo exige).
- **Beta y normal conviven en el mismo VPS:** el alta crea las mismas filas que el alta manual (cliente, vehículo,
  póliza), así que la versión normal las ve igual. No se cambia ningún protocolo del VPS ni el formato de la
  grilla. El canal IPC nuevo es solo entre pantalla y proceso principal.
- **IA:** se usa lo que ya hay: `@anthropic-ai/sdk` y la clave compartida del superadministrador
  (`claveDelAsistente()` en `servicios/config.ts`; en modo demo devuelve `null`). La llamada vive solo en el
  proceso principal; la clave nunca llega a la pantalla. El patrón de referencia es `servicios/analisisDeReporte.ts`
  (tiempo tope, errores en castellano, nunca revienta).
- **Permisos:** el alta combinada escribe en dos áreas. Hace falta permiso de edición en **clientes y pólizas**
  (`exigirEdicion('clientes', 'polizas')`). Sin los dos, o sin clave de IA, la opción de PDF no se ofrece (o se
  muestra deshabilitada diciendo por qué) y el alta manual queda igual.
- **Privacidad:** el PDF completo (con DNI, dirección, patente) sale hacia Anthropic. Eso se dice en la pantalla
  con una línea corta y en la ayuda. El programa no guarda el PDF salvo como adjunto de la póliza (ver abajo) y no
  lo escribe en logs.
- **El contenido del PDF no es de confianza:** la IA solo puede devolver los campos del formato fijo. Nada de lo
  que traiga se ejecuta, y todo valor pasa por los mismos validadores del proceso principal al guardar (tipos,
  largos, fechas), igual que lo tipeado a mano.

## Enfoques considerados

| | Cómo | A favor | En contra |
|---|---|---|---|
| **A (elegido)** | La IA lee el PDF directo y devuelve los campos en un formato fijo | Sirve para cualquier aseguradora y para escaneados; nada que mantener si una compañía cambia el diseño; usa lo que ya está instalado | Cada lectura gasta saldo de la cuenta de Anthropic; necesita internet; el PDF sale a Anthropic |
| B | Lectores propios por aseguradora (texto + reglas) | Gratis, sin internet, nada sale afuera | Un lector por compañía, se rompen al cambiar el diseño, no leen escaneados; no hay PDFs de ejemplo |
| C | Mixto: propio primero, IA para lo que no reconozca | Baja el gasto de IA con volumen | Más piezas sin ganancia mientras no haya volumen |

Se eligió **A**: es lo que el cliente pidió («que se haga con IA») y lo que ya usa el programa. B y C se pueden
sumar después sin rehacer la pantalla.

## Diseño

### Lo que ve la persona

```
┌ Nuevo cliente ───────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 📄 Cargar desde la póliza (PDF)       [ Elegir archivo ] │ │
│ │ La IA lee el PDF y completa los datos. Revisalos antes   │ │
│ │ de crear. El PDF se envía a Anthropic para leerlo.       │ │
│ └──────────────────────────────────────────────────────────┘ │
│  (abajo, el formulario de siempre)                           │
└──────────────────────────────────────────────────────────────┘

Después de leer:
  Cliente      Nombre y apellido [leído] · DNI [leído] · Dirección [leído]
               Celular [FALTA] · Email [FALTA]
  Vehículo     Patente · Marca · Modelo · Año · Motor · Chasis   [leídos]
  Póliza       Compañía · N.° · Cobertura · Vigencia desde/hasta [leídos]
               Forma de pago [FALTA]
  Lo leído lleva una marca «Leído del PDF» y se puede editar.
  Lo que falta y es obligatorio se resalta y deshabilita «Crear» hasta completarlo.
```

El diálogo pasa por estos estados: **sin PDF** (igual que hoy) → **leyendo** (aviso «Leyendo la póliza…», el
botón no se puede apretar dos veces) → **revisando** (formulario completo con marcas) → **creando** → listo.
Si la lectura falla (sin clave, sin internet, el PDF no se entiende, no es de auto) se muestra un aviso claro y la
persona sigue con el formulario manual, sin perder lo que haya tipeado.

### Qué es obligatorio

- **En el flujo con PDF:** teléfono, email y forma de pago, más lo que la póliza necesita y la IA no encontró
  (compañía, número de póliza o propuesta, cobertura). Si el PDF trae alguno de los tres (a veces trae
  teléfono o forma de pago), viene completo y no se pregunta.
- **DNI/CUIT, también obligatorio en el flujo con PDF** si la IA no lo pudo leer. En el alta manual puede quedar
  vacío a propósito, pero acá el DNI es lo que evita el duplicado, así que no se deja pasar sin él.
  *(Decisión mía.)*
- **En el alta manual:** nada cambia. Sigue siendo obligatorio solo el nombre. *(Decisión mía: el pedido habla del
  flujo con PDF; si quieren que también sean obligatorios en el manual, es otro cambio.)*

### Quién es el cliente en el PDF

Las pólizas traen varias personas (tomador, asegurado, conductor, beneficiarios). El cliente es el **titular de
la póliza: el asegurado** (si el PDF solo dice «tomador», el tomador). Si es una empresa, el cliente es la razón
social y el documento es el CUIT. Conductor y beneficiarios se ignoran. Si el PDF trae un tomador distinto del
asegurado, se carga el asegurado y se avisa en pantalla. *(Decisión mía; se confirma con PDFs reales.)*

### Cliente que ya existe (decisión tomada: opción 2)

Si el DNI leído (o el tipeado) ya está cargado:

- **La detección es temprana:** apenas se lee el PDF (y al corregir el DNI a mano) se consulta con una búsqueda
  de solo lectura, antes de pedir teléfono y mail. Así no se pide lo que no hace falta. *(Decisión mía.)*
- **Se avisa si el nombre no coincide:** la tarjeta muestra también «En el PDF figura: …» y marca la diferencia si
  el nombre leído es otro que el guardado. Evita agregar la póliza a la persona equivocada por un DNI mal leído.
  No bloquea: la persona decide. *(Decisión mía.)*
- El diálogo muestra la misma tarjeta de hoy (quién es, sucursal, celular, pólizas activas, deuda) y ofrece
  **«Agregar esta póliza al cliente existente»**: crea el auto y la póliza en su ficha **sin tocar los datos del
  cliente**, aunque el PDF traiga otro teléfono o dirección. Quedan también «Abrir el cliente existente» y
  «Volver a editar».
- En ese caso **no se piden teléfono ni mail** (el cliente ya los tiene); sí la forma de pago.
- `crearCliente` sigue siendo quien decide en el guardado (la regla de oro no se mueve de ahí): cualquier DNI que
  se corrija a mano a último momento pasa por el mismo control de siempre.

### Qué se crea y cómo

- Se crean cliente, vehículo y póliza con **las mismas funciones y reglas que el alta manual** (`crearCliente`,
  `crearPoliza` con `vehiculoNuevo`). No hay camino nuevo para saltearse reglas: patente dada de baja,
  cobertura obligatoria y aviso de antigüedad siguen valiendo.
- **Las confirmaciones de siempre existen también en este diálogo**, no solo como error: el aviso de patente dada
  de baja (se confirma con `confirmadoPatenteDeBaja`) y el aviso de antigüedad de cobertura (lo puede confirmar
  solo quien tiene permiso para hacerlo, igual que en el formulario de póliza; un usuario sin ese permiso ve el
  bloqueo). Una patente con póliza activa de otro cliente sigue siendo un error duro. Los mensajes son los mismos
  del formulario de póliza. *(Decisión mía.)*
- **Todo o nada** desde el punto de vista de la persona: o se crea todo, o no queda nada a medias. Todos los
  chequeos y confirmaciones se resuelven **antes de escribir nada** para un cliente nuevo; si algo falla después
  de escribir, se deshace lo creado. Cómo se logra (una transacción, una validación previa de solo lectura, o
  `deshacer.ts`) lo resuelve quien construye, mirando qué permiten `crearCliente`/`crearPoliza` y la cola de
  sincronización (`encolar`).
- El resultado abre la ficha del cliente, como hoy.
- **El PDF queda como adjunto de la póliza** (con `agregarArchivosDePoliza`), para no tener que subirlo dos veces.
  Si el adjunto falla, la póliza igual se crea y se avisa. *(Propuesta mía, fácil de sacar.)*

### Lectura con IA (proceso principal)

- Servicio nuevo, p. ej. `servicios/lecturaDePoliza.ts`, con el patrón de `analisisDeReporte.ts`: clave de
  `claveDelAsistente()`, tiempo tope, errores a mensajes en castellano, sin claves en los mensajes.
- Se manda el PDF como documento de la API de mensajes y se pide la respuesta en **formato fijo** (esquema JSON
  de salida estructurada): cada campo puede ser `null`. Instrucción explícita: **si no está en el PDF, `null`;
  nunca inventar ni deducir.**
- Campos a devolver: nombre y apellido; DNI/CUIT; dirección en partes (calle, altura, localidad, provincia, código
  postal); teléfono y email si figuran; patente, marca, modelo, año, motor, chasis (y uso/color si figuran);
  compañía; número de póliza; número de propuesta; cobertura; vigencia desde y hasta; forma de pago y cuota si
  figuran; si es una póliza de auto; cuántos vehículos trae.
- **Ajuste a los catálogos de la agencia:** compañía, cobertura y forma de pago se acercan a los nombres que ya
  usa la agencia (`catalogosDePoliza()`) cuando el parecido es claro (mayúsculas, acentos, «S.A.»), porque la
  validación de antigüedad se cruza por compañía + cobertura. Si no hay parecido claro, queda lo leído y el aviso
  de siempre.
- **El auto se guarda como texto leído, sin catálogo:** marca, modelo y año tal como figuran, con `tipo` `AUTO` y
  sin `linea`, `categoria` ni `catalogoCodigo` (es el mismo estado de los autos cargados a mano o desde la
  planilla vieja). Con tipo `AUTO` y sin categoría, el listado por ramas lo cuenta como Auto (`ramaDeVehiculo`):
  una pick-up queda en «Auto» hasta que alguien la afine con el catálogo desde la ficha del vehículo. Un PDF que
  no sea de auto (moto, camión, hogar…) se avisa y se sigue a mano. *(Decisión mía.)*
- Las fechas de vigencia salen en el formato de la planilla (`dd/mm/aaaa`).
- Límites del PDF (tamaño, páginas): los de la API de Anthropic, que quien construye confirma en la
  documentación vigente antes de fijar los topes; el programa rechaza con un mensaje claro lo que no entra.
- Modelo y esfuerzo: arrancar con el de `MODELO_DEL_ANALISIS_DE_REPORTES` (Sonnet 5.5); si con PDFs reales
  alcanza con uno más barato, se baja. Se decide por exactitud medida, no por precio de entrada.

### Piezas que se tocan

- **Compartido:** `src/shared/tipos.ts` (resultado de la lectura, datos del alta combinada),
  `src/shared/canales.ts` y `src/shared/api.ts` (canales nuevos, p. ej. `clientes:leerPoliza` y
  `clientes:altaDesdePoliza`).
- **Principal:** `servicios/lecturaDePoliza.ts` (nuevo), alta combinada (en `clientes.ts` o un servicio nuevo),
  `src/main/ipc.ts` (los dos canales, con el permiso de clientes y pólizas).
- **Pantalla:** `DialogoNuevoCliente.tsx` (zona de PDF, estados, marcas de «leído», campos que faltan, cliente
  existente con «Agregar póliza»).
- **Texto:** renglón en `src/shared/cambios.ts` (entrada del próximo parche, hoy `'18.1.6'`) y párrafo en
  `src/renderer/ayuda/contenido/clientes.ts`.

## Verificación

- **Pruebas automáticas** (`npm run prueba`, estilo `node:test` en `pruebas/`): no llaman a la API real. La
  lectura recibe su cliente de IA inyectable para poder simular respuestas. Se prueban las piezas puras: del
  resultado de la IA al formulario (nulls, fechas, dirección en partes), ajuste a catálogos, qué falta
  según el caso (cliente nuevo / existente), alta todo-o-nada, cliente existente sin pisar datos, permisos, y que
  una respuesta con basura o con instrucciones dentro no cree nada ni salte validaciones.
- **Exactitud de la lectura:** no se puede comprobar sin PDFs reales. Para cerrarla hacen falta 2 o 3 PDFs reales
  de las aseguradoras que más usa la agencia (con los datos tapados o de prueba). Mientras tanto, la pantalla
  siempre muestra lo leído para revisar, y esa revisión es la red de seguridad.
- `npm run typecheck` limpio.

## Queda para quien construye

- Nombres exactos de archivos, canales y tipos; el diseño visual fino del diálogo (con los componentes `ui`
  existentes).
- Cómo lograr el «todo o nada» (ver arriba) y qué búsqueda de solo lectura usar para detectar temprano el DNI
  existente, sin duplicar la regla (la decisión final sigue siendo de `crearCliente`).
- Orden y mayúsculas del nombre (el PDF suele traer «APELLIDO NOMBRE»): seguir cómo ya están guardados los
  clientes de la agencia, mirando datos reales o de demostración.
- Topes de tamaño/páginas y modelo definitivo (ver arriba).
- Qué hacer si el PDF trae más de un vehículo o no es de auto: avisar y dejar el formulario manual (no cargar a
  ciegas).

## Cambios posteriores

Lo de arriba es el diseño original; esto es lo que cambió después y hoy vale por encima de él.

- **2026-11-27 · Lo que falta vuelve vacío, no `null`.** La salida estructurada de la API acepta hasta 16 campos
  con unión de tipos por pedido y el esquema pedía «texto o null» en 27: rechazaba todos los pedidos. Cada campo
  es texto simple y `interpretarLectura` pasa el vacío a `null`.
- **2026-11-27 · También se leen motos.** «Pólizas que no son de auto» deja de incluir a las motos. La IA devuelve
  `tipoDeVehiculo` (`AUTO`, `MOTO` u `OTRO`) en lugar de `esPolizaDeAuto`; el vehículo se guarda con ese `tipo`
  (`MOTO`, sin categoría: en el listado por ramas es Moto hasta que alguien la afine) y entre lo leído hay un
  selector «Tipo» para revisarlo. Camiones, acoplados y todo lo que no es un vehículo siguen a mano.
- **2026-11-27 · PDF de hasta 90 MB.** El tope de 20 MB salía de un límite viejo de la API (32 MB por pedido). Hoy
  acepta pedidos de 128 MB y el PDF viaja en base64 (un tercio más): 90 MB de PDF son 120 MB de pedido. El tiempo
  tope crece con el peso (dos minutos más cuatro segundos por MB, hasta los cinco minutos: Node corta ahí todo
  pedido sin respuesta), un PDF de más de 20 MB no se reintenta solo y la pantalla avisa que puede tardar.
