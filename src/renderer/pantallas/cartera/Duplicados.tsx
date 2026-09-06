// Cartera → Duplicados: lo que la sincronización dejó repetido, a la vista y con botón.
//
// Cinco listas, de más grave a menos: fichas de cliente que son la misma persona (se juntan en una
// con «Fusionar»), el mismo auto asegurado por dos pólizas a la vez (la misma póliza con el número
// escrito de dos formas: se juntan con «Juntar»), la misma póliza dos veces en un mes, la misma baja
// dos veces, y la póliza que está en la planilla Y en Bajas a la vez. Las fichas de mismo DNI el
// programa las junta solo; el resto lo decide una persona, porque dos homónimos son gente distinta y
// dos pólizas del mismo auto pueden ser una renovación.
//
// Lo puede usar cualquier rol que edite la cartera (o Clientes, para las fichas): lo pidió la agencia
// —«que estén repetidos, todos pueden»— y lo que acota es que sólo se toca lo que el detector señaló.
// Sacar un renglón usa el mismo cartel y los mismos cinco segundos de la papelera.
import { useCallback, useEffect, useRef, useState } from 'react'
import { resumenDeLoBorrado, SEGUNDOS_PARA_CONFIRMAR, type ResultadoDeEliminacion, type VistaPreviaDeEliminacion } from '../../../shared/eliminacion'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  NOMBRE_MOTIVO_REPETIDO,
  type ClienteRepetido,
  type GrupoDeBajasRepetidas,
  type GrupoDeClientesRepetidos,
  type GrupoDeCuotasRepetidas,
  type GrupoDePolizasDelMismoRiesgo,
  type InformeDeDuplicados,
  type PolizaEnLosDosLados,
  type PolizaRepetida,
} from '../../../shared/tipos'
import { useCuentaRegresiva } from '../../componentes/BotonEliminar'
import { BotonAyuda } from '../../componentes/Ayuda'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Dialogo, Etiqueta, Tarjeta } from '../../componentes/ui'
import { usePermisos } from '../../contexto/Permisos'
import { useNavegacion } from '../../contexto/Navegacion'

