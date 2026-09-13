/**
 * 🔑 EL CÓDIGO CON EL QUE SE ENTRA A UNA PLAZA
 *
 * «PH-ANA-1» = Padre Hidalgo · Anaquelista · 1.
 *
 * Instrucción de David (13/sep/2026): se acaban los usuarios por persona. Solo
 * queda su cuenta de administrador; todos los demás entran por la plaza que
 * ocupan, y quién es esa persona ese día sale del pase de lista.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ESTO NO ES UNA CONCATENACIÓN DE TRES LETRAS
 * ═══════════════════════════════════════════════════════════════════════════
 * Porque los prefijos CHOCAN, y en este proyecto un choque de identidad no es
 * un detalle estético: es el hallazgo 1. Dos casos reales del catálogo:
 *
 *   surtidor-ventas  →  SUR      ⎫  el mismo código para dos puestos
 *   surtidor-sucursal →  SUR     ⎭  distintos, en la misma sucursal
 *
 *   Morelia Abastos  →  MA       ⎫  aquí NO chocan, pero basta abrir una
 *   Morelia Madero   →  MM       ⎭  «Morelia Centro» para que MC choque con otra
 *
 * Si dos plazas comparten código, dos personas entran a la misma cuenta y toda
 * la trazabilidad que se construyó hoy se cae. Así que el código se genera
 * contra el conjunto de los YA USADOS y se alarga hasta ser único.
 *
 * ─── Y ES DETERMINISTA A PROPÓSITO ────────────────────────────────────────
 * Generar la misma lista dos veces tiene que dar los mismos códigos. Si el
 * orden de entrada cambiara el resultado, regenerar las credenciales de una
 * sucursal le cambiaría el código a gente que ya lo tiene apuntado en una
 * libreta. Es el mismo motivo del `order by` del sembrador de plazas.
 */

/** Sin acentos, mayúsculas, solo letras y números. */
function limpiar(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim();
}

/**
 * Abreviatura de un lugar: iniciales si tiene varias palabras, las primeras
 * letras si es una sola. «Padre Hidalgo» → PH · «Canindo» → CAN.
 */
export function abreviarLugar(lugar: string, largo = 0): string {
  const l = limpiar(lugar);
  if (!l) return 'XX';
  const palabras = l.split(/\s+/).filter(Boolean);
  let base: string;
  if (palabras.length > 1) {
    base = palabras.map(p => p[0]).join('');
  } else {
    base = palabras[0].slice(0, 3);
  }
  // `largo` extra se toma de la primera palabra, que es la que más distingue.
  if (largo > 0) base += (palabras[0] || '').slice(base.length, base.length + largo);
  return base.slice(0, 6) || 'XX';
}

/**
 * Abreviatura de un puesto, a partir de su id del catálogo.
 * `anaquelista` → ANA · `cajero-sucursal` → CAJ · `surtidor-ventas` → SUR.
 */
export function abreviarPuesto(puestoId: string, largo = 0): string {
  const partes = String(puestoId || '').split('-').filter(Boolean);
  if (!partes.length) return 'XXX';
  let base = limpiar(partes[0]).replace(/\s/g, '').slice(0, 3);
  // Al desempatar se toma la inicial del SIGUIENTE token, no una letra más de
  // la primera palabra: `surtidor-ventas` y `surtidor-sucursal` comparten las
  // ocho primeras letras, así que alargar la primera palabra no los separaría
  // nunca. Lo que los distingue es justo lo que viene después del guion.
  for (let i = 0; i < largo; i++) {
    const sig = partes[1 + i];
    if (sig) base += limpiar(sig).replace(/\s/g, '').slice(0, 1);
    else base += 'X';
  }
  return base || 'XXX';
}

export interface PlazaParaCodigo {
  id: string;
  lugar: string;
  puestoId: string;
  numero: number | null;
}

/**
 * Genera los códigos de un conjunto de plazas, garantizando que no se repitan.
 *
 * `yaUsados` son los códigos que ya existen en la base: un código entregado NO
 * se reutiliza jamás, ni siquiera si su plaza se retiró. Si se reciclara, la
 * hoja impresa de alguien empezaría a abrir la plaza de otro.
 */
export function generarCodigos(
  plazas: PlazaParaCodigo[],
  yaUsados: Set<string> | string[] = [],
): Map<string, string> {
  const usados = new Set<string>(yaUsados instanceof Set ? yaUsados : yaUsados);
  const salida = new Map<string, string>();

  // Orden estable: mismo conjunto → mismos códigos, siempre.
  const orden = [...(plazas || [])].filter(p => p && p.lugar && p.puestoId)
    .sort((a, b) => {
      if (a.lugar !== b.lugar) return a.lugar.localeCompare(b.lugar);
      if (a.puestoId !== b.puestoId) return a.puestoId.localeCompare(b.puestoId);
      return (a.numero ?? 0) - (b.numero ?? 0);
    });

  for (const p of orden) {
    let codigo = '';
    // Se alarga primero el puesto y luego el lugar: dos puestos distintos en la
    // misma sucursal es el choque frecuente (los dos surtidores); dos sucursales
    // con las mismas iniciales es el raro.
    for (let intento = 0; intento < 8 && !codigo; intento++) {
      const extraPuesto = Math.min(intento, 2);
      const extraLugar = Math.max(0, intento - 2);
      const cand = [
        abreviarLugar(p.lugar, extraLugar),
        abreviarPuesto(p.puestoId, extraPuesto),
        String(p.numero ?? 1),
      ].join('-');
      if (!usados.has(cand)) codigo = cand;
    }
    // Último recurso: nunca devolver un duplicado en silencio.
    if (!codigo) codigo = `${abreviarLugar(p.lugar)}-${abreviarPuesto(p.puestoId, 2)}-${p.numero ?? 1}-${salida.size + 1}`;
    usados.add(codigo);
    salida.set(p.id, codigo);
  }

  return salida;
}

/**
 * ¿El código tiene la forma esperada? Se usa al teclearlo en el login, para
 * poder decir «ese código no existe» en vez de «usuario o contraseña
 * incorrectos», que manda a la persona a dudar de su PIN.
 */
export function pareceCodigoDePlaza(s: string): boolean {
  return /^[A-Z0-9]{2,6}-[A-Z0-9]{3,6}-\d{1,3}(-\d+)?$/.test(String(s || '').trim().toUpperCase());
}

/** Normaliza lo tecleado: mayúsculas, sin espacios. La gente escribe con espacios. */
export function normalizarCodigo(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}
