import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../shared/types';
import { whatsappService } from './whatsapp.service';

const testMessageSchema = z.object({
  number: z.string().min(8, 'Número inválido'),
  message: z.string().min(1, 'Mensagem obrigatória'),
});

export const whatsappController = {
  async sendTest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { number, message } = testMessageSchema.parse(req.body);
      await whatsappService.sendMessage(number, message);
      res.json({ sent: true });
    } catch (err) {
      next(err);
    }
  },

  async status(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const connected = await whatsappService.checkConnection();
      res.json({ connected });
    } catch (err) {
      next(err);
    }
  },
};
