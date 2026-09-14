// El diálogo "Emitir con Galeno": toma la cobertura elegida de una cotización recién hecha —el
// `solicitud`/`instalacion` de Galeno son de esa sesión, no se pueden recuperar más tarde— y pide lo
// mínimo que el manual marca como CAMPO OBLIGATORIO para emitir la póliza.
//
// Lo que no está acá (representante legal, acreedor prendario, declaraciones PEP/AFIP, pase de
// cartera, subrogación) sigue soportado por el servicio de Galeno del lado del proceso principal —
// `DatosDeEmisionGaleno` en shared/tipos.ts los tiene todos—; sólo falta agregarles un campo a este
// formulario el día que la agencia los necesite.
import { useEffect, useState } from 'react'
import {
  CODIGOS_DE_INSPECCION_GALENO,
  NOMBRE_INSPECCION_GALENO,
  type CoberturaCotizadaGaleno,
  type CodigoDeInspeccionGaleno,
  type DatosDeEmisionGaleno,
  type EmisionGaleno,
  type OpcionGaleno,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo, Selector } from '../../componentes/ui'

interface Props {
  rama: number
  solicitud: number
  instalacion: number
  cobertura: CoberturaCotizadaGaleno
  codigoPostal: string
  subCodigoPostal: string
  nombreSugerido: string
  documentoSugerido: string
  telefonoSugerido: string
  patenteSugerida: string
  alCerrar: () => void
  alEmitir: (resultado: EmisionGaleno) => void
}

type MedioDePago = 'TARJETA' | 'DEBITO'

