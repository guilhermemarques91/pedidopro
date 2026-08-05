<?php

namespace App\Services;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;
use App\Modules\Marmitex\MarmitexResolver;

/**
 * Mensagem do grupo → linhas de pedido (ainda em texto, sem ids).
 *
 * A ideia central: em vez de exigir um formato ("Nome - tamanho proteína"),
 * CONSOME do texto tudo que é item do cardápio, onde quer que esteja, e trata o
 * que sobra como o nome da pessoa. É o que faz os dois jeitos reais de pedir
 * caírem na mesma regra, sem IA:
 *
 *   "1) Henrique (P): Carne de panela e omelete."   → tamanho entre parênteses
 *   "Gostaria de pedir uma marmita média            → pedido em 3 linhas,
 *    De carne de panela                                com o nome no fim
 *    Lucas Henrique Matias"
 *
 * A unidade de leitura é o BLOCO (parágrafo separado por linha em branco), não a
 * linha: no segundo formato o nome está numa linha que, sozinha, não tem nada do
 * cardápio — olhando linha a linha, ela seria descartada como conversa.
 *
 * A IA é o plano B, só para o bloco que as regras não entenderam. E mesmo ela
 * devolve TEXTO, nunca id: quem converte texto em item é o MarmitexResolver,
 * contra o cardápio efetivo da empresa. Invenção do modelo vira linha duvidosa na
 * revisão, não marmita errada na produção.
 */
final class MarmitexWaParser
{
    /**
     * Palavras que nunca são nome de pessoa nem item: cortesia, conectivo e o
     * vocabulário de pedir. O que sobra depois de tirar isto é o nome.
     */
    private const FILLER = [
        'bom', 'boa', 'dia', 'tarde', 'noite', 'otimo', 'otima', 'ola', 'oi', 'ei', 'opa',
        'obrigado', 'obrigada', 'obg', 'por', 'favor', 'pf', 'gente', 'pessoal', 'ok', 'blz', 'beleza',
        'gostaria', 'gostariamos', 'queria', 'quero', 'pedir', 'pedido', 'pedidos', 'segue', 'seguem',
        'almoco', 'janta', 'jantar', 'hoje', 'amanha', 'para', 'pra', 'pro', 'com', 'sem', 'e', 'ou',
        'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'o', 'a',
        'marmita', 'marmitas', 'marmitex', 'quentinha', 'quentinhas', 'refeicao', 'refeicoes',
        'mais', 'tambem', 'tbm', 'so', 'somente', 'apenas', 'sim', 'nao', 'favor', 'ser', 'seria',
        'seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
    ];

    private const CANCEL_VERBS = ['cancela', 'cancelar', 'cancele', 'tira', 'tirar', 'remove', 'remover', 'retira', 'retirar'];

    private const CHUNK_CHARS = 700;

    /**
     * @return array<int,array{action:string,person_name:?string,size:?string,protein:?string,sides:string[],observation:?string,raw:string,by:string}>
     */
    public static function parse(array $cfg, string $text): array
    {
        $companyId = (int) $cfg['company_id'];
        $aliases = MarmitexWaIngest::aliases($cfg);
        $menu = MarmitexResolver::menu($companyId);
        $terms = self::terms($menu, $aliases);
        $rulesFirst = Env::bool('MARMITEX_WA_RULES_FIRST', true);

        $out = [];
        $forAi = [];

        foreach (self::blocks($text) as $block) {
            $lines = self::lines($block);
            if (!$lines) {
                continue;
            }

            // Cancelamento é sempre por linha ("tira o pedido do Pedro").
            $rest = [];
            foreach ($lines as $line) {
                $cancel = self::asCancel($line);
                if ($cancel) {
                    $out[] = $cancel;
                } else {
                    $rest[] = $line;
                }
            }
            if (!$rest) {
                continue;
            }
            if (!$rulesFirst) {
                $forAi[] = implode("\n", $rest);
                continue;
            }

            $rows = self::readBlock($rest, $terms);
            if ($rows !== null) {
                foreach ($rows as $r) {
                    $out[] = $r;
                }
                continue;
            }
            // Não entendemos. Só vale gastar IA se o bloco citar item do cardápio:
            // cabeçalho ("Almoço dia 04/08/26 Ter.") e saudação não são pedido, e
            // mandá-los para o modelo só gera linha duvidosa à toa na revisão.
            $blockText = implode("\n", $rest);
            if (self::mentionsMenu($blockText, $terms)) {
                $forAi[] = $blockText;
            }
        }

        if ($forAi) {
            $ai = self::byAi($cfg, $menu, implode("\n\n", $forAi));
            foreach ($ai['rows'] as $row) {
                $out[] = $row;
            }
            // IA fora do ar: não pode sumir pedido. Cada bloco não lido vira uma
            // linha vazia — cai como dúvida na revisão, com o texto original à vista.
            if ($ai['failed']) {
                foreach ($forAi as $blockText) {
                    $out[] = self::row(null, null, null, [], null, $blockText, 'nao-lido');
                }
            }
        }

        return self::applyDefaults($out, $cfg);
    }

