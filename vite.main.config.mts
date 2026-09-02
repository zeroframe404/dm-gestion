// Configuración de Vite para el proceso principal de Electron.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externos = [
  'electron',
  'better-sqlite3',
  'bcryptjs',
  '@googleapis/sheets',
  'pdfjs-dist',
  // El adaptador de DNRPA hace `import()` de esta subruta puntual: el nombre del paquete solo no
  // alcanza para que rolldown la deje afuera del bundle, hace falta la ruta exacta.
  'pdfjs-dist/legacy/build/pdf.mjs',
  ...builtinModules,
  ...builtinModules.map((modulo) => 'node:' + modulo),
]

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/main',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      external: externos,
    },
  },
})
