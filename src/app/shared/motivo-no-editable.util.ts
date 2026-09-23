/**
 * 🚫 POR QUÉ NO PUEDO SUBIR MI EVIDENCIA — el callejón sin salida, explicado
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL REPORTE QUE LO ORIGINA (David, 20/sep/2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * «A christian.moreno no lo deja adjuntar fotos: el botón no hace nada.»
 *
 * Medido: el botón **no existe**. Cuelga de `puedoEditarItem()`, que es
 * `!checklist.enviado && esElDueno()`, y `esElDueno()` compara por uid o por
 * nombre tolerante. Si ninguna de las dos casa, el `*ngIf` no pinta el control
 * — y con él se van también el comentario y los renglones: en esa tarea **no
 * funciona nada**, no solo la foto.
 *
 * ─── ESTO NO ABRE NINGÚN PERMISO, Y ES LO PRIMERO QUE HAY QUE DECIR ───────
 * La regla de quién puede subir evidencia NO cambia. Aflojarla sería dejar que
 * alguien firme el trabajo de otro, que es `verificado_falso` (§4) fabricado
 * por el software. Lo único que cambia es que el callejón sin salida **se
 * nombra**: un botón que desaparece sin explicación se reporta como «la app no
 * sirve» y se va a buscar un defecto donde no lo hay.
 *
 * ─── LAS TRES CAUSAS, Y POR QUÉ SE DISTINGUEN ─────────────────────────────
 *   `enviada`      ya se envió: se corrige reabriéndola, y eso es de jefatura.
 *   `de_otro`      es de otra persona. Correcto: no hay nada que arreglar.
 *   `nombre_no_casa`  PARECE la misma persona y los nombres no coinciden. Es
 *                  el hallazgo 1 —la identidad se cruza por texto— mordiendo a
 *                  alguien concreto, y el arreglo es su FICHA, no el código.
 *
 * Esa tercera es la que vale. Sin ella, `de_otro` y `nombre_no_casa` se ven
 * idénticos desde fuera, y son problemas opuestos: uno no se toca y el otro
 * deja a una persona sin poder trabajar. El marcador de correcciones de
 * identidad del CLAUDE.md lleva seis casos por esta misma causa —«Yaadira»,
 * «MEDIAN», apellidos invertidos— y todos se encontraron a mano.
 */

import { mismoEmpleadoNombre, pareceLaMismaPersona } from './permisos.util';

export type CausaNoEditable = 'enviada' | 'de_otro' | 'nombre_no_casa';

export interface MotivoNoEditable {
  causa: CausaNoEditable;
  /** Lo que se le dice a quien está mirando. */
  texto: string;
  /** El nombre al que está asignada, para poder nombrarlo en pantalla. */
  asignadaA: string;
}

/** ¿Es esta persona la dueña del checklist? Espejo de `esElDueno()`. */
function esDuenoDe(usuario: any, c: any): boolean {
  const miUid = usuario?.uid || usuario?.id;
  if (miUid && c?.assignedUid && c.assignedUid === miUid) return true;
  return mismoEmpleadoNombre(usuario?.nombre, c?.assigned);
}

/**
 * `null` si SÍ puede editar. Si no, por qué.
 *
 * El orden importa: «ya se envió» se comprueba antes que la propiedad porque
 * es lo que le pasa a la persona MÁS a menudo —termina su turno y vuelve a
 * mirar—, y decirle «es de otro» sobre su propia tarea enviada sería mentirle.
 */
export function motivoNoEditable(usuario: any, c: any): MotivoNoEditable | null {
  if (!c) return null;
  const asignadaA = String(c.assigned || '').trim();

  if (c.enviado) {
    return {
      causa: 'enviada', asignadaA,
      texto: 'Esta tarea ya se envió, así que no se puede cambiar. ' +
             'Si algo quedó mal, pídele a tu jefatura que la reabra.',
    };
  }

  if (esDuenoDe(usuario, c)) return null;

  // ⚠ AQUÍ ESTÁ EL CASO QUE HAY QUE CAZAR. `pareceLaMismaPersona` es más
  // tolerante que `mismoEmpleadoNombre` —acepta un nombre de UNA sola palabra
  // si coincide con el primero— así que «parece la misma y no casa» es
  // exactamente la firma de un nombre mal capturado.
  //
  // NO se usa para dejarlo pasar: se usa para DECIRLO. Si se usara para
  // conceder, «María» abriría las tareas de cualquier María de la empresa.
  const miNombre = String(usuario?.nombre || '').trim();
  if (asignadaA && pareceLaMismaPersona(miNombre, asignadaA)) {
    return {
      causa: 'nombre_no_casa', asignadaA,
      texto: 'Esta tarea está a nombre de «' + asignadaA + '» y tu perfil dice «' +
             miNombre + '». Si eres tú, pide que corrijan tu nombre en Usuarios: ' +
             'mientras no coincidan, la app no te deja subir tu evidencia.',
    };
  }

  return {
    causa: 'de_otro', asignadaA,
    texto: asignadaA
      ? 'Esta tarea está asignada a ' + asignadaA + '. Solo esa persona puede ' +
        'subir su evidencia; tú la ves porque supervisas su trabajo.'
      : 'Esta tarea no tiene a nadie asignado, así que nadie puede subir ' +
        'evidencia. Hay que asignarla primero.',
  };
}
