// Configuracion de la app Express. Se separa de index.ts para que las pruebas
// puedan importar `app` sin levantar el listener real.
import 'dotenv/config';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './services/prisma.js';
import authRouter from './routes/auth.routes.js';
import usuariosRouter from './routes/usuarios.routes.js';
import checklistsRouter from './routes/checklists.routes.js';
import areasRouter from './routes/areas.routes.js';
import rutinasCatalogoRouter from './routes/rutinas-catalogo.routes.js';
import asignacionesRutinasRouter from './routes/asignaciones-rutinas.routes.js';
import moldesChecklistsRouter from './routes/moldes-checklists.routes.js';
import tareasEquipoRouter from './routes/tareas-equipo.routes.js';
import notificacionesRouter from './routes/notificaciones.routes.js';
import descansosRouter from './routes/descansos.routes.js';
import internalRouter from './routes/internal.routes.js';

export function buildApp(): Express {
  const app = express();

  // --- Middleware basico ---
  app.use(helmet());
  app.use(express.json({ limit: '5mb' }));        // checklists con items grandes
  app.use(express.urlencoded({ extended: true }));

  // CORS: lista blanca desde variable de entorno.
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  app.use(cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, curl, mismo origen)
      if (!origin) return callback(null, true);
      if (origins.length === 0 || origins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origen no permitido (${origin})`));
    },
    credentials: true,
  }));

  // --- Health endpoint ---
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      // Probamos la conexion a Postgres con una query barata
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        ok: true,
        service: 'mega-dulces-backend',
        db: 'connected',
        env: process.env.NODE_ENV || 'unknown',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(503).json({
        ok: false,
        service: 'mega-dulces-backend',
        db: 'unreachable',
        error: err?.message || 'unknown',
      });
    }
  });

  // --- Rutas de autenticacion (Fase 2) ---
  app.use('/api/auth', authRouter);

  // --- Rutas CRUD por entidad (Fase 3) ---
  app.use('/api/usuarios',              usuariosRouter);
  app.use('/api/checklists',            checklistsRouter);
  app.use('/api/areas',                 areasRouter);
  app.use('/api/rutinas-catalogo',      rutinasCatalogoRouter);
  app.use('/api/asignaciones-rutinas',  asignacionesRutinasRouter);
  app.use('/api/moldes-checklists',     moldesChecklistsRouter);
  app.use('/api/tareas-equipo',         tareasEquipoRouter);
  app.use('/api/notificaciones',        notificacionesRouter);
  app.use('/api/descansos',             descansosRouter);
  app.use('/api/internal',              internalRouter);

  // --- 404 handler ---
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  // --- Error handler global ---
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
