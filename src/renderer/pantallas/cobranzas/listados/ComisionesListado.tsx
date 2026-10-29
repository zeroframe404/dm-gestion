// Listado de Comisiones (Cobranzas → Comisiones): es una BÚSQUEDA, no una lista que se carga sola. El rango de
// fechas de COBRO es obligatorio; sin él «Buscar» queda apagado y la tabla pide elegirlo. Una fila por pago, con la
// comisión calculada con la misma regla que la pestaña Comisiones del panel (ver servicios/listadoComisiones.ts).
// Tabla paginada de 10 y exportación a Excel de TODO el resultado. Contrato en shared/listados/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FILTROS_DE_COMISIONES_VACIOS,
  type FilaDeComision,
  type FiltrosDeComisiones,
  type OpcionesDeComisiones,
} from "../../../../shared/listados/comisiones";
import { Alerta, Boton, cx } from "../../../componentes/ui";
import { FiltroMultiple } from "../../../componentes/FiltroMultiple";
import {
  CampoDeFiltro,
  CeldaDoble,
  CLASES_INPUT_DE_FILTRO,
  EncabezadoDePantalla,
  GrillaDeFiltros,
  PanelDeFiltros,
  RangoDeFechasConAtajos,
  TablaDeListado,
  type ColumnaDeListado,
} from "../../../componentes/listados";
import { useRefrescoEnVivo } from "../../../contexto/DatosEnVivo";
import { useNavegacion } from "../../../contexto/Navegacion";
import { exportarAExcel } from "../../../exportarAExcel";
import { numero, pesos } from "../formato";

const AVISO_SIN_VENDEDORES =
  "Todavía no está disponible: los pagos y las pólizas no tienen vendedor. Para filtrar por quien la vende usá Productores.";
const AVISO_SIN_GRUPOS =
  "Todavía no está disponible: todavía no existen los grupos de clientes.";
const MOTIVO_SIN_RANGO = "Elegí el rango de fechas de cobro para poder buscar.";
const TEXTO_SIN_RANGO =
  "Seleccioná un rango de fechas de cobro para buscar comisiones";

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Sin fecha, un guion. */
function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const SIN_OPCIONES: OpcionesDeComisiones = {
  companias: [],
  ramas: [],
  productores: [],
  formasDePago: [],
};

/** El rango es válido cuando están las dos fechas y no están al revés. */
function rangoCompleto(
  f: Pick<FiltrosDeComisiones, "desde" | "hasta">,
): boolean {
  return f.desde !== "" && f.hasta !== "" && f.desde <= f.hasta;
}

/** El porcentaje como se lee en Administración → Compañías: «12,5 %». */
function verPorcentaje(porcentaje: number | null): string {
  return porcentaje === null ? "—" : `${porcentaje.toLocaleString("es-AR")} %`;
}

