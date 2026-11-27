// El alta de «Nuevo cliente» con el PDF de la póliza: cliente + vehículo (auto o moto) + póliza de una vez.
//
// Dos reglas:
//
// 1. LAS MISMAS REGLAS DEL ALTA MANUAL. No hay un camino nuevo para saltearse nada: el cliente entra por
//    `crearCliente` (el DNI no se duplica jamás) y la póliza por `crearPoliza` (cobertura obligatoria en un
//    auto, aviso de antigüedad que sólo confirma un administrador, patente de otro cliente, patente dada de
//    baja). Acá sólo se las junta.
// 2. TODO O NADA. Cliente y póliza van en UNA transacción: si la póliza se rechaza después de haber armado el
//    cliente, el cliente desaparece con ella. Lo que queda afuera de la transacción es el adjunto del PDF
//    (un archivo y una copia al Drive): si falla se avisa, pero no tira abajo un alta que ya está hecha.
import type { ArchivoParaAdjuntar, DatosDePoliza, FilaCliente, SesionUsuario } from '../../shared/tipos'
import type { DatosDeAltaDesdePoliza, ResultadoDeAltaDesdePoliza } from '../../shared/lecturaDePoliza'
import { db } from '../db/base'
import { agregarArchivosDePoliza } from './adjuntosDePoliza'
import { crearCliente, fichaDeCliente } from './clientes'
import { crearPoliza } from './polizas'
import { enteroPositivo, objeto } from './validacion'

/** Cómo se adjunta el PDF. Se inyecta para poder probar el alta sin escribir archivos ni hablar con el Drive. */
export type Adjuntador = (polizaId: number, archivos: ArchivoParaAdjuntar[], actor: SesionUsuario) => Promise<unknown>

function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function datosDeLaPoliza(datos: DatosDeAltaDesdePoliza, clienteId: number): DatosDePoliza {
  const vehiculo = objeto(datos.vehiculo, 'Los datos del vehículo')
  const poliza = objeto(datos.poliza, 'Los datos de la póliza')
  return {
    clienteId,
    vehiculoId: null,
    // Un vehículo como texto leído: sin versión, categoría ni código de catálogo, igual que los cargados a mano.
    vehiculoNuevo: {
      patente: textoDe(vehiculo.patente),
      marca: textoDe(vehiculo.marca),
      modelo: textoDe(vehiculo.modelo),
      linea: '',
      anio: textoDe(vehiculo.anio),
      // Auto o moto, según lo que se revisó en pantalla. Cualquier otra cosa que llegue se guarda como auto.
      tipo: vehiculo.tipo === 'MOTO' ? 'MOTO' : 'AUTO',
      categoria: '',
      catalogoCodigo: '',
      motor: textoDe(vehiculo.motor),
      chasis: textoDe(vehiculo.chasis),
      uso: textoDe(vehiculo.uso),
      color: textoDe(vehiculo.color),
      direccionRiesgo: '',
      titularNombre: '',
      titularDocumento: '',
      integrantes: [],
    },
    compania: textoDe(poliza.compania),
    cobertura: textoDe(poliza.cobertura),
    formaPago: textoDe(poliza.formaPago),
    cuota: textoDe(poliza.cuota),
    diaVencimiento: '',
    numero: textoDe(poliza.numero),
    propuesta: textoDe(poliza.propuesta),
    vigenciaDesde: textoDe(poliza.vigenciaDesde),
    vigenciaHasta: textoDe(poliza.vigenciaHasta),
    avisarVto: '',
    observaciones: textoDe(poliza.observaciones),
    confirmadoPeseAlAviso: datos.confirmadoPeseAlAviso === true,
    confirmadoPatenteDeBaja: datos.confirmadoPatenteDeBaja === true,
  }
}

export async function altaDesdePoliza(
  datos: DatosDeAltaDesdePoliza,
  actor: SesionUsuario,
  adjuntar: Adjuntador = agregarArchivosDePoliza,
): Promise<ResultadoDeAltaDesdePoliza> {
  const d = objeto(datos, 'Los datos del alta')
  const existenteId = d.clienteExistenteId === null || d.clienteExistenteId === undefined ? null : enteroPositivo(d.clienteExistenteId, 'El cliente')

  let clienteId = 0
  let polizaId = 0
  let duplicado: { yaExiste: FilaCliente; motivo: string } | null = null

  db().transaction(() => {
    if (existenteId !== null) {
      // Falla (y deshace todo) si ese cliente no existe. Sus datos no se tocan.
      fichaDeCliente(existenteId)
      clienteId = existenteId
    } else {
      const alta = crearCliente(datos.cliente, actor)
      if (!alta.creado) {
        // El DNI ya estaba: no se escribió nada y no se sigue. La pantalla muestra quién es.
        duplicado = { yaExiste: alta.yaExiste, motivo: alta.motivo }
        return
      }
      clienteId = alta.cliente.id
    }
    polizaId = crearPoliza(datosDeLaPoliza(datos, clienteId), actor).id
  })()

  if (duplicado !== null) {
    const { yaExiste, motivo } = duplicado as { yaExiste: FilaCliente; motivo: string }
    return { creado: false, yaExiste, motivo }
  }

  let adjuntoGuardado = false
  const pdf = datos.adjunto
  if (pdf && pdf.contenido instanceof Uint8Array && pdf.contenido.length > 0) {
    try {
      await adjuntar(polizaId, [{ nombre: textoDe(pdf.nombre) || 'poliza.pdf', tipo: 'application/pdf', contenido: pdf.contenido }], actor)
      adjuntoGuardado = true
    } catch (error) {
      console.error('[alta desde póliza] No se pudo adjuntar el PDF:', error instanceof Error ? error.message : error)
    }
  }

  return { creado: true, cliente: fichaDeCliente(clienteId), polizaId, adjuntoGuardado }
}
