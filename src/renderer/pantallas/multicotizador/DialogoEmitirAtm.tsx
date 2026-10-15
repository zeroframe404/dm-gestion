// El diálogo "Emitir con ATM": convierte la cobertura elegida de una cotización recién hecha en
// propuesta o póliza (AUTOS_Propuesta_PHP). El número de operación es de esa cotización: ATM no vuelve
// a cotizar, sólo pide lo que faltaba —titular, vehículo, forma de pago— con los códigos de sus tablas.
//
// Lo que no está acá (inspección de motos con fotos y carta de daño) sigue siendo por la web de ATM:
// si la operación queda pendiente de inspección, ATM devuelve el enlace y se muestra al terminar.
import { useEffect, useMemo, useState } from 'react'
import type { EmisionPosibleAtm } from '../../../shared/multicotizador'
import { enPesos } from '../../../shared/multicotizador'
import type { DatosDeEmisionAtm, EmisionAtm, OpcionDeAtm, OpcionesDeEmisionAtm } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Cargando, Dialogo, Selector } from '../../componentes/ui'

interface Props {
  emision: EmisionPosibleAtm
  nombreSugerido: string
  documentoSugerido: string
  telefonoSugerido: string
  patenteSugerida: string
  alCerrar: () => void
  alEmitir: (resultado: EmisionAtm) => void
}

const ESTADO: Record<string, string> = {
  POL: 'quedó emitida la póliza',
  PRO: 'quedó como propuesta',
  INS: 'quedó pendiente de inspección',
}

/** «Elegir…» y las opciones de una tabla de ATM. */
function lista(opciones: OpcionDeAtm[]) {
  return [{ valor: '', texto: 'Elegir…' }, ...opciones.map((o) => ({ valor: o.codigo, texto: o.descripcion }))]
}

/** El código de la primera opción cuya descripción coincide, o ''. */
function codigoQueDice(opciones: OpcionDeAtm[], patron: RegExp): string {
  return opciones.find((o) => patron.test(o.descripcion) || patron.test(o.codigo))?.codigo ?? ''
}

type TipoDeFormaDePago = 'TARJETA' | 'CBU' | 'OTRA'

function tipoDeForma(forma: OpcionDeAtm | undefined): TipoDeFormaDePago {
  const texto = `${forma?.descripcion ?? ''}`.toUpperCase()
  if (/TARJ/.test(texto)) return 'TARJETA'
  if (/CBU|D[EÉ]BITO/.test(texto)) return 'CBU'
  return 'OTRA'
}

const esCapital = (provincia: string) => /CAPITAL|C\s*\.?\s*A\s*\.?\s*B\s*\.?\s*A|CIUDAD AUT/i.test(provincia)

