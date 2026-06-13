import { Router } from 'express';
import { importController } from './import.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';
import { uploadXlsx } from '../../shared/middlewares/upload.middleware';

const router = Router();

router.use(authenticate);

// Analisa a planilha sem gravar (admin/buyer).
router.post('/preview', authorize('admin', 'buyer'), uploadXlsx, importController.preview);

// Grava de fato (admin/buyer).
router.post('/', authorize('admin', 'buyer'), uploadXlsx, importController.commit);

export default router;
