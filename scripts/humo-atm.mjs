// Humo en vivo contra el web service de ATM (ver pruebas/humo-atm.ts, donde está qué prueba y cómo):
//
//   npm run humo:atm                    producción, con ATM_PROD_USUARIO / _PASSWORD / _VENDEDOR
//   npm run humo:atm -- --desarrollo    desarrollo, con ATM_DEV_USUARIO / _PASSWORD
//   npm run humo:atm -- --ftp           además exige que el FTP de las tablas ande
//
// Empaqueta el .ts con la misma configuración que `npm run prueba:sola` y lo corre con Node.
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'

const outDir = 'dist/humo-atm'
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
    lib: { entry: { humo: resolve('pruebas/humo-atm.ts') }, formats: ['cjs'], fileName: (_f, n) => n + '.js' },
    rolldownOptions: { external: externos },
  },
})
try {
  execFileSync('node', ['--enable-source-maps', resolve(outDir, 'humo.js'), ...process.argv.slice(2)], { stdio: 'inherit' })
} catch {
  process.exit(1)
}
