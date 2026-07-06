<?php

namespace App\Services;

use App\Core\HttpError;

/**
 * Parser de XML de NF-e (modelo 55, layout 4.00). Aceita tanto o <nfeProc>
 * (nota processada, o arquivo que o fornecedor envia) quanto <NFe> puro.
 * Extrai o que interessa à entrada de estoque: emitente, número/chave/data,
 * itens (código, nome, NCM, unidade, quantidade, valor unitário) e total.
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
}
