import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_POLIZAS: Record<string, ContenidoDeAyuda> = {
  polizas: {
    clave: 'polizas',
    titulo: 'Pólizas',
    resumen:
      'Una fila por cada póliza de la cartera, con su vigencia y su estado a la vista, y el alta o la edición en la misma pantalla.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado completo de pólizas de la agencia: cliente, compañía, número, cobertura, patente y vehículo, cuota, vigencia y estado. Hacé clic en cualquier fila para abrirla y corregir lo que haga falta. Arriba tenés un buscador (por cliente, DNI/CUIT, número de póliza o patente) y cuatro filtros —Estado, Compañía, Sucursal y Cobertura— que se pueden combinar entre sí.',
          'No es lo mismo que la Cartera: la Cartera muestra la planilla del mes con lo que hay que cobrar; Pólizas muestra el historial completo de cada póliza, esté vigente, vencida o dada de baja, sin importar el mes.',
        ],
      },
      {
        titulo: 'Los tres estados de una póliza',
        parrafos: [
          'El estado se calcula solo, no lo elige nadie a mano. Una póliza está Activa mientras no se le puso una fecha de baja y su vigencia no pasó (o no tiene vigencia cargada, en cuyo caso se la sigue considerando activa). Pasa a Vencida cuando su fecha de vigencia «hasta» ya quedó atrás pero nadie la dio de baja: sigue siendo parte de la cartera, sólo que hay que renovarla o resolverla, por eso se marca en ámbar y no en rojo. Pasa a Baja únicamente cuando alguien la dio de baja a propósito, con un motivo.',
          'Cuando a una póliza activa le quedan 60 días o menos para vencer, la fila muestra además un aviso tipo «vence en 12 días» (o «vence hoy», «vence mañana»): es la misma cuenta que usa la bandeja de Renovaciones, así que las dos pantallas van a decir siempre lo mismo.',
        ],
      },
      {
        titulo: 'Cargar o editar una póliza',
        parrafos: [
          'Con «Nueva póliza» arrancás una en blanco; haciendo clic en una fila entrás a editar esa póliza. Primero se elige el cliente (buscándolo por nombre o DNI, o ya viene elegido si entraste desde la ficha de un cliente) y después el vehículo: uno de los que ya tiene cargados o uno nuevo, con patente, marca, modelo, año y el resto de los datos. Si el cliente no tiene ningún vehículo cargado, la pantalla pasa sola a «Cargar uno nuevo».',
          'Después van los datos de la póliza en sí: compañía, cobertura, forma de pago, cuota, día de vencimiento de la cuota, número de póliza y de propuesta, y la vigencia (desde y hasta). Las fechas de vigencia se escriben tal como están en la planilla de siempre, porque conviven fechas escritas de formas distintas y no tiene sentido forzarlas todas al mismo molde. El campo «Avisar vto.» se completa con AVISAR cuando esa póliza tiene que entrar en los avisos de vencimiento; y en «Observaciones» se puede anotar, por ejemplo, «20% aumentar cuando se renueva», que es justo el texto que hace aparecer el aviso de aumento en la bandeja de Renovaciones.',
        ],
      },
      {
        titulo: 'El aviso de antigüedad',
        parrafos: [
          'Mientras se completan la compañía, la cobertura y el año del vehículo, la pantalla avisa sola si esa compañía no acepta esa cobertura para un auto tan viejo (según lo que esté cargado en Cartera → Reglas de cobertura). Si no hay ninguna regla cargada para esa combinación, o el año del vehículo no se puede leer, no aparece ningún aviso: la ayuda es eso, una ayuda, nunca un impedimento por las dudas.',
          'Cuando el aviso sí aparece y es un problema real, un administrador o superadministrador puede tildar «Continuar igual» para guardar la póliza de todas formas (queda registrado que la confirmó esa persona); un empleado de mostrador ve el mismo aviso pero no puede destildarlo: tiene que pedirle a un administrador que la confirme.',
        ],
      },
      {
        titulo: 'Dar de baja una póliza',
        parrafos: [
          'Desde una póliza ya cargada, el botón «Dar de baja» pide un motivo (por ejemplo, vendió el auto, se cambió de compañía, anuló) y una nota, y saca la póliza de la cartera activa: pasa a verse en Cartera → Bajas y su estado queda en Baja. Una vez dada de baja se puede seguir corrigiendo algún dato mal cargado, pero no hay forma de «reactivarla» desde acá: si vuelve, se carga como póliza nueva.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Activa',
        explicacion: 'La póliza está en la cartera y su vigencia todavía no pasó (o no tiene vigencia cargada).',
      },
      {
        termino: 'Vencida',
        explicacion: 'La fecha «vigencia hasta» ya pasó pero nadie la dio de baja: sigue siendo cartera, hay que renovarla.',
      },
      {
        termino: 'Baja',
        explicacion: 'Alguien la dio de baja a propósito, con un motivo. Es el único estado que se elige a mano.',
      },
      {
        termino: 'Aviso de antigüedad',
        explicacion:
          'Mensaje que avisa si la compañía elegida no acepta esa cobertura para un vehículo tan viejo, según las reglas cargadas en Cartera → Reglas de cobertura. Sólo un administrador puede confirmar «Continuar igual» cuando hay un problema real.',
      },
      {
        termino: '«Vence en X días»',
        explicacion: 'Aviso que aparece cuando a una póliza activa le quedan 60 días o menos de vigencia: la misma cuenta que usa la bandeja de Renovaciones.',
      },
    ],
  },
}
