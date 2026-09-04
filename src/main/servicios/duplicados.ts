// Cartera → Duplicados: lo que la sincronización dejó repetido, a la vista y con botón.
//
// Hasta la 12.5 los duplicados se arreglaban solos cuando eran «seguros» (reparaciones.ts) y el resto
// quedaba anotado en Administración → Sincronización, donde nadie lo mira. La agencia pidió poder
// sacarlos desde el programa —«que estén repetidos, todos pueden»—, así que acá hay tres cosas:
//
//   1. El DETECTOR: qué está repetido y por qué. Clientes (mismo DNI; mismo nombre sin documento;
//      mismo nombre y misma patente; un CUIT que contiene el DNI de otra ficha), la misma póliza dos
//      veces en el mismo mes, la misma baja dos veces, y la póliza que está en la planilla Y en Bajas
//      a la vez, que es lo que deja una baja a medio camino.
//   2. La FUSIÓN de dos fichas de cliente: todo lo del duplicado pasa a la que queda, y el duplicado
//      se borra. Los del mismo DNI se fusionan solos al arrancar y después de cada importación; los
//      demás los decide una persona, porque dos homónimos son gente distinta.
//   3. SACAR un renglón repetido con la misma cascada de la papelera, pero sin el control del rol:
//      lo puede hacer cualquiera que edite la cartera, SÓLO sobre lo que el detector señaló, y el
//      servicio lo vuelve a comprobar en el momento (el renderer no es confiable).
import type { SesionUsuario } from '../../shared/tipos'
import type {
  BajaRepetida,
  ClienteRepetido,
  CuotaRepetida,
  GrupoDeBajasRepetidas,
  GrupoDeClientesRepetidos,
  GrupoDeCuotasRepetidas,
  InformeDeDuplicados,
  MotivoDeClienteRepetido,
  PolizaEnLosDosLados,
  ResultadoDeFusion,
} from '../../shared/tipos'
import type { ResultadoDeEliminacion, VistaPreviaDeEliminacion } from '../../shared/eliminacion'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarTexto } from '../importacion/normalizar'
import { anotarEvento, encolar } from '../sincronizacion/cola'
import { ejecutarEliminacion, previsualizarEliminacion } from './eliminacion'
import { ErrorDeNegocio } from './errores'
import { filasConCambiosSinSubir } from './filas'
import { registrarCambio } from './historial'
import { elegirBajaQueQueda, elegirCuotaQueQueda } from './reparaciones'
import { enteroPositivo } from './validacion'

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

interface ClienteCrudo {
  id: number
  clave: string
  nombre: string
  documento: string | null
  documento_normalizado: string | null
  sucursal_texto: string | null
  telefono: string | null
  email: string | null
  creado_en: string
}

function clientesCrudos(): ClienteCrudo[] {
  return db()
    .prepare(
      `SELECT id, clave, nombre, documento, documento_normalizado, sucursal_texto, telefono, email, creado_en
         FROM clientes ORDER BY id`,
    )
    .all() as ClienteCrudo[]
}

/** Las patentes de los vehículos de un cliente: los suyos y los de sus pólizas. */
function patentesDe(clienteId: number): Set<string> {
  const filas = db()
    .prepare(
      `SELECT patente_normalizada AS patente FROM vehiculos WHERE cliente_id = ? AND patente_normalizada IS NOT NULL
       UNION
       SELECT v.patente_normalizada FROM polizas p JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE p.cliente_id = ? AND v.patente_normalizada IS NOT NULL`,
    )
    .all(clienteId, clienteId) as Array<{ patente: string }>
  return new Set(filas.map((f) => f.patente).filter((p) => p !== ''))
}

function fichaRepetida(c: ClienteCrudo, sugerida: boolean): ClienteRepetido {
  const cuantos = (sql: string) => (db().prepare(sql).get(c.id) as { n: number }).n
  return {
    id: c.id,
    nombre: c.nombre,
    documento: c.documento,
    sucursal: c.sucursal_texto,
    telefono: c.telefono,
    email: c.email,
    polizas: cuantos('SELECT COUNT(*) AS n FROM polizas WHERE cliente_id = ?'),
    polizasActivas: cuantos('SELECT COUNT(*) AS n FROM polizas WHERE cliente_id = ? AND activa = 1'),
    cuotas: cuantos('SELECT COUNT(*) AS n FROM cuotas_mes WHERE cliente_id = ?'),
    pagos: cuantos('SELECT COUNT(*) AS n FROM pagos WHERE cliente_id = ?'),
    siniestros: cuantos('SELECT COUNT(*) AS n FROM siniestros WHERE cliente_id = ?'),
    tareas: cuantos('SELECT COUNT(*) AS n FROM tareas WHERE cliente_id = ?'),
    creadoEn: c.creado_en,
    sugerida,
  }
}

