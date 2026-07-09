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

/** Formata data ISO como dd/mm/aaaa. */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
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
