/**
 * 🧩 «QUE NINGUNA TAREA SE REPITA» — la regla que lo hace cierto
 *
 * §8.8: esta regla produce un número de una persona. Lo que aquí se acepte se
 * convierte en puntos que alguien tiene que cumplir todos los días, y en el
 * denominador contra el que se le mide. Un duplicado que pase de aquí NO SE VE
 * en ninguna pantalla: solo sube el denominador de esa persona, así que su
 * cumplimiento baja sin que nada parezca roto. Es la clase de daño que nadie
 * reporta.
 *
 * ─── DE DÓNDE SALEN LOS CASOS ─────────────────────────────────────────────
 * Instrucción de David (14/sep/2026): «revisa estrictamente que ninguna tarea
 * se repita». Medido ese día sobre el catálogo en código, que está LIMPIO en
 * las seis clases (0 ids duplicados, 0 puntos repetidos dentro de una tarea, 0
 * puntos repetidos entre tareas diarias del mismo puesto, 0 nombres repetidos).
 * Estas pruebas defienden que la captura a mano no introduzca lo que el
 * catálogo no tiene.
 *
 * ─── LOS VALORES DE MANUAL NO SE ESCRIBEN A OJO ───────────────────────────
 * El nombre de la tarea publicada contra la que se prueba la colisión se DERIVA
 * de `tareasDePuesto('anaquelista')` en tiempo de prueba, no se teclea. Si se
 * tecleara, el día que el manual se versione la prueba pasaría a comprobar una
 * cadena que ya no existe y el choque real dejaría de ejercerse — el corolario
 * (e) del §8.11, un control anclado a un dato que cambia. Hay una guardia que
 * aborta si ese puesto se quedara sin tareas.
 */
import {
  aTareaManual, declaradasDePuesto, tareasCombinadasDePuesto,
  nuevoIdTareaPuesto, revisarTareaPuesto, puedeGuardarse,
  PREFIJO_TAREA_PUESTO, TareaDePuesto, BorradorTarea,
} from './tareas-puesto.util';
import { tareasDePuesto } from './tareas-manual.catalogo';

const PUESTO_CON_MANUAL = 'anaquelista';
const PUESTO_SIN_MANUAL = 'vendedor-rd';   // 11 personas, medido el 14/sep

function tarea(p: Partial<TareaDePuesto> = {}): TareaDePuesto {
  return {
    id: 'tp-x-1', puestoId: PUESTO_SIN_MANUAL, nombre: 'Ruta del día',
    momento: 'operacion', frecuencia: 'Diaria', horaLimite: '19:00',
    version: '1.0', vigente: true, items: [{ texto: 'Punto A' }],
    ...p,
  };
}

function borrador(p: Partial<BorradorTarea> = {}): BorradorTarea {
  return {
    puestoId: PUESTO_SIN_MANUAL, nombre: 'Ruta del día', momento: 'operacion',
    frecuencia: 'Diaria', horaLimite: '19:00', version: '1.0',
    items: [{ texto: 'Punto A' }],
    ...p,
  };
}

