// Humo EN VIVO contra Mercantil Andina: habla con su API de verdad (no con un simulador) para
// confirmar que la cuenta, el productor, el catálogo y la cotización andan. Lo corre `npm run humo:mercantil`:
//
//   MERCANTIL_DEV_USUARIO=… MERCANTIL_DEV_PASSWORD=… MERCANTIL_DEV_SUSCRIPCION=… npm run humo:mercantil
//   MERCANTIL_PROD_USUARIO=… MERCANTIL_PROD_PASSWORD=… MERCANTIL_PROD_SUSCRIPCION=… npm run humo:mercantil -- --produccion
//   … MERCANTIL_PRODUCTOR=… (opcional) MERCANTIL_MARCA=FIAT MERCANTIL_MODELO=CRONOS MERCANTIL_VERSION="1.3 DRIVE" MERCANTIL_ANIO=2020 MERCANTIL_CP=1870
//
// Cada cotización queda registrada en Mercantil como una cotización más del productor (no emite nada).
// No es parte de `npm run prueba`: ésa no sale a internet.
import { marcasMercantil, modelosMercantil, productoresMercantil, versionesMercantil } from '../src/main/aseguradoras/mercantil/catalogos'
import { crearClienteMercantil, type CuentaMercantil } from '../src/main/aseguradoras/mercantil/cliente'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import { mercantil, usarCuentaDeMercantilDePrueba } from '../src/main/multicotizador/mercantil'

const produccion = process.argv.includes('--produccion')
const sufijo = produccion ? 'PROD' : 'DEV'
const usuario = process.env[`MERCANTIL_${sufijo}_USUARIO`] ?? ''
const clave = process.env[`MERCANTIL_${sufijo}_PASSWORD`] ?? ''
const claveDeSuscripcion = process.env[`MERCANTIL_${sufijo}_SUSCRIPCION`] ?? ''
const productor = process.env.MERCANTIL_PRODUCTOR ?? ''

const VEHICULO = {
  marca: process.env.MERCANTIL_MARCA ?? 'FIAT',
  modelo: process.env.MERCANTIL_MODELO ?? 'CRONOS',
  version: process.env.MERCANTIL_VERSION ?? '1.3 DRIVE',
  anio: process.env.MERCANTIL_ANIO ?? '2020',
  codigoPostal: process.env.MERCANTIL_CP ?? '1870',
}

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
      tipo: 'AUTO',
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
    vigenciaDesde: new Date().toISOString().slice(0, 10),
    medioDePago: 'TARJETA',
    condiciones: { plan: 'SIN_PLAN', tarifa: 'SIN_DESCUENTO', comision: 'ESTANDAR', facturacion: 'MEJOR_COSTO', clausulaAjuste: '10', cuotas: 'MAXIMA' },
    codigoInfoAuto: null,
  }
}

async function main(): Promise<void> {
  if (!usuario || !clave || !claveDeSuscripcion) {
    console.error(`Faltan MERCANTIL_${sufijo}_USUARIO, MERCANTIL_${sufijo}_PASSWORD y MERCANTIL_${sufijo}_SUSCRIPCION.`)
    process.exit(2)
  }
  const cuenta: CuentaMercantil = { ambiente: produccion ? 'produccion' : 'desarrollo', usuario, clave, claveDeSuscripcion }
  const cliente = crearClienteMercantil(cuenta)
  console.log(`Mercantil ${cuenta.ambiente}, usuario ${usuario}${productor ? `, productor ${productor}` : ''}`)

  await paso('token', async () => {
    const token = await cliente.token()
    return `token conseguido${token.venceSegunMercantil ? `, vence ${new Date(token.venceSegunMercantil).toLocaleTimeString('es-AR')}` : ''}`
  })
  await paso('productores', async () => {
    const lista = await productoresMercantil(cliente)
    return lista.length === 0 ? 'ninguno (¿el usuario no está vinculado a un PAS?)' : lista.map((p) => `${p.codigo} (${p.nombre})`).join(', ')
  })
  let marca = ''
  let modelo = ''
  await paso('marcas', async () => {
    const marcas = await marcasMercantil(cliente, VEHICULO.anio)
    marca = marcas.find((m) => m.descripcion.toUpperCase() === VEHICULO.marca.toUpperCase())?.codigo ?? ''
    return `${marcas.length} marcas para ${VEHICULO.anio}${marca ? `; ${VEHICULO.marca} es ${marca}` : `; no está ${VEHICULO.marca}: ${marcas.slice(0, 5).map((m) => m.descripcion).join(', ')}…`}`
  })
  if (marca) {
    await paso('modelos', async () => {
      const modelos = await modelosMercantil(cliente, marca, VEHICULO.anio)
      modelo = modelos.find((m) => m.descripcion.toUpperCase() === VEHICULO.modelo.toUpperCase())?.codigo ?? ''
      return `${modelos.length} modelos${modelo ? `; ${VEHICULO.modelo} es ${modelo}` : `; no está ${VEHICULO.modelo}: ${modelos.slice(0, 8).map((m) => m.descripcion).join(', ')}…`}`
    })
  }
  if (marca && modelo) {
    await paso('versiones', async () => {
      const versiones = await versionesMercantil(cliente, marca, VEHICULO.anio, modelo)
      return `${versiones.length} versiones: ${versiones.slice(0, 6).map((v) => `${v.descripcion} (${v.codigoInfoAuto})`).join(', ')}${versiones.length > 6 ? '…' : ''}`
    })
  }
  await paso('cotización por el adaptador', async () => {
    usarCuentaDeMercantilDePrueba({ ...cuenta, productor })
    const resultado = await mercantil.cotizar(solicitud(), {})
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
