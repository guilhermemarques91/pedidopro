import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { importService } from './import.service';

function requireFile(req: AuthRequest): { buffer: Buffer; filename: string } {
  if (!req.file) throw badRequest('Envie a planilha no campo "file"');
  return { buffer: req.file.buffer, filename: req.file.originalname };
}

export const importController = {
  async preview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { buffer, filename } = requireFile(req);
      res.json(await importService.preview(buffer, filename));
    } catch (err) {
      next(err);
    }
  },

  async commit(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { buffer, filename } = requireFile(req);
      res.status(201).json(await importService.commit(buffer, filename, req.user!.id));
    } catch (err) {
      next(err);
    }
  },
};
