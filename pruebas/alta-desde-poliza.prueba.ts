// El alta combinada de «Nuevo cliente» con el PDF de la póliza: cliente + auto + póliza de una vez, con las
// mismas reglas del alta manual y SIN dejar nada a medias.
//
// La IA no entra acá: esto empieza cuando la persona ya revisó lo leído y aprieta «Crear».
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { altaDesdePoliza } from '../src/main/servicios/altaDesdePoliza'
import { buscarClientes, clientePorDocumento, fichaDeCliente, listarClientes } from '../src/main/servicios/clientes'
import { crearPoliza, darDeBajaPoliza, editarPoliza, patenteDadaDeBaja, polizasDeCliente, vehiculosDeCliente } from '../src/main/servicios/polizas'
import { editarRegla, matrizDeCobertura } from '../src/main/servicios/reglas'
import { DIRECCION_VACIA } from '../src/shared/direccion'
import type { DatosDeAltaDesdePoliza } from '../src/shared/lecturaDePoliza'
import { hoyLocal } from '../src/shared/semaforo'
import type { DatosDePoliza, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { importar } from './ayuda'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 1, nombre: 'Daniel' }, debeCambiarClave: false }
// Una empleada con el id del único usuario que hay en la base en memoria: el historial del alta lo referencia
// y, con un id inexistente, fallaría por la clave foránea y no por la regla que se quiere probar.
const EMPLEADA: SesionUsuario = { ...DANIEL, nombre: 'Brenda Empleada', usuario: 'brenda', rol: 'EMPLEADO' }

/** La cartera de prueba de siempre, en una base en memoria. */
async function cartera(): Promise<void> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))
}

function idDeCliente(nombre: string): number {
  const encontrado = buscarClientes(nombre)[0]
  if (!encontrado) throw new Error(`No está «${nombre}»`)
  return encontrado.id
}

function totalDeClientes(): number {
  return listarClientes({ busqueda: '', sucursales: [], companias: [], estado: '' }).total
}

/** Un alta completa de un cliente nuevo, como la deja la pantalla después de revisar. */
function datosDeAlta(cambios: Partial<DatosDeAltaDesdePoliza> = {}): DatosDeAltaDesdePoliza {
  return {
    clienteExistenteId: null,
    cliente: {
      nombre: 'GÓMEZ JUAN PABLO',
      documento: '31.222.333',
      telefono: '11 5555 1234',
      email: 'juan@correo.com',
      direccion: 'AV. HIPÓLITO YRIGOYEN 1234',
      localidad: 'LANÚS',
      sucursal: '',
      fechaNacimiento: '',
      profesion: '',
      direccionDetalle: { ...DIRECCION_VACIA, calle: 'AV. HIPÓLITO YRIGOYEN', altura: '1234', localidad: 'LANÚS', provincia: 'BUENOS AIRES' },
    },
    vehiculo: { tipo: 'AUTO', patente: 'AA999ZZ', marca: 'FORD', modelo: 'FIESTA', anio: '2018', motor: 'HH123456', chasis: '9BFZZZ54ZJB123456', uso: '', color: '' },
    poliza: {
      compania: 'SANCOR',
      numero: '5550001',
      propuesta: '',
      cobertura: 'TERCEROS COMPLETO',
      vigenciaDesde: '27/04/2026',
      vigenciaHasta: '27/04/2027',
      formaPago: 'EFECTIVO',
      cuota: '',
      observaciones: '',
    },
    confirmadoPeseAlAviso: false,
    confirmadoPatenteDeBaja: false,
    adjunto: null,
    ...cambios,
  }
}

function cargarReglaDeSancor(): void {
  const regla = matrizDeCobertura(DANIEL).reglas.find((r) => r.compania === 'SANCOR' && r.cobertura === 'TERCEROS COMPLETO')
  assert.ok(regla, 'la hoja simulada trae esa regla en la pestaña COBERTURA')
  editarRegla(
    regla.id,
    {
      compania: regla.compania ?? '',
      cobertura: regla.cobertura ?? '',
      incluye: regla.incluye ?? '',
      franquicia: regla.franquicia ?? '',
      detalle: regla.detalle ?? '',
      observaciones: regla.observaciones ?? '',
      antiguedadMaxima: '15',
      anioMinimo: '',
    },
    DANIEL,
  )
}

