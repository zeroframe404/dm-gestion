// La barra que dice si las listas de este módulo están al día con las de las otras computadoras.
//
// El problema que resuelve: estas cuatro listas no tienen pestaña en la planilla, así que no viajan
// con la sincronización de todos los días. Viajan por el puente de ajustes del VPS, y ese puente es
// manual de un lado (alguien publica) y automático del otro (el resto adopta al arrancar). Sin esta
// barra, la computadora de Sarandí podía estar mostrando una lista de precios de hace tres meses sin
// que nadie tuviera manera de notarlo.
//
// Se dibuja sola sólo cuando hay algo que decir. En una computadora sin VPS configurado (desarrollo)
// no aparece: no hay con quién compartir nada y un cartel permanente sería ruido.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeReferencias, ListasDeCompanias } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Boton, haceCuanto } from '../../componentes/ui'

interface Props {
  listas: ListasDeCompanias
  alCambiar: (listas: ListasDeCompanias) => void
}

export function Compartir({ listas, alCambiar }: Props) {
  const [estado, setEstado] = useState<EstadoDeReferencias | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const consultar = useCallback(async () => {
    const resultado = await window.dm.referencias.estadoCompartido()
    if (resultado.ok) setEstado(resultado.datos)
    // Un fallo consultando el estado no se le muestra a nadie: la barra desaparece y el módulo sigue
    // andando con lo que hay cargado, que es lo único que hace falta para atender.
  }, [])

  useEffect(() => {
    void consultar()
    // Se vuelve a preguntar cada vez que cambian las listas: después de guardar un precio, esta
    // computadora deja de estar al día y hay que decirlo en el momento, no en la próxima apertura.
  }, [consultar, listas])

  const publicar = async () => {
    setTrabajando(true)
    setError(null)
    setMensaje(null)
    const resultado = await window.dm.referencias.publicar()
    setTrabajando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setMensaje('Listo: las otras computadoras las adoptan solas la próxima vez que abran el programa.')
    } else setError(resultado.error)
  }

  const traer = async () => {
    setTrabajando(true)
    setError(null)
    setMensaje(null)
    const resultado = await window.dm.referencias.adoptar()
    setTrabajando(false)
    if (resultado.ok) {
      alCambiar(resultado.datos.listas)
      setMensaje(resultado.datos.detalle)
      void consultar()
    } else setError(resultado.error)
  }

  if (!estado || !estado.hayServidor) return null

  const puedePublicar = listas.puedeEditar
  const alDia = estado.enElServidor && estado.alDia

  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-8 py-2 text-xs ${
        alDia ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <Icono nombre={alDia ? 'nube' : 'alerta'} tamano={15} className="shrink-0" />

      {!estado.enElServidor && (
        <span>
          Estas listas todavía no se compartieron con las otras computadoras: por ahora viven sólo acá.
          {!puedePublicar && ' Las publica el superadministrador.'}
        </span>
      )}
      {estado.enElServidor && alDia && (
        <span>
          Al día con las otras computadoras
          {estado.actualizadoEn && ` · las publicó ${estado.actualizadoPor ?? 'alguien'} ${haceCuanto(estado.actualizadoEn)}`}.
        </span>
      )}
      {estado.enElServidor && !alDia && (
        <span>
          {estado.sinPublicar
            ? 'Acá hay cambios que todavía no se publicaron, así que esta computadora quedó distinta de las demás'
            : 'Las otras computadoras publicaron algo más nuevo que lo que hay acá'}
          {estado.actualizadoEn && ` (última publicación: ${estado.actualizadoPor ?? 'alguien'}, ${haceCuanto(estado.actualizadoEn)})`}.{' '}
          {puedePublicar
            ? 'Publicá para que valga lo de acá, o traé lo del servidor para quedarte con lo de allá.'
            : 'Traé lo del servidor para trabajar con lo mismo que el resto.'}
        </span>
      )}

      {error && <span className="font-semibold text-red-700">{error}</span>}
      {mensaje && !error && <span className="font-semibold text-green-700">{mensaje}</span>}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {estado.enElServidor && !alDia && (
          <Boton
            tamano="sm"
            icono="nubeBajada"
            onClick={() => void traer()}
            cargando={trabajando}
            // Traer REEMPLAZA lo de acá. Si hay cambios sin publicar, el aviso lo dice antes de que
            // alguien lo toque de apurado: es la única acción de este módulo que borra algo.
            title={
              estado.sinPublicar
                ? 'Reemplaza las listas de esta computadora por las del servidor. Lo que se cargó acá y no se publicó se pierde.'
                : 'Trae las listas que publicaron desde otra computadora.'
            }
          >
            Traer lo del servidor
          </Boton>
        )}
        {puedePublicar && !alDia && (
          <Boton tamano="sm" variante="primario" icono="subir" onClick={() => void publicar()} cargando={trabajando}>
            Publicar para todas
          </Boton>
        )}
      </div>
    </div>
  )
}
