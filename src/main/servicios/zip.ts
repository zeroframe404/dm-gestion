// Lo mínimo para abrir un .zip sin librerías (sólo «deflate» o sin comprimir) y para decodificar texto
// que puede venir en UTF-8 o en Latin-1. Nació en el lector de tablas de ATM (aseguradoras/atm/tablas.ts,
// que lo re-exporta) y lo usa también el lector de Excel del alta (importacion/lectorDeLibro.ts): un
// .xlsx es un .zip con unos XML adentro.
import { inflateRawSync } from 'node:zlib'

export interface ArchivoSuelto {
  nombre: string
  bytes: Buffer
}

/** Los archivos que hay adentro de un .zip (sólo los comprimidos con «deflate» o sin comprimir). */
export function archivosDelZip(zip: Buffer): ArchivoSuelto[] {
  // El directorio central está al final: se busca la firma del «fin de directorio» de atrás para adelante.
  let fin = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('El .zip está dañado (no tiene directorio).')
  const cantidad = zip.readUInt16LE(fin + 10)
  let posicion = zip.readUInt32LE(fin + 16)
  const archivos: ArchivoSuelto[] = []
  for (let n = 0; n < cantidad; n++) {
    if (zip.readUInt32LE(posicion) !== 0x02014b50) throw new Error('El .zip está dañado (directorio ilegible).')
    const metodo = zip.readUInt16LE(posicion + 10)
    const comprimido = zip.readUInt32LE(posicion + 20)
    const largoNombre = zip.readUInt16LE(posicion + 28)
    const largoExtra = zip.readUInt16LE(posicion + 30)
    const largoComentario = zip.readUInt16LE(posicion + 32)
    const local = zip.readUInt32LE(posicion + 42)
    const nombre = zip.subarray(posicion + 46, posicion + 46 + largoNombre).toString('utf8')
    posicion += 46 + largoNombre + largoExtra + largoComentario
    if (nombre.endsWith('/')) continue
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`El .zip está dañado (${nombre}).`)
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const datos = zip.subarray(inicio, inicio + comprimido)
    if (metodo === 0) archivos.push({ nombre, bytes: Buffer.from(datos) })
    else if (metodo === 8) archivos.push({ nombre, bytes: inflateRawSync(datos) })
    else throw new Error(`El .zip usa una compresión que no se puede leer (${nombre}).`)
  }
  return archivos
}

/** UTF-8 si lo es (con o sin BOM); si no, Latin-1, que es como suelen salir los sistemas viejos. */
export function decodificar(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}
