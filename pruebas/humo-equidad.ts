// Humo EN VIVO contra la API GLM de La Equidad: habla con su API de verdad (no con un simulador) para
// confirmar que la cuenta, las listas, el catálogo y la cotización andan. Lo corre `npm run humo:equidad`:
//
//   EQUIDAD_PRUEBA_URL=https://…/servlet/ EQUIDAD_PRUEBA_USUARIO=… EQUIDAD_PRUEBA_PASSWORD=… npm run humo:equidad
//   EQUIDAD_PROD_URL=… EQUIDAD_PROD_USUARIO=… EQUIDAD_PROD_PASSWORD=… npm run humo:equidad -- --produccion
//   … EQUIDAD_SERVICIO_USUARIO=… EQUIDAD_SERVICIO_PASSWORD=… (el par del Authorization Basic, si Equidad lo dio)
//   … EQUIDAD_PRODUCTOR=… EQUIDAD_RAMA=4 EQUIDAD_EMPRESA=1 (opcionales)
//   … EQUIDAD_MARCA=FIAT EQUIDAD_MODELO=CRONOS EQUIDAD_VERSION="1.3 DRIVE" EQUIDAD_ANIO=2020 EQUIDAD_CP=1870 EQUIDAD_LOCALIDAD=AVELLANEDA
//
// Cada cotización queda registrada en Equidad como una solicitud más del productor (no emite nada).
// No es parte de `npm run prueba`: ésa no sale a internet.
import { buscarVehiculosEquidad, localidadesEquidad, marcasEquidad, productoresEquidad, tiposDePolizaEquidad, type ContextoEquidad } from '../src/main/aseguradoras/equidad/catalogos'
import { crearClienteEquidad, type CuentaEquidad } from '../src/main/aseguradoras/equidad/cliente'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import { equidad, usarCuentaDeEquidadDePrueba } from '../src/main/multicotizador/equidad'

const produccion = process.argv.includes('--produccion')
const sufijo = produccion ? 'PROD' : 'PRUEBA'
const urlBase = process.env[`EQUIDAD_${sufijo}_URL`] ?? ''
const usuario = process.env[`EQUIDAD_${sufijo}_USUARIO`] ?? ''
const clave = process.env[`EQUIDAD_${sufijo}_PASSWORD`] ?? ''
const usuarioDeServicio = process.env.EQUIDAD_SERVICIO_USUARIO ?? ''
const claveDeServicio = process.env.EQUIDAD_SERVICIO_PASSWORD ?? ''
const productor = process.env.EQUIDAD_PRODUCTOR ?? ''
const rama = process.env.EQUIDAD_RAMA ?? '4'
const empresa = process.env.EQUIDAD_EMPRESA ?? '1'

const VEHICULO = {
  marca: process.env.EQUIDAD_MARCA ?? 'FIAT',
  modelo: process.env.EQUIDAD_MODELO ?? 'CRONOS',
  version: process.env.EQUIDAD_VERSION ?? '1.3 DRIVE',
  anio: process.env.EQUIDAD_ANIO ?? '2020',
  codigoPostal: process.env.EQUIDAD_CP ?? '1870',
  localidad: process.env.EQUIDAD_LOCALIDAD ?? '',
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
      rastreo: false,
      sumaAsegurada: null,
    },
    tomador: { nombre: 'PRUEBA DM GESTION', documento: '', telefono: '', tipoPersona: 'FISICA', condicionIva: 'CONSUMIDOR_FINAL' },
    codigoPostal: VEHICULO.codigoPostal,
    localidad: VEHICULO.localidad,
    vigenciaDesde: new Date().toISOString().slice(0, 10),
    medioDePago: 'TARJETA',
    codigoInfoAuto: null,
  }
}

async function main(): Promise<void> {
  if (!urlBase || !usuario || !clave) {
    console.error(`Faltan EQUIDAD_${sufijo}_URL, EQUIDAD_${sufijo}_USUARIO y EQUIDAD_${sufijo}_PASSWORD.`)
    process.exit(2)
  }
  const cuenta: CuentaEquidad = { urlBase, usuario, clave, usuarioDeServicio, claveDeServicio }
  const cliente = crearClienteEquidad(cuenta)
  console.log(`Equidad ${produccion ? 'producción' : 'prueba'} en ${urlBase}, usuario ${usuario}${usuarioDeServicio ? `, servicio ${usuarioDeServicio}` : ''}${productor ? `, productor ${productor}` : ''}, rama ${rama}, empresa ${empresa}`)

  let contexto: ContextoEquidad = { usuario, empresa, rama }
  await paso('autenticación', async () => {
    const sesion = await cliente.sesion()
    contexto = { ...contexto, usuario: sesion.usuarioCodigo }
    return `usuario ${sesion.usuarioCodigo}${sesion.usuarioNombre ? ` (${sesion.usuarioNombre})` : ''}${sesion.token ? ', con token' : ', sin token'}${sesion.venceSegunEquidad ? `, vence ${new Date(sesion.venceSegunEquidad).toLocaleString('es-AR')}` : ''}`
  })
  await paso('productores', async () => {
    const lista = await productoresEquidad(cliente, contexto)
    return lista.length === 0 ? 'ninguno (¿el usuario no tiene productores?)' : lista.map((p) => `${p.codigo} (${p.nombre})`).join(', ')
  })
  await paso('tipos de póliza', async () => {
    const lista = await tiposDePolizaEquidad(cliente, contexto)
    return lista.length === 0 ? `ninguno para la rama ${rama}` : lista.map((t) => `${t.codigo} ${t.descripcion}`).join(', ')
  })
  await paso('código postal', async () => {
    const lista = await localidadesEquidad(cliente, VEHICULO.codigoPostal)
    return `${lista.length} localidades: ${lista.slice(0, 6).map((l) => `${l.localidad} (${l.codigoPostal}:${l.subCodigo})`).join(', ')}${lista.length > 6 ? '…' : ''}`
  })
  let marca = ''
  await paso('marcas', async () => {
    const marcas = await marcasEquidad(cliente, contexto)
    marca = marcas.find((m) => m.descripcion.toUpperCase() === VEHICULO.marca.toUpperCase())?.codigo ?? ''
    return `${marcas.length} marcas${marca ? `; ${VEHICULO.marca} es ${marca}` : `; no está ${VEHICULO.marca}: ${marcas.slice(0, 5).map((m) => m.descripcion).join(', ')}…`}`
  })
  if (marca) {
    await paso('vehículos', async () => {
      const vehiculos = await buscarVehiculosEquidad(cliente, contexto, VEHICULO.anio, marca)
      return `${vehiculos.length} vehículos de ${VEHICULO.marca} ${VEHICULO.anio}: ${vehiculos.slice(0, 6).map((v) => `${v.descripcion} (${v.marcaCodigo}:${v.modeloCodigo}:${v.subModeloCodigo})`).join(', ')}${vehiculos.length > 6 ? '…' : ''}`
    })
  }
  await paso('cotización por el adaptador', async () => {
    usarCuentaDeEquidadDePrueba({ ambiente: produccion ? 'produccion' : 'prueba', ...cuenta, productor, rama, empresa })
    const resultado = await equidad.cotizar(solicitud(), {})
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
