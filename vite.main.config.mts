// Configuración de Vite para el proceso principal de Electron.
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { quitarSecretos } from './scripts/secretos-de-la-agencia.mjs'

const externos = [
  'electron',
  'better-sqlite3',
  'bcryptjs',
  '@googleapis/sheets',
  ...builtinModules,
  ...builtinModules.map((modulo) => 'node:' + modulo),
]

/**
 * El armado de la demo (`scripts/dist-demo.mjs`) compila con `DM_GESTION_DEMO=1`: el instalador se le
 * entrega a otras empresas y no puede llevar adentro los tokens ni las direcciones de la agencia.
 */
const armandoLaDemo = process.env.DM_GESTION_DEMO === '1'

function sinSecretosDeLaAgencia(): Plugin {
  return {
    name: 'dm-sin-secretos-de-la-agencia',
    enforce: 'pre',
    transform(codigo, id) {
      const limpio = quitarSecretos(id, codigo)
      return limpio === null ? null : { code: limpio, map: null }
    },
  }
}

/**
 * `ws` (el servidor del canal en vivo del simulador que corre adentro de la demo, ver
 * `src/main/demo/servidor.ts`) exporta una versión «browser» que sólo tira error, y Vite la elige por
 * defecto. Se apunta a mano a la de Node.
 */
const wsDeNode = path.join(path.dirname(createRequire(import.meta.url).resolve('ws/package.json')), 'wrapper.mjs')

export default defineConfig({
  publicDir: false,
  resolve: { alias: { ws: wsDeNode } },
  plugins: armandoLaDemo ? [sinSecretosDeLaAgencia()] : [],
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
