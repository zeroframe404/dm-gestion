// Administración de usuarios: crear, editar, desactivar, resetear contraseñas, asignar rol y sucursal.
// Sólo la ve un SUPER_ADMIN; el proceso principal rechaza cualquier otro rol.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  LARGO_MINIMO_CLAVE,
  NOMBRE_ROL,
  ROLES,
  type DatosEdicionUsuario,
  type Rol,
  type Sucursal,
  type Usuario,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, CampoClave, Cargando, Dialogo, Etiqueta, Selector, Tarjeta, cx } from '../../componentes/ui'
import { useSesion, useUsuarioActual } from '../../contexto/Sesion'

type EstadoDialogo =
  | { tipo: 'crear' }
  | { tipo: 'editar'; usuario: Usuario }
  | { tipo: 'resetear'; usuario: Usuario }
  | { tipo: 'activo'; usuario: Usuario }
  | null

const TONO_ROL: Record<Rol, 'marca' | 'neutro'> = { SUPER_ADMIN: 'marca', ADMIN: 'neutro', EMPLEADO: 'neutro' }

export function Usuarios() {
  const actual = useUsuarioActual()
  const { actualizar } = useSesion()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<EstadoDialogo>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const [resultadoUsuarios, resultadoSucursales] = await Promise.all([
      window.dm.usuarios.listar(),
      window.dm.sucursales.listar(),
    ])
    if (resultadoUsuarios.ok) setUsuarios(resultadoUsuarios.datos)
    else setError(resultadoUsuarios.error)
    if (resultadoSucursales.ok) setSucursales(resultadoSucursales.datos)
    else if (resultadoUsuarios.ok) setError(resultadoSucursales.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // El aviso de éxito desaparece solo.
  useEffect(() => {
    if (!aviso) return
    const temporizador = window.setTimeout(() => setAviso(null), 4000)
    return () => window.clearTimeout(temporizador)
  }, [aviso])

  function reemplazar(usuario: Usuario) {
    setUsuarios((lista) => lista.map((existente) => (existente.id === usuario.id ? usuario : existente)))
    // Si el superadministrador se editó a sí mismo, la barra superior tiene que reflejarlo.
    if (usuario.id === actual.id) {
      actualizar({
        ...actual,
        nombre: usuario.nombre,
        usuario: usuario.usuario,
        sucursal: { id: usuario.sucursalId, nombre: usuario.sucursalNombre },
      })
    }
  }

  const cerrarDialogo = useCallback(() => setDialogo(null), [])

  return (
    <div className="mx-auto max-w-6xl">
      <Tarjeta
        titulo="Usuarios"
        descripcion="Creá, editá y desactivá usuarios; reseteá contraseñas y asigná rol y sucursal."
        acciones={
          <Boton variante="primario" icono="mas" onClick={() => setDialogo({ tipo: 'crear' })}>
            Nuevo usuario
          </Boton>
        }
        alRas
      >
        {(aviso || error) && (
          <div className="flex flex-col gap-3 px-6 pb-4">
            {aviso && <Alerta tono="exito">{aviso}</Alerta>}
            {error && <Alerta tono="error">{error}</Alerta>}
          </div>
        )}

        {cargando ? (
          <Cargando texto="Cargando usuarios…" />
        ) : (
          <TablaUsuarios
            usuarios={usuarios}
            idActual={actual.id}
            alEditar={(usuario) => setDialogo({ tipo: 'editar', usuario })}
            alResetear={(usuario) => setDialogo({ tipo: 'resetear', usuario })}
            alCambiarActivo={(usuario) => setDialogo({ tipo: 'activo', usuario })}
          />
        )}
      </Tarjeta>

      {dialogo?.tipo === 'crear' && (
        <DialogoFormulario
          sucursales={sucursales}
          alCerrar={cerrarDialogo}
          alGuardado={(usuario) => {
            setUsuarios((lista) => [...lista, usuario])
            setAviso(`Se creó el usuario "${usuario.usuario}". Va a tener que cambiar la contraseña al ingresar.`)
            cerrarDialogo()
          }}
        />
      )}

      {dialogo?.tipo === 'editar' && (
        <DialogoFormulario
          usuario={dialogo.usuario}
          sucursales={sucursales}
          alCerrar={cerrarDialogo}
          alGuardado={(usuario) => {
            reemplazar(usuario)
            setAviso(`Se guardaron los cambios de "${usuario.nombre}".`)
            cerrarDialogo()
          }}
        />
      )}

      {dialogo?.tipo === 'resetear' && (
        <DialogoResetearClave
          usuario={dialogo.usuario}
          esPropio={dialogo.usuario.id === actual.id}
          alCerrar={cerrarDialogo}
          alGuardado={(usuario) => {
            reemplazar(usuario)
            setAviso(
              usuario.id === actual.id
                ? 'Tu contraseña se actualizó.'
                : `Se reseteó la contraseña de "${usuario.nombre}". Va a tener que cambiarla al ingresar.`,
            )
            cerrarDialogo()
          }}
        />
      )}

      {dialogo?.tipo === 'activo' && (
        <DialogoCambiarActivo
          usuario={dialogo.usuario}
          alCerrar={cerrarDialogo}
          alGuardado={(usuario) => {
            reemplazar(usuario)
            setAviso(usuario.activo ? `Se activó a "${usuario.nombre}".` : `Se desactivó a "${usuario.nombre}".`)
            cerrarDialogo()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------
interface PropsTabla {
  usuarios: Usuario[]
  idActual: number
  alEditar: (usuario: Usuario) => void
  alResetear: (usuario: Usuario) => void
  alCambiarActivo: (usuario: Usuario) => void
}

function TablaUsuarios({ usuarios, idActual, alEditar, alResetear, alCambiarActivo }: PropsTabla) {
  if (usuarios.length === 0) {
    return <p className="px-6 py-12 text-center text-sm text-slate-500">Todavía no hay usuarios cargados.</p>
  }

  const encabezado = 'px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-slate-200 bg-slate-50">
            <th className={cx(encabezado, 'pl-6')}>Nombre</th>
            <th className={encabezado}>Rol</th>
            <th className={encabezado}>Sucursal</th>
            <th className={encabezado}>Estado</th>
            <th className={cx(encabezado, 'pr-6 text-right')}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((usuario) => {
            const esActual = usuario.id === idActual
            return (
              <tr
                key={usuario.id}
                className={cx('border-b border-slate-200 last:border-b-0', !usuario.activo && 'bg-slate-50/60 text-slate-500')}
              >
                <td className="px-4 py-3 pl-6 whitespace-nowrap">
                  <p className={cx('font-semibold', usuario.activo ? 'text-slate-900' : 'text-slate-500')}>
                    {usuario.nombre}
                    {esActual && <span className="ml-2 text-xs font-medium text-slate-400">(vos)</span>}
                  </p>
                  <p className="font-mono text-xs text-slate-500">{usuario.usuario}</p>
                </td>
                <td className="px-4 py-3">
                  <Etiqueta tono={TONO_ROL[usuario.rol]}>{NOMBRE_ROL[usuario.rol]}</Etiqueta>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{usuario.sucursalNombre}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    {usuario.activo ? <Etiqueta tono="exito">Activo</Etiqueta> : <Etiqueta tono="peligro">Desactivado</Etiqueta>}
                    {usuario.debeCambiarClave && <Etiqueta tono="aviso">Debe cambiar la contraseña</Etiqueta>}
                  </div>
                </td>
                <td className="px-4 py-3 pr-6">
                  {/* Acciones sólo con ícono: el texto va en title y aria-label para que la tabla entre en 1280 px. */}
                  <div className="flex justify-end gap-1">
                    <Boton
                      variante="fantasma"
                      tamano="sm"
                      icono="lapiz"
                      onClick={() => alEditar(usuario)}
                      title="Editar"
                      aria-label={`Editar a ${usuario.nombre}`}
                      className="w-8 px-0"
                    />
                    <Boton
                      variante="fantasma"
                      tamano="sm"
                      icono="llave"
                      onClick={() => alResetear(usuario)}
                      title={esActual ? 'Cambiar mi contraseña' : 'Resetear contraseña'}
                      aria-label={esActual ? 'Cambiar mi contraseña' : `Resetear la contraseña de ${usuario.nombre}`}
                      className="w-8 px-0"
                    />
                    <Boton
                      variante="fantasma"
                      tamano="sm"
                      icono="apagar"
                      onClick={() => alCambiarActivo(usuario)}
                      disabled={esActual}
                      title={esActual ? 'No podés desactivar tu propio usuario.' : usuario.activo ? 'Desactivar' : 'Activar'}
                      aria-label={usuario.activo ? `Desactivar a ${usuario.nombre}` : `Activar a ${usuario.nombre}`}
                      className={cx(
                        'w-8 px-0',
                        usuario.activo ? 'text-red-700 hover:bg-red-50 hover:text-red-800' : 'text-green-700 hover:bg-green-50 hover:text-green-800',
                      )}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crear / editar
// ---------------------------------------------------------------------------
interface PropsFormulario {
  /** Si viene, el diálogo edita; si no, crea. */
  usuario?: Usuario
  sucursales: Sucursal[]
  alCerrar: () => void
  alGuardado: (usuario: Usuario) => void
}

function DialogoFormulario({ usuario, sucursales, alCerrar, alGuardado }: PropsFormulario) {
  const editando = Boolean(usuario)
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [nombreDeUsuario, setNombreDeUsuario] = useState(usuario?.usuario ?? '')
  const [clave, setClave] = useState('')
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? 'EMPLEADO')
  const [sucursalId, setSucursalId] = useState<number>(usuario?.sucursalId ?? sucursales[0]?.id ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!nombre.trim()) return setError('Ingresá el nombre.')
    if (!nombreDeUsuario.trim()) return setError('Ingresá el nombre de usuario.')
    if (!editando && clave.length < LARGO_MINIMO_CLAVE) {
      return setError(`La contraseña inicial tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`)
    }
    if (!sucursalId) return setError('Elegí una sucursal.')

    setGuardando(true)
    setError(null)
    const comunes: DatosEdicionUsuario = {
      nombre: nombre.trim(),
      usuario: nombreDeUsuario.trim().toLowerCase(),
      rol,
      sucursalId,
    }
    const resultado = usuario
      ? await window.dm.usuarios.editar(usuario.id, comunes)
      : await window.dm.usuarios.crear({ ...comunes, clave })

    if (resultado.ok) {
      alGuardado(resultado.datos)
    } else {
      setError(resultado.error)
      setGuardando(false)
    }
  }

  const idFormulario = 'formulario-usuario'

  return (
    <Dialogo
      abierto
      titulo={editando ? 'Editar usuario' : 'Nuevo usuario'}
      descripcion={
        editando
          ? 'Modificá los datos, el rol o la sucursal. La contraseña se cambia desde «Resetear contraseña».'
          : 'El usuario va a tener que cambiar la contraseña inicial la primera vez que ingrese.'
      }
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" form={idFormulario} variante="primario" cargando={guardando}>
            {editando ? 'Guardar cambios' : 'Crear usuario'}
          </Boton>
        </>
      }
    >
      <form id={idFormulario} onSubmit={alEnviar} noValidate className="flex flex-col gap-4">
        <Campo
          etiqueta="Nombre y apellido"
          name="nombre"
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
          autoFocus
        />
        <Campo
          etiqueta="Nombre de usuario"
          name="usuario"
          value={nombreDeUsuario}
          onChange={(evento) => setNombreDeUsuario(evento.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          ayuda="Minúsculas, números, punto, guion o guion bajo. Entre 3 y 32 caracteres."
        />
        {!editando && (
          <CampoClave
            etiqueta="Contraseña inicial"
            name="clave"
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            autoComplete="new-password"
            ayuda={`Mínimo ${LARGO_MINIMO_CLAVE} caracteres.`}
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <Selector
            etiqueta="Rol"
            name="rol"
            value={rol}
            onChange={(evento) => setRol(evento.target.value as Rol)}
            opciones={ROLES.map((valor) => ({ valor, texto: NOMBRE_ROL[valor] }))}
          />
          <Selector
            etiqueta="Sucursal"
            name="sucursalId"
            value={sucursalId}
            onChange={(evento) => setSucursalId(Number(evento.target.value))}
            opciones={sucursales.map((sucursal) => ({ valor: sucursal.id, texto: sucursal.nombre }))}
          />
        </div>
        {error && <Alerta tono="error">{error}</Alerta>}
      </form>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Resetear contraseña
// ---------------------------------------------------------------------------
interface PropsResetear {
  usuario: Usuario
  esPropio: boolean
  alCerrar: () => void
  alGuardado: (usuario: Usuario) => void
}

function DialogoResetearClave({ usuario, esPropio, alCerrar, alGuardado }: PropsResetear) {
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (clave.length < LARGO_MINIMO_CLAVE) {
      return setError(`La contraseña tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`)
    }
    if (clave !== repetida) return setError('Las contraseñas no coinciden.')

    setGuardando(true)
    setError(null)
    const resultado = await window.dm.usuarios.resetearClave(usuario.id, clave)
    if (resultado.ok) {
      alGuardado(resultado.datos)
    } else {
      setError(resultado.error)
      setGuardando(false)
    }
  }

  const idFormulario = 'formulario-resetear'

  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo={esPropio ? 'Cambiar mi contraseña' : `Resetear la contraseña de ${usuario.nombre}`}
      descripcion={
        esPropio
          ? 'Elegí una contraseña nueva para tu usuario.'
          : 'Definí una contraseña temporal y comunicásela. Va a tener que cambiarla la próxima vez que ingrese.'
      }
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" form={idFormulario} variante="primario" cargando={guardando}>
            {esPropio ? 'Cambiar contraseña' : 'Resetear contraseña'}
          </Boton>
        </>
      }
    >
      <form id={idFormulario} onSubmit={alEnviar} noValidate className="flex flex-col gap-4">
        <CampoClave
          etiqueta={esPropio ? 'Contraseña nueva' : 'Contraseña temporal'}
          name="clave"
          value={clave}
          onChange={(evento) => setClave(evento.target.value)}
          autoComplete="new-password"
          ayuda={`Mínimo ${LARGO_MINIMO_CLAVE} caracteres.`}
          autoFocus
        />
        <CampoClave
          etiqueta="Repetir contraseña"
          name="repetida"
          value={repetida}
          onChange={(evento) => setRepetida(evento.target.value)}
          autoComplete="new-password"
        />
        {error && <Alerta tono="error">{error}</Alerta>}
      </form>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// Activar / desactivar
// ---------------------------------------------------------------------------
interface PropsActivo {
  usuario: Usuario
  alCerrar: () => void
  alGuardado: (usuario: Usuario) => void
}

function DialogoCambiarActivo({ usuario, alCerrar, alGuardado }: PropsActivo) {
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const desactivar = usuario.activo

  async function confirmar() {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.usuarios.cambiarActivo(usuario.id, !usuario.activo)
    if (resultado.ok) {
      alGuardado(resultado.datos)
    } else {
      setError(resultado.error)
      setGuardando(false)
    }
  }

  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo={desactivar ? `¿Desactivar a ${usuario.nombre}?` : `¿Activar a ${usuario.nombre}?`}
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante={desactivar ? 'peligro' : 'primario'} onClick={() => void confirmar()} cargando={guardando}>
            {desactivar ? 'Desactivar' : 'Activar'}
          </Boton>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">
        {desactivar
          ? 'El usuario no va a poder iniciar sesión hasta que lo vuelvas a activar. Sus datos se conservan.'
          : 'El usuario va a poder volver a iniciar sesión con su contraseña actual.'}
      </p>
      {error && (
        <div className="mt-4">
          <Alerta tono="error">{error}</Alerta>
        </div>
      )}
    </Dialogo>
  )
}
