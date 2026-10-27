// La versión de demostración (canal «demo», ver `shared/canal.ts` y `main/demo/`): lo que tienen que
// saber las dos puntas. El proceso principal crea estos usuarios en el servidor simulado y la pantalla
// de ingreso los ofrece para entrar con un click, así quien prueba la demo no tiene que adivinar nada.

/** La misma contraseña para todos: es una demo con datos inventados, no hay nada que proteger. */
export const CLAVE_DE_LA_DEMO = 'demo1234'

export interface UsuarioDeLaDemo {
  usuario: string
  nombre: string
  rol: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLEADO'
  sucursal: string
  /** Qué se ve entrando con éste: va en la pantalla de ingreso. */
  descripcion: string
}

/** Uno por rol y por sucursal, para poder ver cómo cambia el programa según quién entra. */
export const USUARIOS_DE_LA_DEMO: readonly UsuarioDeLaDemo[] = [
  { usuario: 'demo', nombre: 'Martina Demo', rol: 'SUPER_ADMIN', sucursal: 'Dock Sud', descripcion: 'Dueña de la agencia: ve y configura todo.' },
  { usuario: 'admin', nombre: 'Carlos Ferreyra', rol: 'ADMIN', sucursal: 'Lanús', descripcion: 'Encargado: administra su sucursal y la base.' },
  { usuario: 'lucia', nombre: 'Lucía Gómez', rol: 'EMPLEADO', sucursal: 'Sarandí', descripcion: 'Mostrador: cobra, carga y atiende.' },
  { usuario: 'jorge', nombre: 'Jorge Paz', rol: 'EMPLEADO', sucursal: 'Dock Sud', descripcion: 'Mostrador de Dock Sud.' },
  { usuario: 'sofia', nombre: 'Sofía Benítez', rol: 'EMPLEADO', sucursal: 'Lanús', descripcion: 'Mostrador de Lanús.' },
  { usuario: 'daniel', nombre: 'Daniel Ruiz', rol: 'EMPLEADO', sucursal: 'Daniel', descripcion: 'Productor con cartera propia.' },
]

/** El token del servidor de demostración. No es secreto: el servidor sólo escucha en esta computadora. */
export const TOKEN_DE_LA_DEMO = 'demo-local'

/**
 * Cómo se ve la configuración de un VPS de verdad, para la pantalla «Servidor (VPS)»: el bloque que se
 * pega en el config.json del programa. Los valores son de ejemplo.
 */
export const EJEMPLO_URL_DEL_VPS = 'https://gestion.suagencia.com.ar'

/** Lo que la pantalla necesita saber del servidor de demostración que está corriendo. */
export interface EstadoDeLaDemo {
  /** Dirección local del servidor simulado (http://127.0.0.1:puerto). */
  urlDelServidor: string
  /** Cuándo se armaron los datos: la demo vuelve a este estado cada vez que se abre. */
  armadaEn: string
  pestanas: number
  filas: number
  usuarios: number
}

/** El resultado de «Probar conexión» en la demo: los mismos pasos que haría el programa de verdad. */
export interface PasoDePruebaDeVps {
  paso: string
  ok: boolean
  detalle: string
}
