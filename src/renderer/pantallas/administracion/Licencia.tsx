// Administración → Licencia (sólo el superadministrador): qué licencia tiene la agencia, cuándo vence,
// cuántas computadoras puede tener abiertas y cuáles las están ocupando. Desde acá se pega la licencia
// nueva al renovar y se libera el puesto de una computadora que ya no se usa.
import { useCallback, useEffect, useState } from 'react'
import { fechaDeLicencia, type EstadoDeLicencia, type PuestoOcupado } from '../../../shared/licencia'
import { Alerta, AreaTexto, Boton, Etiqueta, Tarjeta, haceCuanto } from '../../componentes/ui'
import { useLicencia } from '../../contexto/Licencia'

const NOMBRES: Record<EstadoDeLicencia['estado'], { texto: string; tono: 'exito' | 'aviso' | 'peligro' | 'neutro' }> = {
  exenta: { texto: 'Sin control de licencia', tono: 'neutro' },
  vigente: { texto: 'Vigente', tono: 'exito' },
  por_vencer: { texto: 'Por vencer', tono: 'aviso' },
  en_gracia: { texto: 'Vencida · en gracia', tono: 'peligro' },
  vencida: { texto: 'Vencida', tono: 'peligro' },
  falta: { texto: 'Sin licencia', tono: 'peligro' },
  invalida: { texto: 'No válida', tono: 'peligro' },
}

export function Licencia() {
  const { estado, releer, usar } = useLicencia()
  const [puestos, setPuestos] = useState<PuestoOcupado[] | null>(null)
  const [errorPuestos, setErrorPuestos] = useState<string | null>(null)
  const [liberando, setLiberando] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [instalando, setInstalando] = useState(false)
  const [errorLicencia, setErrorLicencia] = useState<string | null>(null)
  const [instalada, setInstalada] = useState(false)

  const cargarPuestos = useCallback(async () => {
    const resultado = await window.dm.licencia.puestos()
    if (resultado.ok) {
      setPuestos(resultado.datos)
      setErrorPuestos(null)
    } else setErrorPuestos(resultado.error)
  }, [])

  useEffect(() => {
    void cargarPuestos()
  }, [cargarPuestos])

  async function instalar() {
    setInstalando(true)
    setErrorLicencia(null)
    setInstalada(false)
    const resultado = await window.dm.licencia.instalar(texto)
    setInstalando(false)
    if (!resultado.ok) {
      setErrorLicencia(resultado.error)
      return
    }
    usar(resultado.datos)
    setTexto('')
    setInstalada(true)
  }

  async function liberar(clave: string) {
    setLiberando(clave)
    const resultado = await window.dm.licencia.liberar(clave)
    setLiberando(null)
    if (!resultado.ok) {
      setErrorPuestos(resultado.error)
      return
    }
    usar(resultado.datos)
    await cargarPuestos()
  }

  if (!estado) return null
  const nombre = NOMBRES[estado.estado]
  const exenta = estado.estado === 'exenta'

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Tarjeta
        titulo="Licencia de la agencia"
        descripcion="La licencia dice hasta cuándo se puede usar DM Gestión y en cuántas computadoras a la vez."
        acciones={
          <Boton
            onClick={() => {
              void releer()
              void cargarPuestos()
            }}
          >
            Actualizar
          </Boton>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <Etiqueta tono={nombre.tono}>{nombre.texto}</Etiqueta>
          </div>
          {exenta ? (
            <p className="text-sm text-slate-600">El servidor de esta agencia no controla licencias: no hay vencimiento ni límite de computadoras.</p>
          ) : (
            <>
              {estado.estado !== 'vigente' && <Alerta tono={estado.permiteIngresar ? 'aviso' : 'error'}>{estado.mensaje}</Alerta>}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-slate-500">Titular</dt>
                <dd className="text-slate-900">{estado.titular || '—'}</dd>
                <dt className="text-slate-500">Plan</dt>
                <dd className="text-slate-900">{estado.plan || '—'}</dd>
                <dt className="text-slate-500">Vence</dt>
                <dd className="text-slate-900">{fechaDeLicencia(estado.vence)}</dd>
                <dt className="text-slate-500">Computadoras en uso</dt>
                <dd className="text-slate-900">
                  {estado.usados ?? '—'} de {estado.puestos ?? '—'}
                </dd>
              </dl>
            </>
          )}
        </div>
      </Tarjeta>

      {!exenta && (
        <Tarjeta
          titulo="Computadoras en uso"
          descripcion="Cada computadora con una sesión abierta ocupa un puesto. «Liberar» cierra las sesiones de esa computadora: quien esté trabajando ahí tiene que volver a ingresar."
        >
          <div className="flex flex-col gap-3">
            {errorPuestos && <Alerta tono="error">{errorPuestos}</Alerta>}
            {puestos && puestos.length === 0 && <p className="text-sm text-slate-600">No hay computadoras con sesión abierta.</p>}
            {puestos?.map((puesto) => (
              <div key={puesto.clave} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{puesto.equipo}</p>
                  <p className="truncate text-xs text-slate-500">
                    {puesto.usuarios.join(', ')} · {haceCuanto(puesto.ultimoUso)}
                    {puesto.app ? ` · versión ${puesto.app}` : ''}
                  </p>
                </div>
                <Boton cargando={liberando === puesto.clave} onClick={() => void liberar(puesto.clave)}>
                  Liberar
                </Boton>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {!exenta && (
        <Tarjeta
          titulo="Renovar la licencia"
          descripcion="Pegá acá la licencia nueva que te mandaron (empieza con «dmgl1.»). Queda instalada para todas las computadoras de la agencia."
        >
          <div className="flex flex-col gap-3">
            <AreaTexto
              etiqueta="Licencia nueva"
              rows={4}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="dmgl1.…"
            />
            {errorLicencia && <Alerta tono="error">{errorLicencia}</Alerta>}
            {instalada && <Alerta tono="exito">Licencia instalada. Vence el {fechaDeLicencia(estado.vence)}.</Alerta>}
            <div>
              <Boton variante="primario" cargando={instalando} disabled={!texto.trim()} onClick={() => void instalar()}>
                Instalar licencia
              </Boton>
            </div>
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
