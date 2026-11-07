// La póliza en papel: una hoja A4 con todo lo que el programa sabe de ella (el asegurado, el riesgo, la
// vigencia, los pagos y los siniestros), lista para la impresora de documentos de Administración →
// Impresora (nunca la ticketeadora) o para guardar en PDF. Es el mismo camino del presupuesto:
// HTML → ventana oculta → Chromium (ver impresion.ts).
import type { PolizaDeCliente, VehiculoDeCliente } from '../../shared/tipos'
import { NOMBRE_ESTADO_POLIZA } from '../../shared/polizas'
import { hoyLocal } from '../../shared/semaforo'
import { limpiar } from '../importacion/normalizar'
import { fichaDeCliente } from './clientes'
import { nombreDeLaAseguradora } from './presupuestos'
import { verPoliza } from './polizas'
import { enteroPositivo } from './validacion'

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fechaHoy(): string {
  const [anio, mes, dia] = hoyLocal().split('-')
  return `${dia}/${mes}/${anio}`
}

/** Un renglón «etiqueta: valor». Si el dato no está cargado no se imprime: una hoja con guiones no ayuda a nadie. */
function dato(etiqueta: string, valor: string | null | undefined): string {
  const texto = limpiar(valor ?? '')
  return texto ? `<tr><th>${escapar(etiqueta)}</th><td>${escapar(texto)}</td></tr>` : ''
}

function seccion(titulo: string, renglones: string[]): string {
  const cuerpo = renglones.join('')
  return cuerpo ? `<section><h2>${escapar(titulo)}</h2><table class="datos">${cuerpo}</table></section>` : ''
}

function htmlDelRiesgo(v: VehiculoDeCliente | undefined, poliza: PolizaDeCliente): string {
  if (!v) return seccion('Riesgo asegurado', [dato('Riesgo', poliza.vehiculo), dato('Patente', poliza.patente)])
  const integrantes = v.integrantes.length
    ? `<section><h2>Personas cubiertas</h2><table class="datos">${v.integrantes
        .map((i) => dato(i.nombre, i.documento ? `DNI ${i.documento}` : ''))
        .join('')}</table></section>`
    : ''
  return (
    seccion('Riesgo asegurado', [
      dato('Riesgo', poliza.vehiculo),
      dato('Patente', v.patente),
      dato('Marca', v.marca),
      dato('Modelo', v.modelo),
      dato('Versión', v.linea),
      dato('Año', v.anio),
      dato('Tipo', v.tipo),
      dato('Uso', v.uso),
      dato('Color', v.color),
      dato('Motor', v.motor),
      dato('Chasis / cuadro', v.chasis),
      dato('Dirección del riesgo', v.direccionRiesgo),
      dato('Titular del riesgo', [v.titularNombre, v.titularDocumento].filter(Boolean).join(' · ')),
    ]) + integrantes
  )
}

