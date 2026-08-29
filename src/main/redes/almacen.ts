// El vínculo con Meta, guardado y cifrado por el sistema operativo.
//
// Adentro va el token de la Página, que NO vence y que publica en nombre de la agencia. Por eso no
// puede vivir en la base —que cualquiera abre con un cliente SQLite— ni en config.json en texto
// plano: va a %APPDATA%/dm-gestion/redes.bin, cifrado con safeStorage (DPAPI en Windows, atado a la
// cuenta de Windows de esa computadora), exactamente con el criterio de `usuarios/credencial.ts`.
//
// Si el sistema no puede cifrar, no se guarda nada y la pantalla lo dice. Es preferible tener que
// vincular de nuevo que dejar el token de la agencia escrito en un archivo.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Cifrador } from '../usuarios/credencial'

export interface VinculoDeRedes {
  formato: 1
  paginaId: string
  paginaNombre: string
  /** El token de la Página. No vence, pero se cae si cambian la contraseña o sacan la app. */
  paginaToken: string
  instagramId: string | null
  instagramUsuario: string | null
  /** Quién vinculó, para que el historial pueda decirlo. */
  vinculadoPor: string
  vinculadoEn: string
}

export class AlmacenDeVinculo {
  constructor(
    readonly ruta: string,
    private readonly cifrador: Cifrador,
  ) {}

  puedeCifrar(): boolean {
    return this.cifrador.disponible()
  }

  /**
   * null si no hay vínculo o no se puede leer. Un archivo que no descifra (cifrado por otra cuenta de
   * Windows, archivo dañado) se trata como «sin vincular» y se borra: hay que vincular otra vez, nada
   * peor.
   */
  leer(): VinculoDeRedes | null {
    if (!existsSync(this.ruta)) return null
    try {
      const datos = JSON.parse(this.cifrador.descifrar(readFileSync(this.ruta))) as Partial<VinculoDeRedes>
      if (
        datos.formato !== 1 ||
        typeof datos.paginaId !== 'string' ||
        typeof datos.paginaToken !== 'string' ||
        !datos.paginaId ||
        !datos.paginaToken
      ) {
        throw new Error('El vínculo guardado no tiene la forma esperada.')
      }
      return {
        formato: 1,
        paginaId: datos.paginaId,
        paginaNombre: typeof datos.paginaNombre === 'string' ? datos.paginaNombre : datos.paginaId,
        paginaToken: datos.paginaToken,
        instagramId: typeof datos.instagramId === 'string' ? datos.instagramId : null,
        instagramUsuario: typeof datos.instagramUsuario === 'string' ? datos.instagramUsuario : null,
        vinculadoPor: typeof datos.vinculadoPor === 'string' ? datos.vinculadoPor : '',
        vinculadoEn: typeof datos.vinculadoEn === 'string' ? datos.vinculadoEn : '',
      }
    } catch (error) {
      console.error('[redes] No se pudo leer el vínculo guardado; se descarta:', error instanceof Error ? error.message : error)
      this.borrar()
      return null
    }
  }

  /** Reemplaza el vínculo anterior. Devuelve false si el sistema no puede cifrar. */
  guardar(vinculo: Omit<VinculoDeRedes, 'formato'>): boolean {
    if (!this.cifrador.disponible()) {
      console.error('[redes] El sistema no puede cifrar: no se guarda el vínculo con Meta.')
      return false
    }
    const datos: VinculoDeRedes = { formato: 1, ...vinculo }
    mkdirSync(path.dirname(this.ruta), { recursive: true })
    const temporal = `${this.ruta}.tmp`
    writeFileSync(temporal, this.cifrador.cifrar(JSON.stringify(datos)), { mode: 0o600 })
    renameSync(temporal, this.ruta)
    return true
  }

  borrar(): void {
    if (existsSync(this.ruta)) unlinkSync(this.ruta)
  }
}

// El almacén se arma al arrancar (con safeStorage) y en las pruebas, con el cifrador de mentira.
let almacen: AlmacenDeVinculo | null = null

export function configurarAlmacenDeRedes(nuevo: AlmacenDeVinculo | null): void {
  almacen = nuevo
}

export function almacenDeRedes(): AlmacenDeVinculo | null {
  return almacen
}
