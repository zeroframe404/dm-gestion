// El diálogo "Cotizar con Galeno": junta lo que la cotización exige y que el presupuesto todavía no
// tiene (código postal, tipo de persona, plan comercial, condición y forma de pago, modo de
// facturación, y la marca/modelo/versión del catálogo PROPIO de Galeno, que no tiene relación con el
// de InfoAuto que ya usa el resto de la app), llama a la API y deja elegir qué coberturas agregar al
// presupuesto como si se hubieran tipeado a mano.
//
// El `solicitud`/`instalacion` que devuelve Galeno son de esta sesión de cotización: no se guardan en
// la base ni sobreviven a cerrar este diálogo. Por eso "Emitir con Galeno" se dispara desde acá mismo,
// sobre una cobertura recién cotizada, y no como una acción aparte sobre un presupuesto ya guardado.
import { useEffect, useState } from 'react'
import type {
  CoberturaCotizadaGaleno,
  CotizacionGaleno,
  DatosDeCotizacionGaleno,
  DatosDeOpcion,
  EmisionGaleno,
  OpcionGaleno,
  SubModeloGaleno,
  TipoDeVehiculo,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo, Selector } from '../../componentes/ui'
import { DialogoEmitirGaleno } from './DialogoEmitirGaleno'

interface Props {
  tipoVehiculoSugerido: TipoDeVehiculo
  nombreSugerido: string
  patenteSugerida: string
  documentoSugerido: string
  telefonoSugerido: string
  alCerrar: () => void
  /** Cada cobertura marcada se agrega como una opción del presupuesto, lista para guardar. */
  alAgregarOpciones: (opciones: DatosDeOpcion[]) => void
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DialogoCotizarGaleno({ tipoVehiculoSugerido, nombreSugerido, patenteSugerida, documentoSugerido, telefonoSugerido, alCerrar, alAgregarOpciones }: Props) {
  const [tipoVehiculo, setTipoVehiculo] = useState<TipoDeVehiculo>(tipoVehiculoSugerido)

  const [planes, setPlanes] = useState<OpcionGaleno[]>([])
  const [planComercialCodigo, setPlanComercialCodigo] = useState('')
  const [tiposPersona, setTiposPersona] = useState<OpcionGaleno[]>([])
  const [tomadorTipoPersona, setTomadorTipoPersona] = useState('1')
  const [tomadorNombre, setTomadorNombre] = useState(nombreSugerido)

  const [codigoPostalTexto, setCodigoPostalTexto] = useState('')
  const [localidades, setLocalidades] = useState<Array<{ codigo: string; descripcion: string }>>([])
  const [subCodigoPostal, setSubCodigoPostal] = useState('')

  const [modosFacturacion, setModosFacturacion] = useState<OpcionGaleno[]>([])
  const [modoFacturacionCodigo, setModoFacturacionCodigo] = useState('')
  const [condiciones, setCondiciones] = useState<OpcionGaleno[]>([])
  const [condicionPagoCodigo, setCondicionPagoCodigo] = useState('')
  const [formas, setFormas] = useState<OpcionGaleno[]>([])
  const [formaPagoCodigo, setFormaPagoCodigo] = useState('')

  const [marcas, setMarcas] = useState<OpcionGaleno[]>([])
  const [marcaCodigo, setMarcaCodigo] = useState('')
  const [modelos, setModelos] = useState<OpcionGaleno[]>([])
  // Este código de modelo es sólo para PEDIR los años y los sub-modelos (va en la URL de esos dos
  // llamados). El que en realidad se manda a cotizar es otro: cada fila de Sub-modelos trae su PROPIO
  // `codigoModelo`, distinto por versión (ver `versionElegida` más abajo) — así lo pide el manual.
  const [modeloCodigoParaBuscar, setModeloCodigoParaBuscar] = useState('')
  const [anios, setAnios] = useState<OpcionGaleno[]>([])
  const [anioFabricacion, setAnioFabricacion] = useState('')
  const [subModelos, setSubModelos] = useState<SubModeloGaleno[]>([])
  /** Índice en `subModelos` de la versión elegida, como texto (para el `value` del `<select>`). */
  const [indiceVersion, setIndiceVersion] = useState('')
  const versionElegida = indiceVersion !== '' ? (subModelos[Number(indiceVersion)] ?? null) : null

  const [vigenciaDesde, setVigenciaDesde] = useState(hoyIso())
  const [sumaAsegurada, setSumaAsegurada] = useState('')
  const [ceroKm, setCeroKm] = useState(false)

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CotizacionGaleno | null>(null)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [aEmitir, setAEmitir] = useState<CoberturaCotizadaGaleno | null>(null)

  // Listas que sólo dependen del tipo de vehículo.
  useEffect(() => {
    setPlanComercialCodigo('')
    setMarcaCodigo('')
    void (async () => {
      const [p, m] = await Promise.all([window.dm.galeno.planesComerciales(tipoVehiculo), window.dm.galeno.marcas(tipoVehiculo)])
      if (p.ok) {
        setPlanes(p.datos)
        if (p.datos.length === 1) setPlanComercialCodigo(p.datos[0].codigo)
      }
      if (m.ok) setMarcas(m.datos)
    })()
  }, [tipoVehiculo])

  useEffect(() => {
    void (async () => {
      const r = await window.dm.galeno.tiposDePersona()
      if (r.ok) setTiposPersona(r.datos)
    })()
  }, [])

  // Modo de facturación depende del plan comercial.
  useEffect(() => {
    setModoFacturacionCodigo('')
    setModosFacturacion([])
    if (!planComercialCodigo) return
    void (async () => {
      const r = await window.dm.galeno.modosDeFacturacion(tipoVehiculo, planComercialCodigo)
      if (r.ok) {
        setModosFacturacion(r.datos)
        if (r.datos.length === 1) setModoFacturacionCodigo(r.datos[0].codigo)
      }
    })()
  }, [tipoVehiculo, planComercialCodigo])

  // Condición y forma de pago dependen del modo de facturación (la forma, también del plan).
  useEffect(() => {
    setCondicionPagoCodigo('')
    setCondiciones([])
    setFormaPagoCodigo('')
    setFormas([])
    if (!modoFacturacionCodigo) return
    void (async () => {
      const [c, f] = await Promise.all([
        window.dm.galeno.condicionesDePago(tipoVehiculo, modoFacturacionCodigo),
        planComercialCodigo ? window.dm.galeno.formasDePago(tipoVehiculo, modoFacturacionCodigo, planComercialCodigo) : Promise.resolve(null),
      ])
      if (c.ok) {
        setCondiciones(c.datos)
        if (c.datos.length === 1) setCondicionPagoCodigo(c.datos[0].codigo)
      }
      if (f?.ok) setFormas(f.datos)
    })()
  }, [tipoVehiculo, modoFacturacionCodigo, planComercialCodigo])

  // Catálogo propio de Galeno: modelos → años → sub-modelos, en cascada.
  useEffect(() => {
    setModeloCodigoParaBuscar('')
    setModelos([])
    if (!marcaCodigo) return
    void (async () => {
      const r = await window.dm.galeno.modelos(marcaCodigo)
      if (r.ok) setModelos(r.datos)
    })()
  }, [marcaCodigo])

  useEffect(() => {
    setAnioFabricacion('')
    setAnios([])
    if (!marcaCodigo || !modeloCodigoParaBuscar) return
    void (async () => {
      const r = await window.dm.galeno.anios(marcaCodigo, modeloCodigoParaBuscar)
      if (r.ok) setAnios(r.datos)
    })()
  }, [marcaCodigo, modeloCodigoParaBuscar])

  useEffect(() => {
    setIndiceVersion('')
    setSubModelos([])
    if (!marcaCodigo || !modeloCodigoParaBuscar || !anioFabricacion) return
    void (async () => {
      const r = await window.dm.galeno.subModelos(marcaCodigo, modeloCodigoParaBuscar, anioFabricacion)
      if (r.ok) {
        setSubModelos(r.datos)
        if (r.datos.length === 1) setIndiceVersion('0')
      }
    })()
  }, [marcaCodigo, modeloCodigoParaBuscar, anioFabricacion])

  const buscarLocalidades = async () => {
    setLocalidades([])
    setSubCodigoPostal('')
    if (!codigoPostalTexto.trim()) return
    const r = await window.dm.galeno.codigoPostal(tipoVehiculo, codigoPostalTexto.trim())
    if (r.ok) {
      setLocalidades(r.datos.map((c) => ({ codigo: c.subCodigoPostal, descripcion: c.localidad })))
      if (r.datos.length === 1) setSubCodigoPostal(r.datos[0].subCodigoPostal)
    }
  }

  const puedeCotizar = Boolean(
    planComercialCodigo &&
      tomadorTipoPersona &&
      tomadorNombre.trim() &&
      codigoPostalTexto.trim() &&
      subCodigoPostal &&
      condicionPagoCodigo &&
      modoFacturacionCodigo &&
      formaPagoCodigo &&
      marcaCodigo &&
      anioFabricacion &&
      versionElegida &&
      vigenciaDesde,
  )

  const cotizar = async () => {
    if (!versionElegida) return
    setCargando(true)
    setError(null)
    setResultado(null)
    setElegidas(new Set())
    const datos: DatosDeCotizacionGaleno = {
      tipoVehiculo,
      planComercialCodigo,
      ceroKm,
      marcaCodigo,
      // El modelo y el sub-modelo que se cotizan son los de la VERSIÓN elegida (cada fila de
      // Sub-modelos trae su propio `codigoModelo`, que puede ser distinto del de la búsqueda).
      modeloCodigo: String(versionElegida.codigoModelo),
      subModeloCodigo: String(versionElegida.codigoSubModelo),
      anioFabricacion,
      tomadorTipoPersona,
      tomadorNombre: tomadorNombre.trim(),
      codigoPostal: codigoPostalTexto.trim(),
      subCodigoPostal,
      condicionPagoCodigo,
      vigenciaDesde,
      modoFacturacionCodigo,
      formaPagoCodigo,
      sumaAsegurada: sumaAsegurada ? Number(sumaAsegurada) : undefined,
    }
    const resultadoCotizacion = await window.dm.galeno.cotizar(datos)
    setCargando(false)
    if (resultadoCotizacion.ok) setResultado(resultadoCotizacion.datos)
    else setError(resultadoCotizacion.error)
  }

  const alternar = (cobertura: string) => {
    setElegidas((previas) => {
      const nuevas = new Set(previas)
      if (nuevas.has(cobertura)) nuevas.delete(cobertura)
      else nuevas.add(cobertura)
      return nuevas
    })
  }

  const agregarAlPresupuesto = () => {
    if (!resultado) return
    const opciones: DatosDeOpcion[] = resultado.coberturas
      .filter((c) => elegidas.has(c.cobertura))
      .map((c) => ({
        compania: 'GALENO',
        cobertura: c.descripcionCobertura,
        precio: `$ ${c.premio.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        comentario: c.franquicia || c.listaAdicionales.find((a) => a) || '',
      }))
    if (opciones.length > 0) alAgregarOpciones(opciones)
    alCerrar()
  }

  if (aEmitir && resultado) {
    return (
      <DialogoEmitirGaleno
        rama={resultado.rama}
        solicitud={resultado.solicitud}
        instalacion={resultado.instalacion}
        cobertura={aEmitir}
        codigoPostal={codigoPostalTexto.trim()}
        subCodigoPostal={subCodigoPostal}
        nombreSugerido={tomadorNombre}
        documentoSugerido={documentoSugerido}
        telefonoSugerido={telefonoSugerido}
        patenteSugerida={patenteSugerida}
        alCerrar={() => setAEmitir(null)}
        alEmitir={(emision: EmisionGaleno) => {
          alAgregarOpciones([
            {
              compania: 'GALENO',
              cobertura: aEmitir.descripcionCobertura,
              precio: `$ ${emision.premio.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
              comentario: `Póliza Nº ${emision.poliza} emitida el ${new Date().toLocaleDateString('es-AR')}`,
            },
          ])
          setAEmitir(null)
          alCerrar()
        }}
      />
    )
  }

  return (
    <Dialogo
      abierto
      ancho="xl"
      titulo="Cotizar con Galeno"
      descripcion="Se pide lo que Galeno exige para cotizar; el vehículo se busca en el catálogo propio de Galeno, que no es el mismo que InfoAuto."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar}>Cerrar</Boton>
          {resultado ? (
            <Boton variante="primario" icono="ok" onClick={agregarAlPresupuesto} disabled={elegidas.size === 0}>
              Agregar{elegidas.size > 0 ? ` (${elegidas.size})` : ''} al presupuesto
            </Boton>
          ) : (
            <Boton variante="primario" icono="enlace" onClick={() => void cotizar()} cargando={cargando} disabled={!puedeCotizar}>
              Cotizar
            </Boton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        {!resultado && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Selector
                etiqueta="Vehículo"
                value={tipoVehiculo}
                onChange={(e) => setTipoVehiculo(e.target.value as TipoDeVehiculo)}
                opciones={[
                  { valor: 'AUTO', texto: 'Auto' },
                  { valor: 'MOTO', texto: 'Moto' },
                ]}
              />
              <Selector
                etiqueta="Plan comercial"
                value={planComercialCodigo}
                onChange={(e) => setPlanComercialCodigo(e.target.value)}
                opciones={[{ valor: '', texto: planes.length ? 'Elegir…' : 'Cargando…' }, ...planes.map((p) => ({ valor: p.codigo, texto: p.descripcion }))]}
              />
              <Selector
                etiqueta="Tipo de persona"
                value={tomadorTipoPersona}
                onChange={(e) => setTomadorTipoPersona(e.target.value)}
                opciones={tiposPersona.map((t) => ({ valor: t.codigo, texto: t.descripcion }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Campo etiqueta="Nombre del tomador" value={tomadorNombre} onChange={(e) => setTomadorNombre(e.target.value)} />
              <div className="flex items-end gap-2">
                <Campo
                  etiqueta="Código postal"
                  value={codigoPostalTexto}
                  onChange={(e) => setCodigoPostalTexto(e.target.value)}
                  onBlur={() => void buscarLocalidades()}
                  className="flex-1"
                />
                <Boton onClick={() => void buscarLocalidades()}>Buscar</Boton>
              </div>
              <Selector
                etiqueta="Localidad"
                value={subCodigoPostal}
                onChange={(e) => setSubCodigoPostal(e.target.value)}
                disabled={localidades.length === 0}
                opciones={[{ valor: '', texto: localidades.length ? 'Elegir…' : '—' }, ...localidades.map((l) => ({ valor: l.codigo, texto: l.descripcion }))]}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Selector
                etiqueta="Modo de facturación"
                value={modoFacturacionCodigo}
                onChange={(e) => setModoFacturacionCodigo(e.target.value)}
                disabled={!planComercialCodigo}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...modosFacturacion.map((m) => ({ valor: m.codigo, texto: m.descripcion }))]}
              />
              <Selector
                etiqueta="Condición de pago"
                value={condicionPagoCodigo}
                onChange={(e) => setCondicionPagoCodigo(e.target.value)}
                disabled={!modoFacturacionCodigo}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...condiciones.map((c) => ({ valor: c.codigo, texto: c.descripcion }))]}
              />
              <Selector
                etiqueta="Forma de pago"
                value={formaPagoCodigo}
                onChange={(e) => setFormaPagoCodigo(e.target.value)}
                disabled={!modoFacturacionCodigo}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...formas.map((f) => ({ valor: f.codigo, texto: f.descripcion }))]}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Selector
                etiqueta="Marca"
                value={marcaCodigo}
                onChange={(e) => setMarcaCodigo(e.target.value)}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...marcas.map((m) => ({ valor: m.codigo, texto: m.descripcion }))]}
              />
              <Selector
                etiqueta="Modelo"
                value={modeloCodigoParaBuscar}
                onChange={(e) => setModeloCodigoParaBuscar(e.target.value)}
                disabled={!marcaCodigo}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...modelos.map((m) => ({ valor: m.codigo, texto: m.descripcion }))]}
              />
              <Selector
                etiqueta="Año"
                value={anioFabricacion}
                onChange={(e) => setAnioFabricacion(e.target.value)}
                disabled={!modeloCodigoParaBuscar}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...anios.map((a) => ({ valor: a.codigo, texto: a.descripcion }))]}
              />
              <Selector
                etiqueta="Versión"
                value={indiceVersion}
                onChange={(e) => setIndiceVersion(e.target.value)}
                disabled={!anioFabricacion}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...subModelos.map((s, indice) => ({ valor: String(indice), texto: s.version }))]}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Campo etiqueta="Vigencia desde" type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} />
              <Campo
                etiqueta="Suma asegurada (opcional)"
                value={sumaAsegurada}
                onChange={(e) => setSumaAsegurada(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
              />
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={ceroKm} onChange={(e) => setCeroKm(e.target.checked)} />
                0Km
              </label>
            </div>
          </>
        )}

        {resultado && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">{resultado.descripcionVehiculo}</p>
            {resultado.coberturas.length === 0 && <Alerta tono="aviso">Galeno no devolvió coberturas disponibles para estos datos.</Alerta>}
            <div className="flex flex-col gap-2">
              {resultado.coberturas.map((c) => (
                <div key={c.item} className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <input type="checkbox" checked={elegidas.has(c.cobertura)} onChange={() => alternar(c.cobertura)} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.descripcionCobertura}</span>
                      <span className="tabular-nums font-semibold text-slate-900">$ {c.premio.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {c.franquicia && <p className="text-xs text-slate-500">Franquicia: {c.franquicia}</p>}
                  </div>
                  <Boton onClick={() => setAEmitir(c)}>Emitir…</Boton>
                </div>
              ))}
            </div>
            {resultado.excepciones.length > 0 && (
              <Alerta tono="aviso">
                {resultado.excepciones.map((excepcion, indice) => (
                  // eslint-disable-next-line react/no-array-index-key -- son avisos, no tienen id propio.
                  <div key={indice}>{excepcion.detalle || excepcion.observaciones}</div>
                ))}
              </Alerta>
            )}
          </div>
        )}
      </div>
    </Dialogo>
  )
}
