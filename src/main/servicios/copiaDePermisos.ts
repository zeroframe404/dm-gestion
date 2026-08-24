// La copia local de la matriz de permisos, en la tabla `configuracion`.
//
// Va en su propio archivo (y no dentro de permisos.ts) para que la pueda usar también
// baseDeUsuarios.ts sin que los dos módulos se importen en círculo: permisos.ts sabe de la base
// compartida, y la base compartida no tiene por qué saber de permisos.ts.
//
// Con base compartida esto es una copia de lo que dice `usuarios.json` y sirve para dos cosas:
// ingresar sin internet con los permisos del último ingreso con conexión, y arrancar el programa sin
// esperar a GitHub. Sin base compartida (desarrollo, o antes de subir los usuarios) es la fuente de
// verdad.
import { normalizarMatriz, permisosPorDefecto, type MatrizPermisos } from '../../shared/permisos'
import { db } from '../db/base'

const CLAVE = 'permisos_roles'
const CLAVE_FECHA = 'permisos_roles_actualizado'

/** Lo último que se escribió, para no volver a escribir la misma matriz en cada llamado. */
let ultimaEnDisco: string | null = null

/**
 * A quién avisarle que la copia cambió. Lo usa permisos.ts para enterarse de las matrices que bajan
 * de GitHub en la revalidación de la sesión, que no pasan por ningún control de permisos y por eso no
 * se notarían hasta el llamado siguiente.
 */
let alGuardar: ((permisos: MatrizPermisos) => void) | null = null

export function conectarAvisoDeCopia(nuevo: ((permisos: MatrizPermisos) => void) | null): void {
  alGuardar = nuevo
}

export function leerCopiaLocal(): MatrizPermisos {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE) as { valor: string } | undefined
  if (!fila) return permisosPorDefecto()
  try {
    return normalizarMatriz(JSON.parse(fila.valor))
  } catch {
    // Una copia ilegible no puede dejar a nadie afuera ni abrirle todo a nadie: se vuelve a lo de siempre.
    return permisosPorDefecto()
  }
}

export function guardarCopiaLocal(permisos: MatrizPermisos, marca: string): void {
  const texto = JSON.stringify(permisos)
  if (texto === ultimaEnDisco) return
  // Al arrancar el programa no hay nada en memoria y la primera lectura del archivo compartido pasa
  // por acá, aunque la matriz sea la misma de siempre. Si se escribiera igual, `actualizado_en`
  // pasaría a decir «cuándo abrí el programa» en vez de «cuándo cambió la matriz», que es lo que
  // muestra la pantalla de Permisos.
  const enLaBase = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE) as { valor: string } | undefined
  if (enLaBase?.valor === texto) {
    ultimaEnDisco = texto
    return
  }
  const guardar = db().prepare(
    `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
  )
  db().transaction(() => {
    guardar.run(CLAVE, texto, marca)
    guardar.run(CLAVE_FECHA, marca, marca)
  })()
  ultimaEnDisco = texto
  alGuardar?.(permisos)
}

/** Cuándo se guardó por última vez: la pantalla lo muestra al pie de la matriz. */
export function fechaDeLaCopia(): string | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_FECHA) as { valor: string } | undefined
  return fila?.valor ?? null
}

/** La base se abre de nuevo en cada prueba: la memoria de lo escrito no puede sobrevivirla. */
export function olvidarCopiaEnMemoria(): void {
  ultimaEnDisco = null
}
