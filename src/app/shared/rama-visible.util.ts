/**
 * 👁️ QUÉ PARTE DE LA OPERACIÓN VE CADA QUIEN — derivado del organigrama
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL DEFECTO QUE VIENE A ARREGLAR
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta hoy, en la pantalla de Tareas del Manual, el permiso era BINARIO:
 *
 *     puedeFiltrarVista = rol === 'admin' || esSupervisor(u)     // checklist.ts
 *
 * O veías solo lo tuyo, o veías la empresa entera desde Dirección General. No
 * había peldaños. Medido en una captura del 9/sep: una **Gerente de Zona**
 * abría sus tareas y le caían los **11 chips de unidad, 25 puestos y las 104
 * entregas de toda la operación**, con «Dirección General» de raíz.
 *
 * Ese mismo defecto ya se había narrado una vez en `checklist.ts` —una
 * Anaquelista veía el árbol completo— y se tapó con `puedeFiltrarVista`. Eso
 * arregló al colaborador y **dejó a las cinco Gerencias de Zona viendo todo**:
 * el gate estaba de menos abajo y de más arriba, que es exactamente la familia
 * de fallas del 3/sep.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL CORTE ES DE DOS EJES, Y ESO NO ES UN ADORNO
 * ═══════════════════════════════════════════════════════════════════════════
 * La tentación es cortar solo por la rama del organigrama (`reportaA`). NO
 * FUNCIONA, y se ve en el catálogo: hay **UN SOLO** puesto `gerencia-zona` para
 * las cinco zonas, porque el catálogo lista cada puesto una vez a propósito
 * («la sucursal concreta sale de los campos `sucursales` del usuario, no del
 * catálogo»). Sus descendientes son los puestos de sucursal de TODAS las zonas,
 * así que un corte por rama a secas deja a la Gerente de La Piedad viendo
 * Morelia y Yurécuaro — o sea, no arregla nada.
 *
 * Por eso son dos ejes ortogonales, que es la misma conclusión que ya dejó
 * medida el 4/sep (8 de 16 stores mezclan unidades: el lugar no determina el
 * departamento ni al revés):
 *
 *   VERTICAL   qué puestos le REPORTAN     → su puesto + descendientes (`reportaA`)
 *   HORIZONTAL en qué lugares OPERA        → su zona / su sucursal / todos
 *
 * El eje horizontal es el que **recorta** lo que se ve. El vertical es el que
 * decide qué **le cuenta a ella** y qué aparece marcado «servicio a».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA REGLA DE SEGURIDAD: SIN PUESTO NO SE LE ENCOGE LA VISTA A NADIE
 * ═══════════════════════════════════════════════════════════════════════════
 * `alcance.util.ts` ya lo dice para su propio cálculo: `nivel === null` →
 * `'ninguno'`, y «esa persona conserva lo que le dan sus banderas hoy». Aquí se
 * honra igual, y el motivo es una cifra: `esJefatura()` documenta que las fichas
 * **sin puesto son decenas**. Si se gateara por puesto a secas, decenas de
 * supervisores abrirían la pantalla y verían **vacío** — un fallo peor que ver
 * de más, porque «no veo nada» y «no tengo nada que hacer» se ven idénticos.
 *
 * Así que el error se comete SIEMPRE hacia el lado seguro: sin puesto
 * resoluble, `restringido: false` y se conserva el comportamiento de hoy. El
 * caso sale nombrado en `motivo` para que se pueda corregir, no escondido.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO QUE ESTO NO ES
 * ═══════════════════════════════════════════════════════════════════════════
 * **No es un candado.** `api/checklists.js` declara en su cabecera que «el
 * filtrado fino por rol/sucursal se mantiene EN CLIENTE»: el endpoint le manda
 * toda la operación a cualquiera con token. Esto arregla lo que se VE, no lo que
 * viaja por el cable. Cerrar eso es un paso del backend y no está hecho.
 */

import { PUESTOS_ORGANIGRAMA } from './organigrama.catalogo';
import { resolverPuesto } from './puesto.util';
import { Amplitud, alcancePropuesto } from './alcance.util';
import { zonaDeSucursal, sucursalesDeZona } from './zonas.util';
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas } from './permisos.util';

