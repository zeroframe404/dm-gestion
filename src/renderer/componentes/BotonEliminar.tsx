// El botón de la papelera: borrado definitivo y puntual de UN registro.
//
// Tres decisiones que conviene tener presentes:
//   1. Si quien tiene la sesión abierta no es SUPER_ADMIN, el componente no dibuja NADA. No un botón
//      apagado ni un cartel de «no tenés permiso»: nada. Un botón que no se puede tocar sólo sirve para
//      que alguien lo intente. El proceso principal vuelve a controlarlo igual, que es el que manda.
//   2. Antes de borrar se le pregunta al proceso principal qué se lleva puesto el borrado y se muestra
//      contado: «3 pólizas, 12 filas de la planilla, 4 pagos». Contarlo acá sería contar sobre lo que la
//      pantalla tenía cargado, que casi nunca es todo.
//   3. El botón de confirmar arranca apagado y se enciende recién a los cinco segundos, con la cuenta a
//      la vista. Es el rato que separa «me equivoqué de fila» de «esto lo quise borrar», y es lo que se
//      tarda en leer la lista de arriba.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  conArticulo,
  NOMBRE_ELIMINABLE,
  resumenDeLoBorrado,
  SEGUNDOS_PARA_CONFIRMAR,
  type ResultadoDeEliminacion,
  type TipoEliminable,
  type VistaPreviaDeEliminacion,
} from '../../shared/eliminacion'
import { useSesion } from '../contexto/Sesion'
import { Alerta, Boton, Dialogo } from './ui'
import { Icono } from './Icono'

/** ¿Esta persona puede borrar registros de la base? Sólo el superadministrador. */
export function useEsSuperAdmin(): boolean {
  return useSesion().usuario?.rol === 'SUPER_ADMIN'
}

interface PropsBotonEliminar {
  tipo: TipoEliminable
  id: number
  /** Texto del botón. Con `false` queda sólo el ícono (para las columnas de acciones apretadas). */
  etiqueta?: string | false
  tamano?: 'md' | 'sm'
  /** Se llama después de borrar, con el detalle de lo que se fue. Acá se refresca la pantalla. */
  alBorrar: (resultado: ResultadoDeEliminacion) => void
  className?: string
}

