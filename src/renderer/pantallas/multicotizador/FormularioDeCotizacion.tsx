// Los datos para cotizar, UNA vez para todas las compañías: el cliente (opcional), el vehículo —del
// catálogo de la agencia, que es el que mejor se traduce al de cada compañía—, la zona y cómo va a
// pagar. Lo que cada compañía pide además (su plan comercial, su código de localidad…) no se pregunta
// acá: lo decide cada una sola y se ajusta en su tarjeta de resultados.
import { useEffect, useState, type ReactNode } from 'react'
import {
  CONDICIONES_IVA,
  MEDIOS_DE_PAGO,
  NOMBRE_CONDICION_IVA,
  NOMBRE_MEDIO_DE_PAGO,
  NOMBRE_TIPO_DE_PERSONA,
  NOMBRE_USO_DEL_VEHICULO,
  TIPOS_DE_PERSONA,
  USOS_DEL_VEHICULO,
  type AseguradoraDelMulticotizador,
  type CondicionIva,
  type IdAseguradora,
  type MedioDePago,
  type SolicitudDeCotizacion,
  type TipoDePersona,
  type UsoDelVehiculo,
} from '../../../shared/multicotizador'
import type { FilaCliente, TipoDeVehiculo } from '../../../shared/tipos'
import { SelectorDeVehiculo, VEHICULO_ELEGIDO_VACIO, type VehiculoElegido } from '../../componentes/SelectorDeVehiculo'
import { Boton, Campo, Selector, Tarjeta, cx } from '../../componentes/ui'

export interface FormularioMulticotizador {
  clienteId: number | null
  nombre: string
  documento: string
  telefono: string
  tipoPersona: TipoDePersona
  condicionIva: CondicionIva
  vehiculo: VehiculoElegido
  patente: string
  ceroKm: boolean
  uso: UsoDelVehiculo
  gnc: boolean
  valorGnc: string
  rastreo: boolean
  sumaAsegurada: string
  codigoPostal: string
  localidad: string
  vigenciaDesde: string
  medioDePago: MedioDePago
  aseguradoras: IdAseguradora[]
}

