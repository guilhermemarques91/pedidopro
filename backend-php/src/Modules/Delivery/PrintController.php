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
 * Chave/cert ficam FORA do repositório. Duas formas (o .env é o jeito fácil em
 * hospedagem compartilhada — sem subir arquivo nem caçar caminho absoluto):
 *   - QZ_CERT_B64 / QZ_PRIVATE_KEY_B64: conteúdo do PEM em base64 (uma linha cada).
 *   - QZ_CERT_PATH / QZ_PRIVATE_KEY_PATH: caminho de arquivo no servidor.
 * Se nada configurado, os endpoints respondem vazio e o QZ cai no modo não-assinado
 * (pede confirmação a cada job, sem "lembrar") — degradação segura, sem quebrar.
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
        self::text(self::readSource('QZ_CERT_B64', 'QZ_CERT_PATH') ?? '');
    }

    /** POST /delivery/print/sign — assina a requisição do QZ (base64, text/plain). */
    public static function sign(Request $req): void
    {
        $toSign = $req->input()->string('request') ?? '';
        $keyPem = self::readSource('QZ_PRIVATE_KEY_B64', 'QZ_PRIVATE_KEY_PATH');
        if ($toSign === '' || $keyPem === null) {
            self::text(''); // sem chave → QZ opera não-assinado (com prompt)
        }

        $key = openssl_pkey_get_private((string) $keyPem);
        $signature = '';
        if ($key !== false && openssl_sign($toSign, $signature, $key, OPENSSL_ALGO_SHA512)) {
            self::text(base64_encode($signature));
        }
        self::text('');
    }

    /** Lê um PEM do .env: base64 (uma linha) OU caminho de arquivo. Null se ausente. */
    private static function readSource(string $b64Key, string $pathKey): ?string
    {
        $b64 = Env::get($b64Key);
        if ($b64) {
            $decoded = base64_decode(trim($b64), true);
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }
        $path = Env::get($pathKey);
        if ($path && is_readable($path)) {
            return (string) file_get_contents($path);
        }
        return null;
    }

    /** Resposta de texto cru (o QZ espera cert/assinatura sem envelope JSON). */
    private static function text(string $body): never
    {
        header('Content-Type: text/plain; charset=utf-8');
        echo $body;
        exit;
    }
}
