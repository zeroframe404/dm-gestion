// El Multicotizador: una sola carga de datos y el precio de todas las compañías con API a la vez.
//
// Tiene su sublista en la barra lateral: Cotizar Vehículo y Cotizar Moto (el mismo cotizador, con el
// tipo ya elegido), y los listados —Cotizaciones, Planes de Cotización y Emisiones—, que salen de la
// API de cada compañía (ver ListadosDelMulticotizador.tsx).
//
// Cada compañía se cotiza en su propio pedido y todas al mismo tiempo: la tarjeta de cada una se llena
// apenas contesta, sin esperar a la más lenta, y una compañía caída no frena a las demás. Con las
// coberturas elegidas se arma el presupuesto de siempre —el mismo del módulo Presupuestos, con su
// WhatsApp y su PDF— o se emite directamente en las compañías que lo permiten.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAXIMO_OPCIONES_POR_PRESUPUESTO,
  NOMBRE_COMISION,
  NOMBRE_FACTURACION,
  NOMBRE_MEDIO_DE_PAGO,
  NOMBRE_PLAN_DE_COTIZACION,
  NOMBRE_RASTREADOR,
  NOMBRE_TARIFA,
  NOMBRE_USO_DEL_VEHICULO,
  claveDeCobertura,
  documentoDelTomador,
  elegidosAplicados,
  elegirAjuste,
  enPesos,
  esSeccionDelMulticotizador,
  nombreDeClausula,
  sinLosPorSolicitud,
  tieneRastreador,
  type AseguradoraDelMulticotizador,
  type CoberturaCotizada,
  type IdAseguradora,
  type ResultadoDeAseguradora,
  type SeccionDelMulticotizador,
  type SolicitudDeCotizacion,
} from '../../../shared/multicotizador'
import type { DatosDePresupuesto, EmisionGaleno, TipoDeVehiculo } from '../../../shared/tipos'
import { BotonAyuda } from '../../componentes/Ayuda'
import { Alerta, Boton, Cargando } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePermisos } from '../../contexto/Permisos'
import { ajustesGuardados, condicionesGuardadas, guardarAjustes, guardarCondiciones } from '../../preferencias'
import { DialogoEmitirGaleno } from '../presupuestos/DialogoEmitirGaleno'
import { DialogoEmitirAtm } from './DialogoEmitirAtm'
import {
  FormularioDeCotizacion,
  aseguradorasACotizar,
  condicionesDe,
  formularioVacio,
  solicitudDe,
  type FormularioMulticotizador,
} from './FormularioDeCotizacion'
import { Cotizaciones, Emisiones, PlanesDeCotizacion } from './ListadosDelMulticotizador'
import { ResultadosDeCotizacion, type EstadoDeTarjeta } from './ResultadosDeCotizacion'

/** Lo que define el riesgo: si cambia, lo que se eligió a mano para ese vehículo o esa zona ya no vale. */
function riesgoDe(solicitud: SolicitudDeCotizacion): string {
  const v = solicitud.vehiculo
  return JSON.stringify([v.tipo, v.marca, v.modelo, v.version, v.anio, v.codigoCatalogo, solicitud.codigoPostal, solicitud.localidad])
}

