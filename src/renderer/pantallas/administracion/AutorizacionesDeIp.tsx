// Administración → Ciberseguridad → Autorizaciones de IP: qué computadoras puede atender el servidor de la agencia.
//
// Es del superadministrador y de nadie más (la pestaña sólo se arma para SUPER_ADMIN, el proceso principal pide el
// rol y el servidor lo vuelve a pedir). Con el control prendido, una computadora que no está en la lista no puede
// ingresar ni conectarse al VPS, aunque tenga un usuario y su contraseña. Lo hace cumplir el SERVIDOR.
//
// Para que nadie se quede afuera por error, el servidor no deja prender el control desde una computadora que no
// está en la lista, ni sacar (con el control prendido) la IP que deja entrar a la computadora desde la que se trabaja.
import { useEffect, useMemo, useState } from 'react'
import { pareceUnaIp, type AutorizacionesIp, type IpAutorizada } from '../../../shared/autorizacionIp'
import { Alerta, Boton, Campo, Cargando, Dialogo, Etiqueta, Tarjeta, fechaCorta } from '../../componentes/ui'

function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function AutorizacionesDeIp() {
  const [estado, setEstado] = useState<AutorizacionesIp | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [ipNueva, setIpNueva] = useState('')
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [errorDelAlta, setErrorDelAlta] = useState<string | null>(null)
  const [aSacar, setASacar] = useState<IpAutorizada | null>(null)
  const [confirmarActivar, setConfirmarActivar] = useState(false)

  useEffect(() => {
    let vigente = true
    void (async () => {
      const resultado = await window.dm.ips.estado()
      if (!vigente) return
      if (resultado.ok) setEstado(resultado.datos)
      else setError(resultado.error)
      setCargando(false)
    })()
    return () => {
      vigente = false
    }
  }, [])

  const filtradas = useMemo(() => {
    const lista = estado?.lista ?? []
    const buscado = normalizarBusqueda(busqueda)
    if (!buscado) return lista
    return lista.filter((fila) => normalizarBusqueda(`${fila.ip} ${fila.nombre} ${fila.creadoPor ?? ''}`).includes(buscado))
  }, [estado, busqueda])

  async function aplicar(accion: () => ReturnType<typeof window.dm.ips.estado>, exito: string): Promise<boolean> {
    setOcupado(true)
    setError(null)
    setAviso(null)
    const resultado = await accion()
    setOcupado(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return false
    }
    setEstado(resultado.datos)
    setAviso(exito)
    return true
  }

  async function autorizar(ip: string, nombre: string): Promise<void> {
    setErrorDelAlta(null)
    if (!pareceUnaIp(ip)) {
      setErrorDelAlta('Eso no es una dirección IP válida (por ejemplo, 192.168.1.46).')
      return
    }
    if (!nombre.trim()) {
      setErrorDelAlta('Poné un nombre para reconocer la computadora (por ejemplo, «PC de caja»).')
      return
    }
    const listo = await aplicar(() => window.dm.ips.autorizar(ip.trim(), nombre.trim()), `Listo: ${ip.trim()} quedó autorizada.`)
    if (listo) {
      setIpNueva('')
      setNombreNuevo('')
    }
  }

  if (cargando) return <Cargando texto="Leyendo las autorizaciones del servidor…" />
  if (!estado) return <Alerta tono="error">{error ?? 'No se pudieron leer las autorizaciones de IP.'}</Alerta>

  const equipo = estado.esteEquipo
  // Las IP de las placas de esta PC que todavía no están en la lista, para autorizarlas con un clic.
  const enLaLista = new Set(estado.lista.map((fila) => fila.ip))
  const propiasSinAutorizar = estado.ipsDeEstaPc.filter((ip) => !enLaLista.has(ip))

  return (
    <div className="flex flex-col gap-6">
      <Tarjeta
        titulo="Autorizaciones de IP"
        descripcion="Opcional. Con el control activado, el servidor de la agencia sólo atiende a las computadoras de esta lista: si alguien se lleva el programa con un usuario y su contraseña, o lo desarma para sacarle la llave, no puede ingresar ni conectarse desde otra computadora."
      >
        <div className="flex flex-col gap-4">
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}
          {estado.apagadaPorElServidor && (
            <Alerta tono="aviso">
              El control está apagado desde el servidor (DMG_IP_CONTROL_APAGADO en el .env del VPS): mientras siga así, no se exige la lista
              aunque acá figure activado.
            </Alerta>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                Control de IP {estado.activa ? <Etiqueta tono="exito">Activado</Etiqueta> : <Etiqueta>Desactivado</Etiqueta>}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {estado.actualizadoPor
                  ? `Último cambio: ${estado.actualizadoPor}${estado.actualizadoEn ? `, ${fechaCorta(estado.actualizadoEn)}` : ''}.`
                  : 'Nunca se activó.'}
              </p>
            </div>
            {estado.activa ? (
              <Boton
                variante="secundario"
                cargando={ocupado}
                onClick={() => void aplicar(() => window.dm.ips.cambiarControl(false), 'Control desactivado: el servidor vuelve a atender a todas las computadoras.')}
              >
                Desactivar
              </Boton>
            ) : (
              <Boton variante="primario" icono="escudo" cargando={ocupado} onClick={() => setConfirmarActivar(true)}>
                Activar
              </Boton>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">Esta computadora</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">IP de sus placas de red</dt>
                <dd className="font-mono text-slate-800">{estado.ipsDeEstaPc.length ? estado.ipsDeEstaPc.join(', ') : 'No se pudieron leer'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">IP pública con que llega al servidor</dt>
                <dd className="font-mono text-slate-800">{equipo.publica || 'No se supo'}</dd>
              </div>
            </dl>
            <p className="mt-2 text-sm">
              {equipo.autorizado ? (
                <span className="text-green-700">Está autorizada (por la IP {equipo.porLaIp}).</span>
              ) : (
                <span className="text-amber-700">No está en la lista: autorizala antes de activar el control.</span>
              )}
            </p>
            {(propiasSinAutorizar.length > 0 || (equipo.publica && !enLaLista.has(equipo.publica))) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {propiasSinAutorizar.map((ip) => (
                  <Boton key={ip} tamano="sm" variante="secundario" icono="mas" onClick={() => setIpNueva(ip)}>
                    Usar {ip}
                  </Boton>
                ))}
                {equipo.publica && !enLaLista.has(equipo.publica) && (
                  <Boton tamano="sm" variante="secundario" icono="mas" onClick={() => setIpNueva(equipo.publica)}>
                    Usar la pública {equipo.publica}
                  </Boton>
                )}
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Autorizar una IP nueva"
        descripcion="La IP de una computadora se ve en Windows con «ipconfig» (Dirección IPv4), o acá mismo, en «Esta computadora», entrando desde esa PC. Una IP pública (la de la sucursal) deja entrar a todas las computadoras de esa red."
      >
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end"
          onSubmit={(evento) => {
            evento.preventDefault()
            void autorizar(ipNueva, nombreNuevo)
          }}
        >
          <Campo
            etiqueta="Dirección IP"
            placeholder="192.168.1.46"
            value={ipNueva}
            onChange={(evento) => setIpNueva(evento.target.value)}
            spellCheck={false}
          />
          <Campo
            etiqueta="Nombre para reconocerla"
            placeholder="PC de caja · Avellaneda"
            maxLength={80}
            value={nombreNuevo}
            onChange={(evento) => setNombreNuevo(evento.target.value)}
          />
          <Boton type="submit" variante="primario" icono="mas" cargando={ocupado}>
            Autorizar
          </Boton>
        </form>
        {errorDelAlta && (
          <div className="mt-3">
            <Alerta tono="error">{errorDelAlta}</Alerta>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo={`IP autorizadas (${estado.lista.length})`}
        descripcion="Las IP internas (192.168…, 169.254…, 10…) se comparan con las de las placas de red de cada computadora; las públicas, con la que ve el servidor."
      >
        <div className="flex flex-col gap-3">
          <Campo
            etiqueta="Buscar"
            placeholder="Buscar por IP o nombre"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
          {filtradas.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {estado.lista.length === 0 ? 'Todavía no hay ninguna IP autorizada.' : 'Ninguna IP coincide con la búsqueda.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-semibold">IP</th>
                    <th className="py-2 pr-3 font-semibold">Nombre</th>
                    <th className="py-2 pr-3 font-semibold">Tipo</th>
                    <th className="py-2 pr-3 font-semibold">Autorizada</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((fila) => (
                    <tr key={fila.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-mono text-slate-900">
                        {fila.ip}
                        {fila.ip === equipo.porLaIp && <span className="ml-2"><Etiqueta tono="marca">Esta PC</Etiqueta></span>}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">{fila.nombre || '—'}</td>
                      <td className="py-2 pr-3">
                        <Etiqueta tono={fila.tipo === 'publica' ? 'aviso' : 'neutro'}>{fila.tipo === 'publica' ? 'Pública' : 'Interna'}</Etiqueta>
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {fechaCorta(fila.creadoEn)}
                        {fila.creadoPor ? ` · ${fila.creadoPor}` : ''}
                      </td>
                      <td className="py-2 text-right">
                        <Boton tamano="sm" variante="peligro" disabled={ocupado} onClick={() => setASacar(fila)}>
                          Desautorizar
                        </Boton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Tarjeta>

      <Dialogo
        abierto={aSacar !== null}
        titulo="Desautorizar una IP"
        alCerrar={() => setASacar(null)}
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setASacar(null)}>
              Cancelar
            </Boton>
            <Boton
              variante="peligro"
              cargando={ocupado}
              onClick={() => {
                const fila = aSacar
                if (!fila) return
                setASacar(null)
                void aplicar(() => window.dm.ips.desautorizar(fila.id), `${fila.ip} ya no está autorizada.`)
              }}
            >
              Desautorizar
            </Boton>
          </>
        }
      >
        {aSacar && (
          <p className="text-sm text-slate-700">
            ¿Sacar <strong className="font-mono">{aSacar.ip}</strong>
            {aSacar.nombre ? ` («${aSacar.nombre}»)` : ''} de la lista? Con el control activado, esa computadora deja de poder usar el programa: si
            tiene la sesión abierta, se le cierra.
          </p>
        )}
      </Dialogo>

      <Dialogo
        abierto={confirmarActivar}
        titulo="Activar el control de IP"
        alCerrar={() => setConfirmarActivar(false)}
        descripcion="Desde ese momento, sólo las computadoras de la lista pueden ingresar y conectarse al servidor. Las que no estén quedan afuera hasta que las autorices."
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setConfirmarActivar(false)}>
              Cancelar
            </Boton>
            <Boton
              variante="primario"
              cargando={ocupado}
              onClick={() => {
                setConfirmarActivar(false)
                void aplicar(() => window.dm.ips.cambiarControl(true), 'Control activado: sólo las computadoras de la lista pueden usar el programa.')
              }}
            >
              Activar
            </Boton>
          </>
        }
      >
        <Alerta tono="aviso">
          Antes de activarlo, todas las computadoras tienen que tener esta versión del programa (o una más nueva). Las versiones anteriores no
          le dicen al servidor la IP de la PC y quedarían afuera, salvo que esté autorizada la IP pública de su sucursal.
        </Alerta>
      </Dialogo>
    </div>
  )
}
