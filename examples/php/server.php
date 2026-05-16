<?php
declare(strict_types=1);

/**
 * Sample PHP app yang call ke Payment Gateway.
 * Jalankan: php -S localhost:4001 server.php
 *
 * Untuk Laravel: pindahkan logic di sini ke Controller, dan
 * register `PaymentGatewayClient` di service container (AppServiceProvider).
 */

require_once __DIR__ . '/PaymentGatewayClient.php';

$gatewayUrl = getenv('GATEWAY_URL') ?: 'http://localhost:3000';
$gateway = new PaymentGatewayClient($gatewayUrl);

// In-memory order store (file-based untuk demo persisten antar request)
$orderFile = sys_get_temp_dir() . '/php-example-orders.json';
function loadOrders(string $file): array {
    return file_exists($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
}
function saveOrders(string $file, array $orders): void {
    file_put_contents($file, json_encode($orders, JSON_PRETTY_PRINT));
}

$PRODUCTS = [
    'P001' => ['name' => 'Kopi Susu Premium', 'price' => 25000],
    'P002' => ['name' => 'Roti Bakar', 'price' => 15000],
    'P003' => ['name' => 'Paket Hemat', 'price' => 50000],
];

function jsonResponse(int $status, array $data): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function jsonInput(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// === ROUTING ===
if ($method === 'GET' && $path === '/') {
    jsonResponse(200, [
        'message' => 'Sample PHP app integrated with Payment Gateway',
        'endpoints' => [
            'POST /checkout' => 'buat order baru',
            'GET /orders/{txId}' => 'cek status order',
            'GET /products' => 'list produk',
        ],
    ]);
}

if ($method === 'GET' && $path === '/products') {
    jsonResponse(200, ['data' => $PRODUCTS]);
}

if ($method === 'POST' && $path === '/checkout') {
    $body = jsonInput();
    $productId = $body['productId'] ?? null;
    $customerName = $body['customerName'] ?? null;
    $customerEmail = $body['customerEmail'] ?? null;

    if (!$productId || !isset($PRODUCTS[$productId])) {
        jsonResponse(400, ['error' => 'Product not found']);
    }
    if (!$customerName || !$customerEmail) {
        jsonResponse(400, ['error' => 'customerName and customerEmail required']);
    }

    $product = $PRODUCTS[$productId];
    $orderId = sprintf('ORD-%d-%s', time(), strtoupper(bin2hex(random_bytes(2))));

    try {
        $tx = $gateway->charge([
            'orderId' => $orderId,
            'amount' => $product['price'],
            'currency' => 'IDR',
            'method' => 'qris',
            'customer' => ['name' => $customerName, 'email' => $customerEmail],
            'description' => "Pembelian {$product['name']}",
        ]);

        $orders = loadOrders($orderFile);
        $orders[$tx['id']] = [
            'orderId' => $orderId,
            'productId' => $productId,
            'product' => $product,
            'customer' => ['name' => $customerName, 'email' => $customerEmail],
            'gatewayTxId' => $tx['id'],
            'createdAt' => date('c'),
        ];
        saveOrders($orderFile, $orders);

        jsonResponse(201, [
            'orderId' => $orderId,
            'transactionId' => $tx['id'],
            'amount' => $tx['amount'],
            'status' => $tx['status'],
            'paymentUrl' => $tx['paymentUrl'] ?? null,
            'providerUsed' => $tx['providerName'],
        ]);
    } catch (PaymentGatewayException $e) {
        error_log("[gateway error] {$e->code}: {$e->getMessage()}");
        if ($e->code === 'ALL_PROVIDERS_FAILED') {
            jsonResponse(503, [
                'error' => 'PAYMENT_UNAVAILABLE',
                'message' => 'Sistem pembayaran sedang tidak tersedia. Silakan coba lagi nanti.',
            ]);
        }
        jsonResponse($e->statusCode, ['error' => $e->code, 'message' => $e->getMessage()]);
    } catch (\Throwable $e) {
        error_log('[unexpected] ' . $e->getMessage());
        jsonResponse(500, ['error' => 'INTERNAL_ERROR', 'message' => $e->getMessage()]);
    }
}

if ($method === 'GET' && preg_match('#^/orders/([^/]+)$#', $path, $m)) {
    $txId = $m[1];
    $orders = loadOrders($orderFile);
    $local = $orders[$txId] ?? null;
    if (!$local) jsonResponse(404, ['error' => 'Order not found']);

    try {
        $tx = $gateway->getById($txId);
        jsonResponse(200, [
            'order' => $local,
            'payment' => [
                'status' => $tx['status'],
                'provider' => $tx['providerName'],
                'attempts' => $tx['attempts'] ?? [],
                'updatedAt' => $tx['updatedAt'],
            ],
        ]);
    } catch (\Throwable $e) {
        jsonResponse(502, ['error' => 'GATEWAY_UNAVAILABLE', 'message' => 'Tidak bisa cek status saat ini']);
    }
}

jsonResponse(404, ['error' => 'NOT_FOUND', 'message' => "Route $method $path not found"]);
