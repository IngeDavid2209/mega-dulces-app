/**
 * 🧪 PRUEBAS DEL TABLERO DE DIRECCIÓN
 *
 * Estas reglas producen los números que Dirección lee y sobre los que se habla
 * con Gerentes, así que entran en la regla del §8.8.
 *
 * Lo que se prueba son las PROPIEDADES que hoy fallaban, no que las funciones
 * existan:
 *   · un día sin muestra es un HUECO, no un cero
 *   · «no verificado» NO suma con las otras cuatro causas
 *   · ninguna unidad se asciende de puesto para que el tablero cuadre
 *   · la escala se ajusta al máximo real, no a 100
 */
import { medir, valorDe, esMedido } from './indicador.util';
import {
  CAUSAS, UNIDADES_TABLERO, ANCLAS_HOY, SILENCIO,
  MINIMO_PUNTOS_PARA_DIBUJAR, OPERACION_COMPROBADA, FIDELIDAD_REGISTRO,
} from './tablero-direccion.util';

describe('tablero de Dirección · siete días con huecos', () => {

  /** Una semana como la real: cuatro días de dos o tres tareas, tres con carga. */
  const semana = [
    { etiqueta: 'mar', cumplidos: 0, emitidos: 2 },
    { etiqueta: 'mié', cumplidos: 1, emitidos: 3 },
    { etiqueta: 'jue', cumplidos: 0, emitidos: 1 },
    { etiqueta: 'vie', cumplidos: 2, emitidos: 4 },
    { etiqueta: 'sáb', cumplidos: 6, emitidos: 120 },
    { etiqueta: 'dom', cumplidos: 9, emitidos: 110 },
    { etiqueta: 'lun', cumplidos: 20, emitidos: 1996 },
  ];

  it('4 días sin muestra producen 4 huecos y 3 valores', () => {
    const dias = semana.map(d => medir(d.cumplidos, d.emitidos, MINIMO_PUNTOS_PARA_DIBUJAR));
    const huecos = dias.filter(d => !esMedido(d)).length;
    const valores = dias.filter(d => esMedido(d)).length;
    expect(huecos).toBe(4);
    expect(valores).toBe(3);
    expect(huecos + valores).toBe(7);
  });

  it('un día sin muestra NO devuelve 0: devuelve null', () => {
    const d = medir(0, 2, MINIMO_PUNTOS_PARA_DIBUJAR);
    expect(d.estado).toBe('sin_muestra');
    expect(valorDe(d)).toBeNull();
    expect(valorDe(d)).not.toBe(0);
  });

  // ── CONTROL NEGATIVO, y es el que más importa ─────────────────────────
  // Un día CON muestra y 0 % cumplido tiene que dar una barra de cero VISIBLE,
  // no un hueco. Si esto fallara, la regla estaría tapando fracasos reales
  // detrás de un rayado, que es el error contrario.
  it('CONTROL NEGATIVO · día con muestra y 0 % → cero visible, no hueco', () => {
    const d = medir(0, 300, MINIMO_PUNTOS_PARA_DIBUJAR);
    expect(d.estado).toBe('medido');
    expect(esMedido(d)).toBe(true);
    expect(valorDe(d)).toBe(0);
  });

  it('el mínimo es un parámetro con nombre, no un literal suelto', () => {
    expect(MINIMO_PUNTOS_PARA_DIBUJAR).toBeGreaterThan(1);
    // Y discrimina: justo por debajo es hueco, justo en el mínimo es valor.
    expect(esMedido(medir(0, MINIMO_PUNTOS_PARA_DIBUJAR - 1, MINIMO_PUNTOS_PARA_DIBUJAR))).toBe(false);
    expect(esMedido(medir(0, MINIMO_PUNTOS_PARA_DIBUJAR, MINIMO_PUNTOS_PARA_DIBUJAR))).toBe(true);
  });

  it('la escala se ajusta al máximo real y nunca es 0', () => {
    const dias = semana.map(d => medir(d.cumplidos, d.emitidos, MINIMO_PUNTOS_PARA_DIBUJAR));
    const vals = dias.map(valorDe).filter((v): v is number => v !== null);
    const escala = Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10);
    expect(escala).toBeGreaterThanOrEqual(10);
    // Con máximos de 5 y 8 %, la escala es 10 y no 100: sobre 100 una barra de
    // 5 % mide cinco píxeles y equivale a no dibujarla.
    expect(escala).toBeLessThan(100);
  });
});

