// El Multicotizador: una sola carga de datos y el precio de todas las compañías con API a la vez.
//
// Cada compañía se cotiza en su propio pedido y todas al mismo tiempo: la tarjeta de cada una se llena
// apenas contesta, sin esperar a la más lenta, y una compañía caída no frena a las demás. Con las
// coberturas elegidas se arma el presupuesto de siempre —el mismo del módulo Presupuestos, con su
// WhatsApp y su PDF— o se emite directamente en las compañías que lo permiten.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAXIMO_OPCIONES_POR_PRESUPUESTO,
  NOMBRE_MEDIO_DE_PAGO,
  NOMBRE_USO_DEL_VEHICULO,
  claveDeCobertura,
  elegirAjuste,
  enPesos,
  type AseguradoraDelMulticotizador,
  type CoberturaCotizada,
  type IdAseguradora,
  type ResultadoDeAseguradora,
  type SolicitudDeCotizacion,
} from '../../../shared/multicotizador'
import type { DatosDePresupuesto, EmisionGaleno } from '../../../shared/tipos'
import { BotonAyuda } from '../../componentes/Ayuda'
import { Alerta, Boton, Cargando } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePermisos } from '../../contexto/Permisos'
import { DialogoEmitirGaleno } from '../presupuestos/DialogoEmitirGaleno'
import { FormularioDeCotizacion, formularioVacio, solicitudDe, type FormularioMulticotizador } from './FormularioDeCotizacion'
import { ResultadosDeCotizacion, type EstadoDeTarjeta } from './ResultadosDeCotizacion'

/** Lo que define el riesgo: si cambia, lo que se eligió a mano para ese vehículo o esa zona ya no vale. */
function riesgoDe(solicitud: SolicitudDeCotizacion): string {
  const v = solicitud.vehiculo
  return JSON.stringify([v.tipo, v.marca, v.modelo, v.version, v.anio, v.codigoCatalogo, solicitud.codigoPostal, solicitud.localidad])
}

function hoyLegible(): string {
  return new Date().toLocaleDateString('es-AR')
}

export function Multicotizador() {
  const { ir } = useNavegacion()
  const { puedeEditar, veNumerosDeLaAgencia } = usePermisos()
  // Cotizar es mirar precios; armar el presupuesto y emitir, en cambio, escriben: piden Presupuestos.
  const puedePresupuestar = puedeEditar('presupuestos')

  const [aseguradoras, setAseguradoras] = useState<AseguradoraDelMulticotizador[] | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<FormularioMulticotizador>(() => formularioVacio([]))
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
    setTarjetas((previas) => ({ ...previas, [aseguradora]: { elegidos, cotizando: false, resultado } }))
  }

  const cotizar = () => {
    if (!aseguradoras) return
    const solicitud = solicitudDe(formulario)
    if (typeof solicitud === 'string') {
      setAviso(solicitud)
      return
    }
    const aCotizar = aseguradoras.filter(
      (a) => formulario.aseguradoras.includes(a.id) && !a.noDisponible && a.tipos.includes(solicitud.vehiculo.tipo),
    )
    if (aCotizar.length === 0) {
      setAviso('Ninguna de las compañías elegidas cotiza este tipo de vehículo.')
      return
    }
    setAviso(null)
    setMensaje(null)
    const cambioElRiesgo = !cotizada || riesgoDe(cotizada) !== riesgoDe(solicitud)
    setCotizada(solicitud)
    setSeleccionadas(new Set())
    setTarjetas((previas) => Object.fromEntries(Object.entries(previas).filter(([id]) => aCotizar.some((a) => a.id === id))))

    for (const aseguradora of aCotizar) {
      const previa = tarjetas[aseguradora.id]
      let elegidos = previa?.elegidos ?? {}
      // Otro vehículo u otra zona: se olvida lo elegido a mano que sólo valía para el anterior (la
      // versión en el catálogo de la compañía, su código de localidad) y se conserva lo demás.
      if (cambioElRiesgo && previa?.resultado) {
        const porSolicitud = new Set(previa.resultado.ajustes.filter((ajuste) => ajuste.porSolicitud).map((ajuste) => ajuste.campo))
        elegidos = Object.fromEntries(Object.entries(elegidos).filter(([campo]) => !porSolicitud.has(campo)))
      }
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
    setFormulario((previo) => ({ ...formularioVacio(previo.aseguradoras), medioDePago: previo.medioDePago }))
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
  const faltaNombre = !formulario.nombre.trim() && formulario.clienteId === null

  const armarPresupuesto = async () => {
    if (!cotizada || elegidas.length === 0) return
    const v = cotizada.vehiculo
    const extras = [v.ceroKm && '0 km', v.gnc && 'con GNC', v.rastreo && 'con rastreo'].filter(Boolean).join(', ')
    const datos: DatosDePresupuesto = {
      leadId: null,
      clienteId: formulario.clienteId,
      clienteNombre: formulario.nombre.trim(),
      telefono: formulario.telefono.trim(),
      documento: formulario.documento.trim(),
      sucursal: '',
      patente: formulario.patente.trim(),
      marca: v.marca,
      modelo: [v.modelo, v.version].filter(Boolean).join(' '),
      anio: v.anio,
      tipoVehiculo: NOMBRE_USO_DEL_VEHICULO[v.uso],
      sumaAsegurada: v.sumaAsegurada ? enPesos(v.sumaAsegurada) : '',
      observaciones: [
        `Cotizado con el multicotizador el ${hoyLegible()}.`,
        v.tipo === 'MOTO' ? 'Moto.' : '',
        `CP ${cotizada.codigoPostal}${cotizada.localidad ? ` (${cotizada.localidad})` : ''}.`,
        `Pago: ${NOMBRE_MEDIO_DE_PAGO[cotizada.medioDePago].toLowerCase()}.`,
        extras ? `Vehículo ${extras}.` : '',
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Multicotizador</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
            Los datos se cargan una vez y se cotizan en todas las compañías con API al mismo tiempo. Las coberturas se comparan por lo que cubren y
            con las elegidas se arma el presupuesto de siempre, o se emite ahí mismo.
          </p>
        </div>
        <BotonAyuda clave="multicotizador" />
      </div>

      {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

      <FormularioDeCotizacion
        valor={formulario}
        alCambiar={(cambios) => setFormulario((previo) => ({ ...previo, ...cambios }))}
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
              {faltaNombre && <span className="ml-2 text-amber-700">· Cargá el nombre en «Para quién» para armar el presupuesto.</span>}
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
                disabled={!puedePresupuestar || faltaNombre}
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
          nombreSugerido={formulario.nombre}
          documentoSugerido={formulario.documento}
          telefonoSugerido={formulario.telefono}
          patenteSugerida={formulario.patente}
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
    </div>
  )
}
