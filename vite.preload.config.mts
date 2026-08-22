// Configuración de Vite para el script de precarga (puente entre renderer y proceso principal).
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externos = ['electron', ...builtinModules, ...builtinModules.map((modulo) => 'node:' + modulo)]

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/preload',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      external: externos,
    },
  },
})
