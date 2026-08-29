// Lo que el manual necesita del empaquetado: hoy, el logo.
//
// Va en un archivo aparte —y se carga con `import()` dinámico— por dos motivos. Uno: `manual.ts`
// tiene que quedar libre de cualquier cosa de Vite, porque lo importan también el banco de pruebas y
// el script de línea de comandos, que corren en Node pelado. Dos: la imagen en base64 pesa ocho kilos
// y no tiene por qué entrar en el arranque de la aplicación para algo que se pide una vez al año.
//
// `?inline` y no `?url`: con `?url` Vite emite el PNG como un archivo aparte y devuelve una ruta, y
// leerla desde el renderer NO FUNCIONA en la aplicación empaquetada. La ventana se carga con
// `file://` y Chromium no deja hacer `fetch` de un `file://`, así que el logo desaparecería en
// silencio y el manual saldría sin él justo donde importa (en desarrollo, con el servidor de Vite en
// http://, sí anda: es de los errores que sólo aparecen después de publicar).
//
// Con `?inline` la imagen queda embebida en el propio bundle como data URI, y además eso es lo que el
// manual necesita de todos modos: el HTML se escribe en la carpeta de datos y se imprime desde ahí,
// así que cualquier ruta relativa apuntaría a otro lado.
import logoEmbebido from '../../../recursos/icon.png?inline'

/** El logo como data URI. Vacío si el empaquetado no lo trajo; la portada se ve bien igual. */
export function logoDelManual(): string {
  return typeof logoEmbebido === 'string' && logoEmbebido.startsWith('data:') ? logoEmbebido : ''
}