/** El HTML de la póliza y el nombre de archivo sugerido para el PDF. */
export function polizaParaImprimir(polizaId: number): { html: string; nombreDeArchivo: string } {
  const poliza = verPoliza(enteroPositivo(polizaId, 'La póliza'))
  const ficha = fichaDeCliente(poliza.clienteId)
  const vehiculo = ficha.vehiculos.find((v) => v.id === poliza.vehiculoId)
  const mismaPoliza = (numero: string | null) => !!poliza.numero && (numero ?? '').trim() === poliza.numero.trim()
  const pagos = ficha.pagos.filter((p) => mismaPoliza(p.numeroPoliza))
  const siniestros = ficha.siniestros.filter((s) => mismaPoliza(s.numeroPoliza))
  const nombre = limpiar(ficha.nombre) || 'Sin nombre'

  const tablaDePagos = pagos.length
    ? `<section><h2>Pagos registrados</h2><table class="lista"><thead><tr><th>Fecha</th><th>Período</th><th>Medio</th><th class="der">Importe</th></tr></thead><tbody>${pagos
        .map(
          (p) =>
            `<tr><td>${escapar(p.fecha ?? '')}</td><td>${escapar(p.periodo ?? '')}</td><td>${escapar(p.medio ?? '')}</td><td class="der">${escapar(p.importe ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table></section>`
    : ''
  const tablaDeSiniestros = siniestros.length
    ? `<section><h2>Siniestros</h2><table class="lista"><thead><tr><th>Fecha</th><th>N.°</th><th>Estado</th><th>Descripción</th></tr></thead><tbody>${siniestros
        .map(
          (s) =>
            `<tr><td>${escapar(s.fecha ?? '')}</td><td>${escapar(s.numeroSiniestro ?? '')}</td><td>${escapar(s.estadoTexto ?? s.estado)}</td><td>${escapar(s.descripcion ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table></section>`
    : ''
  const baja = poliza.motivoBaja || poliza.fechaBaja ? seccion('Baja', [dato('Fecha', poliza.fechaBaja), dato('Motivo', poliza.motivoBaja)]) : ''
  const observaciones = limpiar(poliza.observaciones ?? '')

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Póliza ${escapar(poliza.numero ?? '')}</title><style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #14243d; }
  header { border-bottom: 2px solid #12315d; padding-bottom: 6mm; margin-bottom: 6mm; overflow: hidden; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: .5px; color: #12315d; }
  .sub { margin: 1mm 0 0; font-size: 10pt; color: #55627a; }
  .numero { float: right; text-align: right; font-size: 10pt; color: #55627a; }
  .numero strong { display: block; font-size: 14pt; color: #12315d; }
  .estado { display: inline-block; margin-top: 1mm; padding: .5mm 3mm; border: 1px solid #12315d; border-radius: 3mm; font-size: 9pt; font-weight: bold; color: #12315d; }
  section { margin-bottom: 6mm; break-inside: avoid; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: .08em; color: #55627a; margin: 0 0 2mm; border-bottom: 1px solid #e6eaf1; padding-bottom: 1mm; }
  table.datos { border-collapse: collapse; }
  table.datos th { text-align: left; font-weight: normal; color: #55627a; padding: .7mm 6mm .7mm 0; white-space: nowrap; vertical-align: top; }
  table.datos td { padding: .7mm 0; font-weight: bold; }
  table.lista { width: 100%; border-collapse: collapse; }
  table.lista th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; color: #55627a; border-bottom: 1px solid #c9d2e0; padding: 0 3mm 1.5mm 0; }
  table.lista td { border-bottom: 1px solid #e6eaf1; padding: 1.8mm 3mm 1.8mm 0; vertical-align: top; }
  .der { text-align: right; }
  .observaciones { border-left: 3px solid #c9d2e0; padding-left: 4mm; color: #33415c; white-space: pre-wrap; }
  footer { border-top: 1px solid #c9d2e0; padding-top: 3mm; font-size: 8.5pt; color: #55627a; }
</style></head><body>
  <header>
    <div class="numero">Póliza <strong>${escapar(limpiar(poliza.numero ?? '') || 'sin número')}</strong><span class="estado">${escapar(NOMBRE_ESTADO_POLIZA[poliza.estado])}</span></div>
    <h1>${escapar(nombreDeLaAseguradora())}</h1>
    <p class="sub">${escapar(limpiar(poliza.sucursal ?? '') || 'Casa central')} · Impreso el ${escapar(fechaHoy())}</p>
  </header>
  ${seccion('Asegurado', [
    dato('Nombre y apellido', nombre),
    dato('DNI/CUIT', ficha.documento),
    dato('Teléfono', ficha.telefono),
    dato('Email', ficha.email),
    dato('Dirección', ficha.direccion),
    dato('Localidad', ficha.localidad),
    dato('Fecha de nacimiento', ficha.fechaNacimiento),
    dato('Profesión', ficha.profesion),
  ])}
  ${seccion('Datos de la póliza', [
    dato('Compañía', poliza.compania),
    dato('N.° de póliza', poliza.numero),
    dato('N.° de propuesta', poliza.propuesta),
    dato('Cobertura', poliza.cobertura),
    dato('Forma de pago', poliza.formaPago),
    dato('Cuota', poliza.cuota),
    dato('Día de vencimiento', poliza.diaVencimiento),
    dato('Rama', poliza.rama),
  ])}
  ${seccion('Vigencia', [
    dato('Desde', poliza.vigenciaDesde),
    dato('Hasta', poliza.vigenciaHasta),
    dato('Avisar antes de que venza', poliza.avisarVto),
  ])}
  ${htmlDelRiesgo(vehiculo, poliza)}
  ${baja}
  ${observaciones ? `<section><h2>Observaciones</h2><div class="observaciones">${escapar(observaciones)}</div></section>` : ''}
  ${tablaDePagos}
  ${tablaDeSiniestros}
  <footer>Resumen interno de la agencia con los datos cargados en el programa al ${escapar(fechaHoy())}. No reemplaza la póliza emitida por la compañía.</footer>
</body></html>`

  const archivo = `${nombre} - ${poliza.compania ?? ''} ${poliza.numero ?? ''}`.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90)
  return { html, nombreDeArchivo: `Póliza ${archivo}.pdf` }
}
