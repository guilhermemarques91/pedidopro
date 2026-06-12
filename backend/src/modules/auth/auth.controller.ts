import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { loginSchema } from './auth.dto';
import { authService } from './auth.service';

export const authController = {
  async login(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = loginSchema.parse(req.body);
      const result = await authService.login(dto);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getMe(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // req.user é garantido pelo middleware authenticate.
      const user = await authService.getMe(req.user!.id);
      res.json(user);
    } catch (err) {
      next(err);
    }
  },
};
