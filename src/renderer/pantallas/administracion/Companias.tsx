// Compañías: sus días de cobertura financiera (los que siguen cubriendo después del vencimiento) y la
// plantilla del aviso por WhatsApp. Las dos cosas cambian lo que ve la gente en la planilla del mes.
import { useCallback, useEffect, useState } from 'react'
import { PLANTILLA_AVISO_POR_DEFECTO, type Compania } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Cargando, Tarjeta, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'

export function Companias() {
  // Con Administración en «sólo ver» la pantalla se consulta pero no se toca: el proceso principal
  // rechaza igual estos guardados, así que no tiene sentido dejar los campos habilitados.
  const puedeEditar = usePuedeEditar('administracion')
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

  /** Los dos números de la fila se guardan por el mismo camino: se manda la compañía entera. */
  const guardar = async (compania: Compania, cambios: Partial<Compania>, resumen: string) => {
    setError(null)
    const resultado = await window.dm.companias.editar(compania.id, {
      nombre: compania.nombre,
      diasCoberturaFinanciera: cambios.diasCoberturaFinanciera ?? compania.diasCoberturaFinanciera,
      comisionPorcentaje: cambios.comisionPorcentaje ?? compania.comisionPorcentaje,
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
        descripcion="Los días de cobertura financiera son los que cada compañía sigue cubriendo al cliente después del vencimiento: mientras corren, la fila de la planilla queda amarilla; el último día, naranja; después, roja. El porcentaje de comisión es el que usa Cobranzas → Comisiones para estimar lo que deja cada mes."
        alRas
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className={encabezado}>Compañía</th>
                <th className={cx(encabezado, 'text-right')}>Pólizas activas</th>
                <th className={cx(encabezado, 'text-right')}>Días de cobertura</th>
                <th className={cx(encabezado, 'text-right')}>Comisión (%)</th>
              </tr>
            </thead>
            <tbody>
              {companias.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
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