    /**
     * Data de consumo declarada no texto ("Almoço dia 04/08/26 Ter.").
     * Sem isso, um pedido mandado na véspera entraria no dia errado.
     * Só aceita data perto da mensagem — número solto não vira data.
     */
    public static function serviceDateHint(string $text, string $fallback): string
    {
        if (!preg_match('/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/', $text, $m)) {
            return $fallback;
        }
        $base = strtotime($fallback) ?: time();
        $year = isset($m[3]) && $m[3] !== '' ? (int) $m[3] : (int) date('Y', $base);
        if ($year < 100) {
            $year += 2000;
        }
        $day = (int) $m[1];
        $month = (int) $m[2];
        if (!checkdate($month, $day, $year)) {
            return $fallback;
        }
        $found = sprintf('%04d-%02d-%02d', $year, $month, $day);
        $diff = (strtotime($found) - $base) / 86400;
        return ($diff >= -1 && $diff <= 7) ? $found : $fallback;
    }

    // ---- leitura por regras ----

    /**
     * Lê um bloco. Dois arranjos possíveis:
     *  A) cada linha é um pedido inteiro (a lista numerada da Merli);
     *  B) o bloco todo é UM pedido espalhado em várias linhas (o jeito da Lieu).
     *
     * @return array<int,array>|null null = não entendi, tente a IA
     */
    private static function readBlock(array $lines, array $terms): ?array
    {
        // A) linha a linha — só vale se TODA linha com item do cardápio for lida.
        $rows = [];
        $unread = 0;
        foreach ($lines as $line) {
            $read = self::readText([$line], $terms, false);
            if ($read) {
                $rows[] = $read;
            } elseif (self::mentionsMenu($line, $terms)) {
                $unread++;
            }
        }
        if ($rows && $unread === 0) {
            return $rows;
        }

        // B) o bloco inteiro como um pedido só, com o nome numa linha à parte.
        $read = self::readText($lines, $terms, true);
        return $read ? [$read] : null;
    }

    /**
     * Consome os itens do cardápio do texto; o resto vira o nome.
     *
     * @param bool $nameFromOwnLine procura o nome numa linha sem item de cardápio
     *                              (o nome assinado no fim do pedido)
     */
    private static function readText(array $lines, array $terms, bool $nameFromOwnLine): ?array
    {
        $words = self::tokenize(implode(' ', $lines));
        if (!$words) {
            return null;
        }
        $used = array_fill(0, count($words), false);

        $size = null;
        $proteins = [];
        $sides = [];
        $notes = [];
        $conflict = false;

        foreach ($terms as [$termNorm, $kind, $name]) {
            $termWords = explode(' ', $termNorm);
            $n = count($termWords);
            for ($i = 0; $i + $n <= count($words); $i++) {
                if (!self::matchAt($words, $used, $i, $termWords)) {
                    continue;
                }
                if ($kind === 'sides') {
                    $sides[] = $name;
                } elseif ($kind === 'protein') {
                    $proteins[] = $name;
                } elseif ($kind === 'note') {
                    $notes[] = $name;
                } elseif ($size === null) {
                    $size = $name;
                } elseif ($size !== $name) {
                    $conflict = true; // dois tamanhos no mesmo pedido: quem decide é gente
                }
                for ($k = 0; $k < $n; $k++) {
                    $used[$i + $k] = true;
                }
                $i += $n - 1;
            }
        }

        if ($conflict || ($size === null && !$proteins && !$sides && !$notes)) {
            return null;
        }

        $person = $nameFromOwnLine ? self::nameFromLines($lines, $terms) : null;
        if ($person === null) {
            $person = self::leftover($words, $used);
        }
        if ($person === null && !$nameFromOwnLine) {
            // Lendo linha a linha, sem dono não é pedido — é pedaço de um pedido que
            // continua na linha seguinte ("De carne de panela"). Deixa o bloco inteiro
            // tentar de novo, senão sairiam meias-marmitas sem nome.
            return null;
        }
        if ($person === null && $size === null && !$proteins && !$sides) {
            return null; // só recado solto: cabeçalho, não pedido
        }
        // Com item identificado mas sem dono (a bebida do pedido, por exemplo), a linha
        // vale mais preenchida do que descartada: vira dúvida na revisão já com o item.

        // O modelo guarda UMA proteína por marmita. Quando pedem duas ("carne de
        // panela e omelete"), a segunda entra na observação — sai na etiqueta e no
        // relatório detalhado, mas NÃO baixa estoque pela ficha técnica.
        $obs = array_merge($notes, array_map(
            static fn ($p) => '+ ' . $p,
            array_slice($proteins, 1)
        ));

        return self::row(
            $person,
            $size,
            $proteins[0] ?? null,
            $sides,
            $obs ? implode(' · ', $obs) : null,
            implode(' ', $lines),
            'regras'
        );
    }

