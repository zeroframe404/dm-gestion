// Compañías: sus días de cobertura financiera (los que siguen cubriendo después del vencimiento) y la
// plantilla del aviso por WhatsApp. Las dos cosas cambian lo que ve la gente en la planilla del mes.
//
// La pantalla la MIRA todo el equipo, con el rol que sea: los días de cobertura son los que decidieron
// el color de la fila que el mostrador tiene delante, y saber si una compañía renueva sola o a mano es
// la mitad de una llamada. Tocarla sigue siendo de administradores, y el porcentaje de comisión —que
// es lo que gana la agencia— ni siquiera llega a un empleado: el proceso principal lo manda en null.
import { useCallback, useEffect, useState } from 'react'
import { PLANTILLA_AVISO_POR_DEFECTO, type Compania } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Cargando, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar, useVeNumerosDeLaAgencia } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

export function Companias() {
  // Con Administración en «sólo ver» la pantalla se consulta pero no se toca: el proceso principal
  // rechaza igual estos guardados, así que no tiene sentido dejar los campos habilitados.
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && usuario.rol !== 'EMPLEADO'
  const verComision = useVeNumerosDeLaAgencia()
  const [companias, setCompanias] = useState<Compania[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [plantilla, setPlantilla] = useState('')
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [lista, texto] = await Promise.all([window.dm.companias.listar(), window.dm.config.plantillaAviso()])
    if (lista.ok) setCompanias(lista.datos)
    else setError(lista.error)
    if (texto.ok) setPlantilla(texto.datos.texto)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Los números de la fila se guardan por el mismo camino: se manda la compañía entera. */
  const guardar = async (compania: Compania, cambios: Partial<Compania>, resumen: string) => {
    setError(null)
    const resultado = await window.dm.companias.editar(compania.id, {
      nombre: compania.nombre,
      diasCoberturaFinanciera: cambios.diasCoberturaFinanciera ?? compania.diasCoberturaFinanciera,
      // Sin permiso para verla, el porcentaje llegó en null y no se puede reenviar: se manda 0, que es
      // lo que el proceso principal entiende como «no cargado». En la práctica no pasa: quien no lo ve
      // tampoco puede guardar.
      comisionPorcentaje: cambios.comisionPorcentaje ?? compania.comisionPorcentaje ?? 0,
      // Con ?? no alcanza: acá null es un valor («renueva sola»), no un campo que no vino.
      mesesRenovacion: 'mesesRenovacion' in cambios ? (cambios.mesesRenovacion ?? null) : compania.mesesRenovacion,
      activa: compania.activa,
    })
    if (resultado.ok) {
      setCompanias((previas) => previas.map((c) => (c.id === resultado.datos.id ? resultado.datos : c)))
      setAviso(resumen)
    } else {
      setError(resultado.error)
    }
  }

  const guardarPlantilla = async () => {
    setGuardandoPlantilla(true)
    setError(null)
    const resultado = await window.dm.config.guardarPlantillaAviso(plantilla)
    setGuardandoPlantilla(false)
    if (resultado.ok) setAviso('Plantilla del aviso guardada.')
    else setError(resultado.error)
  }

  if (cargando) return <Cargando />

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Compañías"
        descripcion="Los días de cobertura financiera son los que cada compañía sigue cubriendo al cliente después del vencimiento: mientras corren, la fila de la planilla queda amarilla; el último día, naranja; después, roja. Los meses de renovación son cada cuánto hay que renovar a mano en esa compañía (Agrosalta 4, Río Uruguay 6, Metropol 12): las que quedan vacías renuevan solas y no aparecen en la bandeja de Renovaciones."
        alRas
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className={encabezado}>Compañía</th>
                <th className={cx(encabezado, 'text-right')}>Pólizas activas</th>
                <th className={cx(encabezado, 'text-right')}>Días de cobertura</th>
                {verComision && <th className={cx(encabezado, 'text-right')}>Comisión (%)</th>}
                <th className={cx(encabezado, 'text-right')}>Renovación (meses)</th>
              </tr>
            </thead>
            <tbody>
              {companias.length === 0 && (
                <tr>
                  <td colSpan={verComision ? 5 : 4} className="px-3 py-8 text-center text-slate-500">
                    Todavía no hay compañías: se dan de alta solas al importar la hoja.
                  </td>
                </tr>
              )}
              {companias.map((compania) => (
                <tr key={compania.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-medium text-slate-900">{compania.nombre}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{compania.polizas.toLocaleString('es-AR')}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      aria-label={`Días de cobertura de ${compania.nombre}`}
                      disabled={!puedeEditar}
                      defaultValue={compania.diasCoberturaFinanciera}
                      onBlur={(evento) => {
                        // Dejar el campo vacío no es «cero»: es no haber escrito nada, y se devuelve
                        // el valor que había en vez de guardar un 0 que nadie pidió.
                        const escrito = evento.currentTarget.value.trim()
                        if (!escrito) {
                          evento.currentTarget.value = String(compania.diasCoberturaFinanciera)
                          return
                        }
                        const dias = Number(escrito)
                        if (Number.isInteger(dias) && dias !== compania.diasCoberturaFinanciera) {
                          void guardar(compania, { diasCoberturaFinanciera: dias }, `${compania.nombre}: ${dias} días de cobertura financiera.`)
                        }
                      }}
                      className="h-8 w-20 rounded border border-slate-300 px-2 text-right text-sm tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </td>
                  {compania.comisionPorcentaje !== null && (
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        aria-label={`Comisión de ${compania.nombre}`}
                        disabled={!puedeEditar}
                        defaultValue={compania.comisionPorcentaje}
                        onBlur={(evento) => {
                          const escrito = evento.currentTarget.value.trim()
                          if (!escrito) {
                            evento.currentTarget.value = String(compania.comisionPorcentaje)
                            return
                          }
                          const comision = Number(escrito)
                          if (Number.isFinite(comision) && comision !== compania.comisionPorcentaje) {
                            void guardar(compania, { comisionPorcentaje: comision }, `${compania.nombre}: ${comision} % de comisión.`)
                          }
                        }}
                        className="h-8 w-20 rounded border border-slate-300 px-2 text-right text-sm tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      placeholder="renueva sola"
                      aria-label={`Meses entre renovaciones de ${compania.nombre}`}
                      disabled={!puedeEditar}
                      defaultValue={compania.mesesRenovacion ?? ''}
                      onBlur={(evento) => {
                        // Acá el campo vacío SÍ quiere decir algo: «esta compañía renueva sola».
                        const escrito = evento.currentTarget.value.trim()
                        const meses = escrito === '' ? null : Number(escrito)
                        if (meses !== null && !Number.isInteger(meses)) {
                          evento.currentTarget.value = compania.mesesRenovacion === null ? '' : String(compania.mesesRenovacion)
                          return
                        }
                        if (meses !== compania.mesesRenovacion) {
                          void guardar(
                            compania,
                            { mesesRenovacion: meses },
                            meses === null
                              ? `${compania.nombre}: renueva sola, sale de la bandeja de renovaciones.`
                              : `${compania.nombre}: se renueva a mano cada ${meses} ${meses === 1 ? 'mes' : 'meses'}.`,
                          )
                        }
                      }}
                      className="h-8 w-28 rounded border border-slate-300 px-2 text-right text-sm tabular-nums placeholder:text-[11px] placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Mensaje de aviso por WhatsApp"
        descripcion="Lo que se manda al tocar «Avisar» en la planilla. Se pueden usar {nombre}, {cuota} y {vencimiento}."
        acciones={
          puedeEditar && (
            <>
              <Boton onClick={() => setPlantilla(PLANTILLA_AVISO_POR_DEFECTO)}>Restaurar el original</Boton>
              <Boton variante="primario" icono="ok" onClick={() => void guardarPlantilla()} cargando={guardandoPlantilla}>
                Guardar
              </Boton>
            </>
          )
        }
      >
        <AreaTexto etiqueta="Plantilla" rows={4} value={plantilla} disabled={!puedeEditar} onChange={(evento) => setPlantilla(evento.target.value)} />
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Así se ve</span>
          {plantilla.replace('{nombre}', 'María').replace('{cuota}', '44.800').replace('{vencimiento}', '11')}
        </p>
      </Tarjeta>
    </div>
  )
}
