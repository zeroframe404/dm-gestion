// Administración → Permisos: qué puede ver y qué puede tocar cada rol, módulo por módulo.
//
// Una fila por módulo y una columna por rol configurable (Administrador y Empleado). El
// superadministrador no tiene columna a propósito: siempre tiene todo, y poder sacarse permisos a sí
// mismo dejaría a la agencia sin nadie que pueda devolvérselos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AREAS,
  DESCRIPCION_AREA,
  NIVELES,
  NOMBRE_NIVEL,
  permisosPorDefecto,
  ROLES_CONFIGURABLES,
  sonIguales,
  type Area,
  type MatrizPermisos,
  type Nivel,
} from '../../../shared/permisos'
import { NOMBRE_ROL, type MatrizDePermisos } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Tarjeta, cx, haceCuanto } from '../../componentes/ui'

const CLASES_NIVEL: Record<Nivel, string> = {
  ninguno: 'border-slate-300 bg-slate-50 text-slate-600',
  ver: 'border-sky-300 bg-sky-50 text-sky-800',
  editar: 'border-green-300 bg-green-50 text-green-800',
}

export function Permisos() {
  const [estado, setEstado] = useState<MatrizDePermisos | null>(null)
  const [borrador, setBorrador] = useState<MatrizPermisos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

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

  const hayCambios = useMemo(
    () => Boolean(estado && borrador && !sonIguales(estado.permisos, borrador)),
    [estado, borrador],
  )

  const cambiar = (rol: (typeof ROLES_CONFIGURABLES)[number], area: Area, nivel: Nivel) => {
    setAviso(null)
    setBorrador((previo) => (previo ? { ...previo, [rol]: { ...previo[rol], [area]: nivel } } : previo))
  }

  const guardar = async () => {
    if (!borrador) return
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

  if (cargando) return <Cargando texto="Abriendo los permisos…" />
  if (!estado || !borrador) return <Alerta tono="error">{error ?? 'No se pudieron leer los permisos.'}</Alerta>

  const soloLectura = !estado.puedeEditar

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
            Qué módulos ve y cuáles puede modificar cada rol. <strong className="font-semibold">Sin acceso</strong> saca
            el módulo de la barra lateral; <strong className="font-semibold">Sólo ver</strong> lo deja abrir pero sin
            tocar nada; <strong className="font-semibold">Ver y editar</strong> es lo de siempre. El superadministrador
            tiene acceso completo y no se configura. Los controles que ya existían siguen valiendo: cerrar el mes, ver
            las comisiones, borrar un documento y administrar usuarios siguen pidiendo administrador aunque el módulo
            esté en «ver y editar».
          </>
        }
        acciones={
          estado.puedeEditar && (
            <>
              <Boton variante="fantasma" icono="llave" disabled={guardando} onClick={() => setBorrador(permisosPorDefecto())}>
                Valores por defecto
              </Boton>
              <Boton variante="primario" icono="ok" cargando={guardando} disabled={!hayCambios} onClick={() => void guardar()}>
                Guardar cambios
              </Boton>
            </>
          )
        }
        alRas
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Módulo</th>
                {ROLES_CONFIGURABLES.map((rol) => (
                  <th
                    key={rol}
                    className="w-52 px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500"
                  >
                    {NOMBRE_ROL[rol]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREAS.map((area) => (
                <tr key={area} className="border-b border-slate-100 last:border-b-0 align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{DESCRIPCION_AREA[area].nombre}</p>
                    <p className="mt-0.5 max-w-md text-xs leading-relaxed text-slate-500">{DESCRIPCION_AREA[area].detalle}</p>
                  </td>
                  {ROLES_CONFIGURABLES.map((rol) => (
                    <td key={rol} className="px-4 py-3">
                      <select
                        value={borrador[rol][area]}
                        disabled={soloLectura || guardando}
                        aria-label={`${DESCRIPCION_AREA[area].nombre} para ${NOMBRE_ROL[rol]}`}
                        onChange={(evento) => cambiar(rol, area, evento.target.value as Nivel)}
                        className={cx(
                          'h-9 w-full rounded-lg border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70',
                          CLASES_NIVEL[borrador[rol][area]],
                        )}
                      >
                        {NIVELES.map((nivel) => (
                          <option key={nivel} value={nivel}>
                            {NOMBRE_NIVEL[nivel]}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Icono nombre="candado" tamano={13} />
        {estado.origen === 'compartida'
          ? 'Los permisos viajan en la misma base de usuarios que está en GitHub, así que valen igual en todas las computadoras.'
          : 'Los permisos están guardados en esta computadora.'}
        {estado.actualizadoEn && ` Última actualización: ${haceCuanto(estado.actualizadoEn)}.`}
        {soloLectura && ' Sólo el superadministrador puede cambiarlos.'}
      </p>
    </div>
  )
}
