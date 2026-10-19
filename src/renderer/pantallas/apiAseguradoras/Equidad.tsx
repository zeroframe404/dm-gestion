// API Aseguradoras → Equidad: la cuenta de la API GLM de La Equidad, con la que el multicotizador
// cotiza autos en Equidad.
//
// Igual que las pestañas de ATM y Mercantil, LA CUENTA VIVE EN CADA COMPUTADORA: Equidad no exige que
// los pedidos salgan de una IP dada de alta, así que cada PC le habla directo, sin pasar por el VPS.
// Se carga una vez acá, viaja al servidor como el ajuste compartido `equidadApi` y el resto la adopta
// al abrir el programa: por eso están el renglón de si esta computadora está al día y «Traer del
// servidor».
//
// Son DOS pares de credenciales y una dirección (ver la documentación de la API GLM en docs/): la URL
// base del servlet de cada ambiente, el usuario de aplicación con su contraseña (el que se autentica
// en `AutenticarUsuario`) y, si Equidad lo da, el usuario de servicio con la suya (el del
// `Authorization: Basic`). Las contraseñas no vuelven a esta pantalla —el proceso principal no las
// manda— y los campos aparecen siempre vacíos: escribir una nueva la reemplaza, dejarlo vacío conserva
// la que había.
import { useCallback, useEffect, useState } from 'react'
import {
  AMBIENTES_EQUIDAD,
  EMPRESA_EQUIDAD_POR_DEFECTO,
  NOMBRE_AMBIENTE_EQUIDAD,
  RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO,
  type AmbienteEquidad,
  type EstadoDeEquidad,
  type PruebaDeEquidad,
} from '../../../shared/tipos'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/** El ambiente dentro de una frase: «la cuenta de producción». */
const AMBIENTE_EN_FRASE: Record<AmbienteEquidad, string> = { produccion: 'producción', prueba: 'prueba' }

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Un código numérico sin espacios, como lo guarda el proceso principal. */
function codigoLimpio(valor: string): string {
  return valor.replace(/\s/g, '')
}