/**
 * Cuál de las fichas repetidas conviene conservar. La que ya tiene la clave del documento
 * (`DOC:<dni>`) es la que la importación reconoce; si ninguna, la que más pólizas arrastra; y a
 * igualdad la más vieja (el id más chico). Es la misma regla que usa la fusión automática, así que la
 * sugerencia de la pantalla y lo que el programa haría solo no pueden discrepar.
 */
export function elegirClienteQueQueda<T extends { id: number; clave: string; documento_normalizado: string | null; polizas?: number }>(grupo: T[]): T {
  const puntaje = (c: T) => (c.documento_normalizado && c.clave === `DOC:${c.documento_normalizado}` ? 1 : 0)
  return [...grupo].sort((a, b) => puntaje(b) - puntaje(a) || (b.polizas ?? 0) - (a.polizas ?? 0) || a.id - b.id)[0]!
}

function armarGrupo(motivo: MotivoDeClienteRepetido, crudos: ClienteCrudo[]): GrupoDeClientesRepetidos {
  const conPolizas = crudos.map((c) => ({
    ...c,
    polizas: (db().prepare('SELECT COUNT(*) AS n FROM polizas WHERE cliente_id = ?').get(c.id) as { n: number }).n,
  }))
  const queda = elegirClienteQueQueda(conPolizas)
  return { motivo, clientes: conPolizas.map((c) => fichaRepetida(c, c.id === queda.id)) }
}

/** Grupos de fichas que son, o pueden ser, la misma persona. */
export function clientesRepetidos(): GrupoDeClientesRepetidos[] {
  const todos = clientesCrudos()
  const grupos: GrupoDeClientesRepetidos[] = []
  const yaAgrupados = new Set<number>()

  // 1. Mismo documento: son la misma persona, sin discusión.
  const porDocumento = new Map<string, ClienteCrudo[]>()
  for (const c of todos) {
    const doc = c.documento_normalizado ?? ''
    if (!doc) continue
    porDocumento.set(doc, [...(porDocumento.get(doc) ?? []), c])
  }
  for (const grupo of porDocumento.values()) {
    if (grupo.length < 2) continue
    grupos.push(armarGrupo('dni', grupo))
    for (const c of grupo) yaAgrupados.add(c.id)
  }

  // 2. Mismo nombre. Sin documento en alguna de las dos es probable que sea la misma persona cargada
  //    con y sin DNI; con la misma patente es casi seguro. Dos nombres iguales con dos DNI distintos
  //    son homónimos y no se listan.
  const porNombre = new Map<string, ClienteCrudo[]>()
  for (const c of todos) {
    if (yaAgrupados.has(c.id)) continue
    const nombre = normalizarTexto(c.nombre)
    if (!nombre) continue
    porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), c])
  }
  for (const grupo of porNombre.values()) {
    if (grupo.length < 2) continue
    const documentos = new Set(grupo.map((c) => c.documento_normalizado ?? '').filter((d) => d !== ''))
    if (documentos.size > 1) {
      // Homónimos con DNI distinto… salvo que compartan patente: entonces alguien tipeó mal un DNI.
      const patentes = grupo.map((c) => patentesDe(c.id))
      const comparten = patentes.some((a, i) => patentes.some((b, j) => i < j && [...a].some((p) => b.has(p))))
      if (!comparten) continue
      grupos.push(armarGrupo('nombre+patente', grupo))
    } else {
      const patentes = grupo.map((c) => patentesDe(c.id))
      const comparten = patentes.some((a, i) => patentes.some((b, j) => i < j && [...a].some((p) => b.has(p))))
      grupos.push(armarGrupo(comparten ? 'nombre+patente' : 'nombre', grupo))
    }
    for (const c of grupo) yaAgrupados.add(c.id)
  }

  // 3. Un CUIT de once dígitos que contiene el DNI de otra ficha. Los prefijos de persona (20, 23,
  //    24, 27) ya los pliega `normalizarDocumento`; lo que queda acá son sobre todo empresas (30, 33,
  //    34), que pueden ser el negocio y su dueño: se muestra, no se fusiona solo.
  const porDni = new Map<string, ClienteCrudo[]>()
  for (const c of todos) {
    const doc = c.documento_normalizado ?? ''
    if (doc.length >= 7 && doc.length <= 8) porDni.set(doc, [...(porDni.get(doc) ?? []), c])
  }
  for (const c of todos) {
    const doc = c.documento_normalizado ?? ''
    if (doc.length !== 11 || yaAgrupados.has(c.id)) continue
    const nucleo = doc.slice(2, 10).replace(/^0+/, '')
    const duenios = (porDni.get(nucleo) ?? []).filter((d) => !yaAgrupados.has(d.id))
    if (duenios.length === 0) continue
    grupos.push(armarGrupo('cuit-dni', [c, ...duenios]))
    yaAgrupados.add(c.id)
    for (const d of duenios) yaAgrupados.add(d.id)
  }

  return grupos
}

