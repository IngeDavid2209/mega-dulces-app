/**
 * 🧪 LA PRIMERA PRUEBA DEL PROYECTO SOBRE UNA REGLA DE TABLERO
 *
 * Esta regla produce números que Dirección lee y sobre los que se habla con
 * personas, así que entra en la regla del §8.8: toda regla que produce un
 * número de alguien lleva prueba.
 *
 * Lo que se prueba NO es que la función devuelva algo, sino la propiedad que
 * hoy fallaba: que «no hay con qué medir» y «se midió y salió cero» no puedan
 * confundirse. Son dos frases distintas y el tablero decía la primera cuando
 * pasaba la segunda, y al revés.
 *
 * CONTROL NEGATIVO INCLUIDO, y es el que más pesa: un indicador 'medido' con
 * valor 0 TIENE que pintarse como 0. Si la prueba pasara con las dos ramas
 * devolviendo lo mismo, no probaría nada — solo confirmaría que la función
 * existe. Ya nos pasó con un control que daba verde por el camino equivocado.
 */
import {
  Indicador, medir, sinDato, valorDe, esMedido, leyendaDe,
  OPERACION_COMPROBADA, FIDELIDAD_DEL_REGISTRO,
} from './indicador.util';

describe('indicador.util · la regla del guion', () => {

  // ── POSITIVO: sin base no se publica cifra ─────────────────────────────
  it('un sin_dato NUNCA da un número, ni 0', () => {
    const i = sinDato('todavía no hay verificación', 'Fase 5');
    expect(valorDe(i)).toBeNull();
    expect(esMedido(i)).toBe(false);
    // Y explícitamente: que no sea 0, que es el bug que esto viene a matar.
    expect(valorDe(i)).not.toBe(0);
  });

  it('sin denominador devuelve sin_muestra, no 0%', () => {
    const i = medir(0, 0);
    expect(i.estado).toBe('sin_muestra');
    expect(valorDe(i)).toBeNull();
    expect(esMedido(i)).toBe(false);
  });

  // ── CONTROL NEGATIVO: cero medido SÍ se pinta ─────────────────────────
  // Si esto fallara, la regla habría tapado un fracaso real detrás de un guion,
  // que es el error contrario y no menos grave.
  it('CONTROL NEGATIVO · un cero MEDIDO sí se pinta como 0', () => {
    const i = medir(0, 244);
    expect(i.estado).toBe('medido');
    expect(valorDe(i)).toBe(0);
    expect(esMedido(i)).toBe(true);
    // Y se distingue del sin_dato: uno da 0, el otro da null.
    expect(valorDe(i)).not.toBeNull();
    expect(valorDe(sinDato('x', 'y'))).toBeNull();
  });

  it('un medido siempre trae su denominador', () => {
    const i = medir(28, 1996);
    if (i.estado !== 'medido') { fail('debía ser medido'); return; }
    expect(i.de).toBe(1996);
    expect(i.valor).toBe(1);
    // El tipo lo garantiza en compilación; esto vigila que `medir` lo llene.
    expect(typeof i.de).toBe('number');
  });

  // ── EL CASO DE LA BARRA: 0 cumplidas, 190 en curso, 35 vencidas ────────
  it('0 cumplidos + 190 en curso + 35 vencidas → 0% cumplido', () => {
    const total = 0 + 190 + 35;
    const i = medir(0, total);
    expect(i.estado).toBe('medido');
    expect(valorDe(i)).toBe(0);
    // La propiedad de la barra: el tramo lleno sale del CUMPLIDO, no de la
    // actividad. Con 0 cumplidos el tramo verde es 0 aunque haya 225 tareas.
    expect(valorDe(i)).toBe(0);
  });

  // ── La leyenda nunca queda muda ────────────────────────────────────────
  it('todo estado trae leyenda no vacía, y el sin_dato nombra su fase', () => {
    const casos: Indicador[] = [
      medir(3, 10),
      medir(0, 0),
      sinDato('no hay auditoría física', 'Fase 8'),
    ];
    for (const c of casos) {
      expect(leyendaDe(c).length).toBeGreaterThan(0);
    }
    expect(leyendaDe(sinDato('no hay auditoría física', 'Fase 8'))).toContain('Fase 8');
  });

  // ── Los dos números de Dirección ──────────────────────────────────────
  it('los dos indicadores de Dirección salen sin_dato con motivo y fase', () => {
    for (const i of [OPERACION_COMPROBADA, FIDELIDAD_DEL_REGISTRO]) {
      expect(i.estado).toBe('sin_dato');
      expect(valorDe(i)).toBeNull();
      if (i.estado !== 'sin_dato') { fail('debía ser sin_dato'); return; }
      expect(i.porque.length).toBeGreaterThan(10);
      expect(i.fase).toMatch(/Fase \d/);
    }
  });

  // ── GUARDIA DE LA PROPIA PRUEBA ───────────────────────────────────────
  // Si algún día `valorDe` devolviera lo mismo para las dos ramas, todos los
  // casos de arriba seguirían "pasando" salvo éste. Es el chequeo de que la
  // función DISCRIMINA, no de que existe.
  it('valorDe discrimina: medido y sin_dato NO devuelven lo mismo', () => {
    const a = valorDe(medir(0, 100));      // 0
    const b = valorDe(sinDato('x', 'y'));  // null
    expect(a).not.toBe(b);
  });
});