export function Equidad() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && (usuario.rol === 'SUPER_ADMIN' || usuario.rol === 'ADMIN')

  const [estado, setEstado] = useState<EstadoDeEquidad | null>(null)
  const [ambiente, setAmbiente] = useState<AmbienteEquidad>('produccion')
  const [urlBase, setUrlBase] = useState('')
  const [usuarioEquidad, setUsuarioEquidad] = useState('')
  const [clave, setClave] = useState('')
  const [usuarioDeServicio, setUsuarioDeServicio] = useState('')
  const [claveDeServicio, setClaveDeServicio] = useState('')
  const [productor, setProductor] = useState('')
  const [rama, setRama] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeEquidad | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo que devuelve el proceso principal pasa a los campos: es lo que quedó guardado de verdad.
  const mostrar = useCallback((datos: EstadoDeEquidad) => {
    setEstado(datos)
    setAmbiente(datos.ambiente)
    setUrlBase(datos.urlBase)
    setUsuarioEquidad(datos.usuario)
    setUsuarioDeServicio(datos.usuarioDeServicio)
    setProductor(datos.productor)
    setRama(datos.rama)
    setEmpresa(datos.empresa)
  }, [])

  const cargar = useCallback(async () => {
    const resultado = await window.dm.equidad.estado()
    if (resultado.ok) {
      mostrar(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }, [mostrar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const limpiarSecretos = () => {
    // Las contraseñas no se dejan en memoria más de lo necesario.
    setClave('')
    setClaveDeServicio('')
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.equidad.guardarCredenciales({ ambiente, urlBase, usuario: usuarioEquidad, clave, usuarioDeServicio, claveDeServicio, productor, rama, empresa })
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso(
        resultado.datos.compartido?.error
          ? 'La cuenta se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo. Probá la conexión antes de cotizar.'
          : 'La cuenta de Equidad quedó guardada y salió para el resto de las computadoras. Probá la conexión antes de cotizar.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    const seguro = window.confirm(
      'Se saca la cuenta de Equidad de esta computadora y del servidor, y el multicotizador deja de cotizar en Equidad hasta que se cargue otra. ¿Seguir?',
    )
    if (!seguro) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.equidad.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      if (resultado.datos.compartido?.enElServidor || resultado.datos.compartido?.error) {
        setError(
          `Se sacó la cuenta de Equidad de esta computadora, pero el servidor todavía la tiene${resultado.datos.compartido.error ? ` (${resultado.datos.compartido.error})` : ''}. ` +
            'Volvé a tocar «Sacarla»: si no, al abrir el programa esta computadora la vuelve a tomar del servidor.',
        )
      } else {
        setAviso('Se sacó la cuenta de Equidad de esta computadora y del servidor.')
      }
    } else {
      setError(resultado.error)
    }
  }

  const traer = async () => {
    if (estado?.configurada && !window.confirm('Se reemplaza la cuenta de Equidad de esta computadora por la que tiene el servidor. ¿Seguir?')) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.equidad.traerDelServidor()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso('Esta computadora tomó la cuenta de Equidad que tiene el servidor.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setProbando(true)
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.equidad.probar()
    setProbando(false)
    if (resultado.ok) {
      setPrueba(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  const compartido = estado.compartido
  const productorInvalido = codigoLimpio(productor) !== '' && !/^\d{1,7}$/.test(codigoLimpio(productor))
  const ramaInvalida = codigoLimpio(rama) !== '' && !/^\d{1,2}$/.test(codigoLimpio(rama))
  const empresaInvalida = codigoLimpio(empresa) !== '' && !/^\d{1,2}$/.test(codigoLimpio(empresa))
  const faltaLaClave = !estado.configurada && !clave.trim()
  const faltaLaDeServicio = usuarioDeServicio.trim() !== '' && !claveDeServicio.trim() && !(estado.configurada && estado.usuarioDeServicio === usuarioDeServicio.trim())
  const puedeTraer = puedeEditar && compartido !== null && compartido.enElServidor && !compartido.alDia && !compartido.error

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Conexión con La Equidad"
        descripcion="Con esto, el multicotizador cotiza autos en Equidad junto con las demás compañías (por ahora la póliza se emite desde la web de Equidad). Como ATM y Mercantil, Equidad no pide una IP dada de alta: cada computadora le habla directo con esta cuenta, que se carga una vez acá y el resto adopta al abrir el programa."
        acciones={
          puedeEditar && (
            <>
              {(estado.configurada || estado.compartido?.enElServidor) && (
                <Boton icono="basura" onClick={() => void borrar()} disabled={guardando}>
                  Sacarla
                </Boton>
              )}
              <Boton
                variante="primario"
                icono="ok"
                onClick={() => void guardar()}
                cargando={guardando}
                disabled={!urlBase.trim() || !usuarioEquidad.trim() || faltaLaClave || faltaLaDeServicio || productorInvalido || ramaInvalida || empresaInvalida}
              >
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {estado.configurada ? (
            <Alerta tono="exito">
              Cuenta cargada en esta computadora{estado.actualizadoEn ? ` el ${cuando(estado.actualizadoEn)}` : ''}: usuario {estado.usuario}, ambiente de{' '}
              {AMBIENTE_EN_FRASE[estado.ambiente]} ({estado.urlBase}){estado.usuarioDeServicio ? `, usuario de servicio ${estado.usuarioDeServicio}` : ', sin usuario de servicio'},{' '}
              {estado.productor ? `productor ${estado.productor}` : 'con el productor que lista la API'}, rama {estado.rama}, empresa {estado.empresa}.
            </Alerta>
          ) : (
            <Alerta tono="aviso">
              Todavía no hay una cuenta de Equidad en esta computadora: el multicotizador no cotiza en Equidad hasta cargarla
              {compartido?.enElServidor ? ' o traer la que tiene el servidor' : ''}.
            </Alerta>
          )}

          <div className="flex flex-col gap-2">
            <EstadoCompartido estado={compartido} nombre="la cuenta de Equidad" comoSeCarga="La carga un administrador una sola vez y el resto la adopta al abrir el programa." />
            {puedeTraer && (
              <div className="flex flex-wrap items-center gap-3">
                <Boton icono="nubeBajada" onClick={() => void traer()} disabled={guardando}>
                  Traer del servidor
                </Boton>
                <span className="text-xs text-slate-500">Toma ya la cuenta del servidor, sin esperar a volver a abrir el programa.</span>
              </div>
            )}
          </div>

          <Selector
            etiqueta="Ambiente"
            value={ambiente}
            onChange={(evento) => setAmbiente(evento.target.value as AmbienteEquidad)}
            disabled={!puedeEditar}
            opciones={AMBIENTES_EQUIDAD.map((a) => ({ valor: a, texto: NOMBRE_AMBIENTE_EQUIDAD[a] }))}
            ayuda="El usuario de test que manda Equidad es del ambiente de prueba: lo que cotiza ahí no vale para el cliente. Cuando Equidad dé el de producción, se carga acá con el ambiente en Producción y la URL base de producción."
          />
          <Campo
            etiqueta="URL base de la API (hasta /servlet/)"
            value={urlBase}
            onChange={(evento) => setUrlBase(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="https://servidor.laequidad.com.ar/EQUIDAD/servlet/"
            ayuda="La dirección que da Equidad para el ambiente elegido. En la documentación de la API los ejemplos son del tipo http://servidor/ATM_COM_PRUE/servlet/: lo que va antes del nombre de cada servicio (ar.com.glmsa.seguros…)."
            autoComplete="off"
          />
          <Campo
            etiqueta="Usuario de la API (usuario de aplicación)"
            value={usuarioEquidad}
            onChange={(evento) => setUsuarioEquidad(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="El usuario que manda Equidad"
            ayuda="El usuario con el que la API autentica (AutenticarUsuario). «Probar conexión» muestra el código de usuario que Equidad le asigna; es el que se usa en todas las listas."
            autoComplete="off"
          />
          <CampoClave
            etiqueta="Contraseña"
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurada ? '•••••••• (dejala vacía para conservar la guardada)' : ''}
            ayuda="La contraseña de ese usuario. Se guarda en esta computadora y, cifrada, en el servidor, para que la adopten las demás. Nunca vuelve a esta pantalla."
            autoComplete="off"
          />
          <Campo
            etiqueta="Usuario de servicio (Authorization Basic, si Equidad lo da)"
            value={usuarioDeServicio}
            onChange={(evento) => setUsuarioDeServicio(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="Vacío si Equidad no dio uno"
            ayuda="Algunos servicios de la API GLM piden además un usuario y contraseña de servicio en el encabezado Authorization (Basic). Si Equidad mandó ese par aparte del usuario de la API, va acá; si no, dejalo vacío."
            autoComplete="off"
          />
          <CampoClave
            etiqueta="Contraseña del usuario de servicio"
            value={claveDeServicio}
            onChange={(evento) => setClaveDeServicio(evento.target.value)}
            disabled={!puedeEditar || !usuarioDeServicio.trim()}
            placeholder={estado.configurada && estado.usuarioDeServicio ? '•••••••• (dejala vacía para conservar la guardada)' : ''}
            autoComplete="off"
          />
          <div className="grid gap-4 md:grid-cols-3">
            <Campo
              etiqueta="Código de productor (opcional)"
              value={productor}
              onChange={(evento) => setProductor(evento.target.value)}
              disabled={!puedeEditar}
              inputMode="numeric"
              placeholder="Vacío = el que lista la API"
              className="tabular-nums"
              error={productorInvalido ? 'Es numérico (hasta 7 números).' : null}
              ayuda="El productor con el que se cotiza. Vacío, se usa el que la API lista para el usuario (el primero si hay varios). «Probar conexión» muestra cuáles son."
              autoComplete="off"
            />
            <Campo
              etiqueta="Rama de automotores"
              value={rama}
              onChange={(evento) => setRama(evento.target.value)}
              disabled={!puedeEditar}
              inputMode="numeric"
              placeholder={RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO}
              className="tabular-nums"
              error={ramaInvalida ? 'Es numérica (hasta 2 números).' : null}
              ayuda={`El código de la rama automotor en Equidad (tabla Ramas). Si Equidad no indica otro, ${RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO}. «Probar conexión» lista los tipos de póliza de la rama: si no son de autos, es otra.`}
              autoComplete="off"
            />
            <Campo
              etiqueta="Código de empresa"
              value={empresa}
              onChange={(evento) => setEmpresa(evento.target.value)}
              disabled={!puedeEditar}
              inputMode="numeric"
              placeholder={EMPRESA_EQUIDAD_POR_DEFECTO}
              className="tabular-nums"
              error={empresaInvalida ? 'Es numérico (hasta 2 números).' : null}
              ayuda={`El «EmpCod» que piden varias listas de la API. Si Equidad no indica otro, ${EMPRESA_EQUIDAD_POR_DEFECTO}.`}
              autoComplete="off"
            />
          </div>

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3">
              <Boton icono="enlace" onClick={() => void probar()} cargando={probando} disabled={!estado.configurada}>
                Probar conexión
              </Boton>
              <span className="text-xs text-slate-500">Prueba la cuenta guardada en esta computadora, no lo que está escrito: si cambiaste algo, guardá primero.</span>
            </div>
          )}

          {prueba && (
            <div className="flex flex-col gap-2">
              <Alerta tono={prueba.ok ? 'exito' : 'error'}>{prueba.detalle}</Alerta>
              {prueba.productores.length > 0 && (
                <div className="rounded-xl border border-slate-200">
                  <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Productores que la API lista para este usuario</p>
                  <ul className="divide-y divide-slate-100">
                    {prueba.productores.map((candidato) => (
                      <li key={candidato.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-mono tabular-nums text-slate-800">{candidato.codigo}</span>
                          <span className="ml-2 text-slate-600">{candidato.nombre}</span>
                        </span>
                        {codigoLimpio(productor) === candidato.codigo ? (
                          <Etiqueta tono="exito">En el campo</Etiqueta>
                        ) : (
                          puedeEditar && (
                            <Boton tamano="sm" variante="secundario" onClick={() => setProductor(candidato.codigo)}>
                              Usar este
                            </Boton>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">«Usar este» lo pone en el campo Código de productor; después hay que tocar Guardar.</p>
                </div>
              )}
            </div>
          )}

          {!puedeEditar && <Alerta tono="info">La cuenta de Equidad la carga un administrador con permiso para editar Administración: vale para todas las computadoras.</Alerta>}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Cómo se consiguen estos datos</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Equidad manda la documentación de su API GLM (está en la carpeta docs del programa) y, aparte, el usuario de test con su contraseña y la URL del ambiente de prueba. Si también manda un usuario de servicio, es el del Authorization Basic.</li>
              <li>Cargar acá la URL base y los usuarios con el ambiente en Prueba, guardar y «Probar conexión»: tiene que aceptar el usuario, listar los tipos de póliza de la rama y devolver marcas.</li>
              <li>Con los datos de producción, lo mismo en Producción.</li>
            </ol>
          </div>
        </div>
      </Tarjeta>
    </div>
  )
}