export default function ComisionesListado() {
  const { ir } = useNavegacion();
  const [borrador, setBorrador] = useState<FiltrosDeComisiones>(
    FILTROS_DE_COMISIONES_VACIOS,
  );
  // null = todavía no se buscó nada. Una búsqueda se hace con «Buscar», no al tipear.
  const [aplicados, setAplicados] = useState<FiltrosDeComisiones | null>(null);
  const [filas, setFilas] = useState<FilaDeComision[]>([]);
  // Las opciones de los desplegables: llegan aparte (valores distintos), sin traer los pagos.
  const [opciones, setOpciones] = useState<OpcionesDeComisiones>(SIN_OPCIONES);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // Cada carga lleva número: si llega una respuesta vieja después de una nueva, se descarta.
  const peticion = useRef(0);
  const peticionDelCatalogo = useRef(0);

  const cargar = useCallback(
    async (filtros: FiltrosDeComisiones, enSilencio = false) => {
      const mia = ++peticion.current;
      if (!enSilencio) setCargando(true);
      const resultado = await window.dm.listados.comisiones(filtros);
      if (mia !== peticion.current) return;
      if (resultado.ok) {
        setFilas(resultado.datos);
        setError(null);
      } else {
        // Si la búsqueda falla no se dejan los resultados de la anterior: parecerían ser los de estos filtros.
        setFilas([]);
        setError(resultado.error);
      }
      // La respuesta vigente siempre cierra el «Cargando», aunque sea una recarga silenciosa que pisó a una búsqueda en vuelo.
      setCargando(false);
    },
    [],
  );

  const cargarCatalogo = useCallback(async () => {
    const mia = ++peticionDelCatalogo.current;
    // Canal liviano: sólo qué compañías, ramas, productores y formas de pago existen, sin filas ni comisiones.
    const resultado = await window.dm.listados.comisionesOpciones();
    if (mia !== peticionDelCatalogo.current) return;
    if (resultado.ok) setOpciones(resultado.datos);
  }, []);

  useEffect(() => {
    void cargarCatalogo();
  }, [cargarCatalogo]);

  useEffect(() => {
    if (aplicados) void cargar(aplicados);
  }, [cargar, aplicados]);

  // Un pago cargado en otra sucursal aparece solo. Sin búsqueda hecha no se recarga nada (ni siquiera las opciones).
  useRefrescoEnVivo({
    tipos: ["PAGOS", "MENSUAL"],
    recargar: async () => {
      if (!aplicados) return;
      await Promise.all([cargarCatalogo(), cargar(aplicados, true)]);
    },
  });

  const { companias, ramas, productores, formasDePago } = opciones;

  const hayRango = rangoCompleto(borrador);

  // Los totales del resultado (todos los pagos, no sólo la página) y las compañías que quedaron fuera del cálculo.
  const resumen = useMemo(() => {
    let cobrado = 0;
    let comision = 0;
    const sinPorcentaje = new Set<string>();
    for (const f of filas) {
      cobrado += f.importePago ?? 0;
      comision += f.comision ?? 0;
      if (f.porcentaje === null && (f.importePago ?? 0) > 0)
        sinPorcentaje.add(f.compania ?? "(sin compañía)");
    }
    return {
      cobrado,
      comision: Math.round(comision * 100) / 100,
      sinPorcentaje: [...sinPorcentaje].sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    };
  }, [filas]);

  const buscar = () => {
    if (!hayRango) return;
    setAviso(null);
    setAplicados({ ...borrador });
  };
  const limpiar = () => {
    peticion.current++;
    setAviso(null);
    setError(null);
    setBorrador(FILTROS_DE_COMISIONES_VACIOS);
    setAplicados(null);
    setFilas([]);
    setCargando(false);
  };

  const exportar = async () => {
    setExportando(true);
    setAviso(null);
    // Todo el resultado (no sólo la página que se ve), con las columnas y el orden de la tabla.
    const resultado = await exportarAExcel({
      titulo: "Listado de Comisiones",
      columnas: [
        "Fecha",
        "Compañía",
        "Póliza",
        "Cliente",
        "Importe Pago",
        "% Comisión PAS",
        "Base",
        "Comisión",
        "Productor",
      ],
      filas: filas.map((f) => [
        verFecha(f.fecha) === "—" ? "" : verFecha(f.fecha),
        f.compania ?? "",
        f.numero ?? "",
        f.cliente,
        f.importePago,
        f.porcentaje,
        f.base,
        f.comision,
        f.productor ?? "",
      ]),
    });
    setExportando(false);
    if (!resultado.ok) setError(resultado.error);
    else if (resultado.datos.ruta)
      setAviso(`Se guardó el Excel en ${resultado.datos.ruta}`);
  };

  const columnas: ColumnaDeListado<FilaDeComision>[] = [
    { id: "fecha", encabezado: "Fecha", celda: (f) => verFecha(f.fecha) },
    { id: "compania", encabezado: "Compañía", celda: (f) => f.compania ?? "—" },
    {
      id: "poliza",
      encabezado: "Póliza",
      celda: (f) => {
        const polizaId = f.polizaId;
        return (
          <CeldaDoble
            principal={f.numero ?? "Sin número"}
            secundario={f.ramo}
            alHacerClic={
              polizaId !== null ? () => ir("polizas", { polizaId }) : undefined
            }
          />
        );
      },
    },
    { id: "cliente", encabezado: "Cliente", celda: (f) => f.cliente },
    {
      id: "importe",
      encabezado: "Importe Pago",
      celda: (f) => (f.importePago === null ? "—" : pesos(f.importePago)),
    },
    {
      id: "porcentaje",
      encabezado: "% Comisión PAS",
      celda: (f) => verPorcentaje(f.porcentaje),
    },
    {
      id: "base",
      encabezado: "Base",
      celda: (f) => (f.base === null ? "—" : pesos(f.base)),
    },
    {
      id: "comision",
      encabezado: "Comisión",
      celda: (f) =>
        f.comision === null ? (
          "—"
        ) : (
          <span className="font-semibold text-slate-900">
            {pesos(f.comision)}
          </span>
        ),
    },
    {
      id: "productor",
      encabezado: "Productor",
      celda: (f) => f.productor ?? "—",
    },
  ];

  const hayResultados = aplicados !== null && filas.length > 0;

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDePantalla
        icono="porcentaje"
        titulo="Listado de Comisiones"
        subtitulo="Buscar las comisiones generadas por los pagos de pólizas"
        acciones={
          <Boton
            icono="descargar"
            onClick={() => void exportar()}
            cargando={exportando}
            disabled={exportando || cargando || filas.length === 0}
            title={
              filas.length === 0
                ? "Hacé una búsqueda con resultados para poder exportar."
                : undefined
            }
          >
            Exportar Excel
          </Boton>
        }
      />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <PanelDeFiltros
        abiertoPorDefecto
        alBuscar={buscar}
        alLimpiar={limpiar}
        buscando={cargando}
        buscarDeshabilitado={!hayRango}
        motivoSinBuscar={MOTIVO_SIN_RANGO}
      >
        <GrillaDeFiltros columnas={4}>
          <RangoDeFechasConAtajos
            etiqueta="Rango de Fechas de Cobro"
            obligatorio
            desde={borrador.desde}
            hasta={borrador.hasta}
            alCambiar={(desde, hasta) =>
              setBorrador((b) => ({ ...b, desde, hasta }))
            }
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Compañías"
            valores={borrador.companias}
            opciones={companias}
            alCambiar={(v) => setBorrador((b) => ({ ...b, companias: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Ramas"
            valores={borrador.ramas}
            opciones={ramas}
            alCambiar={(v) => setBorrador((b) => ({ ...b, ramas: v }))}
          />
          <FiltroMultiple
            variante="chips"
            etiqueta="Productores"
            plural="todos"
            valores={borrador.productores}
            opciones={productores}
            alCambiar={(v) => setBorrador((b) => ({ ...b, productores: v }))}
          />
          <CampoDeFiltro etiqueta="Vendedores">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value="Todos"
              disabled
              readOnly
              title={AVISO_SIN_VENDEDORES}
              aria-label={`Vendedores. ${AVISO_SIN_VENDEDORES}`}
            />
          </CampoDeFiltro>
          <CampoDeFiltro etiqueta="Grupos">
            <input
              className={CLASES_INPUT_DE_FILTRO}
              value="Todos"
              disabled
              readOnly
              title={AVISO_SIN_GRUPOS}
              aria-label={`Grupos. ${AVISO_SIN_GRUPOS}`}
            />
          </CampoDeFiltro>
          <FiltroMultiple
            variante="chips"
            etiqueta="Formas de Pago"
            valores={borrador.formasDePago}
            opciones={formasDePago}
            alCambiar={(v) => setBorrador((b) => ({ ...b, formasDePago: v }))}
          />
        </GrillaDeFiltros>
      </PanelDeFiltros>

      {hayResultados && (
        <div className="flex flex-wrap items-center gap-3">
          <Total etiqueta="Pagos" valor={numero(filas.length)} />
          <Total etiqueta="Cobrado" valor={pesos(resumen.cobrado)} />
          <Total
            etiqueta="Comisión estimada"
            valor={pesos(resumen.comision)}
            destacado
          />
        </div>
      )}
      {hayResultados && resumen.sinPorcentaje.length > 0 && (
        <Alerta tono="aviso">
          Sin porcentaje de comisión cargado: {resumen.sinPorcentaje.join(", ")}
          . Esos pagos figuran sin comisión; cargalo en{" "}
          <strong className="font-semibold">Administración → Compañías</strong>{" "}
          para que entren en el cálculo.
        </Alerta>
      )}

      <TablaDeListado
        etiqueta="Listado de comisiones"
        columnas={columnas}
        filas={aplicados ? filas : []}
        clave={(f) => f.id}
        cargando={cargando}
        vacio={
          aplicados
            ? "No se encontraron pagos en ese rango de fechas de cobro"
            : TEXTO_SIN_RANGO
        }
      />
    </div>
  );
}

function Total({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-1.5",
        destacado
          ? "border-marino-200 bg-marino-50 text-marino-900"
          : "border-slate-200 bg-white text-slate-900",
      )}
    >
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">
        {etiqueta}
      </span>
      <span className="font-display text-lg font-extrabold tabular-nums">
        {valor}
      </span>
    </div>
  );
}
