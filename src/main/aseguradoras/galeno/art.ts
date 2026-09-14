// WEB SERVICE GALENO ART: "Consulta de Contratos ART" (manual, página 78) — a diferencia de todo el
// resto de la API, esto devuelve un archivo plano separado por ";" en vez de JSON. Las columnas están
// documentadas 1 a 1 en el manual, en este orden exacto; los ejemplos no muestran fila de encabezado,
// pero por las dudas se descarta la primera línea si coincide con los nombres de columna.
import type { ColumnaDeReporteGaleno, FiltrosDeReporteGaleno, ReporteGaleno } from '../../../shared/tipos'
import { ErrorDeGaleno, type ClienteGaleno } from './cliente'

const COLUMNAS: ColumnaDeReporteGaleno[] = [
  { clave: 'IDASEGURADORA', titulo: 'Aseguradora' },
  { clave: 'FCOBRO', titulo: 'Fecha de cobro' },
  { clave: 'CONTRATO', titulo: 'Contrato' },
  { clave: 'CONTRATO_ANTERIOR', titulo: 'Contrato anterior' },
  { clave: 'CODPROD', titulo: 'Cód. productor' },
  { clave: 'NOMPROD', titulo: 'Productor' },
  { clave: 'CUITCLI', titulo: 'CUIT cliente' },
  { clave: 'NOMCLI', titulo: 'Cliente' },
  { clave: 'PREMIO', titulo: 'Premio' },
  { clave: 'IMPCOB', titulo: 'Importe cobrado' },
  { clave: 'PRIMA', titulo: 'Prima' },
  { clave: 'PORCOMIS', titulo: '% comisión' },
  { clave: 'IMPCOMIS', titulo: 'Importe comisión' },
  { clave: 'POR13', titulo: '% Res. 13' },
  { clave: 'IMP13', titulo: 'Importe Res. 13' },
  { clave: 'PERSONAS', titulo: 'Personas' },
  { clave: 'MASASAL', titulo: 'Masa salarial' },
  { clave: 'PROVINCIA', titulo: 'Provincia' },
  { clave: 'PERIODO', titulo: 'Período' },
  { clave: 'ALICUOTAFIJA', titulo: 'Alícuota fija' },
  { clave: 'ALICUOTAVARIABLE', titulo: 'Alícuota variable' },
  { clave: 'ENDOSO', titulo: 'Endoso' },
  { clave: 'OBSERVACIONES', titulo: 'Observaciones' },
  { clave: 'CIUU', titulo: 'CIUU' },
]

export async function contratosART(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    mes: filtros.mes,
    anio: filtros.anio,
    pagina: filtros.pagina,
    // El manual escribe el nombre de este campo así, sin la segunda "r" de "Registros".
    cantRegistosPagina: filtros.cantRegistrosPagina,
  }
  const respuesta = await cliente.pedirCrudo('/api/contrato/listaContratosART', { metodo: 'POST', body })
  const texto = await respuesta.text()
  if (!respuesta.ok) {
    let mensaje = `Galeno respondió ${respuesta.status} al consultar los contratos de ART.`
    try {
      const json = JSON.parse(texto) as { message?: string }
      if (json.message) mensaje = json.message
    } catch {
      // El cuerpo de error no siempre viene en JSON.
    }
    throw new ErrorDeGaleno(mensaje, false)
  }

  const lineas = texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
  const primeraEsEncabezado = lineas[0]?.toUpperCase().startsWith('IDASEGURADORA') ?? false
  const filas = (primeraEsEncabezado ? lineas.slice(1) : lineas).map((linea) => {
    const valores = linea.split(';')
    const fila: Record<string, string | number | null> = {}
    COLUMNAS.forEach((columna, indice) => {
      fila[columna.clave] = valores[indice]?.trim() || null
    })
    return fila
  })
  return { columnas: COLUMNAS, filas }
}
