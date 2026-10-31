// Mi link → Mi página: el editor de la página pública de quien tiene la sesión abierta.
//
// Se edita sobre la página misma (la vista previa es la página, con la hoja de estilos del servidor)
// y se guarda sola: cada cambio espera un momento sin teclear y se manda entero al VPS con el candado
// `version`. No hay botón «Guardar» a propósito: es una página de links, se toca de a poquito, y un
// botón que hay que acordarse de apretar es justo lo que hace perder lo último que se escribió.
//
// EL CANDADO. Cada guardado manda la versión que se leyó; el VPS la sube y la devuelve. Si otra
// computadora (o la beta y la normal en la misma) guardó en el medio, el VPS contesta 409 y el proceso
// principal lo marca `version-vieja`: acá se deja de guardar y se ofrece cargar lo último. No se pisa
// nada, ni de un lado ni del otro, hasta que la persona decide.
//
// LO QUE VUELVE DEL SERVIDOR NO PISA LO QUE SE ESCRIBE. El servidor recorta los espacios de las
// puntas; si su respuesta reemplazara el borrador, el espacio que se acaba de teclear entre dos
// palabras desaparecería en el medio de la frase. De la respuesta se toman la versión, la URL y si
// hay foto; el contenido sigue siendo el de la pantalla.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NOMBRE_TIPO_DE_COBERTURA,
  DESCRIPCION_POR_DEFECTO_DE_COBERTURA,
  contenidoInicial,
  direccionSugerida,
  type ContenidoDeMiLink,
  type MiLink,
} from '../../../shared/miLink'
import { claveDeUsuario } from '../../../shared/texto'
import type { Resultado } from '../../../shared/tipos'
import { BotonAyuda } from '../../componentes/Ayuda'
import { Icono } from '../../componentes/Icono'
import { ChipDeEstado } from '../../componentes/listados'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { useConexion } from '../../contexto/Conexion'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePerfilDe } from '../../contexto/Perfiles'
import { usePermisos } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoCompartir } from './editor/DialogoCompartir'
import { DialogoCobertura, DialogoContacto, DialogoLink, DialogoNuevaCobertura } from './editor/DialogosDeBloques'
import { CampoDeDireccion, DialogoDireccion, PREFIJO_VISIBLE, chequeoPermiteGuardar, useChequeoDeDireccion } from './editor/Direccion'
import { PanelDeDiseno } from './editor/PanelDeDiseno'
import { borradorDe, idNuevo, problemaDelContenido, type Borrador } from './editor/reglas'
import { VistaPrevia, type EdicionDeLaVista } from './editor/VistaPrevia'

/** Cuánto se espera sin cambios antes de guardar. Menos, y se guarda a cada palabra; más, y se nota. */
const DEMORA_DEL_AUTOGUARDADO_MS = 1200
/** Cada cuánto se vuelve a probar cuando el guardado falló por falta de conexión. */
const REINTENTO_SIN_CONEXION_MS = 10_000

/**
 * El último guardado de un editor, aunque el editor ya no esté: al salir del módulo se manda lo que
 * quedaba en la demora sin esperar la respuesta. Si se vuelve enseguida, la carga nueva espera a que
 * termine; si no, podría traer la versión de antes y el próximo guardado chocaría (409) contra esta
 * misma PC, con un cartel de «otra computadora» que es falso.
 */
let guardadoEnVuelo: Promise<unknown> = Promise.resolve()

