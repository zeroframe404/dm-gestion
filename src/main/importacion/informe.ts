// Versión legible (texto plano) del informe de importación, pensada para abrirse con el Bloc de notas.
import { NOMBRE_TIPO_PESTANA, type InformeImportacion } from '../../shared/tipos'

const ESTADOS: Record<InformeImportacion['estado'], string> = {
  EN_CURSO: 'En curso',
  COMPLETA: 'Completa',
  CON_ERRORES: 'Completa con errores en algunas pestañas',
  CANCELADA: 'Cancelada por el usuario',
  FALLIDA: 'Fallida',
}

const NOMBRES_DE_REGISTROS: Record<string, string> = {
  filas_crudas: 'filas crudas',
  clientes: 'clientes',
  clientes_unificados: 'filas unificadas en un cliente existente',
  clientes_con_documento_nuevo: 'clientes que antes no tenían documento y ahora sí',
  vehiculos: 'vehículos',
  polizas: 'pólizas',
  cuotas_mes: 'cuotas del mes',
  cuotas_con_texto: 'cuotas con texto (A/D, ---)',
  cuotas_sin_poliza_vigente: 'cuotas sin póliza vigente',
  bajas: 'bajas',
  bajas_sin_poliza_conocida: 'bajas sin póliza conocida',
  riesgos_varios: 'riesgos varios',
  riesgos_sin_cliente_en_cartera: 'riesgos sin cliente en la cartera',
  siniestros: 'siniestros',
  amp: 'ampliaciones (AMP)',
  pagos: 'pagos',
  reglas_cobertura: 'reglas de cobertura',
  filas_que_ya_no_estan: 'filas que ya no están en la hoja',
  filas_de_encabezado_repetidas: 'filas que repiten los encabezados',
  filas_sin_id_no_guardadas: 'filas nuevas que no se guardaron (no se pudo escribir el _ID)',
  clientes_con_clave_corregida: 'clientes cuya identificación cambió en la hoja',
  vehiculos_con_clave_corregida: 'vehículos cuya identificación cambió en la hoja',
  polizas_con_clave_corregida: 'pólizas cuya identificación cambió en la hoja',
}

function fecha(iso: string | null): string {
  if (!iso) return '-'
  const f = new Date(iso)
  return Number.isNaN(f.getTime()) ? iso : f.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })
}

function linea(caracter = '='): string {
  return caracter.repeat(78)
}

