<?php

namespace App\Modules\Marmitex;

use App\Core\Db;

/**
 * Texto livre → itens do cardápio. É o único lugar do sistema que decide o que
 * "G frango" quer dizer, e vale tanto para a planilha (.xlsx) quanto para as
 * mensagens do WhatsApp.
 *
 * Ponto importante do desenho: a IA NUNCA escolhe o id de um item. Ela devolve
 * texto e é aqui — determinístico, contra o cardápio EFETIVO da empresa (contrato
 * aplicado) — que o texto vira id. Assim uma alucinação vira linha duvidosa para
 * revisão, nunca uma marmita errada na produção.
 *
 * Ordem de casamento por campo: apelido da empresa → nome exato (sem acento/caixa)
 * → semelhança. Os dois primeiros são confiáveis; o terceiro entra como `fuzzy`
 * para a tela destacar em âmbar.
 */
final class MarmitexResolver
{
    /** Abaixo disso a semelhança não é palpite bom o bastante: vira dúvida. */
    private const FUZZY_MIN = 86.0;

    /**
     * Cardápio EFETIVO indexado por nome normalizado.
     *
     * @return array{sizes:array<string,array>,proteins:array<string,array>,sides:array<string,array>,observations:array<string,array>}
     */
    public static function menu(?int $companyId): array
    {
        $lists = [
            'sizes' => Db::query('SELECT id, name, price FROM marmitex_sizes WHERE active = 1 ORDER BY sort_order, name'),
            'proteins' => Db::query('SELECT id, name FROM marmitex_proteins WHERE active = 1 ORDER BY sort_order, name'),
            'sides' => Db::query('SELECT id, name FROM marmitex_sides WHERE active = 1 ORDER BY sort_order, name'),
            'observations' => Db::query('SELECT id, name FROM marmitex_observations WHERE active = 1 ORDER BY sort_order, name'),
        ];
        if ($companyId !== null) {
            $lists = MarmitexContract::apply($lists, $companyId);
        }
        $out = [];
        foreach ($lists as $type => $rows) {
            $out[$type] = [];
            foreach ($rows as $r) {
                $out[$type][self::norm((string) $r['name'])] = $r;
            }
        }
        return $out;
    }

    /**
     * Resolve linhas de texto livre em linhas prontas para o pedido.
     *
     * @param array<int,array{person_name?:?string,size?:?string,protein?:?string,sides?:string|array,observation?:?string}> $rows
     * @param array<string,array<string,string>> $aliases apelidos da empresa: ['sizes'=>['g'=>'Grande'], 'proteins'=>[...], ...]
     * @return array<int,array{person_name:?string,size_id:?int,protein_id:?int,side_ids:int[],observation:?string,issues:string[],fuzzy:bool}>
     */
    public static function resolve(array $rows, ?int $companyId = null, array $aliases = []): array
    {
        $menu = self::menu($companyId);
        $out = [];
        foreach ($rows as $row) {
            $issues = [];
            $fuzzy = false;

            $sizeName = self::clean($row['size'] ?? null);
            $sizeId = null;
            if ($sizeName === '') {
                $issues[] = 'tamanho vazio';
            } else {
                $hit = self::match($sizeName, $menu['sizes'], $aliases['sizes'] ?? []);
                if ($hit) {
                    $sizeId = (int) $hit['row']['id'];
                    $fuzzy = $fuzzy || $hit['fuzzy'];
                } else {
                    $issues[] = "tamanho \"{$sizeName}\" não existe no cardápio";
                }
            }

            $proteinName = self::clean($row['protein'] ?? null);
            $proteinId = null;
            if ($proteinName !== '') {
                $hit = self::match($proteinName, $menu['proteins'], $aliases['proteins'] ?? []);
                if ($hit) {
                    $proteinId = (int) $hit['row']['id'];
                    $fuzzy = $fuzzy || $hit['fuzzy'];
                } else {
                    $issues[] = "proteína \"{$proteinName}\" não existe no cardápio";
                }
            }

            $sideIds = [];
            foreach (self::sideNames($row['sides'] ?? null) as $name) {
                $hit = self::match($name, $menu['sides'], $aliases['sides'] ?? []);
                if ($hit) {
                    $sideIds[] = (int) $hit['row']['id'];
                    $fuzzy = $fuzzy || $hit['fuzzy'];
                } else {
                    $issues[] = "acompanhamento \"{$name}\" não existe no cardápio";
                }
            }

            $person = self::clean($row['person_name'] ?? null);
            $obs = self::clean($row['observation'] ?? null);

            $out[] = [
                'person_name' => $person !== '' ? $person : null,
                'size_id' => $sizeId,
                'protein_id' => $proteinId,
                'side_ids' => array_values(array_unique($sideIds)),
                'observation' => $obs !== '' ? mb_substr($obs, 0, 255) : null,
                'issues' => $issues,
                'fuzzy' => $fuzzy,
            ];
        }
        return $out;
    }

