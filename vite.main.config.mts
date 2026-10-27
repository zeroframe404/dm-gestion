// Configuración de Vite para el proceso principal de Electron.
import { builtinModules } from 'node:module'
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

export default defineConfig({
  publicDir: false,
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
