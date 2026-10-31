// Los datos para cotizar, UNA vez para todas las compañías, en cuatro tarjetas: el asegurado, el
// vehículo, las condiciones de la cotización y los accesorios. En pantalla ancha van en una grilla de
// 2 × 2; en una chica, una debajo de la otra.
//
// Lo marcado con * es obligatorio. Lo que cada compañía pide además (su plan comercial, su código de
// localidad…) no se pregunta acá: cada una arranca de lo que dice este formulario y se afina en su
// tarjeta de resultados.
import { useEffect, useState, type ReactNode } from 'react'
import { PROVINCIAS } from '../../../shared/direccion'
import { detectarDocumento, formatearCuitEscribiendo, formatearDni } from '../../../shared/documento'
import {
  ACCESORIOS,
  CLAUSULAS_DE_AJUSTE,
  COMISIONES,
  CONDICIONES_IIBB,
  CONDICIONES_IVA,
  FACTURACIONES,
  LO_QUE_FIJA_EL_PLAN,
  MAXIMO_DE_CUOTAS,
  MEDIOS_DE_PAGO,
  NOMBRE_COMISION,
  NOMBRE_CONDICION_IIBB,
  NOMBRE_CONDICION_IVA,
  NOMBRE_FACTURACION,
  NOMBRE_MEDIO_DE_PAGO,
  NOMBRE_PLAN_DE_COTIZACION,
  NOMBRE_RASTREADOR,
  NOMBRE_SEXO,
  NOMBRE_TARIFA,
  NOMBRE_TIPO_DE_PERSONA,
  NOMBRE_USO_DEL_VEHICULO,
  PLANES_DE_COTIZACION,
  RASTREADORES,
  SCORING_VACIO,
  SEXOS,
  TARIFAS,
  TIPOS_DE_PERSONA,
  USOS_DEL_VEHICULO,
  enPesos,
  esAccesorio,
  gncDe,
  nombreDeClausula,
  type Accesorio,
  type AseguradoraDelMulticotizador,
  type ClausulaDeAjuste,
  type Comision,
  type CondicionesRecordadas,
  type CondicionIibb,
  type CondicionIva,
  type CuotasDeseadas,
  type Facturacion,
  type IdAseguradora,
  type MedioDePago,
  type PlanDeCotizacion,
  type Rastreador,
  type ScoringDelVehiculo,
  type Sexo,
  type SolicitudDeCotizacion,
  type Tarifa,
  type TipoDePersona,
  type UsoDelVehiculo,
} from '../../../shared/multicotizador'
import type { FilaCliente, TipoDeVehiculo } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { SelectorConBusqueda } from '../../componentes/SelectorConBusqueda'
import { VEHICULO_ELEGIDO_VACIO, type VehiculoElegido } from '../../componentes/SelectorDeVehiculo'
import { Boton, Campo, Selector, cx } from '../../componentes/ui'
import { VehiculoDelCotizador, type CampoDelVehiculo } from './VehiculoDelCotizador'

/** Un renglón de accesorios. `clave` sólo distingue los renglones en pantalla. */
export interface AccesorioDelFormulario {
  clave: number
  nombre: Accesorio | ''
  /** Sólo los dígitos, en pesos. */
  valor: string
}

export interface FormularioMulticotizador {
  // El asegurado
  clienteId: number | null
  /** El de la cartera, si se eligió un cliente: no se pregunta, pero va al presupuesto. */
  telefono: string
  nombre: string
  apellido: string
  dni: string
  cuit: string
  provincia: string
  codigoPostal: string
  localidad: string
  tipoPersona: TipoDePersona
  condicionIva: CondicionIva
  ingresosBrutos: CondicionIibb
  sexo: Sexo | ''
  fechaNacimiento: string
  // El vehículo
  vehiculo: VehiculoElegido
  ceroKm: boolean
  uso: UsoDelVehiculo
  rastreador: Rastreador
  usoOtro: string
  marcaRastreador: string
  marcaRastreadorDesconocida: boolean
  scoring: ScoringDelVehiculo
  // La cotización
  plan: PlanDeCotizacion
  tarifa: Tarifa | ''
  comision: Comision | ''
  facturacion: Facturacion | ''
  medioDePago: MedioDePago | ''
  clausulaAjuste: ClausulaDeAjuste | ''
  vigenciaDesde: string
  cuotas: CuotasDeseadas
  /** «Todas»: se cotiza en cada compañía con API, sin elegirlas una por una. */
  todas: boolean
  aseguradoras: IdAseguradora[]
  // Los accesorios
  accesorios: AccesorioDelFormulario[]
}

