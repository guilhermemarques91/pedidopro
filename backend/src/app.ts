import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import authRoutes from './modules/auth/auth.routes';
import categoriesRoutes from './modules/categories/categories.routes';
import suppliersRoutes from './modules/suppliers/suppliers.routes';
import itemsRoutes from './modules/items/items.routes';
import productsRoutes from './modules/products/products.routes';
import importRoutes from './modules/import/import.routes';
import quotationsRoutes from './modules/quotations/quotations.routes';
import ordersRoutes from './modules/orders/orders.routes';
import inboxRoutes from './modules/inbox/inbox.routes';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes';
import { notFoundHandler, errorHandler } from './shared/middlewares/error.middleware';
import { env } from './config/env';

const app = express();

const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // Permite requisições sem Origin (curl, apps mobile) e as da allowlist.
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error('Origem não permitida pelo CORS'));
    },
  })
);
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
app.use('/api/items', itemsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/quotations', quotationsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// 404 + handler global de erros (sempre por último)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
