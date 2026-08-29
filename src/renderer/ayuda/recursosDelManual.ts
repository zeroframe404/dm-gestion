// Lo que el manual necesita del empaquetado: hoy, el logo.
//
// Va en un archivo aparte —y se carga con `import()` dinámico— por dos motivos. Uno: `manual.ts`
// tiene que quedar libre de cualquier cosa de Vite, porque lo importan también el banco de pruebas y
// el script de línea de comandos, que corren en Node pelado. Dos: la imagen en base64 pesa, y no
// tiene por qué entrar en el arranque de la aplicación para algo que se pide una vez al año.
//
// El logo va SÍ O SÍ embebido y no por ruta: la ventana que imprime carga un archivo escrito en la
// carpeta de datos, así que cualquier ruta relativa apuntaría a otro lado y saldría el hueco de una
// imagen rota.
import logoUrl from '../../../recursos/icon.png'

/** El logo como data URI, o '' si no se pudo. La portada se ve bien igual sin él. */
export async function logoDelManual(): Promise<string> {
  try {
    const respuesta = await fetch(logoUrl)
    const blob = await respuesta.blob()
    return await new Promise<string>((resolver) => {
      const lector = new FileReader()
      lector.onloadend = () => resolver(typeof lector.result === 'string' ? lector.result : '')
      lector.onerror = () => resolver('')
      lector.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}