function hoyIso(): string {
  const hoy = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}`
}

/**
 * El formulario en blanco. Las condiciones comerciales arrancan en las que se usaron la última vez en
 * esta computadora (ver `condicionesGuardadas`); el plan, si no hay ninguna, en «Sin plan».
 */
export function formularioVacio(aseguradoras: IdAseguradora[], tipo: TipoDeVehiculo, condiciones: CondicionesRecordadas = {}): FormularioMulticotizador {
  const facturacion = condiciones.facturacion ?? ''
  const plan = condiciones.plan ?? 'SIN_PLAN'
  const fijadas = plan === 'SIN_PLAN' ? null : LO_QUE_FIJA_EL_PLAN[plan]
  return {
    clienteId: null,
    telefono: '',
    nombre: '',
    apellido: '',
    dni: '',
    cuit: '',
    provincia: '',
    codigoPostal: '',
    localidad: '',
    tipoPersona: 'FISICA',
    condicionIva: 'CONSUMIDOR_FINAL',
    ingresosBrutos: 'CONSUMIDOR_FINAL',
    sexo: '',
    fechaNacimiento: '',
    vehiculo: { ...VEHICULO_ELEGIDO_VACIO, tipo },
    ceroKm: false,
    uso: 'PARTICULAR',
    rastreador: 'SIN_RASTREADOR',
    usoOtro: '',
    marcaRastreador: '',
    marcaRastreadorDesconocida: false,
    scoring: { ...SCORING_VACIO },
    plan,
    tarifa: fijadas?.tarifa ?? condiciones.tarifa ?? '',
    comision: fijadas?.comision ?? condiciones.comision ?? '',
    facturacion,
    medioDePago: condiciones.medioDePago ?? '',
    clausulaAjuste: condiciones.clausulaAjuste ?? '',
    vigenciaDesde: hoyIso(),
    cuotas: facturacion === 'MEJOR_COSTO' ? 'MAXIMA' : (condiciones.cuotas ?? null),
    todas: true,
    aseguradoras,
    accesorios: [],
  }
}

/** Lo que se recuerda en esta computadora para la próxima cotización. */
export function condicionesDe(f: FormularioMulticotizador): CondicionesRecordadas {
  return {
    plan: f.plan,
    tarifa: f.tarifa || undefined,
    comision: f.comision || undefined,
    facturacion: f.facturacion || undefined,
    medioDePago: f.medioDePago || undefined,
    clausulaAjuste: f.clausulaAjuste || undefined,
    cuotas: f.cuotas,
  }
}

/** Las compañías que se van a cotizar: todas las que tienen API, o las elegidas. */
export function aseguradorasACotizar(f: FormularioMulticotizador, aseguradoras: AseguradoraDelMulticotizador[]): IdAseguradora[] {
  return f.todas ? aseguradoras.map((a) => a.id) : f.aseguradoras
}

function soloNumeros(valor: string): string {
  return valor.replace(/\D/g, '')
}

/** El nombre de un cliente de la cartera, en partes: «PÉREZ, JUAN» se separa; si no, va entero al apellido. */
function separarNombre(completo: string): { nombre: string; apellido: string } {
  const [antes, ...despues] = completo.split(',')
  if (despues.length > 0 && antes!.trim()) return { apellido: antes!.trim(), nombre: despues.join(',').trim() }
  return { apellido: completo.trim(), nombre: '' }
}

type CampoConError =
  | 'apellido'
  | 'dni'
  | 'cuit'
  | 'provincia'
  | 'codigoPostal'
  | 'localidad'
  | CampoDelVehiculo
  | 'tarifa'
  | 'comision'
  | 'facturacion'
  | 'medioDePago'
  | 'clausulaAjuste'
  | 'vigenciaDesde'
  | 'aseguradoras'
  | 'accesorios'
  | 'usoOtro'
  | 'marcaRastreador'

/** Qué falta o está mal, campo por campo. Vacío = se puede cotizar. */
export function erroresDe(f: FormularioMulticotizador): Partial<Record<CampoConError, string>> {
  const errores: Partial<Record<CampoConError, string>> = {}
  const v = f.vehiculo
  if (!f.apellido.trim()) errores.apellido = f.tipoPersona === 'JURIDICA' ? 'Falta la razón social.' : 'Falta el apellido.'
  const dni = soloNumeros(f.dni)
  if (dni && (dni.length < 7 || dni.length > 8)) errores.dni = 'El DNI tiene 7 u 8 números.'
  if (f.cuit.trim()) {
    const cuit = detectarDocumento(f.cuit)
    if (cuit.digitos.length !== 11 || !cuit.valido) errores.cuit = cuit.digitos.length === 11 ? cuit.leyenda : 'El CUIT tiene 11 números.'
  }
  if (!f.provincia) errores.provincia = 'Elegí la provincia.'
  if (soloNumeros(f.codigoPostal).length !== 4) errores.codigoPostal = 'El código postal tiene 4 números.'
  if (!f.localidad.trim()) errores.localidad = 'Elegí la localidad.'
  if (!v.marca.trim()) errores.marca = 'Elegí la marca.'
  if (!/^\d{4}$/.test(v.anio.trim())) errores.anio = 'Elegí el año.'
  if (!v.modelo.trim()) errores.modelo = 'Elegí el modelo.'
  if (!v.linea.trim()) errores.linea = 'Elegí la versión.'
  if (f.uso === 'OTRO' && !f.usoOtro.trim()) errores.usoOtro = 'Indicá el uso.'
  if (f.rastreador === 'OTRO' && !f.marcaRastreadorDesconocida && !f.marcaRastreador.trim()) errores.marcaRastreador = 'Escribí la marca, o tildá «Marca desconocida».'
  if (!f.tarifa) errores.tarifa = 'Elegí la tarifa.'
  if (!f.comision) errores.comision = 'Elegí la comisión.'
  if (!f.facturacion) errores.facturacion = 'Elegí la facturación.'
  if (!f.medioDePago) errores.medioDePago = 'Elegí la forma de pago.'
  if (!f.clausulaAjuste) errores.clausulaAjuste = 'Elegí la cláusula.'
  if (!f.vigenciaDesde) errores.vigenciaDesde = 'Elegí la fecha.'
  if (!f.todas && f.aseguradoras.length === 0) errores.aseguradoras = 'Elegí al menos una compañía, o «Todas».'
  if (f.accesorios.some((a) => !a.nombre || !Number(soloNumeros(a.valor)))) errores.accesorios = 'Cada accesorio va con su valor en pesos.'
  return errores
}

const NOMBRE_DEL_CAMPO: Record<CampoConError, string> = {
  apellido: 'el apellido',
  dni: 'el DNI',
  cuit: 'el CUIT',
  provincia: 'la provincia',
  codigoPostal: 'el código postal',
  localidad: 'la localidad',
  marca: 'la marca',
  anio: 'el año',
  modelo: 'el modelo',
  linea: 'la versión',
  tarifa: 'la tarifa',
  comision: 'la comisión',
  facturacion: 'la facturación',
  medioDePago: 'la forma de pago',
  clausulaAjuste: 'la cláusula de ajuste',
  vigenciaDesde: 'la vigencia',
  aseguradoras: 'las compañías',
  accesorios: 'el valor de los accesorios',
  usoOtro: 'el uso',
  marcaRastreador: 'la marca del rastreador',
}

/**
 * La solicitud lista para mandar, o qué falta. Se revisa acá para decirlo antes de salir a cotizar;
 * el proceso principal lo vuelve a revisar igual (ver `validarSolicitud`).
 */
export function solicitudDe(f: FormularioMulticotizador): SolicitudDeCotizacion | string {
  const errores = erroresDe(f)
  const campos = Object.keys(errores) as CampoConError[]
  if (campos.length > 0 || !f.tarifa || !f.comision || !f.facturacion || !f.medioDePago || !f.clausulaAjuste) {
    return `Para cotizar falta revisar ${campos.map((campo) => NOMBRE_DEL_CAMPO[campo]).join(', ')}.`
  }
  const v = f.vehiculo
  const accesorios = f.accesorios.flatMap((a) => (esAccesorio(a.nombre) ? [{ nombre: a.nombre, valor: Number(soloNumeros(a.valor)) }] : []))
  return {
    vehiculo: {
      tipo: v.tipo === 'MOTO' ? 'MOTO' : 'AUTO',
      marca: v.marca.trim(),
      modelo: v.modelo.trim(),
      version: v.linea.trim(),
      anio: v.anio.trim(),
      codigoCatalogo: v.catalogoCodigo,
      ceroKm: f.ceroKm,
      uso: f.uso,
      rastreador: f.rastreador,
      usoOtro: f.uso === 'OTRO' ? f.usoOtro.trim() : '',
      marcaRastreador: f.rastreador === 'OTRO' && !f.marcaRastreadorDesconocida ? f.marcaRastreador.trim() : '',
      scoring: { ...f.scoring },
      accesorios,
      ...gncDe(accesorios),
      sumaAsegurada: null,
    },
    tomador: {
      nombre: f.nombre.trim(),
      apellido: f.apellido.trim(),
      dni: soloNumeros(f.dni),
      cuit: soloNumeros(f.cuit),
      telefono: f.telefono.trim(),
      tipoPersona: f.tipoPersona,
      condicionIva: f.condicionIva,
      ingresosBrutos: f.ingresosBrutos,
      sexo: f.sexo || null,
      fechaNacimiento: f.fechaNacimiento,
    },
    provincia: f.provincia,
    codigoPostal: soloNumeros(f.codigoPostal),
    localidad: f.localidad.trim(),
    vigenciaDesde: f.vigenciaDesde,
    medioDePago: f.medioDePago,
    condiciones: {
      plan: f.plan,
      tarifa: f.tarifa,
      comision: f.comision,
      facturacion: f.facturacion,
      clausulaAjuste: f.clausulaAjuste,
      cuotas: f.facturacion === 'MEJOR_COSTO' ? 'MAXIMA' : f.cuotas,
    },
  }
}

/**
 * Lo que cambió, o cómo calcularlo a partir de lo último que hay: lo segundo es para lo que llega de
 * forma asíncrona (las listas del catálogo), que si no podría pisar con datos viejos un cambio que
 * llegó en el medio.
 */
export type CambiosDelFormulario = Partial<FormularioMulticotizador> | ((previo: FormularioMulticotizador) => Partial<FormularioMulticotizador>)

interface Props {
  valor: FormularioMulticotizador
  alCambiar: (cambios: CambiosDelFormulario) => void
  aseguradoras: AseguradoraDelMulticotizador[]
  cotizando: boolean
  alCotizar: () => void
  alLimpiar: () => void
  aviso: string | null
}

function Casilla({ etiqueta, marcada, alCambiar, deshabilitada = false }: { etiqueta: string; marcada: boolean; alCambiar: (marcada: boolean) => void; deshabilitada?: boolean }) {
  return (
    <label className={cx('flex items-center gap-2 text-sm text-slate-700', deshabilitada && 'opacity-60')}>
      <input type="checkbox" checked={marcada} disabled={deshabilitada} onChange={(e) => alCambiar(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  )
}

/**
 * Una de las cuatro tarjetas. Es una `Tarjeta` sin el `overflow-hidden`, para que las listas que se
 * despliegan (el buscador de asegurados, los accesorios) no se corten en el borde. `@container`: sus
 * campos van de a dos según el ancho de la tarjeta, no el de la ventana.
 */
function Bloque({ numero, titulo, descripcion, children }: { numero: number; titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="px-6 pt-5 pb-4">
        <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">
          {numero}. {titulo}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{descripcion}</p>
      </header>
      <div className="@container px-6 pb-6">{children}</div>
    </section>
  )
}

const GRILLA = 'grid gap-4 @sm:grid-cols-2'

/** Las opciones de un desplegable obligatorio que todavía no se eligió. */
function conVacio<T extends string>(lista: readonly T[], nombre: (valor: T) => string, vacio = 'Elegí…'): Array<{ valor: string; texto: string }> {
  return [{ valor: '', texto: vacio }, ...lista.map((valor) => ({ valor, texto: nombre(valor) }))]
}

export function FormularioDeCotizacion({ valor: f, alCambiar, aseguradoras, cotizando, alCotizar, alLimpiar, aviso }: Props) {
  const [buscando, setBuscando] = useState('')
  const [candidatos, setCandidatos] = useState<FilaCliente[]>([])
  const [localidades, setLocalidades] = useState<string[]>([])
  const [buscandoLocalidades, setBuscandoLocalidades] = useState(false)
  const [errorDeLocalidades, setErrorDeLocalidades] = useState('')
  // Los errores de cada campo se muestran recién después del primer «Cotizar»: un formulario en blanco
  // lleno de rojo no ayuda a nadie.
  const [intentado, setIntentado] = useState(false)
  const [proximaClave, setProximaClave] = useState(1)

  const tipo: TipoDeVehiculo = f.vehiculo.tipo === 'MOTO' ? 'MOTO' : 'AUTO'
  const errores = intentado ? erroresDe(f) : {}

  // El buscador de asegurados: el mismo criterio que el formulario de presupuesto.
  useEffect(() => {
    if (f.clienteId !== null || buscando.trim().length < 2) {
      setCandidatos([])
      return
    }
    let vigente = true
    const reloj = setTimeout(async () => {
      const resultado = await window.dm.clientes.buscar(buscando)
      if (vigente && resultado.ok) setCandidatos(resultado.datos.slice(0, 12))
    }, 250)
    return () => {
      vigente = false
      clearTimeout(reloj)
    }
  }, [buscando, f.clienteId])

  // Las localidades del código postal, de lo que sepa cada compañía: escribirla igual que ellas es lo
  // que después les permite reconocerla solas. Se piden recién con la provincia y el código postal.
  const cp = soloNumeros(f.codigoPostal)
  const localidadHabilitada = Boolean(f.provincia) && cp.length === 4
  useEffect(() => {
    setLocalidades([])
    setErrorDeLocalidades('')
    if (!localidadHabilitada) return
    let vigente = true
    setBuscandoLocalidades(true)
    const reloj = setTimeout(async () => {
      const resultado = await window.dm.multicotizador.localidades(tipo, cp)
      if (!vigente) return
      setBuscandoLocalidades(false)
      if (resultado.ok) {
        setLocalidades(resultado.datos)
        if (resultado.datos.length === 1 && !f.localidad.trim()) alCambiar({ localidad: resultado.datos[0] })
      } else {
        // Se puede escribir a mano igual, pero que se sepa por qué no apareció la lista.
        setErrorDeLocalidades(resultado.error)
      }
    }, 400)
    return () => {
      vigente = false
      clearTimeout(reloj)
      setBuscandoLocalidades(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `f.localidad` y `alCambiar` no tienen que volver a disparar la búsqueda.
  }, [cp, tipo, localidadHabilitada])

  const elegirCliente = (cliente: FilaCliente) => {
    const documento = detectarDocumento(cliente.documento ?? '')
    alCambiar({
      clienteId: cliente.id,
      ...separarNombre(cliente.nombre),
      dni: documento.dni ?? '',
      cuit: documento.clase === 'CUIT' || documento.clase === 'CUIL' ? documento.digitos : '',
      telefono: cliente.telefono ?? '',
      ...(f.localidad.trim() || !cliente.localidad ? {} : { localidad: cliente.localidad }),
    })
    setBuscando('')
    setCandidatos([])
  }

  const elegirPlan = (plan: PlanDeCotizacion) => alCambiar(plan === 'SIN_PLAN' ? { plan } : { plan, ...LO_QUE_FIJA_EL_PLAN[plan] })
  const fijadoPorElPlan = f.plan !== 'SIN_PLAN'

  // «Mejor costo» es con la cantidad máxima de cuotas, y nada más; las otras facturaciones, de 1 a 12.
  const elegirFacturacion = (facturacion: Facturacion | '') =>
    alCambiar({ facturacion, cuotas: facturacion === 'MEJOR_COSTO' ? 'MAXIMA' : f.cuotas === 'MAXIMA' ? null : f.cuotas })

  const alternarAseguradora = (id: IdAseguradora) =>
    alCambiar({ aseguradoras: f.aseguradoras.includes(id) ? f.aseguradoras.filter((otra) => otra !== id) : [...f.aseguradoras, id] })

  const cambiarAccesorio = (clave: number, cambios: Partial<AccesorioDelFormulario>) =>
    alCambiar({ accesorios: f.accesorios.map((a) => (a.clave === clave ? { ...a, ...cambios } : a)) })
  const agregarAccesorio = () => {
    alCambiar({ accesorios: [...f.accesorios, { clave: proximaClave, nombre: '', valor: '' }] })
    setProximaClave((clave) => clave + 1)
  }
  const totalDeAccesorios = f.accesorios.reduce((total, a) => total + (Number(soloNumeros(a.valor)) || 0), 0)

  const aCotizar = aseguradorasACotizar(f, aseguradoras).filter((id) => {
    const aseguradora = aseguradoras.find((a) => a.id === id)
    return aseguradora && !aseguradora.noDisponible && aseguradora.tipos.includes(tipo)
  })

  const cotizar = () => {
    setIntentado(true)
    alCotizar()
  }
  const limpiar = () => {
    setIntentado(false)
    setBuscando('')
    alLimpiar()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="@container">
        <div className="flex flex-col gap-6 @4xl:grid @4xl:grid-cols-2">
          {/* 1. El asegurado */}
          <Bloque numero={1} titulo="Asegurado" descripcion="Para quién es la cotización. Se puede traer uno que ya esté en la cartera.">
            <div className="flex flex-col gap-4">
              {f.clienteId === null ? (
                <div className="relative">
                  <Campo
                    etiqueta="Buscar asegurado existente"
                    value={buscando}
                    onChange={(e) => setBuscando(e.target.value)}
                    placeholder="Nombre, DNI o CUIT…"
                  />
                  {candidatos.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-media">
                      {candidatos.map((cliente) => (
                        <li key={cliente.id}>
                          <button type="button" onClick={() => elegirCliente(cliente)} className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-marino-50">
                            <span className="font-medium text-slate-900">{cliente.nombre}</span>
                            <span className="text-xs text-slate-500">{[cliente.documento, cliente.telefono, cliente.localidad].filter(Boolean).join(' · ')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-marino-200 bg-marino-50 px-3 py-2 text-sm text-marino-800">
                  <span className="min-w-0 flex-1 truncate">
                    Asegurado de la cartera: <strong className="font-semibold">{[f.nombre, f.apellido].filter(Boolean).join(' ')}</strong>
                  </span>
                  <Boton tamano="sm" variante="fantasma" onClick={() => alCambiar({ clienteId: null, telefono: '' })}>
                    Desvincular
                  </Boton>
                </div>
              )}
              <div className={GRILLA}>
                <Campo etiqueta="Nombre" value={f.nombre} onChange={(e) => alCambiar({ nombre: e.target.value })} />
                <Campo
                  etiqueta={f.tipoPersona === 'JURIDICA' ? 'Razón social *' : 'Apellido *'}
                  value={f.apellido}
                  error={errores.apellido}
                  onChange={(e) => alCambiar({ apellido: e.target.value })}
                />
                <Campo
                  etiqueta="DNI"
                  value={formatearDni(f.dni)}
                  inputMode="numeric"
                  placeholder="12.345.678"
                  error={errores.dni}
                  onChange={(e) => alCambiar({ dni: soloNumeros(e.target.value).slice(0, 8) })}
                />
                <Campo
                  etiqueta="CUIT"
                  value={formatearCuitEscribiendo(f.cuit)}
                  inputMode="numeric"
                  placeholder="20-12345678-9"
                  error={errores.cuit}
                  onChange={(e) => alCambiar({ cuit: soloNumeros(e.target.value).slice(0, 11) })}
                />
                <Selector
                  etiqueta="Provincia *"
                  value={f.provincia}
                  error={errores.provincia}
                  onChange={(e) => alCambiar({ provincia: e.target.value, localidad: '' })}
                  opciones={conVacio(PROVINCIAS, (provincia) => provincia, 'Elegí la provincia…')}
                />
                <Campo
                  etiqueta="Código postal *"
                  value={f.codigoPostal}
                  inputMode="numeric"
                  placeholder="Ej.: 1870"
                  error={errores.codigoPostal}
                  onChange={(e) => alCambiar({ codigoPostal: soloNumeros(e.target.value).slice(0, 4), localidad: '' })}
                />
                {localidades.length > 0 ? (
                  <Selector
                    etiqueta="Localidad *"
                    value={f.localidad}
                    error={errores.localidad}
                    onChange={(e) => alCambiar({ localidad: e.target.value })}
                    opciones={[
                      { valor: '', texto: 'Elegí la localidad…' },
                      // La que vino de la cartera, aunque las compañías la escriban distinto.
                      ...(f.localidad && !localidades.includes(f.localidad) ? [{ valor: f.localidad, texto: f.localidad }] : []),
                      ...localidades.map((localidad) => ({ valor: localidad, texto: localidad })),
                    ]}
                    ayuda={localidades.length > 1 ? `El ${cp} abarca ${localidades.length} localidades.` : undefined}
                  />
                ) : (
                  <Campo
                    etiqueta="Localidad *"
                    value={f.localidad}
                    disabled={!localidadHabilitada}
                    placeholder={!localidadHabilitada ? 'Primero la provincia y el código postal' : buscandoLocalidades ? 'Buscando…' : 'Escribila'}
                    error={errores.localidad ?? (errorDeLocalidades || undefined)}
                    onChange={(e) => alCambiar({ localidad: e.target.value })}
                  />
                )}
                <Selector
                  etiqueta="Tipo de persona *"
                  value={f.tipoPersona}
                  onChange={(e) => alCambiar({ tipoPersona: e.target.value as TipoDePersona })}
                  opciones={TIPOS_DE_PERSONA.map((tipoPersona) => ({ valor: tipoPersona, texto: NOMBRE_TIPO_DE_PERSONA[tipoPersona] }))}
                />
                <Selector
                  etiqueta="IVA *"
                  value={f.condicionIva}
                  onChange={(e) => alCambiar({ condicionIva: e.target.value as CondicionIva })}
                  opciones={CONDICIONES_IVA.map((condicion) => ({ valor: condicion, texto: NOMBRE_CONDICION_IVA[condicion] }))}
                />
                <Selector
                  etiqueta="Ingresos brutos *"
                  value={f.ingresosBrutos}
                  onChange={(e) => alCambiar({ ingresosBrutos: e.target.value as CondicionIibb })}
                  opciones={CONDICIONES_IIBB.map((condicion) => ({ valor: condicion, texto: NOMBRE_CONDICION_IIBB[condicion] }))}
                />
                <Selector
                  etiqueta="Sexo"
                  value={f.sexo}
                  onChange={(e) => alCambiar({ sexo: e.target.value as Sexo | '' })}
                  opciones={conVacio(SEXOS, (sexo) => NOMBRE_SEXO[sexo], '—')}
                />
                <Campo etiqueta="Fecha de nacimiento" type="date" max={hoyIso()} value={f.fechaNacimiento} onChange={(e) => alCambiar({ fechaNacimiento: e.target.value })} />
              </div>
            </div>
          </Bloque>

          {/* 2. El vehículo, en el orden en que se completa */}
          <Bloque numero={2} titulo={tipo === 'MOTO' ? 'Moto' : 'Vehículo'} descripcion="Se completa en orden: la marca, el año, el modelo y la versión.">
            <div className="flex flex-col gap-4">
              <VehiculoDelCotizador
                valor={f.vehiculo}
                alCambiar={(parte) => alCambiar((previo) => ({ vehiculo: { ...previo.vehiculo, ...parte } }))}
                ceroKm={f.ceroKm}
                alCambiarCeroKm={(ceroKm) => alCambiar({ ceroKm })}
                errores={errores}
              />
              <div className={GRILLA}>
                <Selector
                  etiqueta="Uso *"
                  value={f.uso}
                  onChange={(e) => alCambiar({ uso: e.target.value as UsoDelVehiculo })}
                  opciones={USOS_DEL_VEHICULO.map((uso) => ({ valor: uso, texto: NOMBRE_USO_DEL_VEHICULO[uso] }))}
                />
                <Selector
                  etiqueta="Rastreador *"
                  value={f.rastreador}
                  onChange={(e) => alCambiar({ rastreador: e.target.value as Rastreador })}
                  opciones={RASTREADORES.map((rastreador) => ({ valor: rastreador, texto: NOMBRE_RASTREADOR[rastreador] }))}
                />
                {f.uso === 'OTRO' && (
                  <Campo etiqueta="Indique el uso *" value={f.usoOtro} error={errores.usoOtro} onChange={(e) => alCambiar({ usoOtro: e.target.value })} />
                )}
                {f.rastreador === 'OTRO' && (
                  <div className="flex flex-col gap-2">
                    <Campo
                      etiqueta="Marca del rastreador *"
                      value={f.marcaRastreadorDesconocida ? '' : f.marcaRastreador}
                      disabled={f.marcaRastreadorDesconocida}
                      error={errores.marcaRastreador}
                      onChange={(e) => alCambiar({ marcaRastreador: e.target.value })}
                    />
                    <Casilla
                      etiqueta="Marca desconocida"
                      marcada={f.marcaRastreadorDesconocida}
                      alCambiar={(marcaRastreadorDesconocida) => alCambiar({ marcaRastreadorDesconocida, marcaRastreador: '' })}
                    />
                  </div>
                )}
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium text-slate-700">Scoring</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Casilla etiqueta="Grúa" marcada={f.scoring.grua} alCambiar={(grua) => alCambiar({ scoring: { ...f.scoring, grua } })} />
                  <Casilla etiqueta="Alarma" marcada={f.scoring.alarma} alCambiar={(alarma) => alCambiar({ scoring: { ...f.scoring, alarma } })} />
                  <Casilla etiqueta="Garaje" marcada={f.scoring.garaje} alCambiar={(garaje) => alCambiar({ scoring: { ...f.scoring, garaje } })} />
                </div>
              </fieldset>
            </div>
          </Bloque>

          {/* 3. Las condiciones de la cotización y las compañías */}
          <Bloque numero={3} titulo="Cotización" descripcion="Las condiciones comerciales: se recuerdan para la próxima vez en esta computadora.">
            <div className="flex flex-col gap-4">
              <div className={GRILLA}>
                <Selector
                  etiqueta="Plan de cotización *"
                  value={f.plan}
                  onChange={(e) => elegirPlan(e.target.value as PlanDeCotizacion)}
                  opciones={PLANES_DE_COTIZACION.map((plan) => ({ valor: plan, texto: NOMBRE_PLAN_DE_COTIZACION[plan] }))}
                  ayuda={fijadoPorElPlan ? 'El plan fija la tarifa y la comisión.' : undefined}
                />
                <Selector
                  etiqueta="Tarifa *"
                  value={f.tarifa}
                  disabled={fijadoPorElPlan}
                  error={errores.tarifa}
                  onChange={(e) => alCambiar({ tarifa: e.target.value as Tarifa | '' })}
                  opciones={conVacio(TARIFAS, (tarifa) => NOMBRE_TARIFA[tarifa])}
                />
                <Selector
                  etiqueta="Comisión *"
                  value={f.comision}
                  disabled={fijadoPorElPlan}
                  error={errores.comision}
                  onChange={(e) => alCambiar({ comision: e.target.value as Comision | '' })}
                  opciones={conVacio(COMISIONES, (comision) => NOMBRE_COMISION[comision])}
                />
                <Selector
                  etiqueta="Facturación deseada *"
                  value={f.facturacion}
                  error={errores.facturacion}
                  onChange={(e) => elegirFacturacion(e.target.value as Facturacion | '')}
                  opciones={conVacio(FACTURACIONES, (facturacion) => NOMBRE_FACTURACION[facturacion])}
                />
                <Selector
                  etiqueta="Forma de pago *"
                  value={f.medioDePago}
                  error={errores.medioDePago}
                  onChange={(e) => alCambiar({ medioDePago: e.target.value as MedioDePago | '' })}
                  opciones={conVacio(MEDIOS_DE_PAGO, (medio) => NOMBRE_MEDIO_DE_PAGO[medio])}
                />
                <Selector
                  etiqueta="Cláusula de ajuste *"
                  value={f.clausulaAjuste}
                  error={errores.clausulaAjuste}
                  onChange={(e) => alCambiar({ clausulaAjuste: e.target.value as ClausulaDeAjuste | '' })}
                  opciones={conVacio(CLAUSULAS_DE_AJUSTE, nombreDeClausula)}
                />
                <Campo
                  etiqueta="Vigencia *"
                  type="date"
                  value={f.vigenciaDesde}
                  error={errores.vigenciaDesde}
                  onChange={(e) => alCambiar({ vigenciaDesde: e.target.value })}
                />
                {f.facturacion === 'MEJOR_COSTO' ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">Cuotas</span>
                    <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked disabled />
                      Cantidad máxima posible de cuotas
                    </label>
                  </div>
                ) : (
                  <Selector
                    etiqueta="Cuotas"
                    value={f.cuotas === null || f.cuotas === 'MAXIMA' ? '' : String(f.cuotas)}
                    onChange={(e) => alCambiar({ cuotas: e.target.value ? Number(e.target.value) : null })}
                    opciones={[
                      { valor: '', texto: 'Las que dé cada compañía' },
                      ...Array.from({ length: MAXIMO_DE_CUOTAS }, (_, i) => ({ valor: String(i + 1), texto: i === 0 ? '1 cuota' : `${i + 1} cuotas` })),
                    ]}
                  />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Compañías *</span>
                  <Casilla etiqueta="Todas" marcada={f.todas} alCambiar={(todas) => alCambiar({ todas })} />
                </div>
                {aseguradoras.length === 0 ? (
                  <p className="text-sm text-slate-500">Todavía no hay ninguna compañía con API cargada. Se configuran en API Aseguradoras.</p>
                ) : (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Compañías">
                    {aseguradoras.map((aseguradora) => {
                      const noCotizaEsteTipo = !aseguradora.tipos.includes(tipo)
                      const motivo = aseguradora.noDisponible ?? (noCotizaEsteTipo ? `No cotiza ${tipo === 'MOTO' ? 'motos' : 'autos'}.` : null)
                      const elegida = !motivo && (f.todas || f.aseguradoras.includes(aseguradora.id))
                      return (
                        <button
                          key={aseguradora.id}
                          type="button"
                          aria-pressed={elegida}
                          disabled={f.todas || Boolean(motivo)}
                          title={motivo ?? (f.todas ? 'Con «Todas» se cotiza en todas las compañías con API.' : undefined)}
                          onClick={() => alternarAseguradora(aseguradora.id)}
                          className={cx(
                            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:cursor-not-allowed',
                            elegida ? 'border-marino-600 bg-marino-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                            f.todas && !motivo && 'opacity-70',
                            motivo && 'border-dashed text-slate-400 line-through',
                          )}
                        >
                          {elegida && <Icono nombre="ok" tamano={12} />}
                          {aseguradora.nombre}
                        </button>
                      )
                    })}
                  </div>
                )}
                {errores.aseguradoras && <p className="text-xs text-red-600">{errores.aseguradoras}</p>}
              </div>
            </div>
          </Bloque>

          {/* 4. Los accesorios */}
          <Bloque numero={4} titulo="Accesorios" descripcion="Lo que suma valor al vehículo, con su valor en pesos. El equipo de GNC se informa a cada compañía.">
            <div className="flex flex-col gap-3">
              {f.accesorios.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">Sin accesorios declarados.</p>
              ) : (
                <>
                  <div className="grid grid-cols-[minmax(0,1fr)_9rem_2.5rem] gap-2 text-sm font-medium text-slate-700">
                    <span>Accesorio</span>
                    <span>Valor (ARS)</span>
                  </div>
                  {f.accesorios.map((accesorio) => {
                    const usados = new Set(f.accesorios.filter((otro) => otro.clave !== accesorio.clave).map((otro) => otro.nombre))
                    const sinValor = intentado && !Number(soloNumeros(accesorio.valor))
                    return (
                      <div key={accesorio.clave} className="grid grid-cols-[minmax(0,1fr)_9rem_2.5rem] items-start gap-2">
                        <SelectorConBusqueda
                          etiqueta="Accesorio"
                          ocultarEtiqueta
                          valor={accesorio.nombre}
                          opciones={ACCESORIOS.filter((nombre) => !usados.has(nombre))}
                          alCambiar={(nombre) => cambiarAccesorio(accesorio.clave, { nombre: nombre as Accesorio })}
                          error={intentado && !accesorio.nombre ? 'Elegí el accesorio.' : null}
                        />
                        <input
                          aria-label={`Valor de ${accesorio.nombre || 'el accesorio'} en pesos`}
                          inputMode="numeric"
                          value={accesorio.valor ? Number(accesorio.valor).toLocaleString('es-AR') : ''}
                          placeholder="$ 0"
                          onChange={(e) => cambiarAccesorio(accesorio.clave, { valor: soloNumeros(e.target.value).slice(0, 12) })}
                          className={cx(
                            'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-right text-sm tabular-nums text-slate-900 placeholder:text-slate-400',
                            'focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25',
                            sinValor && 'border-red-400',
                          )}
                        />
                        <button
                          type="button"
                          aria-label={`Quitar ${accesorio.nombre || 'el accesorio'}`}
                          title="Quitar"
                          onClick={() => alCambiar({ accesorios: f.accesorios.filter((otro) => otro.clave !== accesorio.clave) })}
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Icono nombre="basura" tamano={16} />
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Boton tamano="sm" icono="mas" onClick={agregarAccesorio}>
                  Agregar accesorio
                </Boton>
                {totalDeAccesorios > 0 && (
                  <span className="ml-auto text-sm text-slate-600">
                    Total declarado: <strong className="font-semibold tabular-nums text-slate-900">{enPesos(totalDeAccesorios)}</strong>
                  </span>
                )}
              </div>
              {errores.accesorios && <p className="text-xs text-red-600">{errores.accesorios}</p>}
            </div>
          </Bloque>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {aviso && <p className="text-sm font-medium text-amber-700">{aviso}</p>}
        <div className="ml-auto flex items-center gap-2">
          <Boton icono="basura" onClick={limpiar} disabled={cotizando}>
            Empezar de nuevo
          </Boton>
          <Boton variante="primario" icono="refrescar" onClick={cotizar} cargando={cotizando}>
            {aCotizar.length > 1 ? `Cotizar en ${aCotizar.length} compañías` : 'Cotizar'}
          </Boton>
        </div>
      </div>
    </div>
  )
}
