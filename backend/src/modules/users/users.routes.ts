import { Router } from 'express';
import { usersController } from './users.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

// Gestão de usuários é exclusiva do admin.
router.use(authenticate, authorize('admin'));

router.get('/', usersController.list);
router.post('/', usersController.create);
router.put('/:id', usersController.update);
router.patch('/:id/active', usersController.setActive);

export default router;
