<?php

error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', 1);


$action = $_GET['action'] ?? null;

if (!$action) {
    header("Content-Type: text/html; charset=UTF-8");
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sky Gateway - API Docs</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Plus Jakarta Sans', sans-serif; }
            .mono { font-family: 'JetBrains Mono', monospace; }
            .glass-effect {
                background: rgba(255, 255, 255, 0.8);
                backdrop-filter: blur(12px);
                border-bottom: 1px solid rgba(226, 232, 240, 0.8);
            }
            .api-card {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                border: 1.5px solid #f1f5f9;
            }
            .api-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05);
            }
            .input-box {
                transition: all 0.2s;
                border: 1.5px solid #f1f5f9;
                background: #f8fafc;
            }
            .input-box:focus {
                background: #fff;
                border-color: #6366f1;
                box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
                outline: none;
            }
            .endpoint-display {
                background: #0f172a;
                color: #94a3b8;
                padding: 0.75rem 1rem;
                border-radius: 12px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.7rem;
                display: flex;
                align-items: center;
                overflow-x: auto;
            }
            .endpoint-display b { color: #f8fafc; font-weight: 500; }
            .result-container {
                display: none;
                background: #020617;
                border-radius: 12px;
                margin-top: 1rem;
                padding: 1rem;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.75rem;
                color: #10b981;
                max-height: 300px;
                overflow-y: auto;
                border: 1px solid #1e293b;
            }
            /* Custom Scrollbar */
            ::-webkit-scrollbar-track { background: transparent; }
        </style>
    </head>
    <body class="bg-white text-slate-900 selection:bg-indigo-100 selection:text-indigo-700">

        <nav class="glass-effect fixed top-0 w-full z-50">
            <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-sm shadow-indigo-200">
                        <i class="fa-solid fa-bolt-lightning text-white"></i>
                    </div>
                    <div>
                        <span class="text-xl font-bold tracking-tight">Sky Gateway</span>
                        <p class="text-xs text-slate-600 font-medium">Orderkuota API KahfiModTzy</p>
                    </div>
                </div>
                <div class="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
                    <a href="#" class="hover:text-indigo-600 transition">Documentation</a>
                    <a href="#" class="hover:text-indigo-600 transition">API Reference</a>
                    <div class="h-4 w-[1px] bg-slate-200"></div>
                    <span class="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full text-xs">
                        <span class="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></span>
                        System Operational
                    </span>
                </div>
            </div>
        </nav>

        <main class="max-w-7xl mx-auto px-6 pt-28 pb-16">

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <div class="api-card bg-white rounded-3xl p-8">
                    <div class="flex items-center justify-between mb-8">
                        <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                            <i class="fa-solid fa-qrcode text-xl"></i>
                        </div>
                        <span class="text-xs font-bold px-3 py-1 bg-slate-100 rounded-lg text-slate-600">Action: createpayment</span>
                    </div>
                    
                    <div class="mb-6">
                        <h3 class="text-lg font-bold mb-1">Create QRIS Payment</h3>
                        <p class="text-sm text-slate-600 mb-4">Generate link gambar QRIS dinamis secara real-time.</p>
                        <div class="endpoint-display">
                            <span class="shrink-0 mr-2 text-indigo-400 font-bold text-[10px]">GET</span>
                            <span id="urlCreate" class="truncate">loading...</span>
                            <button onclick="copyUrl('urlCreate')" class="ml-auto hover:text-white transition"><i class="fa-regular fa-copy"></i></button>
                        </div>
                    </div>

                    <form id="formCreate" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="col-span-2">
                                <label class="text-[11px] font-bold text-slate-600 ml-1">API Key</label>
                                <input type="text" id="keyCreate" placeholder="••••••••••••" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Username</label>
                                <input type="text" id="userCreate" placeholder="Username" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Amount</label>
                                <input type="number" id="amtCreate" placeholder="e.g. 10000" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div class="col-span-2">
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Auth Token</label>
                                <input type="text" id="tokenCreate" placeholder="Token" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-slate-900 text-white font-semibold py-3.5 rounded-xl hover:bg-indigo-600 transition shadow-lg shadow-slate-200">Execute Request</button>
                    </form>
                    <pre id="resCreate" class="result-container"></pre>
                </div>

                <div class="api-card bg-white rounded-3xl p-8">
                    <div class="flex items-center justify-between mb-8">
                        <div class="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                            <i class="fa-solid fa-list-check text-xl"></i>
                        </div>
                        <span class="text-xs font-bold px-3 py-1 bg-slate-100 rounded-lg text-slate-600">Action: mutasiqr</span>
                    </div>
                    
                    <div class="mb-6">
                        <h3 class="text-lg font-bold mb-1">Check Mutation</h3>
                        <p class="text-sm text-slate-600 mb-4">Verifikasi riwayat transaksi masuk pada akun Anda.</p>
                        <div class="endpoint-display">
                            <span class="shrink-0 mr-2 text-indigo-400 font-bold text-[10px]">GET</span>
                            <span id="urlMutasi" class="truncate">loading...</span>
                            <button onclick="copyUrl('urlMutasi')" class="ml-auto hover:text-white transition"><i class="fa-regular fa-copy"></i></button>
                        </div>
                    </div>

                    <form id="formMutasi" class="space-y-4">
                        <div class="space-y-4">
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">API Key</label>
                                <input type="text" id="keyMutasi" placeholder="••••••••••••" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="text-[11px] font-bold text-slate-600 ml-1">Username</label>
                                    <input type="text" id="userMutasi" placeholder="Username" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                                </div>
                                <div>
                                    <label class="text-[11px] font-bold text-slate-600 ml-1">Token</label>
                                    <input type="text" id="tokenMutasi" placeholder="Token" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                                </div>
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-slate-900 text-white font-semibold py-3.5 rounded-xl hover:bg-emerald-600 transition shadow-lg shadow-slate-200">Check History</button>
                    </form>
                    <pre id="resMutasi" class="result-container"></pre>
                </div>

                <div class="api-card bg-white rounded-3xl p-8 border-dashed border-2">
                    <div class="flex items-center justify-between mb-8">
                        <div class="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
                            <i class="fa-solid fa-shield-halved text-xl"></i>
                        </div>
                        <span class="text-xs font-bold px-3 py-1 bg-slate-100 rounded-lg text-slate-600">Action: getotp</span>
                    </div>
                    
                    <div class="mb-6">
                        <h3 class="text-lg font-bold mb-1">Step 1: Request OTP</h3>
                        <p class="text-sm text-slate-600 mb-4">Kirim kode OTP ke nomor terdaftar OrderKuota.</p>
                        <div class="endpoint-display">
                            <span class="shrink-0 mr-2 text-indigo-400 font-bold text-[10px]">GET</span>
                            <span id="urlOtp" class="truncate">loading...</span>
                        </div>
                    </div>

                    <form id="formOtp" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="col-span-2">
                                <label class="text-[11px] font-bold text-slate-600 ml-1">API Key</label>
                                <input type="text" id="keyOtp" placeholder="••••••••••••" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Username</label>
                                <input type="text" id="userOtp" placeholder="Username" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Password</label>
                                <input type="text" id="passOtp" placeholder="Pass App" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-slate-900 text-white font-semibold py-3.5 rounded-xl hover:bg-emerald-600 transition shadow-lg shadow-slate-200">Request Code</button>
                    </form>
                    <pre id="resOtp" class="result-container"></pre>
                </div>

                <div class="api-card bg-white rounded-3xl p-8 border-dashed border-2">
                    <div class="flex items-center justify-between mb-8">
                        <div class="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
                            <i class="fa-solid fa-key text-xl"></i>
                        </div>
                        <span class="text-xs font-bold px-3 py-1 bg-slate-100 rounded-lg text-slate-600">Action: gettoken</span>
                    </div>
                    
                    <div class="mb-6">
                        <h3 class="text-lg font-bold mb-1">Step 2: Get Session Token</h3>
                        <p class="text-sm text-slate-600 mb-4">Tukarkan kode OTP dengan Auth Token permanen.</p>
                        <div class="endpoint-display">
                            <span class="shrink-0 mr-2 text-indigo-400 font-bold text-[10px]">GET</span>
                            <span id="urlToken" class="truncate">loading...</span>
                        </div>
                    </div>

                    <form id="formToken" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="col-span-2">
                                <label class="text-[11px] font-bold text-slate-600 ml-1">API Key</label>
                                <input type="text" id="keyToken" placeholder="••••••••••••" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">Username</label>
                                <input type="text" id="userToken" placeholder="Username" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold text-slate-600 ml-1">OTP Code</label>
                                <input type="text" id="otpValue" placeholder="6 Digit" class="input-box w-full rounded-xl px-4 py-3 text-sm">
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-slate-900 text-white font-semibold py-3.5 rounded-xl hover:bg-emerald-600 transition shadow-lg shadow-slate-200">Finalize Authentication</button>
                    </form>
                    <pre id="resToken" class="result-container"></pre>
                </div>

            </div>
        </main>

        <footer class="max-w-7xl mx-auto px-6 py-10 border-t border-slate-200/60 text-center md:text-left">
            <div class="flex flex-col md:flex-row justify-between items-center gap-2">
                <p class="text-sm text-slate-600 font-medium">© 2026 create By KahfiModTzy.</p>
                <div class="flex gap-4">
                    <a href="https://whatsapp.com/channel/0029VasVXaeLSmbWWLB9Ti3i" class="text-slate-600 hover:text-indigo-600 transition"><i class="fa-brands fa-whatsapp text-lg"></i></a>
                    <a href="https://t.me/kahfimoodtzy" class="text-slate-600 hover:text-indigo-600 transition"><i class="fa-brands fa-telegram text-lg"></i></a>
                </div>
            </div>
        </footer>

        <script>
            const BASE_URL = window.location.origin + window.location.pathname;

            function updateUrls() {
                // Create Payment URL
                const cKey = document.getElementById('keyCreate').value || '{apikey}';
                const cUser = document.getElementById('userCreate').value || '{username}';
                const cAmt = document.getElementById('amtCreate').value || '{amount}';
                const cTok = document.getElementById('tokenCreate').value || '{token}';
                document.getElementById('urlCreate').innerText = `${BASE_URL}?action=createpayment&apikey=${cKey}&username=${cUser}&amount=${cAmt}&token=${cTok}`;

                // Mutasi URL
                const mKey = document.getElementById('keyMutasi').value || '{apikey}';
                const mUser = document.getElementById('userMutasi').value || '{username}';
                const mTok = document.getElementById('tokenMutasi').value || '{token}';
                document.getElementById('urlMutasi').innerText = `${BASE_URL}?action=mutasiqr&apikey=${mKey}&username=${mUser}&token=${mTok}`;

                // OTP URL
                const oKey = document.getElementById('keyOtp').value || '{apikey}';
                const oUser = document.getElementById('userOtp').value || '{username}';
                const oPass = document.getElementById('passOtp').value || '{password}';
                document.getElementById('urlOtp').innerText = `${BASE_URL}?action=getotp&apikey=${oKey}&username=${oUser}&password=${oPass}`;

                // Token URL
                const tKey = document.getElementById('keyToken').value || '{apikey}';
                const tUser = document.getElementById('userToken').value || '{username}';
                const tOtp = document.getElementById('otpValue').value || '{otp}';
                document.getElementById('urlToken').innerText = `${BASE_URL}?action=gettoken&apikey=${tKey}&username=${tUser}&otp=${tOtp}`;
            }

            // Listeners for live update
            document.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', updateUrls);
            });

            async function copyUrl(id) {
                const text = document.getElementById(id).innerText;
                await navigator.clipboard.writeText(text);
                alert('Endpoint URL copied to clipboard!');
            }

            async function handleRequest(e, action, params, resId) {
                e.preventDefault();
                const resBox = document.getElementById(resId);
                resBox.style.display = 'block';
                resBox.innerHTML = '<span class="text-slate-600 animate-pulse">// Processing request...</span>';
                
                const query = new URLSearchParams({ action, ...params }).toString();
                try {
                    const response = await fetch(`${BASE_URL}?${query}`);
                    const data = await response.json();
                    resBox.innerHTML = JSON.stringify(data, null, 2);
                } catch (err) {
                    resBox.innerHTML = '// Error: ' + err.message;
                }
            }

            // Bind Forms
            document.getElementById('formCreate').onsubmit = (e) => handleRequest(e, 'createpayment', {
                apikey: document.getElementById('keyCreate').value,
                username: document.getElementById('userCreate').value,
                amount: document.getElementById('amtCreate').value,
                token: document.getElementById('tokenCreate').value
            }, 'resCreate');

            document.getElementById('formMutasi').onsubmit = (e) => handleRequest(e, 'mutasiqr', {
                apikey: document.getElementById('keyMutasi').value,
                username: document.getElementById('userMutasi').value,
                token: document.getElementById('tokenMutasi').value
            }, 'resMutasi');

            document.getElementById('formOtp').onsubmit = (e) => handleRequest(e, 'getotp', {
                apikey: document.getElementById('keyOtp').value,
                username: document.getElementById('userOtp').value,
                password: document.getElementById('passOtp').value
            }, 'resOtp');

            document.getElementById('formToken').onsubmit = (e) => handleRequest(e, 'gettoken', {
                apikey: document.getElementById('keyToken').value,
                username: document.getElementById('userToken').value,
                otp: document.getElementById('otpValue').value
            }, 'resToken');

            // Init
            updateUrls();
        </script>
    </body>
    </html>
    <?php
    exit;
}

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ============================================================================
// CLASS ORDERKUOTA dan fungsi helper (sama seperti sebelumnya, tidak diubah)
// ============================================================================
if (!class_exists('OrderKuota')) {
    class OrderKuota
    {
        const API_URL = 'https://app.orderkuota.com/api/v2';
        const HOST = 'app.orderkuota.com';
        const USER_AGENT = 'okhttp/4.12.0';

        const APP_VERSION_NAME = '26.01.15';
        const APP_VERSION_CODE = '260115';
        const APP_REG_ID = 'cdzXkBynRECkAODZEHwkeV:APA91bHRyLlgNSlpVrC4Yv3xBgRRaePSaCYruHnNwrEK8_pX3kzitxzi0CxIDFc2oztCwcw7-zPgwE-6v_-rJCJdTX8qE_ADiSnWHNeZ5O7_BIlgS_1N8tw';
        const PHONE_MODEL = '23124RA7EO';
        const PHONE_UUID = 'cdzXkBynRECkAODZEHwkeV';
        const PHONE_ANDROID_VERSION = '15';
        const STATIC_SIGNATURE = '944d749d04f80642bcbffe4e2c3b84ba91b1cfe28d68c0fb51bd90a666ff645cc17281a50b67190c047ed55b541d3ea181bf5606e02ab9275155c8669154fe28';

        private $authToken;
        private $username;

        public function __construct($username = null, $authToken = null)
        {
            $this->username = $username;
            $this->authToken = $authToken;
        }

        public function login($username, $password)
        {
            $request_time = round(microtime(true) * 1000);
            $payload = http_build_query([
                'username' => $username,
                'password' => $password,
                'request_time' => $request_time,
                'app_reg_id' => self::APP_REG_ID,
                'phone_android_version' => self::PHONE_ANDROID_VERSION,
                'app_version_code' => self::APP_VERSION_CODE,
                'phone_uuid' => self::PHONE_UUID
            ]);
            $response = $this->request('POST', self::API_URL . '/login', $payload, true);
            return json_decode($response, true);
        }

        public function generateQr($amount)
        {
            $request_time = round(microtime(true) * 1000);
            $payload = http_build_query([
                'request_time' => $request_time,
                'app_reg_id' => self::APP_REG_ID,
                'phone_android_version' => self::PHONE_ANDROID_VERSION,
                'app_version_code' => self::APP_VERSION_CODE,
                'phone_uuid' => self::PHONE_UUID,
                'auth_username' => $this->username,
                'auth_token' => $this->authToken,
                'requests[qris_merchant_terms][jumlah]' => $amount,
                'requests[0]' => 'qris_merchant_terms',
                'app_version_name' => self::APP_VERSION_NAME,
                'phone_model' => self::PHONE_MODEL
            ]);
            $response = $this->request('POST', self::API_URL . '/get', $payload, true);
            $data = json_decode($response, true);
            if (isset($data['success']) && $data['success'] && isset($data['qris_merchant_terms']['results'])) {
                return $data['qris_merchant_terms']['results'];
            }
            return $data;
        }

        public function getTransactionQris()
        {
            $resellerId = explode(':', $this->authToken)[0];
            $request_time = round(microtime(true) * 1000);
            $payload = http_build_query([
                'app_reg_id' => self::APP_REG_ID,
                'phone_uuid' => self::PHONE_UUID,
                'phone_model' => self::PHONE_MODEL,
                'requests[qris_history][keterangan]' => '',
                'requests[qris_history][jumlah]' => '',
                'request_time' => $request_time,
                'phone_android_version' => self::PHONE_ANDROID_VERSION,
                'app_version_code' => self::APP_VERSION_CODE,
                'auth_username' => $this->username,
                'requests[qris_history][page]' => '1',
                'auth_token' => $this->authToken,
                'app_version_name' => self::APP_VERSION_NAME,
                'ui_mode' => 'light',
                'requests[qris_history][dari_tanggal]' => '',
                'requests[0]' => 'account',
                'requests[qris_history][ke_tanggal]' => ''
            ]);
            $url = self::API_URL . '/qris/mutasi/' . $resellerId;
            $extraHeaders = [
                'signature: ' . self::STATIC_SIGNATURE,
                'timestamp: ' . $request_time
            ];
            $response = $this->request('POST', $url, $payload, true, $extraHeaders);
            return json_decode($response, true);
        }

        protected function buildHeaders($extraHeaders = [])
        {
            $headers = [
                'Host: ' . self::HOST,
                'User-Agent: ' . self::USER_AGENT,
                'Content-Type: application/x-www-form-urlencoded',
                'Accept-Encoding: gzip'
            ];
            return array_merge($headers, $extraHeaders);
        }

        protected function request($method, $url, $postData = null, $useHeaders = true, $extraHeaders = [])
        {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            curl_setopt($ch, CURLOPT_ENCODING, 'gzip');
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);
            if ($postData !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            }
            if ($useHeaders) {
                curl_setopt($ch, CURLOPT_HTTPHEADER, $this->buildHeaders($extraHeaders));
            }
            $result = curl_exec($ch);
            $error = curl_error($ch);
            if ($error) {
                return json_encode(['error' => 'CURL error: ' . $error]);
            }
            return $result;
        }
    }
}

