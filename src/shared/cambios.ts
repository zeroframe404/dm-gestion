// Historial de cambios de DM Gestión: lo que muestra el cartel «Cambios recientes» al ingresar después de
// una actualización y la ventana «Históricos» de Acerca de. Al sacar una versión nueva se AGREGA una entrada
// arriba de todo (la más nueva primero). Las versiones beta (17.7.5-beta.3) usan la entrada de su número base.
//
// REGLA DEL PROYECTO (ver CLAUDE.md): todo cambio que llega a la gente suma su renglón ACÁ, en el mismo PR.
// Va en la entrada de la versión que va a salir: en `beta`, el próximo parche del package.json (con 17.9.0
// en el package.json, la beta es 17.9.1-beta.N y su entrada es '17.9.1'). Escrito para la agencia, no para
// programadores. pruebas/cambios.prueba.ts falla si la entrada de la versión del package.json no existe.

export type TipoDeCambio = 'agregado' | 'modificado' | 'corregido' | 'eliminado'

export interface Cambio {
  tipo: TipoDeCambio
  texto: string
}

export interface VersionConCambios {
  version: string
  /** AAAA-MM-DD */
  fecha: string
  cambios: Cambio[]
}

export const ETIQUETA_DE_TIPO: Record<TipoDeCambio, string> = {
  agregado: 'Agregado',
  modificado: 'Modificado',
  corregido: 'Corregido',
  eliminado: 'Eliminado',
}

