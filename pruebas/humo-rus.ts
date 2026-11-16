// Humo EN VIVO contra Río Uruguay Seguros (RUS): habla con su API v2 de verdad (no con un simulador) para
// confirmar que la cuenta, las vigencias, el catálogo y la cotización andan. Lo corre `npm run humo:rus`:
//
//   RUS_SANDBOX_USUARIO=… RUS_SANDBOX_PASSWORD=… RUS_SANDBOX_APIKEY=… RUS_PRODUCTOR=… npm run humo:rus
//   RUS_PROD_USUARIO=… RUS_PROD_PASSWORD=… RUS_PROD_APIKEY=… RUS_PRODUCTOR=… npm run humo:rus -- --produccion
//   … RUS_SOLICITANTE=… (opcional) RUS_TIPO=AUTO|MOTO RUS_MARCA=CHEVROLET RUS_MODELO=CRUZE RUS_VERSION="1.4 4 PTAS LTZ AT" RUS_ANIO=2020 RUS_CP=1870
//
// Cotizar no emite nada. No es parte de `npm run prueba`: ésa no sale a internet.
import { marcasRus, modelosRus, TIPOS_DE_UNIDAD_RUS, usosRus, versionesRus, vigenciasRus } from '../src/main/aseguradoras/rus/catalogos'
import { crearClienteRus, type CuentaRus } from '../src/main/aseguradoras/rus/cliente'
import { RAMO_RUS } from '../src/main/aseguradoras/rus/cotizacion'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import { rus, usarCuentaDeRusDePrueba } from '../src/main/multicotizador/rus'

const produccion = process.argv.includes('--produccion')
const sufijo = produccion ? 'PROD' : 'SANDBOX'
const usuario = process.env[`RUS_${sufijo}_USUARIO`] ?? ''
const clave = process.env[`RUS_${sufijo}_PASSWORD`] ?? ''
const apiKey = process.env[`RUS_${sufijo}_APIKEY`] ?? ''
const productor = process.env.RUS_PRODUCTOR ?? ''
const solicitante = process.env.RUS_SOLICITANTE ?? ''
const tipo = process.env.RUS_TIPO === 'MOTO' ? 'MOTO' : 'AUTO'

const POR_DEFECTO =
  tipo === 'MOTO'
    ? { marca: 'HONDA', modelo: 'CB 250 TWISTER', version: '' }
    : { marca: 'CHEVROLET', modelo: 'CRUZE', version: '1.4 4 PTAS LTZ AT' }
const VEHICULO = {
  marca: process.env.RUS_MARCA ?? POR_DEFECTO.marca,
  modelo: process.env.RUS_MODELO ?? POR_DEFECTO.modelo,
  version: process.env.RUS_VERSION ?? POR_DEFECTO.version,
  anio: process.env.RUS_ANIO ?? '2020',
  codigoPostal: process.env.RUS_CP ?? '1870',
}
const TIPO_DE_UNIDAD = tipo === 'MOTO' ? TIPOS_DE_UNIDAD_RUS.MOTO_MAS_50 : TIPOS_DE_UNIDAD_RUS.AUTO

const pasos: Array<{ paso: string; ok: boolean; detalle: string }> = []
function anotar(paso: string, ok: boolean, detalle: string): void {
  pasos.push({ paso, ok, detalle })
  console.log(`${ok ? 'ok ' : 'MAL'} ${paso}: ${detalle}`)
}

async function paso(nombre: string, correr: () => Promise<string>): Promise<void> {
  try {
    anotar(nombre, true, await correr())
  } catch (error) {
    anotar(nombre, false, error instanceof Error ? error.message : String(error))
  }
}

function solicitud(): SolicitudResuelta {
  return {
    vehiculo: {
      tipo,
      marca: VEHICULO.marca,
      modelo: VEHICULO.modelo,
      version: VEHICULO.version,
      anio: VEHICULO.anio,
      codigoCatalogo: '',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreador: 'SIN_RASTREADOR',
      scoring: { grua: false, alarma: false, garaje: false },
      accesorios: [],
      sumaAsegurada: null,
    },
    tomador: {
      nombre: '',
      apellido: '',
      dni: '',
      cuit: '',
      telefono: '',
      tipoPersona: 'FISICA',
      condicionIva: 'CONSUMIDOR_FINAL',
      ingresosBrutos: 'CONSUMIDOR_FINAL',
      sexo: null,
      fechaNacimiento: '',
    },
    provincia: 'Buenos Aires',
    codigoPostal: VEHICULO.codigoPostal,
    localidad: '',
    // Mañana: RUS rechaza una vigencia que arranca antes de hoy.
    vigenciaDesde: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10),
    medioDePago: 'TARJETA',
    condiciones: { plan: 'SIN_PLAN', tarifa: 'SIN_DESCUENTO', comision: 'ESTANDAR', facturacion: 'MEJOR_COSTO', clausulaAjuste: '20', cuotas: 'MAXIMA' },
    codigoInfoAuto: null,
  }
}

