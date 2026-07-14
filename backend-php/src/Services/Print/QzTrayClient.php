<?php

namespace App\Services\Print;

use WebSocket\Client;

/**
 * Cliente mínimo (PHP puro) do protocolo do QZ Tray, para imprimir sem navegador —
 * usado pelo poller local (bin/poll.php --loop) pra imprimir comandas mesmo com o
 * painel fechado. Reimplementa só o necessário do qz-tray.js (conectar, enviar o
 * certificado, assinar e enviar chamadas 'call').
 *
 * Protocolo (raro documentado fora do JS oficial, mapeado a partir do qz-tray.js):
 *   - Conecta em ws://localhost:8182 (canal não-criptografado; QZ roda só localhost).
 *   - 1ª mensagem: {"certificate": "<PEM>"} — identifica o site/app pro QZ (permite
 *     que o usuário confie uma vez e nunca mais precise clicar "Allow").
 *   - Cada chamada: {call, params, timestamp, uid, signature, signAlgorithm}.
 *     A assinatura é: sha256(json_stringify({call,params,timestamp})) → hex →
 *     assina esse hex com a chave privada (RSA-SHA512) → base64.
 *   - Resposta: {uid, result} em sucesso ou {uid, error} em falha.
 */
final class QzTrayClient
{
    private Client $ws;
    private string $cert;
    private string $privateKeyPem;

    public function __construct(
        private readonly string $host = '127.0.0.1',
        private readonly int $port = 8182,
        ?string $certPem = null,
        ?string $privateKeyPem = null,
    ) {
        $this->cert = $certPem ?? '';
        $this->privateKeyPem = $privateKeyPem ?? '';
    }

    public function connect(): void
    {
        // Timeout generoso: a 1ª chamada numa conexão "fria" do QZ Tray pode demorar
        // vários segundos (renderiza o HTML/inicializa o driver da impressora) — um
        // timeout curto faz o cliente desistir achando que falhou e reenviar o job,
        // duplicando a impressão mesmo o 1º comando tendo chegado e impresso normalmente.
        $this->ws = new Client("ws://{$this->host}:{$this->port}/", ['timeout' => 25]);
        if ($this->cert !== '') {
            $this->ws->text(json_encode(['certificate' => $this->cert], JSON_UNESCAPED_SLASHES));
        }
    }

    public function close(): void
    {
        try {
            $this->ws->close();
        } catch (\Throwable) {
            // já fechado/perdido — ignora
        }
    }

    /** Chama um método do QZ (ex.: 'printers.find', 'print') e espera a resposta correspondente. */
    public function call(string $callName, array $params = []): mixed
    {
        $uid = substr(bin2hex(random_bytes(6)), 0, 10);
        $timestamp = (int) (microtime(true) * 1000);
        $signObj = ['call' => $callName, 'params' => $params, 'timestamp' => $timestamp];
        $toSign = json_encode($signObj, JSON_UNESCAPED_SLASHES);
        $hash = hash('sha256', (string) $toSign);

        $signature = '';
        if ($this->privateKeyPem !== '') {
            $key = openssl_pkey_get_private($this->privateKeyPem);
            if ($key !== false && openssl_sign($hash, $sig, $key, OPENSSL_ALGO_SHA512)) {
                $signature = base64_encode($sig);
            }
        }

        $message = [
            'call' => $callName,
            'params' => $params,
            'timestamp' => $timestamp,
            'uid' => $uid,
            'signature' => $signature,
            'signAlgorithm' => 'SHA512',
        ];
        $this->ws->text((string) json_encode($message, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        // Lê mensagens até achar a resposta com o mesmo uid (ignora eventos de stream sem uid).
        $deadline = microtime(true) + 25;
        while (microtime(true) < $deadline) {
            $raw = $this->ws->receive();
            if ($raw === null || $raw === '') {
                continue;
            }
            $data = json_decode((string) $raw, true);
            if (!is_array($data) || !isset($data['uid']) || $data['uid'] !== $uid) {
                continue;
            }
            if (array_key_exists('error', $data) && $data['error'] !== null) {
                throw new \RuntimeException("QZ Tray erro em '{$callName}': " . (string) $data['error']);
            }
            return $data['result'] ?? null;
        }
        throw new \RuntimeException("QZ Tray: timeout esperando resposta de '{$callName}'");
    }

    /** Lista os nomes das impressoras do SO conhecidas pelo QZ Tray. */
    public function findPrinters(): array
    {
        $result = $this->call('printers.find');
        if (is_string($result)) {
            return [$result];
        }
        return is_array($result) ? array_values(array_map('strval', $result)) : [];
    }

    /** Imprime HTML (modo pixel) numa impressora nomeada, largura em mm igual ao print.ts do frontend. */
    public function printHtml(string $printerName, string $html, float $widthMm): void
    {
        $params = [
            'printer' => ['name' => $printerName],
            'options' => [
                'bounds' => null,
                'colorType' => 'color',
                'copies' => 1,
                'density' => 0,
                'duplex' => false,
                'fallbackDensity' => null,
                'interpolation' => 'bicubic',
                'jobName' => null,
                'legacy' => false,
                'margins' => 0,
                'orientation' => null,
                'paperThickness' => null,
                'printerTray' => null,
                'rasterize' => false,
                'rotation' => 0,
                'scaleContent' => true,
                'size' => ['width' => $widthMm, 'height' => 3000],
                'units' => 'mm',
                'forceRaw' => false,
                'encoding' => null,
                'spool' => null,
            ],
            'data' => [
                ['type' => 'pixel', 'format' => 'html', 'flavor' => 'plain', 'data' => $html],
            ],
        ];
        $this->call('print', $params);
    }
}
