// Configuración de Vite para el banco de pruebas: empaqueta `pruebas/todas.ts` a un solo archivo
// que corre en Node con el runner incorporado (`node:test`). Ver `npm run prueba`.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externos = [
  'electron',
  'better-sqlite3',
  'bcryptjs',
  '@googleapis/sheets',
  // `node:test` no está en `builtinModules` (Node sólo lo expone con el prefijo `node:`), así que hay que
  // nombrarlo aparte: si no, Vite lo reemplaza por el stub de navegador y el banco de pruebas no arranca.
  'node:test',
  // 14.0: el simulador del VPS levanta el canal en vivo con `ws`, y el simulador se empaqueta acá
  // adentro (`scripts/vps-simulado.mjs` lo importan las pruebas). Externo porque `ws` carga sus
  // extensiones nativas opcionales con `require` a mano: empaquetado, esas cargas se rompen. En el
  // programa de verdad no entra nunca —el main usa el `WebSocket` global de Node 22—, por eso vive en
  // devDependencies y sólo en esta configuración.
  'ws',
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
