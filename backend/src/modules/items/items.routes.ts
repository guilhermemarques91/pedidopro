import { Router } from 'express';
import { itemsController } from './items.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', itemsController.list);
router.get('/:id', itemsController.getById);

router.post('/', authorize('admin', 'buyer'), itemsController.create);
router.put('/:id', authorize('admin', 'buyer'), itemsController.update);
router.delete('/:id', authorize('admin'), itemsController.remove);

export default router;
