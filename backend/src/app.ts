import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import authRoutes from './modules/auth/auth.routes';
import categoriesRoutes from './modules/categories/categories.routes';
import suppliersRoutes from './modules/suppliers/suppliers.routes';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes';
import { notFoundHandler, errorHandler } from './shared/middlewares/error.middleware';

const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pedidopro-api' });
});

// Rotas dos módulos
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// 404 + handler global de erros (sempre por último)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
