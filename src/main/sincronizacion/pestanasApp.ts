// Las pestañas que DM Gestión agrega a la hoja: APP LEADS, APP PRESUPUESTOS, APP TAREAS y APP RECHAZOS.
//
// Leads, presupuestos, tareas y los avisos de rechazo del débito no existen en el Excel de la agencia.
// Para que igual se puedan mirar desde Google —que es donde la agencia mira todo— la aplicación crea las
// pestañas al final del archivo, con sus encabezados, la primera vez que hay algo que subir a alguna.
//
// APP RECHAZOS además es el camino por el que el aviso llega a la otra sucursal: la escribe la
// computadora que avisa y la lee la de la sucursal avisada (ver importador.ts, `guardarRechazo`).
//
// Se crean tarde a propósito: una hoja de una agencia que todavía no cargó ni un lead no tiene por qué
// llenarse de pestañas vacías. Y se crean AL FINAL, nunca en el medio: el orden de las pestañas es lo
// que usa el importador para deducir el año de las planillas mensuales sin año en el título.
import type { TipoPestana } from '../../shared/tipos'
import { ENCABEZADO_ID } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import type { ContextoHoja } from './hoja'
import { anotarEvento } from './cola'

export interface PestanaDeLaApp {
  titulo: string
  tipo: TipoPestana
  /** Fila 1 de la pestaña. El _ID va último: es la columna con la que la sincronización la reconoce. */
  encabezados: string[]
}

/**
 * Los encabezados son los que la aplicación entiende de vuelta (ver AJUSTES_POR_TIPO en
 * importacion/encabezados.ts): están escritos como los escribiría la agencia, no con nombres técnicos.
 */
export const PESTANAS_DE_LA_APP: PestanaDeLaApp[] = [
  {
    titulo: 'APP LEADS',
    tipo: 'APP_LEADS',
    encabezados: [
      'FECHA',
      'LOCAL',
      'NOMBRE',
      'TELEFONO',
      'DNI/CUIT',
      'ORIGEN',
      'QUE ASEGURA',
      'TIPO',
      'ESTADO',
      'NOTAS',
      'CARGADO POR',
      ENCABEZADO_ID,
    ],
  },
  {
    titulo: 'APP PRESUPUESTOS',
    tipo: 'APP_PRESUPUESTOS',
    encabezados: [
      'FECHA',
      'NUMERO',
      'VERSION',
      'LOCAL',
      'NOMBRE',
      'TELEFONO',
      'DNI/CUIT',
      'PATENTE',
      'MARCA',
      'MODELO',
      'AÑO',
      'OPCIONES',
      'PRECIO DESDE',
      'ESTADO',
      'OBSERVACIONES',
      'CARGADO POR',
      ENCABEZADO_ID,
    ],
  },
  {
    titulo: 'APP TAREAS',
    tipo: 'APP_TAREAS',
    encabezados: [
      'FECHA',
      'TITULO',
      'DESCRIPCION',
      'ASIGNADO A',
      'LOCAL',
      'VENCE',
      'PRIORIDAD',
      'ESTADO',
      'VINCULO',
      'CREADO POR',
      ENCABEZADO_ID,
    ],
  },
  {
    titulo: 'APP RECHAZOS',
    tipo: 'APP_RECHAZOS',
    encabezados: [
      'FECHA',
      'LOCAL',
      'NOMBRE',
      'DNI/CUIT',
      'TELEFONO',
      'COMPAÑIA',
      'POLIZA',
      'PATENTE',
      'FORMA DE PAGO',
      'CUOTA',
      'MES',
      'MOTIVO',
      'OBSERVACIONES',
      'ESTADO',
      'CARGADO POR',
      ENCABEZADO_ID,
    ],
  },
]

const TITULOS = new Set(PESTANAS_DE_LA_APP.map((p) => p.titulo))

/** true si esa pestaña es una de las que crea la aplicación. */
export function esPestanaDeLaApp(titulo: string): boolean {
  return TITULOS.has(titulo)
}

/**
 * Crea en la hoja las pestañas de la aplicación que hagan falta y todavía no estén.
 *
 * `necesarias` son los títulos para los que hay algo esperando en la cola: no se crea la pestaña de
 * presupuestos porque alguien cargó un lead. Devuelve los títulos que se crearon (vacío = no hubo nada
 * que hacer), y con eso el motor sabe si tiene que releer la estructura de la hoja.
 *
 * Un error creando una pestaña no rompe el ciclo: se anota y la cola espera al siguiente. Que Google
 * esté caído no puede dejar a nadie sin poder cargar una tarea.
 */
export async function asegurarPestanasDeLaApp(fuente: FuenteHoja, contexto: ContextoHoja, necesarias: Iterable<string>): Promise<string[]> {
  const pedidas = new Set(necesarias)
  const faltantes = PESTANAS_DE_LA_APP.filter((p) => pedidas.has(p.titulo) && !contexto.porTitulo.has(p.titulo))
  if (faltantes.length === 0) return []

  const creadas: string[] = []
  for (const pestana of faltantes) {
    try {
      await fuente.crearPestana(pestana.titulo, pestana.encabezados)
      creadas.push(pestana.titulo)
      anotarEvento('pestana', `Se creó la pestaña «${pestana.titulo}» al final de la hoja, con sus encabezados.`)
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error)
      // Que ya exista no es un problema: alguien la creó desde otra computadora entre la lectura de la
      // estructura y ahora. Releyendo el contexto aparece y la cola sube sola en el ciclo siguiente.
      // («already exists» lo dice Google; «Ya existe» lo dice la base del VPS.)
      if (/already exists|ya existe/i.test(motivo)) {
        creadas.push(pestana.titulo)
        continue
      }
      anotarEvento('error', `No se pudo crear la pestaña «${pestana.titulo}»: ${motivo}`, { conError: true })
      throw error
    }
  }
  return creadas
}
