// Administración → Sincronización → «Respaldos en el servidor»: los últimos 3 y el botón de rebobinar.
//
// Es lo que pidió la agencia: «que día a día se pueda hacer un backup del estado en el VPS, se
// muestren los últimos 3, y con eso si pasara algo tenemos seguridad de rebobinar».
//
// Cuatro decisiones que conviene tener presentes:
//
//   1. NO SE CUELGA DEL PANEL DE SINCRONIZACIÓN. Ese panel se lee de la base local, es síncrono y se
//      recarga cada diez segundos; esto sale a internet. Con su propio estado y su propio error, un
//      VPS caído deja esta tarjeta con un cartel y no toca el resto de la pantalla.
//   2. TRES Y NO MÁS. El servidor guarda catorce, pero el caso real es «esto se rompió hoy, volvamos
//      a ayer o a anteayer»: una lista corta se lee de un vistazo y no invita a rebobinar a la semana
//      pasada sin pensarlo.
//   3. RESTAURAR ES DEL SUPERADMINISTRADOR. Para el resto el botón no se dibuja —ni apagado—, igual
//      que la papelera: un botón que no se puede tocar sólo sirve para que alguien lo intente. El
//      proceso principal lo vuelve a controlar igual, que es el que manda.
//   4. EL CARTEL DE CONFIRMACIÓN ESPERA CINCO SEGUNDOS, como el del borrado definitivo. Es el rato que
//      separa «me equivoqué de fila» de «esto lo quise hacer», y es lo que se tarda en leer qué pisa.
import { useCallback, useEffect, useState } from 'react'
import { SEGUNDOS_PARA_CONFIRMAR } from '../../../shared/eliminacion'
import { NOMBRE_MOTIVO_RESPALDO, type RespaldoDelVps, type ResumenDeRestauracion } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Dialogo, Etiqueta, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useSesion } from '../../contexto/Sesion'