/** Una póliza de otro cliente para dejar una patente tomada (y poder darla de baja). */
function polizaDeOtro(clienteId: number, patente: string, numero: string) {
  const datos: DatosDePoliza = {
    clienteId,
    vehiculoId: null,
    vehiculoNuevo: { patente, marca: 'FORD', modelo: 'FALCON', linea: '', anio: '2022', tipo: 'AUTO', categoria: '', catalogoCodigo: '', motor: '', chasis: '', uso: '', color: '', direccionRiesgo: '', titularNombre: '', titularDocumento: '', integrantes: [] },
    compania: 'SANCOR',
    cobertura: 'TERCEROS COMPLETO',
    formaPago: 'EFECTIVO',
    cuota: '',
    diaVencimiento: '',
    numero,
    propuesta: '',
    vigenciaDesde: '01/09/2026',
    vigenciaHasta: '01/09/2027',
    avisarVto: '',
    observaciones: '',
    confirmadoPeseAlAviso: false,
  }
  return crearPoliza(datos, DANIEL)
}

test('crea el cliente, el auto y la póliza de una vez', async () => {
  await cartera()
  const antes = totalDeClientes()

  const resultado = await altaDesdePoliza(datosDeAlta(), DANIEL)
  assert.equal(resultado.creado, true)
  if (!resultado.creado) return

  assert.equal(totalDeClientes(), antes + 1)
  assert.equal(resultado.cliente.nombre, 'GÓMEZ JUAN PABLO')
  assert.equal(resultado.cliente.documento, '31.222.333')
  assert.equal(resultado.cliente.telefono, '11 5555 1234')
  assert.equal(resultado.cliente.email, 'juan@correo.com')
  assert.equal(resultado.adjuntoGuardado, false, 'no había PDF para adjuntar')

  const polizas = polizasDeCliente(resultado.cliente.id)
  assert.equal(polizas.length, 1)
  assert.equal(polizas[0]?.id, resultado.polizaId)
  assert.equal(polizas[0]?.compania, 'SANCOR')
  assert.equal(polizas[0]?.numero, '5550001')
  assert.equal(polizas[0]?.cobertura, 'TERCEROS COMPLETO')
  assert.equal(polizas[0]?.formaPago, 'EFECTIVO')
  assert.equal(polizas[0]?.vigenciaDesde, '27/04/2026')

  // El auto queda como los cargados a mano: texto leído, tipo AUTO, sin nada del catálogo.
  const autos = vehiculosDeCliente(resultado.cliente.id)
  assert.equal(autos.length, 1)
  assert.equal(autos[0]?.patente, 'AA999ZZ')
  assert.equal(autos[0]?.marca, 'FORD')
  assert.equal(autos[0]?.motor, 'HH123456')
  assert.equal(autos[0]?.chasis, '9BFZZZ54ZJB123456')
  assert.equal(autos[0]?.tipo, 'AUTO')
  assert.equal(autos[0]?.linea, null)
  assert.equal(autos[0]?.categoria, null)
})

test('una moto leída del PDF queda cargada como moto, no como auto', async () => {
  await cartera()
  const datos = datosDeAlta()
  datos.vehiculo = { ...datos.vehiculo, tipo: 'MOTO', patente: 'A098XYZ', marca: 'HONDA', modelo: 'WAVE 110 S', anio: '2023', motor: 'JA39E7654321', chasis: '8CHJA3910PP000123' }
  const resultado = await altaDesdePoliza(datos, DANIEL)
  assert.equal(resultado.creado, true)
  if (!resultado.creado) return

  const motos = vehiculosDeCliente(resultado.cliente.id)
  assert.equal(motos.length, 1)
  assert.equal(motos[0]?.patente, 'A098XYZ')
  assert.equal(motos[0]?.tipo, 'MOTO')
  assert.equal(polizasDeCliente(resultado.cliente.id)[0]?.id, resultado.polizaId)
})

