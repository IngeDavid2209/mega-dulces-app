/**
 * 🔀 QUIÉN VE UNA TAREA DE MANTENIMIENTO O SISTEMAS
 *
 * Fija la instrucción de David del 20/sep: los puestos de sucursal y zona no
 * ven esas tareas **salvo las que su sucursal levantó**.
 *
 * Las dos mitades importan, y la segunda más: que se recorte a quien debe, y
 * que NO se le esconda el trabajo a quien tiene que hacerlo. Esconder una
 * orden de mantenimiento al técnico no se reporta como bug — se reporta como
 * que la app no sirve.
 *
 * Todos los `puestoId` de aquí existen en `organigrama.catalogo.ts`.
 */

import {
  esAreaTransversal, esOperacionDeZona, perteneceAlArea, origenDeTarea,
  pasaFiltroTransversal, UNIDADES_DE_ZONA, AREAS_TRANSVERSALES,
} from './area-transversal.util';

describe('áreas transversales: MANTENIMIENTO y SISTEMAS', () => {

  // La ficha de una Encargada REAL, medida el 15/sep: su `sucursales[]` lleva
  // su tienda y las dos áreas, porque desde ahí levanta tickets.
  const ENCARGADA = {
    rol: 'trabajador', nombre: 'Elena Encargada',
    sucursales: ['8 Esquinas', 'MANTENIMIENTO', 'SISTEMAS'],
    puestoId: 'encargado-sucursal',
    datos: { puestoId: 'encargado-sucursal' },
  };
  const PERMITIDAS_ENC = ['8 Esquinas', 'MANTENIMIENTO', 'SISTEMAS'];

  const AUXILIAR = { ...ENCARGADA, nombre: 'Aura Auxiliar',
    puestoId: 'auxiliar-encargado', datos: { puestoId: 'auxiliar-encargado' } };
  const GERENTE = { rol: 'trabajador', nombre: 'Gema Gerente',
    sucursales: ['8 Esquinas', 'La Piedad Abastos', 'MANTENIMIENTO'],
    puestoId: 'gerencia-zona', datos: { puestoId: 'gerencia-zona' } };
  const SISTEMAS = { rol: 'trabajador', nombre: 'Sil Sistemas',
    sucursales: ['SISTEMAS'], puestoId: 'infraestructura-seguridad',
    datos: { puestoId: 'infraestructura-seguridad' } };
  const MANTENIMIENTO = { rol: 'trabajador', nombre: 'Mario Mantenimiento',
    sucursales: ['MANTENIMIENTO'], puestoId: 'jefe-mantenimiento',
    datos: { puestoId: 'jefe-mantenimiento' } };
  const ADMIN = { rol: 'admin', alcance: 'global', nombre: 'Dora' };
  const SIN_PUESTO = { rol: 'trabajador', nombre: 'Nadia SinPuesto',
    sucursales: ['8 Esquinas', 'MANTENIMIENTO'] };

  const orden = (extra: any = {}) => ({
    store: 'MANTENIMIENTO', assigned: 'Mario Mantenimiento', createdBy: 'Otra Persona',
    mantenimiento: { sucursalOrigen: 'Canindo' }, ...extra,
  });

  // ═══ 0 · LA PREMISA ═════════════════════════════════════════════════════

  it('la rama de Gerencia de Zona cubre sucursal, zona y sus áreas de apoyo', () => {
    // Si el organigrama cambiara y esta rama dejara de incluir `sucursal`, los
    // casos de abajo pasarían por el camino equivocado sin fallar.
    for (const u of ['zona', 'sucursal', 'staff-zona', 'operaciones-zona', 'ventas']) {
      expect(UNIDADES_DE_ZONA.has(u as any)).toBe(true);
    }
    expect(UNIDADES_DE_ZONA.has('sistemas' as any)).toBe(false);
    expect(UNIDADES_DE_ZONA.has('cedis' as any)).toBe(false);
  });

  it('reconoce las dos áreas, sin importar mayúsculas ni espacios', () => {
    expect(AREAS_TRANSVERSALES.length).toBe(2);
    expect(esAreaTransversal('MANTENIMIENTO')).toBe(true);
    expect(esAreaTransversal(' sistemas ')).toBe(true);
    expect(esAreaTransversal('Canindo')).toBe(false);
    expect(esAreaTransversal('')).toBe(false);
    expect(esAreaTransversal(null)).toBe(false);
  });

  // ═══ 1 · A QUIÉN LE APLICA EL RECORTE ═══════════════════════════════════

  it('aplica a Encargada, Auxiliar y Gerente de Zona', () => {
    expect(esOperacionDeZona(ENCARGADA)).toBe(true);
    expect(esOperacionDeZona(AUXILIAR)).toBe(true);
    expect(esOperacionDeZona(GERENTE)).toBe(true);
  });

  it('NO aplica a quien trabaja en el área', () => {
    expect(esOperacionDeZona(SISTEMAS)).toBe(false);
    expect(esOperacionDeZona(MANTENIMIENTO)).toBe(false);
  });

  it('NO aplica a un admin global: ve la empresa por definición', () => {
    expect(esOperacionDeZona(ADMIN)).toBe(false);
  });

  it('NO aplica a una ficha SIN puesto — la red, y es deliberada', () => {
    // Son 44 fichas activas (15/sep). Recortarles la vista por un campo que
    // les falta podría dejar a un técnico sin ver sus órdenes, y eso es peor
    // que una Encargada viendo de más.
    expect(esOperacionDeZona(SIN_PUESTO)).toBe(false);
    expect(pasaFiltroTransversal(SIN_PUESTO, orden(), ['8 Esquinas', 'MANTENIMIENTO'])).toBe(true);
  });

  // ═══ 2 · EL RECORTE (lo que David pidió) ════════════════════════════════

  it('la Encargada NO ve una orden de OTRA sucursal', () => {
    // Hoy sí la ve: MANTENIMIENTO está en su `sucursales[]` y el filtro casa
    // el `store` contra esa lista. Éste es el caso que motivó el cambio.
    expect(pasaFiltroTransversal(ENCARGADA, orden(), PERMITIDAS_ENC)).toBe(false);
  });

  it('el Auxiliar tampoco', () => {
    expect(pasaFiltroTransversal(AUXILIAR, orden(), PERMITIDAS_ENC)).toBe(false);
  });

  it('el Gerente de Zona tampoco, si la orden es de una tienda que no es suya', () => {
    expect(pasaFiltroTransversal(GERENTE, orden(), GERENTE.sucursales)).toBe(false);
  });

  // ═══ 3 · «SOLO ASÍ PUEDEN VER LAS QUE ASIGNARON» ════════════════════════

  it('SÍ ve la orden cuyo ORIGEN es su sucursal', () => {
    const c = orden({ mantenimiento: { sucursalOrigen: '8 Esquinas' } });
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  it('SÍ ve la que ella misma levantó, aunque no diga origen', () => {
    const c = orden({ createdBy: 'Elena Encargada', mantenimiento: {} });
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  it('SÍ ve la que le asignaron a ella, aunque el área sea otra', () => {
    // Sin esto, el día que a alguien de sucursal le toque apoyar en una orden,
    // la tarea le desaparecería de la lista y nadie sabría por qué.
    const c = orden({ assigned: 'Elena Encargada' });
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  it('el Gerente de Zona ve la orden de CUALQUIERA de sus tiendas', () => {
    const c = orden({ mantenimiento: { sucursalOrigen: 'La Piedad Abastos' } });
    expect(pasaFiltroTransversal(GERENTE, c, GERENTE.sucursales)).toBe(true);
  });

  // ═══ 4 · QUIEN HACE EL TRABAJO NO PIERDE NADA ═══════════════════════════

  it('Mantenimiento ve TODAS las órdenes', () => {
    expect(perteneceAlArea(MANTENIMIENTO, 'MANTENIMIENTO')).toBe(true);
    expect(pasaFiltroTransversal(MANTENIMIENTO, orden(), ['MANTENIMIENTO'])).toBe(true);
  });

  it('Sistemas ve TODAS las tareas de Sistemas', () => {
    const c = { store: 'SISTEMAS', assigned: 'Otro', createdBy: 'Otro' };
    expect(perteneceAlArea(SISTEMAS, 'SISTEMAS')).toBe(true);
    expect(pasaFiltroTransversal(SISTEMAS, c, ['SISTEMAS'])).toBe(true);
  });

  it('pero Sistemas NO es de Mantenimiento ni al revés', () => {
    expect(perteneceAlArea(SISTEMAS, 'MANTENIMIENTO')).toBe(false);
    expect(perteneceAlArea(MANTENIMIENTO, 'SISTEMAS')).toBe(false);
  });

  it('el admin global ve todo', () => {
    expect(pasaFiltroTransversal(ADMIN, orden(), null)).toBe(true);
  });

  // ═══ 5 · NADA MÁS SE ESCONDE ════════════════════════════════════════════

  it('una tarea NORMAL de su sucursal no se toca', () => {
    const c = { store: '8 Esquinas', assigned: 'Otra', createdBy: 'Otra' };
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  it('una tarea de OTRA sucursal tampoco se toca aquí: de eso ya se ocupa `alcanceCubre`', () => {
    // Este archivo no puede esconder nada que no sea de un área transversal.
    // Que no vea Canindo lo decide el filtro de siempre, y sigue haciéndolo.
    const c = { store: 'Canindo', assigned: 'Otra', createdBy: 'Otra' };
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  it('una tarea de otra área corporativa (RH) NO se recorta: David nombró dos', () => {
    const c = { store: 'RH', assigned: 'Otra', createdBy: 'Otra' };
    expect(pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).toBe(true);
  });

  // ═══ 6 · EL ORIGEN ══════════════════════════════════════════════════════

  it('lee el origen y trata el vacío como ausente', () => {
    expect(origenDeTarea(orden())).toBe('Canindo');
    expect(origenDeTarea(orden({ mantenimiento: { sucursalOrigen: '  ' } }))).toBeNull();
    expect(origenDeTarea(orden({ mantenimiento: {} }))).toBeNull();
    expect(origenDeTarea({ store: 'SISTEMAS' })).toBeNull();
  });

  it('una tarea de SISTEMAS no tiene origen, así que solo la ve quien la creó', () => {
    // Dato que FALTA, no rellenado por parecido: el formulario solo pide origen
    // para MANTENIMIENTO. Es exactamente «solo así pueden ver las que asignaron».
    const ajena = { store: 'SISTEMAS', assigned: 'Sil Sistemas', createdBy: 'Otra Persona' };
    const mia   = { store: 'SISTEMAS', assigned: 'Sil Sistemas', createdBy: 'Elena Encargada' };
    expect(pasaFiltroTransversal(ENCARGADA, ajena, PERMITIDAS_ENC)).toBe(false);
    expect(pasaFiltroTransversal(ENCARGADA, mia, PERMITIDAS_ENC)).toBe(true);
  });

  // ═══ 7 · LA GUARDIA ═════════════════════════════════════════════════════

  it('la muestra DISCRIMINA: hay tareas que pasan y tareas que no', () => {
    const casos = [
      orden(),
      orden({ mantenimiento: { sucursalOrigen: '8 Esquinas' } }),
      { store: '8 Esquinas', assigned: 'X', createdBy: 'Y' },
      { store: 'SISTEMAS', assigned: 'X', createdBy: 'Y' },
    ];
    const pasan = casos.filter(c => pasaFiltroTransversal(ENCARGADA, c, PERMITIDAS_ENC)).length;
    expect(pasan).toBe(2);   // ni 0 ni 4: el filtro distingue
  });
});