if (!function_exists('convertCRC16')) {
    function convertCRC16($str) {
        $crc = 0xFFFF;
        for ($c = 0; $c < strlen($str); $c++) {
            $crc ^= ord($str[$c]) << 8;
            for ($i = 0; $i < 8; $i++) {
                $crc = ($crc & 0x8000) ? ($crc << 1) ^ 0x1021 : $crc << 1;
            }
        }
        return str_pad(strtoupper(dechex($crc & 0xFFFF)), 4, '0', STR_PAD_LEFT);
    }
}

if (!function_exists('generateTransactionId')) {
    function generateTransactionId() {
        return 'SKY-' . strtoupper(bin2hex(random_bytes(3)));
    }
}

if (!function_exists('generateExpirationTime')) {
    function generateExpirationTime() {
        $exp = new DateTime();
        $exp->modify('+30 minutes');
        return $exp->format('Y-m-d H:i:s');
    }
}

if (!function_exists('uploadToPixhost')) {
    function uploadToPixhost($imagePath) {
        $url = 'https://api.pixhost.to/images';
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        $headers = [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
            'x-requested-with: XMLHttpRequest',
        ];
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $postFields = [
            'content_type' => '0',
            'img' => new CURLFile($imagePath)
        ];
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        if ($curlError) throw new Exception("Pixhost upload curl error: $curlError");
        if ($httpCode != 200) throw new Exception("Pixhost upload HTTP $httpCode");
        $data = json_decode($response, true);
        if (!$data || !isset($data['show_url'])) throw new Exception("Pixhost response tidak valid");
        $showUrl = $data['show_url'];

        $ch2 = curl_init($showUrl);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch2, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch2, CURLOPT_HTTPHEADER, [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        ]);
        $html = curl_exec($ch2);
        $httpCode2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        if ($httpCode2 != 200 || empty($html)) throw new Exception("Gagal mengambil halaman show_url");
        if (preg_match('/<img[^>]+class="image-img"[^>]+src="([^"]+)"/i', $html, $matches)) {
            $directUrl = $matches[1];
            if (strpos($directUrl, '//') === 0) $directUrl = 'https:' . $directUrl;
            elseif (strpos($directUrl, '/') === 0) $directUrl = 'https://pixhost.to' . $directUrl;
            return $directUrl;
        }
        throw new Exception("Tidak dapat menemukan URL gambar");
    }
}