export const HISTORIAL_DE_CAMBIOS: VersionConCambios[] = [
  {
    version: '17.11.1',
    fecha: '2026-11-08',
    cambios: [
      { tipo: 'agregado', texto: 'Cartera → Flotas: las empresas con 6 o más pólizas de autos con el mismo nombre aparecen solas como flota. Se busca por nombre y, al desplegar, se ven todos los autos. No hay nada que cargar.' },
      { tipo: 'agregado', texto: 'Administración → Ciberseguridad → Control de horarios (sólo superadministrador, opcional): se define en qué horario puede trabajar cada rol (Administradores y Usuarios por separado), sucursal por sucursal. Fuera de horario no se puede ingresar y aparece «Pedir excepción al super-administrador».' },
      { tipo: 'agregado', texto: 'Control de horarios: además de la hora, se eligen los días de trabajo de cada rol (por ejemplo, lunes a sábado) y se cargan los feriados de cada sucursal; en un feriado o en un día sin trabajo tampoco se puede ingresar, salvo con una excepción. «Copiar a todas las sucursales» repite un horario en las demás.' },
      { tipo: 'agregado', texto: 'Aviso de fin de turno: 30 minutos antes de que termine el horario, el programa hace un zumbido y muestra una ventana amarilla con «Aceptar» o «Pedir excepción al super-administrador». Al llegar la hora, la sesión se cierra sola y se corta la conexión con el servidor.' },
      { tipo: 'agregado', texto: 'El superadministrador recibe cada pedido de excepción con la persona, la hora, la dirección IP y la localidad, y decide si aprobar (30 minutos, 1, 2 o 4 horas) o rechazar. Todos los pedidos quedan en un registro, se aprueben o no.' },
      { tipo: 'modificado', texto: 'El rol «Empleado» pasó a llamarse «Usuario» en todo el programa (permisos, ayuda y listas). Sus permisos y las cuentas existentes no cambian.' },
    ],
  },
  {
    version: '17.11.0',
    fecha: '2026-11-06',
    cambios: [
      { tipo: 'modificado', texto: 'Inicio → Podio de altas: ahora se elige el año y el mes en dos listas separadas (primero Año y después Mes), en vez de una sola lista con todos los meses juntos.' },
      { tipo: 'corregido', texto: 'Ticketeadora: el ticket ya no se parte en dos hojas, así que la guillotina no corta más en el medio del pie («…CON LOS DE LA / PÓLIZA.»). Además queda más papel al final para que el corte caiga después de la última línea.' },
      { tipo: 'agregado', texto: 'Administración → Impresora: «Tipografía del ticket» (Courier New, Lucida Console o Consolas) e «Intensidad del texto» (Normal a Máxima), para que las letras chicas del ticket salgan más oscuras y parejas sin tocar el driver de Windows. Se prueba con «Imprimir una prueba».' },
      { tipo: 'agregado', texto: 'Clientes → Pagos: cada pago tiene su botón «Imprimir», que saca en la ticketeadora el comprobante de ese pago con el mismo número de ticket que ya tenía (no gasta uno nuevo).' },
      { tipo: 'corregido', texto: 'Ticketeadora: el ticket ya no sale corrido hacia la derecha ni se cortan los nombres. Si en tu impresora todavía queda movido, en Administración → Impresora hay un «Ajuste horizontal del texto (mm)» para centrarlo.' },
      { tipo: 'corregido', texto: 'Ticketeadora: el texto del ticket ocupa un poco menos de ancho, para que no se corten las palabras en el borde derecho del papel.' },
      { tipo: 'agregado', texto: 'Clientes → Pagos: botón «Imprimir pagos (ticketeadora)». Saca en la ticketeadora el resumen de los pagos del cliente con todos sus datos: fecha, importe, medio, período, compañía, póliza, patente, sucursal, quién cobró, número de ticket y observaciones. No gasta número de ticket ni es un comprobante de pago.' },
      { tipo: 'agregado', texto: 'Pólizas: al abrir una póliza hay dos botones nuevos, «Imprimir» y «PDF». Sacan una hoja A4 prolija con todos los datos: el asegurado, la póliza, la vigencia, el riesgo (vehículo, motor, chasis…), observaciones, pagos y siniestros. Imprime en la impresora de documentos elegida en Administración → Impresora, nunca en la ticketeadora. Sale lo que está guardado: si cambiaste algo, guardá antes.' },
      { tipo: 'agregado', texto: 'Planilla del mes: en el detalle de cada fila (el panel de la derecha) hay un botón «Ver ficha del cliente» que abre directo la ficha con sus pólizas, pagos, siniestros y demás.' },
      { tipo: 'modificado', texto: 'Planilla del mes: en un mes ya cerrado ahora también los empleados pueden usar «Registrar pago», para cobrar la cuota atrasada de ese mes (por ejemplo, la de octubre ya cerrado). El resto del mes cerrado sigue siendo sólo para consultar.' },
      { tipo: 'corregido', texto: 'Registrar pago: al elegir «Sólo la de (mes anterior)» (cuota vencida) ya no aparece el recuadro del pago adelantado del mes que viene, que no tenía nada que ver.' },
      { tipo: 'agregado', texto: 'Podio de altas (Inicio): cada sucursal tiene ahora el botón «Ver gráficos» con los de su propia cartera: evolución de seguros activos, altas y bajas mes a mes, seguros por compañía, bajas por motivo, morosidad de las cuotas y siniestros abiertos. Lo ve cualquiera que ve el podio.' },
      { tipo: 'corregido', texto: 'Galeno (imprimir un documento): el campo «Riesgo» sólo acepta el número del vehículo en la póliza. Si se escribía texto (como «todo riesgo») salía el error «For input string»; ahora no deja escribirlo y, si llega igual, avisa qué poner.' },
      { tipo: 'corregido', texto: 'ATM (motos): si la versión de la moto existe igual en ATM (por ejemplo TNT 752S de Benelli) se elige sola, aunque el modelo del catálogo sea una categoría como «CALLE MAS DE 600 CC». Antes había que cargarla a mano.' },
      { tipo: 'corregido', texto: 'Equidad y Mercantil Andina: si la versión del vehículo existe tal cual en la compañía (por ejemplo TIGGO 2 1.5 4X2 PRO CONFORT) se elige sola, aunque haya otra parecida con una palabra más (CVT). Antes pedía elegirla a mano.' },
      { tipo: 'corregido', texto: 'Mercantil Andina: ahora reconoce solo el modelo cuando se llama igual en su lista (por ejemplo SPIN), en vez de pedir que se lo elija a mano.' },
      { tipo: 'corregido', texto: 'Multicotizador: si el asegurado es persona jurídica, ya no se piden Sexo ni Fecha de nacimiento.' },
    ],
  },
  {
    version: '17.10.0',
    fecha: '2026-11-06',
    cambios: [
      { tipo: 'corregido', texto: 'Equidad: la compañía devuelve su moneda con el código vacío y ahora se le manda así, tal cual, con lo que vuelven a aparecer la vigencia, la forma de pago y las cuotas. Si igual no contesta, el campo dice con qué códigos se probó.' },
      { tipo: 'corregido', texto: 'Equidad: si la compañía no informa el código de la moneda, el cotizador prueba los códigos corrientes hasta que le devuelva los modos de facturación (vigencia), formas de pago y cuotas, y lo avisa en la tarjeta.' },
      { tipo: 'agregado', texto: 'Impresora: ahora se puede configurar una impresora común (hojas A4) para los documentos grandes, como los presupuestos, a la vez que la ticketeadora de los comprobantes. Se elige en Administración → Impresora; sin elegirla, imprimir sigue abriendo el diálogo de Windows.' },
      { tipo: 'corregido', texto: 'Equidad: si una lista de la compañía (moneda, vigencia, forma de pago o cuotas) llega vacía, el formulario ya no queda trabado: prueba con la otra moneda y, si igual no hay opciones, dice qué contestó Equidad.' },
      { tipo: 'modificado', texto: 'Multicotizador: el comparativo ahora muestra una tarjeta por cotización, separadas por tipo de cobertura y ordenadas de la más barata (a la izquierda) a la más cara, con desplazamiento horizontal.' },
      { tipo: 'agregado', texto: 'Asegurados: filtro por aseguradora y por origen del dato. Cada aseguradora dice si la confirmó su API (Galeno, ATM, Equidad) o si sale de la cartera (VPS).' },
      { tipo: 'modificado', texto: 'Asegurados: diseño nuevo con tarjetas de resumen, estado de cada API, barra rápida de aseguradoras y una tabla más clara.' },
      { tipo: 'corregido', texto: 'Equidad: el ingreso a la API prueba también el usuario de servicio (Basic) con el usuario de la API, y el error dice qué revisar.' },
      { tipo: 'modificado', texto: 'Equidad: la cotización se manda con la forma del ejemplo que dio la compañía.' },
      { tipo: 'modificado', texto: 'Equidad: la cotización va con el usuario de la API como sistema de origen, como indicó la compañía.' },
      { tipo: 'corregido', texto: 'Equidad: cuando el usuario de servicio pasa y la que falla es la contraseña de aplicación, el error lo dice así, con el código de Equidad.' },
      { tipo: 'corregido', texto: 'Equidad: se leen bien los productores, las monedas y las categorías de IVA (tenían mal la dirección del servicio), y la rama de autos por defecto pasa a ser la 1.' },
      { tipo: 'corregido', texto: 'El cartel «Cambios recientes» vuelve a aparecer después de cada actualización, también en la beta.' },
    ],
  },
  {
    version: '17.9.0',
    fecha: '2026-11-04',
    cambios: [
      { tipo: 'agregado', texto: 'Marketing → Redes: pestaña TikTok por sucursal para vincular la cuenta y publicar videos ahora o programados.' },
      { tipo: 'agregado', texto: 'Administración → Redes sociales: la app de TikTok de cada sucursal, guardada cifrada sólo en el servidor.' },
    ],
  },
  {
    version: '17.8.0',
    fecha: '2026-11-03',
    cambios: [
      { tipo: 'modificado', texto: 'Mi link: una página por sucursal. El superadministrador ve la lista de sucursales y configura cada una.' },
      { tipo: 'corregido', texto: 'Tema oscuro: se leen bien las etiquetas de la lista de cambios.' },
    ],
  },
  {
    version: '17.7.5',
    fecha: '2026-10-31',
    cambios: [
      { tipo: 'agregado', texto: 'Cartel «Cambios recientes» al ingresar después de cada actualización y botón «Históricos» en Acerca de.' },
      { tipo: 'agregado', texto: 'Mi link: sección nueva con Mi página, Solicitudes, Siniestros y Métricas.' },
      { tipo: 'modificado', texto: 'Cartera: Grupos pasa a llamarse Flotas, con indicador y pestaña de almacenamiento en la nube.' },
      { tipo: 'modificado', texto: 'Cartera y Cobranzas: grupos de menú con sus listados (Asegurados, Pólizas, Siniestros, Vencimientos, Rechazos y Comisiones).' },
      { tipo: 'agregado', texto: 'Multicotizador: opción «Otro» (no binario / X) en Sexo, y DNI y CUIT con formato mientras se escriben.' },
      { tipo: 'corregido', texto: 'IMPUTADOS sin encabezados: la sincronización vuelve a subir y bajar los pagos.' },
    ],
  },
  {
    version: '17.7.3',
    fecha: '2026-10-31',
    cambios: [
      { tipo: 'agregado', texto: 'Impresora común (hoja A4) como alternativa a la ticketeadora térmica.' },
      { tipo: 'modificado', texto: 'Multicotizador: el modelo espera al año; se agregan «Otros usos» y la marca «Otro rastreador».' },
      { tipo: 'corregido', texto: 'Redes sociales: el ejemplo de la dirección de vuelta ya no lleva el dominio de la agencia.' },
      { tipo: 'corregido', texto: 'Equidad: la URL base se corta en /servlet/ y se limpian los espacios invisibles al pegar.' },
    ],
  },
  {
    version: '17.7.2',
    fecha: '2026-10-22',
    cambios: [
      { tipo: 'agregado', texto: 'Multicotizador con sublista: cotizar auto y moto, cotizaciones, planes y emisiones.' },
      { tipo: 'modificado', texto: 'Multicotizador: formulario en grilla 2×2 (asegurado, vehículo, cotización y accesorios).' },
      { tipo: 'corregido', texto: 'Mercantil: si con débito contesta MCA500, se cotiza con cupón y se explica el error sin el JSON crudo.' },
    ],
  },
  {
    version: '17.7.1',
    fecha: '2026-10-20',
    cambios: [{ tipo: 'modificado', texto: 'Mercantil: se cotiza con la forma real de su API.' }],
  },
]