/** Las tablas que apuntan a un cliente por `cliente_id`. Es la misma lista que borra `planDeCliente`. */
const TABLAS_DEL_CLIENTE = [
  'vehiculos',
  'polizas',
  'cuotas_mes',
  'bajas',
  'pagos',
  'riesgos_varios',
  'amp',
  'siniestros',
  'rechazos_debito',
  'presupuestos',
  'tareas',
  'notas',
  'leads',
] as const

const NOMBRE_DE_TABLA: Record<(typeof TABLAS_DEL_CLIENTE)[number], string> = {
  vehiculos: 'vehículo',
  polizas: 'póliza',
  cuotas_mes: 'cuota del mes',
  bajas: 'baja',
  pagos: 'pago',
  riesgos_varios: 'riesgo vario',
  amp: 'ampliación',
  siniestros: 'siniestro',
  rechazos_debito: 'aviso de rechazo',
  presupuestos: 'presupuesto',
  tareas: 'tarea',
  notas: 'nota',
  leads: 'lead',
}

/**
 * Junta dos fichas en una: todo lo del duplicado (vehículos, pólizas, cuotas, pagos, siniestros,
 * tareas…) pasa a la que queda, los datos que a la que queda le faltaban se completan con los del
 * duplicado, y el duplicado se borra. Queda en el historial con la foto del que se fue.
 *
 * Que la fusión dure más que la próxima importación tiene dos condiciones, y las dos están acá:
 *   - la ficha que queda tiene que tener la clave del documento (`DOC:<dni>`), porque es por esa
 *     clave que el importador la reconoce en la planilla más nueva;
 *   - los renglones del mes abierto que eran del duplicado y no tenían DNI escrito lo reciben, y
 *     viajan a la base con él: si no, la próxima importación los leería sin DNI, los engancharía por
 *     nombre y volvería a crear la ficha que se acaba de sacar.
 */
