// Punto de entrada del renderer.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { canalDelPrograma } from './canal'
import { ProveedorSesion } from './contexto/Sesion'
import { precargarSonidos } from './sonidos'
import { iniciarTema } from './tema'
import { iniciarZoom } from './zoom'
import './fuentes/fonts.css'
import './estilos.css'

// El tema se pone antes que nada: si se aplicara desde un componente, la pantalla aparecería en claro
// y saltaría a oscuro delante de quien la está mirando.
iniciarTema()

// El zoom se pone antes de dibujar nada —si no, la pantalla aparece al 100 % y salta— y desde acá
// quedan andando Ctrl + / − / 0 y Ctrl con la rueda en toda la aplicación, también en el ingreso.
iniciarZoom()

// Los tres avisos sonoros se dejan cargados de entrada: si no, el primero del día suena tarde, que
// es cuando ya no sirve para nada.
precargarSonidos()

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('No se encontró el elemento raíz (#raiz).')

// El canal (estable, beta o demo) se pregunta antes de dibujar: es una consulta al proceso principal que
// contesta al instante, y sin ella el primer cuadro del ingreso y de la barra lateral de la demo saldría
// con el nombre de la agencia y cambiaría un momento después. Si por lo que sea no contesta, a los dos
// segundos se dibuja igual: más vale un nombre equivocado un instante que una pantalla en blanco.
const MAXIMO_PARA_ESPERAR_EL_CANAL = 2000

void Promise.race([canalDelPrograma(), new Promise((listo) => setTimeout(listo, MAXIMO_PARA_ESPERAR_EL_CANAL))]).finally(() => {
  createRoot(raiz).render(
    <StrictMode>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </StrictMode>,
  )
})
