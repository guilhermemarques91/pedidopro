import { Router } from 'express';
import { suppliersController } from './suppliers.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', suppliersController.list);
router.get('/:id', suppliersController.getById);

// Escrita restrita a admin e buyer (compradores cadastram fornecedores).
router.post('/', authorize('admin', 'buyer'), suppliersController.create);
router.put('/:id', authorize('admin', 'buyer'), suppliersController.update);
router.delete('/:id', authorize('admin'), suppliersController.remove);

export default router;
