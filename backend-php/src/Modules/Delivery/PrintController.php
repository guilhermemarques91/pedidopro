<?php

namespace App\Modules\Delivery;

use App\Core\Env;
use App\Core\Request;

/**
 * Assinatura de requisições do QZ Tray (impressão térmica silenciosa no navegador).
 *
 * O QZ Tray só imprime SEM diálogo de permissão quando o site assina cada requisição
 * com uma chave privada cujo certificado público o QZ reconhece. Fluxo:
 *   - cert(): devolve o certificado público (texto) que o frontend registra via
 *     qz.security.setCertificatePromise.
 *   - sign(): assina a string enviada pelo QZ (qz.security.setSignaturePromise) com a
 *     chave privada (RSA-SHA512) e devolve a assinatura em base64.
 *
 * Chave/cert ficam FORA do repositório, em caminhos de .env (QZ_PRIVATE_KEY_PATH /
 * QZ_CERT_PATH). Se não configurados, os endpoints respondem vazio e o QZ cai no modo
 * não-assinado (pede confirmação a cada job) — degradação segura, sem quebrar.
 *
 * Gerar o par (uma vez), conforme a doc do QZ Tray:
 *   openssl req -x509 -newkey rsa:2048 -keyout private-key.pem -out digital-certificate.txt \
 *     -days 3650 -nodes -subj "/CN=PedidoPro"
 */
final class PrintController
{
    /** GET /delivery/print/cert — certificado público (text/plain). */
    public static function cert(Request $req): void
    {
        $path = Env::get('QZ_CERT_PATH');
        $cert = ($path && is_readable($path)) ? (string) file_get_contents($path) : '';
        self::text($cert);
    }

    /** POST /delivery/print/sign — assina a requisição do QZ (base64, text/plain). */
    public static function sign(Request $req): void
    {
        $toSign = $req->input()->string('request') ?? '';
        $keyPath = Env::get('QZ_PRIVATE_KEY_PATH');
        if ($toSign === '' || !$keyPath || !is_readable($keyPath)) {
            self::text(''); // sem chave → QZ opera não-assinado (com prompt)
        }

        $key = openssl_pkey_get_private((string) file_get_contents($keyPath));
        $signature = '';
        if ($key !== false && openssl_sign($toSign, $signature, $key, OPENSSL_ALGO_SHA512)) {
            self::text(base64_encode($signature));
        }
        self::text('');
    }

    /** Resposta de texto cru (o QZ espera cert/assinatura sem envelope JSON). */
    private static function text(string $body): never
    {
        header('Content-Type: text/plain; charset=utf-8');
        echo $body;
        exit;
    }
}
