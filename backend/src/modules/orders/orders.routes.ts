import { Router } from 'express';
import { ordersController } from './orders.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

const buyers = authorize('admin', 'buyer');        // criam e gerenciam pedidos
const approvers = authorize('admin', 'approver');  // aprovam/rejeitam

// Leitura (qualquer autenticado)
router.get('/', ordersController.list);
router.get('/:id', ordersController.getById);

// CRUD de rascunho
router.post('/', buyers, ordersController.create);
router.patch('/:id', buyers, ordersController.update);
router.delete('/:id', buyers, ordersController.remove);

// Itens (apenas em rascunho)
router.post('/:id/items', buyers, ordersController.addItem);
router.put('/:id/items/:itemId', buyers, ordersController.updateItem);
router.delete('/:id/items/:itemId', buyers, ordersController.removeItem);

// Transições de estado
router.post('/:id/submit', buyers, ordersController.submit);
router.post('/:id/approve', approvers, ordersController.approve);
router.post('/:id/reject', approvers, ordersController.reject);
router.post('/:id/send', buyers, ordersController.send);
router.post('/:id/receive', buyers, ordersController.receive);
router.post('/:id/cancel', buyers, ordersController.cancel);

export default router;
