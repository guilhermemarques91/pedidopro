import { Router } from 'express';
import { whatsappController } from './whatsapp.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Envio de teste restrito a admin.
router.post('/test', authorize('admin'), whatsappController.sendTest);
router.get('/status', whatsappController.status);

export default router;