describe('tablero de Dirección · las cinco causas', () => {

  it('son cinco, y solo UNA es capa aparte', () => {
    expect(CAUSAS.length).toBe(5);
    const capas = CAUSAS.filter(c => c.esCapa);
    expect(capas.length).toBe(1);
    expect(capas[0].clave).toBe('no_verificado');
  });

  it('«no verificado» NO suma con las demás: es una capa sobre el total', () => {
    // La propiedad: si alguien sumara las cinco y le cuadrara con el total de
    // puntos sin cumplir, la tabla estaría mal. `esCapa` es lo que impide que
    // se sume, y esta prueba vigila que siga marcada.
    const porciones = CAUSAS.filter(c => !c.esCapa);
    expect(porciones.length).toBe(4);
    expect(porciones.some(c => c.clave === 'no_verificado')).toBe(false);
  });

  it('cada causa tiene dueño y lectura; ninguna queda sin dueño salvo la ausente', () => {
    for (const c of CAUSAS) {
      expect(c.nombre.length).toBeGreaterThan(0);
      expect(c.lectura.length).toBeGreaterThan(0);
      if (c.confianza !== 'ausente') {
        expect(c.deQuien).not.toBe('—');
      }
    }
  });

  it('las causas no calculables traen el porqué', () => {
    for (const c of CAUSAS) {
      if (c.confianza === 'estimado' || c.confianza === 'ausente') {
        expect(c.porque && c.porque.length > 10).toBe(true);
      }
    }
  });
});

describe('tablero de Dirección · el eje de unidad', () => {

  it('son diez tarjetas y cada una declara su fuente', () => {
    expect(UNIDADES_TABLERO.length).toBe(10);
    for (const u of UNIDADES_TABLERO) {
      expect(['zona', 'unidad-organigrama', 'puesto']).toContain(u.fuente);
      expect(u.clave.length).toBeGreaterThan(0);
      expect(u.nota.length).toBeGreaterThan(0);
    }
  });

  it('ninguna clave se repite: nada se cuenta dos veces', () => {
    const claves = UNIDADES_TABLERO.map(u => u.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('Mantenimiento va rotulado como PUESTO, no ascendido a unidad', () => {
    const m = UNIDADES_TABLERO.find(u => u.nombre === 'Mantenimiento');
    expect(m).toBeDefined();
    // Es `jefe-mantenimiento`, de la unidad administrativa. Ascenderlo a unidad
    // para que el tablero se vea completo sería inventar estructura (§8.5).
    expect(m!.fuente).toBe('puesto');
    expect(m!.clave).toBe('jefe-mantenimiento');
    expect(m!.etiqueta).toBe('unidad servida');
  });

  it('son cinco zonas, no tres', () => {
    const zonas = UNIDADES_TABLERO.filter(u => u.fuente === 'zona');
    expect(zonas.length).toBe(5);
  });
});

describe('tablero de Dirección · los dos números y las anclas', () => {

  it('los dos números salen sin_dato con motivo y fase', () => {
    for (const i of [OPERACION_COMPROBADA, FIDELIDAD_REGISTRO]) {
      expect(i.estado).toBe('sin_dato');
      expect(valorDe(i)).toBeNull();
    }
  });

  it('de las cinco anclas, hoy hay tres y faltan dos nombradas', () => {
    expect(ANCLAS_HOY.length).toBe(5);
    expect(ANCLAS_HOY.filter(a => a.tiene).length).toBe(3);
    const faltan = ANCLAS_HOY.filter(a => !a.tiene).map(a => a.nombre);
    expect(faltan).toContain('lugar');
    expect(faltan).toContain('inmutabilidad');
  });

  it('el silencio va con su fecha y su fuente, no como cifra de hoy', () => {
    expect(SILENCIO.medidoEl.length).toBeGreaterThan(0);
    expect(SILENCIO.fuente).toContain('050');
    // Y su denominador es explícito: 60 de 97 fichas CON PUESTO.
    expect(SILENCIO.fichasConPuesto).toBeGreaterThan(SILENCIO.fichasEnSilencio);
    expect(SILENCIO.porcentaje).toBe(62);
  });
});