if (!function_exists('uploadToTmpNinja')) {
    function uploadToTmpNinja($imagePath) {
        $url = 'https://tmp.ninja/upload';
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_POSTFIELDS, ['file' => new CURLFile($imagePath)]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($httpCode != 200) throw new Exception("tmp.ninja HTTP $httpCode");
        $data = json_decode($response, true);
        if (!$data || !isset($data['file']['url'])) throw new Exception("tmp.ninja response tidak valid");
        return $data['file']['url'];
    }
}

if (!function_exists('uploadToCatbox')) {
    function uploadToCatbox($imagePath) {
        $url = 'https://catbox.moe/user/api.php';
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_POSTFIELDS, [
            'reqtype' => 'fileupload',
            'fileToUpload' => new CURLFile($imagePath)
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($httpCode != 200) throw new Exception("catbox.moe HTTP $httpCode");
        $url = trim($response);
        if (!filter_var($url, FILTER_VALIDATE_URL)) throw new Exception("catbox.moe response bukan URL valid");
        return $url;
    }
}

if (!function_exists('uploadImage')) {
    function uploadImage($imagePath) {
        if (!file_exists($imagePath)) throw new Exception("File tidak ditemukan");
        $lastError = '';
        try { return uploadToPixhost($imagePath); } catch (Exception $e) { $lastError = 'Pixhost: ' . $e->getMessage(); }
        try { return uploadToTmpNinja($imagePath); } catch (Exception $e) { $lastError .= ' | Tmp.ninja: ' . $e->getMessage(); }
        try { return uploadToCatbox($imagePath); } catch (Exception $e) { $lastError .= ' | Catbox: ' . $e->getMessage(); }
        throw new Exception("Semua host gagal: $lastError");
    }
}

if (!function_exists('createQRIS')) {
    function createQRIS($amount, $qrisString) {
        $qrisData = substr($qrisString, 0, -4);
        $step1 = str_replace("010211", "010212", $qrisData);
        $step2 = explode("5802ID", $step1);
        $uang = "54" . str_pad(strlen($amount), 2, '0', STR_PAD_LEFT) . $amount . "5802ID";
        $final = $step2[0] . $uang . $step2[1];
        $result = $final . convertCRC16($final);

        $qrApiUrl = "https://api.qrserver.com/v1/create-qr-code/";
        $params = http_build_query([
            'size'   => '400x400',
            'margin' => 25,
            'data'   => $result
        ]);

        $ch = curl_init($qrApiUrl . '?' . $params);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);

        $imageData = curl_exec($ch);
        if (curl_errno($ch)) {
            throw new Exception("CURL Error: " . curl_error($ch));
        }
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode !== 200 || empty($imageData)) {
            throw new Exception("Gagal generate QR code (HTTP $httpCode)");
        }

        $tempFile = tempnam(sys_get_temp_dir(), 'qris_') . '.png';
        file_put_contents($tempFile, $imageData);
        if (!file_exists($tempFile) || filesize($tempFile) == 0) {
            throw new Exception("File QR gagal dibuat");
        }

        $imageUrl = uploadImage($tempFile);
        unlink($tempFile);

        return [
            'idtransaksi' => generateTransactionId(),
            'jumlah'      => $amount,
            'expired'     => generateExpirationTime(),
            'imageqris'   => ['url' => $imageUrl]
        ];
    }
}

