import { Router } from 'express';
import { quotationsController } from './quotations.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';
import { uploadDocument } from '../../shared/middlewares/upload.middleware';

const router = Router();

router.use(authenticate);

// Leitura
router.get('/', quotationsController.list);
router.get('/:id', quotationsController.getById);
router.get('/:id/comparison', quotationsController.comparison);

// Escrita (admin/buyer)
const writers = authorize('admin', 'buyer');

router.post('/', writers, quotationsController.create);
router.patch('/:id', writers, quotationsController.update);
router.delete('/:id', writers, quotationsController.remove);
router.post('/:id/close', writers, quotationsController.close);

// Extração de preços por IA (upload de PDF/imagem → Claude)
router.post('/:id/extract', writers, uploadDocument, quotationsController.extract);

// Itens (entrada de preços)
router.post('/:id/items', writers, quotationsController.addItem);
router.put('/:id/items/:itemId', writers, quotationsController.updateItem);
router.delete('/:id/items/:itemId', writers, quotationsController.removeItem);

export default router;
