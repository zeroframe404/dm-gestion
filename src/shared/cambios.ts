// Historial de cambios de DM Gestión: lo que muestra el cartel «Cambios recientes» al ingresar después de
// una actualización y la ventana «Históricos» de Acerca de. Al sacar una versión nueva se AGREGA una entrada
// arriba de todo (la más nueva primero). Las versiones beta (17.7.5-beta.3) usan la entrada de su número base.

export type TipoDeCambio = 'agregado' | 'modificado' | 'corregido' | 'eliminado'

export interface Cambio {
  tipo: TipoDeCambio
  texto: string
}

export interface VersionConCambios {
  version: string
  /** AAAA-MM-DD */
  fecha: string
  cambios: Cambio[]
}

export const ETIQUETA_DE_TIPO: Record<TipoDeCambio, string> = {
  agregado: 'Agregado',
  modificado: 'Modificado',
  corregido: 'Corregido',
  eliminado: 'Eliminado',
}

export const HISTORIAL_DE_CAMBIOS: VersionConCambios[] = [
  {
    version: '17.7.5',
    fecha: '2026-10-31',
    cambios: [
      { tipo: 'agregado', texto: 'Cartel «Cambios recientes» al ingresar después de cada actualización y botón «Históricos» en Acerca de.' },
      { tipo: 'agregado', texto: 'Mi link: sección nueva con Mi página, Solicitudes, Siniestros y Métricas.' },
      { tipo: 'modificado', texto: 'Cartera: Grupos pasa a llamarse Flotas, con indicador y pestaña de almacenamiento en la nube.' },
      { tipo: 'modificado', texto: 'Cartera y Cobranzas: grupos de menú con sus listados (Asegurados, Pólizas, Siniestros, Vencimientos, Rechazos y Comisiones).' },
      { tipo: 'agregado', texto: 'Multicotizador: opción «Otro» (no binario / X) en Sexo, y DNI y CUIT con formato mientras se escriben.' },
      { tipo: 'corregido', texto: 'IMPUTADOS sin encabezados: la sincronización vuelve a subir y bajar los pagos.' },
    ],
  },
  {
    version: '17.7.3',
    fecha: '2026-10-31',
    cambios: [
      { tipo: 'agregado', texto: 'Impresora común (hoja A4) como alternativa a la ticketeadora térmica.' },
      { tipo: 'modificado', texto: 'Multicotizador: el modelo espera al año; se agregan «Otros usos» y la marca «Otro rastreador».' },
      { tipo: 'corregido', texto: 'Redes sociales: el ejemplo de la dirección de vuelta ya no lleva el dominio de la agencia.' },
      { tipo: 'corregido', texto: 'Equidad: la URL base se corta en /servlet/ y se limpian los espacios invisibles al pegar.' },
    ],
  },
  {
    version: '17.7.2',
    fecha: '2026-10-22',
    cambios: [
      { tipo: 'agregado', texto: 'Multicotizador con sublista: cotizar auto y moto, cotizaciones, planes y emisiones.' },
      { tipo: 'modificado', texto: 'Multicotizador: formulario en grilla 2×2 (asegurado, vehículo, cotización y accesorios).' },
      { tipo: 'corregido', texto: 'Mercantil: si con débito contesta MCA500, se cotiza con cupón y se explica el error sin el JSON crudo.' },
    ],
  },
  {
    version: '17.7.1',
    fecha: '2026-10-20',
    cambios: [{ tipo: 'modificado', texto: 'Mercantil: se cotiza con la forma real de su API.' }],
  },
]

/** `17.7.5-beta.41` → `[17, 7, 5]` */
function partes(version: string): number[] {
  return version
    .split('-')[0]!
    .split('.')
    .map((parte) => Number.parseInt(parte, 10) || 0)
}

export function compararVersiones(a: string, b: string): number {
  const x = partes(a)
  const y = partes(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diferencia = (x[i] ?? 0) - (y[i] ?? 0)
    if (diferencia !== 0) return diferencia
  }
  return 0
}

/**
 * Las versiones que hay que mostrar al ingresar: las posteriores a la última que esa persona vio y hasta la
 * instalada. Si nunca vio ninguna, sólo la actual (no se vuelca todo el historial de golpe).
 */
export function cambiosPendientes(versionActual: string, ultimaVista: string | null, historial = HISTORIAL_DE_CAMBIOS): VersionConCambios[] {
  const hastaActual = historial.filter((entrada) => compararVersiones(entrada.version, versionActual) <= 0)
  if (!ultimaVista) return hastaActual.slice(0, 1)
  return hastaActual.filter((entrada) => compararVersiones(entrada.version, ultimaVista) > 0)
}