test('si la póliza falla no queda ningún cliente nuevo', async () => {
  await cartera()
  const antes = totalDeClientes()

  // La cobertura es obligatoria en un auto: la póliza se rechaza DESPUÉS de haber armado el cliente.
  const sinCobertura = datosDeAlta()
  sinCobertura.poliza.cobertura = ''
  await assert.rejects(() => altaDesdePoliza(sinCobertura, DANIEL), /cobertura/i)

  assert.equal(totalDeClientes(), antes, 'no se creó el cliente')
  assert.equal(clientePorDocumento('31.222.333'), null)
})

test('con el DNI de un cliente que ya existe no crea nada y devuelve quién es', async () => {
  await cartera()
  const antes = totalDeClientes()
  const lopez = idDeCliente(CLIENTES.lopez.nombre)
  const polizasAntes = polizasDeCliente(lopez).length

  const datos = datosDeAlta()
  datos.cliente.documento = CLIENTES.lopez.dni
  const resultado = await altaDesdePoliza(datos, DANIEL)

  assert.equal(resultado.creado, false)
  if (resultado.creado) return
  assert.equal(resultado.yaExiste.id, lopez)
  assert.equal(totalDeClientes(), antes)
  assert.equal(polizasDeCliente(lopez).length, polizasAntes, 'tampoco se le cargó la póliza por las dudas')
})

test('con un cliente existente agrega el auto y la póliza sin tocar los datos del cliente', async () => {
  await cartera()
  const lopez = idDeCliente(CLIENTES.lopez.nombre)
  const antes = fichaDeCliente(lopez)
  const polizasAntes = polizasDeCliente(lopez).length

  // El PDF trae otro teléfono, otro nombre y otra dirección: nada de eso se aplica a un cliente que ya está.
  const datos = datosDeAlta({ clienteExistenteId: lopez })
  datos.cliente.documento = CLIENTES.lopez.dni
  const resultado = await altaDesdePoliza(datos, DANIEL)

  assert.equal(resultado.creado, true)
  if (!resultado.creado) return
  assert.equal(resultado.cliente.id, lopez)
  assert.equal(polizasDeCliente(lopez).length, polizasAntes + 1)
  assert.ok(vehiculosDeCliente(lopez).some((v) => v.patente === 'AA999ZZ'))

  const despues = fichaDeCliente(lopez)
  assert.equal(despues.nombre, antes.nombre)
  assert.equal(despues.documento, antes.documento)
  assert.equal(despues.telefono, antes.telefono)
  assert.equal(despues.email, antes.email)
  assert.equal(despues.direccion, antes.direccion)
})

test('agregar la póliza a un cliente que no existe es un error y no crea nada', async () => {
  await cartera()
  const antes = totalDeClientes()
  await assert.rejects(() => altaDesdePoliza(datosDeAlta({ clienteExistenteId: 999_999 }), DANIEL))
  assert.equal(totalDeClientes(), antes)
})

test('el aviso de antigüedad frena el alta, a una empleada no la deja pasar y a un administrador, con confirmación', async () => {
  await cartera()
  cargarReglaDeSancor()
  const antes = totalDeClientes()
  const viejo = (confirmado: boolean) => {
    const datos = datosDeAlta({ confirmadoPeseAlAviso: confirmado })
    datos.vehiculo.anio = '1995'
    return datos
  }

  await assert.rejects(() => altaDesdePoliza(viejo(false), DANIEL), /1995|antigüedad|acepta/i)
  await assert.rejects(() => altaDesdePoliza(viejo(true), EMPLEADA), /administrador/i)
  assert.equal(totalDeClientes(), antes, 'ni la advertencia ni el rechazo dejaron un cliente a medias')

  const resultado = await altaDesdePoliza(viejo(true), DANIEL)
  assert.equal(resultado.creado, true)
  assert.equal(totalDeClientes(), antes + 1)
})

test('una patente que otro cliente todavía tiene asegurada es un error y no crea nada', async () => {
  await cartera()
  const antes = totalDeClientes()
  const datos = datosDeAlta()
  datos.vehiculo.patente = CLIENTES.suarez.patente
  await assert.rejects(() => altaDesdePoliza(datos, DANIEL), /a nombre de otro cliente/)
  assert.equal(totalDeClientes(), antes)
})

