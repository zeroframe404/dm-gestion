import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_METRICAS: Record<string, ContenidoDeAyuda> = {
  metricas: {
    clave: 'metricas',
    titulo: 'Métricas',
    resumen:
      'El tablero de números de la agencia, mes a mes y por sucursal: activos, altas, bajas, cobranza y siniestros, calculado solo y sin planillas que se rompen.',
    secciones: [
      {
        titulo: 'Qué es este tablero',
        parrafos: [
          'Es el reemplazo de mirar las pestañas de resumen de la planilla de siempre a mano: los mismos números, pero calculados solos y siempre al día. Arriba se elige el Mes y, si hace falta, una Sucursal puntual (o «Todas» para ver la agencia entera). Cambiar cualquiera de los dos vuelve a calcular todo el tablero para esa combinación.',
          'Si el mes elegido no tiene un mes anterior cargado en el sistema, un aviso lo explica: las altas se cuentan comparando contra el mes de antes, así que sin ese punto de referencia figuran con un guion (no con un cero) hasta que se importe el mes previo.',
        ],
      },
      {
        titulo: 'Las tarjetas grandes',
        parrafos: [
          'Seguros activos: cuántas pólizas tiene la planilla de ese mes, sea cual sea su estado actual (es una foto de ese mes puntual, no de la cartera de hoy). Altas del mes: las pólizas que están en la planilla de este mes y no estaban en la del mes anterior. Bajas del mes: las que se dieron de baja en ese mes, con el motivo más frecuente a modo de resumen.',
          'Cobrado en el mes y Pendiente de cobro: cuánta plata entró y cuánta sigue faltando cobrar de las cuotas de ese mes, con la cantidad de cuotas en cada caso. Siniestros abiertos: todos los que no están en estado Cerrado, sin importar de qué mes son (un siniestro sigue «abierto» hasta que se resuelve, más allá de cuándo se cargó).',
        ],
      },
      {
        titulo: 'Los gráficos y rankings',
        parrafos: [
          'Debajo de las tarjetas hay rankings y gráficos: activos por compañía y por sucursal (con el porcentaje que representa cada una sobre el total), la evolución de la cartera mes a mes durante el último año, altas y bajas comparadas mes a mes, bajas del mes agrupadas por motivo, cobranza del mes según el medio de pago (efectivo, tarjeta, transferencia, etc.) y siniestros abiertos por compañía.',
          'Todos estos gráficos llevan también el número al lado de cada barra: no hace falta interpretar sólo el dibujo, el dato exacto siempre está escrito junto a él.',
        ],
      },
      {
        titulo: 'Cómo se cuenta cada cosa',
        parrafos: [
          'Los seguros activos de un mes son literalmente las filas de la planilla de ese mes, lo mismo que contaría alguien mirando esa pestaña a mano: no se filtra por si esa póliza sigue vigente hoy, porque eso arruinaría la lectura de los meses viejos. Las altas salen de comparar la planilla de este mes contra la del mes anterior, así que dependen de que ese mes anterior ya esté cargado en el sistema. Las bajas del mes son las que están anotadas en Cartera → Bajas de ese mismo mes. Activos, altas y bajas se cuentan una vez por póliza: si la planilla trae la misma póliza en dos renglones (ver Cartera → Duplicados), el tablero no la cuenta dos veces.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Activos',
        explicacion: 'La cantidad de pólizas que tiene la planilla del mes elegido, tal cual estaba ese mes (no se recalcula con el estado actual de la póliza).',
      },
      {
        termino: 'Altas',
        explicacion: 'Pólizas que aparecen en la planilla de este mes y no estaban en la del mes anterior. Sin mes anterior cargado, dan en cero.',
      },
      {
        termino: 'Bajas',
        explicacion: 'Pólizas dadas de baja durante ese mes, según lo anotado en Cartera → Bajas.',
      },
      {
        termino: 'Siniestros abiertos',
        explicacion: 'Los que no están en estado Cerrado, de cualquier mes: un siniestro cuenta como abierto hasta que se resuelve, sin importar cuándo se cargó.',
      },
    ],
  },
}