export function fusionarClientes(sobrevivienteCrudo: unknown, duplicadoCrudo: unknown, actor: SesionUsuario): ResultadoDeFusion {
  const sobrevivienteId = enteroPositivo(sobrevivienteCrudo, 'El cliente que queda')
  const duplicadoId = enteroPositivo(duplicadoCrudo, 'El cliente repetido')
  if (sobrevivienteId === duplicadoId) throw new ErrorDeNegocio('Elegí dos fichas distintas: la que queda y la que se junta con ella.')
  const leer = db().prepare('SELECT * FROM clientes WHERE id = ?')
  const queda = leer.get(sobrevivienteId) as (ClienteCrudo & Record<string, unknown>) | undefined
  const seVa = leer.get(duplicadoId) as (ClienteCrudo & Record<string, unknown>) | undefined
  if (!queda || !seVa) throw new ErrorDeNegocio('Alguna de las dos fichas ya no está. Actualizá la pantalla y probá de nuevo.')

  const documento = limpiar(queda.documento) ? queda : limpiar(seVa.documento) ? seVa : null
  const movido: Array<{ que: string; cuantos: number }> = []
  const sinSubir = filasConCambiosSinSubir()
  const ahora = ahoraIso()

  db().transaction(() => {
    for (const tabla of TABLAS_DEL_CLIENTE) {
      const cambios = db().prepare(`UPDATE ${tabla} SET cliente_id = ? WHERE cliente_id = ?`).run(sobrevivienteId, duplicadoId).changes
      if (cambios > 0) movido.push({ que: NOMBRE_DE_TABLA[tabla], cuantos: cambios })
    }
    // Lo que a la ficha que queda le faltaba, del duplicado: teléfono, email, dirección, documento.
    const campos = ['documento', 'documento_normalizado', 'telefono', 'email', 'direccion', 'localidad', 'fecha_nacimiento', 'sucursal_texto', 'sucursal_id'] as const
    for (const campo of campos) {
      const actual = queda[campo]
      const otro = seVa[campo]
      const vacio = actual === null || actual === undefined || (typeof actual === 'string' && limpiar(actual) === '')
      if (vacio && otro !== null && otro !== undefined && !(typeof otro === 'string' && limpiar(otro) === '')) {
        db().prepare(`UPDATE clientes SET ${campo} = ?, actualizado_en = ? WHERE id = ?`).run(otro, ahora, sobrevivienteId)
      }
    }
    db().prepare('DELETE FROM clientes WHERE id = ?').run(duplicadoId)
    // La clave del documento, ahora que el duplicado la dejó libre.
    const docNormalizado = (db().prepare('SELECT documento_normalizado FROM clientes WHERE id = ?').get(sobrevivienteId) as { documento_normalizado: string | null }).documento_normalizado
    if (docNormalizado && queda.clave !== `DOC:${docNormalizado}`) {
      const ocupada = db().prepare('SELECT 1 FROM clientes WHERE clave = ? AND id <> ?').get(`DOC:${docNormalizado}`, sobrevivienteId)
      if (!ocupada) db().prepare('UPDATE clientes SET clave = ?, actualizado_en = ? WHERE id = ?').run(`DOC:${docNormalizado}`, ahora, sobrevivienteId)
    }
    // Los renglones vivos que no dicen el DNI lo reciben, y viajan con él (ver el encabezado).
    if (documento) {
      const abierto = (db().prepare('SELECT MAX(periodo) AS periodo FROM cuotas_mes').get() as { periodo: string | null }).periodo
      const sinDni = db()
        .prepare(
          `SELECT fila_id, pestana FROM cuotas_mes
            WHERE cliente_id = ? AND dada_de_baja = 0 AND periodo = ? AND TRIM(COALESCE(documento, '')) = ''`,
        )
        .all(sobrevivienteId, abierto) as Array<{ fila_id: string; pestana: string }>
      for (const cuota of sinDni) {
        if (sinSubir.has(cuota.fila_id)) continue
        db().prepare('UPDATE cuotas_mes SET documento = ?, actualizado_en = ? WHERE fila_id = ?').run(documento.documento, ahora, cuota.fila_id)
        encolar({ operacion: 'actualizar', pestana: cuota.pestana, filaId: cuota.fila_id, campos: { documento: String(documento.documento) } }, actor)
      }
    }
    const cambio = {
      accion: 'fusion' as const,
      tabla: 'clientes',
      registroId: sobrevivienteId,
      campo: 'FUSIÓN DE FICHAS REPETIDAS',
      valorAnterior: `${seVa.nombre}${limpiar(seVa.documento) ? ` · ${seVa.documento}` : ''} (id ${duplicadoId})\n${JSON.stringify(seVa).slice(0, 3000)}`,
      valorNuevo: `${queda.nombre} (id ${sobrevivienteId}) · ${movido.map((m) => `${m.cuantos} ${m.que}`).join(', ') || 'nada que mover'}`,
    }
    // La reparación automática no es un usuario: firma sin id, como los conflictos de sincronización.
    if (actor.id > 0) registrarCambio(actor, cambio)
    else {
      db()
        .prepare(
          `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
           VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(ahora, actor.nombre, cambio.accion, cambio.tabla, cambio.registroId, cambio.campo, cambio.valorAnterior, cambio.valorNuevo)
    }
  })()

  return { sobrevivienteId, eliminadoId: duplicadoId, nombre: queda.nombre, movido }
}

/**
 * Las fichas con el MISMO documento y el MISMO nombre se juntan solas: al arrancar y después de cada
 * importación. Es el único caso sin duda; dos DNI iguales con nombres distintos pueden ser un DNI mal
 * tipeado en la planilla (la hoja de la agencia los tiene) y quedan para que una persona decida. La
 * regla de cuál queda es la de `elegirClienteQueQueda`, así todas las computadoras se quedan con la
 * misma. Devuelve cuántas juntó.
 */
export function repararClientesDuplicados(actor: SesionUsuario = SISTEMA): number {
  let fusionadas = 0
  for (const grupo of clientesRepetidos()) {
    if (grupo.motivo !== 'dni') continue
    const queda = grupo.clientes.find((c) => c.sugerida) ?? grupo.clientes[0]!
    for (const otro of grupo.clientes) {
      if (otro.id === queda.id) continue
      if (normalizarTexto(otro.nombre) !== normalizarTexto(queda.nombre)) continue
      try {
        fusionarClientes(queda.id, otro.id, actor)
        fusionadas++
      } catch (error) {
        anotarEvento('reparacion', `No se pudieron juntar las fichas repetidas de ${otro.nombre}: ${error instanceof Error ? error.message : String(error)}`, { conError: true })
      }
    }
  }
  if (fusionadas > 0) {
    anotarEvento('reparacion', `Se juntaron ${fusionadas} fichas de cliente que estaban repetidas con el mismo DNI/CUIT; todo lo suyo quedó en una sola.`)
  }
  return fusionadas
}

/** Quien firma las reparaciones automáticas en el historial. */
const SISTEMA: SesionUsuario = {
  id: 0,
  nombre: 'Reparación automática',
  usuario: 'sistema',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 0, nombre: '' },
  debeCambiarClave: false,
}

// ---------------------------------------------------------------------------
// Cuotas y bajas repetidas, y la póliza que está en los dos lados
// ---------------------------------------------------------------------------

interface CuotaCruda {
  id: number
  fila_id: string
  poliza_id: number
  periodo: string
  pestana: string
  numero_fila: number
  cuota: string | null
  pago: string | null
  sucursal_texto: string | null
  cliente_nombre: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  en_la_hoja_pestana: string | null
  filas_de_la_pestana: number
  atada: number
}

const SELECT_CUOTAS_REPETIDAS = `
  SELECT c.id, c.fila_id, c.poliza_id, c.periodo, c.pestana, c.cuota, c.pago, c.sucursal_texto,
         COALESCE(c.cliente_nombre, cl.nombre) AS cliente_nombre,
         COALESCE(NULLIF(TRIM(c.compania), ''), p.compania) AS compania,
         COALESCE(NULLIF(TRIM(c.numero_poliza), ''), p.numero) AS numero_poliza,
         COALESCE(NULLIF(TRIM(c.patente), ''), v.patente) AS patente,
         CASE WHEN fc.en_la_hoja = 1 THEN fc.pestana ELSE NULL END AS en_la_hoja_pestana,
         COALESCE(fc.numero_fila, 0) AS numero_fila,
         (SELECT COUNT(*) FROM filas_crudas h WHERE h.pestana = c.pestana AND h.en_la_hoja = 1) AS filas_de_la_pestana,
         CASE WHEN EXISTS (SELECT 1 FROM pagos pg WHERE pg.cuota_fila_id = c.fila_id)
                OR EXISTS (SELECT 1 FROM pagos pa WHERE pa.fila_id = 'PAGO:ADELANTO:' || c.fila_id)
                OR EXISTS (SELECT 1 FROM bajas b WHERE b.cuota_fila_id = c.fila_id)
                OR EXISTS (SELECT 1 FROM rechazos_debito rd WHERE rd.cuota_fila_id = c.fila_id)
              THEN 1 ELSE 0 END AS atada
    FROM cuotas_mes c
    LEFT JOIN filas_crudas fc ON fc.fila_id = c.fila_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN polizas p ON p.id = c.poliza_id
    LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
   WHERE c.dada_de_baja = 0 AND c.poliza_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM cuotas_mes o WHERE o.poliza_id = c.poliza_id AND o.periodo = c.periodo AND o.dada_de_baja = 0 AND o.id <> c.id)
   ORDER BY c.periodo DESC, c.poliza_id, c.fila_id`

export function cuotasRepetidas(): GrupoDeCuotasRepetidas[] {
  const filas = db().prepare(SELECT_CUOTAS_REPETIDAS).all() as CuotaCruda[]
  const grupos = new Map<string, CuotaCruda[]>()
  for (const fila of filas) {
    const clave = `${fila.periodo}|${fila.poliza_id}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), fila])
  }
  return [...grupos.values()].map((grupo) => {
    const queda = elegirCuotaQueQueda(grupo.map((c) => ({ ...c, pestana: c.en_la_hoja_pestana })))
    const primera = grupo[0]!
    return {
      periodo: primera.periodo,
      polizaId: primera.poliza_id,
      clienteNombre: primera.cliente_nombre,
      compania: primera.compania,
      numeroPoliza: primera.numero_poliza,
      patente: primera.patente,
      cuotas: grupo.map(
        (c): CuotaRepetida => ({
          cuotaId: c.id,
          filaId: c.fila_id,
          pestana: c.pestana,
          numeroFila: c.numero_fila,
          cuota: c.cuota,
          pago: c.pago,
          sucursal: c.sucursal_texto,
          atada: c.atada === 1,
          sugeridaParaQuedar: c.fila_id === queda.fila_id,
        }),
      ),
    }
  })
}

