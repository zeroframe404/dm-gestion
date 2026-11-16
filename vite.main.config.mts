// Configuración de Vite para el proceso principal de Electron.
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { ponerSecretosDeFabrica } from './scripts/secretos-de-fabrica.mjs'
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
 * El instalador de la agencia (la estable y la beta) lleva el token del puente con el servidor, que NO
 * está escrito en el código: sale de los secretos de GitHub Actions y se pone acá, al compilar (ver
 * `scripts/secretos-de-fabrica.mjs`). Sin la variable —en desarrollo, en las pruebas— no toca nada.
 */
function conSecretosDeFabrica(): Plugin {
  return {
    name: 'dm-con-secretos-de-fabrica',
    enforce: 'pre',
    transform(codigo, id) {
      const armado = ponerSecretosDeFabrica(id, codigo)
      return armado === null ? null : { code: armado, map: null }
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
  plugins: armandoLaDemo ? [sinSecretosDeLaAgencia()] : [conSecretosDeFabrica()],
  build: {
    outDir: 'dist/main',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    // La demo va sin mapas de fuentes: llevarían el código original entero (comentarios incluidos)
    // adentro del instalador que se le entrega a otras empresas.
    sourcemap: !armandoLaDemo,
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
