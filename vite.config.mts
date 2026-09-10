// Configuración de Vite para el renderer (la interfaz React).
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const raiz = fileURLToPath(new URL('.', import.meta.url))

/**
 * Política de seguridad de contenido para la app empaquetada.
 * En desarrollo no se aplica porque Vite necesita scripts inline y WebSockets para la recarga.
 */
const POLITICA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // Los sonidos de aviso se empaquetan con la app (`'self'`). `blob:` es por las llamadas de voz
  // (14.0): el audio de la otra computadora llega como un `MediaStream` y el `<audio>` que lo hace
  // sonar cuelga de una URL de blob. `connect-src 'self'` queda como está: WebRTC no se rige por él
  // —los candidatos y el audio van por UDP, no por fetch— y el canal en vivo vive en el proceso
  // principal, que no tiene CSP.
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function cspEnProduccion(): Plugin {
  return {
    name: 'dm-csp-produccion',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: POLITICA_CSP },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  // Rutas relativas: la app empaquetada carga el HTML desde el disco (file://).
  base: './',
  plugins: [react(), tailwindcss(), cspEnProduccion()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // No hay carpeta public/: las fuentes se importan desde el CSS.
  publicDir: false,
  envDir: raiz,
})