/**
 * El ámbito visible de una persona en la pantalla de tareas.
 *
 * Convención de `null`, la misma que usa `sucursalesPermitidas()`: **null = sin
 * restricción**. Un `Set` vacío sería lo contrario —no ve nada— y confundir los
 * dos es la clase de error que deja a alguien con la pantalla en blanco.
 */
export interface AmbitoVisible {
  /** El alcance derivado de su rango. */
  amplitud: Amplitud;
  /** ¿Se le recorta algo? `false` = ve lo de hoy (sin puesto, o alcance empresa). */
  restringido: boolean;
  /**
   * Dónde empieza SU árbol. `null` = desde la raíz de la empresa.
   * Es lo que hace que una Gerente deje de ver «Dirección General» encima.
   */
  raizPuestoId: string | null;
  /** Puestos que le reportan (él incluido). `null` = todos. */
  puestosPropios: Set<string> | null;
  /** Lugares donde ve operación. `null` = todos. */
  lugares: Set<string> | null;
  /** Por qué salió así. Se muestra en pantalla: un recorte mudo se lee como un bug. */
  motivo: string;
}

const SIN_RESTRICCION = (amplitud: Amplitud, motivo: string): AmbitoVisible => ({
  amplitud, restringido: false, raizPuestoId: null,
  puestosPropios: null, lugares: null, motivo,
});

/**
 * Los puestos que cuelgan de uno, él incluido.
 *
 * Recorrido iterativo con conjunto de visitados: el catálogo se valida sola una
 * vez (`arbolOrganigrama` reporta 0 ciclos), pero esta función corre en cada
 * ciclo de detección de cambios y un ciclo aquí colgaría la pantalla. El
 * `visitados` cuesta nada y convierte un dato malo en una rama corta en vez de
 * en un congelamiento.
 */
export function descendientesDe(puestoId: string): Set<string> {
  const out = new Set<string>([puestoId]);
  let frontera = [puestoId];
  while (frontera.length) {
    const siguiente: string[] = [];
    for (const p of PUESTOS_ORGANIGRAMA) {
      if (p.reportaA && frontera.includes(p.reportaA) && !out.has(p.id)) {
        out.add(p.id);
        siguiente.push(p.id);
      }
    }
    frontera = siguiente;
  }
  return out;
}

/** Los lugares declarados en la ficha, limpios y sin repetir. */
function lugaresDeFicha(usuario: any): string[] {
  const arr: string[] = Array.isArray(usuario?.sucursales) ? usuario.sucursales : [];
  const uno = usuario?.sucursal ? [usuario.sucursal] : [];
  return [...new Set([...arr, ...uno].map((s: any) => String(s || '').trim()).filter(Boolean))];
}

/**
 * Qué ve esta persona en la pantalla de tareas del manual.
 *
 * No reimplementa nada: el rango sale de `alcancePropuesto()` (que ya deriva del
 * catálogo) y los lugares de `sucursalesPermitidas()` + `zonaDeSucursal()`. Si
 * la regla se reescribiera aquí existirían dos versiones libres de discrepar.
 */
