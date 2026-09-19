// Alta de un cliente. La regla de oro del pliego vive acá: NUNCA dos personas con el mismo DNI/CUIT.
//
// Por eso el alta no pregunta antes ni intenta adivinar: manda los datos y el proceso principal decide.
// Si el documento ya existe no crea nada y devuelve el cliente que ya estaba; entonces la pantalla
// muestra quién es y ofrece las dos únicas salidas sensatas: abrir esa ficha, o corregir lo cargado.
// No hay tercera opción, y no la tiene que haber: el duplicado es el error que después cuesta días.
import { useEffect, useState, type ReactNode } from 'react'
import { DIRECCION_VACIA, type DireccionEstructurada } from '../../../shared/direccion'
import type { DatosDeCliente, FichaCliente, FilaCliente, Sucursal } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'
import { BotonDeDireccion, CampoDeDocumento, CampoDeNacimiento, conDireccion, recortar, type CampoDeTexto } from './CamposDeCliente'

const LISTA_SUCURSALES = 'lista-sucursales-alta'

const DATOS_VACIOS: DatosDeCliente = {
  nombre: '',
  documento: '',
  telefono: '',
  email: '',
  direccion: '',
  localidad: '',
  sucursal: '',
  fechaNacimiento: '',
  profesion: '',
  direccionDetalle: DIRECCION_VACIA,
}

interface Props {
  abierto: boolean
  alCerrar: () => void
  /** El cliente se creó: la pantalla lo abre. */
  alCrear: (cliente: FichaCliente) => void
  /** El documento ya existía y se eligió abrir al que estaba. */
  alAbrirExistente: (clienteId: number) => void
}

export function DialogoNuevoCliente({ abierto, alCerrar, alCrear, alAbrirExistente }: Props) {
  const [datos, setDatos] = useState<DatosDeCliente>(DATOS_VACIOS)
  const [duplicado, setDuplicado] = useState<{ yaExiste: FilaCliente; motivo: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  // Las localidades que ya están cargadas en la agencia: se sugieren para que «Lanús» se escriba una
  // sola forma y no cuatro. No obligan: el campo sigue siendo libre.
  const [localidades, setLocalidades] = useState<string[]>([])

  useEffect(() => {
    if (!abierto) return
    setDatos(DATOS_VACIOS)
    setDuplicado(null)
    setError(null)
    void window.dm.sucursales.listar().then((resultado) => {
      if (resultado.ok) setSucursales(resultado.datos)
    })
    void window.dm.clientes.localidades().then((resultado) => {
      if (resultado.ok) setLocalidades(resultado.datos)
    })
  }, [abierto])

  if (!abierto) return null

  const cambiarTexto = (campo: CampoDeTexto) => (valor: string) => setDatos((previos) => ({ ...previos, [campo]: valor }))

  const cambiarDireccion = (direccionDetalle: DireccionEstructurada) => setDatos((previos) => conDireccion(previos, direccionDetalle))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    // Se recortan los espacios, nada más: el resto lo valida y lo normaliza el proceso principal, que
    // es el que sabe cómo se compara un documento contra los 2.100 que ya están cargados.
    const resultado = await window.dm.clientes.crear(recortar(datos))
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (resultado.datos.creado) {
      alCrear(resultado.datos.cliente)
      return
    }
    setDuplicado({ yaExiste: resultado.datos.yaExiste, motivo: resultado.datos.motivo })
  }

  // --- El documento ya existe: no se creó nada ------------------------------
  if (duplicado) {
    const existente = duplicado.yaExiste
    return (
      <Dialogo
        abierto
        titulo="Ese documento ya está cargado"
        alCerrar={alCerrar}
        ancho="md"
        pie={
          <>
            <Boton onClick={() => setDuplicado(null)}>Volver a editar</Boton>
            <Boton variante="primario" icono="flechaDerecha" onClick={() => alAbrirExistente(existente.id)}>
              Abrir el cliente existente
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* El motivo viene redactado del proceso principal: se muestra tal cual, sin adornarlo. */}
          <Alerta tono="aviso">{duplicado.motivo}</Alerta>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="font-display text-base font-bold text-slate-900">{existente.nombre}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dato etiqueta="DNI/CUIT">
                <span className="tabular-nums">{existente.documento ?? '—'}</span>
              </Dato>
              <Dato etiqueta="Sucursal">{existente.sucursal ?? '—'}</Dato>
              <Dato etiqueta="Celular/WhatsApp">
                <span className="tabular-nums">{existente.telefono ?? '—'}</span>
              </Dato>
              <Dato etiqueta="Pólizas activas">
                <span className="tabular-nums">{existente.polizasActivas}</span>
                {existente.conDeuda && (
                  <span className="ml-2">
                    <Etiqueta tono="peligro">Con deuda</Etiqueta>
                  </span>
                )}
              </Dato>
            </dl>
          </div>

          <p className="text-sm leading-relaxed text-slate-600">
            Si es la misma persona, abrí su ficha y cargale ahí la póliza nueva. Si te equivocaste al tipear el documento, volvé a editar: lo que cargaste
            sigue estando.
          </p>
        </div>
      </Dialogo>
    )
  }

  // --- El formulario --------------------------------------------------------
  return (
    <Dialogo
      abierto
      titulo="Nuevo cliente"
      descripcion="El nombre y el documento son los que después se usan para encontrarlo."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Crear cliente
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre y apellido"
            value={datos.nombre}
            onChange={(evento) => cambiarTexto('nombre')(evento.target.value)}
            autoFocus
            autoComplete="off"
          />
          <CampoDeDocumento
            valor={datos.documento}
            alCambiar={cambiarTexto('documento')}
            ayudaExtra="Con o sin puntos y guiones. Si ya existe, te lo vamos a decir antes de crear nada."
          />
          <Campo
            etiqueta="Celular/WhatsApp"
            value={datos.telefono}
            onChange={(evento) => cambiarTexto('telefono')(evento.target.value)}
            className="tabular-nums"
            ayuda="Es el número al que después salen los avisos de vencimiento."
            autoComplete="off"
          />
          <Campo
            etiqueta="Email"
            type="email"
            value={datos.email}
            onChange={(evento) => cambiarTexto('email')(evento.target.value)}
            autoComplete="off"
          />
          <BotonDeDireccion direccion={datos.direccionDetalle} alCambiar={cambiarDireccion} localidadesConocidas={localidades} />
          <Campo
            etiqueta="Sucursal"
            value={datos.sucursal}
            onChange={(evento) => cambiarTexto('sucursal')(evento.target.value)}
            list={LISTA_SUCURSALES}
            autoComplete="off"
          />
          <CampoDeNacimiento valor={datos.fechaNacimiento} alCambiar={cambiarTexto('fechaNacimiento')} />
          <Campo
            etiqueta="Profesión"
            value={datos.profesion}
            onChange={(evento) => cambiarTexto('profesion')(evento.target.value)}
            ayuda="Para saber qué otro seguro ofrecerle más adelante."
            autoComplete="off"
          />
        </div>

        <datalist id={LISTA_SUCURSALES}>
          {sucursales.map((sucursal) => (
            <option key={sucursal.id} value={sucursal.nombre} />
          ))}
        </datalist>
      </div>
    </Dialogo>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  )
}
