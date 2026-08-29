// Empaqueta el generador del manual a un archivo que corre en Node, para poder sacar el PDF sin abrir
// la aplicación. Es un calco de vite.pruebas.config.mts: mismo motivo (un solo archivo, sin Electron)
// y mismas exclusiones.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/manual',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    lib: {
      entry: { manual: 'src/renderer/ayuda/manual.ts' },
      formats: ['cjs'],
      fileName: (_formato, nombre) => nombre + '.js',
    },
    rolldownOptions: {
      external: [...builtinModules, ...builtinModules.map((modulo) => 'node:' + modulo)],
    },
  },
})
