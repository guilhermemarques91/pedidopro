import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.post('/login', authController.login);
router.get('/me', authenticate, authController.getMe);

export default router;
