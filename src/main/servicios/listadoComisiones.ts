// Consulta del listado de Comisiones (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor.
//
// Una fila por PAGO (`pagos`, la misma fuente que la rendición de Imputados y que la pestaña Comisiones del panel
// de Cobranzas). El cálculo de la comisión es EXACTAMENTE la regla de `comisionesLocal` (servicios/cobranzas.ts),
// aplicada pago por pago en vez de por compañía y mes:
//   - % Comisión PAS: el `comision_porcentaje` de la compañía (Administración → Compañías), buscada por el nombre
//     normalizado de la compañía del pago (`comisionPorCompania()`). Un 0 o una compañía sin cargar es «sin
//     porcentaje»: no entra en el cálculo y la fila lo muestra vacío, igual que la pestaña («sin cargar»).
//   - Base: el importe del pago (`importe_monto`). La pestaña calcula la comisión sobre «lo cobrado», que es la
//     suma de esos importes, así que la base de cada pago es su propio importe. No hay otra base en los datos.
//   - Comisión: importe × % / 100, redondeada a centavos. La pestaña redondea UNA vez sobre el total de la compañía,
//     y acá se redondea cada pago: la suma de las filas puede diferir de la pestaña en unos centavos.
// Otras diferencias a propósito con la pestaña, que agrupa por el MES QUE PAGA (`periodo`): este listado filtra por
// la FECHA DE COBRO (`fecha_iso`), así que un pago adelantado cae en el mes en que se cobró y no en el que paga.
// Como la pestaña, cuenta todos los pagos (también los IMPUTADOS) y no filtra por sucursal.
//
// Lo que no sale de `pagos` se lee de la póliza con JOINs al leer: productor y ramo (por el vehículo). La forma de
// pago es el medio con que se cobró ese pago (`medio`), no la forma de pago de la póliza.
import { coincideAlguno, listaDeFiltro } from "../../shared/filtros";
import { pareceIso } from "../../shared/polizas";
import { mismaRama, ramaDeVehiculo, NOMBRE_RAMA } from "../../shared/ramas";
import { nombreDeTipoDeRiesgo } from "../../shared/riesgos";
import type {
  FilaDeComision,
  FiltrosDeComisiones,
  OpcionesDeComisiones,
} from "../../shared/listados/comisiones";
import { db } from "../db/base";
import { limpiar, normalizarTexto } from "../importacion/normalizar";
import { comisionPorCompania } from "./companias";
import { objeto } from "./validacion";

interface FilaCruda {
  fila_id: string;
  poliza_id: number | null;
  cliente_id: number | null;
  fecha_iso: string;
  compania: string | null;
  numero: string | null;
  cliente_nombre: string | null;
  importe_monto: number | null;
  medio: string | null;
  productor: string | null;
  tipo_vehiculo: string | null;
  categoria_vehiculo: string | null;
}

// El rango se filtra en SQL (comparación de fechas ISO, con el índice de la tabla como mucho); lo demás, en memoria.
const SELECT_COMISIONES = `
  SELECT
    p.fila_id, p.poliza_id, COALESCE(p.cliente_id, pol.cliente_id) AS cliente_id, p.fecha_iso, p.compania,
    COALESCE(NULLIF(TRIM(p.numero_poliza), ''), pol.numero) AS numero,
    COALESCE(NULLIF(TRIM(p.cliente_nombre), ''), cl.nombre) AS cliente_nombre,
    p.importe_monto, p.medio, pol.productor,
    v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo
  FROM pagos p
  LEFT JOIN polizas pol ON pol.id = p.poliza_id
  LEFT JOIN clientes cl ON cl.id = COALESCE(p.cliente_id, pol.cliente_id)
  LEFT JOIN vehiculos v ON v.id = pol.vehiculo_id
  WHERE p.fecha_iso IS NOT NULL
    AND p.fecha_iso >= @desde
    AND p.fecha_iso <= @hasta
`;

/** El ramo: la rama del vehículo o, si no es una de las siete, el tipo de riesgo («Hogar»). Igual que en los otros listados. */
function ramoDeLaFila(
  fila: Pick<FilaCruda, "tipo_vehiculo" | "categoria_vehiculo">,
): string | null {
  const rama = ramaDeVehiculo(fila.tipo_vehiculo, fila.categoria_vehiculo);
  if (rama) return NOMBRE_RAMA[rama];
  return nombreDeTipoDeRiesgo(fila.tipo_vehiculo) || null;
}