    /** Nome assinado numa linha só dele: a última linha que não cita o cardápio. */
    private static function nameFromLines(array $lines, array $terms): ?string
    {
        for ($i = count($lines) - 1; $i >= 0; $i--) {
            if (self::mentionsMenu($lines[$i], $terms)) {
                continue;
            }
            $name = self::leftover(self::tokenize($lines[$i]), []);
            if ($name !== null) {
                return $name;
            }
        }
        return null;
    }

    /** O que sobrou depois de tirar os itens do cardápio e as palavras de cortesia. */
    private static function leftover(array $words, array $used): ?string
    {
        $keep = [];
        foreach ($words as $i => $w) {
            if (!empty($used[$i]) || $w['norm'] === '' || ctype_digit($w['norm'])) {
                continue;
            }
            if (in_array($w['norm'], self::FILLER, true)) {
                continue;
            }
            $keep[] = $w['orig'];
        }
        $name = trim(implode(' ', $keep));
        return $name === '' ? null : mb_substr($name, 0, 150);
    }

    private static function mentionsMenu(string $line, array $terms): bool
    {
        $words = self::tokenize($line);
        $used = array_fill(0, count($words), false);
        foreach ($terms as [$termNorm]) {
            $termWords = explode(' ', $termNorm);
            for ($i = 0; $i + count($termWords) <= count($words); $i++) {
                if (self::matchAt($words, $used, $i, $termWords)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** O termo casa a partir da posição $i? A última palavra tolera gênero/plural. */
    private static function matchAt(array $words, array $used, int $i, array $termWords): bool
    {
        $n = count($termWords);
        if ($i + $n > count($words)) {
            return false;
        }
        for ($k = 0; $k < $n; $k++) {
            if (!empty($used[$i + $k])) {
                return false;
            }
            $word = $words[$i + $k]['norm'];
            $term = $termWords[$k];
            $ok = $k === $n - 1
                ? MarmitexResolver::stem($word) === MarmitexResolver::stem($term)
                : $word === $term;
            if (!$ok) {
                return false;
            }
        }
        return true;
    }

    /**
     * Palavras com a grafia original preservada (o nome sai daqui: "Sílvio", não
     * "silvio"). Pontuação e parênteses viram separador — "Henrique (P):" são três
     * pedaços: nome, tamanho e nada.
     *
     * @return array<int,array{orig:string,norm:string}>
     */
    private static function tokenize(string $text): array
    {
        $parts = preg_split('/[^\p{L}\p{N}]+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $out = [];
        foreach ($parts as $p) {
            $out[] = ['orig' => $p, 'norm' => MarmitexResolver::norm($p)];
        }
        return $out;
    }

    /** Parágrafos: linha em branco separa um pedido do outro. */
    private static function blocks(string $text): array
    {
        return preg_split('/(?:\r?\n)\s*(?:\r?\n)+/', trim($text)) ?: [];
    }

    /** @return string[] */
    private static function lines(string $block): array
    {
        $out = [];
        foreach (preg_split('/\r\n|\r|\n/', $block) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '') {
                $out[] = $line;
            }
        }
        return $out;
    }

    /** "cancela o pedido do Pedro" → linha de cancelamento. */
    private static function asCancel(string $line): ?array
    {
        $norm = MarmitexResolver::norm($line);
        if (!preg_match('/^(' . implode('|', self::CANCEL_VERBS) . ')\b(.*)$/u', $norm, $m)) {
            return null;
        }
        // Descasca os conectivos até sobrar só o nome.
        $who = trim($m[2]);
        while (true) {
            $stripped = trim(preg_replace('/^(o|a|os|as|pedido|marmita|quentinha|d[oae]s?|para|pra|de)\s+/u', '', $who));
            if ($stripped === $who) {
                break;
            }
            $who = $stripped;
        }
        if ($who === '') {
            return null;
        }
        $row = self::row(self::original($line, $who), null, null, [], null, $line, 'regras');
        $row['action'] = 'cancel';
        return $row;
    }

    /** Recupera a grafia original de um trecho achado no texto normalizado. */
    private static function original(string $line, string $normalized): string
    {
        $pos = mb_strpos(MarmitexResolver::norm($line), $normalized);
        if ($pos === false) {
            return $normalized;
        }
        return trim(mb_substr($line, $pos, mb_strlen($normalized))) ?: $normalized;
    }

    /**
     * Termos reconhecíveis (cardápio + apelidos da empresa), dos mais longos para
     * os mais curtos. A ordem importa: casar "frango" antes de "frango grelhado"
     * deixaria "grelhado" sobrando e virando parte do nome.
     *
     * @return array<int,array{0:string,1:string,2:string}> [termo, campo, nome do item]
     */
    private static function terms(array $menu, array $aliases): array
    {
        $field = ['sizes' => 'size', 'proteins' => 'protein', 'sides' => 'sides'];
        $out = [];
        foreach ($field as $type => $kind) {
            foreach ($menu[$type] ?? [] as $norm => $row) {
                $out[] = [$norm, $kind, (string) $row['name']];
            }
            foreach ($aliases[$type] ?? [] as $from => $to) {
                $out[] = [MarmitexResolver::norm((string) $from), $kind, (string) $to];
            }
        }
        // Recados de cozinha ("(P)" = porção pequena): consumidos como qualquer termo,
        // mas o destino é a observação, não um item do cardápio.
        foreach ($aliases['notes'] ?? [] as $from => $to) {
            $out[] = [MarmitexResolver::norm((string) $from), 'note', (string) $to];
        }
        usort($out, static function ($a, $b) {
            $wa = substr_count($a[0], ' ');
            $wb = substr_count($b[0], ' ');
            return $wb <=> $wa ?: mb_strlen($b[0]) <=> mb_strlen($a[0]);
        });
        return $out;
    }

    /** @return array{action:string,person_name:?string,size:?string,protein:?string,sides:string[],observation:?string,raw:string,by:string} */
    private static function row(?string $person, ?string $size, ?string $protein, array $sides, ?string $obs, string $raw, string $by): array
    {
        return [
            'action' => 'add',
            'person_name' => $person,
            'size' => $size,
            'protein' => $protein,
            'sides' => array_values(array_unique($sides)),
            'observation' => $obs,
            'raw' => mb_substr(trim($raw), 0, 500),
            'by' => $by,
        ];
    }

    // ---- plano B: IA ----

    /** @return array{rows:array<int,array>,failed:bool} */
    private static function byAi(array $cfg, array $menu, string $text): array
    {
        $prompt = self::systemPrompt($cfg, $menu);
        $model = (string) Env::get('OLLAMA_MODEL', 'qwen2.5:3b');
        $rows = [];
        $failed = false;
        foreach (self::split($text) as $i => $chunk) {
            try {
                $content = Ollama::chat($model, [
                    ['role' => 'system', 'content' => $prompt],
                    ['role' => 'user', 'content' => "Mensagem do grupo:\n\n{$chunk}"],
                ], self::schema());
                $parsed = json_decode($content, true);
                if (!is_array($parsed)) {
                    throw new HttpError(502, 'A IA local não retornou JSON estruturado válido.');
                }
                foreach (self::normalize($parsed['lines'] ?? null, $chunk) as $row) {
                    $rows[] = $row;
                }
            } catch (\Throwable $e) {
                // Um chunk que falha não pode zerar os demais (regra do AiExtractor).
                $failed = true;
                self::log('chunk ' . ($i + 1) . ' falhou: ' . $e->getMessage());
            }
        }
        return ['rows' => $rows, 'failed' => $failed];
    }

    private static function systemPrompt(array $cfg, array $menu): string
    {
        $names = static fn (array $index): string => implode(' | ', array_map(
            static fn ($r) => (string) $r['name'],
            array_values($index)
        ));

        $lines = [
            // Sem ênfase em caixa alta: modelo pequeno copia a palavra destacada do
            // prompt para dentro do campo (visto na prática: size = "EXCLUSIVAMENTE").
            'Você lê mensagens de WhatsApp de um grupo de empresa pedindo marmitas (Brasil).',
            'Cada marmita pertence a uma pessoa. O nome costuma vir junto do pedido, mas às vezes',
            'aparece sozinho numa linha logo depois dele — nesse caso é o dono daquele pedido.',
            'Sem nome identificável, use person_name null.',
            'Os campos size, protein e sides só aceitam valores destas listas:',
            'size: ' . $names($menu['sizes']),
            'protein: ' . $names($menu['proteins']),
            'sides: ' . $names($menu['sides']),
            'Se pedirem duas proteínas na mesma marmita, ponha a primeira em protein e a outra em observation.',
        ];

        $pairs = [];
        foreach (MarmitexWaIngest::aliases($cfg) as $map) {
            foreach ($map as $from => $to) {
                $pairs[] = "\"{$from}\" = {$to}";
            }
        }
        if ($pairs) {
            $lines[] = 'Abreviações usadas por esta empresa: ' . implode(', ', $pairs) . '.';
        }

        // Modelo pequeno precisa da regra explícita: com o enum solto ele escolhia
        // "cancel" para pedido comum, e todo o dia ia para revisão.
        $lines[] = 'O campo action vale "add" em todo pedido. Use "cancel" apenas se a mensagem pedir para tirar um pedido já feito.';
        $lines[] = 'Uma entrada por pessoa: "duas grandes, uma pro João e outra pro Pedro" são duas entradas.';
        $lines[] = 'Se a mesma pessoa pede mais de uma marmita igual, use quantity.';
        $lines[] = 'Ignore saudação, data e conversa que não seja pedido.';
        $lines[] = 'observation é só para pedido especial ("sem cebola"), nunca para resumir a mensagem.';
        $lines[] = 'Não invente: campo que você não identificar com certeza deve ser null, e sides vazio se não pedirem acompanhamento.';
        $lines[] = 'Copie size, protein e sides com a grafia das listas — não abrevie nem traduza.';

        $extra = trim((string) ($cfg['ai_instructions'] ?? ''));
        if ($extra !== '') {
            $lines[] = $extra;
        }
        $lines[] = 'Responda apenas com o JSON estruturado.';
        return implode("\n", $lines);
    }

    private static function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'lines' => [
                    'type' => 'array',
                    'description' => 'Uma entrada por marmita pedida (ou por cancelamento).',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'action' => ['type' => 'string', 'enum' => ['add', 'cancel']],
                            'person_name' => ['type' => ['string', 'null']],
                            'size' => ['type' => ['string', 'null']],
                            'protein' => ['type' => ['string', 'null']],
                            'sides' => ['type' => 'array', 'items' => ['type' => 'string']],
                            'observation' => ['type' => ['string', 'null']],
                            'quantity' => ['type' => ['integer', 'null']],
                        ],
                        'required' => ['action', 'person_name', 'size', 'protein', 'sides', 'observation', 'quantity'],
                    ],
                ],
            ],
            'required' => ['lines'],
        ];
    }

    /** @return array<int,array> */
    private static function normalize(mixed $raw, string $source = ''): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $maxQty = Env::int('MARMITEX_WA_MAX_QTY', 10);
        $out = [];
        foreach ($raw as $r) {
            if (!is_array($r)) {
                continue;
            }
            $action = ($r['action'] ?? 'add') === 'cancel' ? 'cancel' : 'add';
            $row = self::row(
                self::text($r['person_name'] ?? null, 150),
                self::text($r['size'] ?? null, 80),
                self::text($r['protein'] ?? null, 120),
                self::stringList($r['sides'] ?? null),
                self::text($r['observation'] ?? null, 255),
                // O texto de origem vem de nós, não do modelo: pedir que ele repetisse
                // o trecho só dava mais um campo para errar, e é o que a revisão mostra.
                $source,
                'ia'
            );
            $row['action'] = $action;

            if ($action === 'add' && $row['size'] === null && $row['protein'] === null && $row['person_name'] === null) {
                continue; // ruído
            }
            if ($action === 'cancel' && $row['person_name'] === null) {
                continue;
            }
            // Não existe coluna de quantidade na marmita: 3 marmitas = 3 linhas.
            $qty = isset($r['quantity']) && is_numeric($r['quantity']) ? (int) $r['quantity'] : 1;
            $qty = max(1, min($qty, $maxQty));
            for ($i = 0; $i < ($action === 'cancel' ? 1 : $qty); $i++) {
                $out[] = $row;
            }
        }
        return self::dropAnonymousEchoes($out);
    }

    /**
     * O modelo costuma relatar o mesmo pedido duas vezes: uma linha-resumo sem nome
     * ("duas grandes de frango") e depois a linha de cada pessoa. A sem nome é eco —
     * se existe uma idêntica COM dono, ela dobraria o dia e ainda seguraria tudo na
     * revisão por "sem nome da pessoa".
     *
     * @param array<int,array> $rows
     * @return array<int,array>
     */
    private static function dropAnonymousEchoes(array $rows): array
    {
        $named = [];
        foreach ($rows as $r) {
            if ($r['person_name'] !== null) {
                $named[self::shape($r)] = true;
            }
        }
        if (!$named) {
            return $rows;
        }
        $out = [];
        foreach ($rows as $r) {
            if ($r['person_name'] === null && isset($named[self::shape($r)])) {
                self::log('linha sem nome descartada por repetir um pedido já nomeado');
                continue;
            }
            $out[] = $r;
        }
        return $out;
    }

    /** Identidade do pedido sem o dono — para achar o eco. */
    private static function shape(array $r): string
    {
        $sides = $r['sides'];
        sort($sides);
        return MarmitexResolver::norm((string) $r['size']) . '|'
            . MarmitexResolver::norm((string) $r['protein']) . '|'
            . MarmitexResolver::norm(implode(',', $sides));
    }

    /** Tamanho padrão da empresa para quem só disse a proteína ("João - frango"). */
    private static function applyDefaults(array $rows, array $cfg): array
    {
        $defaultId = isset($cfg['default_size_id']) ? (int) $cfg['default_size_id'] : 0;
        if ($defaultId <= 0) {
            return $rows;
        }
        $size = Db::queryOne('SELECT name FROM marmitex_sizes WHERE id = ? AND active = 1', [$defaultId]);
        if (!$size) {
            return $rows;
        }
        foreach ($rows as &$r) {
            if ($r['action'] === 'add' && $r['size'] === null && $r['by'] !== 'nao-lido') {
                $r['size'] = (string) $size['name'];
            }
        }
        unset($r);
        return $rows;
    }

    /** @return string[] */
    private static function split(string $text): array
    {
        $text = trim($text);
        if ($text === '' || mb_strlen($text) <= self::CHUNK_CHARS) {
            return $text === '' ? [] : [$text];
        }
        $chunks = [];
        $buf = '';
        foreach (preg_split('/\r\n|\r|\n/', $text) as $line) {
            if ($buf !== '' && mb_strlen($buf) + mb_strlen($line) + 1 > self::CHUNK_CHARS) {
                $chunks[] = $buf;
                $buf = '';
            }
            $buf = $buf === '' ? $line : $buf . "\n" . $line;
        }
        if (trim($buf) !== '') {
            $chunks[] = $buf;
        }
        return $chunks;
    }

    private static function text(mixed $v, int $max): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $s = trim($v);
        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    /** @return string[] */
    private static function stringList(mixed $v): array
    {
        if (!is_array($v)) {
            return [];
        }
        $out = [];
        foreach ($v as $s) {
            $t = self::text($s, 120);
            if ($t !== null) {
                $out[] = $t;
            }
        }
        return $out;
    }

    private static function log(string $msg): void
    {
        if (defined('STDERR')) {
            fwrite(STDERR, '[MarmitexWaParser] ' . $msg . "\n");
        }
    }
}
