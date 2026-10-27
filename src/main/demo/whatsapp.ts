// «Avisar por WhatsApp» en la versión de demostración. Los teléfonos de los datos de ejemplo tienen la
// forma de celulares de verdad del AMBA: abrir wa.me con uno de ellos, delante de otra agencia, es
// mandarle a un desconocido un aviso de deuda o un presupuesto. En la demo, en vez de abrir WhatsApp, se
// muestra cómo le llegaría el mensaje al cliente; quien llamó sigue igual (marca la fila como avisada,
// pasa el presupuesto a ENVIADO…), porque para él el enlace «se abrió».
//
// Lo usan `sistema:abrirEnlace` (ipc.ts) y los enlaces de la pantalla (`setWindowOpenHandler` en
// index.ts), siempre detrás de `esDemo()`: nunca corre en la versión normal.
import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'

export interface WhatsappDeLaDemo {
  /** Sólo dígitos, como va en wa.me (5491134559091); vacío si el enlace no lleva teléfono. */
  telefono: string
  texto: string
}

// Sólo los que abren un chat: una página de ayuda de whatsapp.com no es un mensaje a nadie.
const HOSTS_DE_WHATSAPP = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com']

/** Si el enlace es un chat de WhatsApp, a quién y con qué texto; si no, null. */
export function whatsappDeLaDemo(url: string): WhatsappDeLaDemo | null {
  let enlace: URL
  try {
    enlace = new URL(url)
  } catch {
    return null
  }
  const host = enlace.hostname.toLowerCase().replace(/^www\./, '')
  if (!HOSTS_DE_WHATSAPP.includes(host)) return null
  const telefono = host === 'wa.me' ? enlace.pathname : (enlace.searchParams.get('phone') ?? '')
  return { telefono: telefono.replace(/\D/g, ''), texto: enlace.searchParams.get('text') ?? '' }
}

/** «5491134559091» → «+54 9 11 3455-9091»; lo que no tiene esa forma, con un «+» adelante. */
export function telefonoParaMostrar(telefono: string): string {
  const partes = /^54(9)?(11)(\d{4})(\d{4})$/.exec(telefono)
  if (partes) return `+54 ${partes[1] ? '9 ' : ''}${partes[2]} ${partes[3]}-${partes[4]}`
  return telefono ? `+${telefono}` : 'sin número'
}

/** El diálogo «Así le llegaría el WhatsApp al cliente». Espera a que lo cierren. */
export async function mostrarWhatsappDeLaDemo(mensaje: WhatsappDeLaDemo, ventana: BrowserWindow | null): Promise<void> {
  const opciones: MessageBoxOptions = {
    type: 'info',
    title: 'WhatsApp (demostración)',
    message: 'Así le llegaría el WhatsApp al cliente',
    detail: [
      `Para: ${telefonoParaMostrar(mensaje.telefono)}`,
      '',
      mensaje.texto || '(Sin texto: se abriría el chat vacío para escribirle.)',
      '',
      '—',
      'Es una demostración: no se abrió WhatsApp ni se mandó nada. En el programa de verdad este botón abre el chat con el mensaje ya escrito, listo para enviar.',
    ].join('\n'),
    buttons: ['Entendido'],
    defaultId: 0,
    noLink: true,
  }
  if (ventana) await dialog.showMessageBox(ventana, opciones)
  else await dialog.showMessageBox(opciones)
}