export function DialogoEmitirAtm({ emision, nombreSugerido, documentoSugerido, telefonoSugerido, patenteSugerida, alCerrar, alEmitir }: Props) {
  const [opciones, setOpciones] = useState<OpcionesDeEmisionAtm | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)
  const esFisica = emision.tipoPersona === 'F'

  // El titular
  const [tipoDocumento, setTipoDocumento] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState(documentoSugerido)
  const [apellido, setApellido] = useState(nombreSugerido)
  const [cuit, setCuit] = useState('')
  const [sexo, setSexo] = useState('')
  const [estadoCivil, setEstadoCivil] = useState('')
  const [nacionalidad, setNacionalidad] = useState('')
  const [actividad, setActividad] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [provinciaNacimiento, setProvinciaNacimiento] = useState('')
  const [localidadNacimiento, setLocalidadNacimiento] = useState('')
  const [representante, setRepresentante] = useState({ tipoDocumento: '', numeroDocumento: '', apellido: '', nombre: '' })
  // El domicilio
  const [indiceLocalidad, setIndiceLocalidad] = useState(0)
  const [localidad, setLocalidad] = useState('')
  const [calle, setCalle] = useState('')
  const [altura, setAltura] = useState('')
  const [piso, setPiso] = useState('')
  const [depto, setDepto] = useState('')
  const [telefono, setTelefono] = useState('')
  const [celular, setCelular] = useState(telefonoSugerido)
  const [email, setEmail] = useState('')
  // El vehículo
  const [patente, setPatente] = useState(patenteSugerida)
  const [chasis, setChasis] = useState('')
  const [motor, setMotor] = useState('')
  // La forma de pago
  const [forma, setForma] = useState('')
  const [cbu, setCbu] = useState('')
  const [tarjeta, setTarjeta] = useState('')
  const [numeroTarjeta, setNumeroTarjeta] = useState('')
  const [vencimiento, setVencimiento] = useState('')
  // Acreedor e inspección
  const [conAcreedor, setConAcreedor] = useState(false)
  const [acreedor, setAcreedor] = useState({ tipoDocumento: '', numeroDocumento: '', apellido: '', nombre: '' })
  const [responsable, setResponsable] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<EmisionAtm | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await window.dm.atm.opcionesDeEmision(emision.codigoPostal)
      if (!r.ok) {
        setErrorDeCarga(r.error)
        return
      }
      const o = r.datos
      setOpciones(o)
      // Lo más probable, ya elegido: igual se puede cambiar.
      setTipoDocumento(codigoQueDice(o.tiposDeDocumento, esFisica ? /^DNI$/i : /^CUIT$/i))
      setRepresentante((previo) => ({ ...previo, tipoDocumento: codigoQueDice(o.tiposDeDocumento, /^DNI$/i) }))
      setAcreedor((previo) => ({ ...previo, tipoDocumento: codigoQueDice(o.tiposDeDocumento, /^DNI$/i) }))
      setNacionalidad(codigoQueDice(o.nacionalidades, /ARGENTIN/i))
      const condicion = emision.condicionDePago
      setForma(codigoQueDice(o.formasDePago, condicion === 'TARJETA' ? /TARJ/i : condicion === 'CBU' ? /CBU|D[EÉ]BITO/i : /EFECT|CUP[OÓ]N|OTRA/i))
      setResponsable(codigoQueDice(o.responsablesDeInspeccion, /PRODUCTOR/i))
      const i = Math.max(0, o.localidades.findIndex((l) => l.subCodigoPostal === emision.subCodigoPostal))
      setIndiceLocalidad(i)
      const elegida = o.localidades[i]
      if (elegida) setLocalidad(esCapital(elegida.provincia) ? 'C.A.B.A.' : elegida.localidad)
    })()
  }, [emision, esFisica])

  const localidadElegida = opciones?.localidades[indiceLocalidad]
  const enCapital = localidadElegida ? esCapital(localidadElegida.provincia) : false
  // En Capital la tabla trae las calles (con sus alturas) del código postal: se ofrecen para elegir.
  const callesDeCapital = useMemo(
    () => (enCapital && opciones ? [...new Set(opciones.localidades.map((l) => l.localidad.replace(/\s*[\d-]+\s*$/, '').trim()).filter(Boolean))] : []),
    [enCapital, opciones],
  )
  const formaElegida = opciones?.formasDePago.find((f) => f.codigo === forma)
  const tipo = tipoDeForma(formaElegida)
  const nacionalidadElegida = opciones?.nacionalidades.find((n) => n.codigo === nacionalidad)
  const esArgentino = /ARGENTIN/i.test(nacionalidadElegida?.descripcion ?? '')
  // En persona jurídica el documento ya es el CUIT; en física, fuera de consumidor final se pide aparte.
  const pideCuit = esFisica && emision.iva !== 'CF'

  const faltan: string[] = []
  if (!tipoDocumento || !numeroDocumento.trim()) faltan.push('el documento')
  if (!apellido.trim()) faltan.push(esFisica ? 'el apellido y nombre' : 'la razón social')
  if (pideCuit && !cuit.trim()) faltan.push('el CUIT')
  if (esFisica && (!sexo || !estadoCivil || !nacionalidad || !actividad || !fechaNacimiento)) faltan.push('los datos personales')
  if (esFisica && esArgentino && (!provinciaNacimiento || !localidadNacimiento.trim())) faltan.push('el lugar de nacimiento')
  if (!esFisica && (!representante.tipoDocumento || !representante.numeroDocumento.trim() || !representante.apellido.trim() || !representante.nombre.trim()))
    faltan.push('el representante legal')
  if (!localidadElegida || !localidad.trim() || !calle.trim() || !altura.trim()) faltan.push('el domicilio')
  if (!telefono.trim() && !celular.trim()) faltan.push('un teléfono')
  if (!email.trim()) faltan.push('el email')
  if (!patente.trim() || !chasis.trim() || !motor.trim()) faltan.push('patente, chasis y motor')
  if (!forma) faltan.push('la forma de pago')
  if (tipo === 'TARJETA' && (!tarjeta || !numeroTarjeta.trim() || !vencimiento.trim())) faltan.push('los datos de la tarjeta')
  if (tipo === 'CBU' && !cbu.trim()) faltan.push('el CBU')
  if (conAcreedor && (!acreedor.tipoDocumento || !acreedor.numeroDocumento.trim() || !acreedor.apellido.trim() || !acreedor.nombre.trim()))
    faltan.push('el acreedor prendario')
  const tablasCompletas = opciones !== null && opciones.faltan.length === 0
  const puedeEmitir = tablasCompletas && faltan.length === 0

  function armarDatos(): DatosDeEmisionAtm {
    const soloDigitos = (valor: string) => valor.replace(/\D/g, '')
    return {
      operacion: emision.operacion,
      cobertura: emision.cobertura,
      condicionDePago: emision.condicionDePago,
      titular: {
        tipoPersona: emision.tipoPersona,
        tipoDocumento,
        numeroDocumento: soloDigitos(numeroDocumento),
        apellido: apellido.trim().toUpperCase(),
        codigoProvincia: localidadElegida?.codigoProvincia ?? '',
        localidad: localidad.trim().toUpperCase(),
        calle: calle.trim().toUpperCase(),
        altura: soloDigitos(altura),
        piso: piso.trim() || undefined,
        depto: depto.trim() || undefined,
        codigoPostal: emision.codigoPostal,
        subCodigoPostal: localidadElegida?.subCodigoPostal || undefined,
        telefono: telefono.trim() || undefined,
        celular: celular.trim() || undefined,
        email: email.trim(),
        actividad: actividad || undefined,
        cuit: pideCuit && cuit.trim() ? soloDigitos(cuit) : undefined,
        ...(esFisica
          ? {
              sexo,
              estadoCivil,
              nacionalidad,
              fechaNacimiento,
              provinciaNacimiento: esArgentino ? provinciaNacimiento : undefined,
              localidadNacimiento: esArgentino ? localidadNacimiento.trim().toUpperCase() : undefined,
            }
          : {
              representante: {
                ...representante,
                numeroDocumento: soloDigitos(representante.numeroDocumento),
                apellido: representante.apellido.trim().toUpperCase(),
                nombre: representante.nombre.trim().toUpperCase(),
              },
            }),
      },
      vehiculo: { patente: patente.trim().toUpperCase(), chasis: chasis.trim().toUpperCase(), motor: motor.trim().toUpperCase() },
      formaDePago: {
        forma,
        ...(tipo === 'CBU' ? { cbu: soloDigitos(cbu) } : {}),
        ...(tipo === 'TARJETA' ? { tarjeta: { codigo: tarjeta, numero: soloDigitos(numeroTarjeta), vencimiento: soloDigitos(vencimiento) } } : {}),
      },
      acreedor: conAcreedor
        ? {
            ...acreedor,
            numeroDocumento: soloDigitos(acreedor.numeroDocumento),
            apellido: acreedor.apellido.trim().toUpperCase(),
            nombre: acreedor.nombre.trim().toUpperCase(),
          }
        : undefined,
      responsableInspeccion: responsable || undefined,
    }
  }

  const emitir = async () => {
    setEnviando(true)
    setError(null)
    const r = await window.dm.atm.emitir(armarDatos())
    setEnviando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setResultado(r.datos)
  }

  const abrir = (url: string) => void window.dm.sistema.abrirEnlace(url)

  if (resultado) {
    return (
      <Dialogo
        abierto
        titulo={`Emitido con ATM — ${emision.descripcionCobertura}`}
        alCerrar={() => alEmitir(resultado)}
        pie={
          <Boton variante="primario" icono="ok" onClick={() => alEmitir(resultado)}>
            Listo
          </Boton>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-slate-700">
          <Alerta tono="exito">
            La operación {resultado.operacion || emision.operacion} {ESTADO[resultado.estado] ?? `quedó en estado ${resultado.estado || 'desconocido'}`}.
            {resultado.poliza && ` Póliza Nº ${resultado.poliza}.`}
            {resultado.propuesta && ` Propuesta Nº ${resultado.propuesta}.`}
          </Alerta>
          {resultado.avisoDeInspeccion && <Alerta tono="aviso">Inspección: {resultado.avisoDeInspeccion}</Alerta>}
          {resultado.inspeccionUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Falta la inspección{resultado.inspeccionNumero ? ` (Nº ${resultado.inspeccionNumero})` : ''}: se hace desde este enlace.
              </span>
              <Boton tamano="sm" onClick={() => abrir(resultado.inspeccionUrl!)}>
                Abrir la inspección
              </Boton>
            </div>
          )}
          {resultado.linkDePago && (
            <div className="flex flex-wrap items-center gap-2">
              <span>Enlace para pagar la solicitud:</span>
              <Boton tamano="sm" onClick={() => abrir(resultado.linkDePago!)}>
                Abrir el pago
              </Boton>
            </div>
          )}
        </div>
      </Dialogo>
    )
  }

  return (
    <Dialogo
      abierto
      ancho="lg"
      titulo={`Emitir con ATM — ${emision.descripcionCobertura}`}
      descripcion={`Premio ${enPesos(emision.premio)} · operación ${emision.operacion}. Esto emite de verdad contra ATM y una operación se emite una sola vez: revisá los datos antes de mandar.`}
      alCerrar={alCerrar}
      pie={
        <>
          {opciones && faltan.length > 0 && <span className="mr-auto text-xs text-slate-500">Falta: {faltan.join(', ')}.</span>}
          <Boton onClick={alCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" escribe onClick={() => void emitir()} cargando={enviando} disabled={!puedeEmitir}>
            Emitir
          </Boton>
        </>
      }
    >
      {errorDeCarga ? (
        <Alerta tono="error">{errorDeCarga}</Alerta>
      ) : !opciones ? (
        <Cargando texto="Cargando las listas de ATM…" />
      ) : (
        <div className="flex flex-col gap-5">
          {opciones.faltan.length > 0 && (
            <Alerta tono="error">
              Faltan tablas de ATM para emitir ({opciones.faltan.join(', ')}). Bajalas desde API Aseguradoras → ATM → «Actualizar tablas» y volvé a abrir
              este diálogo.
            </Alerta>
          )}
          {error && <Alerta tono="error">{error}</Alerta>}
          {emision.ceroKm && <Alerta tono="info">Se cotizó como 0 km: si todavía no tiene patente, cargá «A/D» (a declarar).</Alerta>}

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{esFisica ? 'El titular' : 'El titular (persona jurídica)'}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Selector etiqueta="Tipo de documento" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)} opciones={lista(opciones.tiposDeDocumento)} />
              <Campo etiqueta="Número" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
              <div className="col-span-2">
                <Campo etiqueta={esFisica ? 'Apellido y nombre' : 'Razón social'} value={apellido} onChange={(e) => setApellido(e.target.value)} />
              </div>
            </div>
            {esFisica && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Selector etiqueta="Sexo" value={sexo} onChange={(e) => setSexo(e.target.value)} opciones={lista(opciones.sexos)} />
                <Selector etiqueta="Estado civil" value={estadoCivil} onChange={(e) => setEstadoCivil(e.target.value)} opciones={lista(opciones.estadosCiviles)} />
                <Campo etiqueta="Fecha de nacimiento" type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
                <Selector etiqueta="Nacionalidad" value={nacionalidad} onChange={(e) => setNacionalidad(e.target.value)} opciones={lista(opciones.nacionalidades)} />
              </div>
            )}
            {esFisica && esArgentino && (
              <div className="grid grid-cols-2 gap-3">
                <Selector
                  etiqueta="Provincia de nacimiento"
                  value={provinciaNacimiento}
                  onChange={(e) => setProvinciaNacimiento(e.target.value)}
                  opciones={lista(opciones.provincias)}
                />
                <Campo etiqueta="Localidad de nacimiento" value={localidadNacimiento} onChange={(e) => setLocalidadNacimiento(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Selector
                etiqueta={esFisica ? 'Actividad' : 'Actividad (opcional)'}
                value={actividad}
                onChange={(e) => setActividad(e.target.value)}
                opciones={lista(opciones.actividades)}
              />
              {pideCuit && <Campo etiqueta="CUIT" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="Sin guiones" />}
            </div>
            {!esFisica && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Selector
                  etiqueta="Representante: documento"
                  value={representante.tipoDocumento}
                  onChange={(e) => setRepresentante({ ...representante, tipoDocumento: e.target.value })}
                  opciones={lista(opciones.tiposDeDocumento)}
                />
                <Campo etiqueta="Número" value={representante.numeroDocumento} onChange={(e) => setRepresentante({ ...representante, numeroDocumento: e.target.value })} />
                <Campo etiqueta="Apellido" value={representante.apellido} onChange={(e) => setRepresentante({ ...representante, apellido: e.target.value })} />
                <Campo etiqueta="Nombre" value={representante.nombre} onChange={(e) => setRepresentante({ ...representante, nombre: e.target.value })} />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Domicilio y contacto</h3>
            {opciones.localidades.length === 0 ? (
              <Alerta tono="error">Las tablas de ATM no traen localidades para el código postal {emision.codigoPostal}.</Alerta>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Selector
                  etiqueta={`Código postal ${emision.codigoPostal}`}
                  value={String(indiceLocalidad)}
                  onChange={(e) => {
                    const i = Number(e.target.value)
                    setIndiceLocalidad(i)
                    const l = opciones.localidades[i]
                    if (l) setLocalidad(esCapital(l.provincia) ? 'C.A.B.A.' : l.localidad)
                  }}
                  opciones={opciones.localidades.map((l, i) => ({ valor: String(i), texto: `${l.localidad} (${l.provincia})` }))}
                />
                <Campo etiqueta="Localidad" value={localidad} onChange={(e) => setLocalidad(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2">
                <Campo
                  etiqueta="Calle"
                  value={calle}
                  onChange={(e) => setCalle(e.target.value)}
                  list={enCapital ? 'calles-atm' : undefined}
                  ayuda={enCapital ? 'En Capital tiene que ser una calle de las tablas de ATM.' : undefined}
                />
                {enCapital && (
                  <datalist id="calles-atm">
                    {callesDeCapital.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                )}
              </div>
              <Campo etiqueta="Altura" value={altura} onChange={(e) => setAltura(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Piso" value={piso} onChange={(e) => setPiso(e.target.value)} maxLength={5} />
                <Campo etiqueta="Depto" value={depto} onChange={(e) => setDepto(e.target.value)} maxLength={5} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Campo etiqueta="Celular" value={celular} onChange={(e) => setCelular(e.target.value)} />
              <Campo etiqueta="Teléfono fijo (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              <Campo etiqueta="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">El vehículo</h3>
            <div className="grid grid-cols-3 gap-3">
              <Campo etiqueta="Patente" value={patente} onChange={(e) => setPatente(e.target.value.toUpperCase())} />
              <Campo etiqueta="Chasis" value={chasis} onChange={(e) => setChasis(e.target.value.toUpperCase())} maxLength={20} />
              <Campo etiqueta="Motor" value={motor} onChange={(e) => setMotor(e.target.value.toUpperCase())} maxLength={20} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Forma de pago</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Selector
                etiqueta="Forma de pago"
                value={forma}
                onChange={(e) => setForma(e.target.value)}
                opciones={lista(opciones.formasDePago)}
                ayuda={`Se cotizó con ${emision.condicionDePago.toLowerCase()}.`}
              />
              {tipo === 'TARJETA' && (
                <>
                  <Selector etiqueta="Tarjeta" value={tarjeta} onChange={(e) => setTarjeta(e.target.value)} opciones={lista(opciones.tarjetas)} />
                  <Campo etiqueta="Número de tarjeta" value={numeroTarjeta} onChange={(e) => setNumeroTarjeta(e.target.value)} />
                  <Campo etiqueta="Vencimiento" placeholder="MMAAAA" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} maxLength={7} />
                </>
              )}
              {tipo === 'CBU' && (
                <div className="col-span-2">
                  <Campo etiqueta="CBU (22 dígitos; CVU no)" value={cbu} onChange={(e) => setCbu(e.target.value)} />
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Inspección y acreedor</h3>
            <div className="grid grid-cols-2 gap-3">
              <Selector
                etiqueta="Responsable de la inspección"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                opciones={lista(opciones.responsablesDeInspeccion)}
                ayuda="Si hace falta inspección, ATM devuelve el enlace para hacerla."
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={conAcreedor} onChange={(e) => setConAcreedor(e.target.checked)} />
              Tiene acreedor prendario
            </label>
            {conAcreedor && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Selector
                  etiqueta="Acreedor: documento"
                  value={acreedor.tipoDocumento}
                  onChange={(e) => setAcreedor({ ...acreedor, tipoDocumento: e.target.value })}
                  opciones={lista(opciones.tiposDeDocumento)}
                />
                <Campo etiqueta="Número" value={acreedor.numeroDocumento} onChange={(e) => setAcreedor({ ...acreedor, numeroDocumento: e.target.value })} />
                <Campo etiqueta="Apellido" value={acreedor.apellido} onChange={(e) => setAcreedor({ ...acreedor, apellido: e.target.value })} />
                <Campo etiqueta="Nombre" value={acreedor.nombre} onChange={(e) => setAcreedor({ ...acreedor, nombre: e.target.value })} />
              </div>
            )}
          </section>
        </div>
      )}
    </Dialogo>
  )
}