function fecha(iso: string): string {
  const f = new Date(iso)
  return Number.isNaN(f.getTime()) ? iso : f.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const ENCABEZADO = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

export function RespaldosDelServidor() {
  const puedeEditar = usePuedeEditar('administracion')
  const esSuperAdmin = useSesion().usuario?.rol === 'SUPER_ADMIN'
  const [respaldos, setRespaldos] = useState<RespaldoDelVps[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [restaurando, setRestaurando] = useState<RespaldoDelVps | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.respaldos.listar()
    if (resultado.ok) {
      setRespaldos(resultado.datos)
      setError(null)
    } else {
      setRespaldos([])
      setError(resultado.error)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respaldarAhora = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.respaldos.crear()
    setGuardando(false)
    if (resultado.ok) {
      setRespaldos(resultado.datos)
      setAviso('Listo: el respaldo de hoy está guardado en el servidor.')
    } else {
      setError(resultado.error)
    }
  }

  return (
    <Tarjeta
      titulo="Respaldos en el servidor"
      descripcion="Todos los días el servidor guarda una copia del GENERAL DE CLIENTES entero. Se hace solo, sin que nadie tenga que abrir el programa, y desde acá se puede volver a cualquiera de las últimas tres: eso deja la base de TODAS las computadoras como estaba ese día."
      acciones={
        <Boton icono="descargar" cargando={guardando} disabled={!puedeEditar} onClick={() => void respaldarAhora()}>
          Respaldar ahora
        </Boton>
      }
      alRas
    >
      {error && (
        <div className="px-4 pt-3">
          <Alerta tono="aviso">
            No se pudieron traer los respaldos del servidor: {error} El resto de la pantalla sigue andando igual.
          </Alerta>
        </div>
      )}
      {aviso && (
        <div className="px-4 pt-3">
          <Alerta tono="exito">{aviso}</Alerta>
        </div>
      )}

      {respaldos === null ? (
        <div className="p-4">
          <Cargando texto="Preguntándole al servidor…" />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={ENCABEZADO}>Día</th>
              <th className={ENCABEZADO}>Guardado</th>
              <th className={ENCABEZADO}>Qué tiene</th>
              <th className={cx(ENCABEZADO, 'text-right')}>Tamaño</th>
              <th className={ENCABEZADO}>Lo hizo</th>
              {esSuperAdmin && <th className={ENCABEZADO} />}
            </tr>
          </thead>
          <tbody>
            {respaldos.length === 0 && (
              <tr>
                <td colSpan={esSuperAdmin ? 6 : 5} className="px-3 py-8 text-center text-slate-500">
                  {error
                    ? 'No se pudo consultar al servidor.'
                    : 'Todavía no hay ningún respaldo en el servidor. El primero sale solo en las próximas horas.'}
                </td>
              </tr>
            )}
            {respaldos.map((respaldo) => (
              <tr key={respaldo.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 font-semibold whitespace-nowrap text-slate-800">
                  <span className="inline-flex items-center gap-1.5">
                    <Icono nombre="tabla" tamano={13} className="text-slate-400" />
                    {respaldo.dia}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fecha(respaldo.fecha)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                  {respaldo.pestanas.toLocaleString('es-AR')} pestañas · {respaldo.filas.toLocaleString('es-AR')} filas
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">{tamano(respaldo.tamano)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                  {respaldo.hechoPor ?? <Etiqueta tono="neutro">{NOMBRE_MOTIVO_RESPALDO[respaldo.motivo]}</Etiqueta>}
                </td>
                {esSuperAdmin && (
                  <td className="px-3 py-2 text-right">
                    <Boton tamano="sm" variante="peligro" icono="renovaciones" onClick={() => setRestaurando(respaldo)}>
                      Restaurar
                    </Boton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {restaurando && (
        <DialogoRestaurar
          respaldo={restaurando}
          alCerrar={() => setRestaurando(null)}
          alRestaurar={(resumen) => {
            setRestaurando(null)
            setAviso(
              `Base restaurada al respaldo del ${restaurando.dia}: ${resumen.pestanas.toLocaleString('es-AR')} pestañas y ` +
                `${resumen.filas.toLocaleString('es-AR')} filas. Las otras computadoras lo van a ver en su próxima sincronización.`,
            )
            void cargar()
          }}
        />
      )}
    </Tarjeta>
  )
}

/**
 * El cartel de confirmación. Está modelado sobre el del borrado definitivo (`BotonEliminar`) porque es
 * el mismo tipo de acción: pisa datos de la agencia y no hay «deshacer» en la pantalla. Dice con todas
 * las letras qué se lleva puesto, y el botón se enciende recién a los cinco segundos.
 */
function DialogoRestaurar({
  respaldo,
  alCerrar,
  alRestaurar,
}: {
  respaldo: RespaldoDelVps
  alCerrar: () => void
  alRestaurar: (resumen: ResumenDeRestauracion) => void
}) {
  const [segundos, setSegundos] = useState(SEGUNDOS_PARA_CONFIRMAR)
  const [restaurando, setRestaurando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (segundos <= 0) return
    const reloj = setTimeout(() => setSegundos((previo) => previo - 1), 1000)
    return () => clearTimeout(reloj)
  }, [segundos])

  const confirmar = async () => {
    setRestaurando(true)
    setError(null)
    const resultado = await window.dm.respaldos.restaurar(respaldo.id)
    setRestaurando(false)
    if (resultado.ok) alRestaurar(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo={`Volver la base al ${respaldo.dia}`}
      descripcion="Esto rebobina el GENERAL DE CLIENTES de toda la agencia."
      alCerrar={restaurando ? () => undefined : alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={restaurando}>
            Cancelar
          </Boton>
          <Boton
            variante="peligro"
            icono="renovaciones"
            disabled={segundos > 0}
            cargando={restaurando}
            onClick={() => void confirmar()}
          >
            {segundos > 0 ? `Restaurar (${segundos})` : 'Restaurar'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Alerta tono="error">
          La base va a quedar exactamente como estaba el {respaldo.dia}, y{' '}
          <strong className="font-semibold">se descarta todo lo que se cargó desde entonces</strong>: altas, pagos,
          bajas y renovaciones, en las cinco computadoras. Lo que esta computadora tenga esperando para subir también se
          descarta.
        </Alerta>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Ese respaldo tiene</p>
          <p>
            {respaldo.pestanas.toLocaleString('es-AR')} pestañas y {respaldo.filas.toLocaleString('es-AR')} filas ·{' '}
            {tamano(respaldo.tamano)} · guardado el {fecha(respaldo.fecha)}
            {respaldo.hechoPor ? ` por ${respaldo.hechoPor}` : ' por el servidor'}.
          </p>
        </div>

        <Alerta tono="info">
          Antes de tocar nada, el servidor guarda una foto de cómo está la base AHORA. Si esto no era lo que había que
          hacer, esa foto queda en la lista y se puede volver a ella.
        </Alerta>

        <p className="text-xs leading-relaxed text-slate-500">
          Las otras computadoras quedan con lo restaurado en su próxima sincronización, sin que nadie tenga que tocar
          nada. Quién restauró y a qué respaldo queda en el historial, que no se borra nunca.
        </p>

        {error && <Alerta tono="error">{error}</Alerta>}
      </div>
    </Dialogo>
  )
}