interface BajaCruda {
  id: number
  fila_id: string
  poliza_id: number
  periodo: string
  motivo: string | null
  fecha: string | null
  hecha_en_la_app: number
  cliente_nombre: string | null
  compania: string | null
  numero_poliza: string | null
}

export function bajasRepetidas(): GrupoDeBajasRepetidas[] {
  const filas = db()
    .prepare(
      `SELECT b.id, b.fila_id, b.poliza_id, b.periodo, b.motivo, COALESCE(b.fecha_baja_iso, b.fecha_baja) AS fecha, b.hecha_en_la_app,
              COALESCE(b.cliente_nombre, cl.nombre) AS cliente_nombre,
              COALESCE(NULLIF(TRIM(b.compania), ''), p.compania) AS compania,
              COALESCE(NULLIF(TRIM(b.numero_poliza), ''), p.numero) AS numero_poliza
         FROM bajas b
         LEFT JOIN clientes cl ON cl.id = b.cliente_id
         LEFT JOIN polizas p ON p.id = b.poliza_id
        WHERE b.poliza_id IS NOT NULL AND b.periodo IS NOT NULL
          AND EXISTS (SELECT 1 FROM bajas o WHERE o.poliza_id = b.poliza_id AND o.periodo = b.periodo AND o.id <> b.id)
        ORDER BY b.periodo DESC, b.poliza_id, b.id`,
    )
    .all() as BajaCruda[]
  const grupos = new Map<string, BajaCruda[]>()
  for (const fila of filas) {
    const clave = `${fila.periodo}|${fila.poliza_id}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), fila])
  }
  return [...grupos.values()].map((grupo) => {
    const queda = elegirBajaQueQueda(grupo)
    const primera = grupo[0]!
    return {
      periodo: primera.periodo,
      polizaId: primera.poliza_id,
      clienteNombre: primera.cliente_nombre,
      compania: primera.compania,
      numeroPoliza: primera.numero_poliza,
      bajas: grupo.map(
        (b): BajaRepetida => ({
          bajaId: b.id,
          filaId: b.fila_id,
          motivo: b.motivo,
          fecha: b.fecha,
          hechaEnLaApp: b.hecha_en_la_app === 1,
          sugeridaParaQuedar: b.id === queda.id,
        }),
      ),
    }
  })
}

/**
 * La póliza que en el mismo mes está viva en la planilla Y tiene una baja: una baja que no llegó a
 * sacar el renglón de la planilla (o una reactivación que no llegó a sacar el de BAJAS). No se
 * arregla sola a propósito: «Poner vigente» y «Deshacer» dejan este estado durante el minuto que
 * los borrados esperan para viajar juntos, y una reparación automática les pelearía la fila.
 */
export function polizasEnLosDosLados(): PolizaEnLosDosLados[] {
  const filas = db()
    .prepare(
      `SELECT c.id AS cuota_id, c.fila_id AS cuota_fila_id, c.pestana, c.pago, c.periodo, c.poliza_id,
              COALESCE(c.cliente_nombre, cl.nombre) AS cliente_nombre,
              COALESCE(NULLIF(TRIM(c.compania), ''), p.compania) AS compania,
              COALESCE(NULLIF(TRIM(c.numero_poliza), ''), p.numero) AS numero_poliza,
              b.id AS baja_id, b.fila_id AS baja_fila_id, b.motivo, COALESCE(b.fecha_baja_iso, b.fecha_baja) AS fecha, b.hecha_en_la_app
         FROM cuotas_mes c
         JOIN bajas b ON b.poliza_id = c.poliza_id AND b.periodo = c.periodo
         LEFT JOIN clientes cl ON cl.id = c.cliente_id
         LEFT JOIN polizas p ON p.id = c.poliza_id
        WHERE c.dada_de_baja = 0 AND c.poliza_id IS NOT NULL
        ORDER BY c.periodo DESC, cliente_nombre, b.id`,
    )
    .all() as Array<{
    cuota_id: number
    cuota_fila_id: string
    pestana: string
    pago: string | null
    periodo: string
    poliza_id: number
    cliente_nombre: string | null
    compania: string | null
    numero_poliza: string | null
    baja_id: number
    baja_fila_id: string
    motivo: string | null
    fecha: string | null
    hecha_en_la_app: number
  }>
  return filas.map((f) => ({
    periodo: f.periodo,
    polizaId: f.poliza_id,
    clienteNombre: f.cliente_nombre,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    cuota: { cuotaId: f.cuota_id, filaId: f.cuota_fila_id, pestana: f.pestana, pago: f.pago },
    baja: { bajaId: f.baja_id, filaId: f.baja_fila_id, motivo: f.motivo, fecha: f.fecha, hechaEnLaApp: f.hecha_en_la_app === 1 },
  }))
}

export function detectarDuplicados(): InformeDeDuplicados {
  const clientes = clientesRepetidos()
  const cuotas = cuotasRepetidas()
  const bajas = bajasRepetidas()
  const enLosDosLados = polizasEnLosDosLados()
  return {
    clientes,
    cuotas,
    bajas,
    enLosDosLados,
    total: clientes.length + cuotas.length + bajas.length + enLosDosLados.length,
    revisadoEn: ahoraIso(),
  }
}

// ---------------------------------------------------------------------------
// Sacar lo repetido: la cascada de la papelera, sin el rol, sólo sobre lo señalado
// ---------------------------------------------------------------------------

/** ¿Este renglón de la planilla está hoy entre los repetidos, o en los dos lados? Se mira en el momento. */
function cuotaSenalada(cuotaId: number): boolean {
  return (
    cuotasRepetidas().some((g) => g.cuotas.some((c) => c.cuotaId === cuotaId)) ||
    polizasEnLosDosLados().some((p) => p.cuota.cuotaId === cuotaId)
  )
}

function bajaSenalada(bajaId: number): boolean {
  return bajasRepetidas().some((g) => g.bajas.some((b) => b.bajaId === bajaId)) || polizasEnLosDosLados().some((p) => p.baja.bajaId === bajaId)
}

const NO_ESTA_SENALADA = 'Ese registro ya no figura entre los repetidos: alguien lo acomodó desde otra computadora. Actualizá la pantalla.'

export function vistaPreviaDeSacarCuota(cuotaCrudo: unknown): VistaPreviaDeEliminacion {
  const cuotaId = enteroPositivo(cuotaCrudo, 'La fila de la planilla')
  if (!cuotaSenalada(cuotaId)) throw new ErrorDeNegocio(NO_ESTA_SENALADA)
  return previsualizarEliminacion('cuota', cuotaId)
}

export function sacarCuotaRepetida(cuotaCrudo: unknown, actor: SesionUsuario): ResultadoDeEliminacion {
  const cuotaId = enteroPositivo(cuotaCrudo, 'La fila de la planilla')
  if (!cuotaSenalada(cuotaId)) throw new ErrorDeNegocio(NO_ESTA_SENALADA)
  return ejecutarEliminacion('cuota', cuotaId, actor)
}

export function vistaPreviaDeSacarBaja(bajaCruda: unknown): VistaPreviaDeEliminacion {
  const bajaId = enteroPositivo(bajaCruda, 'La baja')
  if (!bajaSenalada(bajaId)) throw new ErrorDeNegocio(NO_ESTA_SENALADA)
  return previsualizarEliminacion('baja', bajaId)
}

export function sacarBajaRepetida(bajaCruda: unknown, actor: SesionUsuario): ResultadoDeEliminacion {
  const bajaId = enteroPositivo(bajaCruda, 'La baja')
  if (!bajaSenalada(bajaId)) throw new ErrorDeNegocio(NO_ESTA_SENALADA)
  return ejecutarEliminacion('baja', bajaId, actor)
}

/** Para la ficha del cliente: ¿esta persona está en algún grupo de repetidos? */
export function clienteEstaRepetido(clienteCrudo: unknown): boolean {
  const clienteId = enteroPositivo(clienteCrudo, 'El cliente')
  return clientesRepetidos().some((g) => g.clientes.some((c) => c.id === clienteId))
}

