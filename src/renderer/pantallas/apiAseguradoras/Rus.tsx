// API Aseguradoras → RUS: la cuenta de la API v2 de Río Uruguay Seguros, con la que el multicotizador
// cotiza autos y motos en RUS.
//
// Igual que las pestañas de ATM, Mercantil y Equidad, LA CUENTA VIVE EN CADA COMPUTADORA: RUS no exige que
// los pedidos salgan de una IP dada de alta, así que cada PC le habla directo, sin pasar por el VPS. Se
// carga una vez acá, viaja al servidor como el ajuste compartido `rusApi` y el resto la adopta al abrir el
// programa: por eso están el renglón de si esta computadora está al día y «Traer del servidor».
//
// Son TRES secretos (ver la documentación de RUS): la API-Key que da el equipo de integraciones, y el
// usuario y la contraseña del PAS. Más el código de productor, que RUS pide en cada cotización. Ni la
// contraseña ni la API-Key vuelven a esta pantalla —el proceso principal no las manda— y los campos
// aparecen siempre vacíos: escribir una nueva la reemplaza, dejarlo vacío conserva la que había. De la
// API-Key se muestra el final, para reconocerla.
import { useCallback, useEffect, useState } from 'react'
import { AMBIENTES_RUS, NOMBRE_AMBIENTE_RUS, type AmbienteRus, type EstadoDeRus, type PruebaDeRus } from '../../../shared/tipos'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Alerta, Boton, Campo, CampoClave, Cargando, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/** El ambiente dentro de una frase: «la cuenta de producción». */
const AMBIENTE_EN_FRASE: Record<AmbienteRus, string> = { produccion: 'producción', sandbox: 'sandbox' }

const CORREO_DE_INTEGRACIONES = 'integraciones@riouruguay.com.ar'

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Un código sin espacios, como lo guarda el proceso principal. */
function sinEspacios(valor: string): string {
  return valor.replace(/\s/g, '')
}