export function MiPagina() {
  const [carga, setCarga] = useState<
    { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'lista'; link: MiLink | null; vuelta: number }
  >({ estado: 'cargando' })

  const cargar = useCallback(async () => {
    setCarga({ estado: 'cargando' })
    await guardadoEnVuelo
    const resultado = await window.dm.miLink.mia()
    // `vuelta` cambia con cada carga: es la `key` del editor, así «Cargar lo último» lo arma de cero
    // (borrador, candado y estado de guardado) en vez de mezclar lo nuevo con lo que había.
    setCarga(resultado.ok ? { estado: 'lista', link: resultado.datos, vuelta: Date.now() } : { estado: 'error', mensaje: resultado.error })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (carga.estado === 'cargando') return <Cargando texto="Trayendo tu página…" />
  if (carga.estado === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-8">
        <Alerta tono="error">{carga.mensaje}</Alerta>
        <Boton icono="refrescar" onClick={() => void cargar()}>
          Volver a intentar
        </Boton>
      </div>
    )
  }
  if (!carga.link) {
    return <Bienvenida alCrear={(link) => setCarga({ estado: 'lista', link, vuelta: Date.now() })} alRecargar={() => void cargar()} />
  }
  return <EditorDePagina key={carga.vuelta} inicial={carga.link} alRecargar={() => void cargar()} />
}

// ── Bienvenida ───────────────────────────────────────────────────────────────────────────────────

/** Todavía no hay página: se elige la dirección y se crea con lo de `contenidoInicial`, sin publicar. */
function Bienvenida({ alCrear, alRecargar }: { alCrear: (link: MiLink) => void; alRecargar: () => void }) {
  const sesion = useUsuarioActual()
  const puedeEditar = usePermisos().puedeEditar('miLink')
  const perfil = usePerfilDe(claveDeUsuario(sesion.usuario))
  const [direccion, setDireccion] = useState(() => direccionSugerida(sesion.nombre))
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chequeo = useChequeoDeDireccion(direccion, null)
  const ejemplo = useMemo(() => contenidoInicial(sesion.nombre), [sesion.nombre])

  const crear = async () => {
    if (!chequeoPermiteGuardar(chequeo) || creando) return
    setCreando(true)
    setError(null)
    const resultado = await window.dm.miLink.guardar({ version: null, direccion, publicada: false, contenido: contenidoInicial(sesion.nombre) })
    setCreando(false)
    if (resultado.ok) alCrear(resultado.datos)
    // La creó otra computadora mientras esta mostraba la bienvenida: se trae esa, no se arma otra.
    else if (resultado.codigo === 'version-vieja') alRecargar()
    else setError(resultado.error)
  }

  return (
    <div className="flex flex-col gap-6 p-6 xl:p-8">
      <div className="grid items-center gap-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-suave lg:grid-cols-[minmax(0,1fr)_320px] xl:p-10">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-800">
              <Icono nombre="enlace" tamano={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Creá tu página</h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                Un link tuyo para la bio de Instagram, el estado de WhatsApp o la firma del mail. Desde ahí te escriben, cotizan auto y moto con
                todas las compañías, te piden presupuesto del resto y te denuncian un siniestro con fotos. Todo te llega a Mi link.
              </p>
            </div>
            <BotonAyuda clave="miLink.pagina" />
          </div>

          {puedeEditar ? (
            <>
              <CampoDeDireccion valor={direccion} alCambiar={setDireccion} chequeo={chequeo} />
              <div className="flex flex-wrap items-center gap-3">
                <Boton variante="primario" icono="mas" escribe cargando={creando} disabled={!chequeoPermiteGuardar(chequeo)} onClick={() => void crear()}>
                  Crear mi página
                </Boton>
                <span className="text-sm text-slate-500">Arranca sin publicar: la armás tranquilo y la publicás cuando esté lista.</span>
              </div>
              {error && <Alerta tono="error">{error}</Alerta>}
            </>
          ) : (
            <Alerta tono="info">Todavía no tenés página, y tu usuario no tiene permiso para crearla. Pedíselo a quien administra el programa.</Alerta>
          )}
        </div>

        {/* Cómo arranca: el nombre de la sesión, auto, moto y el botón de siniestros. */}
        <div className="hidden overflow-hidden rounded-[22px] shadow-media lg:block" inert aria-hidden="true">
          <div className="pointer-events-none max-h-[420px] overflow-hidden">
            <VistaPrevia contenido={ejemplo} foto={perfil?.foto ?? null} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── El editor ────────────────────────────────────────────────────────────────────────────────────

type EstadoDeGuardado =
  | { tipo: 'guardado' }
  /** Hay cambios esperando la demora. */
  | { tipo: 'pendiente' }
  | { tipo: 'guardando' }
  /** Falta algo que el servidor va a rechazar (el nombre vacío, un link sin dirección): no se manda. */
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'error'; motivo: string; sinConexion: boolean }

type DialogoAbierto =
  | { tipo: 'direccion' }
  | { tipo: 'compartir' }
  | { tipo: 'contacto'; indice: number | null }
  | { tipo: 'nuevaCobertura' }
  | { tipo: 'cobertura'; indice: number }
  | { tipo: 'link'; indice: number | null }

function EditorDePagina({ inicial, alRecargar }: { inicial: MiLink; alRecargar: () => void }) {
  const puedeEditar = usePermisos().puedeEditar('miLink')
  const { puedeEscribir } = useConexion()
  const { ir } = useNavegacion()
  const sesion = useUsuarioActual()
  const perfil = usePerfilDe(claveDeUsuario(sesion.usuario))

  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(inicial))
  /** Lo último que contestó el servidor: de acá salen la URL, si está publicada de verdad y la foto. */
  const [guardado, setGuardado] = useState<MiLink>(inicial)
  const guardadoRef = useRef(inicial)
  /** El borrador tal como se mandó la última vez que salió bien (serializado, para comparar barato). */
  const [ultimoGuardado, setUltimoGuardado] = useState(() => JSON.stringify(borradorDe(inicial)))
  const [estado, setEstado] = useState<EstadoDeGuardado>({ tipo: 'guardado' })
  const [conflicto, setConflicto] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)
  const [dialogo, setDialogo] = useState<DialogoAbierto | null>(null)
  const [publicando, setPublicando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo que leen los guardados que terminan después de varios renders: el candado, el borrador de
  // ahora y lo último guardado. Con el estado de React leerían el valor del render en que empezaron.
  const version = useRef(inicial.version)
  const borradorActual = useRef(borrador)
  borradorActual.current = borrador
  const ultimoGuardadoRef = useRef(ultimoGuardado)
  const enConflicto = useRef(false)
  const puedeEditarRef = useRef(puedeEditar)
  puedeEditarRef.current = puedeEditar
  // Los guardados van en fila: dos a la vez llevarían la misma versión y el segundo volvería con 409
  // contra el primero, que es de esta misma pantalla.
  const cola = useRef<Promise<unknown>>(Promise.resolve())
  /**
   * Los cambios de un «guardar ya» (publicar, la dirección) mientras viajan. Entran al borrador recién
   * cuando el servidor los acepta, así que hasta entonces cualquier guardado que salga en el medio los
   * tiene que llevar encima: si no, un autoguardado que estaba en la fila mandaría `publicada: false`
   * con la versión nueva y despublicaría la página que se acaba de publicar.
   */
  const forzados = useRef<Partial<Borrador>>({})

  /** Lo que hay que mandar ahora: el borrador con los cambios que están viajando encima. */
  const datosParaMandar = useCallback((): Borrador => ({ ...borradorActual.current, ...forzados.current }), [])

  /**
   * Pone un guardado en la fila. Los datos se arman cuando le toca el turno, no al encolarse: lo que
   * estaba en la fila detrás de otro guardado sale con lo de ese momento, no con lo de antes. Si ya
   * no hay diferencia con lo último guardado, no se pide nada. `alTerminar` corre dentro del mismo
   * paso, antes de que arranque el siguiente de la fila.
   */
  const enviar = useCallback((armar: () => Borrador, alTerminar?: (resultado: Resultado<MiLink>) => void): Promise<Resultado<MiLink>> => {
    const guardarEnSuTurno = async (): Promise<Resultado<MiLink>> => {
      if (enConflicto.current) return { ok: false, error: 'Otra computadora guardó tu página.', codigo: 'version-vieja' }
      const datos = armar()
      const texto = JSON.stringify(datos)
      if (texto === ultimoGuardadoRef.current) return { ok: true, datos: guardadoRef.current }
      // Se escribió algo que el servidor va a rechazar entre que se encoló y le tocó el turno.
      const problema = problemaDelContenido(datos.contenido)
      if (problema) return { ok: false, error: `Antes hay que corregir esto: ${problema}`, codigo: 'invalido' }
      let resultado: Resultado<MiLink>
      try {
        resultado = await window.dm.miLink.guardar({ version: version.current, ...datos })
      } catch {
        resultado = { ok: false, error: 'No se pudo hablar con el programa para guardar. Se vuelve a intentar sola.', codigo: 'sin-conexion' }
      }
      if (resultado.ok) {
        version.current = resultado.datos.version
        ultimoGuardadoRef.current = texto
        guardadoRef.current = resultado.datos
        setUltimoGuardado(texto)
        setGuardado(resultado.datos)
      } else if (resultado.codigo === 'version-vieja') {
        enConflicto.current = true
        setConflicto(resultado.error)
      }
      return resultado
    }
    const paso = cola.current.then(async (): Promise<Resultado<MiLink>> => {
      const resultado = await guardarEnSuTurno()
      alTerminar?.(resultado)
      return resultado
    })
    cola.current = paso.catch(() => undefined)
    guardadoEnVuelo = cola.current
    return paso
  }, [])

  const autoguardar = useCallback(async () => {
    if (JSON.stringify(datosParaMandar()) === ultimoGuardadoRef.current) return setEstado({ tipo: 'guardado' })
    setEstado({ tipo: 'guardando' })
    const resultado = await enviar(datosParaMandar)
    if (resultado.ok) {
      // Si se siguió escribiendo mientras viajaba, ya hay otro guardado esperando su demora.
      setEstado(JSON.stringify(datosParaMandar()) === ultimoGuardadoRef.current ? { tipo: 'guardado' } : { tipo: 'pendiente' })
    } else if (resultado.codigo === 'invalido') {
      // No es un error del guardado: el efecto ya muestra qué falta y vuelve a guardar cuando se corrija.
      const problema = problemaDelContenido(borradorActual.current.contenido)
      setEstado(problema ? { tipo: 'invalido', motivo: problema } : { tipo: 'pendiente' })
    } else if (resultado.codigo !== 'version-vieja') {
      setEstado({ tipo: 'error', motivo: resultado.error, sinConexion: resultado.codigo === 'sin-conexion' })
    }
  }, [enviar, datosParaMandar])

  // El autoguardado: cada cambio del borrador reinicia la espera. `reintento` es para volver a correrlo
  // sin que haya cambiado nada (el botón «Reintentar» y la vuelta de la conexión).
  const serializado = useMemo(() => JSON.stringify(borrador), [borrador])
  useEffect(() => {
    if (!puedeEditar || conflicto) return
    if (serializado === ultimoGuardado) {
      setEstado((previo) => (previo.tipo === 'guardando' ? previo : { tipo: 'guardado' }))
      return
    }
    const problema = problemaDelContenido(borrador.contenido)
    if (problema) {
      setEstado({ tipo: 'invalido', motivo: problema })
      return
    }
    if (!puedeEscribir) {
      // Ni se intenta: el proceso principal lo rechazaría igual. Cuando vuelva el canal, este efecto
      // corre de nuevo (depende de `puedeEscribir`) y guarda lo que haya.
      setEstado({ tipo: 'error', motivo: 'Sin conexión con la agencia: tus cambios se guardan solos cuando vuelva.', sinConexion: true })
      return
    }
    setEstado((previo) => (previo.tipo === 'guardando' ? previo : { tipo: 'pendiente' }))
    const espera = window.setTimeout(() => void autoguardar(), DEMORA_DEL_AUTOGUARDADO_MS)
    return () => window.clearTimeout(espera)
  }, [serializado, ultimoGuardado, borrador.contenido, reintento, puedeEditar, puedeEscribir, conflicto, autoguardar])

  // Sin conexión con el VPS (el canal puede estar bien y el servidor no contestar): se reintenta solo.
  const reintentaSolo = estado.tipo === 'error' && estado.sinConexion && puedeEscribir
  useEffect(() => {
    if (!reintentaSolo) return
    const espera = window.setTimeout(() => setReintento((n) => n + 1), REINTENTO_SIN_CONEXION_MS)
    return () => window.clearTimeout(espera)
  }, [reintentaSolo, reintento])

  // Al salir del módulo con un cambio todavía en la demora, se manda en el momento: si no, lo último
  // que se escribió antes de ir a otra pantalla se perdería sin aviso.
  useEffect(
    () => () => {
      const datos = datosParaMandar()
      if (enConflicto.current || !puedeEditarRef.current) return
      if (JSON.stringify(datos) === ultimoGuardadoRef.current || problemaDelContenido(datos.contenido)) return
      void enviar(datosParaMandar)
    },
    [enviar, datosParaMandar],
  )

  /**
   * Guarda YA (sin la demora) con algún cambio encima del borrador: publicar y cambiar la dirección,
   * que son decisiones y no tecleo, y cuyo resultado la persona está esperando ver. Devuelve el error
   * para mostrar, o null. El cambio entra al borrador recién si el servidor lo aceptó: una dirección
   * que resultó tomada no tiene que quedar puesta.
   */
  const guardarYa = async (cambios: Partial<Borrador>): Promise<string | null> => {
    const problema = problemaDelContenido({ ...datosParaMandar(), ...cambios }.contenido)
    if (problema) return `Antes hay que corregir esto: ${problema}`
    setEstado({ tipo: 'guardando' })
    // Desde ya, cualquier guardado que salga (también uno que esperaba en la fila) los lleva.
    forzados.current = { ...forzados.current, ...cambios }
    const soltar = () => {
      // Sólo los que siguen siendo de este guardado: otro «guardar ya» posterior pudo pisar alguno.
      const quedan = { ...forzados.current }
      for (const clave of Object.keys(cambios) as Array<keyof Borrador>) {
        if (quedan[clave] === cambios[clave]) delete quedan[clave]
      }
      forzados.current = quedan
    }
    // Los cambios propios van encima de los forzados: si se tocó «Publicar» y enseguida «Despublicar»,
    // cada paso manda lo suyo y el borrador termina igual que el servidor.
    const resultado = await enviar(
      () => ({ ...datosParaMandar(), ...cambios }),
      (resultado) => {
        // Ya en el borrador (también el ref, que lee el próximo paso de la fila antes del render) o
        // descartados, pero dentro del mismo paso: entre los dos no tiene que salir un guardado sin ellos.
        if (resultado.ok) {
          borradorActual.current = { ...borradorActual.current, ...cambios }
          setBorrador((previo) => ({ ...previo, ...cambios }))
        }
        soltar()
      },
    )
    if (!resultado.ok) {
      setEstado(JSON.stringify(datosParaMandar()) === ultimoGuardadoRef.current ? { tipo: 'guardado' } : { tipo: 'pendiente' })
      setReintento((n) => n + 1)
      return resultado.error
    }
    // El efecto del autoguardado no pisa un «guardando» (podría ser de otro guardado en la fila): lo
    // cierra quien lo abrió.
    setEstado(JSON.stringify(datosParaMandar()) === ultimoGuardadoRef.current ? { tipo: 'guardado' } : { tipo: 'pendiente' })
    return null
  }

  const alternarPublicada = async () => {
    setPublicando(true)
    setAviso(null)
    const error = await guardarYa({ publicada: !borrador.publicada })
    setPublicando(false)
    if (error) setAviso(error)
  }

  const verMiPagina = async () => {
    setAviso(null)
    // Que lo que se abre en el navegador sea lo que se ve acá: si hay algo en la demora, va primero.
    if (JSON.stringify(borradorActual.current) !== ultimoGuardadoRef.current) {
      const error = await guardarYa({})
      if (error) return setAviso(error)
    }
    const resultado = await window.dm.miLink.abrirPagina(guardado.url)
    if (!resultado.ok) setAviso(resultado.error)
  }

  const cambiarContenido = useCallback(
    (cambio: (previo: ContenidoDeMiLink) => ContenidoDeMiLink) => setBorrador((previo) => ({ ...previo, contenido: cambio(previo.contenido) })),
    [],
  )

  const editable = puedeEditar && !conflicto
  const edicion: EdicionDeLaVista | undefined = editable
    ? {
        cambiar: cambiarContenido,
        editarContacto: (indice) => setDialogo({ tipo: 'contacto', indice }),
        agregarCobertura: () => setDialogo({ tipo: 'nuevaCobertura' }),
        editarCobertura: (indice) => setDialogo({ tipo: 'cobertura', indice }),
        editarLink: (indice) => setDialogo({ tipo: 'link', indice }),
      }
    : undefined

  const { contenido } = borrador
  const fotoDelPerfil = perfil?.foto ?? null
  const cerrarDialogo = () => setDialogo(null)

  return (
    <div className="flex flex-col gap-5 p-6 xl:p-8">
      <BarraSuperior
        editable={puedeEditar}
        estado={conflicto ? { tipo: 'error', motivo: conflicto, sinConexion: false } : estado}
        publicada={guardado.publicada}
        url={guardado.url}
        publicando={publicando}
        alDireccion={() => setDialogo({ tipo: 'direccion' })}
        alCompartir={() => setDialogo({ tipo: 'compartir' })}
        alIr={(seccion) => ir('miLink', { seccion })}
        alVer={() => void verMiPagina()}
        alPublicar={() => void alternarPublicada()}
        bloqueado={Boolean(conflicto)}
      />

      {conflicto ? (
        <Alerta tono="error">
          <p>{conflicto}</p>
          <p className="mt-1">
            Para no pisar lo de la otra computadora, acá se dejó de guardar. Al cargar lo último se pierde lo que cambiaste en esta desde el último
            guardado.
          </p>
          <Boton tamano="sm" icono="refrescar" className="mt-2" onClick={alRecargar}>
            Cargar lo último
          </Boton>
        </Alerta>
      ) : estado.tipo === 'invalido' ? (
        <Alerta tono="aviso">{estado.motivo} Mientras tanto, lo que cambies no se guarda.</Alerta>
      ) : estado.tipo === 'error' ? (
        <Alerta tono={estado.sinConexion ? 'aviso' : 'error'}>
          <p>{estado.motivo}</p>
          {!estado.sinConexion && (
            <Boton tamano="sm" icono="refrescar" className="mt-2" onClick={() => setReintento((n) => n + 1)}>
              Reintentar
            </Boton>
          )}
        </Alerta>
      ) : null}
      {aviso && <Alerta tono="error">{aviso}</Alerta>}
      {!puedeEditar && <Alerta tono="info">Tu usuario puede mirar esta página pero no cambiarla. Para editarla, pedí el permiso a quien administra el programa.</Alerta>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
          <div className="mx-auto max-w-[760px] overflow-hidden rounded-[22px] shadow-media">
            <VistaPrevia contenido={contenido} foto={contenido.usarFoto ? fotoDelPerfil : null} edicion={edicion} />
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Así la ve quien entra{editable ? '. Tocá cualquier texto para cambiarlo; al pasar el mouse por un bloque aparecen sus botones.' : '.'}
          </p>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-suave xl:sticky xl:top-6 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
          <h2 className="mb-4 font-display text-lg font-bold tracking-tight text-slate-900">Diseño</h2>
          <PanelDeDiseno contenido={contenido} fotoDelPerfil={fotoDelPerfil} editable={editable} alCambiar={cambiarContenido} />
        </aside>
      </div>

      {dialogo?.tipo === 'direccion' && (
        <DialogoDireccion
          actual={guardado.direccion}
          publicada={guardado.publicada}
          alGuardar={(direccion) => guardarYa({ direccion })}
          alCerrar={cerrarDialogo}
        />
      )}
      {dialogo?.tipo === 'compartir' && <DialogoCompartir url={guardado.url} publicada={guardado.publicada} alCerrar={cerrarDialogo} />}
      {dialogo?.tipo === 'contacto' && (
        <DialogoContacto
          inicial={dialogo.indice === null ? null : (contenido.contacto[dialogo.indice] ?? null)}
          alCerrar={cerrarDialogo}
          alGuardar={(datos) => {
            const indice = dialogo.indice
            cambiarContenido((previo) => ({
              ...previo,
              contacto:
                indice === null
                  ? [...previo.contacto, { id: idNuevo(datos.tipo, previo), ...datos }]
                  : previo.contacto.map((bloque, i) => (i === indice ? { ...bloque, ...datos } : bloque)),
            }))
            cerrarDialogo()
          }}
        />
      )}
      {dialogo?.tipo === 'nuevaCobertura' && (
        <DialogoNuevaCobertura
          usadas={new Set(contenido.coberturas.map((bloque) => bloque.tipo))}
          alCerrar={cerrarDialogo}
          alElegir={(tipo) => {
            cambiarContenido((previo) => ({
              ...previo,
              coberturas: [
                ...previo.coberturas,
                { id: idNuevo(tipo, previo), tipo, titulo: NOMBRE_TIPO_DE_COBERTURA[tipo], descripcion: DESCRIPCION_POR_DEFECTO_DE_COBERTURA[tipo] },
              ],
            }))
            cerrarDialogo()
          }}
        />
      )}
      {dialogo?.tipo === 'cobertura' && contenido.coberturas[dialogo.indice] && (
        <DialogoCobertura
          inicial={contenido.coberturas[dialogo.indice]!}
          alCerrar={cerrarDialogo}
          alGuardar={(datos) => {
            const indice = dialogo.indice
            cambiarContenido((previo) => ({
              ...previo,
              coberturas: previo.coberturas.map((bloque, i) => (i === indice ? { ...bloque, ...datos } : bloque)),
            }))
            cerrarDialogo()
          }}
        />
      )}
      {dialogo?.tipo === 'link' && (
        <DialogoLink
          inicial={dialogo.indice === null ? null : (contenido.links[dialogo.indice] ?? null)}
          alCerrar={cerrarDialogo}
          alGuardar={(datos) => {
            const indice = dialogo.indice
            cambiarContenido((previo) => ({
              ...previo,
              links:
                indice === null
                  ? [...previo.links, { id: idNuevo('link', previo), ...datos }]
                  : previo.links.map((bloque, i) => (i === indice ? { ...bloque, ...datos } : bloque)),
            }))
            cerrarDialogo()
          }}
        />
      )}
    </div>
  )
}

// ── La barra de arriba ───────────────────────────────────────────────────────────────────────────

function IndicadorDeGuardado({ estado }: { estado: EstadoDeGuardado }) {
  if (estado.tipo === 'guardado') {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-green-700" role="status">
        <Icono nombre="ok" tamano={16} />
        Todo guardado
      </span>
    )
  }
  if (estado.tipo === 'pendiente' || estado.tipo === 'guardando') {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-500" role="status">
        <Icono nombre="cargando" tamano={15} className="animate-spin" />
        Guardando…
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-amber-700" role="status" title={estado.motivo}>
      <Icono nombre="alerta" tamano={16} />
      Sin guardar
    </span>
  )
}

function BarraSuperior({
  editable,
  estado,
  publicada,
  url,
  publicando,
  bloqueado,
  alDireccion,
  alCompartir,
  alIr,
  alVer,
  alPublicar,
}: {
  editable: boolean
  estado: EstadoDeGuardado
  publicada: boolean
  url: string
  publicando: boolean
  /** En conflicto con otra computadora: no se guarda nada hasta cargar lo último. */
  bloqueado: boolean
  alDireccion: () => void
  alCompartir: () => void
  alIr: (seccion: 'metricas' | 'solicitudes' | 'siniestros') => void
  alVer: () => void
  alPublicar: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-suave">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap',
            editable ? 'bg-violet-50 text-violet-800' : 'bg-slate-100 text-slate-600',
          )}
        >
          <Icono nombre={editable ? 'lapiz' : 'ojo'} tamano={13} />
          {editable ? 'Editando tu página' : 'Solo lectura'}
        </span>
        {editable && <IndicadorDeGuardado estado={estado} />}
        <ChipDeEstado tono={publicada ? 'verde' : 'gris'}>{publicada ? 'Publicada' : 'Sin publicar'}</ChipDeEstado>
        <span className="truncate text-xs text-slate-500" title={url}>
          {url.replace(/^https?:\/\//, '') || PREFIJO_VISIBLE}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {editable && (
          <Boton tamano="sm" icono="enlace" onClick={alDireccion} disabled={bloqueado}>
            Dirección
          </Boton>
        )}
        <Boton tamano="sm" icono="compartir" onClick={alCompartir}>
          Compartir
        </Boton>
        <Boton tamano="sm" icono="metricas" onClick={() => alIr('metricas')}>
          Métricas
        </Boton>
        <Boton tamano="sm" icono="bandeja" onClick={() => alIr('solicitudes')}>
          Solicitudes
        </Boton>
        <Boton tamano="sm" icono="siniestros" onClick={() => alIr('siniestros')}>
          Siniestros
        </Boton>
        <Boton
          tamano="sm"
          icono="ojo"
          onClick={alVer}
          disabled={!publicada}
          title={publicada ? 'Abre tu página en el navegador (tu visita no se cuenta)' : 'Publicala para verla en el navegador. Mientras tanto, la vista previa es lo que se va a ver.'}
        >
          Ver mi página
        </Boton>
        {editable && (
          <Boton
            tamano="sm"
            variante={publicada ? 'secundario' : 'primario'}
            icono={publicada ? 'ojoTachado' : 'nube'}
            escribe
            cargando={publicando}
            disabled={bloqueado}
            onClick={alPublicar}
            title={publicada ? 'La página deja de verse: quien entre al link ve «no disponible».' : 'Cualquiera con el link la va a poder ver.'}
          >
            {publicada ? 'Despublicar' : 'Publicar'}
          </Boton>
        )}
        <BotonAyuda clave="miLink.pagina" />
      </div>
    </div>
  )
}