describe('tareas-puesto: la norma como dato', () => {

  // ── La premisa de la que cuelgan los casos de colisión ──────────────────
  it('GUARDIA: el puesto de referencia sigue teniendo manual publicado', () => {
    const publicadas = tareasDePuesto(PUESTO_CON_MANUAL);
    expect(publicadas.length)
      .toBeGreaterThan(0, `«${PUESTO_CON_MANUAL}» se quedó sin tareas publicadas: ` +
        'los casos de choque contra el manual dejaron de ejercerse y sus verdes no valen');
    expect(tareasDePuesto(PUESTO_SIN_MANUAL).length)
      .toBe(0, `«${PUESTO_SIN_MANUAL}» ganó manual: ya no sirve como puesto sin documento`);
  });

  describe('conversión y fusión', () => {
    it('aTareaManual conserva lo que el emisor necesita', () => {
      const t = aTareaManual(tarea({ id: 'tp-a', nombre: 'X', items: [{ texto: 'p1' }, { texto: 'p2' }] }));
      expect(t.id).toBe('tp-a');
      expect(t.nombre).toBe('X');
      expect(t.frecuencia).toBe('Diaria');
      expect(t.items.length).toBe(2);
    });

    it('omite diaSemana y diaMes cuando no aplican, en vez de mandarlos nulos', () => {
      const t = aTareaManual(tarea({ diaSemana: null, diaMes: null }));
      expect('diaSemana' in t).toBe(false);
      expect('diaMes' in t).toBe(false);
    });

    it('una tarea retirada NO se entrega', () => {
      const todas = [tarea({ id: 'tp-viva' }), tarea({ id: 'tp-muerta', vigente: false })];
      const vivas = declaradasDePuesto(PUESTO_SIN_MANUAL, todas);
      expect(vivas.length).toBe(1);
      expect(vivas[0].id).toBe('tp-viva');
    });

    it('no mezcla las tareas de otro puesto', () => {
      const todas = [tarea({ id: 'tp-1' }), tarea({ id: 'tp-2', puestoId: 'promotora' })];
      expect(declaradasDePuesto(PUESTO_SIN_MANUAL, todas).length).toBe(1);
      expect(declaradasDePuesto('promotora', todas).length).toBe(1);
    });

    it('un puesto CON manual suma las publicadas y las capturadas', () => {
      const publicadas = tareasDePuesto(PUESTO_CON_MANUAL).length;
      const todas = [tarea({ id: 'tp-extra', puestoId: PUESTO_CON_MANUAL, nombre: 'Extra' })];
      expect(tareasCombinadasDePuesto(PUESTO_CON_MANUAL, todas).length).toBe(publicadas + 1);
    });

    it('un puesto SIN manual queda con exactamente lo capturado', () => {
      const todas = [tarea({ id: 'tp-1' }), tarea({ id: 'tp-2', nombre: 'Otra' })];
      expect(tareasCombinadasDePuesto(PUESTO_SIN_MANUAL, todas).length).toBe(2);
    });
  });

  describe('el id no puede colisionar', () => {
    it('lleva el prefijo que la tabla exige', () => {
      expect(nuevoIdTareaPuesto('vendedor-rd', 'Ruta', [])).toContain(PREFIJO_TAREA_PUESTO);
      expect(nuevoIdTareaPuesto('vendedor-rd', 'Ruta', []).startsWith(PREFIJO_TAREA_PUESTO)).toBe(true);
    });

    it('DOS CAPTURAS EN EL MISMO MILISEGUNDO NO PRODUCEN EL MISMO ID', () => {
      // El caso que rompió `idDeclarado` el 13/sep. Sin esto, los checklists de
      // una tarea acabarían apuntando a la otra (§5.5).
      const t = 1_757_000_000_000;
      const a = nuevoIdTareaPuesto('vendedor-rd', 'Ruta', [], t);
      const b = nuevoIdTareaPuesto('vendedor-rd', 'Ruta', [a], t);
      expect(b).not.toBe(a);
    });

    it('nunca reutiliza un id ya usado, aunque su tarea esté retirada', () => {
      const t = 1_757_000_000_000;
      const usados = ['tp-vendedor-rd-ruta-' + t.toString(36)];
      expect(usados).not.toContain(nuevoIdTareaPuesto('vendedor-rd', 'Ruta', usados, t));
    });

    it('un nombre con tildes o símbolos no rompe el id', () => {
      const id = nuevoIdTareaPuesto('vendedor-rd', '¡Revisión "diaria" del camión!', []);
      expect(id).toMatch(/^tp-[a-z0-9-]+$/);
    });
  });

  describe('LAS SEIS COMPROBACIONES', () => {
    it('un borrador correcto no produce un solo aviso', () => {
      const avisos = revisarTareaPuesto(borrador(), []);
      expect(avisos.length).toBe(0);
      expect(puedeGuardarse(avisos)).toBe(true);
    });

    it('1 · sin nombre: bloquea', () => {
      const a = revisarTareaPuesto(borrador({ nombre: '   ' }), []);
      expect(puedeGuardarse(a)).toBe(false);
      expect(a.some(x => x.campo === 'nombre')).toBe(true);
    });

    it('1 · CHOCA CON UNA TAREA DEL MANUAL PUBLICADO: bloquea', () => {
      // Derivado del catálogo, no tecleado. Ver cabecera.
      const publicada = tareasDePuesto(PUESTO_CON_MANUAL)[0];
      const a = revisarTareaPuesto(
        borrador({ puestoId: PUESTO_CON_MANUAL, nombre: publicada.nombre }), []);
      expect(puedeGuardarse(a)).toBe(false);
      expect(a.find(x => x.nivel === 'bloquea')!.texto).toContain('manual publicado');
    });

    it('1 · EL DUPLICADO NO LLEGA ESCRITO IGUAL: «Apertura» choca con «apertura  »', () => {
      // El hallazgo 1 (identidad por texto) entrando por esta puerta. Si la
      // comparación fuera literal, éste pasaría y la tabla lo rechazaría con un
      // error ilegible al guardar.
      const previa = tarea({ id: 'tp-prev', nombre: 'Apertura' });
      const a = revisarTareaPuesto(borrador({ nombre: '  apertura ' }), [previa]);
      expect(puedeGuardarse(a)).toBe(false);
    });

    it('1 · una tarea RETIRADA no bloquea el nombre (o versionar sería imposible)', () => {
      const previa = tarea({ id: 'tp-prev', nombre: 'Apertura', vigente: false });
      expect(puedeGuardarse(revisarTareaPuesto(borrador({ nombre: 'Apertura' }), [previa]))).toBe(true);
    });

    it('1 · al publicar una versión nueva, la tarea no choca CONSIGO MISMA', () => {
      const previa = tarea({ id: 'tp-prev', nombre: 'Apertura' });
      const a = revisarTareaPuesto(borrador({ nombre: 'Apertura' }), [previa], 'tp-prev');
      expect(puedeGuardarse(a)).toBe(true);
    });

    it('2 · sin puntos de control: bloquea', () => {
      const a = revisarTareaPuesto(borrador({ items: [{ texto: '  ' }] }), []);
      expect(puedeGuardarse(a)).toBe(false);
      expect(a.some(x => x.campo === 'items')).toBe(true);
    });

    it('3 · EL MISMO PUNTO DOS VECES EN LA MISMA TAREA: bloquea', () => {
      const a = revisarTareaPuesto(borrador({
        items: [{ texto: 'Caja limpia' }, { texto: 'Piso barrido' }, { texto: 'caja  LIMPIA' }],
      }), []);
      expect(puedeGuardarse(a)).toBe(false);
      expect(a.some(x => x.texto.includes('dos veces en esta misma tarea'))).toBe(true);
    });

    it('4 · un punto que ya está en OTRA tarea del puesto: AVISA, no bloquea', () => {
      // «Caja limpia» en apertura y en cierre es legítimo: se verifica dos veces
      // al día. Bloquearlo obligaría a deformar el texto para esquivarlo.
      const previa = tarea({ id: 'tp-prev', nombre: 'Apertura', items: [{ texto: 'Caja limpia' }] });
      const a = revisarTareaPuesto(borrador({ nombre: 'Cierre', items: [{ texto: 'Caja limpia' }] }), [previa]);
      expect(a.length).toBe(1);
      expect(a[0].nivel).toBe('avisa');
      expect(a[0].texto).toContain('Apertura');
      expect(puedeGuardarse(a)).toBe(true);
    });

    it('4 · el aviso también mira el manual publicado', () => {
      const publicada = tareasDePuesto(PUESTO_CON_MANUAL)[0];
      const a = revisarTareaPuesto(borrador({
        puestoId: PUESTO_CON_MANUAL, nombre: 'Tarea nueva sin choque de nombre',
        items: [{ texto: publicada.items[0].texto }],
      }), []);
      expect(a.some(x => x.nivel === 'avisa' && x.campo === 'items')).toBe(true);
      expect(puedeGuardarse(a)).toBe(true);
    });

    it('5 · SEMANAL SIN DÍA: bloquea — no se entregaría ningún día', () => {
      const a = revisarTareaPuesto(borrador({ frecuencia: 'Semanal' }), []);
      expect(puedeGuardarse(a)).toBe(false);
      expect(a.some(x => x.campo === 'frecuencia')).toBe(true);
    });

    it('5 · semanal CON día: pasa', () => {
      expect(puedeGuardarse(revisarTareaPuesto(
        borrador({ frecuencia: 'Semanal', diaSemana: 'Viernes' }), []))).toBe(true);
    });

    it('5 · MENSUAL SIN DÍA DEL MES: bloquea', () => {
      expect(puedeGuardarse(revisarTareaPuesto(borrador({ frecuencia: 'Mensual' }), []))).toBe(false);
    });

    it('5 · mensual con día fuera de rango: bloquea', () => {
      expect(puedeGuardarse(revisarTareaPuesto(
        borrador({ frecuencia: 'Mensual', diaMes: 41 }), []))).toBe(false);
      expect(puedeGuardarse(revisarTareaPuesto(
        borrador({ frecuencia: 'Mensual', diaMes: 25 }), []))).toBe(true);
    });

    it('6 · hora límite ilegible: bloquea', () => {
      expect(puedeGuardarse(revisarTareaPuesto(borrador({ horaLimite: '7pm' }), []))).toBe(false);
      expect(puedeGuardarse(revisarTareaPuesto(borrador({ horaLimite: '19:00' }), []))).toBe(true);
    });

    it('6 · SIN VERSIÓN: bloquea — sin ella no hay hoja de auditoría (§5.4)', () => {
      expect(puedeGuardarse(revisarTareaPuesto(borrador({ version: '' }), []))).toBe(false);
    });
  });

  // ── La guardia del 31/ago: una muestra que no discrimina no discrimina ──
  it('GUARDIA: la muestra produce las tres respuestas, no siempre la misma', () => {
    const previa = tarea({ id: 'tp-prev', nombre: 'Apertura', items: [{ texto: 'Caja limpia' }] });
    const limpio = revisarTareaPuesto(borrador(), []);
    const avisa  = revisarTareaPuesto(borrador({ nombre: 'Cierre', items: [{ texto: 'Caja limpia' }] }), [previa]);
    const bloquea = revisarTareaPuesto(borrador({ nombre: 'Apertura' }), [previa]);

    expect(limpio.length).toBe(0, 'ningún caso sale limpio: la revisión rechaza todo');
    expect(avisa.some(a => a.nivel === 'avisa')).toBe(true, 'ningún caso avisa sin bloquear');
    expect(bloquea.some(a => a.nivel === 'bloquea')).toBe(true, 'ningún caso bloquea');
    expect(puedeGuardarse(avisa)).not.toBe(puedeGuardarse(bloquea),
      'avisar y bloquear producen el mismo resultado: la distinción no existe');
  });
});
