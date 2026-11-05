// La versión de demostración (canal «demo», ver `shared/canal.ts` y `main/demo/`): lo que tienen que
// saber las dos puntas. El proceso principal crea estos usuarios en el servidor simulado y la pantalla
// de ingreso los ofrece para entrar con un click, así quien prueba la demo no tiene que adivinar nada.
import { SUCURSALES, type NombreDeSucursal } from './sucursales'

/** Cómo se llama la agencia en la demo: arriba del nombre del programa, en los mensajes y en los PDF. */
export const NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO = 'Seguros Demo'

/** La misma contraseña para todos: es una demo con datos inventados, no hay nada que proteger. */
export const CLAVE_DE_LA_DEMO = 'admin'

export interface UsuarioDeLaDemo {
  usuario: string
  nombre: string
  rol: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLEADO'
  sucursal: string
  /** Qué se ve entrando con éste: va en la pantalla de ingreso. */
  descripcion: string
}

/**
 * Uno por rol y por sucursal, para poder ver cómo cambia el programa según quién entra. Nombres
 * inventados: ninguno es de la gente de la agencia. La sucursal va por posición en SUCURSALES (la demo
 * compila con sus propias sucursales, ver shared/sucursales.ts; el banco de pruebas, con las de la agencia).
 */
export const USUARIOS_DE_LA_DEMO: readonly UsuarioDeLaDemo[] = [
  // El acceso que se le pasa al cliente: usuario «test», contraseña «admin». Ve y configura todo.
  { usuario: 'test', nombre: 'Usuario de Prueba', rol: 'SUPER_ADMIN', sucursal: SUCURSALES[0], descripcion: 'Acceso de prueba: ve y configura todo.' },
  { usuario: 'demo', nombre: 'Valentina Ocampo', rol: 'SUPER_ADMIN', sucursal: SUCURSALES[0], descripcion: 'Dueña de la agencia: ve y configura todo.' },
  { usuario: 'admin', nombre: 'Esteban Quintana', rol: 'ADMIN', sucursal: SUCURSALES[1], descripcion: 'Encargado: administra su sucursal y la base.' },
  { usuario: 'rocio', nombre: 'Rocío Albornoz', rol: 'EMPLEADO', sucursal: SUCURSALES[2], descripcion: 'Mostrador: cobra, carga y atiende.' },
  { usuario: 'tobias', nombre: 'Tobías Lescano', rol: 'EMPLEADO', sucursal: SUCURSALES[0], descripcion: `Mostrador de ${SUCURSALES[0]}.` },
  { usuario: 'camila', nombre: 'Camila Arce', rol: 'EMPLEADO', sucursal: SUCURSALES[1], descripcion: `Mostrador de ${SUCURSALES[1]}.` },
  { usuario: 'ignacio', nombre: 'Ignacio Bertolotti', rol: 'EMPLEADO', sucursal: SUCURSALES[3], descripcion: 'Productor con cartera propia.' },
]

/**
 * El encabezado del ticket de cada sucursal en la demo: direcciones y teléfonos inventados a propósito
 * (calles que no existen, teléfonos 5555), porque el ticket se le muestra a otras agencias y no puede
 * llevar los datos de los mostradores de verdad. Lo usan las dos puntas del proceso principal: el
 * servidor simulado lo publica como ajuste compartido (`demo/servidor.ts`) y las preferencias lo toman
 * como valor de fábrica mientras ese ajuste no llegó (`servicios/preferencias.ts`), así el ticket sale
 * igual desde el primer arranque. Las localidades salen de la sucursal, así no quedan nombres de otra lista.
 */
const DATOS_INVENTADOS_DEL_TICKET = [
  { calle: 'Av. Siempreviva 742', telefono: '11 5555-0001' },
  { calle: 'Calle Falsa 123', telefono: '11 5555-0002' },
  { calle: 'Av. de los Ejemplos 500', telefono: '11 5555-0003' },
  { calle: 'Pasaje Inventado 45', telefono: '11 5555-0000', nota: ' (atención con turno)' },
] as const

export const ENCABEZADOS_DE_TICKET_DE_LA_DEMO: Readonly<Partial<Record<NombreDeSucursal, { direccion: string; telefono: string }>>> = Object.fromEntries(
  SUCURSALES.map((sucursal, i) => {
    const dato = DATOS_INVENTADOS_DEL_TICKET[i] ?? DATOS_INVENTADOS_DEL_TICKET[0]
    return [sucursal, { direccion: `${dato.calle}, ${sucursal}${'nota' in dato ? dato.nota : ''}`, telefono: dato.telefono }]
  }),
)

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
