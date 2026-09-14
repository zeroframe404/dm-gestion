// Servicio de Impresión: "Imprimir Documentos" (manual, página 74). A diferencia del resto de la API
// de Galeno, esto no devuelve JSON sino el PDF en binario. Se guarda en una carpeta temporal dentro
// de los datos de la app (no es un adjunto permanente: se puede volver a pedir cuando haga falta) y
// se devuelve la ruta para que el proceso principal lo abra con `shell.openPath`, igual que un
// adjunto de póliza o de siniestro.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ImpresionGaleno, PedidoDeImpresionGaleno } from '../../../shared/tipos'
import { carpetaDatos } from '../../rutas'
import { ErrorDeGaleno, type ClienteGaleno } from './cliente'

const NOMBRE_POR_TIPO: Record<string, string> = { P: 'poliza', C: 'certificado-cobertura', M: 'certificado-mercosur' }

async function mensajeDeRespuestaSinPdf(respuesta: Response, generico: string): Promise<string> {
  try {
    const texto = await respuesta.text()
    const json = JSON.parse(texto) as { message?: unknown }
    if (typeof json.message === 'string' && json.message.trim()) return json.message
  } catch {
    // El cuerpo de error no siempre es JSON válido; se usa el mensaje genérico.
  }
  return generico
}

export async function imprimir(cliente: ClienteGaleno, pedido: PedidoDeImpresionGaleno): Promise<ImpresionGaleno> {
  const body = {
    tipoImpresion: pedido.tipoImpresion,
    poliza: pedido.poliza,
    rama: pedido.rama,
    legajo: pedido.legajo,
    idRiesgo: pedido.idRiesgo,
    nroEndoso: pedido.nroEndoso ?? 0,
  }
  const respuesta = await cliente.pedirCrudo('/api/imprimir', { metodo: 'POST', body })
  if (!respuesta.ok) {
    throw new ErrorDeGaleno(await mensajeDeRespuestaSinPdf(respuesta, `Galeno respondió ${respuesta.status} al imprimir.`), false)
  }
  const tipoDeContenido = respuesta.headers.get('content-type') ?? ''
  if (!tipoDeContenido.includes('pdf')) {
    // Si Galeno no encuentra el documento a veces contesta 200 con un JSON de error en vez de un PDF.
    throw new ErrorDeGaleno(await mensajeDeRespuestaSinPdf(respuesta, 'Galeno no devolvió un PDF para ese documento.'), false)
  }

  const binario = Buffer.from(await respuesta.arrayBuffer())
  const carpeta = path.join(carpetaDatos(), 'temp', 'galeno')
  mkdirSync(carpeta, { recursive: true })
  const nombre = `${NOMBRE_POR_TIPO[pedido.tipoImpresion] ?? 'documento'}-${pedido.poliza}-${Date.now()}.pdf`
  const ruta = path.join(carpeta, nombre)
  writeFileSync(ruta, binario)
  return { ruta, nombre }
}
