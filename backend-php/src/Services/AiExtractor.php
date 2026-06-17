<?php

namespace App\Services;

use App\Core\Env;
use App\Core\HttpError;

/**
 * Extração de preços por IA (Ollama local via tunnel). Caminho de texto é o
 * principal (mensagens de WhatsApp / orçamentos colados / PDF com texto).
 * Visão exige OLLAMA_VISION_MODEL; sem ele, PDFs escaneados/imagens dão 422.
 */
final class AiExtractor
{
    private const SYSTEM_PROMPT =
        'Você extrai preços de cotações de fornecedores brasileiros (mensagens de WhatsApp, ' .
        'orçamentos, tabelas de preço, fotos de listas). Os preços estão em reais (R$), ' .
        'geralmente com vírgula decimal — converta para número com ponto (ex: "12,90" → 12.90). ' .
        'Extraia TODOS os itens com preço que conseguir identificar. Não invente itens nem preços: ' .
        'se um preço não estiver legível/presente, use null. Responda apenas com o JSON estruturado.';

    private static function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'items' => [
                    'type' => 'array',
                    'description' => 'Cada produto/insumo encontrado com seu preço.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'name' => ['type' => 'string'],
                            'unit' => ['type' => 'string'],
                            'price' => ['type' => ['number', 'null']],
                            'quantity' => ['type' => ['number', 'null']],
                            'notes' => ['type' => ['string', 'null']],
                        ],
                        'required' => ['name', 'unit', 'price', 'quantity', 'notes'],
                    ],
                ],
            ],
            'required' => ['items'],
        ];
    }

    /** @return array<int,array{name:string,unit:string,price:?float,quantity:?float,notes:?string}> */
    public static function fromText(string $text): array
    {
        $model = Env::get('OLLAMA_MODEL', 'qwen2.5:3b');
        $content = Ollama::chat($model, [
            ['role' => 'system', 'content' => self::SYSTEM_PROMPT],
            ['role' => 'user', 'content' => "Extraia os itens e preços do texto a seguir:\n\n{$text}"],
        ], self::schema());

        $parsed = json_decode($content, true);
        if (!is_array($parsed)) {
            throw new HttpError(502, 'A IA local não retornou JSON estruturado válido.');
        }
        return self::normalize($parsed['items'] ?? null);
    }

    /** @return array<int,array{name:string,unit:string,price:?float,quantity:?float,notes:?string}> */
    public static function fromDocument(string $binary, string $mediaType): array
    {
        if ($mediaType === 'application/pdf') {
            $text = Pdf::extractText($binary);
            if (mb_strlen(trim($text)) >= 20) {
                return self::fromText($text);
            }
            throw HttpError::unprocessable(
                'PDF sem texto extraível (provavelmente escaneado). Cole o conteúdo como texto.'
            );
        }
        // Imagens exigem modelo de visão (não disponível por padrão no Ollama via tunnel).
        throw HttpError::unprocessable(
            'Extração de imagem requer um modelo de visão. Envie o orçamento como texto.'
        );
    }

    /** Normaliza a lista crua da IA. */
    private static function normalize(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $r) {
            if (!is_array($r) || !isset($r['name']) || !is_string($r['name']) || trim($r['name']) === '') {
                continue;
            }
            $price = $r['price'] ?? null;
            $qty = $r['quantity'] ?? null;
            $notes = $r['notes'] ?? null;
            $out[] = [
                'name' => trim($r['name']),
                'unit' => (isset($r['unit']) && is_string($r['unit']) && trim($r['unit']) !== '') ? trim($r['unit']) : 'un',
                'price' => is_numeric($price) ? (float) $price : null,
                'quantity' => is_numeric($qty) ? (float) $qty : null,
                'notes' => (is_string($notes) && trim($notes) !== '') ? trim($notes) : null,
            ];
        }
        return $out;
    }
}