// Sólo para los desplegables: los valores distintos que hay en los pagos, con un SELECT DISTINCT. No arma filas, no
// calcula comisiones ni toca la tabla de porcentajes, así que es barato aunque haya años de pagos (antes la pantalla
// pedía todos los pagos con un rango 1900-2999 y se llevaba la tabla entera por IPC).
const SELECT_OPCIONES = `
  SELECT DISTINCT p.compania, p.medio, pol.productor,
    v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo
  FROM pagos p
  LEFT JOIN polizas pol ON pol.id = p.poliza_id
  LEFT JOIN vehiculos v ON v.id = pol.vehiculo_id
  WHERE p.fecha_iso IS NOT NULL
`;

export function opcionesDeComisiones(): OpcionesDeComisiones {
  const crudas = db()
    .prepare(SELECT_OPCIONES)
    .all() as Pick<
    FilaCruda,
    "compania" | "medio" | "productor" | "tipo_vehiculo" | "categoria_vehiculo"
  >[];
  const companias = new Set<string>();
  const ramas = new Set<string>();
  const productores = new Set<string>();
  const formasDePago = new Set<string>();
  for (const c of crudas) {
    const compania = limpiar(c.compania);
    if (compania) companias.add(compania);
    const ramo = ramoDeLaFila(c);
    if (ramo) ramas.add(ramo);
    const productor = limpiar(c.productor);
    if (productor) productores.add(productor);
    const medio = limpiar(c.medio);
    if (medio) formasDePago.add(medio);
  }
  const ordenado = (s: Set<string>) =>
    [...s].sort((a, b) => a.localeCompare(b, "es"));
  return {
    companias: ordenado(companias),
    ramas: ordenado(ramas),
    productores: ordenado(productores),
    formasDePago: ordenado(formasDePago),
  };
}

export function listarComisionesDelListado(
  filtros: FiltrosDeComisiones,
): FilaDeComision[] {
  const f = objeto(filtros ?? {}, "Los filtros");
  const desde = pareceIso(limpiar(f.desde)) ? limpiar(f.desde) : "";
  const hasta = pareceIso(limpiar(f.hasta)) ? limpiar(f.hasta) : "";
  // Sin rango de fechas de cobro no se consulta nada: es una búsqueda, no una lista que se carga sola.
  if (!desde || !hasta || desde > hasta) return [];

  const companias = listaDeFiltro(f.companias);
  const ramas = listaDeFiltro(f.ramas);
  const productores = listaDeFiltro(f.productores);
  const formasDePago = listaDeFiltro(f.formasDePago);

  const crudas = db()
    .prepare(SELECT_COMISIONES)
    .all({ desde, hasta }) as FilaCruda[];
  const porcentajes = comisionPorCompania();

  const filas: FilaDeComision[] = [];
  for (const cruda of crudas) {
    if (!coincideAlguno(companias, cruda.compania)) continue;
    if (!coincideAlguno(productores, cruda.productor)) continue;
    if (!coincideAlguno(formasDePago, cruda.medio)) continue;
    const ramo = ramoDeLaFila(cruda);
    if (ramas.length > 0 && !ramas.some((r) => mismaRama(r, ramo))) continue;

    const compania = limpiar(cruda.compania);
    const importe =
      typeof cruda.importe_monto === "number" &&
      Number.isFinite(cruda.importe_monto)
        ? cruda.importe_monto
        : null;
    // Mismo criterio que la pestaña: un porcentaje en 0 o ausente es «sin cargar».
    const cargado = compania
      ? (porcentajes[normalizarTexto(compania)] ?? 0)
      : 0;
    const porcentaje = cargado > 0 ? cargado : null;

    filas.push({
      id: cruda.fila_id,
      polizaId: cruda.poliza_id,
      clienteId: cruda.cliente_id,
      fecha: cruda.fecha_iso,
      compania: compania || null,
      numero: limpiar(cruda.numero) || null,
      ramo,
      cliente: limpiar(cruda.cliente_nombre) || "Sin nombre",
      importePago: importe,
      porcentaje,
      base: importe,
      comision:
        importe !== null && porcentaje !== null
          ? Math.round(importe * porcentaje) / 100
          : null,
      formaPago: limpiar(cruda.medio) || null,
      productor: limpiar(cruda.productor) || null,
    });
  }

  // Por fecha de cobro (la más antigua primero) y, a igual fecha, por cliente.
  return filas.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.cliente.localeCompare(b.cliente, "es") ||
      a.id.localeCompare(b.id),
  );
}
