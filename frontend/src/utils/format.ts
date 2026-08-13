export interface ParsedOption { name: string; quantity: number | null; group: string | null; }

/**
 * Normaliza os complementos/opções de um item de delivery. Trata os dois formatos
 * (iFood `options[]` e 99Food `sub_item_list[]`), aceita objeto já decodificado ou
 * string JSON crua, e achata um nível de aninhamento. Extrai nome, quantidade e grupo.
 * Preço é omitido de propósito: iFood vem em reais e 99Food em centavos — misturar
 * enganaria; para a comanda o que importa é o nome/quantidade do complemento.
 */
export function parseOptions(v: unknown): ParsedOption[] {
  let arr: unknown = v;
  if (typeof v === 'string' && v.trim()) {
    try { arr = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const pickStr = (o: Record<string, unknown>, keys: string[]): string | null => {
    for (const k of keys) { const x = o[k]; if (x != null && String(x).trim() !== '') return String(x).trim(); }
    return null;
  };
  const pickNum = (o: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) { const x = o[k]; if (x != null && x !== '' && Number.isFinite(Number(x))) return Number(x); }
    return null;
  };
  const out: ParsedOption[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const name = pickStr(o, ['name', 'sub_item_name', 'itemName', 'complementName', 'description']);
    if (name) {
      out.push({
        name,
        quantity: pickNum(o, ['quantity', 'amount', 'count']),
        // 99Food usa `content_name` p/ o grupo (ex.: "Escolha sua Proteína"); iFood usa groupName.
        group: pickStr(o, ['content_name', 'group_name', 'groupName', 'property_name', 'propertyName', 'category']),
      });
    }
    const nested = o['sub_item_list'] ?? o['options'] ?? o['garnishItems'];
    if (Array.isArray(nested)) out.push(...parseOptions(nested));
  }
  return out;
}

/** Normaliza sides_json (pode vir como array já decodificado ou string JSON crua). */
export function parseSides(v: unknown): { id: number; name: string }[] {
  if (Array.isArray(v)) return v as { id: number; name: string }[];
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * As proteínas da marmita numa linha só ("Costelinha Suína + Omelete").
 *
 * Junta em vez de virar coluna nova: a marmita mista é UM item na etiqueta, no
 * relatório e na conferência da nota — abrir "Proteína 2" em toda tabela deixaria
 * a coluna vazia em 95% das linhas.
 */
export function proteinLabel(first?: string | null, second?: string | null): string {
  return [first, second].filter(Boolean).join(' + ');
}

/**
 * Formata o endereço de entrega numa linha legível. Aceita o objeto normalizado
 * ({street,number,neighborhood,...}) ou o cru de iFood (camelCase) / 99Food
 * (snake_case), e até string JSON (parseia) — cobre pedidos novos e antigos.
 */
export function formatAddress(input: unknown): string {
  let addr: Record<string, unknown> | null = null;
  if (typeof input === 'string' && input.trim()) {
    try { const p = JSON.parse(input); addr = p && typeof p === 'object' ? (p as Record<string, unknown>) : null; } catch { addr = null; }
  } else if (input && typeof input === 'object') {
    addr = input as Record<string, unknown>;
  }
  if (!addr) return '';
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = addr![k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const line = [get('street', 'streetName', 'street_name'), get('number', 'streetNumber', 'street_number')].filter(Boolean).join(', ');
  const parts = [
    line,
    get('complement'),
    get('neighborhood', 'district'),
    get('city'),
    get('state'),
    get('postal_code', 'postalCode', 'zipCode'),
  ].filter(Boolean);
  return parts.join(' · ') || get('formatted', 'poi_address', 'formattedAddress');
}

/** Formata número/string como moeda BRL. */
export function brl(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata data ISO como dd/mm/aaaa.
 *
 * Data PURA ("2026-05-30", sem hora) é formatada na mão: `new Date` a
 * interpretaria como meia-noite UTC, que em America/Sao_Paulo (UTC-3) cai no
 * dia anterior — a data 30/05 apareceria como 29/05.
 */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${d}/${m}/${y}`;
  }
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Formata data "AAAA-MM-DD" como dd/mm — sem passar por `new Date`, que
 * interpretaria a string como UTC e voltaria um dia em fusos negativos.
 */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : iso;
}

/** Formata fração como percentual pt-BR: 0.2995 → "29,95%". */
export function pct(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Formata competência "2026-07" como "julho/2026". */
export function monthLabel(refMonth: string | null | undefined): string {
  if (!refMonth) return '—';
  const [y, m] = refMonth.split('-');
  const idx = Number(m) - 1;
  return MONTH_NAMES[idx] ? `${MONTH_NAMES[idx]}/${y}` : refMonth;
}

/** Formata data ISO como dd/mm/aaaa hh:mm. */
export function datetime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Converte string com vírgula/ponto para número, ou null.
 * Se tem vírgula → formato pt-BR (ponto = milhar, vírgula = decimal): "2.500,50" → 2500.5.
 * Se NÃO tem vírgula → ponto é decimal (ex.: valor cru do backend "25.00"): "25.00" → 25.
 */
export function parseNum(v: string): number | null {
  if (!v.trim()) return null;
  const s = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formata número/string (inclusive valor cru do backend, ponto-decimal) como string
 * de input pt-BR com vírgula decimal: "25.00" → "25,00", 25.5 → "25,5", "" → "".
 * Usar ao pré-preencher inputs de preço/qtd com dados vindos da API.
 */
export function numToInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}

/**
 * Quantidade para LEITURA: inteiro sai sem casas, fracionário sai com vírgula e sem zeros
 * à direita (1 → "1", 1.5 → "1,5", 0.25 → "0,25"). Vazio/ inválido vira travessão.
 *
 * Estava copiada em Contagem e em Produtos com regras ligeiramente diferentes — a mesma
 * quantidade aparecia como "1,5" numa tela e "1,500" na outra.
 */
export function fmtQty(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}
