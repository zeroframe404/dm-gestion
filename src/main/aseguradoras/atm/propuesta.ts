// La emisión de ATM: el método SOAP `AUTOS_Propuesta_PHP` (capítulo 3 del manual, en
// docs/Documentacion ATM.pdf). Convierte una operación ya COTIZADA en propuesta o póliza: no se vuelve
// a cotizar, se manda el número de operación, la cobertura elegida y los datos que la cotización no
// tenía (titular, vehículo, forma de pago).
//
// Lo que dice el manual y conviene tener presente:
// - Todo va adentro de `<auto_prop>`; la respuesta vuelve en otro `<auto_prop>`.
// - Una operación se emite UNA vez: después ATM contesta «La Solicitud no se encuentra en el estado
//   cotizada». Por eso este pedido no se reintenta nunca solo.
// - En autos la inspección la hace Tecnored: se manda sólo el responsable y ATM devuelve la URL del
//   formulario (con urlencode: hay que decodificarla).
import type { DatosDeEmisionAtm, EmisionAtm, PersonaDeAtm } from '../../../shared/tipos'
import { ErrorDeAtm, type ClienteAtm } from './cliente'
import { escaparXml, hijo, hijos, textoDe, type NodoXml } from './xml'

export const METODO_PROPUESTA = 'AUTOS_Propuesta_PHP'

function etiqueta(nombre: string, valor: string | undefined): string {
  if (valor === undefined) return ''
  return valor === '' ? `<${nombre}/>` : `<${nombre}>${escaparXml(valor)}</${nombre}>`
}

/** «2026-10-15» → «15102026» (ddmmAAAA, como pide ATM). Lo que no tenga esa forma va tal cual. */
export function fechaDeNacimientoParaAtm(fecha: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim())
  return partes ? `${partes[3]}${partes[2]}${partes[1]}` : fecha.trim()
}

/** Sólo los dígitos: documentos, CUIT, teléfonos, CBU y tarjeta van numéricos. */
function digitos(valor: string | undefined): string | undefined {
  return valor === undefined ? undefined : valor.replace(/\D/g, '')
}

function persona(nombre: string, p: PersonaDeAtm): string {
  return `<${nombre}>${[
    etiqueta('tipodoc', p.tipoDocumento),
    etiqueta('nrodoc', digitos(p.numeroDocumento)),
    etiqueta('apellido', p.apellido),
    etiqueta('nombre', p.nombre),
  ].join('')}</${nombre}>`
}

/** El `doc_in` del pedido, sin escapar (cliente.ts lo escapa al meterlo en el sobre). */
export function armarPedidoDePropuesta(cuenta: { usuario: string; clave: string }, datos: DatosDeEmisionAtm): string {
  const t = datos.titular
  const esFisica = t.tipoPersona === 'F'
  const opcional = (valor: string | undefined) => (valor?.trim() ? valor.trim() : undefined)
  const titular = [
    etiqueta('tipopersona', t.tipoPersona),
    etiqueta('tipodoc', t.tipoDocumento),
    etiqueta('nrodoc', digitos(t.numeroDocumento)),
    etiqueta('apellido', t.apellido),
    etiqueta('provincia', t.codigoProvincia),
    etiqueta('localidad', t.localidad),
    etiqueta('calle', t.calle),
    etiqueta('altura', t.altura),
    etiqueta('piso', t.piso?.trim() ?? ''),
    etiqueta('depto', t.depto?.trim() ?? ''),
    etiqueta('cp', t.codigoPostal),
    etiqueta('sub_cp', opcional(t.subCodigoPostal)),
    etiqueta('tel_part', digitos(opcional(t.telefono))),
    etiqueta('tel_cel', digitos(opcional(t.celular))),
    esFisica ? etiqueta('sexo', t.sexo) : '',
    esFisica ? etiqueta('est_civil', t.estadoCivil) : '',
    esFisica ? etiqueta('nacionalidad', t.nacionalidad) : '',
    etiqueta('actividad', opcional(t.actividad)),
    esFisica ? etiqueta('cuit', digitos(opcional(t.cuit))) : '',
    etiqueta('mail', t.email),
    esFisica ? etiqueta('prov_nac', opcional(t.provinciaNacimiento)) : '',
    esFisica ? etiqueta('loc_nac', opcional(t.localidadNacimiento)) : '',
    esFisica && t.fechaNacimiento ? etiqueta('fec_nac', fechaDeNacimientoParaAtm(t.fechaNacimiento)) : '',
    !esFisica && t.representante ? persona('representante', t.representante) : '',
  ].join('')

  const pago = datos.formaDePago
  const formaDePago = [
    etiqueta('forma', pago.forma),
    pago.cbu !== undefined ? `<cbu>${etiqueta('numero', digitos(pago.cbu))}</cbu>` : '',
    pago.tarjeta
      ? `<tarjeta>${[
          etiqueta('nombre', pago.tarjeta.codigo),
          etiqueta('numero', digitos(pago.tarjeta.numero)),
          etiqueta('vcto', digitos(pago.tarjeta.vencimiento)),
        ].join('')}</tarjeta>`
      : '',
  ].join('')

  return [
    '<auto_prop>',
    `<usuario>${etiqueta('usa', cuenta.usuario)}${etiqueta('pass', cuenta.clave)}</usuario>`,
    `<propuesta>${[etiqueta('operacion', datos.operacion), etiqueta('cobertura', datos.cobertura), etiqueta('cond_pago', datos.condicionDePago)].join('')}</propuesta>`,
    `<titular>${titular}</titular>`,
    `<vehiculo>${[
      etiqueta('patente', datos.vehiculo.patente.trim().toUpperCase().replace(/\s+/g, '')),
      etiqueta('chasis', datos.vehiculo.chasis.trim().toUpperCase()),
      etiqueta('motor', datos.vehiculo.motor.trim().toUpperCase()),
    ].join('')}</vehiculo>`,
    `<formapago>${formaDePago}</formapago>`,
    datos.acreedor ? persona('acreedor', datos.acreedor) : '',
    // En autos la inspección es de Tecnored: el manual recomienda mandar sólo el responsable.
    datos.responsableInspeccion ? `<inspeccion>${etiqueta('responsable', datos.responsableInspeccion)}</inspeccion>` : '',
    '</auto_prop>',
  ].join('')
}