export function Rus() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && (usuario.rol === 'SUPER_ADMIN' || usuario.rol === 'ADMIN')

  const [estado, setEstado] = useState<EstadoDeRus | null>(null)
  const [ambiente, setAmbiente] = useState<AmbienteRus>('produccion')
  const [usuarioRus, setUsuarioRus] = useState('')
  const [clave, setClave] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [productor, setProductor] = useState('')
  const [solicitante, setSolicitante] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeRus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo que devuelve el proceso principal pasa a los campos: es lo que quedó guardado de verdad.
  const mostrar = useCallback((datos: EstadoDeRus) => {
    setEstado(datos)
    setAmbiente(datos.ambiente)
    setUsuarioRus(datos.usuario)
    setProductor(datos.productor)
    setSolicitante(datos.solicitante)
  }, [])

  const cargar = useCallback(async () => {
    const resultado = await window.dm.rus.estado()
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
    // Ni la contraseña ni la API-Key se dejan en memoria más de lo necesario.
    setClave('')
    setApiKey('')
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.rus.guardarCredenciales({ ambiente, usuario: usuarioRus, clave, apiKey, productor, solicitante })
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso(
        resultado.datos.compartido?.error
          ? 'La cuenta se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo. Probá la conexión antes de cotizar.'
          : 'La cuenta de RUS quedó guardada y salió para el resto de las computadoras. Probá la conexión antes de cotizar.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    const seguro = window.confirm(
      'Se saca la cuenta de RUS de esta computadora y del servidor, y el multicotizador deja de cotizar en Río Uruguay hasta que se cargue otra. ¿Seguir?',
    )
    if (!seguro) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.rus.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      if (resultado.datos.compartido?.enElServidor || resultado.datos.compartido?.error) {
        setError(
          `Se sacó la cuenta de RUS de esta computadora, pero el servidor todavía la tiene${resultado.datos.compartido.error ? ` (${resultado.datos.compartido.error})` : ''}. ` +
            'Volvé a tocar «Sacarla»: si no, al abrir el programa esta computadora la vuelve a tomar del servidor.',
        )
      } else {
        setAviso('Se sacó la cuenta de RUS de esta computadora y del servidor.')
      }
    } else {
      setError(resultado.error)
    }
  }

  const traer = async () => {
    if (estado?.configurada && !window.confirm('Se reemplaza la cuenta de RUS de esta computadora por la que tiene el servidor. ¿Seguir?')) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.rus.traerDelServidor()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      limpiarSecretos()
      setAviso('Esta computadora tomó la cuenta de RUS que tiene el servidor.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setProbando(true)
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.rus.probar()
    setProbando(false)
    if (resultado.ok) {
      setPrueba(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  const compartido = estado.compartido
  const productorInvalido = sinEspacios(productor) !== '' && !/^\d{1,10}$/.test(sinEspacios(productor))
  const solicitanteInvalido = sinEspacios(solicitante) !== '' && !/^\d{1,10}$/.test(sinEspacios(solicitante))
  const faltaUnSecreto = !estado.configurada && (!clave.trim() || !apiKey.trim())
  const puedeTraer = puedeEditar && compartido !== null && compartido.enElServidor && !compartido.alDia && !compartido.error

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Conexión con Río Uruguay Seguros (RUS)"
        descripcion="Con esto, el multicotizador cotiza autos y motos en Río Uruguay junto con las demás compañías (la póliza se emite desde la web de RUS). Como ATM y Mercantil, RUS no pide una IP dada de alta: cada computadora le habla directo con esta cuenta, que se carga una vez acá y el resto adopta al abrir el programa."
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
                disabled={!usuarioRus.trim() || faltaUnSecreto || !sinEspacios(productor) || productorInvalido || solicitanteInvalido}
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
              {AMBIENTE_EN_FRASE[estado.ambiente]}, API-Key terminada en {estado.finDeApiKey}, productor {estado.productor}
              {estado.solicitante && estado.solicitante !== estado.productor ? ` (solicitante ${estado.solicitante})` : ''}.
            </Alerta>
          ) : (
            <Alerta tono="aviso">
              Todavía no hay una cuenta de RUS en esta computadora: el multicotizador no cotiza en Río Uruguay hasta cargarla
              {compartido?.enElServidor ? ' o traer la que tiene el servidor' : ''}.
            </Alerta>
          )}

          <div className="flex flex-col gap-2">
            <EstadoCompartido
              estado={compartido}
              nombre="la cuenta de RUS"
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
            onChange={(evento) => setAmbiente(evento.target.value as AmbienteRus)}
            disabled={!puedeEditar}
            opciones={AMBIENTES_RUS.map((a) => ({ valor: a, texto: NOMBRE_AMBIENTE_RUS[a] }))}
            ayuda="RUS da una API-Key para cada ambiente. En sandbox se prueba todo lo que haga falta, pero lo que cotiza ahí no vale para el cliente; con la API-Key de producción, se carga acá con el ambiente en Producción."
          />
          <CampoClave
            etiqueta="API-Key (x-api-key)"
            value={apiKey}
            onChange={(evento) => setApiKey(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurada ? `•••••••• (termina en ${estado.finDeApiKey}; dejala vacía para conservarla)` : ''}
            ayuda={`La llave que manda el equipo de integraciones de RUS (${CORREO_DE_INTEGRACIONES}) para el ambiente elegido. Viaja en cada pedido; sin ella RUS rechaza todo, incluso el del token.`}
            autoComplete="off"
          />
          <Campo
            etiqueta="Usuario del PAS"
            value={usuarioRus}
            onChange={(evento) => setUsuarioRus(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="El usuario de API que RUS dio para el productor (p. ej. 12345678ws)"
            ayuda="El usuario del PAS (u organizador) con el que se opera en la API. No es el de la web de productores: RUS lo da aparte, junto con la API-Key."
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
            etiqueta="Código de productor"
            value={productor}
            onChange={(evento) => setProductor(evento.target.value)}
            disabled={!puedeEditar}
            inputMode="numeric"
            placeholder="El código de PAS en RUS"
            className="tabular-nums"
            error={productorInvalido ? 'El código de productor de RUS es numérico (hasta 10 números).' : null}
            ayuda="El código del productor que emitiría la propuesta. RUS lo pide en cada cotización (codigoProductor)."
            autoComplete="off"
          />
          <Campo
            etiqueta="Código de productor solicitante (opcional)"
            value={solicitante}
            onChange={(evento) => setSolicitante(evento.target.value)}
            disabled={!puedeEditar}
            inputMode="numeric"
            placeholder="Vacío = el mismo productor"
            className="tabular-nums"
            error={solicitanteInvalido ? 'El código de productor solicitante es numérico (hasta 10 números).' : null}
            ayuda="Si cotiza un organizador por cuenta de un productor, el código del que pide (codigoSolicitante). Casi siempre es el mismo productor: dejalo vacío."
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

          {prueba && <Alerta tono={prueba.ok ? 'exito' : 'error'}>{prueba.detalle}</Alerta>}

          {!puedeEditar && (
            <Alerta tono="info">La cuenta de RUS la carga un administrador con permiso para editar Administración: vale para todas las computadoras.</Alerta>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Cómo se consiguen estos datos (guía de RUS)</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Escribirle al equipo de integraciones de RUS (<code className="rounded bg-white px-1 font-mono text-xs">{CORREO_DE_INTEGRACIONES}</code>) contando qué se
                quiere hacer (cotizar autos y motos desde el sistema de la agencia). Suelen proponer una reunión inicial.
              </li>
              <li>Pedirles la API-Key (una para sandbox y otra para producción) y el usuario de API del PAS con el que se va a operar.</li>
              <li>Cargar acá las tres cosas y el código de productor con el ambiente en Sandbox, guardar y «Probar conexión». Con las de producción, lo mismo en Producción.</li>
            </ol>
          </div>
        </div>
      </Tarjeta>
    </div>
  )
}