export function generarTextoDeInforme(informe: InformeImportacion): string {
  const t = informe.totales
  const salida: string[] = []

  salida.push(linea(), 'INFORME DE IMPORTACIÓN — DM Gestión', linea())
  salida.push(`Hoja:            ${informe.hojaTitulo} (ID ${informe.hojaId})`)
  salida.push(`Importación Nº:  ${informe.id}`)
  salida.push(`Inicio:          ${fecha(informe.iniciadaEn)}`)
  salida.push(`Fin:             ${fecha(informe.terminadaEn)}`)
  salida.push(`Estado:          ${ESTADOS[informe.estado]}`)
  salida.push(`Planilla más nueva (define clientes, vehículos y pólizas activas): ${informe.pestanaMasNueva ?? '(ninguna)'}`)
  if (informe.error) salida.push(`ERROR:           ${informe.error}`)

  salida.push('', 'RESUMEN DE LA BASE LOCAL', linea('-'))
  salida.push(`Clientes:              ${t.clientes}`)
  salida.push(`Vehículos:             ${t.vehiculos}`)
  salida.push(`Pólizas activas:       ${t.polizas}${t.polizasInactivadas ? `  (${t.polizasInactivadas} pasaron a inactivas)` : ''}`)
  salida.push(`Cuotas por mes:        ${t.cuotasMes}`)
  salida.push(`Bajas:                 ${t.bajas}`)
  salida.push(`Riesgos varios:        ${t.riesgosVarios}`)
  salida.push(`Siniestros:            ${t.siniestros}`)
  salida.push(`Ampliaciones (AMP):    ${t.amp}`)
  salida.push(`Reglas de cobertura:   ${t.reglasCobertura}`)
  salida.push(`Pagos:                 ${t.pagos}`)
  salida.push(`Filas crudas:          ${t.filasCrudas}${t.filasQueYaNoEstan ? `  (${t.filasQueYaNoEstan} ya no están en la hoja)` : ''}`)
  salida.push(`Datos raros detectados: ${t.problemas} (una fila puede tener más de uno)`)

  salida.push('', 'PESTAÑAS', linea('-'))
  for (const p of informe.pestanas) {
    const registros = Object.entries(p.registros)
      .map(([clave, cantidad]) => `${cantidad} ${NOMBRES_DE_REGISTROS[clave] ?? clave}`)
      .join(', ')
    salida.push(`«${p.titulo}» — ${NOMBRE_TIPO_PESTANA[p.tipo]}${p.periodo ? ` — período ${p.periodo}` : ''}`)
    salida.push(`   Estado: ${p.estado}${p.error ? ` — ${p.error}` : ''}`)
    salida.push(`   Filas leídas: ${p.filasLeidas} | con datos: ${p.filasConDatos} | _ID nuevos: ${p.idsNuevos} | _ID existentes: ${p.idsExistentes} | columna _ID: ${p.columnaId ?? '-'}`)
    if (registros) salida.push(`   Registros: ${registros}`)
    if (p.problemas) salida.push(`   Datos raros detectados: ${p.problemas}`)
  }

  salida.push('', 'DATOS RAROS POR TIPO', linea('-'))
  const tipos = Object.entries(informe.problemasPorTipo).sort((a, b) => b[1] - a[1])
  if (tipos.length === 0) salida.push('(ninguno)')
  for (const [tipo, cantidad] of tipos) salida.push(`${String(cantidad).padStart(6)}  ${tipo}`)

  const sucursales = Object.entries(informe.sucursalesDesconocidas).sort((a, b) => b[1] - a[1])
  if (sucursales.length > 0) {
    salida.push('', 'SUCURSALES FUERA DE CATÁLOGO (Dock Sud, Lanús, Daniel)', linea('-'))
    for (const [valor, cantidad] of sucursales) salida.push(`${String(cantidad).padStart(6)}  ${valor}`)
  }

  if (informe.avisos.length > 0) {
    salida.push('', 'AVISOS', linea('-'))
    for (const aviso of informe.avisos) salida.push(`- ${aviso}`)
  }

  salida.push('', 'COLUMNAS RECONOCIDAS POR PESTAÑA', linea('-'))
  for (const p of informe.pestanas) {
    salida.push(`«${p.titulo}»`)
    for (const c of p.columnas) {
      const destino = c.campo ? `→ ${c.campo}` : '→ (sin mapeo)'
      salida.push(`   ${c.columna.padEnd(3)} ${JSON.stringify(c.encabezado).padEnd(32)} ${destino}${c.nota ? `  [${c.nota}]` : ''}`)
    }
  }

  salida.push('', `DETALLE DE FILAS CON DATOS RAROS (${informe.problemas.length}${informe.problemasOmitidos ? ` de ${informe.problemas.length + informe.problemasOmitidos}; el resto sólo se cuenta` : ''})`, linea('-'))
  if (informe.problemas.length === 0) salida.push('(ninguna)')
  for (const problema of informe.problemas) {
    const ubicacion = problema.fila !== null ? `fila ${problema.fila}` : 'pestaña'
    salida.push(`[${problema.pestana}] ${ubicacion}${problema.filaId ? ` (_ID ${problema.filaId})` : ''}: ${problema.tipo} — ${problema.detalle}`)
  }

  salida.push('', linea())
  return salida.join('\n')
}

/**
 * El mismo informe listo para guardarse como archivo: con marca de orden de bytes y saltos de línea de
 * Windows, así se abre bien en el Bloc de notas y en Excel, con los acentos en su lugar.
 */
export function informeParaArchivo(texto: string): string {
  return '﻿' + texto.replace(/\r?\n/g, '\r\n')
}
