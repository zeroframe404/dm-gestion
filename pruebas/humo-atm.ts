// Humo EN VIVO contra ATM Seguros: habla con su web service de verdad (no con un simulador) para
// confirmar que la cuenta, los planes y la cotización andan. Lo corre `npm run humo:atm`:
//
//   ATM_PROD_USUARIO=… ATM_PROD_PASSWORD=… ATM_PROD_VENDEDOR=… npm run humo:atm
//   ATM_DEV_USUARIO=… ATM_DEV_PASSWORD=… npm run humo:atm -- --desarrollo     (lun a vie, 8 a 18)
//   … npm run humo:atm -- --ftp     (además exige que el FTP de las tablas ande)
//
// Cada cotización queda registrada en ATM como una cotización más del vendedor (no emite nada).
// No es parte de `npm run prueba`: ésa no sale a internet.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { planesAtm, vendedoresAtm } from '../src/main/aseguradoras/atm/catalogos'
import { crearClienteAtm, type CuentaAtm } from '../src/main/aseguradoras/atm/cliente'
import { cotizarAtm } from '../src/main/aseguradoras/atm/cotizacion'
import { bajarTablasPorFtp, guardarTablas, usarCarpetaDeTablasAtmDePrueba } from '../src/main/aseguradoras/atm/repositorio'
import { atm, planPorDefecto, usarCuentaDeAtmDePrueba } from '../src/main/multicotizador/atm'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'

const desarrollo = process.argv.includes('--desarrollo')
const exigirFtp = process.argv.includes('--ftp')
const sufijo = desarrollo ? 'DEV' : 'PROD'
const usuario = process.env[`ATM_${sufijo}_USUARIO`] ?? ''
const clave = process.env[`ATM_${sufijo}_PASSWORD`] ?? ''
const vendedorCargado = process.env[`ATM_${sufijo}_VENDEDOR`] ?? ''

/** Vehículos que se sabe que ATM tiene (probados a mano contra su web service). */
const AUTO = { codigoInfoAuto: '460711', marca: 'VOLKSWAGEN', modelo: 'TIGUAN 2.0 TSI', anio: '2012', uso: '4262' }
const MOTO = { codigoInfoAuto: '9900131', marca: 'MOTO DE PRUEBA', modelo: 'MODELO DE PRUEBA', anio: '2020' }

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

function solicitud(tipo: 'AUTO' | 'MOTO'): SolicitudResuelta {
  const datos = tipo === 'AUTO' ? AUTO : MOTO
  return {
    vehiculo: {
      tipo,
      marca: datos.marca,
      modelo: datos.modelo,
      version: '',
      anio: datos.anio,
      codigoCatalogo: '',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreo: false,
      sumaAsegurada: null,
    },
    tomador: { nombre: '', documento: '', telefono: '', tipoPersona: 'FISICA', condicionIva: 'CONSUMIDOR_FINAL' },
    codigoPostal: '1870',
    localidad: 'AVELLANEDA',
    vigenciaDesde: new Date().toISOString().slice(0, 10),
    medioDePago: 'TARJETA',
    codigoInfoAuto: null,
  }
}