function hoyIso(): string {
  const hoy = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}`
}

export function formularioVacio(aseguradoras: IdAseguradora[]): FormularioMulticotizador {
  return {
    clienteId: null,
    nombre: '',
    documento: '',
    telefono: '',
    tipoPersona: 'FISICA',
    condicionIva: 'CONSUMIDOR_FINAL',
    vehiculo: { ...VEHICULO_ELEGIDO_VACIO, tipo: 'AUTO' },
    patente: '',
    ceroKm: false,
    uso: 'PARTICULAR',
    gnc: false,
    valorGnc: '',
    rastreo: false,
    sumaAsegurada: '',
    codigoPostal: '',
    localidad: '',
    vigenciaDesde: hoyIso(),
    medioDePago: 'TARJETA',
    aseguradoras,
  }
}

function soloNumeros(valor: string): string {
  return valor.replace(/\D/g, '')
}

/**
 * La solicitud lista para mandar, o qué falta. Se revisa acá para decirlo antes de salir a cotizar;
 * el proceso principal lo vuelve a revisar igual (ver `validarSolicitud`).
 */
export function solicitudDe(f: FormularioMulticotizador): SolicitudDeCotizacion | string {
  const v = f.vehiculo
  const tipo = v.tipo === 'MOTO' ? 'MOTO' : v.tipo === 'AUTO' ? 'AUTO' : null
  const faltan: string[] = []
  if (!tipo) faltan.push('el tipo de vehículo')
  if (!v.marca.trim()) faltan.push('la marca')
  if (!v.modelo.trim()) faltan.push('el modelo')
  if (!/^\d{4}$/.test(v.anio.trim())) faltan.push('el año')
  if (soloNumeros(f.codigoPostal).length < 4) faltan.push('el código postal')
  if (!f.vigenciaDesde) faltan.push('la vigencia')
  if (f.aseguradoras.length === 0) faltan.push('al menos una compañía')
  if (faltan.length > 0 || !tipo) return `Para cotizar falta ${faltan.join(', ')}.`

  return {
    vehiculo: {
      tipo,
      marca: v.marca.trim(),
      modelo: v.modelo.trim(),
      version: v.linea.trim(),
      anio: v.anio.trim(),
      codigoCatalogo: v.catalogoCodigo,
      ceroKm: f.ceroKm,
      uso: f.uso,
      gnc: f.gnc,
      valorGnc: f.gnc && soloNumeros(f.valorGnc) ? Number(soloNumeros(f.valorGnc)) : null,
      rastreo: f.rastreo,
      sumaAsegurada: soloNumeros(f.sumaAsegurada) ? Number(soloNumeros(f.sumaAsegurada)) : null,
    },
    tomador: {
      nombre: f.nombre.trim(),
      documento: f.documento.trim(),
      telefono: f.telefono.trim(),
      tipoPersona: f.tipoPersona,
      condicionIva: f.condicionIva,
    },
    codigoPostal: f.codigoPostal.trim(),
    localidad: f.localidad.trim(),
    vigenciaDesde: f.vigenciaDesde,
    medioDePago: f.medioDePago,
  }
}

interface Props {
  valor: FormularioMulticotizador
  alCambiar: (cambios: Partial<FormularioMulticotizador>) => void
  aseguradoras: AseguradoraDelMulticotizador[]
  cotizando: boolean
  alCotizar: () => void
  alLimpiar: () => void
  aviso: string | null
}

function Casilla({ etiqueta, marcada, alCambiar, deshabilitada = false, ayuda }: { etiqueta: string; marcada: boolean; alCambiar: (marcada: boolean) => void; deshabilitada?: boolean; ayuda?: string }) {
  return (
    <label className={cx('flex items-start gap-2 text-sm text-slate-700', deshabilitada && 'opacity-50')} title={ayuda}>
      <input type="checkbox" className="mt-0.5" checked={marcada} disabled={deshabilitada} onChange={(e) => alCambiar(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{titulo}</h3>
      {children}
    </section>
  )
}

export function FormularioDeCotizacion({ valor: f, alCambiar, aseguradoras, cotizando, alCotizar, alLimpiar, aviso }: Props) {
  const [buscando, setBuscando] = useState('')
  const [candidatos, setCandidatos] = useState<FilaCliente[]>([])
  const [localidades, setLocalidades] = useState<string[]>([])
  const [buscandoLocalidades, setBuscandoLocalidades] = useState(false)
  const [errorDeLocalidades, setErrorDeLocalidades] = useState('')

  const tipo: TipoDeVehiculo | null = f.vehiculo.tipo === 'MOTO' ? 'MOTO' : f.vehiculo.tipo === 'AUTO' ? 'AUTO' : null

  // El buscador de clientes: el mismo criterio que el formulario de presupuesto.
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

  // Las localidades del código postal, de lo que sepa cada compañía: sólo una ayuda para escribirla
  // igual que ellas, que es lo que después les permite reconocerla solas.
  const cp = soloNumeros(f.codigoPostal)
  useEffect(() => {
    setLocalidades([])
    setErrorDeLocalidades('')
    if (cp.length < 4 || !tipo) return
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
  }, [cp, tipo])

  const elegirCliente = (cliente: FilaCliente) => {
    alCambiar({
      clienteId: cliente.id,
      nombre: cliente.nombre,
      documento: cliente.documento ?? '',
      telefono: cliente.telefono ?? '',
      ...(f.localidad.trim() ? {} : { localidad: cliente.localidad ?? '' }),
    })
    setBuscando('')
    setCandidatos([])
  }

  const cotizables = aseguradoras.filter((a) => !tipo || a.tipos.includes(tipo))
  const alternarAseguradora = (id: IdAseguradora, marcada: boolean) =>
    alCambiar({ aseguradoras: marcada ? [...new Set([...f.aseguradoras, id])] : f.aseguradoras.filter((otra) => otra !== id) })

  return (
    <Tarjeta
      titulo="Datos para cotizar"
      descripcion="Se cargan una sola vez y se cotizan en todas las compañías elegidas al mismo tiempo."
      acciones={
        <>
          <Boton icono="basura" onClick={alLimpiar} disabled={cotizando}>
            Empezar de nuevo
          </Boton>
          <Boton variante="primario" icono="refrescar" onClick={alCotizar} cargando={cotizando}>
            Cotizar{f.aseguradoras.length > 1 ? ` en ${f.aseguradoras.length} compañías` : ''}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Seccion titulo="Vehículo">
          <SelectorDeVehiculo valor={f.vehiculo} alCambiar={(parte) => alCambiar({ vehiculo: { ...f.vehiculo, ...parte } })} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!f.vehiculo.catalogoCodigo && (
              <Campo
                etiqueta="Versión (opcional)"
                value={f.vehiculo.linea}
                onChange={(e) => alCambiar({ vehiculo: { ...f.vehiculo, linea: e.target.value } })}
                placeholder="Ej.: 1.6 XEI CVT"
                ayuda="Cargado a mano, ayuda a que cada compañía lo encuentre en su catálogo."
              />
            )}
            <Campo etiqueta="Patente (opcional)" value={f.patente} onChange={(e) => alCambiar({ patente: e.target.value.toUpperCase() })} />
            <Selector
              etiqueta="Uso"
              value={f.uso}
              onChange={(e) => alCambiar({ uso: e.target.value as UsoDelVehiculo })}
              opciones={USOS_DEL_VEHICULO.map((uso) => ({ valor: uso, texto: NOMBRE_USO_DEL_VEHICULO[uso] }))}
            />
            <Campo
              etiqueta="Suma asegurada (opcional)"
              value={f.sumaAsegurada}
              inputMode="numeric"
              onChange={(e) => alCambiar({ sumaAsegurada: soloNumeros(e.target.value) })}
              ayuda="Vacía = la que diga cada compañía para ese vehículo."
            />
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Casilla etiqueta="0 km" marcada={f.ceroKm} alCambiar={(ceroKm) => alCambiar({ ceroKm })} />
            <Casilla etiqueta="Rastreo satelital" marcada={f.rastreo} alCambiar={(rastreo) => alCambiar({ rastreo })} />
            <Casilla etiqueta="Equipo de GNC" marcada={f.gnc} alCambiar={(gnc) => alCambiar({ gnc })} />
            {f.gnc && (
              <div className="w-48">
                <Campo
                  etiqueta="Valor del equipo de GNC"
                  value={f.valorGnc}
                  inputMode="numeric"
                  onChange={(e) => alCambiar({ valorGnc: soloNumeros(e.target.value) })}
                />
              </div>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Zona y pago">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo
              etiqueta="Código postal"
              value={f.codigoPostal}
              inputMode="numeric"
              onChange={(e) => alCambiar({ codigoPostal: e.target.value })}
              placeholder="Ej.: 1870"
              ayuda="Donde se guarda el vehículo: define la zona de riesgo."
            />
            <div>
              <Campo
                etiqueta="Localidad"
                value={f.localidad}
                list="localidades-multicotizador"
                onChange={(e) => alCambiar({ localidad: e.target.value })}
                placeholder={buscandoLocalidades ? 'Buscando…' : localidades.length ? 'Elegí de la lista…' : ''}
                ayuda={localidades.length > 1 ? `Ese código postal abarca ${localidades.length} localidades.` : undefined}
                error={errorDeLocalidades || undefined}
              />
              <datalist id="localidades-multicotizador">
                {localidades.map((localidad) => (
                  <option key={localidad} value={localidad} />
                ))}
              </datalist>
            </div>
            <Campo etiqueta="Vigencia desde" type="date" value={f.vigenciaDesde} onChange={(e) => alCambiar({ vigenciaDesde: e.target.value })} />
            <Selector
              etiqueta="Medio de pago"
              value={f.medioDePago}
              onChange={(e) => alCambiar({ medioDePago: e.target.value as MedioDePago })}
              opciones={MEDIOS_DE_PAGO.map((medio) => ({ valor: medio, texto: NOMBRE_MEDIO_DE_PAGO[medio] }))}
              ayuda="Cada compañía elige su forma de pago que coincide."
            />
          </div>
        </Seccion>

        <Seccion titulo="Para quién (opcional)">
          {f.clienteId === null ? (
            <div className="relative">
              <Campo
                etiqueta="Buscar un cliente que ya esté"
                value={buscando}
                onChange={(e) => setBuscando(e.target.value)}
                placeholder="Nombre, DNI o patente…"
                ayuda="Para una consulta rápida no hace falta: el nombre sólo se pide para armar el presupuesto."
              />
              {candidatos.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-media">
                  {candidatos.map((cliente) => (
                    <li key={cliente.id}>
                      <button type="button" onClick={() => elegirCliente(cliente)} className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-marino-50">
                        <span className="font-medium text-slate-900">{cliente.nombre}</span>
                        <span className="text-xs text-slate-500">
                          {[cliente.documento, cliente.telefono, cliente.localidad].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-marino-200 bg-marino-50 px-3 py-2 text-sm text-marino-800">
              <span className="min-w-0 flex-1 truncate">
                Cliente de la cartera: <strong className="font-semibold">{f.nombre}</strong>
              </span>
              <Boton tamano="sm" variante="fantasma" onClick={() => alCambiar({ clienteId: null })}>
                Desvincular
              </Boton>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Campo etiqueta="Nombre" value={f.nombre} onChange={(e) => alCambiar({ nombre: e.target.value })} />
            <Campo etiqueta="DNI / CUIT" value={f.documento} onChange={(e) => alCambiar({ documento: e.target.value })} />
            <Campo etiqueta="Teléfono" value={f.telefono} onChange={(e) => alCambiar({ telefono: e.target.value })} />
            <Selector
              etiqueta="Tipo de persona"
              value={f.tipoPersona}
              onChange={(e) => alCambiar({ tipoPersona: e.target.value as TipoDePersona })}
              opciones={TIPOS_DE_PERSONA.map((tipoPersona) => ({ valor: tipoPersona, texto: NOMBRE_TIPO_DE_PERSONA[tipoPersona] }))}
            />
            <Selector
              etiqueta="Condición de IVA"
              value={f.condicionIva}
              onChange={(e) => alCambiar({ condicionIva: e.target.value as CondicionIva })}
              opciones={CONDICIONES_IVA.map((condicion) => ({ valor: condicion, texto: NOMBRE_CONDICION_IVA[condicion] }))}
            />
          </div>
        </Seccion>

        <Seccion titulo="Compañías">
          {aseguradoras.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay ninguna compañía con API cargada. Se configuran en API Aseguradoras.</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {aseguradoras.map((aseguradora) => {
                const noCotizaEsteTipo = tipo !== null && !aseguradora.tipos.includes(tipo)
                const motivo = aseguradora.noDisponible ?? (noCotizaEsteTipo ? `No cotiza ${tipo === 'MOTO' ? 'motos' : 'autos'}.` : undefined)
                return (
                  <Casilla
                    key={aseguradora.id}
                    etiqueta={aseguradora.nombre + (motivo ? ` — ${motivo}` : '')}
                    marcada={f.aseguradoras.includes(aseguradora.id) && !motivo}
                    deshabilitada={Boolean(motivo)}
                    alCambiar={(marcada) => alternarAseguradora(aseguradora.id, marcada)}
                  />
                )
              })}
            </div>
          )}
          {cotizables.length === 1 && (
            <p className="text-xs text-slate-500">
              Por ahora la única compañía con API es {cotizables[0]!.nombre}. Cada compañía que se sume en API Aseguradoras aparece acá sola y se
              cotiza junto con las demás.
            </p>
          )}
        </Seccion>

        {aviso && <p className="text-sm font-medium text-amber-700">{aviso}</p>}
      </div>
    </Tarjeta>
  )
}
