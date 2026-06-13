import multer from 'multer';
import { badRequest } from '../utils/http-error';

const XLSX_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // alguns navegadores enviam assim
];

/** Upload de planilha em memória (até 10 MB), aceitando .xlsx/.xls. */
export const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      XLSX_MIMES.includes(file.mimetype) || /\.xlsx?$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(badRequest('Arquivo deve ser uma planilha .xlsx'));
  },
}).single('file');

const DOC_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/** Upload de documento (PDF ou imagem) para extração por IA, até 20 MB. */
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      DOC_MIMES.includes(file.mimetype) ||
      /\.(pdf|jpe?g|png|webp|gif)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(badRequest('Arquivo deve ser PDF ou imagem (jpg, png, webp)'));
  },
}).single('file');
