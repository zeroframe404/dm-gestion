// La credencial guardada para ingresar sin internet.
//
// En cada computadora queda UNA sola: la del último usuario que ingresó con internet. Se guarda el
// hash bcrypt de su contraseña (nunca la contraseña), más el perfil que hace falta para abrir la
// sesión, todo cifrado por el sistema operativo (en Electron, `safeStorage` → DPAPI de Windows, atado
// a la cuenta de Windows de esa computadora). El cifrador se inyecta para poder probar esto en Node.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROLES, type Rol } from '../../shared/tipos'

export interface Cifrador {
  /** false si el sistema no puede cifrar (por ejemplo, sin sesión de usuario): entonces no se guarda nada. */
  disponible(): boolean
  cifrar(texto: string): Buffer
  descifrar(datos: Buffer): string
}

export interface CredencialGuardada {
  formato: 1
  /** Id del usuario en GitHub, para encontrar su fila del espejo local. */
  remotoId: number
  usuario: string
  claveHash: string
  /**
   * Con qué permisos se abre la sesión sin internet. Va adentro del blob cifrado a propósito: la sesión
   * offline se arma desde acá y no desde la tabla local, que cualquiera con acceso a la carpeta podría
   * editar con un cliente SQLite.
   */
  nombre: string
  rol: Rol
  sucursal: string
  guardadoEn: string
}

/** Pasados estos días sin ingresar con internet, la credencial deja de valer. */
export const DIAS_DE_VALIDEZ = 30

export function estaVencida(credencial: CredencialGuardada, ahora: Date): boolean {
  const guardada = new Date(credencial.guardadoEn).getTime()
  if (Number.isNaN(guardada)) return true
  return ahora.getTime() - guardada > DIAS_DE_VALIDEZ * 24 * 60 * 60 * 1000
}

export class AlmacenDeCredencial {
  constructor(
    readonly ruta: string,
    private readonly cifrador: Cifrador,
  ) {}

  /**
   * null si no hay credencial o no se puede leer. Un archivo que no descifra (cifrado por otra cuenta
   * de Windows, carpeta `sesion/` borrada, archivo dañado) se trata como «sin credencial» y se borra:
   * va a hacer falta ingresar con internet una vez más, nada peor.
   */
  leer(): CredencialGuardada | null {
    if (!existsSync(this.ruta)) return null
    try {
      const texto = this.cifrador.descifrar(readFileSync(this.ruta))
      const datos = JSON.parse(texto) as Partial<CredencialGuardada>
      if (
        datos.formato !== 1 ||
        typeof datos.remotoId !== 'number' ||
        typeof datos.usuario !== 'string' ||
        typeof datos.claveHash !== 'string' ||
        typeof datos.nombre !== 'string' ||
        typeof datos.sucursal !== 'string' ||
        typeof datos.rol !== 'string' ||
        !(ROLES as readonly string[]).includes(datos.rol) ||
        !datos.usuario ||
        !datos.claveHash
      ) {
        throw new Error('La credencial guardada no tiene la forma esperada.')
      }
      return {
        formato: 1,
        remotoId: datos.remotoId,
        usuario: datos.usuario,
        claveHash: datos.claveHash,
        nombre: datos.nombre,
        rol: datos.rol as Rol,
        sucursal: datos.sucursal,
        guardadoEn: typeof datos.guardadoEn === 'string' ? datos.guardadoEn : '',
      }
    } catch (error) {
      console.error('[credencial] No se pudo leer la credencial guardada; se descarta:', error instanceof Error ? error.message : error)
      this.borrar()
      return null
    }
  }

  usuarioGuardado(): string | null {
    return this.leer()?.usuario ?? null
  }

  puedeCifrar(): boolean {
    return this.cifrador.disponible()
  }

  /** Reemplaza la credencial anterior, si había. Devuelve false si el sistema no puede cifrar. */
  guardar(credencial: Omit<CredencialGuardada, 'formato'>): boolean {
    if (!this.cifrador.disponible()) {
      console.error('[credencial] El sistema no puede cifrar: no se guarda la credencial para ingresar sin internet.')
      return false
    }
    const datos: CredencialGuardada = { formato: 1, ...credencial }
    mkdirSync(path.dirname(this.ruta), { recursive: true })
    // Escritura atómica: primero a un archivo temporal y después se renombra.
    const temporal = `${this.ruta}.tmp`
    writeFileSync(temporal, this.cifrador.cifrar(JSON.stringify(datos)), { mode: 0o600 })
    renameSync(temporal, this.ruta)
    return true
  }

  borrar(): void {
    if (existsSync(this.ruta)) unlinkSync(this.ruta)
  }
}

// ---------------------------------------------------------------------------
// Sólo para las pruebas
// ---------------------------------------------------------------------------

/** Cifrador de mentira para las pruebas en Node: reversible, sin seguridad. */
export function cifradorDePrueba(disponible = true): Cifrador {
  const MARCA = 'prueba:'
  return {
    disponible: () => disponible,
    cifrar: (texto) => Buffer.from(MARCA + Buffer.from(texto, 'utf8').toString('base64'), 'utf8'),
    descifrar: (datos) => {
      const texto = datos.toString('utf8')
      if (!texto.startsWith(MARCA)) throw new Error('No está cifrado con el cifrador de prueba.')
      return Buffer.from(texto.slice(MARCA.length), 'base64').toString('utf8')
    },
  }
}
