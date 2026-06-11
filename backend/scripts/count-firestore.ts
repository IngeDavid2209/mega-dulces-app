// =============================================================================
// Diagnostico Firestore — count por coleccion
// =============================================================================
// Usa la API .count() de Firestore Admin SDK, que cobra ~1 lectura por cada
// 1000 docs leidos en el indice (mucho mas barato que traer todos los docs).
// Sirve para:
//   1. Confirmar que la cuota diaria de lecturas no esta agotada.
//   2. Estimar volumen total antes de correr la migracion completa.
//
// Uso:
//   cd backend
//   npx tsx scripts/count-firestore.ts
import 'dotenv/config';
import admin from 'firebase-admin';

function initFirebase(): void {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (sa) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
  } else if (credPath) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    throw new Error(
      'Falta credencial Firebase. Configurar FIREBASE_SERVICE_ACCOUNT (JSON inline) ' +
      'o GOOGLE_APPLICATION_CREDENTIALS (path al JSON) en .env'
    );
  }
}

const COLECCIONES = [
  'usuarios',
  'users',
  'areas',
  'areas_operativas',
  'catalogo_rutinas',
  'asignaciones_rutinas',
  'moldes_checklists',
  'tareas_equipo',
  'checklists',
  'notificaciones',
  'descansos_semanales',
];

async function main(): Promise<void> {
  initFirebase();
  const db = admin.firestore();

  console.log('============================================================');
  console.log('  DIAGNOSTICO FIRESTORE — count() por coleccion');
  console.log('============================================================');
  console.log('  (consume ~1 lectura facturable por cada 1000 docs)\n');

  // Codigos gRPC relevantes (Status enum de @grpc/grpc-js)
  // https://grpc.io/docs/guides/status-codes/
  const GRPC = {
    7:  'PERMISSION_DENIED',
    8:  'RESOURCE_EXHAUSTED',
    14: 'UNAVAILABLE',
    16: 'UNAUTHENTICATED',
  } as const;

  let total = 0;
  let cuotaOk = true;

  for (const c of COLECCIONES) {
    try {
      const snap = await db.collection(c).count().get();
      const n = snap.data().count;
      total += n;
      console.log(`  ${c.padEnd(25)} ${String(n).padStart(6)} docs`);
    } catch (err: any) {
      const rawCode = err.code;
      const codeName = typeof rawCode === 'number' ? (GRPC as any)[rawCode] ?? `grpc-${rawCode}` : String(rawCode || err.message);
      console.log(`  ${c.padEnd(25)} ERROR: ${codeName}`);
      // RESOURCE_EXHAUSTED = cuota agotada. Tambien aceptamos el string por si el SDK cambia el formato.
      const esCuota = rawCode === 8
        || String(codeName).toUpperCase().includes('RESOURCE_EXHAUSTED')
        || String(err.message || '').toLowerCase().includes('quota');
      if (esCuota) {
        cuotaOk = false;
        console.log('\n  >>> CUOTA AGOTADA (RESOURCE_EXHAUSTED). Esperar al reset.');
        console.log('      Reset: medianoche PT = ~01:00 hora Mexico = 07:00 UTC.');
        break;
      }
    }
  }

  console.log('------------------------------------------------------------');
  console.log(`  TOTAL aproximado:                ${total} docs`);
  console.log('============================================================');

  if (cuotaOk && total > 0) {
    const lecturasEstimadas = total;
    const porcentaje = ((lecturasEstimadas / 50000) * 100).toFixed(1);
    console.log('\n  ESTIMACION DE COSTO DE LA MIGRACION COMPLETA:');
    console.log(`    Lecturas necesarias: ~${lecturasEstimadas} (1 por doc)`);
    console.log(`    Cuota diaria Spark:  50,000 lecturas`);
    console.log(`    Consumira:           ~${porcentaje}% de la cuota diaria`);

    if (lecturasEstimadas < 30000) {
      console.log('\n  >>> SEMAFORO VERDE: la migracion completa cabe en la cuota.');
    } else if (lecturasEstimadas < 45000) {
      console.log('\n  >>> SEMAFORO AMBAR: cabe pero queda poca cuota para el resto del dia.');
    } else {
      console.log('\n  >>> SEMAFORO ROJO: la migracion consumira casi toda la cuota.');
      console.log('      Mejor esperar al reset de medianoche PT.');
    }
  } else if (cuotaOk && total === 0) {
    console.log('\n  >>> No se encontraron docs en ninguna coleccion (revisar credenciales/proyecto).');
  }

  process.exit(cuotaOk ? 0 : 2);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
