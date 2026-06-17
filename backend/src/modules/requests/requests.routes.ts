import { Router } from 'express';
import { requestsController } from './requests.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Funcionário (requester) e admin criam/enviam listas.
const requesters = authorize('admin', 'requester', 'buyer');
// Apenas o admin aloca fornecedores e gera os pedidos.
const adminOnly = authorize('admin');

router.get('/', requestsController.list);
router.get('/:id', requestsController.getById);
router.post('/', requesters, requestsController.create);
router.put('/:id', requesters, requestsController.update);
router.post('/:id/submit', requesters, requestsController.submit);
router.post('/:id/cancel', requesters, requestsController.cancel);
router.delete('/:id', requesters, requestsController.remove);

router.put('/:id/allocation', adminOnly, requestsController.allocate);
router.post('/:id/generate-orders', adminOnly, requestsController.generateOrders);

export default router;