/** `17.7.5-beta.41` → `[17, 7, 5]` */
function partes(version: string): number[] {
  return version
    .split('-')[0]!
    .split('.')
    .map((parte) => Number.parseInt(parte, 10) || 0)
}

export function compararVersiones(a: string, b: string): number {
  const x = partes(a)
  const y = partes(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diferencia = (x[i] ?? 0) - (y[i] ?? 0)
    if (diferencia !== 0) return diferencia
  }
  return 0
}

/**
 * Las versiones que hay que mostrar al ingresar: las posteriores a la última que esa persona vio y hasta la
 * instalada. Si nunca vio ninguna, sólo la actual (no se vuelca todo el historial de golpe).
 *
 * Cada actualización muestra el cartel: si la versión instalada cambió pero no hay una entrada más nueva que
 * la vista (una beta nueva del mismo número, 17.9.1-beta.5 → 17.9.1-beta.6), se vuelve a mostrar la entrada
 * de la versión instalada, que en la beta va sumando renglones con cada cambio.
 */
export function cambiosPendientes(versionActual: string, ultimaVista: string | null, historial = HISTORIAL_DE_CAMBIOS): VersionConCambios[] {
  const hastaActual = historial.filter((entrada) => compararVersiones(entrada.version, versionActual) <= 0)
  if (!ultimaVista) return hastaActual.slice(0, 1)
  if (ultimaVista === versionActual) return []
  const nuevas = hastaActual.filter((entrada) => compararVersiones(entrada.version, ultimaVista) > 0)
  if (nuevas.length > 0) return nuevas
  return hastaActual.filter((entrada) => compararVersiones(entrada.version, versionActual) === 0).slice(0, 1)
}
