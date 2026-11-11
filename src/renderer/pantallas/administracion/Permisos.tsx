// Administración → Permisos: qué puede ver y qué puede tocar cada rol, módulo por módulo.
//
// Se elige el rol en una lista (Administrador, Usuario y los que armó la agencia) y debajo se ajusta
// cada módulo: Permitido (lectura y escritura), Solo lectura o Sin permiso. «Nuevo rol» crea uno
// propio partiendo de Administrador o de Usuario. Cada rol tiene además los dos casilleros de las
// autorizaciones puntuales (pedir / resolver; ver shared/autorizaciones.ts).
//
// El superadministrador no está en la lista a propósito: siempre tiene todo, y poder sacarse permisos
// a sí mismo dejaría a la agencia sin nadie que pueda devolvérselos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AREAS,
  DESCRIPCION_AREA,
  LARGO_MAXIMO_NOMBRE_DE_ROL,
  NIVELES,
  NOMBRE_NIVEL,
  opcionesPorDefecto,
  permisosPorDefecto,
  sonIguales,
  type Area,
  type MatrizPermisos,
  type Nivel,
  type OpcionesDeRol,
  type PermisosDeUnRol,
  type RolBase,
} from '../../../shared/permisos'
import { NOMBRE_ROL, type MatrizDePermisos } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, Dialogo, Selector, Tarjeta, cx, haceCuanto } from '../../componentes/ui'

const CLASES_NIVEL: Record<Nivel, string> = {
  ninguno: 'border-slate-300 bg-slate-50 text-slate-600',
  ver: 'border-sky-300 bg-sky-50 text-sky-800',
  editar: 'border-green-300 bg-green-50 text-green-800',
}

/** El orden en que se muestran las opciones: de lo más abierto a lo más cerrado. */
const ORDEN_DE_OPCIONES: Nivel[] = ['editar', 'ver', 'ninguno']

