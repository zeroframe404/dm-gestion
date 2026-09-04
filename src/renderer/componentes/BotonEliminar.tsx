// El botón de la papelera: borrado definitivo y puntual de UN registro.
//
// Tres decisiones que conviene tener presentes:
//   1. Si quien tiene la sesión abierta no puede borrar ESE tipo, el componente no dibuja NADA. No un
//      botón apagado ni un cartel de «no tenés permiso»: nada. Un botón que no se puede tocar sólo
//      sirve para que alguien lo intente. Quién puede borrar qué está en shared/eliminacion.ts —el
//      cliente lo borran los tres roles, el resto sólo el superadministrador— y el proceso principal
//      vuelve a controlarlo igual, que es el que manda.
//   2. Antes de borrar se le pregunta al proceso principal qué se lleva puesto el borrado y se muestra
//      contado: «3 pólizas, 12 filas de la planilla, 4 pagos». Contarlo acá sería contar sobre lo que la
//      pantalla tenía cargado, que casi nunca es todo.
//   3. El botón de confirmar arranca apagado y se enciende recién a los cinco segundos, con la cuenta a
//      la vista. Es el rato que separa «me equivoqué de fila» de «esto lo quise borrar», y es lo que se
//      tarda en leer la lista de arriba.
import { useEffect, useRef, useState } from 'react'
import {
  AREA_ELIMINABLE,
  conArticulo,
  NOMBRE_ELIMINABLE,
  resumenDeLoBorrado,
  rolPuedeEliminar,
  SEGUNDOS_PARA_CONFIRMAR,
  type ResultadoDeEliminacion,
  type TipoEliminable,
  type VistaPreviaDeEliminacion,
} from '../../shared/eliminacion'
import { useSesion } from '../contexto/Sesion'
import { usePermisos } from '../contexto/Permisos'
import { Alerta, Boton, Dialogo } from './ui'
import { Icono } from './Icono'

/**
 * ¿Esta persona puede borrar registros de ESTE tipo? Es la misma cuenta que hace `exigirBorrado` en
 * ipc.ts: el rol que corresponde al tipo, y además poder editar el módulo de donde sale el registro.
 * Acá sólo evita dibujar un botón que después iba a fallar; el que manda es el proceso principal.
 */
export function usePuedeEliminar(tipo: TipoEliminable): boolean {
  const rol = useSesion().usuario?.rol
  const { puedeEditar } = usePermisos()
  if (!rol) return false
  return rolPuedeEliminar(rol, tipo) && puedeEditar(AREA_ELIMINABLE[tipo])
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
  const puedeBorrar = usePuedeEliminar(tipo)

  // Nada de nada para quien no puede borrar esto: ni el botón apagado.
  if (!puedeBorrar) return null

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
  // El botón se apaga con `borrando`, pero eso es estado de React: dos clics muy seguidos entran los
  // dos antes del re-dibujo. El segundo mandaría a borrar un registro que ya no está y lo único que
  // conseguiría es un cartel de error confuso encima del que ya se fue bien.
  const yaSalio = useRef(false)
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
    if (yaSalio.current) return
    yaSalio.current = true
    setBorrando(true)
    setError(null)
    const resultado = await window.dm.eliminacion.borrar(tipo, id)
    setBorrando(false)
    if (resultado.ok) {
      alBorrar(resultado.datos)
      return
    }
    // Falló: se puede volver a intentar (por ejemplo, la base estaba ocupada).
    yaSalio.current = false
    setError(resultado.error)
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
            {vista !== null && restante > 0 && !borrando ? `Esperá ${restante} s…` : 'Eliminar definitivamente'}
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
 * Cuenta regresiva en segundos. Con `desde` en null no corre: todavía no llegó la vista previa y no
 * tiene sentido descontar los cinco segundos mientras no hay nada para leer.
 *
 * Lo que queda devuelto NO se guarda en un estado, se calcula en cada dibujo contra el instante en que
 * arrancó. La primera versión sí lo guardaba y tenía un agujero que se comía la función entera: en el
 * dibujo en que llega la vista previa —o sea, cuando `desde` pasa de null a 5— el efecto todavía no
 * corrió, así que el estado seguía en 0 y el botón salía HABILITADO durante ese cuadro. Con la vista
 * previa de un cliente grande, que tarda, alcanzaba con estar apoyando el clic para borrar sin haber
 * esperado nada. Calculándolo, mientras no arrancó faltan los cinco segundos enteros y punto.
 */
export function useCuentaRegresiva(desde: number | null): number {
  const [arranque, setArranque] = useState<number | null>(null)
  // Sólo para volver a dibujar cuatro veces por segundo: la cuenta sale del reloj, no de acá.
  const [, latir] = useState(0)

  useEffect(() => {
    if (desde === null) {
      setArranque(null)
      return
    }
    setArranque(Date.now())
    const reloj = setInterval(() => latir((n) => n + 1), 250)
    return () => clearInterval(reloj)
  }, [desde])

  if (desde === null) return 0
  // Todavía no arrancó (el efecto corre después de pintar): falta todo, nunca cero.
  if (arranque === null) return desde
  return Math.max(0, desde - Math.floor((Date.now() - arranque) / 1000))
}
