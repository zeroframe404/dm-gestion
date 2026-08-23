import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_ADMINISTRACION: Record<string, ContenidoDeAyuda> = {
  'administracion.usuarios': {
    clave: 'administracion.usuarios',
    titulo: 'Administración → Usuarios',
    resumen: 'Quién puede entrar a DM Gestión, con qué rol y en qué sucursal. Sólo la ve un superadministrador.',
    secciones: [
      {
        titulo: 'Qué se hace acá',
        parrafos: [
          'Esta pantalla es donde se crean, editan y desactivan los usuarios de la agencia, se les asigna un rol y una sucursal, y se resetean contraseñas cuando alguien se olvida la suya. Es la única sección que ve exclusivamente el superadministrador: ni un administrador ni un empleado pueden entrar acá.',
          'Los usuarios se comparten automáticamente entre todas las computadoras y todas las sucursales: si creás o editás a alguien desde una PC, ese cambio vale para todas las demás sin tener que repetir nada. Con «Nuevo usuario» se da de alta a alguien, con una contraseña inicial que va a tener que cambiar la primera vez que ingrese; «Editar» cambia nombre, usuario, rol o sucursal; «Resetear contraseña» define una contraseña temporal para cuando alguien se la olvidó; y el botón de encendido activa o desactiva a una persona (desactivarla no borra sus datos, sólo le impide iniciar sesión).',
        ],
      },
      {
        titulo: 'Los tres roles',
        parrafos: [
          'EMPLEADO ve y usa el día a día de la agencia (cartera, clientes, cobranzas, siniestros, etcétera) pero no entra a Administración salvo «Acerca de». ADMIN ve además Compañías, Impresora, Conexión con Google, Importar desde Google y Sincronización. SUPER_ADMIN tiene todo lo anterior más esta pantalla, Usuarios, y es el único que puede resolver un problema serio con la lista compartida de usuarios si llegara a aparecer.',
        ],
      },
      {
        titulo: 'Ingresar sin conexión a internet',
        parrafos: [
          'Cada computadora recuerda, de forma segura, la última persona que entró ahí con internet, para que pueda seguir trabajando aunque se corte la conexión: alcanza con la misma contraseña que usó la última vez. En cuanto vuelve internet, esa sesión se vuelve a confirmar sola contra la lista compartida, sin que haga falta hacer nada. Si en un mostrador varias personas usan la misma computadora, sólo la última que entró con conexión queda guardada para entrar sin internet ahí.',
          'Si la lista compartida todavía está vacía (una agencia recién configurada), un cartel lo avisa y ofrece «Subir usuarios»: se hace una sola vez, desde la computadora que ya tiene cargada la gente real, para que a partir de ahí todas las demás compartan la misma lista.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Rol',
        explicacion: 'Qué partes de la aplicación puede ver y usar cada persona: EMPLEADO, ADMIN o SUPER_ADMIN, de menos a más permisos.',
      },
      {
        termino: 'Ingresar sin internet',
        explicacion: 'Cada computadora puede dejar entrar, sin conexión, a la última persona que se conectó ahí con internet, usando su última contraseña válida. Al volver la conexión, se revalida sola.',
      },
      {
        termino: 'Subir usuarios',
        explicacion: 'El paso único, desde la computadora con la lista real de gente, para que todas las sucursales empiecen a compartir la misma lista de usuarios.',
      },
      {
        termino: 'Desactivar',
        explicacion: 'Le impide a una persona iniciar sesión, sin borrar nada de lo que cargó antes. Se puede reactivar en cualquier momento.',
      },
    ],
  },
  'administracion.companias': {
    clave: 'administracion.companias',
    titulo: 'Administración → Compañías',
    resumen: 'Los días de cobertura financiera de cada aseguradora, el porcentaje de comisión y el mensaje del aviso de vencimiento.',
    secciones: [
      {
        titulo: 'Días de cobertura financiera',
        parrafos: [
          'Cada compañía sigue cubriendo al cliente durante unos días después del vencimiento de la cuota, aunque todavía no haya pagado; eso son los «días de cobertura financiera», y varían de una aseguradora a otra. Mientras corren esos días, la fila de esa póliza se ve amarilla en la planilla de la Cartera; el último día se ve naranja; y una vez que se acaban, sin pago, la fila pasa a roja. Este número se edita a mano en la columna «Días de cobertura»: se hace clic en el número, se escribe el nuevo y se guarda solo al salir del campo.',
        ],
      },
      {
        titulo: 'Porcentaje de comisión',
        parrafos: [
          'Es lo que la aseguradora le reconoce a la agencia por cada póliza. Se usa en Cobranzas → Comisiones para estimar cuánto deja cada mes según lo que se cobró. Se edita igual que los días de cobertura: clic en el número de la fila de esa compañía, escribir el nuevo porcentaje y listo.',
        ],
      },
      {
        titulo: 'El mensaje del aviso de vencimiento',
        parrafos: [
          'Es el texto que se manda cuando se toca «Avisar» en la Cartera o en la Mora, con {nombre}, {cuota} y {vencimiento} que se completan solos con los datos de cada persona. Se puede editar libremente y, si algo sale mal, «Restaurar el original» lo vuelve a dejar como viene de fábrica. Abajo del cuadro de texto se ve cómo queda el mensaje con un ejemplo, antes de guardar.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Días de cobertura financiera',
        explicacion: 'Los días que una compañía sigue cubriendo al cliente después del vencimiento sin haber cobrado. Definen cuándo la fila de la planilla pasa de amarilla a naranja y a roja.',
      },
      {
        termino: 'Comisión',
        explicacion: 'El porcentaje que la aseguradora le paga a la agencia por cada póliza, usado para estimar lo que deja el mes en Cobranzas → Comisiones.',
      },
    ],
  },
  'administracion.impresora': {
    clave: 'administracion.impresora',
    titulo: 'Administración → Impresora',
    resumen: 'La configuración de la ticketeadora térmica del mostrador, para que cada pago cobrado imprima su comprobante solo.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Si el mostrador de una sucursal tiene una impresora térmica de las que usan rollo angosto (80 mm, las típicas de los comercios), esta pantalla la configura para que, al registrar un pago en Cobranzas, salga el comprobante solo, sin ningún cartel ni diálogo que interrumpa. Es completamente opcional: sin configurar nada, cobrar y registrar pagos funciona exactamente igual, simplemente no sale ningún papel.',
        ],
      },
      {
        titulo: 'Cómo se configura',
        parrafos: [
          'Se tilda «Imprimir un comprobante al registrar un pago», se elige la impresora de la lista que detecta esta computadora (o se escribe el nombre a mano si Windows no encuentra ninguna) y se confirma el ancho del papel, que en una POS-80 es 80 milímetros. «Guardar» aplica los cambios, y «Imprimir una prueba» manda un comprobante de prueba para confirmar que todo funciona antes de usarla con un cliente delante; ese botón sólo se habilita una vez guardados los cambios.',
        ],
      },
      {
        titulo: 'Si algo sale mal',
        parrafos: [
          'El comprobante nunca puede frenar un cobro: si la impresora falla, el pago se guarda igual y sólo el papel es lo que no sale. Si el último ticket no se pudo imprimir, esta pantalla muestra el motivo en un aviso, para poder revisar el cable, el papel o el nombre de la impresora sin perder ningún pago.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Ticketeadora térmica',
        explicacion: 'Una impresora de recibo angosto (80 mm), como las de un comercio, que imprime sin tinta usando papel especial.',
      },
    ],
  },
  'administracion.google': {
    clave: 'administracion.google',
    titulo: 'Administración → Conexión con Google',
    resumen: 'La configuración técnica, una sola vez, para que DM Gestión pueda leer y escribir en la planilla de Google de toda la vida.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'DM Gestión trabaja con la misma planilla de Google que la agencia usó siempre. Para que la aplicación pueda leerla y escribir en ella, hace falta una credencial técnica que arma quien pone en marcha el sistema (no es algo que tenga que tocar el equipo día a día): un archivo con datos de acceso y la dirección de la hoja de cálculo. Esto se configura una sola vez por agencia, no por computadora ni por persona.',
        ],
      },
      {
        titulo: 'Los dos datos que se cargan',
        parrafos: [
          'El primer campo es el contenido del archivo de credenciales que entrega Google al crear el acceso técnico; se pega tal cual, completo. El segundo es la dirección (URL) de la hoja de cálculo de la agencia. Un detalle importante: además de pegar estos datos, la hoja de Google tiene que compartirse como editor con el correo que figura en la credencial, o la aplicación no va a poder escribir en ella.',
        ],
      },
      {
        titulo: 'Dónde queda guardado',
        parrafos: [
          'Estos datos se guardan únicamente en esta computadora, nunca viajan a ningún otro lado ni se comparten con las demás sucursales: cada computadora que necesite importar o sincronizar tiene que configurarse acá una vez. Una vez guardada la conexión, se usa desde Importar desde Google y desde Sincronización.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Credencial técnica (cuenta de servicio)',
        explicacion: 'Un acceso especial que entrega Google para que un programa, y no una persona, pueda leer y escribir en una hoja de cálculo.',
      },
    ],
  },
  'administracion.importar': {
    clave: 'administracion.importar',
    titulo: 'Administración → Importar desde Google',
    resumen: 'Trae los datos de la planilla de Google hacia DM Gestión: clientes, vehículos, pólizas, cuotas, bajas, siniestros y más.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Esta pantalla lee completa la hoja configurada en Conexión con Google y carga (o actualiza) con eso la información de DM Gestión: clientes, vehículos, pólizas, cuotas de cada mes, bajas, riesgos varios, siniestros, reglas de cobertura y pagos. Se puede correr todas las veces que haga falta: la aplicación reconoce cada fila de la hoja y no la duplica, aunque se vuelva a importar la misma planilla.',
        ],
      },
      {
        titulo: 'Analizar antes de importar',
        parrafos: [
          '«Analizar hoja» revisa la planilla sin cambiar nada todavía, y muestra qué pestañas encontró, de qué tipo es cada una (planilla mensual, bajas, siniestros, etcétera) y cuál parece ser la más nueva. Conviene analizar primero para confirmar que la hoja está como se espera antes de tocar «Importar», que sí trae los datos de verdad y actualiza la aplicación.',
        ],
      },
      {
        titulo: 'Mientras corre y al terminar',
        parrafos: [
          'Con la importación en marcha se ve el progreso pestaña por pestaña, y se puede cancelar en cualquier momento: lo que ya se guardó queda guardado, no se pierde. Al terminar aparece un informe con los totales de cada tipo de dato y, si los hubo, los datos raros que encontró (fechas imposibles, un DNI repetido, una sucursal que no está en la lista, y cosas así) sin que eso frene el resto de la importación. El informe se puede descargar o abrir su carpeta para guardarlo como constancia.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Importar',
        explicacion: 'Traer los datos de la hoja de Google hacia DM Gestión. Se puede repetir sin duplicar nada.',
      },
      {
        termino: 'Datos raros',
        explicacion: 'Filas de la hoja con algo que no se pudo interpretar del todo (una fecha rara, un dato faltante). Quedan anotadas en el informe, pero no frenan la importación.',
      },
    ],
  },
  'administracion.sincronizacion': {
    clave: 'administracion.sincronizacion',
    titulo: 'Administración → Sincronización',
    resumen: 'Mantiene a DM Gestión y a la planilla de Google al día en los dos sentidos, y muestra qué está esperando para subir.',
    secciones: [
      {
        titulo: 'Cómo funciona',
        parrafos: [
          'Una vez conectada la hoja, cualquier cambio que se hace en DM Gestión (un pago, una baja, un dato editado) se sube solo a la planilla de Google cada pocos segundos, y lo que se edita directamente en la hoja se trae de vuelta cada algunos minutos. No hace falta hacer nada manual para que esto funcione: pasa solo, todo el tiempo, mientras haya conexión.',
          '«Sincronizar ahora» fuerza un ciclo inmediato en lugar de esperar al próximo automático. «Forzar bajada completa» vuelve a traer la hoja entera desde cero, útil si algo quedó desactualizado y se quiere estar seguro de que todo coincide.',
        ],
      },
      {
        titulo: 'La cola de subida',
        parrafos: [
          'Es la lista de cambios hechos en DM Gestión que todavía no llegaron a la hoja de Google, por ejemplo porque se cortó internet. No se pierde nada: apenas vuelve la conexión, la cola se vacía sola. Si algún cambio no se pudo subir por un problema puntual, queda marcado «No se pudo» y el botón «Volver a intentar los que fallaron» lo reintenta.',
        ],
      },
      {
        titulo: 'Últimos movimientos y respaldos',
        parrafos: [
          'Más abajo se ve un historial de lo último que pasó (subidas, bajadas, algún conflicto resuelto), útil para entender qué pasó si algo no cuadra. Y todos los días, después de las ocho de la noche, se guarda automáticamente una copia completa de la hoja en un archivo aparte, por si alguna vez hiciera falta volver atrás; se conservan las últimas 30 copias, y «Respaldar ahora» genera una en el momento.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Sincronización',
        explicacion: 'El proceso automático que mantiene a DM Gestión y a la planilla de Google iguales en los dos sentidos, sin necesidad de importar a mano.',
      },
      {
        termino: 'Cola de subida',
        explicacion: 'Los cambios hechos en DM Gestión que todavía no llegaron a la hoja de Google, normalmente porque se está esperando conexión.',
      },
      {
        termino: 'Respaldo',
        explicacion: 'Una copia guardada aparte de toda la hoja, por si alguna vez hace falta recuperar información.',
      },
    ],
  },
  'administracion.acerca': {
    clave: 'administracion.acerca',
    titulo: 'Administración → Acerca de',
    resumen: 'La versión instalada, si hay una actualización disponible y el estado de la base de usuarios compartida.',
    secciones: [
      {
        titulo: 'Versión y actualizaciones',
        parrafos: [
          'DM Gestión se actualiza sola: busca versiones nuevas al abrirse y cada cuatro horas mientras está en uso, y cuando encuentra una la descarga sin interrumpir el trabajo. Cuando está lista, aparece una barra arriba de la pantalla avisando que hay una versión nueva, con un botón «Reiniciar ahora» para instalarla en el momento (si no se toca, se instala sola la próxima vez que se cierra el programa). Desde esta pantalla, el botón «Buscar actualizaciones» chequea a mano en cualquier momento, sin esperar al chequeo automático.',
        ],
      },
      {
        titulo: 'Estado de la base de usuarios',
        parrafos: [
          'Acá se ve si esta computadora está usando la lista de usuarios compartida entre sucursales o todavía no, cuándo fue la última vez que se confirmó contra esa lista, y si hay alguien guardado para poder ingresar sin conexión a internet en esta computadora en particular. «Probar conexión» vuelve a comprobar el acceso en el momento, útil si hubo un problema de internet hace poco y se quiere confirmar que ya se resolvió.',
        ],
      },
      {
        titulo: 'Datos para soporte técnico',
        parrafos: [
          'Más abajo figuran datos técnicos (versión de los componentes internos, carpeta donde se guarda la información) que normalmente no hacen falta para el trabajo diario, pero que sirven si en algún momento hay que llamar a soporte técnico y piden esos números.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Actualización automática',
        explicacion: 'DM Gestión revisa sola si hay una versión nueva y la instala con un aviso y un botón, sin necesidad de descargar nada a mano.',
      },
    ],
  },
}
