// La tarjeta de «ya hay un cliente con ese documento»: quién es, de qué sucursal, cuántas pólizas tiene.
//
// Se usa en dos lugares del alta: cuando el documento ya existía al guardar (la pantalla de siempre) y,
// con el PDF de la póliza, apenas se lee el DNI y antes de pedir nada más. En el segundo caso se muestra
// también el nombre que figura en el PDF, y se avisa si no se parece: un DNI mal leído no tiene que
// terminar agregándole la póliza a la persona equivocada.
import type { ReactNode } from 'react'
import { nombresParecidos } from '../../../shared/lecturaDePoliza'
import type { FilaCliente } from '../../../shared/tipos'
import { Alerta, Etiqueta } from '../../componentes/ui'

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  )
}

export function TarjetaDeClienteExistente({ cliente, nombreDelPdf }: { cliente: FilaCliente; nombreDelPdf?: string }) {
  const distinto = nombreDelPdf !== undefined && nombreDelPdf.trim() !== '' && !nombresParecidos(nombreDelPdf, cliente.nombre)
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="font-display text-base font-bold text-slate-900">{cliente.nombre}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Dato etiqueta="DNI/CUIT">
            <span className="tabular-nums">{cliente.documento ?? '—'}</span>
          </Dato>
          <Dato etiqueta="Sucursal">{cliente.sucursal ?? '—'}</Dato>
          <Dato etiqueta="Celular/WhatsApp">
            <span className="tabular-nums">{cliente.telefono ?? '—'}</span>
          </Dato>
          <Dato etiqueta="Pólizas activas">
            <span className="tabular-nums">{cliente.polizasActivas}</span>
            {cliente.conDeuda && (
              <span className="ml-2">
                <Etiqueta tono="peligro">Con deuda</Etiqueta>
              </span>
            )}
          </Dato>
        </dl>
      </div>
      {nombreDelPdf !== undefined && nombreDelPdf.trim() !== '' && (
        <p className="text-sm text-slate-600">
          En el PDF figura: <strong className="font-semibold text-slate-800">{nombreDelPdf}</strong>
        </p>
      )}
      {distinto && (
        <Alerta tono="aviso">
          El nombre del PDF no se parece al de este cliente. Revisá que el DNI esté bien leído antes de agregarle la póliza.
        </Alerta>
      )}
    </div>
  )
}
