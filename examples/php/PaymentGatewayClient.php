<?php
declare(strict_types=1);

/**
 * PaymentGatewayClient — wrapper untuk call gateway dari PHP.
 *
 * Drop file ini ke project PHP / Laravel Anda.
 * Pakai cURL (built-in PHP), tidak butuh dependency tambahan.
 *
 * Contoh pakai di Laravel:
 *   $client = new PaymentGatewayClient(env('GATEWAY_URL'));
 *   $tx = $client->charge([...]);
 */
class PaymentGatewayException extends \RuntimeException
{
    public int $statusCode;
    public string $code;
    public mixed $details;

    public function __construct(int $statusCode, string $code, string $message, mixed $details = null)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
        $this->code = $code;
        $this->details = $details;
    }
}

class PaymentGatewayClient
{
    private string $baseUrl;
    private int $timeoutSec;
    private int $maxRetries;

    public function __construct(string $baseUrl, int $timeoutSec = 10, int $maxRetries = 2)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeoutSec = $timeoutSec;
        $this->maxRetries = $maxRetries;
    }

    /**
     * Charge customer.
     * @param array{
     *   orderId: string,
     *   amount: int,
     *   currency: string,
     *   method: string,
     *   customer: array{name: string, email: string, phone?: string},
     *   description?: string
     * } $req
     */
    public function charge(array $req, ?string $idempotencyKey = null): array
    {
        $key = $idempotencyKey ?? ($req['orderId'] . '-' . self::uuid());
        return $this->request('POST', '/api/v1/payments/charge', $req, [
            'Idempotency-Key: ' . $key,
        ]);
    }

    public function getById(string $transactionId): array
    {
        return $this->request('GET', '/api/v1/payments/' . rawurlencode($transactionId));
    }

    public function getByOrderId(string $orderId): array
    {
        return $this->request('GET', '/api/v1/payments?orderId=' . rawurlencode($orderId));
    }

    private function request(string $method, string $path, ?array $body = null, array $extraHeaders = []): array
    {
        $url = $this->baseUrl . $path;
        $lastError = null;

        for ($attempt = 0; $attempt <= $this->maxRetries; $attempt++) {
            try {
                return $this->doRequest($method, $url, $body, $extraHeaders);
            } catch (PaymentGatewayException $e) {
                $lastError = $e;
                $isLast = $attempt === $this->maxRetries;
                $retriable = $e->statusCode >= 500;
                if ($isLast || !$retriable) break;
            } catch (\Throwable $e) {
                // Network / timeout — selalu retriable
                $lastError = $e;
                if ($attempt === $this->maxRetries) break;
            }
            $delayMs = 200 * (2 ** $attempt) + random_int(0, 100);
            usleep($delayMs * 1000);
        }
        throw $lastError;
    }

    private function doRequest(string $method, string $url, ?array $body, array $extraHeaders): array
    {
        $ch = curl_init($url);
        $headers = array_merge(['Content-Type: application/json', 'Accept: application/json'], $extraHeaders);

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSec,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }

        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException("Gateway request failed: $err");
        }
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($data)) $data = [];

        if ($statusCode < 200 || $statusCode >= 300) {
            throw new PaymentGatewayException(
                $statusCode,
                $data['error'] ?? 'REQUEST_FAILED',
                $data['message'] ?? "HTTP $statusCode",
                $data['details'] ?? null,
            );
        }
        return $data['data'] ?? [];
    }

    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
