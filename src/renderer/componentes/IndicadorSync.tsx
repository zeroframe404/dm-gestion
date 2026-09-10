// Indicador de sincronización de la barra superior: de un vistazo, si lo que se está cargando llegó a
// la base de la agencia o está esperando. Verde en vivo, ámbar reconectando o con algo sin subir, rojo
// sin conexión.
//
// SON DOS COSAS Y SE MIRAN LAS DOS (14.0). El canal en vivo dice si HAY con quién hablar y el motor
// dice qué pasa con los datos de esta computadora; mostrar sólo una de las dos mentía en los dos
// sentidos: «Sincronizado» con el canal caído, o «Sin conexión» cuando lo único que falla es una
// celda que el servidor rechazó.
//
// Y EL TEXTO CAMBIÓ. Hasta la 13.x decía «Sin conexión — trabajando local», que era verdad: se
// guardaba acá y se subía después. Desde la 14.0 sin canal NO se guarda nada, así que ese cartel
// pasó a ser exactamente la mentira que hace perder una tarde de trabajo.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoSincronizacion, SituacionDeConexion } from '../../shared/tipos'
import { useConexion } from '../contexto/Conexion'
import { Icono, type NombreIcono } from './Icono'
import { cx, haceCuanto } from './ui'

interface Aspecto {
  clases: string
  punto: string
  icono: NombreIcono | null
  texto: string
  detalle: string
}

function aspectoDe(estado: EstadoSincronizacion, conexion: SituacionDeConexion): Aspecto {
  if (!estado.configurada) {
    return {
      clases: 'border-slate-200 bg-slate-50 text-slate-600',
      punto: 'bg-slate-400',
      icono: null,
      texto: 'Local',
      detalle: 'La conexión con la base del VPS no está disponible en esta computadora: los datos se guardan sólo acá.',
    }
  }
  // Primero el canal y después los datos: sin canal, cuántos cambios esperan es una pregunta que ya no
  // tiene sentido —no hay más cambios, no se puede escribir— y lo único que importa saber es eso.
  //
  // Se miran las dos fuentes y con que una diga «sin conexión» alcanza: el motor arma su situación a
  // partir del canal, pero si alguna vez le llegara a faltar esa señal (ver `motor.ts estado()`) se
  // queda con lo que le pasó a la última llamada HTTP, y un rojo de más es infinitamente más barato
  // que un verde que miente.
  if (conexion === 'sin-conexion' || estado.situacion === 'sin-conexion') {
    return {
      clases: 'border-red-200 bg-red-50 text-red-700',
      punto: 'bg-red-500',
      icono: 'alerta',
      texto: 'Sin conexión',
      detalle: 'No hay conexión con la base de la agencia: no se puede guardar nada hasta que vuelva internet. Se sigue pudiendo mirar todo.',
    }
  }
  if (conexion === 'reconectando' || estado.situacion === 'reconectando') {
    return {
      clases: 'border-amber-200 bg-amber-50 text-amber-800',
      punto: 'bg-amber-400',
      icono: 'cargando',
      texto: 'Reconectando…',
      detalle: 'Se cortó la conexión con la base de la agencia y se está volviendo a conectar. Mientras tanto no se guarda nada.',
    }
  }
  // Con canal en pie, «pendientes» dura lo que tarda una subida: ya no es una cola que se acumula
  // esperando al reloj de los 10 segundos, así que se cuenta como lo que es, guardar.
  if (estado.situacion === 'trabajando' || estado.pendientes > 0) {
    return {
      clases: 'border-marino-200 bg-marino-50 text-marino-700',
      punto: 'bg-marino-500',
      icono: 'cargando',
      texto: 'Guardando…',
      detalle:
        estado.pendientes > 0
          ? `${estado.pendientes} ${estado.pendientes === 1 ? 'cambio' : 'cambios'} viajando a la base de la agencia.`
          : 'Subiendo y bajando cambios de la base de la agencia.',
    }
  }
  // Los que fallaron no están «guardándose»: nadie los va a reintentar solo. Decirlo así evita que el
  // cartel quede clavado en un número que no baja nunca por más que uno toque «Sincronizar».
  if (estado.fallidas > 0) {
    return {
      clases: 'border-amber-200 bg-amber-50 text-amber-800',
      punto: 'bg-amber-400',
      icono: 'alerta',
      texto: `${estado.fallidas} ${estado.fallidas === 1 ? 'cambio' : 'cambios'} sin subir`,
      detalle: 'No se pudieron subir y no se reintentan solos. Entrá a Administración → Sincronización y tocá «Volver a intentar los que fallaron».',
    }
  }
  return {
    clases: 'border-green-200 bg-green-50 text-green-800',
    punto: 'bg-green-500',
    icono: null,
    // Sin «hace X»: con el canal en vivo lo que se cargó acá ya está allá y lo de allá ya está acá, y
    // era ese texto —y sólo ese— el que obligaba a tener un reloj redibujando el indicador.
    texto: 'En vivo',
    // «Última subida» es la última vez que HUBO algo para subir (si nadie cargó nada, queda vieja y
    // no significa que la sincronización esté caída): se aclara para que no asuste.
    detalle: `Todo lo de esta computadora está en la base de la agencia. Última subida ${haceCuanto(estado.ultimaSubida)} (la última vez que hubo cambios para subir).`,
  }
}

export function IndicadorSync() {
  const { situacion } = useConexion()
  const [estado, setEstado] = useState<EstadoSincronizacion | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  const refrescar = useCallback(async () => {
    const resultado = await window.dm.sincronizacion.estado()
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  // Sin reloj (14.0): el motor avisa cada vez que cambia y el canal también, así que redibujar cada
  // 30 segundos era leer el estado de la cola para escribir lo mismo que ya estaba en pantalla.
  useEffect(() => {
    void refrescar()
    return window.dm.sincronizacion.alCambiarEstado((nuevo) => setEstado(nuevo))
  }, [refrescar])

  if (!estado) return null
  const aspecto = aspectoDe(estado, situacion)

  const sincronizar = async () => {
    if (!estado.configurada || sincronizando) return
    setSincronizando(true)
    const resultado = await window.dm.sincronizacion.ahora(false)
    if (resultado.ok) setEstado(resultado.datos)
    setSincronizando(false)
  }

  return (
    <button
      type="button"
      onClick={() => void sincronizar()}
      disabled={!estado.configurada}
      title={`${aspecto.detalle}${estado.configurada ? '\n\nHacé clic para sincronizar ahora.' : ''}`}
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        aspecto.clases,
        estado.configurada && 'hover:brightness-95',
      )}
    >
      {aspecto.icono === 'cargando' || sincronizando ? (
        <Icono nombre="cargando" tamano={12} className="animate-spin" />
      ) : aspecto.icono ? (
        <Icono nombre={aspecto.icono} tamano={12} />
      ) : (
        <span className={cx('h-2 w-2 rounded-full', aspecto.punto)} aria-hidden="true" />
      )}
      {sincronizando ? 'Guardando…' : aspecto.texto}
    </button>
  )
}