test('una patente dada de baja por otro cliente avisa con patenteDadaDeBaja(null) y se reusa con confirmación', async () => {
  await cartera()
  const vendedor = idDeCliente(CLIENTES.rodriguez.nombre)
  const deAntes = polizaDeOtro(vendedor, 'AF777ZZ', '9007000')
  // Mientras la tiene asegurada no hay aviso que valga: está tomada.
  assert.equal(patenteDadaDeBaja(null, 'AF777ZZ'), null)

  darDeBajaPoliza(deAntes.id, { motivo: 'VENDIO', nota: '' }, DANIEL)
  const hoy = hoyLocal()
  assert.deepEqual(patenteDadaDeBaja(null, 'af 777 zz'), {
    patente: 'AF777ZZ',
    fechaBaja: `${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${hoy.slice(0, 4)}`,
    clienteAnterior: CLIENTES.rodriguez.nombre,
  })
  assert.equal(patenteDadaDeBaja(vendedor, 'AF777ZZ'), null, 'al propio dueño no se le avisa')

  const antes = totalDeClientes()
  const datos = (confirmado: boolean) => {
    const base = datosDeAlta({ confirmadoPatenteDeBaja: confirmado })
    base.vehiculo.patente = 'AF777ZZ'
    return base
  }
  await assert.rejects(() => altaDesdePoliza(datos(false), DANIEL), /dada de baja/)
  assert.equal(totalDeClientes(), antes, 'sin confirmar no quedó ningún cliente')

  const resultado = await altaDesdePoliza(datos(true), DANIEL)
  assert.equal(resultado.creado, true)
  if (!resultado.creado) return
  assert.equal(vehiculosDeCliente(resultado.cliente.id)[0]?.id, deAntes.vehiculoId, 'es el mismo auto: la misma fila')
})

test('el PDF se adjunta a la póliza, y si el adjunto falla la póliza igual queda creada', async () => {
  await cartera()
  const pdf = { nombre: 'poliza.pdf', contenido: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) }

  const llamadas: Array<{ polizaId: number; nombre: string; tipo: string }> = []
  const bien = await altaDesdePoliza(datosDeAlta({ adjunto: pdf }), DANIEL, async (polizaId, archivos) => {
    for (const a of archivos) llamadas.push({ polizaId, nombre: a.nombre, tipo: a.tipo })
    return []
  })
  assert.equal(bien.creado, true)
  if (!bien.creado) return
  assert.equal(bien.adjuntoGuardado, true)
  assert.deepEqual(llamadas, [{ polizaId: bien.polizaId, nombre: 'poliza.pdf', tipo: 'application/pdf' }])

  const datos = datosDeAlta({ adjunto: pdf })
  datos.cliente.documento = '32.444.555'
  datos.poliza.numero = '5550002'
  datos.vehiculo.patente = 'AA888YY'
  const mal = await altaDesdePoliza(datos, DANIEL, async () => {
    throw new Error('Drive no responde')
  })
  assert.equal(mal.creado, true)
  if (!mal.creado) return
  assert.equal(mal.adjuntoGuardado, false)
  assert.equal(polizasDeCliente(mal.cliente.id).length, 1, 'la póliza quedó')
})

test('editarPoliza sigue andando después del alta combinada', async () => {
  // Que lo creado por el alta desde el PDF sea una póliza como cualquier otra: se puede editar.
  await cartera()
  const resultado = await altaDesdePoliza(datosDeAlta(), DANIEL)
  assert.equal(resultado.creado, true)
  if (!resultado.creado) return
  const poliza = polizasDeCliente(resultado.cliente.id)[0]
  assert.ok(poliza)
  const editada = editarPoliza(
    poliza.id,
    {
      clienteId: resultado.cliente.id,
      vehiculoId: poliza.vehiculoId,
      vehiculoNuevo: null,
      compania: 'SANCOR',
      cobertura: 'TODO RIESGO',
      formaPago: 'EFECTIVO',
      cuota: '',
      diaVencimiento: '',
      numero: '5550001',
      propuesta: '',
      vigenciaDesde: '27/04/2026',
      vigenciaHasta: '27/04/2027',
      avisarVto: '',
      observaciones: '',
      confirmadoPeseAlAviso: false,
    },
    DANIEL,
  )
  assert.equal(editada.cobertura, 'TODO RIESGO')
})
