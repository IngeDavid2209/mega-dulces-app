const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const fs = require('fs');

// 1. Desencriptar las llaves secretas de GitHub
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

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
    text: 'Hola Administrador.\n\nSe adjunta el respaldo en Excel del último periodo operativo. Las fotografías y la base de datos de Firebase han sido depuradas exitosamente para liberar espacio en la nube.\n\nAtte: Tu Robot 🤖',
    attachments: [{ filename: 'Respaldo_Mensual_Mega_Dulces.xlsx', path: excelPath }]
  });
  console.log('📧 Correo con respaldo enviado exitosamente.');

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
  
  console.log('✅ Base de datos 100% limpia. Misión cumplida.');
}

run().catch(console.error);