    /**
     * Casa um texto contra um índice do cardápio.
     *
     * @param array<string,array> $index nome normalizado => linha
     * @param array<string,string> $alias apelido (bruto) => nome do item
     * @return array{row:array,fuzzy:bool}|null
     */
    private static function match(string $text, array $index, array $alias = []): ?array
    {
        $norm = self::norm($text);
        if ($norm === '') {
            return null;
        }

        // 1) Apelido da empresa ("g" → "Grande"). Ganha de tudo: é a regra explícita.
        $aliasIndex = [];
        foreach ($alias as $from => $to) {
            $aliasIndex[self::norm((string) $from)] = self::norm((string) $to);
        }
        if (isset($aliasIndex[$norm], $index[$aliasIndex[$norm]])) {
            return ['row' => $index[$aliasIndex[$norm]], 'fuzzy' => false];
        }

        // 2) Nome exato (sem acento/caixa).
        if (isset($index[$norm])) {
            return ['row' => $index[$norm], 'fuzzy' => false];
        }

        // 3) Concordância de gênero/número. Ninguém escreve "uma marmita Médio":
        // escrevem "média". O cardápio guarda um dos dois, a empresa usa o outro.
        // Comparar sem a vogal final resolve isso com certeza — não é palpite.
        $stem = self::stem($norm);
        foreach ($index as $key => $row) {
            if (self::stem($key) === $stem) {
                return ['row' => $row, 'fuzzy' => false];
            }
        }

        // 4) Semelhança — cobre erro de digitação.
        $best = null;
        $bestScore = 0.0;
        foreach ($index as $key => $row) {
            similar_text($norm, $key, $percent);
            if ($percent > $bestScore) {
                $bestScore = $percent;
                $best = $row;
            }
        }
        return $bestScore >= self::FUZZY_MIN && $best ? ['row' => $best, 'fuzzy' => true] : null;
    }

    /** Aceita array de nomes ou string separada por vírgula/ponto e vírgula. @return string[] */
    private static function sideNames(mixed $raw): array
    {
        $parts = is_array($raw) ? $raw : preg_split('/[,;]/', (string) $raw);
        $out = [];
        foreach ($parts ?: [] as $p) {
            $name = trim((string) $p);
            if ($name !== '') {
                $out[] = $name;
            }
        }
        return $out;
    }

    private static function clean(mixed $v): string
    {
        return $v === null ? '' : trim((string) $v);
    }

    /**
     * Radical para comparação tolerante a gênero/número: "médio"/"média"/"médias"
     * viram "medi". Só corta a terminação — não é aproximação, é a mesma palavra.
     */
    public static function stem(string $s): string
    {
        return preg_replace('/[oa]s?$|s$/u', '', self::norm($s));
    }

    /** Baixa caixa, remove acentos e espaços extras — para casar nomes com tolerância. */
    public static function norm(string $s): string
    {
        $s = trim(mb_strtolower($s));
        $map = [
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ç' => 'c',
        ];
        $s = strtr($s, $map);
        return preg_replace('/\s+/', ' ', $s);
    }
}
