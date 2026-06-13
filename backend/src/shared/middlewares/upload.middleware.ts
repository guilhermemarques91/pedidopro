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
