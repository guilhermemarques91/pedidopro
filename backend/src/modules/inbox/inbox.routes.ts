import { Router } from 'express';
import { inboxController } from './inbox.controller';
import { authenticate, authorize } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

const writers = authorize('admin', 'buyer');

router.get('/', inboxController.list);
router.get('/count', inboxController.count);
router.post('/sync', writers, inboxController.sync);
router.put('/:id', writers, inboxController.update);
router.post('/approve', writers, inboxController.approve);
router.post('/discard', writers, inboxController.discard);

export default router;
