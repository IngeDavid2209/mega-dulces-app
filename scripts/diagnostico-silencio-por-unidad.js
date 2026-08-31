// ============================================================================
//  PASO 0.4 · EL SILENCIO, PARTIDO POR UNIDAD
//
//  La 050 midió el dato: de 97 fichas activas CON puesto, 60 están en silencio
//  (33 nunca han entrado). Lo que falta es la interpretación, y sin partir esos
//  60 por unidad la interpretación es una media verdad.
//
//  ─── POR QUÉ IMPORTA LA PARTICIÓN ─────────────────────────────────────────
//  Son DOS problemas con respuestas opuestas:
//
//    · Plaza de SUCURSAL en silencio → es adopción. La gente está ahí, la
//      pantalla existe, y no la abren. Se resuelve hablando con su Gerente.
//
//    · Plaza de CEDIS, ventas, zona o administrativa en silencio → les emitimos
//      obligaciones sin haberles construido nada: no tienen ámbito, ni pantalla,
//      ni unidad en ningún tablero. «SISTEMAS al 3%» con 3 puestos en todo el
//      organigrama es eso, no desidia.
//
//  Confundirlas hace que alguien hable con una persona por un número que mide
//  emisiones al vacío.
//
//  ─── POR QUÉ ESTO ES UN SCRIPT Y NO UNA MIGRACIÓN ─────────────────────────
//  El cruce puesto→unidad NO SE PUEDE ESCRIBIR EN SQL: la unidad no está en la
//  base, vive en `src/app/shared/organigrama.catalogo.ts`. Es el hallazgo 5
//  estorbando justo en el primer diagnóstico que de verdad importa.
//
//  Y el catálogo se LEE, no se copia. Pegar los 89 pares en un `VALUES` sería
//  exactamente la lista local que el modelo prohíbe: al día siguiente el
//  organigrama cambia y esta lista miente sin avisar.
//
//  ─── LA GUARDIA ES DE COBERTURA, NO DE TOTALES ────────────────────────────
//  Verificar «parseé 89 puestos y 11 unidades» no sirve: 89 con uno malformado y
//  otro contado doble también da 89. La guardia que importa es que TODO
//  `puestoId` presente en la base exista en el catálogo parseado. Si falta uno,
//  aborta con la lista — porque ése es justo el que iba a quedar sin unidad y a
//  desaparecer del reporte en silencio.
//
//  Es la regla del cero falso afinada: verifica la entrada que de verdad usas,
//  no un proxy de ella.
//
//  ─── SE CORRE ASÍ (las credenciales las pone David, §8.7) ─────────────────
//    $env:DATABASE_URL="postgresql://..."   # la PÚBLICA de Railway
//    node scripts/diagnostico-silencio-por-unidad.js
//
//  ─── VIDA ÚTIL ────────────────────────────────────────────────────────────
//  El parseo del catálogo muere en la Fase 7, cuando el organigrama salga a la
//  base. No se construyó un JSON en el build a propósito: sería un puente hacia
//  algo que se va a demoler.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { query, dbConfigurada } = require('../api/db');

const RUTA_CATALOGO = path.join(__dirname, '..', 'src', 'app', 'shared', 'organigrama.catalogo.ts');
const DIAS_SILENCIO = 30;

function abortar(motivo, detalle) {
  console.error('');
  console.error('[silencio] ABORTA: ' + motivo);
  if (detalle) console.error(detalle);
  console.error('[silencio] No concluyas de esta corrida.');
  process.exit(2);
}

/**
 * Lee los pares puestoId → unidad del catálogo. Parseo, no copia.
 * Devuelve un Map y el conteo por unidad.
 */
function leerCatalogo() {
  if (!fs.existsSync(RUTA_CATALOGO)) abortar('no existe ' + RUTA_CATALOGO);
  const texto = fs.readFileSync(RUTA_CATALOGO, 'utf8');

  const pares = new Map();
  const re = /\{\s*id:\s*'([^']+)'[^}]*?unidad:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(texto)) !== null) pares.set(m[1], m[2]);

  if (pares.size === 0) {
    abortar('el parseo devolvió CERO puestos. El formato del catálogo cambió; ajusta la expresión antes de medir.');
  }
  return pares;
}

