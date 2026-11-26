import { Router } from 'express';
import chatRoutes from '../modules/chat/chat.routes';
import userRoutes from '../modules/user/user.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.use('/chat', chatRoutes);
router.use('/user', userRoutes);

export default router;
