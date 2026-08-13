<?php

namespace App\Services;

use App\Core\HttpError;

/**
 * Parser de XML de NF-e (modelo 55, layout 4.00). Aceita tanto o <nfeProc>
 * (nota processada, o arquivo que o fornecedor envia) quanto <NFe> puro.
 * Extrai o que interessa à entrada de estoque: emitente, número/chave/data,
 * itens (código, código de barras, nome, NCM, unidade, quantidade, valor
 * unitário) e total.
 */
final class NfeParser
{
    /** @return array{key:string,number:string,issued_at:?string,supplier:array,dest_cnpj:?string,total:?float,items:array} */
    public static function parse(string $xml): array
    {
        $prev = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($xml);
        libxml_use_internal_errors($prev);
        if ($doc === false) {
            throw HttpError::badRequest('Arquivo não é um XML válido');
        }
        // nfeProc > NFe > infNFe  |  NFe > infNFe
        $doc->registerXPathNamespace('n', 'http://www.portalfiscal.inf.br/nfe');
        $inf = $doc->xpath('//n:NFe/n:infNFe')[0] ?? $doc->xpath('//NFe/infNFe')[0] ?? null;
        if ($inf === null) {
            throw HttpError::badRequest('XML não parece ser uma NF-e (infNFe não encontrado)');
        }

        $key = preg_replace('/^NFe/', '', (string) $inf['Id']) ?: '';
        if (strlen($key) !== 44) {
            throw HttpError::badRequest('Chave de acesso da NF-e inválida no XML');
        }
        $ide = $inf->ide;
        $emit = $inf->emit;
        $issued = (string) ($ide->dhEmi ?? $ide->dEmi ?? '');

        $items = [];
        foreach ($inf->det as $det) {
            $p = $det->prod;
            $qty = (float) $p->qCom;
            $items[] = [
                'code' => (string) $p->cProd,
                // Código de barras do item. Emitente que não tem GTIN manda a
                // literal "SEM GTIN" — tratar como ausente, senão viraria um
                // "código" que casa qualquer produto com qualquer outro.
                'ean' => self::gtin($p->cEAN ?? null) ?? self::gtin($p->cEANTrib ?? null),
                'name' => trim((string) $p->xProd),
                'ncm' => (string) $p->NCM,
                'unit' => strtolower(trim((string) $p->uCom)) ?: 'un',
                'quantity' => $qty,
                'unit_price' => (float) $p->vUnCom,
                'total' => (float) $p->vProd,
            ];
        }
        if (!$items) {
            throw HttpError::badRequest('NF-e sem itens');
        }

        return [
            'key' => $key,
            'number' => (string) $ide->nNF,
            'issued_at' => $issued !== '' ? substr(str_replace('T', ' ', $issued), 0, 19) : null,
            'supplier' => [
                'cnpj' => (string) ($emit->CNPJ ?? $emit->CPF ?? ''),
                'name' => trim((string) $emit->xNome),
                'fantasia' => trim((string) ($emit->xFant ?? '')),
            ],
            'dest_cnpj' => (string) ($inf->dest->CNPJ ?? ''),
            'total' => isset($inf->total->ICMSTot->vNF) ? (float) $inf->total->ICMSTot->vNF : null,
            'items' => $items,
        ];
    }

    /** GTIN só vale se for numérico de 8/12/13/14 dígitos; "SEM GTIN" e afins viram null. */
    private static function gtin(mixed $raw): ?string
    {
        $v = trim((string) $raw);
        return (ctype_digit($v) && in_array(strlen($v), [8, 12, 13, 14], true)) ? $v : null;
    }
}