async function main() {
  if (!dbConfigurada()) {
    abortar('falta DATABASE_URL. Desde tu máquina usa la URL PÚBLICA de Railway (railway.internal no resuelve fuera).');
  }

  const catalogo = leerCatalogo();
  const porUnidad = new Map();
  for (const u of catalogo.values()) porUnidad.set(u, (porUnidad.get(u) || 0) + 1);

  console.log('[silencio] catálogo parseado → %d puestos en %d unidades', catalogo.size, porUnidad.size);
  for (const [u, n] of [...porUnidad.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('             %-22s %d', u, n);
  }

  // ── Las fichas activas con puesto ──────────────────────────────────────
  const r = await query(`
    select u.id, u.nombre,
           coalesce(u.datos->>'puestoId','') as puesto_id,
           coalesce(u.datos->>'sucursal', u.datos->'sucursales'->>0, '') as sucursal,
           case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                then (u.datos->>'ultimoLatido')::bigint else null end as latido_ms
      from mdtask_usuarios u
     where u.activo is not false
       and coalesce(u.datos->>'puestoId','') <> ''`);

  const fichas = r.rows;
  console.log('');
  console.log('[silencio] fichas activas CON puesto en la base → %d', fichas.length);
  if (fichas.length === 0) {
    abortar('cero fichas con puesto. La 050 contó 97, así que algo no cuadra: no se leyó nada.');
  }

  // ── LA GUARDIA DE COBERTURA ────────────────────────────────────────────
  // Todo puestoId de la base tiene que existir en el catálogo. Un solo huérfano
  // aborta, porque es justo el que iba a quedar fuera del reporte sin avisar.
  const huerfanos = new Map();
  for (const f of fichas) {
    if (!catalogo.has(f.puesto_id)) {
      huerfanos.set(f.puesto_id, (huerfanos.get(f.puesto_id) || 0) + 1);
    }
  }
  if (huerfanos.size > 0) {
    const lista = [...huerfanos.entries()]
      .map(([p, n]) => '    ' + p + ' → ' + n + ' ficha(s)').join('\n');
    abortar(
      huerfanos.size + ' puestoId de la base NO existen en el catálogo. ' +
      'Esas fichas quedarían sin unidad y desaparecerían del reporte en silencio.',
      lista
    );
  }
  console.log('[silencio] cobertura OK: los %d puestoId de la base existen en el catálogo',
    new Set(fichas.map(f => f.puesto_id)).size);

  // ── El silencio, partido ───────────────────────────────────────────────
  const corte = Date.now() - DIAS_SILENCIO * 24 * 60 * 60 * 1000;
  const agg = new Map();   // unidad -> { total, nunca, viejo, activos }

  for (const f of fichas) {
    const u = catalogo.get(f.puesto_id);
    const a = agg.get(u) || { total: 0, nunca: 0, viejo: 0, activos: 0 };
    a.total++;
    if (f.latido_ms == null) a.nunca++;
    else if (Number(f.latido_ms) < corte) a.viejo++;
    else a.activos++;
    agg.set(u, a);
  }

  console.log('');
  console.log('══════════ EL SILENCIO, PARTIDO POR UNIDAD ══════════');
  console.log('%-22s %6s %6s %6s %6s  %s', 'UNIDAD', 'FICHAS', 'NUNCA', '>30d', 'VIVAS', 'SILENCIO');
  console.log('─'.repeat(72));

  let tTotal = 0, tNunca = 0, tViejo = 0, tActivos = 0;
  const filas = [...agg.entries()].sort((a, b) => {
    const sa = (a[1].nunca + a[1].viejo) / a[1].total;
    const sb = (b[1].nunca + b[1].viejo) / b[1].total;
    return sb - sa;   // lo peor arriba
  });
  for (const [u, a] of filas) {
    const sil = a.nunca + a.viejo;
    console.log('%-22s %6d %6d %6d %6d  %d%%',
      u, a.total, a.nunca, a.viejo, a.activos, Math.round((sil / a.total) * 100));
    tTotal += a.total; tNunca += a.nunca; tViejo += a.viejo; tActivos += a.activos;
  }
  console.log('─'.repeat(72));
  console.log('%-22s %6d %6d %6d %6d', 'TOTAL', tTotal, tNunca, tViejo, tActivos);

  // Cuadratura: la suma tiene que ser la misma que la entrada.
  if (tTotal !== fichas.length) {
    abortar('la suma por unidad (' + tTotal + ') no iguala las fichas leídas (' + fichas.length + ').');
  }

  console.log('');
  console.log('CÓMO SE LEE, y son lecturas OPUESTAS:');
  console.log('  · "sucursal" en silencio        → ADOPCIÓN. La pantalla existe y no la abren.');
  console.log('                                    Se resuelve con su Gerente de Zona.');
  console.log('  · cualquier otra en silencio    → NO SE LES CONSTRUYÓ NADA. Sin ámbito, sin');
  console.log('                                    pantalla, sin unidad en ningún tablero.');
  console.log('');
  console.log('Y mientras esta partición no exista en el tablero, ningún porcentaje de esas');
  console.log('pantallas sube a Dirección: un cumplimiento sin fidelidad no se reporta.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[silencio] ERROR:', e && e.message);
    console.error('[silencio] Una corrida con error no mide nada.');
    process.exit(1);
  });
