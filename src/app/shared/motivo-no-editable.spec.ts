/**
 * 🚫 POR QUÉ NO PUEDO SUBIR MI EVIDENCIA
 *
 * Fija el caso que reportó David el 20/sep («a christian.moreno no lo deja
 * adjuntar fotos, el botón no hace nada») y, sobre todo, la distinción que
 * hace útil el mensaje: «es de otro» y «tu nombre no casa» se ven idénticos
 * desde fuera y son problemas opuestos.
 */

import { motivoNoEditable } from './motivo-no-editable.util';

describe('por qué no puedo subir evidencia', () => {

  const YO = { uid: 'u1', nombre: 'Christian Moreno Vega' };

  const tarea = (extra: any = {}) => ({
    assigned: 'Christian Moreno Vega', assignedUid: 'u1', enviado: false, ...extra,
  });

  // ═══ 1 · CUANDO SÍ PUEDE, NO DICE NADA ══════════════════════════════════

  it('su propia tarea, sin enviar: no hay motivo', () => {
    expect(motivoNoEditable(YO, tarea())).toBeNull();
  });

  it('reconoce por uid aunque el nombre esté escrito distinto', () => {
    // Es la razón de ser de `assignedUid`: inmune a la ortografía.
    expect(motivoNoEditable(YO, tarea({ assigned: 'Cristian Moreno' }))).toBeNull();
  });

  it('reconoce por nombre tolerante cuando no hay uid', () => {
    const c = tarea({ assignedUid: null, assigned: 'Christian Moreno' });
    expect(motivoNoEditable(YO, c)).toBeNull();
  });

  // ═══ 2 · YA ENVIADA — y va PRIMERO a propósito ══════════════════════════

  it('su propia tarea ya enviada: dice que se reabre, no que es de otro', () => {
    const m = motivoNoEditable(YO, tarea({ enviado: true }));
    expect(m?.causa).toBe('enviada');
    // Decirle «es de otro» sobre su propia tarea enviada seria mentirle, y es
    // lo que pasaria si la propiedad se comprobara antes.
    expect(m?.texto).toContain('reabra');
  });

  it('una tarea ajena YA ENVIADA tambien dice «enviada»', () => {
    const c = tarea({ assignedUid: 'otro', assigned: 'Otra Persona', enviado: true });
    expect(motivoNoEditable(YO, c)?.causa).toBe('enviada');
  });

  // ═══ 3 · DE OTRA PERSONA — correcto, no hay nada que arreglar ═══════════

  it('la tarea de un compañero: lo dice y lo justifica', () => {
    const c = tarea({ assignedUid: 'u9', assigned: 'Rosa Jimenez Luna' });
    const m = motivoNoEditable(YO, c);
    expect(m?.causa).toBe('de_otro');
    expect(m?.texto).toContain('Rosa Jimenez Luna');
  });

  it('una tarea SIN asignar lo dice aparte: no es de nadie', () => {
    const c = tarea({ assignedUid: null, assigned: '' });
    const m = motivoNoEditable(YO, c);
    expect(m?.causa).toBe('de_otro');
    expect(m?.texto).toContain('no tiene a nadie asignado');
  });

  // ═══ 4 · EL CASO QUE VALE: PARECE ÉL Y NO CASA ══════════════════════════

  it('nombre de UNA palabra: `mismoEmpleadoNombre` no casa y esto lo explica', () => {
    // `mismoEmpleadoNombre` exige 2 palabras en comun, asi que «Christian» a
    // secas no casa nunca — y sin este mensaje el boton desaparece sin decir
    // por que. Es la firma exacta de un nombre mal capturado.
    const c = tarea({ assignedUid: null, assigned: 'Christian' });
    const m = motivoNoEditable(YO, c);
    expect(m?.causa).toBe('nombre_no_casa');
    expect(m?.texto).toContain('Usuarios');
  });

  it('el mensaje nombra LOS DOS nombres, que es lo que permite corregir la ficha', () => {
    const c = tarea({ assignedUid: null, assigned: 'Christian' });
    const m = motivoNoEditable(YO, c);
    expect(m?.texto).toContain('«Christian»');
    expect(m?.texto).toContain('«Christian Moreno Vega»');
  });

  it('NO confunde a dos personas distintas con «nombre_no_casa»', () => {
    // El control negativo del mensaje: si `pareceLaMismaPersona` fuera
    // demasiado laxa, a un compañero se le dirian que corrija su ficha.
    const c = tarea({ assignedUid: null, assigned: 'Rosa Jimenez Luna' });
    expect(motivoNoEditable(YO, c)?.causa).toBe('de_otro');
  });

  // ═══ 5 · LO QUE ESTO NO HACE ════════════════════════════════════════════

  it('NUNCA concede: «parece la misma persona» sigue sin poder editar', () => {
    // La tolerancia se usa para EXPLICAR, no para dejar pasar. Si se usara
    // para conceder, «Maria» abriria las tareas de cualquier Maria.
    const c = tarea({ assignedUid: null, assigned: 'Christian' });
    expect(motivoNoEditable(YO, c)).not.toBeNull();
  });

  it('sin checklist no inventa un motivo', () => {
    expect(motivoNoEditable(YO, null)).toBeNull();
    expect(motivoNoEditable(YO, undefined)).toBeNull();
  });

  // ═══ 6 · LA GUARDIA ═════════════════════════════════════════════════════

  it('la muestra DISCRIMINA: salen las tres causas y el caso sin motivo', () => {
    const causas = [
      motivoNoEditable(YO, tarea()),
      motivoNoEditable(YO, tarea({ enviado: true })),
      motivoNoEditable(YO, tarea({ assignedUid: 'u9', assigned: 'Rosa Jimenez Luna' })),
      motivoNoEditable(YO, tarea({ assignedUid: null, assigned: 'Christian' })),
    ].map(m => m?.causa ?? 'puede');
    expect(new Set(causas).size).toBe(4);
  });
});
