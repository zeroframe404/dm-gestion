// Fase 8 de punta a punta: la consulta que entra por WhatsApp, el presupuesto con tres compañías, la
// tarea que se le asigna a otro, y las tres pestañas nuevas apareciendo solas en la hoja.
//
// Los cuatro criterios del pliego, en el mismo orden:
//   1. se carga un lead, se convierte en cliente y no se tipea nada dos veces;
//   2. un presupuesto con 3 opciones sale con el mensaje de WhatsApp prolijo;
//   3. una tarea asignada a otro usuario le aparece en Inicio y en la campana;
//   4. APP LEADS / APP PRESUPUESTOS / APP TAREAS aparecen en la hoja.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones, MIGRACIONES } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/adjuntos'
import { fichaDeCliente, listarClientes } from '../src/main/servicios/clientes'
import { historialDeFila } from '../src/main/servicios/historial'
import {
  agregarNotaDeLead,
  cambiarEstadoDeLead,
  convertirLeadEnCliente,
  crearLead,
  editarLead,
  fichaDeLead,
  listarLeads,
} from '../src/main/servicios/leads'
import {
  aceptarPresupuesto,
  crearPresupuesto,
  enviarPresupuesto,
  fichaDePresupuesto,
  guardarPresupuesto,
  htmlDelPresupuesto,
  listarPresupuestos,
  rechazarPresupuesto,
  saludo,
} from '../src/main/servicios/presupuestos'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import {
  agregarAdjuntosDeTarea,
  agregarComentario,
  avisosDeTareas,
  cambiarEstadoDeTareaDelModulo,
  crearTareaCompleta,
  editarTarea,
  fichaDeTarea,
  listarTareas,
  marcarAvisosVistos,
  misTareas,
} from '../src/main/servicios/tareas'
import { bajarCambios } from '../src/main/sincronizacion/bajada'
import { cuantasPendientes } from '../src/main/sincronizacion/cola'
import { leerContexto } from '../src/main/sincronizacion/hoja'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { DatosDeLead, DatosDePresupuesto, DatosDeTareaCompleta, FiltrosTareas, SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** El segundo usuario: es a quien se le asignan las tareas para probar que las ve. */
const LUCIA: SesionUsuario = {
  id: 2,
  nombre: 'Lucía Gómez',
  usuario: 'lucia',
  rol: 'EMPLEADO',
  sucursal: { id: 2, nombre: 'Lanús' },
  debeCambiarClave: false,
}

const SIN_FILTROS_DE_LEAD = { busqueda: '', estado: '' as const, origen: '' as const, sucursal: '', incluirCerrados: false }
const SIN_FILTROS_DE_TAREA: FiltrosTareas = {
  busqueda: '',
  estado: '',
  prioridad: '',
  responsableId: 0,
  sucursal: '',
  soloVencidas: false,
}

const LEAD_VACIO: DatosDeLead = {
  nombre: '',
  telefono: '',
  sucursal: '',
  interes: '',
  tipoVehiculo: '',
  origen: '',
  estado: '',
  documento: '',
  email: '',
  nota: '',
}

const PRESUPUESTO_VACIO: DatosDePresupuesto = {
  leadId: null,
  clienteId: null,
  clienteNombre: '',
  telefono: '',
  documento: '',
  sucursal: '',
  patente: '',
  marca: '',
  modelo: '',
  anio: '',
  tipoVehiculo: '',
  observaciones: '',
  opciones: [],
}

const TAREA_VACIA: DatosDeTareaCompleta = {
  titulo: '',
  detalle: '',
  responsableId: null,
  sucursal: '',
  venceEl: '',
  prioridad: '',
  clienteId: null,
  polizaId: null,
  siniestroId: null,
  renovacionId: null,
  leadId: null,
  presupuestoId: null,
}

const temporales: string[] = []
process.on('exit', () => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true })
})

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-fase8-'))
  temporales.push(carpeta)
  return carpeta
}

usarCarpetaDeAdjuntosDePrueba(carpetaTemporal())

interface Escenario {
  db: BaseDeDatos
  hoja: HojaSimulada
  motor: MotorDeSincronizacion
}

let motorAnterior: MotorDeSincronizacion | null = null

