// Configuración de Vite para el banco de pruebas: empaqueta `pruebas/todas.ts` a un solo archivo
// que corre en Node con el runner incorporado (`node:test`). Ver `npm run prueba`.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externos = [
  'electron',
  'better-sqlite3',
  'bcryptjs',
  '@googleapis/sheets',
  ...builtinModules,
  ...builtinModules.map((modulo) => 'node:' + modulo),
]

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/pruebas',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: 'inline',
    lib: {
      entry: { todas: 'pruebas/todas.ts', copia: 'pruebas/copia.ts', sembrar: 'pruebas/sembrar.ts' },
      formats: ['cjs'],
      fileName: (_formato, nombre) => nombre + '.js',
    },
    rolldownOptions: {
      external: externos,
    },
  },
})
