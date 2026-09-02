// Punto de entrada del renderer.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ProveedorSesion } from './contexto/Sesion'
import { precargarSonidos } from './sonidos'
import { iniciarZoom } from './zoom'
import './fuentes/fonts.css'
import './estilos.css'

// El zoom se pone antes de dibujar nada —si no, la pantalla aparece al 100 % y salta— y desde acá
// quedan andando Ctrl + / − / 0 y Ctrl con la rueda en toda la aplicación, también en el ingreso.
iniciarZoom()

// Los tres avisos sonoros se dejan cargados de entrada: si no, el primero del día suena tarde, que
// es cuando ya no sirve para nada.
precargarSonidos()

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('No se encontró el elemento raíz (#raiz).')

createRoot(raiz).render(
  <StrictMode>
    <ProveedorSesion>
      <App />
    </ProveedorSesion>
  </StrictMode>,
)
