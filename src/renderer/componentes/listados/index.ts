// Componentes compartidos de las pantallas de listado de Cartera. Cada uno documenta su uso arriba.
// FiltroMultiple (con variante="chips") y exportarAExcel viven fuera de esta carpeta: ver
// ../FiltroMultiple.tsx y ../../exportarAExcel.ts.
export { BotonPildora } from './BotonPildora'
export { ChipDeEstado, type TonoDeChip } from './ChipDeEstado'
export { AccionNoDisponible, EncabezadoDePantalla } from './EncabezadoDePantalla'
export { FILAS_POR_PAGINA, paginar, paginasVisibles, Paginador } from './Paginador'
export { CampoDeFiltro, CLASES_INPUT_DE_FILTRO, GrillaDeFiltros, PanelDeFiltros } from './PanelDeFiltros'
export { proximosDias, rangoDeMes, RangoDeFechasConAtajos } from './RangoDeFechasConAtajos'
export { CeldaDoble, TablaDeListado, type ColumnaDeListado } from './TablaDeListado'
