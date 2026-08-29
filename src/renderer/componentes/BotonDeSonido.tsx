// El interruptor de los avisos sonoros, al lado de las campanas.
//
// Va en la barra superior y no enterrado en una pantalla de configuración porque el momento en que
// alguien lo quiere apagar es siempre el mismo: acaba de sonar y molestó. Un ajuste que hay que ir a
// buscar a Administración no lo apaga nadie, se apagan los parlantes de la computadora, y entonces
// tampoco se escucha el rechazo que sí importaba.
//
// La preferencia es de esta computadora (localStorage): en el mostrador se quiere escuchar y en la
// oficina de al lado, no, y las dos usan el mismo usuario más de una vez.
import { useState } from 'react'
import { probarSonido, silenciarSonidos, sonidosSilenciados } from '../sonidos'
import { Icono } from './Icono'
import { cx } from './ui'

export function BotonDeSonido() {
  const [silenciado, setSilenciado] = useState(() => sonidosSilenciados())

  const alternar = () => {
    const siguiente = !silenciado
    silenciarSonidos(siguiente)
    setSilenciado(siguiente)
    // Al volver a encenderlos suena la campana una vez: sirve de confirmación y, de paso, es la
    // interacción que Chromium necesita para dejar sonar los avisos que lleguen después.
    if (!siguiente) probarSonido('campana')
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={silenciado}
      aria-label={silenciado ? 'Los avisos sonoros están apagados. Encenderlos.' : 'Los avisos sonoros están encendidos. Apagarlos.'}
      title={
        silenciado
          ? 'Los avisos suenan apagados en esta computadora. Tocá para volver a escucharlos.'
          : 'Suena un aviso cuando llega una tarea, cuando rebota un débito y cuando se completa una tarea.'
      }
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
        silenciado ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      <Icono nombre={silenciado ? 'altavozApagado' : 'altavoz'} tamano={18} />
    </button>
  )
}