export function BotonEliminar({ tipo, id, etiqueta = 'Eliminar', tamano = 'sm', alBorrar, className }: PropsBotonEliminar) {
  const [abierto, setAbierto] = useState(false)
  const esSuperAdmin = useEsSuperAdmin()

  // Nada de nada para el resto del equipo: ni el botón apagado.
  if (!esSuperAdmin) return null

  const nombre = NOMBRE_ELIMINABLE[tipo]
  return (
    <>
      <Boton
        tamano={tamano}
        variante="peligro"
        icono="basura"
        className={className}
        aria-label={etiqueta === false ? `Eliminar ${nombre.singular}` : undefined}
        title={`Eliminar ${conArticulo(tipo)} definitivamente de la base`}
        onClick={() => setAbierto(true)}
      >
        {etiqueta === false ? null : etiqueta}
      </Boton>
      {abierto && (
        <DialogoEliminar
          tipo={tipo}
          id={id}
          alCerrar={() => setAbierto(false)}
          alBorrar={(resultado) => {
            setAbierto(false)
            alBorrar(resultado)
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// El cartel
// ---------------------------------------------------------------------------

export function DialogoEliminar({
  tipo,
  id,
  alCerrar,
  alBorrar,
}: {
  tipo: TipoEliminable
  id: number
  alCerrar: () => void
  alBorrar: (resultado: ResultadoDeEliminacion) => void
}) {
  const [vista, setVista] = useState<VistaPreviaDeEliminacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)
  const restante = useCuentaRegresiva(vista !== null ? SEGUNDOS_PARA_CONFIRMAR : null)
  const nombre = NOMBRE_ELIMINABLE[tipo]

  useEffect(() => {
    let vigente = true
    void window.dm.eliminacion.vistaPrevia(tipo, id).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setVista(resultado.datos)
      else setError(resultado.error)
    })
    return () => {
      vigente = false
    }
  }, [tipo, id])

  const borrar = async () => {
    setBorrando(true)
    setError(null)
    const resultado = await window.dm.eliminacion.borrar(tipo, id)
    setBorrando(false)
    if (resultado.ok) alBorrar(resultado.datos)
    else setError(resultado.error)
  }

  const listo = vista !== null && restante === 0
  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo={`Eliminar ${conArticulo(tipo)}`}
      descripcion={vista?.titulo}
      alCerrar={borrando ? () => undefined : alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={borrando}>
            Cancelar
          </Boton>
          <Boton
            variante="peligro"
            icono="basura"
            onClick={() => void borrar()}
            disabled={!listo || borrando}
            cargando={borrando}
          >
            {listo || borrando ? 'Eliminar definitivamente' : `Esperá ${restante} s…`}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        {error && <Alerta tono="error">{error}</Alerta>}

        {vista === null ? (
          !error && <p className="text-slate-500">Viendo qué se lleva puesto este borrado…</p>
        ) : (
          <>
            <Alerta tono="error">
              Esto <strong>borra {conArticulo(tipo)} de la base</strong> y no se puede deshacer. No es dar de baja: dar de baja
              guarda la historia, esto la saca.
            </Alerta>

            {vista.detalle.length > 0 && (
              <dl className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                {vista.detalle.map((linea) => (
                  <p key={linea} className="text-sm text-slate-700">
                    {linea}
                  </p>
                ))}
              </dl>
            )}

            {vista.arrastra.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-slate-800">Se va a borrar también:</p>
                <ul className="flex flex-col gap-0.5">
                  {vista.arrastra.map((linea) => (
                    <li key={linea.que} className="flex items-center gap-2 text-slate-700">
                      <Icono nombre="basura" tamano={13} className="shrink-0 text-red-500" />
                      <span>{resumenDeLoBorrado([linea])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {vista.filasDeLaHoja > 0 && (
              <p className="text-slate-600">
                Se sacan además <strong>{resumenDeLoBorrado([{ que: 'renglón de la hoja', cuantos: vista.filasDeLaHoja }])}</strong> de
                Google, en cuanto la sincronización llegue a subirlo.
              </p>
            )}

            {vista.archivos > 0 && (
              <p className="text-slate-600">
                Y <strong>{resumenDeLoBorrado([{ que: 'archivo adjunto', cuantos: vista.archivos }])}</strong> de esta computadora.
              </p>
            )}

            {vista.advertencias.map((aviso) => (
              <Alerta key={aviso} tono="aviso">
                {aviso}
              </Alerta>
            ))}

            <p className="text-xs text-slate-500">
              Queda anotado en el historial: quién lo borró, cuándo, y todo lo que decía {nombre.singular} en ese momento.
            </p>
          </>
        )}
      </div>
    </Dialogo>
  )
}

/**
 * Cuenta regresiva en segundos. Con `desde` en null no corre (todavía no llegó la vista previa: no
 * tiene sentido descontar los cinco segundos mientras no hay nada para leer).
 */
function useCuentaRegresiva(desde: number | null): number {
  const [restante, setRestante] = useState(desde ?? 0)
  // El instante en que arrancó, para que la cuenta no se atrase si el navegador demora un tic.
  const arranque = useRef<number | null>(null)

  const recalcular = useCallback((inicio: number, total: number) => {
    const pasados = Math.floor((Date.now() - inicio) / 1000)
    setRestante(Math.max(0, total - pasados))
  }, [])

  useEffect(() => {
    if (desde === null) {
      arranque.current = null
      setRestante(0)
      return
    }
    if (arranque.current === null) arranque.current = Date.now()
    const inicio = arranque.current
    recalcular(inicio, desde)
    const reloj = setInterval(() => recalcular(inicio, desde), 250)
    return () => clearInterval(reloj)
  }, [desde, recalcular])

  return desde === null ? 0 : restante
}
