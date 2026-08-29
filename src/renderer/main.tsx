// Punto de entrada del renderer.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ProveedorSesion } from './contexto/Sesion'
import { precargarSonidos } from './sonidos'
import './fuentes/fonts.css'
import './estilos.css'

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
