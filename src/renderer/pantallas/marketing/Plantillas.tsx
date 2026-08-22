// Marketing → Plantillas: los mensajes de WhatsApp que la agencia manda una y otra vez.
//
// La plantilla «Aviso de vencimiento» es la del botón «Avisar» de la Cartera y de la Mora: se le
// cambia el texto y el botón manda el texto nuevo desde el clic siguiente. Por eso está marcada y no
// se puede borrar. Las demás se usan desde los segmentos.
import { useCallback, useEffect, useState } from 'react'
import { VARIABLES_DE_PLANTILLA, type PlantillaDeMensaje } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Etiqueta, Tarjeta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

export function Plantillas() {
  const usuario = useUsuarioActual()
  const puedeEditar = usuario.rol !== 'EMPLEADO'

  const [plantillas, setPlantillas] = useState<PlantillaDeMensaje[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.marketing.plantillas()
    if (resultado.ok) setPlantillas(resultado.datos)
    else setError(resultado.error)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (!plantillas) {
    return error ? (
      <div className="p-8">
        <Alerta tono="error">{error}</Alerta>
      </div>
    ) : (
      <Cargando texto="Buscando las plantillas…" />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-600">
          Los mensajes se arman con estas variables, que se reemplazan por los datos de cada cliente al momento de escribirle:{' '}
          {VARIABLES_DE_PLANTILLA.map((variable) => (
            <code key={variable} className="mx-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-marino-800">
              {`{${variable}}`}
            </code>
          ))}
          .
        </p>
        {puedeEditar && (
          <Boton variante="primario" icono="mas" onClick={() => setCreando(true)}>
            Nueva plantilla
          </Boton>
        )}
      </div>

      {!puedeEditar && <Alerta tono="info">Las plantillas las edita un administrador. Vos podés verlas y usarlas desde los segmentos.</Alerta>}
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {plantillas.map((plantilla) => (
        <FichaDePlantilla
          key={plantilla.clave}
          plantilla={plantilla}
          puedeEditar={puedeEditar}
          alGuardar={(nuevas, mensaje) => {
            setPlantillas(nuevas)
            setAviso(mensaje)
            setError(null)
          }}
          alFallar={(motivo) => {
            setError(motivo)
            setAviso(null)
          }}
        />
      ))}

      <DialogoDeNuevaPlantilla
        abierto={creando}
        alCerrar={() => setCreando(false)}
        alCrear={(nuevas) => {
          setPlantillas(nuevas)
          setAviso('Plantilla creada.')
          setCreando(false)
        }}
      />
    </div>
  )
}

interface PropsFicha {
  plantilla: PlantillaDeMensaje
  puedeEditar: boolean
  alGuardar: (plantillas: PlantillaDeMensaje[], aviso: string) => void
  alFallar: (motivo: string) => void
}

function FichaDePlantilla({ plantilla, puedeEditar, alGuardar, alFallar }: PropsFicha) {
  const [nombre, setNombre] = useState(plantilla.nombre)
  const [texto, setTexto] = useState(plantilla.texto)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)

  // Si la plantilla cambió del lado del servidor (otro guardado), la ficha se pone al día.
  useEffect(() => {
    setNombre(plantilla.nombre)
    setTexto(plantilla.texto)
  }, [plantilla.nombre, plantilla.texto])

  const sinCambios = nombre === plantilla.nombre && texto === plantilla.texto

  async function guardar() {
    setGuardando(true)
    const resultado = await window.dm.marketing.editarPlantilla(plantilla.clave, { nombre, descripcion: plantilla.descripcion ?? '', texto })
    if (resultado.ok) alGuardar(resultado.datos, `«${nombre}» guardada.`)
    else alFallar(resultado.error)
    setGuardando(false)
  }

  async function borrar() {
    setGuardando(true)
    const resultado = await window.dm.marketing.borrarPlantilla(plantilla.clave)
    if (resultado.ok) alGuardar(resultado.datos, `«${plantilla.nombre}» borrada.`)
    else alFallar(resultado.error)
    setGuardando(false)
    setBorrando(false)
  }

  return (
    <Tarjeta
      className="shrink-0"
      titulo={plantilla.nombre}
      descripcion={plantilla.descripcion}
      acciones={
        <>
          {plantilla.fija && <Etiqueta tono="marca">La usa «Avisar»</Etiqueta>}
          {puedeEditar && !plantilla.fija && (
            <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setBorrando(true)}>
              Borrar
            </Boton>
          )}
          {puedeEditar && (
            <Boton tamano="sm" variante="primario" onClick={() => void guardar()} cargando={guardando} disabled={sinCambios}>
              Guardar
            </Boton>
          )}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {!plantilla.fija && (
            <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!puedeEditar} maxLength={60} />
          )}
          <AreaTexto
            etiqueta="Mensaje"
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={!puedeEditar}
            maxLength={1000}
            ayuda={`${texto.length}/1000 caracteres`}
          />
        </div>
        <div>
          <span className="text-sm font-medium text-slate-700">Así le llega al cliente</span>
          <div className="mt-1.5 rounded-2xl rounded-bl-sm border border-green-200 bg-green-50 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
            {vistaPrevia(texto) || <span className="text-slate-400">Escribí el mensaje para verlo acá.</span>}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <Icono nombre="info" tamano={14} className="mt-0.5 shrink-0" />
            Ejemplo con un cliente inventado. Los datos de verdad se reemplazan al momento de escribirle.
          </p>
        </div>
      </div>

      <Dialogo
        abierto={borrando}
        titulo={`¿Borrar «${plantilla.nombre}»?`}
        descripcion="Los segmentos que la estén usando pasan a usar el aviso de vencimiento."
        alCerrar={() => setBorrando(false)}
        ancho="sm"
        pie={
          <>
            <Boton onClick={() => setBorrando(false)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={() => void borrar()} cargando={guardando}>
              Borrar
            </Boton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">No se puede deshacer.</p>
      </Dialogo>
    </Tarjeta>
  )
}

/** El ejemplo se calcula acá mientras se escribe; el que llega del proceso principal es el guardado. */
const CLIENTE_DE_EJEMPLO: Record<string, string> = {
  nombre: 'María',
  cuota: '44.800',
  vencimiento: '11',
  patente: 'AB123CD',
  compania: 'SANCOR',
}

function vistaPrevia(texto: string): string {
  let mensaje = texto
  for (const variable of VARIABLES_DE_PLANTILLA) {
    mensaje = mensaje.replace(new RegExp(`\\{${variable}\\}`, 'g'), CLIENTE_DE_EJEMPLO[variable] ?? '')
  }
  return mensaje
}

interface PropsDialogoNueva {
  abierto: boolean
  alCerrar: () => void
  alCrear: (plantillas: PlantillaDeMensaje[]) => void
}

function DialogoDeNuevaPlantilla({ abierto, alCerrar, alCrear }: PropsDialogoNueva) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [texto, setTexto] = useState('Hola {nombre}, ')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setNombre('')
    setDescripcion('')
    setTexto('Hola {nombre}, ')
    setError(null)
  }, [abierto])

  async function crear() {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.marketing.crearPlantilla({ nombre, descripcion, texto })
    if (resultado.ok) alCrear(resultado.datos)
    else setError(resultado.error)
    setGuardando(false)
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo="Nueva plantilla"
      descripcion="Un mensaje que se va a poder usar desde cualquier segmento."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={() => void crear()} cargando={guardando} disabled={nombre.trim().length < 2 || texto.trim() === ''}>
            Crear
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cumpleaños" maxLength={60} />
        <Campo
          etiqueta="Para qué sirve"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Opcional: cuándo se usa este mensaje"
          maxLength={200}
        />
        <AreaTexto
          etiqueta="Mensaje"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={1000}
          ayuda={`Se pueden usar ${VARIABLES_DE_PLANTILLA.map((v) => `{${v}}`).join(', ')}.`}
        />
        <div className="rounded-2xl rounded-bl-sm border border-green-200 bg-green-50 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
          {vistaPrevia(texto) || <span className="text-slate-400">Escribí el mensaje para verlo acá.</span>}
        </div>
      </div>
    </Dialogo>
  )
}
