const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const fs = require('fs');

// 1. Desencriptar las llaves secretas de GitHub
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ══════════════════════════════════════════════════════════════════════════
//  EL BORRADO NO SE HACE SOLO. HAY QUE PEDIRLO.
//
//  Este script es el "blocker activo" del §3 del CLAUDE.md, y sigue armado: el
//  cron se quitó el 31/ago (paso 0.1) pero el workflow conserva
//  `workflow_dispatch`, así que un clic en "Run workflow" lo dispara.
//
//  QUÉ PASA HOY SI ALGUIEN LO CLICA, medido leyendo el propio archivo:
//
//   1. Selecciona `where('enviado','==',true)` SIN NINGÚN FILTRO DE FECHA. No
//      borra "el mes": borra TODO lo enviado desde que existe la app.
//   2. Destruye las fotos en Cloudinary (`uploader.destroy`). Eso es LA
//      EVIDENCIA — la que Dirección ordenó el 3/sep para los 377 puntos — y
//      Cloudinary no tiene papelera. Contradice el invariante §5.5: nada se
//      borra ni se sobrescribe.
//   3. Borra los documentos de Firestore, y POSTGRES NO SE ENTERA. Como las
//      lecturas ya vienen de Postgres, la app seguiría mostrando esos
//      checklists con URLs de fotos que ya no existen.
//   4. Y el respaldo que queda es un Excel de SEIS COLUMNAS —id, nombre,
//      asignado, sucursal, fecha, progreso—. No lleva los items, ni las fotos,
//      ni quién verificó. O sea: se destruye la prueba y se conserva un índice.
//
//  Por eso el modo por omisión es SIMULACIÓN: hace el respaldo y el correo, que
//  son útiles y no destruyen nada, y reporta exactamente qué habría borrado.
//  Para borrar de verdad hay que pedirlo con CORTE_MODO=destructivo.
//
//  CUÁNDO SE PUEDE QUITAR ESTA GUARDA: cuando la Fase 1 termine y exista una
//  sola base. Mientras haya dos, borrar en una y no en la otra es exactamente
//  la divergencia que el paso 0.2 todavía no ha medido.
//
//  LÍMITE HONESTO, y hay que decirlo: esta guarda vive en el repo LOCAL.
//  GitHub Actions hace checkout de la rama por defecto, y `git push` está roto
//  (la laptop se autentica como una cuenta que no ve el remoto). Hasta que ese
//  push funcione, el botón de "Run workflow" en GitHub sigue corriendo la
//  versión ANTERIOR de este archivo, sin guarda. Esto protege desde el push,
//  no desde ahora.
// ══════════════════════════════════════════════════════════════════════════
const MODO_DESTRUCTIVO = String(process.env.CORTE_MODO || '').toLowerCase() === 'destructivo';

// 2. Extraer el ID de la foto de Cloudinary para poder borrarla
function getPublicId(url) {
  try {
    const urlSinExt = url.substring(0, url.lastIndexOf('.'));
    const path = urlSinExt.split('/upload/')[1];
    const parts = path.split('/');
    if (parts[0].match(/^v\d+$/)) parts.shift(); // Quitar la versión (v123456)
    return parts.join('/');
  } catch (e) { return null; }
}

