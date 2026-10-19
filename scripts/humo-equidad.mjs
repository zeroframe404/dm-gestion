// Humo en vivo contra la API de La Equidad (ver pruebas/humo-equidad.ts, donde está qué prueba y cómo):
//
//   npm run humo:equidad                    prueba, con EQUIDAD_PRUEBA_URL / _USUARIO / _PASSWORD
//   npm run humo:equidad -- --produccion    producción, con EQUIDAD_PROD_*
//
// Empaqueta el .ts con la misma configuración que `npm run prueba:sola` y lo corre con Node.
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'

const outDir = 'dist/humo-equidad'
// La misma lista que vite.pruebas.config.mts, donde está explicado por qué cada uno queda afuera.
const externos = ['electron', 'better-sqlite3', 'bcryptjs', '@googleapis/sheets', 'node:test', 'ws', ...builtinModules, ...builtinModules.map((m) => 'node:' + m)]
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: 'inline',
    lib: { entry: { humo: resolve('pruebas/humo-equidad.ts') }, formats: ['cjs'], fileName: (_f, n) => n + '.js' },
    rolldownOptions: { external: externos },
  },
})
try {
  execFileSync('node', ['--enable-source-maps', resolve(outDir, 'humo.js'), ...process.argv.slice(2)], { stdio: 'inherit' })
} catch {
  process.exit(1)
}