/** Base importada, con el segundo usuario cargado y el motor de sincronización listo. */
async function escenario(): Promise<Escenario> {
  motorAnterior?.apagar()
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba())
  const importar = async () => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as {
      id: number
    }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()
  usarFuenteDePrueba(hoja)

  // Lucía tiene que existir de verdad: asignarle una tarea comprueba que el responsable esté activo.
  db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo)
     VALUES (@id, @nombre, @usuario, 'x', 'EMPLEADO', 2, 1)
     ON CONFLICT(id) DO NOTHING`,
  ).run({ id: LUCIA.id, nombre: LUCIA.nombre, usuario: LUCIA.usuario })

  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  motor.encender()
  motorAnterior = motor
  return { db, hoja, motor }
}

/** Valor de una celda de una pestaña de la hoja simulada, buscando la fila por su _ID. */
function enLaHoja(hoja: HojaSimulada, pestana: string, filaId: string, encabezado: string): string | null {
  const encabezados = hoja.encabezadosDe(pestana)
  const columnaId = hoja.columnaIdDe(pestana)
  const columna = encabezados.findIndex((e) => e.trim() === encabezado)
  if (columnaId < 0 || columna < 0) return null
  const encontrada = hoja.filasDe(pestana).find((f) => (f[columnaId] ?? '').trim() === filaId)
  return encontrada ? (encontrada[columna] ?? '').trim() : null
}

// ---------------------------------------------------------------------------
// 1. Leads: se carga la consulta y se convierte en cliente sin tipear dos veces
// ---------------------------------------------------------------------------

test('una consulta se carga con lo mínimo y arranca en NUEVO', async () => {
  await escenario()
  const ficha = crearLead(
    {
      ...LEAD_VACIO,
      nombre: 'Marcela Ibáñez',
      telefono: '11 5555-4444',
      interes: 'El Gol de la hija',
      tipoVehiculo: 'Auto',
      origen: 'WHATSAPP',
      nota: 'Preguntó por terceros completo.',
    },
    DANIEL,
  )

  assert.equal(ficha.lead.nombre, 'Marcela Ibáñez')
  assert.equal(ficha.lead.estado, 'NUEVO', 'una consulta nueva arranca en NUEVO')
  assert.equal(ficha.lead.origen, 'WHATSAPP')
  assert.equal(ficha.lead.sucursal, DANIEL.sucursal.nombre, 'sin sucursal, la de quien atiende')
  assert.equal(ficha.lead.usuarioNombre, DANIEL.nombre)
  assert.equal(ficha.notas.length, 1, 'la primera nota entra con el alta')
  assert.ok(ficha.lead.urlWhatsapp?.startsWith('https://wa.me/5491155554444'), 'el WhatsApp queda armado')

  const listado = listarLeads(SIN_FILTROS_DE_LEAD)
  assert.equal(listado.total, 1)
  assert.equal(listado.porEstado.NUEVO, 1)
})

test('el listado filtra por estado, origen y texto, y esconde las cerradas', async () => {
  await escenario()
  const nueva = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', telefono: '1122223333', origen: 'REDES', interes: 'moto' }, DANIEL)
  const perdida = crearLead({ ...LEAD_VACIO, nombre: 'Julio Paz', origen: 'LOCAL', interes: 'camioneta' }, DANIEL)
  cambiarEstadoDeLead(perdida.lead.id, 'PERDIDO', DANIEL)

  const abiertas = listarLeads(SIN_FILTROS_DE_LEAD)
  assert.equal(abiertas.filas.length, 1, 'una PERDIDA no es trabajo pendiente: no se muestra')
  assert.equal(abiertas.filas[0]!.id, nueva.lead.id)
  assert.equal(abiertas.porEstado.PERDIDO, 1, 'pero el contador la sigue contando')

  assert.equal(listarLeads({ ...SIN_FILTROS_DE_LEAD, incluirCerrados: true }).filas.length, 2)
  assert.equal(listarLeads({ ...SIN_FILTROS_DE_LEAD, origen: 'REDES' }).filas.length, 1)
  assert.equal(listarLeads({ ...SIN_FILTROS_DE_LEAD, busqueda: 'moto' }).filas.length, 1, 'busca por lo que quería asegurar')
  assert.equal(listarLeads({ ...SIN_FILTROS_DE_LEAD, busqueda: '2222' }).filas.length, 1, 'y por teléfono')
  assert.equal(listarLeads({ ...SIN_FILTROS_DE_LEAD, estado: 'PERDIDO' }).filas.length, 1, 'pidiendo el estado cerrado, aparece')
})

test('«Convertir en cliente» crea el cliente con los datos del lead: no se tipea nada dos veces', async () => {
  await escenario()
  const ficha = crearLead(
    {
      ...LEAD_VACIO,
      nombre: 'Marcela Ibáñez',
      telefono: '11 5555-4444',
      documento: '27-30444555-8',
      email: 'marcela@correo.com',
      sucursal: 'LANUS',
      interes: 'El Gol de la hija',
      origen: 'RECOMENDADO',
    },
    DANIEL,
  )

  const conversion = convertirLeadEnCliente(ficha.lead.id, DANIEL)
  assert.equal(conversion.creado, true)
  assert.equal(conversion.aviso, null)

  // Lo que importa: el cliente salió con TODO lo que ya estaba escrito en la consulta.
  const cliente = fichaDeCliente(conversion.clienteId)
  assert.equal(cliente.nombre, 'Marcela Ibáñez')
  assert.equal(cliente.telefono, '11 5555-4444')
  assert.equal(cliente.documento, '27-30444555-8')
  assert.equal(cliente.email, 'marcela@correo.com')
  assert.equal(cliente.sucursal, 'LANUS')

  // Y la consulta quedó ganada, apuntando a su ficha.
  assert.equal(conversion.lead.lead.estado, 'GANADO')
  assert.equal(conversion.lead.lead.clienteId, conversion.clienteId)
})

test('convertir dos veces no duplica al cliente, y un DNI que ya existe se reusa', async () => {
  await escenario()
  // El DNI de un cliente que ya está en la cartera importada.
  const yaExiste = listarClientes({ busqueda: '30111222', sucursal: '', compania: '', deuda: '' }).filas[0]
  assert.ok(yaExiste, 'la cartera de prueba tiene a Pérez')

  const ficha = crearLead({ ...LEAD_VACIO, nombre: 'Pérez de nuevo', documento: '30111222', origen: 'LOCAL' }, DANIEL)
  const primera = convertirLeadEnCliente(ficha.lead.id, DANIEL)
  assert.equal(primera.creado, false, 'ese DNI ya es de alguien: se usa el que está')
  assert.equal(primera.clienteId, yaExiste.id)
  assert.ok(primera.aviso, 'y se avisa por qué')

  const segunda = convertirLeadEnCliente(ficha.lead.id, DANIEL)
  assert.equal(segunda.clienteId, primera.clienteId, 'convertir de nuevo devuelve el mismo cliente')
  assert.equal(listarClientes({ busqueda: '30111222', sucursal: '', compania: '', deuda: '' }).filas.length, 1, 'no se duplicó nadie')
})

test('las notas de la charla se acumulan y viajan a la columna NOTAS de la hoja', async () => {
  const { db } = await escenario()
  const ficha = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', origen: 'REDES' }, DANIEL)
  agregarNotaDeLead(ficha.lead.id, 'Le pasé el precio de Sancor.', DANIEL)
  const conDos = agregarNotaDeLead(ficha.lead.id, 'Dijo que lo consulta y llama el lunes.', DANIEL)

  assert.equal(conDos.notas.length, 2)
  assert.equal(conDos.notas[0]!.texto, 'Dijo que lo consulta y llama el lunes.', 'la más nueva primero')
  assert.equal(conDos.lead.ultimaNota, 'Dijo que lo consulta y llama el lunes.')

  const ultima = db
    .prepare(`SELECT campos_json FROM cola_sync WHERE pestana = 'APP LEADS' ORDER BY id DESC LIMIT 1`)
    .get() as { campos_json: string }
  const campos = JSON.parse(ultima.campos_json) as Record<string, string>
  assert.ok(campos.observaciones?.includes('Le pasé el precio de Sancor'), 'la hoja recibe la charla entera')
  assert.ok(campos.observaciones?.includes(DANIEL.nombre), 'con quién la escribió')
})

test('editar una consulta anota el cambio en el historial y lo manda a la hoja', async () => {
  await escenario()
  const ficha = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', origen: 'REDES', interes: 'moto' }, DANIEL)
  const editada = editarLead(
    ficha.lead.id,
    { ...LEAD_VACIO, nombre: 'Ana Ruiz', origen: 'REDES', interes: 'moto 150cc', telefono: '1133334444', sucursal: ficha.lead.sucursal ?? '' },
    DANIEL,
  )
  assert.equal(editada.lead.interes, 'moto 150cc')

  const historial = historialDeFila(ficha.lead.filaId)
  assert.ok(historial.some((h) => h.campo === 'QUE ASEGURA' && h.valorNuevo === 'moto 150cc'))
  assert.ok(historial.some((h) => h.campo === 'TELEFONO'))
})

// ---------------------------------------------------------------------------
// 2. Presupuestos: tres opciones y el mensaje de WhatsApp
// ---------------------------------------------------------------------------

/** El presupuesto del pliego: tres compañías cotizadas para el mismo auto. */
function presupuestoDeTresOpciones(leadId: number | null) {
  return crearPresupuesto(
    {
      ...PRESUPUESTO_VACIO,
      leadId,
      clienteNombre: leadId === null ? 'IBAÑEZ MARCELA' : '',
      telefono: leadId === null ? '1155554444' : '',
      marca: 'VOLKSWAGEN',
      modelo: 'GOL TREND',
      anio: '2016',
      patente: 'AB123CD',
      observaciones: 'Los precios son con débito automático.',
      opciones: [
        { compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 52.400', comentario: 'Franquicia $ 250.000' },
        { compania: 'RIVADAVIA', cobertura: 'TERCEROS COMPLETO', precio: '$ 47.900', comentario: '' },
        { compania: 'MERCANTIL ANDINA', cobertura: 'TODO RIESGO', precio: '$ 91.300', comentario: 'Incluye granizo' },
      ],
    },
    DANIEL,
  )
}

test('un presupuesto con tres opciones se guarda con la más barata primero', async () => {
  await escenario()
  const ficha = presupuestoDeTresOpciones(null)

  assert.equal(ficha.presupuesto.numero, 'P-0001', 'el numerador arranca en P-0001')
  assert.equal(ficha.presupuesto.version, 1)
  assert.equal(ficha.presupuesto.estado, 'BORRADOR')
  assert.equal(ficha.opciones.length, 3)
  assert.equal(ficha.opciones[0]!.compania, 'RIVADAVIA', 'la más barata arriba')
  assert.equal(ficha.presupuesto.desde, '$ 47.900')
  assert.equal(ficha.opciones[0]!.precioMonto, 47900, 'el precio también queda como número')
})

test('el mensaje de WhatsApp sale prolijo: saludo, vehículo, una línea por opción y cierre', async () => {
  await escenario()
  const ficha = presupuestoDeTresOpciones(null)
  const lineas = ficha.mensaje.split('\n')

  assert.equal(lineas[0], 'Hola MARCELA, te paso el presupuesto de SEGUROS DANIEL MARTÍNEZ.')
  assert.equal(lineas[1], 'Vehículo: VOLKSWAGEN GOL TREND 2016 (AB123CD)')
  assert.equal(lineas[2], '')
  assert.equal(lineas[3], '1) RIVADAVIA — TERCEROS COMPLETO: $ 47.900 por mes')
  assert.equal(lineas[4], '2) SANCOR — TERCEROS COMPLETO: $ 52.400 por mes')
  assert.equal(lineas[5], '   Franquicia $ 250.000', 'el comentario va debajo de su opción, sangrado')
  assert.equal(lineas[6], '3) MERCANTIL ANDINA — TODO RIESGO: $ 91.300 por mes')
  assert.equal(lineas[7], '   Incluye granizo')
  assert.ok(ficha.mensaje.includes('Los precios son con débito automático.'), 'las observaciones salen en el mensaje')
  assert.ok(ficha.mensaje.trimEnd().endsWith('Cualquier duda escribime.'))

  // Nada de asteriscos ni markdown: en WhatsApp de escritorio queda feo y no se ve igual en todos lados.
  assert.ok(!ficha.mensaje.includes('*'), 'el mensaje no tiene negritas de WhatsApp')
  assert.ok(ficha.urlWhatsapp?.startsWith('https://wa.me/5491155554444?text='))
})

test('el saludo del mensaje usa el nombre, no el apellido, venga de donde venga el nombre', () => {
  // Lo que viene de la hoja está en mayúsculas y escrito APELLIDO NOMBRE.
  assert.equal(saludo('PEREZ JUAN CARLOS'), 'JUAN')
  assert.equal(saludo('GONZALEZ MARIA'), 'MARIA')
  // Lo que se tipeó en la aplicación se escribe como se habla.
  assert.equal(saludo('Rubén Sosa'), 'Rubén')
  assert.equal(saludo('Marcela Ibáñez'), 'Marcela')
  // Y con una sola palabra no hay nada que elegir.
  assert.equal(saludo('Marcela'), 'Marcela')
  assert.equal(saludo(''), '')
})

test('el PDF sale con el nombre de la aseguradora y las opciones', async () => {
  await escenario()
  const ficha = presupuestoDeTresOpciones(null)
  const html = htmlDelPresupuesto(ficha)

  assert.ok(html.includes('SEGUROS DANIEL MARTÍNEZ'), 'el papel lleva el nombre de la agencia')
  assert.ok(html.includes('P-0001'))
  assert.ok(html.includes('IBAÑEZ MARCELA'))
  assert.ok(html.includes('RIVADAVIA') && html.includes('SANCOR') && html.includes('MERCANTIL ANDINA'))
  assert.ok(html.includes('size: A4'))
})

test('«Enviar por WhatsApp» deja el presupuesto ENVIADO y devuelve la dirección lista', async () => {
  await escenario()
  const ficha = presupuestoDeTresOpciones(null)
  const envio = enviarPresupuesto(ficha.presupuesto.id, DANIEL)

  assert.equal(envio.ficha.presupuesto.estado, 'ENVIADO')
  assert.ok(envio.ficha.presupuesto.enviadoEn)
  assert.equal(envio.telefono, '5491155554444')
  assert.ok(envio.url.includes(encodeURIComponent('te paso el presupuesto')))
})

test('cambiar un presupuesto ya enviado crea la versión 2 y deja la anterior tal cual', async () => {
  await escenario()
  const original = presupuestoDeTresOpciones(null)
  enviarPresupuesto(original.presupuesto.id, DANIEL)

  const nueva = guardarPresupuesto(
    original.presupuesto.id,
    {
      ...PRESUPUESTO_VACIO,
      clienteNombre: 'IBAÑEZ MARCELA',
      telefono: '1155554444',
      marca: 'VOLKSWAGEN',
      modelo: 'GOL TREND',
      anio: '2016',
      patente: 'AB123CD',
      opciones: [{ compania: 'RIVADAVIA', cobertura: 'TERCEROS COMPLETO', precio: '$ 51.200', comentario: 'Actualizado' }],
    },
    DANIEL,
  )

  assert.equal(nueva.presupuesto.version, 2)
  assert.equal(nueva.presupuesto.numero, 'P-0001', 'el número es el mismo: es el mismo presupuesto')
  assert.equal(nueva.presupuesto.estado, 'BORRADOR', 'la versión nueva vuelve a empezar')
  assert.equal(nueva.presupuesto.vigente, true)
  assert.equal(nueva.versiones.length, 1)

  // La versión 1 quedó intacta, con sus tres precios: es lo que el cliente ya tiene en el teléfono.
  const vieja = fichaDePresupuesto(original.presupuesto.id)
  assert.equal(vieja.presupuesto.vigente, false)
  assert.equal(vieja.presupuesto.estado, 'ENVIADO')
  assert.equal(vieja.opciones.length, 3)
  assert.equal(vieja.opciones[0]!.precio, '$ 47.900')

  // El listado muestra sólo la vigente, salvo que se pidan las anteriores.
  assert.equal(listarPresupuestos({ busqueda: '', estado: '', sucursal: '', incluirVersiones: false }).filas.length, 1)
  assert.equal(listarPresupuestos({ busqueda: '', estado: '', sucursal: '', incluirVersiones: true }).filas.length, 2)
})

test('editar un BORRADOR lo pisa, sin crear versiones nuevas', async () => {
  await escenario()
  const original = presupuestoDeTresOpciones(null)
  const editado = guardarPresupuesto(
    original.presupuesto.id,
    {
      ...PRESUPUESTO_VACIO,
      clienteNombre: 'IBAÑEZ MARCELA',
      telefono: '1155554444',
      opciones: [{ compania: 'RIVADAVIA', cobertura: 'TERCEROS', precio: '$ 30.000', comentario: '' }],
    },
    DANIEL,
  )
  assert.equal(editado.presupuesto.id, original.presupuesto.id, 'sigue siendo el mismo')
  assert.equal(editado.presupuesto.version, 1)
  assert.equal(editado.opciones.length, 1)
  assert.equal(editado.versiones.length, 0)
})

test('el presupuesto de una consulta la deja COTIZADA, y aceptarlo ofrece emitir la póliza', async () => {
  await escenario()
  const lead = crearLead({ ...LEAD_VACIO, nombre: 'Marcela Ibáñez', telefono: '1155554444', origen: 'WHATSAPP' }, DANIEL)
  const ficha = presupuestoDeTresOpciones(lead.lead.id)

  assert.equal(fichaDeLead(lead.lead.id).lead.estado, 'COTIZADO', 'pasarle un precio es haberla cotizado')
  assert.equal(ficha.presupuesto.clienteNombre, 'Marcela Ibáñez', 'el nombre sale del lead, no se re-tipea')

  // Sin cliente todavía, aceptar avisa que primero hay que convertir la consulta.
  const sinCliente = aceptarPresupuesto(ficha.presupuesto.id, ficha.opciones[0]!.id, DANIEL)
  assert.equal(sinCliente.ficha.presupuesto.estado, 'ACEPTADO')
  assert.equal(sinCliente.ficha.opciones[0]!.aceptada, true)
  assert.equal(sinCliente.clienteId, null)
  assert.ok(sinCliente.aviso?.includes('Convertí la consulta'))

  // Convertida la consulta, el presupuesto ya sabe de qué cliente es.
  const conversion = convertirLeadEnCliente(lead.lead.id, DANIEL)
  assert.equal(fichaDePresupuesto(ficha.presupuesto.id).presupuesto.clienteId, conversion.clienteId)
})

test('rechazar un presupuesto guarda el motivo, que es lo único que después explica la pérdida', async () => {
  await escenario()
  const ficha = presupuestoDeTresOpciones(null)
  const rechazado = rechazarPresupuesto(ficha.presupuesto.id, 'Consiguió más barato en la esquina', DANIEL)

  assert.equal(rechazado.presupuesto.estado, 'RECHAZADO')
  assert.ok(rechazado.presupuesto.observaciones?.includes('No lo tomó: Consiguió más barato en la esquina'))
})

test('un presupuesto sin ninguna opción no se guarda', async () => {
  await escenario()
  assert.throws(() => crearPresupuesto({ ...PRESUPUESTO_VACIO, clienteNombre: 'Alguien' }, DANIEL), /al menos una opción/i)
})

// ---------------------------------------------------------------------------
// 3. Tareas: se le asigna a otro y la ve en Inicio y en la campana
// ---------------------------------------------------------------------------

test('una tarea asignada a otro usuario le aparece en su Inicio y le enciende la campana', async () => {
  await escenario()
  const tarea = crearTareaCompleta(
    { ...TAREA_VACIA, titulo: 'Llamar al perito de Sancor', responsableId: LUCIA.id, prioridad: 'ALTA', venceEl: avisosDeTareas(DANIEL).hoy },
    DANIEL,
  )

  assert.equal(tarea.responsableNombre, LUCIA.nombre)
  assert.equal(tarea.prioridad, 'ALTA')
  assert.equal(tarea.estado, 'pendiente')

  // En su Inicio.
  const suyas = misTareas(LUCIA)
  assert.equal(suyas.length, 1)
  assert.equal(suyas[0]!.id, tarea.id)

  // Y en la campana, con el punto encendido porque todavía no la vio.
  const avisos = avisosDeTareas(LUCIA)
  assert.equal(avisos.nuevas, 1, 'es una novedad: encendió la campana')
  assert.equal(avisos.venceHoy, 1)
  assert.equal(avisos.pendientes, 1)
  assert.equal(avisos.filas[0]!.titulo, 'Llamar al perito de Sancor')

  // A quien la creó no le aparece nada: no es de él.
  assert.equal(misTareas(DANIEL).length, 0)
  assert.equal(avisosDeTareas(DANIEL).pendientes, 0)

  // Abrir la campana cuenta como enterarse: el punto se apaga, la tarea sigue pendiente.
  const vistos = marcarAvisosVistos(LUCIA)
  assert.equal(vistos.nuevas, 0)
  assert.equal(vistos.pendientes, 1)
})

test('la tarea que me pongo yo mismo no me enciende la campana', async () => {
  await escenario()
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Ordenar el archivo', responsableId: DANIEL.id }, DANIEL)
  const avisos = avisosDeTareas(DANIEL)
  assert.equal(avisos.pendientes, 1, 'la tengo pendiente')
  assert.equal(avisos.nuevas, 0, 'pero no es ninguna novedad: la escribí yo')
})

test('reasignar una tarea se la avisa al nuevo dueño', async () => {
  await escenario()
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Pedir la cédula verde', responsableId: DANIEL.id }, DANIEL)
  assert.equal(avisosDeTareas(LUCIA).nuevas, 0)

  editarTarea(
    tarea.id,
    { titulo: 'Pedir la cédula verde', detalle: '', responsableId: LUCIA.id, sucursal: '', venceEl: '', prioridad: 'NORMAL', estado: 'pendiente' },
    DANIEL,
  )
  assert.equal(avisosDeTareas(LUCIA).nuevas, 1, 'ahora es de Lucía y no lo sabía')
  assert.equal(avisosDeTareas(DANIEL).pendientes, 0, 'y ya no es de Daniel')
})

test('abrir la ficha de una tarea propia la marca como vista', async () => {
  await escenario()
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Mandar la póliza por mail', responsableId: LUCIA.id }, DANIEL)
  assert.equal(avisosDeTareas(LUCIA).nuevas, 1)

  fichaDeTarea(tarea.id, LUCIA)
  assert.equal(avisosDeTareas(LUCIA).nuevas, 0, 'la abrió: ya se enteró')

  // Que la abra otro no apaga el aviso de su dueña.
  const otra = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Otra más', responsableId: LUCIA.id }, DANIEL)
  fichaDeTarea(otra.id, DANIEL)
  assert.equal(avisosDeTareas(LUCIA).nuevas, 1)
})

test('las tareas se ordenan por lo abierto, lo urgente y lo que vence antes', async () => {
  await escenario()
  const hoy = avisosDeTareas(DANIEL).hoy
  const ayer = new Date(new Date(hoy).getTime() - 86_400_000).toISOString().slice(0, 10)

  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Sin fecha, normal', responsableId: DANIEL.id }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Vencida ayer', responsableId: DANIEL.id, venceEl: ayer }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Urgente', responsableId: DANIEL.id, prioridad: 'ALTA' }, DANIEL)
  const hecha = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Ya hecha', responsableId: DANIEL.id, prioridad: 'ALTA' }, DANIEL)
  cambiarEstadoDeTareaDelModulo(hecha.id, 'hecha', DANIEL)

  const listado = listarTareas(SIN_FILTROS_DE_TAREA)
  assert.equal(listado.filas[0]!.titulo, 'Urgente', 'lo de prioridad ALTA primero')
  assert.equal(listado.filas[listado.filas.length - 1]!.titulo, 'Ya hecha', 'lo hecho al final')
  assert.equal(listado.vencidas, 1)

  const vencida = listado.filas.find((t) => t.titulo === 'Vencida ayer')!
  assert.equal(vencida.vencida, true)
  assert.equal(vencida.diasParaVencer, -1)

  // Una tarea hecha no está vencida aunque su fecha haya pasado.
  const conFechaVieja = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Vieja y hecha', responsableId: DANIEL.id, venceEl: ayer }, DANIEL)
  cambiarEstadoDeTareaDelModulo(conFechaVieja.id, 'hecha', DANIEL)
  assert.equal(listarTareas(SIN_FILTROS_DE_TAREA).filas.find((t) => t.id === conFechaVieja.id)!.vencida, false)
})

test('los filtros de responsable, prioridad y vencidas acotan el listado', async () => {
  await escenario()
  const hoy = avisosDeTareas(DANIEL).hoy
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'De Lucía', responsableId: LUCIA.id, venceEl: hoy }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'De Daniel', responsableId: DANIEL.id, prioridad: 'ALTA' }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'De nadie', responsableId: null }, DANIEL)

  assert.equal(listarTareas({ ...SIN_FILTROS_DE_TAREA, responsableId: LUCIA.id }).filas.length, 1)
  assert.equal(listarTareas({ ...SIN_FILTROS_DE_TAREA, responsableId: -1 }).filas.length, 1, '-1 son las que no tienen dueño')
  assert.equal(listarTareas({ ...SIN_FILTROS_DE_TAREA, prioridad: 'ALTA' }).filas.length, 1)
  assert.equal(listarTareas({ ...SIN_FILTROS_DE_TAREA, soloVencidas: true }).filas.length, 1, 'la que vence hoy')
  assert.equal(listarTareas({ ...SIN_FILTROS_DE_TAREA, busqueda: 'lucía' }).filas.length, 1, 'busca también por responsable')
})

test('una tarea puede colgar de una consulta, y desde ahí se la ve', async () => {
  await escenario()
  const lead = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', origen: 'REDES' }, DANIEL)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Volver a llamarla', leadId: lead.lead.id, responsableId: DANIEL.id }, DANIEL)

  assert.equal(tarea.vinculo, 'lead')
  assert.equal(tarea.vinculoId, lead.lead.id)
  assert.equal(tarea.vinculoTexto, 'Consulta de Ana Ruiz')
  assert.equal(fichaDeLead(lead.lead.id).tareas.length, 1, 'la ficha de la consulta la muestra')
  assert.equal(fichaDeLead(lead.lead.id).lead.tareasPendientes, 1)
})

test('los comentarios y los documentos de una tarea quedan con su fecha y su firma', async () => {
  await escenario()
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Juntar la documentación', responsableId: LUCIA.id }, DANIEL)

  const conComentario = agregarComentario(tarea.id, 'Llamé y no atendieron.', LUCIA)
  assert.equal(conComentario.comentarios.length, 1)
  assert.equal(conComentario.comentarios[0]!.usuarioNombre, LUCIA.nombre)
  assert.equal(conComentario.tarea.comentarios, 1)

  const archivo = path.join(carpetaTemporal(), 'cédula verde.pdf')
  writeFileSync(archivo, 'PDF de prueba')
  const conAdjunto = await agregarAdjuntosDeTarea(tarea.id, [archivo], LUCIA)
  assert.equal(conAdjunto.adjuntos.length, 1)
  assert.equal(conAdjunto.adjuntos[0]!.nombre, 'cédula verde.pdf')
  assert.equal(conAdjunto.tarea.adjuntos, 1)
})

test('una tarea sin título no se crea, y un responsable inexistente se rechaza', async () => {
  await escenario()
  assert.throws(() => crearTareaCompleta({ ...TAREA_VACIA, titulo: '' }, DANIEL), /título/i)
  assert.throws(() => crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Algo', responsableId: 999 }, DANIEL), /responsable/i)
  assert.throws(() => crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Algo', venceEl: '31/12/2026' }, DANIEL), /fecha/i)
})

// ---------------------------------------------------------------------------
// 4. Las tres pestañas nuevas aparecen en la hoja
// ---------------------------------------------------------------------------

test('APP LEADS, APP PRESUPUESTOS y APP TAREAS se crean solas al final de la hoja', async () => {
  const { hoja, motor } = await escenario()
  const antes = hoja.titulos()
  assert.ok(!antes.includes('APP LEADS'), 'la hoja de la agencia no las tiene: son de la aplicación')

  const lead = crearLead(
    { ...LEAD_VACIO, nombre: 'Marcela Ibáñez', telefono: '1155554444', interes: 'El Gol de la hija', origen: 'WHATSAPP', documento: '30444555' },
    DANIEL,
  )
  presupuestoDeTresOpciones(lead.lead.id)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Llamar al perito', responsableId: LUCIA.id, venceEl: avisosDeTareas(DANIEL).hoy }, DANIEL)

  assert.ok(cuantasPendientes() > 0, 'todo eso está esperando para subir')
  await motor.ciclarSubida()

  const despues = hoja.titulos()
  for (const titulo of ['APP LEADS', 'APP PRESUPUESTOS', 'APP TAREAS']) {
    assert.ok(despues.includes(titulo), `falta la pestaña «${titulo}»`)
    assert.ok(despues.indexOf(titulo) >= antes.length, `«${titulo}» tiene que quedar al final del archivo`)
  }
  assert.equal(cuantasPendientes(), 0, 'y todo subió')
})

test('lo que se carga en los tres módulos aparece en su pestaña, en la columna que corresponde', async () => {
  const { hoja, motor } = await escenario()
  const lead = crearLead(
    {
      ...LEAD_VACIO,
      nombre: 'Marcela Ibáñez',
      telefono: '1155554444',
      documento: '30444555',
      interes: 'El Gol de la hija',
      tipoVehiculo: 'Auto',
      origen: 'WHATSAPP',
      sucursal: 'LANUS',
    },
    DANIEL,
  )
  const presupuesto = presupuestoDeTresOpciones(lead.lead.id)
  const tarea = crearTareaCompleta(
    { ...TAREA_VACIA, titulo: 'Llamar al perito', detalle: 'Antes del jueves', responsableId: LUCIA.id, prioridad: 'ALTA', leadId: lead.lead.id },
    DANIEL,
  )
  await motor.ciclarSubida()

  // La consulta, con sus columnas.
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'NOMBRE'), 'Marcela Ibáñez')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'TELEFONO'), '1155554444')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'ORIGEN'), 'WHATSAPP')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'QUE ASEGURA'), 'El Gol de la hija')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'LOCAL'), 'LANUS')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'ESTADO'), 'COTIZADO', 'el presupuesto ya la dejó cotizada')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'CARGADO POR'), DANIEL.nombre)

  // El presupuesto, con el resumen de sus tres opciones en una celda.
  const filaPresupuesto = presupuesto.presupuesto.filaId
  assert.equal(enLaHoja(hoja, 'APP PRESUPUESTOS', filaPresupuesto, 'NUMERO'), 'P-0001')
  assert.equal(enLaHoja(hoja, 'APP PRESUPUESTOS', filaPresupuesto, 'VERSION'), '1')
  assert.equal(enLaHoja(hoja, 'APP PRESUPUESTOS', filaPresupuesto, 'PATENTE'), 'AB123CD')
  assert.equal(enLaHoja(hoja, 'APP PRESUPUESTOS', filaPresupuesto, 'PRECIO DESDE'), '$ 47.900')
  const opciones = enLaHoja(hoja, 'APP PRESUPUESTOS', filaPresupuesto, 'OPCIONES') ?? ''
  assert.ok(opciones.includes('RIVADAVIA') && opciones.includes('SANCOR') && opciones.includes('MERCANTIL ANDINA'))

  // La tarea, con su responsable y su vínculo en palabras.
  const filaTarea = (await import('../src/main/db/base')).db().prepare('SELECT fila_id FROM tareas WHERE id = ?').get(tarea.id) as {
    fila_id: string
  }
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'TITULO'), 'Llamar al perito')
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'ASIGNADO A'), LUCIA.nombre)
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'PRIORIDAD'), 'ALTA')
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'ESTADO'), 'Pendiente')
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'VINCULO'), 'Consulta de Marcela Ibáñez')
  assert.equal(enLaHoja(hoja, 'APP TAREAS', filaTarea.fila_id, 'CREADO POR'), DANIEL.nombre)
})

test('cambiar el estado después actualiza la misma fila, no crea otra', async () => {
  const { hoja, motor } = await escenario()
  const lead = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', telefono: '1122223333', origen: 'REDES' }, DANIEL)
  await motor.ciclarSubida()
  const filasAlPrincipio = hoja.filasDe('APP LEADS').length

  cambiarEstadoDeLead(lead.lead.id, 'EN CHARLA', DANIEL)
  await motor.ciclarSubida()

  assert.equal(hoja.filasDe('APP LEADS').length, filasAlPrincipio, 'la misma fila, corregida')
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'ESTADO'), 'EN CHARLA')
})

test('volver a leer las pestañas nuevas no duplica nada ni pide una importación completa', async () => {
  const { hoja, motor } = await escenario()
  crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', telefono: '1122223333', origen: 'REDES' }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Algo que hacer', responsableId: DANIEL.id }, DANIEL)
  presupuestoDeTresOpciones(null)
  await motor.ciclarSubida()

  // Ésta es la trampa que hay que evitar: una fila que la aplicación escribió en la hoja pero que no
  // quedó anotada como conocida se ve como «vino de otra computadora» y dispara la importación
  // completa cada cinco minutos, para siempre. Se lee de nuevo y no tiene que aparecer nada nuevo.
  const contexto = await leerContexto(hoja)
  const resultado = await bajarCambios(hoja, contexto, ['APP LEADS', 'APP PRESUPUESTOS', 'APP TAREAS'])

  assert.equal(resultado.pestanasLeidas, 3)
  assert.equal(resultado.filasNuevas, 0, 'las filas de la aplicación ya están anotadas como conocidas')
  assert.equal(resultado.filasCambiadas, 0, 'y su huella coincide con lo que se escribió')
  assert.equal(resultado.necesitaImportacion, false)
  assert.equal(listarLeads(SIN_FILTROS_DE_LEAD).total, 1, 'no se duplicó nada')
})

test('sin conexión se sigue trabajando: la cola espera y sube cuando vuelve', async () => {
  const { hoja, motor } = await escenario()
  hoja.desconectar()

  const lead = crearLead({ ...LEAD_VACIO, nombre: 'Ana Ruiz', telefono: '1122223333', origen: 'LOCAL' }, DANIEL)
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Anotado igual', responsableId: DANIEL.id }, DANIEL)
  await motor.ciclarSubida()

  assert.ok(cuantasPendientes() > 0, 'nada se perdió: la cola espera')
  assert.equal(listarLeads(SIN_FILTROS_DE_LEAD).total, 1, 'y en la aplicación está todo')

  hoja.conectar()
  await motor.ciclarSubida()
  assert.equal(cuantasPendientes(), 0)
  assert.equal(enLaHoja(hoja, 'APP LEADS', lead.lead.filaId, 'NOMBRE'), 'Ana Ruiz')
})


// ---------------------------------------------------------------------------
// La actualización de una base que ya venía trabajando
// ---------------------------------------------------------------------------

test('una base de la Fase 7 se actualiza a la Fase 8 sin perder las tareas que ya tenía', () => {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  const registrar = console.log
  console.log = () => undefined
  try {
    for (const migracion of MIGRACIONES.filter((m) => m.version <= 8)) {
      db.exec(migracion.sql)
      db.pragma('user_version = ' + migracion.version)
    }
    sembrarDatosIniciales(db)
    // Una tarea de la Fase 5, creada desde la ficha de un cliente antes de que existiera la pestaña.
    db.prepare(
      `INSERT INTO tareas (titulo, detalle, estado, creado_por, creado_en, actualizado_en)
       VALUES ('Pedir la cédula verde', 'Del Gol', 'pendiente', 'Daniel Martínez', '2026-05-02T12:00:00.000Z', '2026-05-02T12:00:00.000Z')`,
    ).run()
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  assert.equal(db.pragma('user_version', { simple: true }), MIGRACIONES[MIGRACIONES.length - 1]!.version)

  const tarea = db.prepare('SELECT titulo, estado, prioridad, fila_id, sucursal_texto, visto_en FROM tareas').get() as {
    titulo: string
    estado: string
    prioridad: string
    fila_id: string | null
    sucursal_texto: string | null
    visto_en: string | null
  }
  assert.equal(tarea.titulo, 'Pedir la cédula verde', 'la tarea vieja sigue estando')
  assert.equal(tarea.estado, 'pendiente')
  assert.equal(tarea.prioridad, 'NORMAL', 'las que no tenían prioridad quedan en NORMAL')
  assert.equal(tarea.fila_id, null, 'nació antes de que existiera la pestaña: no se le inventa una fila en la hoja')
  assert.equal(tarea.sucursal_texto, null)
  assert.equal(tarea.visto_en, null)

  // Y las tablas nuevas quedan vacías y listas.
  for (const tabla of ['leads', 'lead_notas', 'presupuestos', 'presupuesto_opciones', 'tarea_comentarios', 'tarea_adjuntos']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n, 0, `${tabla} tiene que existir y estar vacía`)
  }
  db.close()
})