function hoyLegible(): string {
  return new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Para la gente (el presupuesto, los diálogos de emisión): «Juan Pérez». A las compañías va al revés. */
function nombreParaMostrar(f: Pick<FormularioMulticotizador, 'nombre' | 'apellido'>): string {
  return [f.nombre.trim(), f.apellido.trim()].filter(Boolean).join(' ')
}

function cuotasLegibles(solicitud: SolicitudDeCotizacion): string {
  const { cuotas } = solicitud.condiciones
  if (cuotas === 'MAXIMA') return 'máximas cuotas'
  if (cuotas === null) return 'cuotas de cada compañía'
  return cuotas === 1 ? '1 cuota' : `${cuotas} cuotas`
}

export function Multicotizador() {
  const { seccion: pedida } = useNavegacion()
  const seccion: SeccionDelMulticotizador = esSeccionDelMulticotizador(pedida) ? pedida : 'auto'
  // Los dos cotizadores quedan montados una vez abiertos: ir a mirar Emisiones y volver no borra lo
  // que se estaba cotizando.
  const [abiertos, setAbiertos] = useState<Set<TipoDeVehiculo>>(() => new Set())
  const tipo: TipoDeVehiculo | null = seccion === 'auto' ? 'AUTO' : seccion === 'moto' ? 'MOTO' : null
  useEffect(() => {
    if (tipo && !abiertos.has(tipo)) setAbiertos((previos) => new Set([...previos, tipo]))
  }, [tipo, abiertos])

  return (
    <>
      {(['AUTO', 'MOTO'] as const).map((cual) =>
        abiertos.has(cual) || tipo === cual ? (
          <div key={cual} hidden={tipo !== cual}>
            <Cotizador tipo={cual} />
          </div>
        ) : null,
      )}
      {seccion === 'cotizaciones' && <Cotizaciones />}
      {seccion === 'planes' && <PlanesDeCotizacion />}
      {seccion === 'emisiones' && <Emisiones />}
    </>
  )
}

/** Cotizar Vehículo / Cotizar Moto: el mismo cotizador, con el tipo ya elegido por la sección. */
function Cotizador({ tipo }: { tipo: TipoDeVehiculo }) {
  const { ir } = useNavegacion()
  const { puedeEditar, veNumerosDeLaAgencia } = usePermisos()
  // Cotizar es mirar precios; armar el presupuesto y emitir, en cambio, escriben: piden Presupuestos.
  const puedePresupuestar = puedeEditar('presupuestos')

  const [aseguradoras, setAseguradoras] = useState<AseguradoraDelMulticotizador[] | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<FormularioMulticotizador>(() => formularioVacio([], tipo, condicionesGuardadas()))
  const [aviso, setAviso] = useState<string | null>(null)
  const [tarjetas, setTarjetas] = useState<Record<IdAseguradora, EstadoDeTarjeta>>({})
  const [cotizada, setCotizada] = useState<SolicitudDeCotizacion | null>(null)
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [aEmitir, setAEmitir] = useState<CoberturaCotizada | null>(null)
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null)
  const [armando, setArmando] = useState(false)
  /**
   * El número del último pedido de cada compañía. Si se vuelve a cotizar antes de que conteste el
   * anterior, la respuesta vieja llega después y no tiene que pisar a la nueva.
   */
  const pedidos = useRef<Record<IdAseguradora, number>>({})

  const disponibles = (lista: AseguradoraDelMulticotizador[]) => lista.filter((a) => !a.noDisponible).map((a) => a.id)

  useEffect(() => {
    void window.dm.multicotizador.aseguradoras().then((resultado) => {
      if (!resultado.ok) {
        setErrorDeCarga(resultado.error)
        return
      }
      setAseguradoras(resultado.datos)
      setFormulario((previo) => ({ ...previo, aseguradoras: disponibles(resultado.datos) }))
    })
  }, [])

  const nombreDe = (id: IdAseguradora) => aseguradoras?.find((a) => a.id === id)?.nombre ?? id

  const cotizarUna = async (aseguradora: IdAseguradora, solicitud: SolicitudDeCotizacion, elegidos: Record<string, string>) => {
    const numero = (pedidos.current[aseguradora] ?? 0) + 1
    pedidos.current[aseguradora] = numero
    setTarjetas((previas) => ({ ...previas, [aseguradora]: { resultado: previas[aseguradora]?.resultado ?? null, elegidos, cotizando: true } }))
    // Lo elegido de esta compañía se suelta: la cotización nueva trae otro número de solicitud y otros
    // precios, y un presupuesto armado con los viejos mentiría.
    setSeleccionadas((previas) => new Set([...previas].filter((clave) => !clave.startsWith(`${aseguradora}:`))))

    const respuesta = await window.dm.multicotizador.cotizar({ aseguradora, solicitud, elegidos })
    if (pedidos.current[aseguradora] !== numero) return
    const resultado: ResultadoDeAseguradora = respuesta.ok
      ? respuesta.datos
      : {
          aseguradora,
          nombre: nombreDe(aseguradora),
          estado: 'ERROR',
          mensaje: respuesta.error,
          descripcionVehiculo: '',
          coberturas: [],
          avisos: [],
          ajustes: [],
          duracionMs: 0,
        }
    // Queda como «a mano» sólo lo que la compañía aplicó de verdad: lo que descartó (un plan que ya no
    // lista) no se cuenta ni se guarda. Y lo que vale para cualquier vehículo se recuerda en esta
    // computadora, para que la próxima vez la compañía arranque con eso en vez de decidir sola. Sin
    // ajustes en la respuesta (la compañía falló antes de armarlos) no se sabe cuáles eran de ESTE
    // vehículo y no se guarda nada: guardar la versión o la localidad haría cotizar mañana otro auto.
    const aplicados = elegidosAplicados(elegidos, resultado.ajustes)
    if (respuesta.ok && resultado.ajustes.length > 0) guardarAjustes(aseguradora, sinLosPorSolicitud(aplicados, resultado.ajustes))
    setTarjetas((previas) => ({ ...previas, [aseguradora]: { elegidos: aplicados, cotizando: false, resultado } }))
  }

  const cotizar = () => {
    if (!aseguradoras) return
    const solicitud = solicitudDe(formulario)
    if (typeof solicitud === 'string') {
      setAviso(solicitud)
      return
    }
    const elegidas = aseguradorasACotizar(formulario, aseguradoras)
    const aCotizar = aseguradoras.filter((a) => elegidas.includes(a.id) && !a.noDisponible && a.tipos.includes(solicitud.vehiculo.tipo))
    if (aCotizar.length === 0) {
      setAviso('Ninguna de las compañías elegidas cotiza este tipo de vehículo.')
      return
    }
    setAviso(null)
    // La próxima vez el formulario arranca con estas condiciones comerciales.
    guardarCondiciones(condicionesDe(formulario))
    setMensaje(null)
    const cambioElRiesgo = !cotizada || riesgoDe(cotizada) !== riesgoDe(solicitud)
    setCotizada(solicitud)
    setSeleccionadas(new Set())
    setTarjetas((previas) => Object.fromEntries(Object.entries(previas).filter(([id]) => aCotizar.some((a) => a.id === id))))

    for (const aseguradora of aCotizar) {
      const previa = tarjetas[aseguradora.id]
      // Sin tarjeta previa (recién se entró, o se empezó de nuevo) se arranca con lo que esta
      // computadora eligió la última vez: el modo de facturación, la bonificación con la que trabaja
      // la agencia… Es lo que hace que el precio dé igual que ayer sin volver a cargar nada.
      let elegidos = previa?.elegidos ?? ajustesGuardados(aseguradora.id)
      // Otro vehículo u otra zona: se olvida lo elegido a mano que sólo valía para el anterior (la
      // versión en el catálogo de la compañía, su código de localidad) y se conserva lo demás.
      if (cambioElRiesgo && previa?.resultado) elegidos = sinLosPorSolicitud(elegidos, previa.resultado.ajustes)
      void cotizarUna(aseguradora.id, solicitud, elegidos)
    }
  }

  const recotizar = (aseguradora: IdAseguradora) => {
    if (cotizada) void cotizarUna(aseguradora, cotizada, tarjetas[aseguradora]?.elegidos ?? {})
  }

  const cambiarAjuste = (aseguradora: IdAseguradora, campo: string, valor: string) => {
    const tarjeta = tarjetas[aseguradora]
    if (!tarjeta?.resultado || !cotizada) return
    const elegidos = elegirAjuste(tarjeta.elegidos, tarjeta.resultado.ajustes, campo, valor)
    // «Que decida la compañía»: no queda nada elegido a mano para ese campo.
    if (!valor) delete elegidos[campo]
    void cotizarUna(aseguradora, cotizada, elegidos)
  }

  const empezarDeNuevo = () => {
    for (const id of Object.keys(pedidos.current)) pedidos.current[id] = (pedidos.current[id] ?? 0) + 1
    // Las condiciones comerciales y las compañías elegidas no son de este cliente: se conservan.
    setFormulario((previo) => ({ ...formularioVacio(previo.aseguradoras, tipo, condicionesDe(previo)), todas: previo.todas }))
    setTarjetas({})
    setCotizada(null)
    setSeleccionadas(new Set())
    setAviso(null)
    setMensaje(null)
  }

  const coberturas = useMemo(() => {
    const todas = new Map<string, CoberturaCotizada>()
    for (const tarjeta of Object.values(tarjetas)) {
      for (const cobertura of tarjeta.resultado?.coberturas ?? []) todas.set(claveDeCobertura(cobertura), cobertura)
    }
    return todas
  }, [tarjetas])

  const alternar = (clave: string) => {
    if (!seleccionadas.has(clave) && seleccionadas.size >= MAXIMO_OPCIONES_POR_PRESUPUESTO) {
      setMensaje({ tono: 'error', texto: `Un presupuesto admite hasta ${MAXIMO_OPCIONES_POR_PRESUPUESTO} opciones.` })
      return
    }
    setSeleccionadas((previas) => {
      const siguientes = new Set(previas)
      if (siguientes.has(clave)) siguientes.delete(clave)
      else siguientes.add(clave)
      return siguientes
    })
  }

  const desactualizada = useMemo(() => {
    if (!cotizada) return false
    const actual = solicitudDe(formulario)
    return typeof actual === 'string' || JSON.stringify(actual) !== JSON.stringify(cotizada)
  }, [cotizada, formulario])

  const elegidas = [...seleccionadas].map((clave) => coberturas.get(clave)).filter((c): c is CoberturaCotizada => c !== undefined)

  const armarPresupuesto = async () => {
    if (!cotizada || elegidas.length === 0) return
    const v = cotizada.vehiculo
    const c = cotizada.condiciones
    const scoring = [v.scoring.grua && 'grúa', v.scoring.alarma && 'alarma', v.scoring.garaje && 'garaje'].filter(Boolean).join(', ')
    const extras = [v.ceroKm && '0 km', tieneRastreador(v) && `rastreador: ${NOMBRE_RASTREADOR[v.rastreador].toLowerCase()}`, scoring && `con ${scoring}`]
      .filter(Boolean)
      .join(', ')
    const accesorios = v.accesorios.map((a) => `${a.nombre} (${enPesos(a.valor)})`).join(', ')
    const datos: DatosDePresupuesto = {
      leadId: null,
      clienteId: formulario.clienteId,
      clienteNombre: nombreParaMostrar(cotizada.tomador),
      telefono: cotizada.tomador.telefono,
      documento: documentoDelTomador(cotizada.tomador),
      sucursal: '',
      patente: '',
      marca: v.marca,
      modelo: [v.modelo, v.version].filter(Boolean).join(' '),
      anio: v.anio,
      tipoVehiculo: NOMBRE_USO_DEL_VEHICULO[v.uso],
      sumaAsegurada: v.sumaAsegurada ? enPesos(v.sumaAsegurada) : '',
      observaciones: [
        `Cotizado con el multicotizador el ${hoyLegible()}.`,
        v.tipo === 'MOTO' ? 'Moto.' : '',
        `${cotizada.localidad}, ${cotizada.provincia} (CP ${cotizada.codigoPostal}).`,
        `Pago: ${NOMBRE_MEDIO_DE_PAGO[cotizada.medioDePago].toLowerCase()}, facturación ${NOMBRE_FACTURACION[c.facturacion].toLowerCase()}, ${cuotasLegibles(cotizada)}.`,
        `${NOMBRE_PLAN_DE_COTIZACION[c.plan]}; tarifa ${NOMBRE_TARIFA[c.tarifa].toLowerCase()}; comisión ${NOMBRE_COMISION[c.comision].toLowerCase()}; cláusula de ajuste ${nombreDeClausula(c.clausulaAjuste).toLowerCase()}.`,
        extras ? `Vehículo ${extras}.` : '',
        accesorios ? `Accesorios: ${accesorios}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      opciones: elegidas.map((cobertura) => ({
        compania: cobertura.aseguradora,
        cobertura: cobertura.nombre,
        precio: enPesos(cobertura.premio),
        comentario: [cobertura.cuota !== null ? `Cuota ${enPesos(cobertura.cuota)}` : '', cobertura.franquicia ? `Franquicia ${cobertura.franquicia}` : '']
          .filter(Boolean)
          .join(' · '),
      })),
    }
    setArmando(true)
    const resultado = await window.dm.presupuestos.crear(datos)
    setArmando(false)
    if (resultado.ok) ir('presupuestos', { presupuestoId: resultado.datos.presupuesto.id })
    else setMensaje({ tono: 'error', texto: resultado.error })
  }

  if (errorDeCarga) {
    return (
      <div className="p-8">
        <Alerta tono="error">{errorDeCarga}</Alerta>
      </div>
    )
  }
  if (!aseguradoras) return <Cargando />

  const emision = aEmitir?.emision
  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{tipo === 'MOTO' ? 'Cotizar Moto' : 'Cotizar Vehículo'}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
            Los datos {tipo === 'MOTO' ? 'de la moto ' : 'del vehículo '}se cargan una vez y se cotizan en todas las compañías con API al mismo
            tiempo. Las coberturas se comparan por lo que cubren y con las elegidas se arma el presupuesto de siempre, o se emite ahí mismo.
          </p>
        </div>
        <BotonAyuda clave="multicotizador" />
      </div>

      {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

      <FormularioDeCotizacion
        valor={formulario}
        alCambiar={(cambios) => setFormulario((previo) => ({ ...previo, ...(typeof cambios === 'function' ? cambios(previo) : cambios) }))}
        aseguradoras={aseguradoras}
        cotizando={Object.values(tarjetas).some((tarjeta) => tarjeta.cotizando)}
        alCotizar={cotizar}
        alLimpiar={empezarDeNuevo}
        aviso={aviso}
      />

      <ResultadosDeCotizacion
        aseguradoras={aseguradoras}
        tarjetas={tarjetas}
        alCambiarAjuste={cambiarAjuste}
        alRecotizar={recotizar}
        seleccionadas={seleccionadas}
        alAlternar={alternar}
        veComision={veNumerosDeLaAgencia}
        puedeEmitir={puedePresupuestar}
        alEmitir={setAEmitir}
        desactualizada={desactualizada}
      />

      {elegidas.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-8 -mb-8 border-t border-slate-200 bg-white/95 px-8 py-3 shadow-media backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-700">
              <strong className="font-semibold">{elegidas.length}</strong> cobertura{elegidas.length === 1 ? '' : 's'} elegida
              {elegidas.length === 1 ? '' : 's'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Boton variante="fantasma" onClick={() => setSeleccionadas(new Set())}>
                Soltar
              </Boton>
              <Boton
                variante="primario"
                icono="presupuestos"
                escribe
                cargando={armando}
                disabled={!puedePresupuestar}
                title={puedePresupuestar ? undefined : 'Armar un presupuesto pide permiso para editar Presupuestos.'}
                onClick={() => void armarPresupuesto()}
              >
                Armar presupuesto
              </Boton>
            </div>
          </div>
        </div>
      )}

      {aEmitir && emision?.tipo === 'GALENO' && (
        <DialogoEmitirGaleno
          rama={emision.rama}
          solicitud={emision.solicitud}
          instalacion={emision.instalacion}
          cobertura={emision.cobertura}
          codigoPostal={emision.codigoPostal}
          subCodigoPostal={emision.subCodigoPostal}
          nombreSugerido={nombreParaMostrar(formulario)}
          documentoSugerido={documentoDelTomador(formulario)}
          telefonoSugerido={formulario.telefono}
          patenteSugerida=""
          alCerrar={() => setAEmitir(null)}
          alEmitir={(resultado: EmisionGaleno) => {
            setMensaje({
              tono: 'exito',
              texto: `${aEmitir.nombreAseguradora} emitió la póliza Nº ${resultado.poliza} (${aEmitir.nombre}) por ${enPesos(resultado.premio)}.`,
            })
            setAEmitir(null)
          }}
        />
      )}
      {aEmitir && emision?.tipo === 'ATM' && (
        <DialogoEmitirAtm
          emision={emision}
          nombreSugerido={nombreParaMostrar(formulario)}
          documentoSugerido={documentoDelTomador(formulario)}
          telefonoSugerido={formulario.telefono}
          patenteSugerida=""
          alCerrar={() => setAEmitir(null)}
          alEmitir={(resultado) => {
            const numero = resultado.poliza ? `la póliza Nº ${resultado.poliza}` : resultado.propuesta ? `la propuesta Nº ${resultado.propuesta}` : `la operación ${resultado.operacion}`
            setMensaje({
              tono: 'exito',
              texto: `${aEmitir.nombreAseguradora} emitió ${numero} (${aEmitir.nombre}) por ${enPesos(emision.premio)}.${resultado.estado === 'INS' ? ' Queda pendiente de inspección.' : ''}`,
            })
            setAEmitir(null)
          }}
        />
      )}
    </div>
  )
}