/** `decodeURIComponent` sin tirar: si la URL no venía codificada, queda como vino. */
function urlDecodificada(valor: string): string | null {
  const limpio = valor.trim()
  if (!limpio) return null
  try {
    return decodeURIComponent(limpio.replace(/\+/g, '%20'))
  } catch {
    return limpio
  }
}

/** Los `<msg>` de un `statusText` (o su texto suelto). */
function mensajes(nodo: NodoXml | undefined): string[] {
  const lista = hijos(nodo, 'msg')
    .map((msg) => msg.texto.trim())
    .filter(Boolean)
  if (lista.length === 0 && nodo?.texto.trim()) lista.push(nodo.texto.trim())
  return lista
}

/** La respuesta aceptada, o `ErrorDeAtm` con los motivos del rechazo. */
export function leerRespuestaDePropuesta(respuesta: NodoXml): EmisionAtm {
  const ok = textoDe(respuesta, 'statusSuccess').toUpperCase() === 'TRUE'
  if (!ok) {
    const motivos = mensajes(hijo(respuesta, 'statusText'))
    throw new ErrorDeAtm(`ATM no emitió: ${motivos.join(' · ') || 'no dio el motivo'}.`, false)
  }
  const inspeccionOk = textoDe(respuesta, 'statusSuccessInspeccion').toUpperCase()
  const avisoDeInspeccion = inspeccionOk === 'FALSE' ? mensajes(hijo(respuesta, 'statusTextInspeccion')).join(' · ') || 'ATM no aceptó la inspección.' : null
  const opcional = (nombre: string) => textoDe(respuesta, nombre) || null
  return {
    operacion: textoDe(respuesta, 'operacion'),
    estado: textoDe(respuesta, 'statusText').toUpperCase(),
    propuesta: opcional('npropuesta'),
    poliza: opcional('npoliza'),
    inspeccionUrl: urlDecodificada(textoDe(respuesta, 'InspeccionUrl')),
    inspeccionNumero: opcional('InspeccionNroTecnored') ?? opcional('InspeccionNroWeb'),
    linkDePago: urlDecodificada(textoDe(respuesta, 'LinkPago')),
    avisoDeInspeccion,
  }
}

export async function emitirPropuestaAtm(cliente: ClienteAtm, datos: DatosDeEmisionAtm): Promise<EmisionAtm> {
  return leerRespuestaDePropuesta(await cliente.soap(METODO_PROPUESTA, armarPedidoDePropuesta(cliente.cuenta, datos)))
}
