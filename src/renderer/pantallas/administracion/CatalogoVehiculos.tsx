// Administración → Catálogo de vehículos: el proveedor, sus credenciales y la bajada del catálogo.
//
// Es lo que hace que el formulario de póliza pueda ofrecer marca, modelo, línea y año en desplegables
// en vez de pedirlos escritos, y que la categoría —pick-up, SUV, furgón— la decida el catálogo y no
// quien está cargando.
//
// Desde la v12.2 las credenciales no son de cada computadora: el superadministrador las carga una vez
// y viajan al VPS, y el resto de las máquinas las adopta al abrir el programa. Por eso la pantalla
// tiene dos tarjetas separadas y en este orden: primero QUÉ está cargado, después CÓMO está el resto
// de la agencia, y al final la copia local, que es lo único que sigue siendo de esta computadora.
//
// La bajada trae decenas de miles de filas y tarda: por eso hay barra de progreso. Se hace una vez y
// después el mostrador trabaja siempre contra la copia local, incluso sin internet.
import { useCallback, useEffect, useState } from 'react'
import {
  ETIQUETAS_DE_CREDENCIAL,
  NOMBRE_PROVEEDOR_CATALOGO,
  NOMBRE_TIPO_VEHICULO,
  PROVEEDORES_DE_CATALOGO,
  type EstadoDeAjusteCompartido,
  type EstadoDelCatalogo,
  type ProgresoDeCatalogo,
  type ProveedorDeCatalogo,
  type PruebaDelProveedor,
  type TipoDeVehiculo,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/** Pasados estos días el catálogo se marca viejo: los modelos nuevos salen todo el año. */
const DIAS_ANTES_DE_ENVEJECER = 30

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

function estaViejo(iso: string | null): boolean {
  if (!iso) return false
  const fecha = new Date(iso).getTime()
  if (Number.isNaN(fecha)) return false
  return Date.now() - fecha > DIAS_ANTES_DE_ENVEJECER * 24 * 60 * 60 * 1000
}

export function CatalogoVehiculos() {
  const usuarioActual = useUsuarioActual()
  const esSuperAdmin = usuarioActual.rol === 'SUPER_ADMIN'
  // Las credenciales las carga SÓLO el superadministrador. Antes un administrador podía cargarlas en
  // su computadora sin publicarlas, y eso era exactamente el problema que se quería sacar: una máquina
  // con credenciales distintas a las de las otras cuatro, sin que nadie se entere.
  const puedeEditar = usePuedeEditar('administracion') && esSuperAdmin
  const [estado, setEstado] = useState<EstadoDelCatalogo | null>(null)
  const [compartido, setCompartido] = useState<EstadoDeAjusteCompartido | null>(null)
  const [proveedor, setProveedor] = useState<ProveedorDeCatalogo>('INFOAUTO')
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [urlFuente, setUrlFuente] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [progreso, setProgreso] = useState<ProgresoDeCatalogo | null>(null)
  const [prueba, setPrueba] = useState<PruebaDelProveedor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.vehiculos.estado()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setUsuario(resultado.datos.usuario)
      setProveedor(resultado.datos.proveedorId)
      setUrlFuente(resultado.datos.urlFuente ?? '')
    } else {
      setError(resultado.error)
    }
  }, [])

  // El estado del servidor va aparte y después: sale a la red, y la pantalla tiene que dibujarse ya.
  const cargarCompartido = useCallback(async () => {
    const resultado = await window.dm.vehiculos.estadoCompartido()
    if (resultado.ok) setCompartido(resultado.datos)
  }, [])

  useEffect(() => {
    void cargar()
    void cargarCompartido()
    // El avance llega del proceso principal: son decenas de miles de filas y no puede parecer colgado.
    return window.dm.vehiculos.alProgresar(setProgreso)
  }, [cargar, cargarCompartido])

  const etiquetas = ETIQUETAS_DE_CREDENCIAL[proveedor]
  const esMercadoLibre = proveedor === 'MERCADO_LIBRE'
  const esDnrpa = proveedor === 'DNRPA'
  // Con un Access Token pegado alcanza para que Mercado Libre conteste: ahí el App ID es opcional.
  // DNRPA no pide nada: elegirlo ya alcanza para guardar.
  const puedeGuardar =
    esDnrpa || usuario.trim() !== '' || (esMercadoLibre && (accessToken.trim() !== '' || estado?.tokenCargado === true))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.vehiculos.guardarCredenciales({
      proveedor,
      usuario,
      clave,
      accessToken: esMercadoLibre ? accessToken : '',
      urlFuente: esDnrpa ? urlFuente : '',
    })
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos.estado)
      setCompartido(resultado.datos.compartido)
      setClave('')
      setAccessToken('')
      setAviso(`${resultado.datos.detalle} Probá la conexión y después bajá el catálogo.`)
    } else {
      setError(resultado.error)
    }
  }

  const publicar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.vehiculos.publicar()
    setGuardando(false)
    if (resultado.ok) {
      setCompartido(resultado.datos)
      setAviso('Mandadas al servidor. El resto de las computadoras las va a tomar al abrir el programa.')
    } else {
      setError(resultado.error)
    }
  }

  const adoptar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.vehiculos.adoptar()
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos.estado)
      setCompartido(resultado.datos.compartido)
      setUsuario(resultado.datos.estado.usuario)
      setProveedor(resultado.datos.estado.proveedorId)
      setUrlFuente(resultado.datos.estado.urlFuente ?? '')
      setAviso(resultado.datos.detalle)
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async (tambienDelServidor: boolean) => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.vehiculos.borrarCredenciales(tambienDelServidor)
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos.estado)
      setCompartido(resultado.datos.compartido)
      setUsuario('')
      setClave('')
      setAccessToken('')
      setUrlFuente('')
      setAviso(
        tambienDelServidor
          ? 'Se sacaron las credenciales de esta computadora y del servidor. Lo ya bajado sigue estando.'
          : 'Se sacaron las credenciales del catálogo de esta computadora. Lo ya bajado sigue estando.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.vehiculos.probar()
    if (resultado.ok) setPrueba(resultado.datos)
    else setError(resultado.error)
  }

  const refrescar = async (tipo: TipoDeVehiculo | null) => {
    setRefrescando(true)
    setError(null)
    setAviso(null)
    setProgreso(null)
    const resultado = await window.dm.vehiculos.refrescar(tipo)
    setRefrescando(false)
    setProgreso(null)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAviso('Catálogo actualizado.')
    } else {
      setError(resultado.error)
    }
    await cargar()
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo={`Catálogo de vehículos (${estado.proveedor})`}
        descripcion="Con esto el alta de una póliza ofrece marca, modelo, línea y año en listas en vez de pedirlos escritos, y la categoría —pick-up, SUV, furgón, camión— la decide el catálogo y no quien está cargando."
        acciones={
          puedeEditar && (
            <>
              {estado.configurado && (
                <Boton icono="basura" onClick={() => void borrar(false)} disabled={guardando || refrescando}>
                  Sacarlas
                </Boton>
              )}
              <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!puedeGuardar}>
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {!estado.configurado && (
            <Alerta tono="aviso">
              Todavía no están cargadas las credenciales. Sin ellas el catálogo no se puede bajar, y el alta de pólizas sigue
              pidiendo la marca y el modelo escritos a mano, como siempre.
            </Alerta>
          )}

          <Selector
            etiqueta="Proveedor"
            value={proveedor}
            onChange={(evento) => {
              setProveedor(evento.target.value as ProveedorDeCatalogo)
              // Las credenciales de uno no sirven en el otro: se limpian los tres campos para que
              // nadie guarde sin querer el App ID de Mercado Libre como usuario de InfoAuto. Volver
              // al proveedor anterior vuelve a mostrar lo guardado en cuanto se recarga la pantalla.
              setUsuario('')
              setClave('')
              setAccessToken('')
              setUrlFuente('')
              setPrueba(null)
            }}
            disabled={!puedeEditar}
            opciones={PROVEEDORES_DE_CATALOGO.map((id) => ({ valor: id, texto: NOMBRE_PROVEEDOR_CATALOGO[id] }))}
            ayuda="Se usa uno solo. Los códigos de marca y de modelo de cada proveedor no tienen nada que ver entre sí, así que cambiar de proveedor obliga a volver a bajar el catálogo."
          />

          {esDnrpa ? (
            <>
              <Campo
                etiqueta="URL de origen (avanzado, opcional)"
                value={urlFuente}
                onChange={(evento) => setUrlFuente(evento.target.value)}
                disabled={!puedeEditar}
                placeholder="Dejalo vacío para detectar sola la tabla vigente"
                ayuda="El programa busca solo la tabla vigente en dnrpa.gov.ar. Usá esto sólo si la detección automática deja de encontrarla: pegá acá la URL directa del PDF."
                autoComplete="off"
              />
              <Alerta tono="info">
                La DNRPA publica gratis, sin usuario ni clave, la Tabla de Valuación de Automotores y Motovehículos: cubre{' '}
                <strong>autos y motos</strong>. No trae precio de lista —no se usa en el programa— y los años que ofrece son
                los que muestra la tabla vigente para esa versión.
              </Alerta>
            </>
          ) : (
            <>
              <Campo
                etiqueta={etiquetas.usuario}
                value={usuario}
                onChange={(evento) => setUsuario(evento.target.value)}
                disabled={!puedeEditar}
                ayuda={etiquetas.ayuda}
                autoComplete="off"
              />
              <CampoClave
                etiqueta={etiquetas.clave}
                value={clave}
                onChange={(evento) => setClave(evento.target.value)}
                disabled={!puedeEditar}
                placeholder={estado.configurado ? '•••••••• (dejala vacía para no cambiarla)' : ''}
                autoComplete="off"
              />

              {esMercadoLibre && (
                <>
                  <CampoClave
                    etiqueta="Access Token (opcional)"
                    value={accessToken}
                    onChange={(evento) => setAccessToken(evento.target.value)}
                    disabled={!puedeEditar}
                    placeholder={estado.tokenCargado ? '•••••••• (hay uno cargado; dejalo vacío para no cambiarlo)' : 'APP_USR-…'}
                    ayuda="El que muestra Mercado Pago en «Credenciales de producción». Es el camino corto para probar, pero vence: con App ID y Clave secreta el permiso se renueva solo."
                    autoComplete="off"
                  />
                  <Alerta tono="info">
                    Mercado Libre publica por esta API el catálogo de <strong>autos y camionetas</strong> únicamente: el de motos
                    no está disponible. Tampoco trae los años de fabricación ni el precio de lista, así que el año se elige de
                    la ventana de siempre. Para motos hace falta InfoAuto o DNRPA.
                  </Alerta>
                </>
              )}
            </>
          )}

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3">
              <Boton icono="enlace" onClick={() => void probar()} disabled={!estado.configurado || refrescando}>
                Probar la conexión
              </Boton>
              {prueba && (
                <span className={prueba.ok ? 'text-sm text-green-700' : 'text-sm text-red-700'}>
                  {prueba.detalle}
                  {prueba.ok && prueba.marcasEncontradas > 0 ? ` (${prueba.marcasEncontradas} marcas)` : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Las mismas credenciales en todas las computadoras"
        descripcion="El superadministrador las carga una vez y quedan guardadas en el servidor de la agencia. El resto de las máquinas las toma sola al abrir el programa, sin que nadie tenga que ir a cargarlas una por una."
        acciones={
          puedeEditar && (
            <>
              <Boton icono="descargar" onClick={() => void adoptar()} disabled={guardando || refrescando}>
                Traer las del servidor
              </Boton>
              {esSuperAdmin && (
                <Boton
                  variante="primario"
                  icono="subir"
                  onClick={() => void publicar()}
                  cargando={guardando}
                  disabled={!estado.configurado || refrescando}
                >
                  Mandar al servidor
                </Boton>
              )}
            </>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {compartido === null ? (
            <p className="text-sm text-slate-500">Consultando el servidor…</p>
          ) : compartido.error ? (
            <Alerta tono="aviso">
              No se pudo hablar con el servidor: {compartido.error} Las credenciales de esta computadora siguen funcionando
              igual; volvé a intentarlo cuando haya conexión.
            </Alerta>
          ) : !compartido.enElServidor ? (
            <Alerta tono="aviso">
              El servidor todavía no tiene credenciales guardadas. Mientras no las tenga, cada computadora usa las suyas y hay
              que cargarlas una por una.
            </Alerta>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                {compartido.alDia ? (
                  <Etiqueta tono="exito">Esta computadora está al día</Etiqueta>
                ) : (
                  <Etiqueta tono="aviso">Esta computadora tiene otras credenciales</Etiqueta>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                En el servidor desde {cuando(compartido.actualizadoEn)}
                {compartido.actualizadoPor ? `, cargadas por ${compartido.actualizadoPor}` : ''}.
              </p>
              {!compartido.alDia && (
                <p className="mt-1 text-xs text-slate-600">
                  Con «Traer las del servidor» esta computadora se queda con las que cargó el superadministrador.
                </p>
              )}
            </div>
          )}

          {esSuperAdmin && compartido?.enElServidor && puedeEditar && (
            <button
              type="button"
              onClick={() => void borrar(true)}
              disabled={guardando || refrescando}
              className="self-start text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
            >
              Sacarlas también del servidor
            </button>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            En el servidor se guardan cifradas. En esta computadora quedan en{' '}
            <code className="font-mono text-[11px]">{estado.rutaDeConfig}</code>, que no se sincroniza ni sale en los
            respaldos.
          </p>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="La copia local"
        descripcion="Los desplegables del formulario salen siempre de acá y nunca de internet: elegir un vehículo tiene que ser instantáneo y tiene que andar aunque se corte la conexión. Se baja una vez y se refresca de vez en cuando."
        acciones={
          puedeEditar && (
            <Boton
              variante="primario"
              icono="refrescar"
              onClick={() => void refrescar(null)}
              cargando={refrescando}
              disabled={!estado.configurado}
            >
              Refrescar todo
            </Boton>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {refrescando && (
            <div className="rounded-xl border border-marino-200 bg-marino-50 px-4 py-3">
              <p className="text-sm font-semibold text-marino-900">
                Bajando el catálogo de {progreso ? NOMBRE_TIPO_VEHICULO[progreso.tipo] : 'vehículos'}…
              </p>
              <p className="mt-0.5 text-xs text-marino-800">{progreso?.detalle ?? 'Conectando…'}</p>
              {progreso && progreso.totales > 0 && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-marino-200">
                    <div
                      className="h-full rounded-full bg-marino-600 transition-all"
                      style={{ width: `${Math.min(100, Math.round((progreso.hechas / progreso.totales) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-marino-700">
                    {progreso.hechas} de {progreso.totales}
                  </p>
                </>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-marino-700">
                Son decenas de miles de versiones: puede tardar varios minutos. Se puede seguir usando el programa mientras tanto.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {estado.porTipo.map((tipo) => {
              const loSirve = estado.tiposQueSirve.includes(tipo.tipo)
              return (
                <div key={tipo.tipo} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-bold text-slate-900">{NOMBRE_TIPO_VEHICULO[tipo.tipo]}</p>
                    {tipo.lineas > 0 ? (
                      estaViejo(tipo.refrescadoEn) ? (
                        <Etiqueta tono="aviso">Conviene refrescarlo</Etiqueta>
                      ) : (
                        <Etiqueta tono="exito">Al día</Etiqueta>
                      )
                    ) : loSirve ? (
                      <Etiqueta tono="neutro">Sin bajar</Etiqueta>
                    ) : (
                      <Etiqueta tono="neutro">No lo da {estado.proveedor}</Etiqueta>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Marcas</dt>
                      <dd className="tabular-nums font-semibold text-slate-800">{tipo.marcas.toLocaleString('es-AR')}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Modelos</dt>
                      <dd className="tabular-nums font-semibold text-slate-800">{tipo.modelos.toLocaleString('es-AR')}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Versiones</dt>
                      <dd className="tabular-nums font-semibold text-slate-800">{tipo.lineas.toLocaleString('es-AR')}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-slate-500">Se bajó: {cuando(tipo.refrescadoEn)}</p>
                  {tipo.ultimoError && <p className="mt-1 text-[11px] text-red-700">{tipo.ultimoError}</p>}
                  {puedeEditar && estado.configurado && loSirve && (
                    <button
                      type="button"
                      onClick={() => void refrescar(tipo.tipo)}
                      disabled={refrescando}
                      className="mt-2 text-xs font-semibold text-marino-700 hover:underline disabled:opacity-50"
                    >
                      Refrescar sólo {NOMBRE_TIPO_VEHICULO[tipo.tipo].toLowerCase()}s
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            La agencia puede tener contratada una sola mitad del catálogo. Si una de las dos falla, la otra se baja igual y acá
            queda escrito el motivo. Las pólizas que ya están cargadas no se tocan: siguen con su marca y su modelo tal como se
            escribieron, y sólo se completan si alguien vuelve a elegir ese vehículo del catálogo.
          </p>
        </div>
      </Tarjeta>
    </div>
  )
}
