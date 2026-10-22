# Todo
## Normas de eficiencia
- No leas archivos enteros si solo buscas una función; usa búsquedas dirigidas.
- Mantén las respuestas en el chat breves y concisas.
- No resumas lo que acabas de hacer si el resultado de la terminal ya es claro.
## Ramas: todo va a `beta` (regla del proyecto)
- **Todo el trabajo va a la rama `beta`**, salvo que el usuario diga EXPLÍCITAMENTE otra cosa (por ejemplo «esto es urgente, va directo a master»). Los pull requests se abren con base `beta`, nunca contra `master`.
- Al empujar a `beta`, el workflow `Publicar beta` arma solo el instalador de **DM Gestión (Beta)** y lo publica en el Release fijo `beta-canal`. La beta es un programa **instalable y actualizable**, aparte del normal (otro `appId`, carpeta de datos `dm-gestion-beta`, canal de actualización propio): no se rompe eso.
- `master` es el programa original, el de la agencia. No se toca directo. Los cambios llegan con el workflow **`Promover beta a master`** (Actions); después el usuario lanza el `Publicar` de siempre desde `master`. `Sincronizar beta con master` mantiene `beta` al día con `master`.
- La beta y la normal **conviven**: misma PC (carpetas de datos separadas) y mismo VPS (misma base, usuarios y ajustes). Antes de tocar algo que escriba en el VPS, pensar qué le pasa a la versión normal (formato de la grilla, ajustes compartidos, protocolo del canal en vivo). Las acciones destructivas sobre el servidor (restaurar respaldo, migrar) están bloqueadas desde la beta (`servicios/proteccionBeta.ts`).
- La versión de la beta **no se commitea**: el workflow la calcula (`scripts/version-beta.mjs`, p. ej. `17.7.3-beta.41`). No subir la versión del `package.json` en `beta`; eso lo hace `Publicar` en `master`.
- Detalle completo en el README, sección «Versión beta».
