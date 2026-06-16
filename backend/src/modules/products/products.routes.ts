import { Router } from 'express';
import { productsController } from './products.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);
const writers = authorize('admin', 'buyer');

// rotas específicas antes de /:id
router.get('/', productsController.list);
router.get('/unmapped', productsController.unmapped);
router.post('/suggest', writers, productsController.suggest);
router.post('/unassign', writers, productsController.unassign);

router.post('/', writers, productsController.create);
router.get('/:id', productsController.getById);
router.put('/:id', writers, productsController.update);
router.delete('/:id', writers, productsController.remove);
router.post('/:id/items', writers, productsController.assign);

export default router;
