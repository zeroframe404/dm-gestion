// Configuración de Vite para el banco de pruebas: empaqueta `pruebas/todas.ts` a un solo archivo
// que corre en Node con el runner incorporado (`node:test`). Ver `npm run prueba`.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externos = [
  'electron',
  'better-sqlite3',
  'bcryptjs',
  '@googleapis/sheets',
  // pdfjs-dist (el adaptador de DNRPA) resuelve su propio require(import.meta.url) para el polyfill de
  // Node; empaquetado por Vite ese import.meta.url deja de ser el real y la carga se rompe. Externo se
  // deja tal cual se resuelve en node_modules, igual que en producción.
  'pdfjs-dist',
  // El adaptador de DNRPA hace `import()` de esta subruta puntual: el nombre del paquete solo no
  // alcanza para que rolldown la deje afuera del bundle, hace falta la ruta exacta.
  'pdfjs-dist/legacy/build/pdf.mjs',
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
