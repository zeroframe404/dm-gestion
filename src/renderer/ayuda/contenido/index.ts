import type { ContenidoDeAyuda } from '../tipos'
import { AYUDA_ADMINISTRACION } from './administracion'
import { AYUDA_API_ASEGURADORAS } from './apiAseguradoras'
import { AYUDA_CARTERA } from './cartera'
import { AYUDA_CLIENTES } from './clientes'
import { AYUDA_COBRANZAS } from './cobranzas'
import { AYUDA_COMPANIAS } from './companias'
import { AYUDA_EXCEL } from './excel'
import { AYUDA_INICIO } from './inicio'
import { AYUDA_LEADS } from './leads'
import { AYUDA_MARKETING } from './marketing'
import { AYUDA_MENSAJES } from './mensajes'
import { AYUDA_METRICAS } from './metricas'
import { AYUDA_POLIZAS } from './polizas'
import { AYUDA_PRESUPUESTOS } from './presupuestos'
import { AYUDA_RENOVACIONES } from './renovaciones'
import { AYUDA_REPORTES } from './reportes'
import { AYUDA_SINIESTROS } from './siniestros'
import { AYUDA_TAREAS } from './tareas'

/** Todo el contenido de ayuda, indexado por clave. Cada botón de ayuda busca la suya acá. */
export const CONTENIDO_AYUDA: Record<string, ContenidoDeAyuda> = {
  ...AYUDA_INICIO,
  ...AYUDA_CARTERA,
  ...AYUDA_COBRANZAS,
  ...AYUDA_CLIENTES,
  ...AYUDA_LEADS,
  ...AYUDA_PRESUPUESTOS,
  ...AYUDA_TAREAS,
  ...AYUDA_MENSAJES,
  ...AYUDA_POLIZAS,
  ...AYUDA_RENOVACIONES,
  ...AYUDA_SINIESTROS,
  ...AYUDA_METRICAS,
  ...AYUDA_MARKETING,
  ...AYUDA_COMPANIAS,
  ...AYUDA_REPORTES,
  ...AYUDA_EXCEL,
  ...AYUDA_ADMINISTRACION,
  ...AYUDA_API_ASEGURADORAS,
}
