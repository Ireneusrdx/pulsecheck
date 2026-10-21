import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import authRoutes from './routes/auth';
import monitorRoutes from './routes/monitors';
import statusRoutes from './routes/status';

// Express app factory (no listen() here, so tests can use supertest).
export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/monitors', monitorRoutes);
  app.use('/api/status', statusRoutes);

  // In production the server also serves the built client.
  const staticDir = process.env.STATIC_DIR ?? path.join(__dirname, '../../client/dist');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
