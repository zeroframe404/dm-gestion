// API Aseguradoras → Mercantil: la cuenta de la API de Mercantil Andina, con la que el multicotizador
// cotiza autos en Mercantil.
//
// Igual que la pestaña de ATM, LA CUENTA VIVE EN CADA COMPUTADORA: Mercantil no exige que los pedidos
// salgan de una IP dada de alta, así que cada PC le habla directo, sin pasar por el VPS. Se carga una
// vez acá, viaja al servidor como el ajuste compartido `mercantilApi` y el resto la adopta al abrir el
// programa: por eso están el renglón de si esta computadora está al día y «Traer del servidor».
//
// Son TRES secretos, y los tres hacen falta (ver la guía de Mercantil en docs/): el usuario y la
// contraseña que Mercantil manda al vincular el código de PAS, y la «subscription key» del portal de
// APIs. Ni la contraseña ni la clave de suscripción vuelven a esta pantalla —el proceso principal no
// las manda— y los campos aparecen siempre vacíos: escribir una nueva la reemplaza, dejarlo vacío
// conserva la que había. De la clave de suscripción se muestra el final, para reconocerla.
import { useCallback, useEffect, useState } from 'react'
import { AMBIENTES_MERCANTIL, NOMBRE_AMBIENTE_MERCANTIL, type AmbienteMercantil, type EstadoDeMercantil, type PruebaDeMercantil } from '../../../shared/tipos'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/** El ambiente dentro de una frase: «la cuenta de producción». */
const AMBIENTE_EN_FRASE: Record<AmbienteMercantil, string> = { produccion: 'producción', desarrollo: 'desarrollo' }

const PORTAL = 'https://apiportal.mercantilandina.com.ar/'

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** El productor sin espacios, como lo guarda el proceso principal. */
function productorLimpio(productor: string): string {
  return productor.replace(/\s/g, '')
}