async function main(): Promise<void> {
  if (!usuario || !clave) {
    console.error(`Faltan ATM_${sufijo}_USUARIO y ATM_${sufijo}_PASSWORD.`)
    process.exit(2)
  }
  const cuenta: CuentaAtm = { ambiente: desarrollo ? 'desarrollo' : 'produccion', usuario, clave }
  const cliente = crearClienteAtm(cuenta)
  console.log(`ATM ${cuenta.ambiente}, usuario ${usuario}${vendedorCargado ? `, vendedor ${vendedorCargado}` : ''}`)

  let vendedor = vendedorCargado
  await paso('vendedores (REST ws_vendedores)', async () => {
    const vendedores = await vendedoresAtm(cliente)
    if (vendedores.length === 0) throw new Error('la cuenta no tiene vendedores')
    vendedor ||= vendedores[0]!.codigo
    return vendedores.map((v) => `${v.codigo} ${v.nombre}`).join(' · ')
  })

  let planAuto = ''
  await paso('planes de autos y motos (REST get_plans)', async () => {
    const [autos, motos] = await Promise.all([planesAtm(cliente, 'AUTO', vendedor), planesAtm(cliente, 'MOTO', vendedor)])
    if (autos.length === 0 || motos.length === 0) throw new Error(`autos ${autos.length}, motos ${motos.length}`)
    planAuto = planPorDefecto(autos, 'TARJETA')?.codigo ?? autos[0]!.codigo
    return `autos ${autos.length} (con tarjeta se elige el ${planAuto}), motos ${motos.length}`
  })

  await paso('cotización de un auto (SOAP AUTOS_Cotizar_PHP)', async () => {
    const r = await cotizarAtm(cliente, {
      vendedor,
      plan: planAuto || '02',
      persona: 'F',
      iva: 'CF',
      codigoIIBB: '',
      seccion: '3',
      codigoInfoAuto: AUTO.codigoInfoAuto,
      anio: AUTO.anio,
      ceroKm: false,
      uso: AUTO.uso,
      codigoPostal: '1870',
      ajuste: 10,
      alarma: false,
      gnc: false,
    })
    if (!r.ok) throw new Error(r.mensajes.join(' · '))
    if (r.coberturas.length === 0) throw new Error('sin coberturas')
    if (r.coberturas.some((c) => !(c.premio > 0))) throw new Error('hay coberturas sin premio')
    return `${r.coberturas.length} coberturas (${r.coberturas.map((c) => c.codigo).join(', ')}), suma ${r.suma}, operación ${r.operacion}`
  })

  await paso('cotización de una moto (tipo_uso)', async () => {
    const r = await cotizarAtm(cliente, {
      vendedor,
      plan: planAuto || '02',
      persona: 'F',
      iva: 'MT',
      codigoIIBB: 'I4',
      seccion: '4',
      codigoInfoAuto: MOTO.codigoInfoAuto,
      anio: MOTO.anio,
      ceroKm: false,
      tipoUso: '1',
      codigoPostal: '1870',
      alarma: false,
      gnc: false,
    })
    if (!r.ok) throw new Error(r.mensajes.join(' · '))
    return `${r.coberturas.length} coberturas (${r.coberturas.map((c) => c.codigo).join(', ')})`
  })

  await paso('un rechazo vuelve con el motivo (persona jurídica + consumidor final)', async () => {
    const r = await cotizarAtm(cliente, {
      vendedor,
      plan: planAuto || '02',
      persona: 'J',
      iva: 'CF',
      codigoIIBB: '',
      seccion: '3',
      codigoInfoAuto: AUTO.codigoInfoAuto,
      anio: AUTO.anio,
      ceroKm: false,
      uso: AUTO.uso,
      codigoPostal: '1870',
      alarma: false,
      gnc: false,
    })
    if (r.ok || r.mensajes.length === 0) throw new Error('ATM tendría que haberlo rechazado con un motivo')
    return r.mensajes.join(' · ')
  })

  // El adaptador del multicotizador de punta a punta, con la red de verdad y unas tablas mínimas (las
  // de verdad vienen por FTP): el mismo camino que recorre la pantalla.
  const carpeta = mkdtempSync(path.join(tmpdir(), 'humo-atm-'))
  usarCarpetaDeTablasAtmDePrueba(carpeta)
  usarCuentaDeAtmDePrueba({ ...cuenta, vendedor })
  try {
    guardarTablas(
      cuenta.ambiente,
      [
        {
          nombre: 'ws_au_marca_modelo.txt',
          bytes: Buffer.from(
            'cod_marca;marca;cod_modelo;modelo;tau_codia;cod_uso;tipo_uso\n' +
              `1;${AUTO.marca};1;${AUTO.modelo};${AUTO.codigoInfoAuto};${AUTO.uso};1\n` +
              `2;${MOTO.marca};2;${MOTO.modelo};${MOTO.codigoInfoAuto};;1\n`,
          ),
        },
        { nombre: 'ws_au_marcas.txt', bytes: Buffer.from(`Codigo;Descripcion;Seccion\n1;${AUTO.marca};3\n2;${MOTO.marca};4\n`) },
      ],
      'archivos',
      true,
    )
    for (const tipo of ['AUTO', 'MOTO'] as const) {
      await paso(`multicotizador: ${tipo === 'AUTO' ? 'auto' : 'moto'} de punta a punta`, async () => {
        const r = await atm.cotizar(solicitud(tipo), {})
        if (r.estado !== 'OK') throw new Error(`${r.estado}: ${r.mensaje}`)
        const precios = r.coberturas.map((c) => `${c.codigo} ${c.categoria} $${Math.round(c.premio)}`).join(', ')
        return `${r.descripcionVehiculo} → ${precios}. ${r.mensaje}`
      })
    }
  } finally {
    usarCuentaDeAtmDePrueba(null)
    usarCarpetaDeTablasAtmDePrueba(null)
    rmSync(carpeta, { recursive: true, force: true })
  }

  // El FTP de las tablas. Desde algunas redes está bloqueado: sólo es una falla con --ftp.
  try {
    const archivos = await bajarTablasPorFtp(cuenta)
    anotar('FTP de las tablas', true, archivos.map((a) => `${a.nombre} (${a.bytes.length} bytes)`).join(', '))
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    if (exigirFtp) anotar('FTP de las tablas', false, motivo)
    else console.log(`--  FTP de las tablas (no se exige; --ftp para exigirlo): ${motivo}`)
  }

  const bien = pasos.filter((p) => p.ok).length
  console.log(`\n${bien}/${pasos.length} pasos bien`)
  process.exit(bien === pasos.length ? 0 : 1)
}

void main()
