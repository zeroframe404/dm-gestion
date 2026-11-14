// La subida de una versión al servidor de la agencia (scripts/subir-al-vps.mjs): el orden (el .yml
// último), el token del publicador y que un fallo NUNCA tire abajo la publicación (GitHub es el respaldo).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { subirAlVps } from '../scripts/subir-al-vps.mjs'

async function servidor(responder: (url: string, auth: string | undefined) => number): Promise<{ base: string; pedidos: string[]; cerrar: () => Promise<void> }> {
  const pedidos: string[] = []
  const srv: Server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      pedidos.push(`${req.method} ${req.url}`)
      res.statusCode = responder(req.url ?? '', req.headers.authorization)
      res.end('{}')
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const direccion = srv.address()
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0
  return { base: `http://127.0.0.1:${puerto}/api/dmg-actualizaciones`, pedidos, cerrar: () => new Promise((r) => srv.close(() => r())) }
}

function archivos() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'subir-vps-'))
  const instalador = path.join(dir, 'DM-Gestion-Setup-18.1.3.exe')
  writeFileSync(instalador, 'exe')
  writeFileSync(`${instalador}.blockmap`, 'map')
  writeFileSync(path.join(dir, 'latest.yml'), 'version: 18.1.3\n')
  return { dir, instalador, blockmap: `${instalador}.blockmap`, yml: path.join(dir, 'latest.yml') }
}

test('sube instalador, blockmap y el .yml al final, con el token del publicador', async () => {
  const s = await servidor((_url, auth) => (auth === 'Bearer secreto' ? 201 : 401))
  const a = archivos()
  try {
    const ok = await subirAlVps({ canal: 'estable', ...a, token: 'secreto', base: s.base })
    assert.equal(ok, true)
    assert.deepEqual(s.pedidos, [
      'PUT /api/dmg-actualizaciones/estable/DM-Gestion-Setup-18.1.3.exe',
      'PUT /api/dmg-actualizaciones/estable/DM-Gestion-Setup-18.1.3.exe.blockmap',
      'PUT /api/dmg-actualizaciones/estable/latest.yml',
    ])
  } finally {
    await s.cerrar()
    rmSync(a.dir, { recursive: true, force: true })
  }
})

test('sin token, o si el servidor rechaza, avisa y no tira error (ni sube el .yml)', async () => {
  const s = await servidor(() => 401)
  const a = archivos()
  try {
    assert.equal(await subirAlVps({ canal: 'beta', ...a, token: '', base: s.base }), false)
    assert.equal(s.pedidos.length, 0, 'sin token ni lo intenta')
    assert.equal(await subirAlVps({ canal: 'beta', ...a, token: 'otro', base: s.base }), false)
    assert.equal(s.pedidos.length, 1, 'un 401 no se reintenta y corta antes del .yml')
  } finally {
    await s.cerrar()
    rmSync(a.dir, { recursive: true, force: true })
  }
})