export function Mercantil() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && (usuario.rol === 'SUPER_ADMIN' || usuario.rol === 'ADMIN')

  const [estado, setEstado] = useState<EstadoDeMercantil | null>(null)
  const [ambiente, setAmbiente] = useState<AmbienteMercantil>('produccion')
  const [usuarioMercantil, setUsuarioMercantil] = useState('')
  const [clave, setClave] = useState('')
  const [claveDeSuscripcion, setClaveDeSuscripcion] = useState('')
  const [productor, setProductor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeMercantil | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo que devuelve el proceso principal pasa a los campos: es lo que quedó guardado de verdad.
  const mostrar = useCallback((datos: EstadoDeMercantil) => {
    setEstado(datos)
    setAmbiente(datos.ambiente)
    setUsuarioMercantil(datos.usuario)
    setProductor(datos.productor)
  }, [])

  const cargar = useCallback(async () => {
    const resultado = await window.dm.mercantil.estado()
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
    // Ni la contraseña ni la clave de suscripción se dejan en memoria más de lo necesario.
    setClave('')
    setClaveDeSuscripcion('')
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.mercantil.guardarCredenciales({ ambiente, usuario: usuarioMercantil, clave, claveDeSuscripcion, productor })
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso(
        resultado.datos.compartido?.error
          ? 'La cuenta se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo. Probá la conexión antes de cotizar.'
          : 'La cuenta de Mercantil quedó guardada y salió para el resto de las computadoras. Probá la conexión antes de cotizar.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    const seguro = window.confirm(
      'Se saca la cuenta de Mercantil de esta computadora y del servidor, y el multicotizador deja de cotizar en Mercantil hasta que se cargue otra. ¿Seguir?',
    )
    if (!seguro) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.mercantil.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      if (resultado.datos.compartido?.enElServidor || resultado.datos.compartido?.error) {
        setError(
          `Se sacó la cuenta de Mercantil de esta computadora, pero el servidor todavía la tiene${resultado.datos.compartido.error ? ` (${resultado.datos.compartido.error})` : ''}. ` +
            'Volvé a tocar «Sacarla»: si no, al abrir el programa esta computadora la vuelve a tomar del servidor.',
        )
      } else {
        setAviso('Se sacó la cuenta de Mercantil de esta computadora y del servidor.')
      }
    } else {
      setError(resultado.error)
    }
  }

  const traer = async () => {
    if (estado?.configurada && !window.confirm('Se reemplaza la cuenta de Mercantil de esta computadora por la que tiene el servidor. ¿Seguir?')) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.mercantil.traerDelServidor()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso('Esta computadora tomó la cuenta de Mercantil que tiene el servidor.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setProbando(true)
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.mercantil.probar()
    setProbando(false)
    if (resultado.ok) {
      setPrueba(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  const compartido = estado.compartido
  const productorInvalido = productorLimpio(productor) !== '' && !/^\d{1,10}$/.test(productorLimpio(productor))
  const faltaUnSecreto = !estado.configurada && (!clave.trim() || !claveDeSuscripcion.trim())
  const puedeTraer = puedeEditar && compartido !== null && compartido.enElServidor && !compartido.alDia && !compartido.error

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Conexión con Mercantil Andina"
        descripcion="Con esto, el multicotizador cotiza autos en Mercantil Andina junto con las demás compañías (la póliza se emite desde la web de Mercantil). Como ATM, Mercantil no pide una IP dada de alta: cada computadora le habla directo con esta cuenta, que se carga una vez acá y el resto adopta al abrir el programa."
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
                disabled={!usuarioMercantil.trim() || faltaUnSecreto || productorInvalido}
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
              {AMBIENTE_EN_FRASE[estado.ambiente]}, clave de suscripción terminada en {estado.finDeClaveDeSuscripcion},{' '}
              {estado.productor ? `productor ${estado.productor}` : 'con el productor asociado al usuario'}.
            </Alerta>
          ) : (
            <Alerta tono="aviso">
              Todavía no hay una cuenta de Mercantil en esta computadora: el multicotizador no cotiza en Mercantil hasta cargarla
              {compartido?.enElServidor ? ' o traer la que tiene el servidor' : ''}.
            </Alerta>
          )}

          <div className="flex flex-col gap-2">
            <EstadoCompartido
              estado={compartido}
              nombre="la cuenta de Mercantil"
              comoSeCarga="La carga un administrador una sola vez y el resto la adopta al abrir el programa."
            />
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
            onChange={(evento) => setAmbiente(evento.target.value as AmbienteMercantil)}
            disabled={!puedeEditar}
            opciones={AMBIENTES_MERCANTIL.map((a) => ({ valor: a, texto: NOMBRE_AMBIENTE_MERCANTIL[a] }))}
            ayuda="Las credenciales de test que manda Mercantil son del ambiente de desarrollo (apidev): lo que cotiza ahí no vale para el cliente. Cuando Mercantil dé las de producción, se cargan acá con el ambiente en Producción."
          />
          <Campo
            etiqueta="Usuario (correo)"
            value={usuarioMercantil}
            onChange={(evento) => setUsuarioMercantil(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="El usuario que mandó Mercantil al vincular el PAS"
            ayuda="El usuario de la API que Mercantil manda por correo cuando vincula el código de PAS (no es el usuario del portal de APIs, que sirve para entrar al portal). Suele ser el correo con el que se pidió."
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
          <CampoClave
            etiqueta="Clave de suscripción del portal (Ocp-Apim-Subscription-Key)"
            value={claveDeSuscripcion}
            onChange={(evento) => setClaveDeSuscripcion(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurada ? `•••••••• (termina en ${estado.finDeClaveDeSuscripcion}; dejala vacía para conservarla)` : ''}
            ayuda={`La «subscription key» que aparece en el Perfil del portal de APIs de Mercantil (${PORTAL}) una vez suscripto a los productos (Automotores). Sin ella el gateway rechaza todo pedido, incluso el del token.`}
            autoComplete="off"
          />
          <Campo
            etiqueta="Código de productor / PAS (opcional)"
            value={productor}
            onChange={(evento) => setProductor(evento.target.value)}
            disabled={!puedeEditar}
            inputMode="numeric"
            placeholder="Vacío = el productor asociado al usuario"
            className="tabular-nums"
            error={productorInvalido ? 'El código de productor de Mercantil es numérico (hasta 10 números).' : null}
            ayuda="El código de PAS con el que se cotiza. Vacío, se cotiza con el que Mercantil asoció al usuario al crearlo. «Probar conexión» muestra cuál es."
            autoComplete="off"
          />

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
                  <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    Productores que Mercantil asocia a esta cuenta
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {prueba.productores.map((candidato) => (
                      <li key={candidato.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-mono tabular-nums text-slate-800">{candidato.codigo}</span>
                          <span className="ml-2 text-slate-600">{candidato.nombre}</span>
                        </span>
                        {productorLimpio(productor) === candidato.codigo ? (
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

          {!puedeEditar && (
            <Alerta tono="info">
              La cuenta de Mercantil la carga un administrador con permiso para editar Administración: vale para todas las computadoras.
            </Alerta>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Cómo se consiguen estos datos (guía de Mercantil)</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Registrarse en el portal de APIs (<code className="rounded bg-white px-1 font-mono text-xs">{PORTAL}</code>), entrar a «Productos» y suscribirse a
                los que hagan falta (Automotores). En «Perfil» queda la clave de suscripción.
              </li>
              <li>
                Pedirle a Mercantil las credenciales de test con el código de PAS a vincular, el nombre, CUIT, correo y teléfono de la agencia, para qué es la
                integración y qué se va a usar (cotización de autos). Mercantil manda el usuario y la contraseña por correo.
              </li>
              <li>Cargar acá las tres cosas con el ambiente en Desarrollo, guardar y «Probar conexión». Con las de producción, lo mismo en Producción.</li>
            </ol>
          </div>
        </div>
      </Tarjeta>
    </div>
  )
}