function nuevoId(): string {
  return `rol-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function nombreDeLaClave(matriz: MatrizPermisos, clave: string): string {
  if (clave === 'ADMIN' || clave === 'EMPLEADO') return NOMBRE_ROL[clave]
  return matriz.personalizados.find((rol) => rol.id === clave)?.nombre ?? clave
}

export function Permisos() {
  const [estado, setEstado] = useState<MatrizDePermisos | null>(null)
  const [borrador, setBorrador] = useState<MatrizPermisos | null>(null)
  const [seleccionado, setSeleccionado] = useState<string>('EMPLEADO')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.permisos.matriz()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setBorrador(resultado.datos.permisos)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hayCambios = useMemo(() => Boolean(estado && borrador && !sonIguales(estado.permisos, borrador)), [estado, borrador])

  const rolPersonalizado = borrador?.personalizados.find((rol) => rol.id === seleccionado) ?? null
  // Si el rol elegido desapareció (se borró, o se recargó la pantalla), se vuelve a uno que exista.
  useEffect(() => {
    if (borrador && seleccionado !== 'ADMIN' && seleccionado !== 'EMPLEADO' && !rolPersonalizado) setSeleccionado('EMPLEADO')
  }, [borrador, seleccionado, rolPersonalizado])

  const usuariosDelRol = useMemo(
    () => (borrador ? Object.entries(borrador.asignaciones).filter(([, id]) => id === seleccionado).map(([usuario]) => usuario) : []),
    [borrador, seleccionado],
  )

  if (cargando) return <Cargando texto="Abriendo los permisos…" />
  if (!estado || !borrador) return <Alerta tono="error">{error ?? 'No se pudieron leer los permisos.'}</Alerta>

  const soloLectura = !estado.puedeEditar
  const permisosDelSeleccionado: PermisosDeUnRol =
    seleccionado === 'ADMIN' || seleccionado === 'EMPLEADO' ? borrador[seleccionado] : (rolPersonalizado?.permisos ?? borrador.EMPLEADO)
  const opciones: OpcionesDeRol = borrador.opciones[seleccionado] ?? opcionesPorDefecto(seleccionado)

  const cambiarNivel = (area: Area, nivel: Nivel) => {
    setAviso(null)
    setBorrador((previo) => {
      if (!previo) return previo
      if (seleccionado === 'ADMIN' || seleccionado === 'EMPLEADO') return { ...previo, [seleccionado]: { ...previo[seleccionado], [area]: nivel } }
      return {
        ...previo,
        personalizados: previo.personalizados.map((rol) => (rol.id === seleccionado ? { ...rol, permisos: { ...rol.permisos, [area]: nivel } } : rol)),
      }
    })
  }

  const cambiarOpcion = (clave: keyof OpcionesDeRol, valor: boolean) => {
    setAviso(null)
    setBorrador((previo) => (previo ? { ...previo, opciones: { ...previo.opciones, [seleccionado]: { ...opciones, [clave]: valor } } } : previo))
  }

  const cambiarNombre = (nombre: string) => {
    setAviso(null)
    setBorrador((previo) =>
      previo ? { ...previo, personalizados: previo.personalizados.map((rol) => (rol.id === seleccionado ? { ...rol, nombre } : rol)) } : previo,
    )
  }

  const restablecer = () => {
    setAviso(null)
    const porDefecto = permisosPorDefecto()
    const base: RolBase = seleccionado === 'ADMIN' ? 'ADMIN' : seleccionado === 'EMPLEADO' ? 'EMPLEADO' : (rolPersonalizado?.base ?? 'EMPLEADO')
    setBorrador((previo) => {
      if (!previo) return previo
      const opcionesPorDefectoDelRol = { ...previo.opciones, [seleccionado]: opcionesPorDefecto(seleccionado === 'ADMIN' ? 'ADMIN' : 'EMPLEADO') }
      if (seleccionado === 'ADMIN' || seleccionado === 'EMPLEADO') return { ...previo, [seleccionado]: porDefecto[seleccionado], opciones: opcionesPorDefectoDelRol }
      return {
        ...previo,
        opciones: opcionesPorDefectoDelRol,
        personalizados: previo.personalizados.map((rol) => (rol.id === seleccionado ? { ...rol, permisos: { ...porDefecto[base] } } : rol)),
      }
    })
  }

  const crearRol = (nombre: string, base: RolBase) => {
    const id = nuevoId()
    setBorrador((previo) =>
      previo
        ? {
            ...previo,
            personalizados: [...previo.personalizados, { id, nombre, base, permisos: { ...previo[base] } }],
            opciones: { ...previo.opciones, [id]: opcionesPorDefecto(id) },
          }
        : previo,
    )
    setSeleccionado(id)
    setCreando(false)
    setAviso(null)
  }

  const borrarRol = () => {
    if (!rolPersonalizado) return
    setAviso(null)
    setBorrador((previo) =>
      previo
        ? {
            ...previo,
            personalizados: previo.personalizados.filter((rol) => rol.id !== seleccionado),
            opciones: Object.fromEntries(Object.entries(previo.opciones).filter(([clave]) => clave !== seleccionado)),
          }
        : previo,
    )
    setSeleccionado('EMPLEADO')
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.permisos.guardar(borrador)
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setBorrador(resultado.datos.permisos)
      setAviso(
        resultado.datos.origen === 'compartida'
          ? 'Permisos guardados. Las demás computadoras los toman en cuanto vuelven a leer la base de usuarios.'
          : 'Permisos guardados en esta computadora.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const opcionesDeLaLista = [
    { valor: 'ADMIN', texto: NOMBRE_ROL.ADMIN },
    { valor: 'EMPLEADO', texto: NOMBRE_ROL.EMPLEADO },
    ...borrador.personalizados.map((rol) => ({ valor: rol.id, texto: rol.nombre || '(sin nombre)' })),
  ]
  const deshabilitado = soloLectura || guardando

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {estado.origen === 'local' && (
        <Alerta tono="aviso">
          Todavía no hay base de usuarios compartida, así que estos permisos valen sólo en esta computadora. Cuando se
          inicialice la base compartida (Administración → Usuarios) suben con ella y pasan a valer para toda la agencia.
        </Alerta>
      )}

      <Tarjeta
        titulo="Permisos por rol"
        descripcion={
          <>
            Elegí un rol y definí qué hace en cada módulo. <strong className="font-semibold">Permitido</strong>: puede leer
            y escribir. <strong className="font-semibold">Solo lectura</strong>: abre el módulo pero no puede modificar
            nada. <strong className="font-semibold">Sin permiso</strong>: el módulo no se muestra. El superadministrador
            tiene acceso completo y no se configura. Los controles que ya existían siguen valiendo: cerrar el mes, ver
            las comisiones, borrar un documento y administrar usuarios siguen pidiendo administrador.
          </>
        }
        acciones={
          estado.puedeEditar && (
            <>
              <Boton variante="fantasma" icono="mas" disabled={guardando} onClick={() => setCreando(true)}>
                Nuevo rol
              </Boton>
              <Boton variante="primario" icono="ok" cargando={guardando} disabled={!hayCambios} onClick={() => void guardar()}>
                Guardar cambios
              </Boton>
            </>
          )
        }
        alRas
      >
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4">
          <div className="grid items-end gap-4 sm:grid-cols-[18rem_1fr]">
            <Selector
              etiqueta="Rol"
              name="rol-a-configurar"
              value={seleccionado}
              onChange={(evento) => setSeleccionado(evento.target.value)}
              opciones={opcionesDeLaLista}
            />
            {rolPersonalizado ? (
              <Campo
                etiqueta="Nombre del rol"
                name="nombre-del-rol"
                value={rolPersonalizado.nombre}
                maxLength={LARGO_MAXIMO_NOMBRE_DE_ROL}
                disabled={deshabilitado}
                onChange={(evento) => cambiarNombre(evento.target.value)}
              />
            ) : (
              <p className="pb-2 text-xs text-slate-500">Rol integrado: se puede ajustar pero no borrar ni renombrar.</p>
            )}
          </div>

          {rolPersonalizado && (
            <p className="text-xs text-slate-500">
              Parte de <strong className="font-semibold">{NOMBRE_ROL[rolPersonalizado.base]}</strong>: de ahí hereda lo que no es
              la tabla ({rolPersonalizado.base === 'ADMIN' ? 'los controles de administrador' : 'ver sólo su sucursal y no ver los números de la agencia'}).{' '}
              {usuariosDelRol.length > 0
                ? `Lo tienen ${usuariosDelRol.length === 1 ? 'este usuario' : `estos ${usuariosDelRol.length} usuarios`}: ${usuariosDelRol.join(', ')}.`
                : 'Todavía no lo tiene ningún usuario: se asigna en Administración → Usuarios.'}
            </p>
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={opciones.puedeSolicitar}
                disabled={deshabilitado}
                onChange={(evento) => cambiarOpcion('puedeSolicitar', evento.target.checked)}
              />
              <span>
                <span className="font-semibold">Puede solicitar autorizaciones puntuales</span>
                <span className="block text-xs text-slate-500">
                  Ve el botón para pedir acceso a un módulo que no tiene (sólo leer, o leer y escribir). Quien resuelve decide y
                  puede contestarle con un mensaje.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={opciones.puedeResolver}
                disabled={deshabilitado}
                onChange={(evento) => cambiarOpcion('puedeResolver', evento.target.checked)}
              />
              <span>
                <span className="font-semibold">Puede resolver autorizaciones puntuales</span>
                <span className="block text-xs text-slate-500">
                  Ve los pedidos de los demás y decide: permitido, solo lectura o denegar. No puede dar más de lo que él mismo tiene.
                </span>
              </span>
            </label>
          </div>

          {estado.puedeEditar && (
            <div className="flex flex-wrap gap-2">
              <Boton variante="fantasma" tamano="sm" icono="llave" disabled={guardando} onClick={restablecer}>
                Restablecer este rol
              </Boton>
              {rolPersonalizado && (
                <Boton
                  variante="peligro"
                  tamano="sm"
                  icono="basura"
                  disabled={guardando || usuariosDelRol.length > 0}
                  title={usuariosDelRol.length > 0 ? 'Cambiales el rol a esos usuarios (Administración → Usuarios) antes de borrarlo.' : undefined}
                  onClick={borrarRol}
                >
                  Borrar rol
                </Boton>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Módulo</th>
                <th className="w-52 px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {nombreDeLaClave(borrador, seleccionado)}
                </th>
              </tr>
            </thead>
            <tbody>
              {AREAS.map((area) => (
                <tr key={area} className="border-b border-slate-100 last:border-b-0 align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{DESCRIPCION_AREA[area].nombre}</p>
                    <p className="mt-0.5 max-w-md text-xs leading-relaxed text-slate-500">{DESCRIPCION_AREA[area].detalle}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={permisosDelSeleccionado[area]}
                      disabled={deshabilitado}
                      aria-label={`${DESCRIPCION_AREA[area].nombre} para ${nombreDeLaClave(borrador, seleccionado)}`}
                      onChange={(evento) => cambiarNivel(area, evento.target.value as Nivel)}
                      className={cx(
                        'h-9 w-full rounded-lg border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70',
                        CLASES_NIVEL[permisosDelSeleccionado[area]],
                      )}
                    >
                      {ORDEN_DE_OPCIONES.filter((nivel) => NIVELES.includes(nivel)).map((nivel) => (
                        <option key={nivel} value={nivel}>
                          {NOMBRE_NIVEL[nivel]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Icono nombre="candado" tamano={13} />
        {estado.origen === 'compartida'
          ? 'Los permisos viajan en la misma base de usuarios que está en el servidor de la agencia, así que valen igual en todas las computadoras.'
          : 'Los permisos están guardados en esta computadora.'}
        {estado.actualizadoEn && ` Última actualización: ${haceCuanto(estado.actualizadoEn)}.`}
        {soloLectura && ' Sólo el superadministrador puede cambiarlos.'}
      </p>

      {creando && <DialogoNuevoRol existentes={opcionesDeLaLista.map((o) => o.texto)} alCerrar={() => setCreando(false)} alCrear={crearRol} />}
    </div>
  )
}

function DialogoNuevoRol({ existentes, alCerrar, alCrear }: { existentes: string[]; alCerrar: () => void; alCrear: (nombre: string, base: RolBase) => void }) {
  const [nombre, setNombre] = useState('')
  const [base, setBase] = useState<RolBase>('EMPLEADO')
  const [error, setError] = useState<string | null>(null)

  const confirmar = () => {
    const limpio = nombre.replace(/\s+/g, ' ').trim()
    if (limpio.length < 2) return setError('Poné un nombre de al menos 2 letras.')
    if (existentes.some((existente) => existente.toLowerCase() === limpio.toLowerCase())) return setError('Ya hay un rol con ese nombre.')
    alCrear(limpio, base)
  }

  return (
    <Dialogo
      abierto
      titulo="Nuevo rol"
      descripcion="El rol se crea con los permisos de su rol de partida y después se ajusta módulo por módulo. No se guarda hasta que toques «Guardar cambios»."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={confirmar}>
            Crear rol
          </Boton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault()
          confirmar()
        }}
      >
        <Campo etiqueta="Nombre del rol" name="nombre" value={nombre} maxLength={LARGO_MAXIMO_NOMBRE_DE_ROL} autoFocus onChange={(evento) => setNombre(evento.target.value)} />
        <Selector
          etiqueta="Rol de partida"
          name="base"
          value={base}
          onChange={(evento) => setBase(evento.target.value as RolBase)}
          opciones={[
            { valor: 'EMPLEADO', texto: `${NOMBRE_ROL.EMPLEADO}: ve sólo su sucursal, sin los números de la agencia` },
            { valor: 'ADMIN', texto: `${NOMBRE_ROL.ADMIN}: con los controles de administrador` },
          ]}
          ayuda="Define lo que no es la tabla de módulos. No se puede cambiar después."
        />
        {error && <Alerta tono="error">{error}</Alerta>}
      </form>
    </Dialogo>
  )
}
