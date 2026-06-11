// Entry point del backend. Levanta el listener Express y maneja shutdown limpio.
import { buildApp } from './server.js';
import { prisma } from './services/prisma.js';

const app = buildApp();
const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, () => {
  console.log(`[mega-dulces-backend] escuchando en http://localhost:${PORT}`);
  console.log(`[mega-dulces-backend] env=${process.env.NODE_ENV || 'unknown'}`);
  console.log(`[mega-dulces-backend] health: http://localhost:${PORT}/health`);
});

// --- Shutdown limpio: cerrar Prisma y el listener al recibir SIGINT/SIGTERM ---
const shutdown = async (signal: string) => {
  console.log(`[mega-dulces-backend] ${signal} recibido, cerrando…`);
  server.close(() => console.log('[mega-dulces-backend] HTTP server cerrado'));
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