async function run() {
  console.log('🤖 Iniciando Robot de Corte Mensual...');
  
  // Buscar solo los checklists que ya fueron enviados
  const snapshot = await db.collection('checklists').where('enviado', '==', true).get();

  if (snapshot.empty) {
    console.log('⚪ No hay checklists completados para respaldar este mes.');
    return;
  }

  // 3. Crear el archivo Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Respaldo');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'Nombre', key: 'name', width: 30 },
    { header: 'Asignado', key: 'assigned', width: 25 },
    { header: 'Sucursal', key: 'store', width: 25 },
    { header: 'Fecha', key: 'date', width: 15 },
    { header: 'Progreso (%)', key: 'progreso', width: 15 }
  ];

  let imageIds = [];
  let docIds = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    docIds.push(doc.id);
    sheet.addRow({
      id: data.id, name: data.name, assigned: data.assigned,
      store: data.store, date: data.date, progreso: data.calcProgreso
    });

    if (data.items) {
      data.items.forEach(item => {
        if (item.photo && item.photo.includes('cloudinary')) {
          const pid = getPublicId(item.photo);
          if (pid) imageIds.push(pid);
        }
      });
    }
  });

  const excelPath = './Respaldo_Mensual_Mega_Dulces.xlsx';
  await workbook.xlsx.writeFile(excelPath);
  console.log(`📊 Excel generado con ${docIds.length} registros.`);

  // 4. Enviar el correo con el ZIP/Excel adjunto
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.GMAIL_USER, // Te llega a tu propio correo
    subject: '📦 Respaldo Mensual Automático - Mega Dulces',
    // EL TEXTO NO PUEDE AFIRMAR UN BORRADO QUE TODAVÍA NO OCURRIÓ. Este correo
    // se envía en el paso 4 y el borrado va en el 5 y el 6: la versión anterior
    // decía "han sido depuradas exitosamente" ANTES de depurar nada, así que si
    // el borrado fallaba, el correo ya había mentido — y es el correo que le
    // llega a Dirección.
    text: MODO_DESTRUCTIVO
      ? 'Hola Administrador.\n\nSe adjunta el respaldo en Excel del último periodo operativo.\n\nA continuación se intentará depurar las fotografías de Cloudinary y los registros de Firebase. Si algo falla en ese paso, aparecerá en el log de la corrida: este correo se envía ANTES de la depuración y no es prueba de que haya terminado bien.\n\nAtte: Tu Robot 🤖'
      : 'Hola Administrador.\n\nSe adjunta el respaldo en Excel del último periodo operativo.\n\nNO SE BORRÓ NADA. El robot corrió en modo simulación: las fotografías de Cloudinary y los registros de Firebase siguen intactos. Mientras el proyecto tenga dos bases vivas, borrar en una y no en la otra crea divergencia — y este Excel no contiene las fotos ni los puntos, así que no sustituye a lo que se borraría.\n\nPara depurar de verdad hay que correrlo con CORTE_MODO=destructivo.\n\nAtte: Tu Robot 🤖',
    attachments: [{ filename: 'Respaldo_Mensual_Mega_Dulces.xlsx', path: excelPath }]
  });
  console.log('📧 Correo con respaldo enviado exitosamente.');

  if (!MODO_DESTRUCTIVO) {
    // SIMULACIÓN. Se dice lo que se habría borrado, con sus cifras, y se para.
    // Un "no hice nada" sin números no deja saber si es que no había nada o es
    // que no se leyó nada: son dos cosas distintas y se ven igual.
    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('  MODO SIMULACIÓN · NO SE BORRÓ NADA');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  Habría borrado ${docIds.length} documento(s) de Firestore.`);
    console.log(`  Habría destruido ${imageIds.length} foto(s) de Cloudinary, sin papelera.`);
    console.log('');
    console.log('  Y OJO CON ESE SEGUNDO NÚMERO: solo recoge `item.photo`. Desde el');
    console.log('  3/sep la evidencia vive en `item.photos[]`, que este script NO');
    console.log('  mira, así que el conteo real de fotos en riesgo es MAYOR que el');
    console.log('  de arriba. Arreglar eso es parte de la Fase 1, no de esta guarda.');
    console.log('');
    console.log('  El respaldo (Excel + correo) sí se hizo: es lo no destructivo.');
    console.log('  Para borrar de verdad: CORTE_MODO=destructivo');
    console.log('════════════════════════════════════════════════════════════════');
    return;
  }

  // 5. Exterminar fotos en Cloudinary
  console.log(`🔥 Borrando ${imageIds.length} fotos de Cloudinary...`);
  for (const pid of imageIds) {
    try { await cloudinary.uploader.destroy(pid); } catch(e) {}
  }

  // 6. Limpiar Firebase
  console.log(`🧹 Borrando ${docIds.length} registros de Firebase...`);
  const batch = db.batch();
  docIds.forEach(id => {
    batch.delete(db.collection('checklists').doc(id));
  });
  await batch.commit();

  // NO se dice "100% limpia": Postgres conserva esas filas y sus URLs de foto,
  // así que después de esto las dos bases están MÁS separadas, no más limpias.
  console.log(`✅ Borrados ${docIds.length} documentos de Firestore y ${imageIds.length} fotos.`);
  console.log('⚠️  Postgres NO se tocó: esas filas siguen ahí, ahora con fotos que ya no existen.');
}

run().catch(console.error);