export function Duplicados() {
  const [informe, setInforme] = useState<InformeDeDuplicados | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const { puedeEditar } = usePermisos()
  const puedeTocarCartera = puedeEditar('cartera')
  const puedeTocarClientes = puedeEditar('clientes') || puedeTocarCartera

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.duplicados.listar()
    setCargando(false)
    if (resultado.ok) {
      setInforme(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (!informe) return error ? <div className="p-8"><Alerta tono="error">{error}</Alerta></div> : <Cargando />

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">
          {informe.total === 0
            ? 'No hay nada repetido. Se revisó ahora mismo, contra la base de esta computadora.'
            : `${informe.total} ${informe.total === 1 ? 'cosa' : 'cosas'} para mirar. Lo que se junta o se saca acá viaja a las otras computadoras con la sincronización.`}
        </p>
        <Boton tamano="sm" icono="refrescar" onClick={() => void cargar()} cargando={cargando} className="ml-auto">
          Volver a revisar
        </Boton>
        <BotonAyuda clave="cartera.duplicados" />
      </div>
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <SeccionClientes
        grupos={informe.clientes}
        puedeFusionar={puedeTocarClientes}
        alFusionar={(mensaje) => {
          setAviso(mensaje)
          void cargar()
        }}
      />
      <SeccionMismoRiesgo
        grupos={informe.polizasDelMismoRiesgo}
        puedeFusionar={puedeTocarCartera}
        alFusionar={(mensaje) => {
          setAviso(mensaje)
          void cargar()
        }}
      />
      <SeccionCuotas grupos={informe.cuotas} puedeSacar={puedeTocarCartera} alSacar={(m) => { setAviso(m); void cargar() }} />
      <SeccionBajas grupos={informe.bajas} puedeSacar={puedeTocarCartera} alSacar={(m) => { setAviso(m); void cargar() }} />
      <SeccionEnLosDosLados filas={informe.enLosDosLados} puedeSacar={puedeTocarCartera} alSacar={(m) => { setAviso(m); void cargar() }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

function SeccionClientes({
  grupos,
  puedeFusionar,
  alFusionar,
}: {
  grupos: GrupoDeClientesRepetidos[]
  puedeFusionar: boolean
  alFusionar: (mensaje: string) => void
}) {
  return (
    <Tarjeta
      titulo={`Fichas de cliente repetidas${grupos.length > 0 ? ` (${grupos.length})` : ''}`}
      descripcion="La misma persona cargada dos veces. «Fusionar» junta todo lo de una ficha en la otra (pólizas, cuotas, pagos, siniestros, tareas) y saca la que sobra. Las del mismo DNI el programa las junta solo al arrancar."
    >
      {grupos.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna ficha repetida.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => (
            <GrupoDeClientes key={grupo.clientes.map((c) => c.id).join('-')} grupo={grupo} puedeFusionar={puedeFusionar} alFusionar={alFusionar} />
          ))}
        </div>
      )}
    </Tarjeta>
  )
}

function GrupoDeClientes({
  grupo,
  puedeFusionar,
  alFusionar,
}: {
  grupo: GrupoDeClientesRepetidos
  puedeFusionar: boolean
  alFusionar: (mensaje: string) => void
}) {
  const sugerido = grupo.clientes.find((c) => c.sugerida) ?? grupo.clientes[0]!
  const [quedaId, setQuedaId] = useState<number>(sugerido.id)
  const [confirmando, setConfirmando] = useState<ClienteRepetido | null>(null)
  const { ir } = useNavegacion()
  const queda = grupo.clientes.find((c) => c.id === quedaId) ?? sugerido
  const otros = grupo.clientes.filter((c) => c.id !== queda.id)

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Etiqueta tono={grupo.motivo === 'dni' ? 'peligro' : 'aviso'}>{NOMBRE_MOTIVO_REPETIDO[grupo.motivo]}</Etiqueta>
        <span className="text-xs text-slate-500">Elegí cuál queda; las demás se juntan con ésa.</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {grupo.clientes.map((c) => (
          <label
            key={c.id}
            className={cx(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm',
              c.id === queda.id ? 'border-marino-500 bg-marino-50' : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <div className="flex items-center gap-2">
              <input type="radio" name={`queda-${grupo.clientes.map((x) => x.id).join('-')}`} checked={c.id === queda.id} onChange={() => setQuedaId(c.id)} />
              <span className="font-semibold text-slate-900">{c.nombre}</span>
              {c.sugerida && <Etiqueta tono="marca">Sugerida</Etiqueta>}
              <button type="button" className="ml-auto text-xs text-marino-700 hover:underline" onClick={() => ir('clientes', { clienteId: c.id })}>
                Ver ficha
              </button>
            </div>
            <div className="text-xs text-slate-600">
              {[c.documento ? `DNI/CUIT ${c.documento}` : 'sin documento', c.sucursal, c.telefono, c.email].filter(Boolean).join(' · ')}
            </div>
            <div className="text-xs text-slate-500">
              {c.polizas} póliza(s), {c.polizasActivas} vigente(s) · {c.cuotas} cuota(s) · {c.pagos} pago(s) · {c.siniestros} siniestro(s) · {c.tareas} tarea(s)
            </div>
          </label>
        ))}
      </div>
      {puedeFusionar && otros.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {otros.map((otro) => (
            <Boton key={otro.id} tamano="sm" variante="peligro" icono="enlace" onClick={() => setConfirmando(otro)}>
              Fusionar «{otro.nombre}» en «{queda.nombre}»
            </Boton>
          ))}
        </div>
      )}
      {confirmando && (
        <DialogoFusionar
          queda={queda}
          seVa={confirmando}
          alCerrar={() => setConfirmando(null)}
          alFusionar={(mensaje) => {
            setConfirmando(null)
            alFusionar(mensaje)
          }}
        />
      )}
    </div>
  )
}

function DialogoFusionar({
  queda,
  seVa,
  alCerrar,
  alFusionar,
}: {
  queda: ClienteRepetido
  seVa: ClienteRepetido
  alCerrar: () => void
  alFusionar: (mensaje: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const yaSalio = useRef(false)
  const restante = useCuentaRegresiva(SEGUNDOS_PARA_CONFIRMAR)

  const fusionar = async () => {
    if (yaSalio.current) return
    yaSalio.current = true
    setTrabajando(true)
    const resultado = await window.dm.duplicados.fusionarClientes(queda.id, seVa.id)
    setTrabajando(false)
    if (resultado.ok) {
      const movido = resumenDeLoBorrado(resultado.datos.movido)
      alFusionar(`Se juntaron las fichas: «${seVa.nombre}» pasó a «${resultado.datos.nombre}»${movido ? ` con ${movido}` : ''}.`)
      return
    }
    yaSalio.current = false
    setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo="Fusionar dos fichas"
      descripcion={`«${seVa.nombre}» se junta con «${queda.nombre}»`}
      alCerrar={trabajando ? () => undefined : alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={trabajando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="enlace" onClick={() => void fusionar()} disabled={restante > 0 || trabajando} cargando={trabajando}>
            {restante > 0 && !trabajando ? `Esperá ${restante} s…` : 'Fusionar'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        {error && <Alerta tono="error">{error}</Alerta>}
        <p>
          Todo lo de <strong>{seVa.nombre}</strong> —{seVa.polizas} póliza(s), {seVa.cuotas} cuota(s), {seVa.pagos} pago(s), {seVa.siniestros}{' '}
          siniestro(s), {seVa.tareas} tarea(s)— pasa a la ficha de <strong>{queda.nombre}</strong>, y la ficha de {seVa.nombre} se borra. Lo que a la
          ficha que queda le falte (teléfono, email, dirección, documento) se completa con lo de la otra.
        </p>
        <Alerta tono="aviso">
          No se puede deshacer. Si son dos personas distintas con el mismo nombre, no las fusiones: abrí las fichas y corregí el documento de
          la que esté mal.
        </Alerta>
        <p className="text-xs text-slate-500">Queda anotado en el historial: quién fusionó, cuándo y qué decía la ficha que se fue.</p>
      </div>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// El mismo auto asegurado dos veces
// ---------------------------------------------------------------------------

function loQueArrastra(p: PolizaRepetida): string {
  return [
    `${p.cuotas} renglón(es) en la planilla`,
    p.pagos > 0 ? `${p.pagos} pago(s)` : null,
    p.siniestros > 0 ? `${p.siniestros} siniestro(s)` : null,
    p.adjuntos > 0 ? `${p.adjuntos} adjunto(s)` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function SeccionMismoRiesgo({
  grupos,
  puedeFusionar,
  alFusionar,
}: {
  grupos: GrupoDePolizasDelMismoRiesgo[]
  puedeFusionar: boolean
  alFusionar: (mensaje: string) => void
}) {
  return (
    <Tarjeta
      titulo={`El mismo auto asegurado dos veces${grupos.length > 0 ? ` (${grupos.length})` : ''}`}
      descripcion="La misma póliza cargada con el número escrito de dos formas («40-02-357878» y «357878»): como el número es lo que la identifica, el programa la tomó por dos, y el auto aparece dos veces en la planilla. «Juntar» deja una sola póliza con todo lo de las dos; después, en «La misma póliza dos veces en el mismo mes», se saca el renglón que sobra, que es lo que viaja a la hoja y a las otras computadoras."
    >
      {grupos.length === 0 ? (
        <p className="text-sm text-slate-500">Ningún auto asegurado dos veces.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => (
            <GrupoDelMismoRiesgo
              key={grupo.polizas.map((p) => p.id).join('-')}
              grupo={grupo}
              puedeFusionar={puedeFusionar}
              alFusionar={alFusionar}
            />
          ))}
        </div>
      )}
    </Tarjeta>
  )
}

function GrupoDelMismoRiesgo({
  grupo,
  puedeFusionar,
  alFusionar,
}: {
  grupo: GrupoDePolizasDelMismoRiesgo
  puedeFusionar: boolean
  alFusionar: (mensaje: string) => void
}) {
  const sugerida = grupo.polizas.find((p) => p.sugerida) ?? grupo.polizas[0]!
  const [quedaId, setQuedaId] = useState<number>(sugerida.id)
  const [confirmando, setConfirmando] = useState<PolizaRepetida | null>(null)
  const queda = grupo.polizas.find((p) => p.id === quedaId) ?? sugerida
  const otras = grupo.polizas.filter((p) => p.id !== queda.id)

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{grupo.clienteNombre ?? 'Sin nombre'}</span>
        {grupo.compania && <Etiqueta>{grupo.compania}</Etiqueta>}
        {grupo.patente && <Etiqueta>{grupo.patente}</Etiqueta>}
        {grupo.periodosEnConflicto.map((periodo) => (
          <Etiqueta key={periodo} tono="aviso">
            Doble en {nombreDePeriodo(periodo)}
          </Etiqueta>
        ))}
      </div>
      <p className="mb-2 text-xs text-slate-500">Elegí cuál queda; la otra se junta con ésa. Conviene dejar la del número más completo.</p>
      <div className="grid gap-2 md:grid-cols-2">
        {grupo.polizas.map((p) => (
          <label
            key={p.id}
            className={cx(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm',
              p.id === queda.id ? 'border-marino-500 bg-marino-50' : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <div className="flex items-center gap-2">
              <input type="radio" name={`poliza-queda-${grupo.polizas.map((x) => x.id).join('-')}`} checked={p.id === queda.id} onChange={() => setQuedaId(p.id)} />
              <span className="font-semibold text-slate-900">{p.numero ?? 'Sin número'}</span>
              {p.sugerida && <Etiqueta tono="marca">Sugerida</Etiqueta>}
            </div>
            <div className="text-xs text-slate-600">
              {[p.cobertura, p.sucursal, p.vigenciaDesde ? `desde ${p.vigenciaDesde}` : null, p.vigenciaHasta ? `hasta ${p.vigenciaHasta}` : null]
                .filter(Boolean)
                .join(' · ') || 'sin cobertura ni vigencia cargadas'}
            </div>
            <div className="text-xs text-slate-500">{loQueArrastra(p)}</div>
          </label>
        ))}
      </div>
      {puedeFusionar && otras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {otras.map((otra) => (
            <Boton key={otra.id} tamano="sm" variante="peligro" icono="enlace" onClick={() => setConfirmando(otra)}>
              Juntar «{otra.numero ?? 'sin número'}» con «{queda.numero ?? 'sin número'}»
            </Boton>
          ))}
        </div>
      )}
      {confirmando && (
        <DialogoJuntarPolizas
          grupo={grupo}
          queda={queda}
          seVa={confirmando}
          alCerrar={() => setConfirmando(null)}
          alFusionar={(mensaje) => {
            setConfirmando(null)
            alFusionar(mensaje)
          }}
        />
      )}
    </div>
  )
}

function DialogoJuntarPolizas({
  grupo,
  queda,
  seVa,
  alCerrar,
  alFusionar,
}: {
  grupo: GrupoDePolizasDelMismoRiesgo
  queda: PolizaRepetida
  seVa: PolizaRepetida
  alCerrar: () => void
  alFusionar: (mensaje: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const yaSalio = useRef(false)
  const restante = useCuentaRegresiva(SEGUNDOS_PARA_CONFIRMAR)

  const fusionar = async () => {
    if (yaSalio.current) return
    yaSalio.current = true
    setTrabajando(true)
    const resultado = await window.dm.duplicados.fusionarPolizas(queda.id, seVa.id)
    setTrabajando(false)
    if (resultado.ok) {
      const movido = resumenDeLoBorrado(resultado.datos.movido)
      const juntos = resultado.datos.renglonesQueQuedanJuntos
      alFusionar(
        `Quedó una sola póliza (${resultado.datos.titulo})${movido ? ` con ${movido}` : ''}.` +
          (juntos > 1
            ? ` Ahora los ${juntos} renglones cuelgan de ella: sacá el que sobra en «La misma póliza dos veces en el mismo mes», acá abajo, para que no vuelvan con la próxima importación.`
            : ''),
      )
      return
    }
    yaSalio.current = false
    setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo="Juntar dos pólizas del mismo auto"
      descripcion={`${grupo.compania ?? ''} ${grupo.patente ?? ''} · «${seVa.numero ?? 'sin número'}» se junta con «${queda.numero ?? 'sin número'}»`.trim()}
      alCerrar={trabajando ? () => undefined : alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={trabajando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="enlace" onClick={() => void fusionar()} disabled={restante > 0 || trabajando} cargando={trabajando}>
            {restante > 0 && !trabajando ? `Esperá ${restante} s…` : 'Juntar'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        {error && <Alerta tono="error">{error}</Alerta>}
        <p>
          Todo lo de <strong>{seVa.numero ?? 'la póliza sin número'}</strong> —{loQueArrastra(seVa)}— pasa a{' '}
          <strong>{queda.numero ?? 'la póliza sin número'}</strong>, y la otra póliza se borra. El cliente y el vehículo no se tocan.
        </p>
        <Alerta tono="aviso">
          No se puede deshacer. Si no es la misma póliza escrita de dos formas —por ejemplo, si una es la renovación de la otra— no las juntes:
          dale de baja a la que ya no corre desde Pólizas.
        </Alerta>
        <p className="text-xs text-slate-500">
          Con esto la póliza deja de estar dos veces en esta computadora. Para que no vuelva con la próxima importación falta sacar el renglón
          que sobra de la planilla, que es lo que viaja a la hoja y a las otras computadoras. Queda anotado en el historial: quién la juntó,
          cuándo y qué decía la que se fue.
        </p>
      </div>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Cuotas, bajas y «en los dos lados»
// ---------------------------------------------------------------------------

function tituloDePoliza(g: { clienteNombre: string | null; compania: string | null; numeroPoliza: string | null }): string {
  return [g.clienteNombre ?? 'Sin nombre', g.compania, g.numeroPoliza].filter(Boolean).join(' · ')
}

function SeccionCuotas({ grupos, puedeSacar, alSacar }: { grupos: GrupoDeCuotasRepetidas[]; puedeSacar: boolean; alSacar: (m: string) => void }) {
  const [sacando, setSacando] = useState<{ cuotaId: number; titulo: string } | null>(null)
  return (
    <Tarjeta
      titulo={`La misma póliza dos veces en el mismo mes${grupos.length > 0 ? ` (${grupos.length})` : ''}`}
      descripcion="Dos renglones de la planilla para una sola póliza. El programa deja el que tiene un cobro colgando o el de más arriba; el otro se saca con la misma cascada de la papelera."
    >
      {grupos.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna póliza repetida en la planilla.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => (
            <div key={`${g.periodo}-${g.polizaId}`} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{tituloDePoliza(g)}</span>
                {g.patente && <Etiqueta>{g.patente}</Etiqueta>}
                <Etiqueta tono="neutro">{nombreDePeriodo(g.periodo)}</Etiqueta>
              </div>
              <ul className="flex flex-col gap-1">
                {g.cuotas.map((c) => (
                  <li key={c.cuotaId} className="flex flex-wrap items-center gap-2 text-slate-700">
                    <Icono nombre={c.sugeridaParaQuedar ? 'ok' : 'alerta'} tamano={14} className={c.sugeridaParaQuedar ? 'text-green-600' : 'text-amber-700'} />
                    <span>
                      {c.pestana}, renglón {c.numeroFila || '?'} · cuota {c.cuota ?? '—'} · {c.pago ? `pago ${c.pago}` : 'sin pagar'}
                      {c.sucursal ? ` · ${c.sucursal}` : ''}
                    </span>
                    {c.sugeridaParaQuedar && <Etiqueta tono="exito">Queda</Etiqueta>}
                    {c.atada && <Etiqueta tono="aviso">Con cobro, baja o aviso colgando</Etiqueta>}
                    {puedeSacar && !c.sugeridaParaQuedar && (
                      <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setSacando({ cuotaId: c.cuotaId, titulo: tituloDePoliza(g) })}>
                        Sacar este renglón
                      </Boton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {sacando && (
        <DialogoSacar
          titulo="Sacar el renglón repetido"
          descripcion={sacando.titulo}
          vistaPrevia={() => window.dm.duplicados.vistaPreviaCuota(sacando.cuotaId)}
          sacar={() => window.dm.duplicados.sacarCuota(sacando.cuotaId)}
          alCerrar={() => setSacando(null)}
          alSacar={(r) => {
            setSacando(null)
            alSacar(`Se sacó el renglón repetido de ${r.titulo}.`)
          }}
        />
      )}
    </Tarjeta>
  )
}

function SeccionBajas({ grupos, puedeSacar, alSacar }: { grupos: GrupoDeBajasRepetidas[]; puedeSacar: boolean; alSacar: (m: string) => void }) {
  const [sacando, setSacando] = useState<{ bajaId: number; titulo: string } | null>(null)
  return (
    <Tarjeta
      titulo={`La misma baja dos veces${grupos.length > 0 ? ` (${grupos.length})` : ''}`}
      descripcion="Una póliza dada de baja dos veces en el mismo mes. Queda la que hizo el programa; la otra se saca."
    >
      {grupos.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna baja repetida.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => (
            <div key={`${g.periodo}-${g.polizaId}`} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{tituloDePoliza(g)}</span>
                <Etiqueta tono="neutro">{nombreDePeriodo(g.periodo)}</Etiqueta>
              </div>
              <ul className="flex flex-col gap-1">
                {g.bajas.map((b) => (
                  <li key={b.bajaId} className="flex flex-wrap items-center gap-2 text-slate-700">
                    <Icono nombre={b.sugeridaParaQuedar ? 'ok' : 'alerta'} tamano={14} className={b.sugeridaParaQuedar ? 'text-green-600' : 'text-amber-700'} />
                    <span>
                      {b.motivo ?? 'sin motivo'} · {b.fecha ?? 'sin fecha'} · {b.hechaEnLaApp ? 'hecha en el programa' : 'venía de la hoja'}
                    </span>
                    {b.sugeridaParaQuedar && <Etiqueta tono="exito">Queda</Etiqueta>}
                    {puedeSacar && !b.sugeridaParaQuedar && (
                      <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setSacando({ bajaId: b.bajaId, titulo: tituloDePoliza(g) })}>
                        Sacar esta baja
                      </Boton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {sacando && (
        <DialogoSacar
          titulo="Sacar la baja repetida"
          descripcion={sacando.titulo}
          vistaPrevia={() => window.dm.duplicados.vistaPreviaBaja(sacando.bajaId)}
          sacar={() => window.dm.duplicados.sacarBaja(sacando.bajaId)}
          alCerrar={() => setSacando(null)}
          alSacar={(r) => {
            setSacando(null)
            alSacar(`Se sacó la baja repetida de ${r.titulo}.`)
          }}
        />
      )}
    </Tarjeta>
  )
}

function SeccionEnLosDosLados({ filas, puedeSacar, alSacar }: { filas: PolizaEnLosDosLados[]; puedeSacar: boolean; alSacar: (m: string) => void }) {
  const [sacando, setSacando] = useState<{ tipo: 'cuota' | 'baja'; id: number; titulo: string } | null>(null)
  return (
    <Tarjeta
      titulo={`En la planilla y en Bajas a la vez${filas.length > 0 ? ` (${filas.length})` : ''}`}
      descripcion="Una póliza que en el mismo mes figura viva en la planilla y además tiene una baja: una baja que no llegó a sacar el renglón, o un «Poner vigente» que no llegó a sacar la baja. Hay que decidir cuál de las dos cosas es la verdad. Si acaban de darla de baja o de reactivarla, esperá un minuto y volvé a revisar: la sincronización puede estar terminando de acomodarla."
    >
      {filas.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna póliza en los dos lados.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filas.map((f) => (
            <div key={`${f.periodo}-${f.cuota.cuotaId}-${f.baja.bajaId}`} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{tituloDePoliza(f)}</span>
                <Etiqueta tono="neutro">{nombreDePeriodo(f.periodo)}</Etiqueta>
              </div>
              <div className="flex flex-col gap-1 text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <Icono nombre="tabla" tamano={14} className="text-slate-500" />
                  <span>
                    En la planilla ({f.cuota.pestana}) · {f.cuota.pago ? `pago ${f.cuota.pago}` : 'sin pagar'}
                  </span>
                  {puedeSacar && (
                    <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setSacando({ tipo: 'cuota', id: f.cuota.cuotaId, titulo: tituloDePoliza(f) })}>
                      Se fue: sacarla de la planilla
                    </Boton>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Icono nombre="cerrar" tamano={14} className="text-slate-500" />
                  <span>
                    En Bajas · {f.baja.motivo ?? 'sin motivo'} · {f.baja.fecha ?? 'sin fecha'}
                  </span>
                  {puedeSacar && (
                    <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setSacando({ tipo: 'baja', id: f.baja.bajaId, titulo: tituloDePoliza(f) })}>
                      Sigue: sacar la baja
                    </Boton>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {sacando && (
        <DialogoSacar
          titulo={sacando.tipo === 'cuota' ? 'Sacar el renglón de la planilla' : 'Sacar la baja'}
          descripcion={sacando.titulo}
          vistaPrevia={() => (sacando.tipo === 'cuota' ? window.dm.duplicados.vistaPreviaCuota(sacando.id) : window.dm.duplicados.vistaPreviaBaja(sacando.id))}
          sacar={() => (sacando.tipo === 'cuota' ? window.dm.duplicados.sacarCuota(sacando.id) : window.dm.duplicados.sacarBaja(sacando.id))}
          alCerrar={() => setSacando(null)}
          alSacar={(r) => {
            setSacando(null)
            alSacar(`Listo: ${r.titulo} quedó de un solo lado.`)
          }}
        />
      )}
    </Tarjeta>
  )
}

/** El cartel de sacar: la vista previa de la papelera y los mismos cinco segundos. */
function DialogoSacar({
  titulo,
  descripcion,
  vistaPrevia,
  sacar,
  alCerrar,
  alSacar,
}: {
  titulo: string
  descripcion: string
  vistaPrevia: () => Promise<{ ok: true; datos: VistaPreviaDeEliminacion } | { ok: false; error: string }>
  sacar: () => Promise<{ ok: true; datos: ResultadoDeEliminacion } | { ok: false; error: string }>
  alCerrar: () => void
  alSacar: (resultado: ResultadoDeEliminacion) => void
}) {
  const [vista, setVista] = useState<VistaPreviaDeEliminacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const yaSalio = useRef(false)
  const restante = useCuentaRegresiva(vista !== null ? SEGUNDOS_PARA_CONFIRMAR : null)

  useEffect(() => {
    let vigente = true
    void vistaPrevia().then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setVista(resultado.datos)
      else setError(resultado.error)
    })
    return () => {
      vigente = false
    }
    // La vista previa se pide una vez al abrir el cartel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmar = async () => {
    if (yaSalio.current) return
    yaSalio.current = true
    setTrabajando(true)
    const resultado = await sacar()
    setTrabajando(false)
    if (resultado.ok) {
      alSacar(resultado.datos)
      return
    }
    yaSalio.current = false
    setError(resultado.error)
  }

  const listo = vista !== null && restante === 0
  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo={titulo}
      descripcion={descripcion}
      alCerrar={trabajando ? () => undefined : alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={trabajando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="basura" onClick={() => void confirmar()} disabled={!listo || trabajando} cargando={trabajando}>
            {vista !== null && restante > 0 && !trabajando ? `Esperá ${restante} s…` : 'Sacar'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        {error && <Alerta tono="error">{error}</Alerta>}
        {vista === null ? (
          !error && <p className="text-slate-500">Viendo qué se lleva puesto…</p>
        ) : (
          <>
            {vista.detalle.map((linea) => (
              <p key={linea}>{linea}</p>
            ))}
            {vista.arrastra.length > 0 && (
              <p>
                Se va también: <strong>{resumenDeLoBorrado(vista.arrastra)}</strong>.
              </p>
            )}
            {vista.filasDeLaHoja > 0 && <p className="text-slate-600">El renglón sale de la base compartida en cuanto la sincronización lo suba.</p>}
            {vista.advertencias.map((a) => (
              <Alerta key={a} tono="aviso">
                {a}
              </Alerta>
            ))}
          </>
        )}
      </div>
    </Dialogo>
  )
}