// ============================================================================
// MAIN API LOGIC (sama seperti sebelumnya)
// ============================================================================
try {

$valid_api_keys = [
    'Ktzy77'
];

$api_key = $_GET['apikey'] ?? '';

if (!in_array($api_key, $valid_api_keys, true)) {
    throw new Exception("API Key tidak valid.");
}

    $action = $_GET['action'] ?? null;

    if ($action === 'getotp') {
        $username = $_GET['username'] ?? '';
        $password = $_GET['password'] ?? '';
        if (empty($username) || empty($password)) {
            throw new Exception("Parameter 'username' dan 'password' wajib diisi.");
        }
        $orderkuota = new OrderKuota();
        $response = $orderkuota->login($username, $password);
        echo json_encode([
            "status" => true,
            "action" => "getotp",
            "result" => $response
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($action === 'gettoken') {
        $username = $_GET['username'] ?? '';
        $otp = $_GET['otp'] ?? '';
        if (empty($username) || empty($otp)) {
            throw new Exception("Parameter 'username' dan 'otp' wajib diisi.");
        }
        $orderkuota = new OrderKuota();
        $response = $orderkuota->login($username, $otp);
        echo json_encode([
            "status" => true,
            "action" => "gettoken",
            "result" => $response
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($action === 'createpayment') {
        $username = $_GET['username'] ?? '';
        $token = $_GET['token'] ?? '';
        $amount = (int)($_GET['amount'] ?? 0);
        if (empty($username) || empty($token)) {
            throw new Exception("Parameter 'username' dan 'token' wajib diisi.");
        }
        if ($amount <= 0) throw new Exception("Nominal 'amount' harus > 0");
        
        $orderkuota = new OrderKuota($username, $token);
        $qrResponse = $orderkuota->generateQr($amount);
        if (!isset($qrResponse['qris_data'])) {
            $errorMsg = is_array($qrResponse) ? json_encode($qrResponse) : 'No qris_data';
            throw new Exception("Gagal QRIS: $errorMsg");
        }
        $qrisResult = createQRIS($amount, $qrResponse['qris_data']);
        echo json_encode([
            "status" => true,
            "action" => "createpayment",
            "result" => [
                "trxid" => $qrisResult['idtransaksi'],
                "nominal" => $qrisResult['jumlah'],
                "expired" => $qrisResult['expired'],
                "qris_image" => $qrisResult['imageqris']['url']
            ]
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($action === 'mutasiqr') {
        $username = $_GET['username'] ?? '';
        $token = $_GET['token'] ?? '';
        if (empty($username) || empty($token)) {
            throw new Exception("Parameter 'username' dan 'token' wajib diisi.");
        }
        $orderkuota = new OrderKuota($username, $token);
        $mutasi = $orderkuota->getTransactionQris();
        echo json_encode([
            "status" => true,
            "action" => "mutasiqr",
            "result" => $mutasi['qris_history'] ?? $mutasi
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    throw new Exception("Action tidak valid. Gunakan 'getotp', 'gettoken', 'createpayment', atau 'mutasiqr'.");

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        "status" => false,
        "message" => $e->getMessage()
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}