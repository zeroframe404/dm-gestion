// Corre UN solo archivo del banco de pruebas, sin esperar los dos minutos del banco entero:
//
//   npm run prueba:sola -- pruebas/dos-computadoras.prueba.ts
//
// Empaqueta ese archivo con la misma configuración que `npm run prueba` (ver vite.pruebas.config.mts)
// y lo corre con el runner de Node. Es para iterar sobre una prueba; antes de publicar corre el banco
// completo, que es el que cuenta.
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
const archivo = process.argv[2]
// PRUEBA_OUTDIR permite correr dos archivos a la vez sin que se pisen el empaquetado (dist/solo por defecto).
const outDir = process.env.PRUEBA_OUTDIR || 'dist/solo'
if (!archivo) {
  console.error('Uso: npm run prueba:sola -- pruebas/<archivo>.prueba.ts')
  process.exit(2)
}
// La misma lista que vite.pruebas.config.mts, donde está explicado por qué cada uno queda afuera.
const externos = ['electron','better-sqlite3','bcryptjs','@googleapis/sheets','node:test','ws',...builtinModules,...builtinModules.map((m)=>'node:'+m)]
await build({
  configFile: false, publicDir: false, logLevel: 'error',
  build: { outDir, emptyOutDir: true, target: 'node22', minify: false, sourcemap: 'inline',
    lib: { entry: { solo: resolve(archivo) }, formats: ['cjs'], fileName: (_f, n) => n + '.js' },
    rolldownOptions: { external: externos } },
})
execFileSync('node', ['--test-reporter=spec', resolve(outDir, 'solo.js')], { stdio: 'inherit' })
