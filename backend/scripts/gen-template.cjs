/* Gera o modelo de planilha de importação do PedidoPro. */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const headers = [
  'fornecedor',
  'categoria',
  'item',
  'unidade',
  'embalagem_qtd',
  'embalagem_unidade',
  'preco',
  'whatsapp',
];

const exemplos = [
  {
    fornecedor: 'Frigorífico Boi Forte',
    categoria: 'Carnes',
    item: 'Frango inteiro congelado',
    unidade: 'kg',
    embalagem_qtd: '',
    embalagem_unidade: '',
    preco: '12,90',
    whatsapp: '5511988887777',
  },
  {
    fornecedor: 'Frigorífico Boi Forte',
    categoria: 'Carnes',
    item: 'Picanha resfriada',
    unidade: 'kg',
    embalagem_qtd: '2,5',
    embalagem_unidade: 'peça',
    preco: '69,90',
    whatsapp: '5511988887777',
  },
  {
    fornecedor: 'Embalagens Sul',
    categoria: 'Descartáveis',
    item: 'Embalagem marmita 500ml',
    unidade: 'un',
    embalagem_qtd: '100',
    embalagem_unidade: 'caixa',
    preco: '0,85',
    whatsapp: '',
  },
];

const ws = XLSX.utils.json_to_sheet(exemplos, { header: headers });
// Larguras de coluna para leitura confortável
ws['!cols'] = [
  { wch: 24 }, { wch: 16 }, { wch: 28 }, { wch: 10 },
  { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 16 },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Itens');

const outDir = path.resolve(__dirname, '..', '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'modelo-importacao.xlsx');
XLSX.writeFile(wb, out);
console.log('Modelo gerado em:', out);
