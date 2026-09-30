// La pantalla de carga: lo primero que se ve al darle doble click al programa.
//
// El problema que resuelve, tal como pasaba en la agencia: entre el doble click y la ventana del
// ingreso pasaban unos segundos (arranque de Electron, la base, las migraciones, la carga de la
// pantalla de React) sin NADA a la vista. En Windows eso se lee como «no abrió» y la gente vuelve a
// hacer doble click, o piensa que se trabó.
//
// Por eso esta ventanita nace apenas Electron está listo —antes de abrir la base— y es lo más liviana
// posible: HTML en una URL `data:`, sin preload, sin React, sin archivos que leer del disco. Se va sola
// en cuanto la ventana principal está dibujada (ver `cerrarPantallaDeCarga` en index.ts).
import { BrowserWindow } from 'electron'
import icono from '../../recursos/icon.png?inline'

/**
 * Si la ventanita no da señales en este tiempo, el arranque sigue igual. Nunca puede frenar al
 * programa: es un adorno para que se vea algo, no un paso del arranque.
 */
const ESPERA_MAXIMA_MS = 1_500

let ventana: BrowserWindow | null = null

const HTML = `<!doctype html>
<html lang="es-AR"><head><meta charset="UTF-8"><title>DM Gestión</title>
<style>
  html,body{margin:0;height:100%;background:#0b1f3b;color:#dceafc;overflow:hidden;
    font-family:"Segoe UI",system-ui,sans-serif;user-select:none;-webkit-app-region:drag}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  img{width:88px;height:88px}
  h1{margin:0;font-size:20px;font-weight:600;letter-spacing:.3px;color:#fff}
  .giro{width:26px;height:26px;border:3px solid rgba(220,234,252,.25);border-top-color:#93bcf0;
    border-radius:50%;animation:g .8s linear infinite}
  p{margin:0;font-size:13px;opacity:.75}
  @keyframes g{to{transform:rotate(360deg)}}
</style></head>
<body><img src="${icono}" alt=""><h1>DM Gestión</h1><div class="giro"></div><p>Iniciando…</p></body></html>`

/**
 * Muestra la pantalla de carga y avisa (`listo`) cuando ya está a la vista, o pasado un rato si no
 * llega a estarlo. El arranque pesado (la base, las migraciones) es sincrónico y traba el proceso
 * principal: si arrancara antes de que la ventanita se muestre, la ventanita aparecería recién al
 * final, que es justo lo que se quiere evitar.
 */
export function mostrarPantallaDeCarga(listo: () => void): void {
  let avisado = false
  const avisar = () => {
    if (avisado) return
    avisado = true
    clearTimeout(reloj)
    // Un respiro para que Windows procese el «mostrar» antes de que el arranque sincrónico ocupe el
    // proceso principal.
    setTimeout(listo, 30)
  }
  const reloj = setTimeout(avisar, ESPERA_MAXIMA_MS)

  try {
    ventana = new BrowserWindow({
      width: 360,
      height: 260,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      // Que no se pueda cerrar a mano: cerrarla dejaría el programa sin ventanas y se saldría a mitad
      // del arranque. Se destruye desde el código.
      closable: false,
      center: true,
      show: false,
      title: 'DM Gestión',
      backgroundColor: '#0b1f3b',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    })
    ventana.once('ready-to-show', () => {
      ventana?.show()
      avisar()
    })
    ventana.on('closed', () => {
      ventana = null
    })
    ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`).catch(() => avisar())
  } catch (error) {
    console.error('[arranque] No se pudo mostrar la pantalla de carga:', error)
    ventana = null
    avisar()
  }
}

/** Saca la pantalla de carga. Se puede llamar varias veces. */
export function cerrarPantallaDeCarga(): void {
  const actual = ventana
  ventana = null
  if (actual && !actual.isDestroyed()) actual.destroy()
}

/** Trae al frente la pantalla de carga, si todavía está (otro doble click mientras abre). */
export function enfocarPantallaDeCarga(): boolean {
  if (!ventana || ventana.isDestroyed()) return false
  ventana.focus()
  return true
}
