// Alta de un cliente. La regla de oro del pliego vive acá: NUNCA dos personas con el mismo DNI/CUIT.
//
// Por eso el alta no pregunta antes ni intenta adivinar: manda los datos y el proceso principal decide.
// Si el documento ya existe no crea nada y devuelve el cliente que ya estaba; entonces la pantalla
// muestra quién es y ofrece las dos únicas salidas sensatas: abrir esa ficha, o corregir lo cargado.
// No hay tercera opción, y no la tiene que haber: el duplicado es el error que después cuesta días.
import { useEffect, useState, type ReactNode } from 'react'
import type { DatosDeCliente, FichaCliente, FilaCliente, Sucursal } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Etiqueta } from '../../componentes/ui'

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

  useEffect(() => {
    if (!abierto) return
    setDatos(DATOS_VACIOS)
    setDuplicado(null)
    setError(null)
    void window.dm.sucursales.listar().then((resultado) => {
      if (resultado.ok) setSucursales(resultado.datos)
    })
  }, [abierto])

  if (!abierto) return null

  const cambiar = (campo: keyof DatosDeCliente) => (evento: { target: { value: string } }) =>
    setDatos((previos) => ({ ...previos, [campo]: evento.target.value }))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    // Se recortan los espacios, nada más: el resto lo valida y lo normaliza el proceso principal, que
    // es el que sabe cómo se compara un documento contra los 2.100 que ya están cargados.
    const limpios = Object.fromEntries(
      (Object.keys(datos) as Array<keyof DatosDeCliente>).map((campo) => [campo, datos[campo].trim()]),
    ) as unknown as DatosDeCliente

    const resultado = await window.dm.clientes.crear(limpios)
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
              <Dato etiqueta="Teléfono">
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
          <Campo etiqueta="Nombre y apellido" value={datos.nombre} onChange={cambiar('nombre')} autoFocus autoComplete="off" />
          <Campo
            etiqueta="DNI / CUIT"
            value={datos.documento}
            onChange={cambiar('documento')}
            className="tabular-nums"
            ayuda="Sin puntos ni guiones. Si ya existe, te lo vamos a decir antes de crear nada."
            autoComplete="off"
          />
          <Campo etiqueta="Teléfono" value={datos.telefono} onChange={cambiar('telefono')} className="tabular-nums" autoComplete="off" />
          <Campo etiqueta="Email" type="email" value={datos.email} onChange={cambiar('email')} autoComplete="off" />
          <Campo etiqueta="Localidad" value={datos.localidad} onChange={cambiar('localidad')} autoComplete="off" />
          <Campo etiqueta="Sucursal" value={datos.sucursal} onChange={cambiar('sucursal')} list={LISTA_SUCURSALES} autoComplete="off" />
          <Campo
            etiqueta="Fecha de nacimiento"
            value={datos.fechaNacimiento}
            onChange={cambiar('fechaNacimiento')}
            ayuda="Como se escribe en la hoja (por ejemplo 12/05/1980)."
            autoComplete="off"
          />
        </div>

        <AreaTexto etiqueta="Dirección" rows={2} value={datos.direccion} onChange={cambiar('direccion')} autoComplete="off" />

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
