// Arma el instalador de la ESTABLE (`npm run dist`): electron-builder con electron-builder.yml y, si hay
// certificado cargado, firmado (ver scripts/firma.mjs). La beta tiene el suyo: scripts/dist-beta.mjs.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { argumentosDeFirma } from './firma.mjs'

const raiz = path.resolve(import.meta.dirname, '..')
const electronBuilder = path.join(raiz, 'node_modules', 'electron-builder', 'cli.js')
const args = [electronBuilder, '--win', '--config', 'electron-builder.yml', '--publish', 'never', ...argumentosDeFirma()]
execFileSync(process.execPath, args, { cwd: raiz, stdio: 'inherit' })
