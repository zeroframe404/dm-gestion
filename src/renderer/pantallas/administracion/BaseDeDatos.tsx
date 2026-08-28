// La base del GENERAL DE CLIENTES en el VPS (v12): estado de la conexión y la migración inicial.
// Desde esta versión el programa sincroniza contra la base del servidor de la agencia; la hoja de
// Google quedó sólo como origen de la migración (una sola vez) y para Drive.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoMigracionVps, ResumenMigracionVps } from '../../../shared/tipos'
import { Alerta, Boton, Cargando, Tarjeta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

export function BaseDeDatos() {
  const usuario = useUsuarioActual()
  const [estado, setEstado] = useState<EstadoMigracionVps | null>(null)
  const [cargando, setCargando] = useState(true)
  const [migrando, setMigrando] = useState(false)
  const [resumen, setResumen] = useState<ResumenMigracionVps | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.vps.estado()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function alMigrar() {
    const seguro = window.confirm(
      'La migración lee la hoja de Google completa por última vez y la publica en la base del VPS. ' +
        'Se hace UNA sola vez, desde UNA sola computadora, y recién cuando TODAS las computadoras ya estén en la versión 12 ' +
        '(lo que una PC vieja cargue en Google después de migrar no llega al VPS). ¿Continuar?',
    )
    if (!seguro) return
    setMigrando(true)
    setError(null)
    const resultado = await window.dm.vps.migrar()
    if (resultado.ok) {
      setResumen(resultado.datos)
      await cargar()
    } else {
      setError(resultado.error)
    }
    setMigrando(false)
  }

  const base = estado?.base ?? null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Tarjeta
        titulo="Base de datos del GENERAL DE CLIENTES"
        descripcion="Desde la versión 12 la cartera vive en la base del VPS de la agencia. Todas las computadoras sincronizan contra ella; la hoja de Google dejó de ser la fuente de verdad."
      >
        {cargando ? (
          <Cargando />
        ) : (
          <div className="flex flex-col gap-4">
            {estado && (
              <p className="text-sm text-slate-600">
                Servidor: <strong className="font-semibold">{estado.urlBase}</strong>
              </p>
            )}

            {estado?.error ? (
              <Alerta tono="error">No se pudo consultar la base del VPS: {estado.error}</Alerta>
            ) : base?.inicializada ? (
              <Alerta tono="exito">
                La base está migrada y en uso: {base.pestanas} pestañas y {base.filas} filas.
                {base.inicializada_en && <> Migrada el {new Date(base.inicializada_en).toLocaleString('es-AR')}.</>}
              </Alerta>
            ) : (
              <Alerta tono="aviso">
                La base del VPS todavía está vacía: falta la migración inicial. Hasta entonces la sincronización
                queda esperando y todo sigue funcionando local. Migrá recién cuando todas las computadoras estén
                en la versión 12 (Acerca de → Buscar actualizaciones las adelanta).
              </Alerta>
            )}

            {resumen && (
              <Alerta tono="exito">
                Migración terminada: {resumen.pestanas} pestañas y {resumen.filas} filas publicadas en el VPS.
              </Alerta>
            )}
            {error && <Alerta tono="error">{error}</Alerta>}

            <div className="flex flex-wrap items-center gap-3">
              <Boton variante="secundario" onClick={() => void cargar()} disabled={cargando || migrando}>
                Probar conexión
              </Boton>
              {usuario.rol === 'SUPER_ADMIN' && base !== null && !base.inicializada && (
                <Boton onClick={() => void alMigrar()} disabled={migrando || !estado?.googleConfigurado}>
                  {migrando ? 'Migrando… (puede tardar unos minutos)' : 'Migrar el GENERAL DE CLIENTES al VPS'}
                </Boton>
              )}
            </div>

            {usuario.rol === 'SUPER_ADMIN' && base !== null && !base.inicializada && !estado?.googleConfigurado && (
              <p className="text-sm text-slate-500">
                Para migrar hace falta la conexión con Google configurada en esta computadora (la migración lee la
                hoja por última vez). Cargala en «Conexión con Google» y volvé acá.
              </p>
            )}
          </div>
        )}
      </Tarjeta>
    </div>
  )
}
