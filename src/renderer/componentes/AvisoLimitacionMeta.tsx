// El aviso de «esto no se puede hacer desde acá»: amarillo, con el símbolo de información, para
// cuando la API de Meta no deja hacer algo directo desde el programa (una acción que Facebook o
// Instagram no exponen, o que se probó y Meta la rechazó puntualmente). El texto siempre termina
// diciendo que hay que hacerlo directamente desde Instagram o Facebook — es la única salida cuando
// pasa esto, y conviene que se lea siempre igual.
import { Icono } from './Icono'

export function AvisoLimitacionMeta({ motivo }: { motivo: string }) {
  return (
    <div role="status" className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
      <Icono nombre="info" tamano={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 leading-relaxed">
        {motivo} Hacé esta acción directamente desde Instagram o Facebook.
      </div>
    </div>
  )
}
