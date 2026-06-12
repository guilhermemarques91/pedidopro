import { Router } from 'express';
import { categoriesController } from './categories.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

// Todas as rotas exigem autenticação.
router.use(authenticate);

router.get('/', categoriesController.list);
router.get('/:id', categoriesController.getById);

// Escrita restrita a admin.
router.post('/', authorize('admin'), categoriesController.create);
router.put('/:id', authorize('admin'), categoriesController.update);
router.delete('/:id', authorize('admin'), categoriesController.remove);

export default router;