export function ambitoVisible(usuario: any): AmbitoVisible {
  if (!usuario) return SIN_RESTRICCION('ninguno', 'sin sesión');

  // Admin global: ve todo por definición, y es lo que ya hacía. Va PRIMERO
  // porque un admin global sin puesto no debe caer en la rama de abajo.
  if (esAdminGlobal(usuario)) {
    return SIN_RESTRICCION('empresa', 'Acceso total: ves toda la operación.');
  }

  const puesto = resolverPuesto(usuario);
  if (!puesto.puestoId) {
    // EL LADO SEGURO DEL ERROR (ver cabecera). Conserva lo de hoy y se nombra.
    return SIN_RESTRICCION('ninguno',
      'Tu ficha no tiene puesto del organigrama, así que no se te puede calcular ' +
      'el alcance: ves lo mismo que antes. Pídele a Sistemas que te asigne tu puesto.');
  }

  const amplitud = alcancePropuesto(usuario);
  const propios = descendientesDe(puesto.puestoId);
  const declarados = lugaresDeFicha(usuario);
  const permitidas = sucursalesPermitidas(usuario);   // null = todas

  if (amplitud === 'empresa') {
    return SIN_RESTRICCION('empresa', 'Dirección: ves toda la operación.');
  }

  // ── EL EJE HORIZONTAL ────────────────────────────────────────────────────
  let lugares: Set<string>;
  let comoSeLlama: string;

  if (amplitud === 'zona') {
    // Su zona = las zonas de las sucursales que trae su ficha, expandidas.
    // Se expande desde el mapa, NUNCA se escribe la lista aquí (§4).
    const claves = new Set(declarados.map(s => zonaDeSucursal(s)).filter(Boolean));
    const expandidas = [...claves].flatMap(z => sucursalesDeZona(z));
    // Si su ficha no dice ninguna sucursal con zona conocida, no se le inventa
    // una zona: se le deja lo declarado. Vacío se resuelve abajo.
    lugares = new Set(expandidas.length ? expandidas : declarados);
    comoSeLlama = 'tu zona';
  } else if (amplitud === 'unidad') {
    // Una jefatura responde por su bloque, que opera en los lugares de su ficha.
    // El recorte por unidad lo hace el eje VERTICAL (sus descendientes); aquí
    // solo se acota el lugar, para no mezclar dos cortes en uno.
    lugares = new Set(declarados);
    comoSeLlama = 'tu unidad';
  } else {
    // sucursal / propio / supervision → lo declarado en su ficha.
    lugares = new Set(declarados);
    comoSeLlama = amplitud === 'sucursal' ? 'tu sucursal' : 'lo tuyo';
  }

  // ── EL TECHO, Y POR QUÉ SOLO APLICA AL ADMIN LIMITADO ────────────────────
  // Aquí estaba interseccionando contra `sucursalesPermitidas()` SIEMPRE, y la
  // prueba lo cazó: esa función devuelve la lista declarada de la ficha para
  // cualquiera que no sea admin global, así que la intersección **deshacía la
  // expansión de zona** y la Gerente de La Piedad se quedaba viendo una sola
  // tienda en vez de sus dos. Medido: `lugares = {8 Esquinas}`, esperado
  // `{8 Esquinas, La Piedad Abastos}`.
  //
  // La distinción que faltaba: para una trabajadora, `sucursales[]` dice DÓNDE
  // TRABAJA — es la semilla de la que se deduce su zona, no su techo. El techo
  // solo existe cuando alguien lo declaró explícitamente, y eso es exactamente
  // lo que significa `alcance === 'sucursales'` en un admin.
  //
  // Y esto NO es una escalada: hoy una Gerente pasa `puedeFiltrarVista` y ve la
  // empresa entera. Pase lo que pase aquí, sale viendo menos que ahora.
  if (esAdminLimitado(usuario) && permitidas !== null) {
    const permitido = new Set(permitidas.map(s => String(s || '').trim()));
    lugares = new Set([...lugares].filter(l => permitido.has(l)));
  }

  // Sin ningún lugar resoluble NO se recorta: una pantalla en blanco es peor
  // que una de más, y además es indistinguible de «no hay trabajo hoy» (§5.2).
  if (lugares.size === 0) {
    return SIN_RESTRICCION(amplitud,
      'Tu ficha no tiene sucursal asignada, así que no se puede acotar lo que ves: ' +
      'ves lo mismo que antes. Pídele a Sistemas que te asigne tu sucursal.');
  }

  return {
    amplitud,
    restringido: true,
    raizPuestoId: puesto.puestoId,
    puestosPropios: propios,
    lugares,
    motivo: 'Ves ' + comoSeLlama + ': ' + [...lugares].sort().join(' · ') +
            '. Lo de otras áreas que trabaja aquí sale marcado «servicio a».',
  };
}

/** ¿Este checklist cae dentro de lo que la persona puede ver? */
export function entregaVisible(ambito: AmbitoVisible, checklist: any): boolean {
  if (!ambito.restringido || !ambito.lugares) return true;
  return ambito.lugares.has(String(checklist?.store || '').trim());
}

/**
 * ¿Este puesto le REPORTA a la persona?
 *
 * `false` no quiere decir «escóndelo»: quiere decir «marca esto como servicio a
 * otra unidad y no se lo cuentes» (§5, atribución transversal). En Padre
 * Hidalgo 15 de 38 personas son de Ventas; la Encargada tiene que verlas
 * —trabajan en su tienda— sin que sus puntos caigan en su número.
 */
export function puestoPropio(ambito: AmbitoVisible, puestoId: string): boolean {
  if (!ambito.restringido || !ambito.puestosPropios) return true;
  return ambito.puestosPropios.has(puestoId);
}