async function main(): Promise<void> {
  if (!usuario || !clave || !apiKey || !productor) {
    console.error(`Faltan RUS_${sufijo}_USUARIO, RUS_${sufijo}_PASSWORD, RUS_${sufijo}_APIKEY y RUS_PRODUCTOR.`)
    process.exit(2)
  }
  const cuenta: CuentaRus = { ambiente: produccion ? 'produccion' : 'sandbox', usuario, clave, apiKey }
  const cliente = crearClienteRus(cuenta)
  console.log(`RUS ${cuenta.ambiente}, usuario ${usuario}, productor ${productor}, ${tipo === 'MOTO' ? 'moto' : 'auto'}`)

  await paso('token', async () => {
    const token = await cliente.token()
    return `token conseguido${token.venceSegunRus ? `, vence ${new Date(token.venceSegunRus).toLocaleTimeString('es-AR')}` : ''}`
  })
  await paso('vigencias', async () => {
    const vigencias = await vigenciasRus(cliente, RAMO_RUS[tipo])
    return vigencias.length === 0 ? 'ninguna' : vigencias.map((v) => `${v.codigo} ${v.descripcion} (${v.meses} meses${v.porDefecto ? ', por defecto' : ''})`).join(', ')
  })
  await paso('usos', async () => {
    const usos = await usosRus(cliente, TIPO_DE_UNIDAD)
    return usos.map((u) => u.descripcion).join(', ')
  })
  let marca = ''
  let modelo = ''
  await paso('marcas', async () => {
    const marcas = await marcasRus(cliente, TIPO_DE_UNIDAD)
    marca = marcas.find((m) => m.descripcion.toUpperCase() === VEHICULO.marca.toUpperCase())?.codigo ?? ''
    return `${marcas.length} marcas${marca ? `; ${VEHICULO.marca} es ${marca}` : `; no está ${VEHICULO.marca}: ${marcas.slice(0, 5).map((m) => m.descripcion).join(', ')}…`}`
  })
  if (marca) {
    await paso('modelos', async () => {
      const modelos = await modelosRus(cliente, marca, VEHICULO.anio, TIPO_DE_UNIDAD)
      modelo = modelos.find((m) => m.descripcion.toUpperCase() === VEHICULO.modelo.toUpperCase())?.codigo ?? ''
      return `${modelos.length} modelos${modelo ? `; ${VEHICULO.modelo} es ${modelo}` : `; no está ${VEHICULO.modelo}: ${modelos.slice(0, 8).map((m) => m.descripcion).join(', ')}…`}`
    })
  }
  if (marca && modelo) {
    await paso('versiones', async () => {
      const versiones = await versionesRus(cliente, marca, VEHICULO.anio, TIPO_DE_UNIDAD, modelo)
      return `${versiones.length} versiones: ${versiones.slice(0, 6).map((v) => `${v.descripcion} (${v.codigo})`).join(', ')}${versiones.length > 6 ? '…' : ''}`
    })
  }
  await paso('cotización por el adaptador', async () => {
    usarCuentaDeRusDePrueba({ ...cuenta, productor, solicitante })
    const resultado = await rus.cotizar(solicitud(), {})
    if (resultado.estado !== 'OK') {
      throw new Error(`${resultado.estado}: ${resultado.mensaje ?? ''}\n${JSON.stringify(resultado.detalleTecnico ?? resultado.ajustes, null, 2)}`)
    }
    return `${resultado.descripcionVehiculo}: ${resultado.coberturas.map((c) => `${c.codigo} ${c.nombre} $${c.premio}`).join('; ')}\n${resultado.mensaje ?? ''}`
  })

  const fallas = pasos.filter((p) => !p.ok)
  console.log(fallas.length === 0 ? '\nTodo anduvo.' : `\n${fallas.length} paso(s) fallaron.`)
  process.exit(fallas.length === 0 ? 0 : 1)
}

void main()