export function DialogoEmitirGaleno({
  rama,
  solicitud,
  instalacion,
  cobertura,
  codigoPostal,
  subCodigoPostal,
  nombreSugerido,
  documentoSugerido,
  telefonoSugerido,
  patenteSugerida,
  alCerrar,
  alEmitir,
}: Props) {
  const [tiposDeDocumento, setTiposDeDocumento] = useState<OpcionGaleno[]>([])
  const [nacionalidades, setNacionalidades] = useState<OpcionGaleno[]>([])
  const [categoriasIva, setCategoriasIva] = useState<OpcionGaleno[]>([])
  const [bancos, setBancos] = useState<OpcionGaleno[]>([])
  const [tarjetas, setTarjetas] = useState<OpcionGaleno[]>([])

  useEffect(() => {
    void (async () => {
      const [d, n, c, b, t] = await Promise.all([
        window.dm.galeno.tiposDeDocumento(),
        window.dm.galeno.nacionalidades(),
        window.dm.galeno.categoriasIva(),
        window.dm.galeno.bancos(),
        window.dm.galeno.tarjetasDeCredito(),
      ])
      if (d.ok) setTiposDeDocumento(d.datos)
      if (n.ok) setNacionalidades(n.datos)
      if (c.ok) setCategoriasIva(c.datos)
      if (b.ok) setBancos(b.datos)
      if (t.ok) setTarjetas(t.datos)
    })()
  }, [])

  const [tipoDocumentoCodigo, setTipoDocumentoCodigo] = useState('96')
  const [documentoNumero, setDocumentoNumero] = useState(documentoSugerido)
  const [nacionalidadCodigo, setNacionalidadCodigo] = useState('1')
  const [categoriaIVACodigo, setCategoriaIVACodigo] = useState('5')
  const [nombre, setNombre] = useState(nombreSugerido)
  const [calleNombre, setCalleNombre] = useState('')
  const [calleNumero, setCalleNumero] = useState('')
  const [callePiso, setCallePiso] = useState('')
  const [calleDepto, setCalleDepto] = useState('')
  const [telefono, setTelefono] = useState(telefonoSugerido)
  const [email, setEmail] = useState('')

  const [patente, setPatente] = useState(patenteSugerida)
  const [motor, setMotor] = useState('')
  const [chasis, setChasis] = useState('')

  const [medioDePago, setMedioDePago] = useState<MedioDePago>('TARJETA')
  const [tarjetaCodigo, setTarjetaCodigo] = useState('')
  const [tarjetaNumero, setTarjetaNumero] = useState('')
  const [tarjetaBancoCodigo, setTarjetaBancoCodigo] = useState('')
  const [tarjetaVencimiento, setTarjetaVencimiento] = useState('')
  const [cbu, setCbu] = useState('')
  const [debitoBancoCodigo, setDebitoBancoCodigo] = useState('')

  const [polizaElectronicaEmail, setPolizaElectronicaEmail] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pideInspeccion, setPideInspeccion] = useState(false)
  const [codServicioInspeccion, setCodServicioInspeccion] = useState<CodigoDeInspeccionGaleno>('6')

  const puedeEmitir =
    Boolean(documentoNumero.trim() && nombre.trim() && calleNombre.trim() && calleNumero.trim() && patente.trim() && motor.trim() && chasis.trim()) &&
    (medioDePago === 'TARJETA' ? Boolean(tarjetaCodigo && tarjetaNumero.trim() && tarjetaVencimiento.trim()) : Boolean(cbu.trim()))

  function armarDatos(): DatosDeEmisionGaleno {
    return {
      rama,
      solicitud,
      instalacion,
      cobertura: cobertura.cobertura,
      tomador: {
        tipoDocumentoCodigo,
        documentoNumero: documentoNumero.trim(),
        nacionalidadCodigo,
        nombre: nombre.trim(),
        categoriaIVACodigo,
        calleNombre: calleNombre.trim(),
        calleNumero: calleNumero.trim(),
        callePiso: callePiso.trim() || undefined,
        calleDepto: calleDepto.trim() || undefined,
        codigoPostal,
        subCodigoPostal,
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
      },
      aseguradoEsTomador: true,
      formaPago: {
        formaPagoTarjetaCodigo: medioDePago === 'TARJETA' ? tarjetaCodigo : undefined,
        formaPagoTarjetaNumero: medioDePago === 'TARJETA' ? tarjetaNumero.trim() : undefined,
        formaPagoTarjetaBancoCodigo: medioDePago === 'TARJETA' ? tarjetaBancoCodigo || undefined : undefined,
        formaPagoTarjetaVencimiento: medioDePago === 'TARJETA' ? tarjetaVencimiento : undefined,
        formaPagoDebitoCBU: medioDePago === 'DEBITO' ? cbu.trim() : undefined,
        formaPagoDebitoBancoCodigo: medioDePago === 'DEBITO' ? debitoBancoCodigo || undefined : undefined,
      },
      polizaElectronicaAceptar: Boolean(polizaElectronicaEmail.trim()),
      polizaElectronicaEmail: polizaElectronicaEmail.trim() || undefined,
      vehiculo: { patente: patente.trim().toUpperCase(), motor: motor.trim(), chasis: chasis.trim() },
      ...(pideInspeccion ? { codServicioInspeccion } : {}),
    }
  }

  const emitir = async () => {
    setEnviando(true)
    setError(null)
    const datos = armarDatos()
    const resultado = pideInspeccion ? await window.dm.galeno.emitirConInspeccion(datos) : await window.dm.galeno.emitir(datos)
    setEnviando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (resultado.datos.estadoSolicitud !== 'E') {
      const necesitaInspeccion = resultado.datos.excepciones.some((e) => /inspecci/i.test(e.observaciones ?? e.detalle ?? ''))
      if (necesitaInspeccion && !pideInspeccion) {
        setPideInspeccion(true)
        setError('El vehículo necesita inspección. Elegí el tipo de inspección y volvé a mandar.')
        return
      }
      const motivos = [...resultado.datos.excepciones.map((e) => e.observaciones ?? e.detalle ?? ''), ...resultado.datos.errores.map((e) => e.descripcion)].filter(Boolean)
      setError(motivos.join(' · ') || 'Galeno no pudo emitir la póliza.')
      return
    }
    alEmitir(resultado.datos)
  }

  return (
    <Dialogo
      abierto
      ancho="lg"
      titulo={`Emitir con Galeno — ${cobertura.descripcionCobertura}`}
      descripcion={`Premio $ ${cobertura.premio.toLocaleString('es-AR', { minimumFractionDigits: 2 })}. Esto emite la póliza de verdad contra Galeno: revisá los datos antes de mandar.`}
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void emitir()} cargando={enviando} disabled={!puedeEmitir}>
            Emitir póliza
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alerta tono="error">{error}</Alerta>}

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">El tomador (y asegurado)</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Selector
              etiqueta="Tipo de documento"
              value={tipoDocumentoCodigo}
              onChange={(e) => setTipoDocumentoCodigo(e.target.value)}
              opciones={tiposDeDocumento.map((t) => ({ valor: t.codigo, texto: t.descripcion }))}
            />
            <Campo etiqueta="Número de documento" value={documentoNumero} onChange={(e) => setDocumentoNumero(e.target.value)} />
            <Selector
              etiqueta="Nacionalidad"
              value={nacionalidadCodigo}
              onChange={(e) => setNacionalidadCodigo(e.target.value)}
              opciones={nacionalidades.map((n) => ({ valor: n.codigo, texto: n.descripcion }))}
            />
            <Selector
              etiqueta="Categoría de IVA"
              value={categoriaIVACodigo}
              onChange={(e) => setCategoriaIVACodigo(e.target.value)}
              opciones={categoriasIva.map((c) => ({ valor: c.codigo, texto: c.descripcion }))}
            />
          </div>
          <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo etiqueta="Calle" value={calleNombre} onChange={(e) => setCalleNombre(e.target.value)} className="sm:col-span-2" />
            <Campo etiqueta="Número" value={calleNumero} onChange={(e) => setCalleNumero(e.target.value)} />
            <Campo etiqueta="Piso (opcional)" value={callePiso} onChange={(e) => setCallePiso(e.target.value)} />
            <Campo etiqueta="Depto (opcional)" value={calleDepto} onChange={(e) => setCalleDepto(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Teléfono (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            <Campo etiqueta="Email (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">El vehículo</h3>
          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta="Patente" value={patente} onChange={(e) => setPatente(e.target.value.toUpperCase())} />
            <Campo etiqueta="Motor" value={motor} onChange={(e) => setMotor(e.target.value)} />
            <Campo etiqueta="Chasis" value={chasis} onChange={(e) => setChasis(e.target.value)} />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Forma de pago</h3>
          <Selector
            etiqueta="Medio de pago"
            value={medioDePago}
            onChange={(e) => setMedioDePago(e.target.value as MedioDePago)}
            opciones={[
              { valor: 'TARJETA', texto: 'Tarjeta de crédito' },
              { valor: 'DEBITO', texto: 'Débito (CBU)' },
            ]}
          />
          {medioDePago === 'TARJETA' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Selector
                etiqueta="Tarjeta"
                value={tarjetaCodigo}
                onChange={(e) => setTarjetaCodigo(e.target.value)}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...tarjetas.map((t) => ({ valor: t.codigo, texto: t.descripcion }))]}
              />
              <Campo etiqueta="Número de tarjeta" value={tarjetaNumero} onChange={(e) => setTarjetaNumero(e.target.value)} />
              <Selector
                etiqueta="Banco"
                value={tarjetaBancoCodigo}
                onChange={(e) => setTarjetaBancoCodigo(e.target.value)}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...bancos.map((b) => ({ valor: b.codigo, texto: b.descripcion }))]}
              />
              <Campo etiqueta="Vencimiento" placeholder="AAAA-MM-DD" value={tarjetaVencimiento} onChange={(e) => setTarjetaVencimiento(e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Campo etiqueta="CBU" value={cbu} onChange={(e) => setCbu(e.target.value)} className="sm:col-span-2" />
              <Selector
                etiqueta="Banco"
                value={debitoBancoCodigo}
                onChange={(e) => setDebitoBancoCodigo(e.target.value)}
                opciones={[{ valor: '', texto: 'Elegir…' }, ...bancos.map((b) => ({ valor: b.codigo, texto: b.descripcion }))]}
              />
            </div>
          )}
        </section>

        <Campo
          etiqueta="Email para la póliza electrónica (opcional)"
          value={polizaElectronicaEmail}
          onChange={(e) => setPolizaElectronicaEmail(e.target.value)}
          type="email"
          ayuda="Si se completa, se acepta la póliza electrónica y Galeno la manda a esta dirección."
        />

        {pideInspeccion && (
          <Selector
            etiqueta="Tipo de inspección"
            value={codServicioInspeccion}
            onChange={(e) => setCodServicioInspeccion(e.target.value as CodigoDeInspeccionGaleno)}
            opciones={CODIGOS_DE_INSPECCION_GALENO.map((codigo) => ({ valor: codigo, texto: NOMBRE_INSPECCION_GALENO[codigo] }))}
            ayuda="Galeno pidió inspección vehicular para poder emitir esta póliza."
          />
        )}
      </div>
    </Dialogo>
  )
}
