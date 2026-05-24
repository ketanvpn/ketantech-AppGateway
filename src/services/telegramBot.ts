import { Telegraf, Context } from "telegraf";
import { logger } from "../utils/logger";
import { transactionStore } from "../store/transactionStore";
import {
  CREDENTIAL_FIELDS_BY_PROVIDER,
  CredentialField,
  maskSecret,
  settingsStore,
} from "../store/settingsStore";
import { getOrderedProviders } from "../providers";
import { syncOrderKuotaStatus } from "./orderkuotaSyncService";
import { refundPayment } from "./refundService";
import { auditLogStore } from "../store/auditLogStore";
import { PaymentStatus, ProviderName } from "../types";

/**
 * Telegram bot integration — notifikasi event + command interaktif untuk admin.
 *
 * Library: telegraf v4 (modern, actively maintained, tidak punya CVE seperti
 * node-telegram-bot-api yang transitively depend pada `request` deprecated).
 *
 * Dua peran utama:
 *  1. **Notifier** — push event penting ke chat admin (charge sukses, provider down,
 *     refund, OrderKuota token expired).
 *  2. **Interactive bot** — admin bisa chat command untuk cek status / control gateway:
 *     /stats, /last, /refund, /health, /sync, /help.
 *
 * Auth: hanya chat ID yang ada di TELEGRAM_ADMIN_CHAT_IDS yang boleh kirim command.
 * Tanpa whitelist ini, siapa pun yang tahu username bot bisa control gateway —
 * tidak boleh.
 *
 * Rate limit per chat: 30 message/menit (cegah spam loop bug).
 *
 * Audit: semua action sensitif via Telegram (refund, sync) tercatat di audit log
 * dengan source "telegram" + chat ID admin yang trigger.
 */

let bot: Telegraf | null = null;
let adminChatIds: string[] = [];
let notificationsEnabled = false;

// Rate limit per chat ID (cegah spam bot loop bug)
const messageCounters = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const VALID_PROVIDERS: ProviderName[] = [
  "midtrans",
  "xendit",
  "doku",
  "tripay",
  "orderkuota",
  "autogopay",
];

type PendingAction =
  | { kind: "refund"; txId: string; orderId: string; expiresAt: number }
  | {
      kind: "credential:set";
      provider: ProviderName;
      field: CredentialField;
      expiresAt: number;
    }
  | {
      kind: "credential:clear";
      provider: ProviderName;
      field: CredentialField;
      expiresAt: number;
    }
  | { kind: "restart"; expiresAt: number };

// Pending interactive actions (per chat)
const pendingActions = new Map<string, PendingAction>();
const REFUND_CONFIRM_TIMEOUT_MS = 30_000;
const INPUT_TIMEOUT_MS = 5 * 60_000;

function getEnv(): { token: string; chatIds: string[]; enabled: boolean } {
  // Priority: DB settings > ENV
  const { getTelegramSettings } = require("../store/settingsStore");
  const dbSettings = getTelegramSettings();

  const envToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const envChatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const token = dbSettings.botToken || envToken;
  const chatIds = dbSettings.adminChatIds || envChatIds;
  const enabled = Boolean(token && chatIds.length > 0);

  if (!enabled) {
    logger.info(
      "Telegram bot disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_IDS in .env or update via dashboard)",
    );
  }

  return { token, chatIds, enabled };
}

export function startTelegramBot(): void {
  const { token, chatIds, enabled } = getEnv();
  if (!enabled) {
    logger.info(
      "Telegram bot disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_IDS to enable)",
    );
    return;
  }

  try {
    bot = new Telegraf(token, {
      // 30 detik timeout — cukup untuk operasi sync, tidak terlalu lama
      // sampai bikin user nunggu kelamaan.
      handlerTimeout: 30_000,
    });
    adminChatIds = chatIds;
    notificationsEnabled = true;

    setupCommands(bot);
    configureTelegramCommands(bot).catch((err: unknown) => {
      logger.warn(
        { err: (err as Error).message },
        "Failed to configure Telegram command menu",
      );
    });

    bot.catch((err: unknown) => {
      logger.error(
        { err: (err as Error).message },
        "Telegram bot handler error",
      );
    });

    // Launch polling (non-blocking — kalau gagal connect, log saja).
    bot.launch().catch((err: unknown) => {
      logger.error(
        { err: (err as Error).message },
        "Telegram bot launch failed",
      );
      bot = null;
      notificationsEnabled = false;
    });

    logger.info(
      { adminChatCount: chatIds.length },
      "Telegram bot started",
    );
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "Failed to start Telegram bot",
    );
  }
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop("SIGTERM");
    bot = null;
    notificationsEnabled = false;
    logger.info("Telegram bot stopped");
  }
}

export function getTelegramBot(): Telegraf | null {
  return bot;
}

/**
 * Reload Telegram bot dengan token/chat IDs baru tanpa restart server.
 * Berguna saat admin update settings via dashboard.
 */
export function reloadTelegramBot(): void {
  logger.info("Reloading Telegram bot...");
  stopTelegramBot();
  startTelegramBot();
}

async function configureTelegramCommands(b: Telegraf): Promise<void> {
  await b.telegram.setMyCommands([
    { command: "menu", description: "Buka tombol admin panel" },
    { command: "stats", description: "Ringkasan transaksi hari ini" },
    { command: "last", description: "Transaksi terakhir" },
    { command: "health", description: "Status provider" },
    { command: "sync", description: "Sync OrderKuota" },
    { command: "settings", description: "Lihat setting gateway" },
    { command: "help", description: "Bantuan command" },
    { command: "cancel", description: "Batalkan input aktif" },
  ]);
}

// ════════════════════════════════════════════════════════════════════
// Notifier — dipanggil dari service lain saat ada event penting
// ════════════════════════════════════════════════════════════════════

export async function notifyTransactionSuccess(tx: {
  orderId: string;
  amount: number;
  currency: string;
  providerName: string;
  method: string;
  id: string;
}): Promise<void> {
  if (!notificationsEnabled) return;
  const msg =
    `📥 *Pembayaran Sukses*\n\n` +
    `Order ID: \`${escapeMarkdown(tx.orderId)}\`\n` +
    `Jumlah: *${formatAmount(tx.amount, tx.currency)}*\n` +
    `Method: ${tx.method}\n` +
    `Provider: ${tx.providerName}\n` +
    `Tx ID: \`${tx.id}\``;
  await broadcastToAdmins(msg);
}

export async function notifyTransactionFailed(tx: {
  orderId: string;
  amount: number;
  currency: string;
  reason?: string;
}): Promise<void> {
  if (!notificationsEnabled) return;
  const msg =
    `❌ *Pembayaran Gagal*\n\n` +
    `Order ID: \`${escapeMarkdown(tx.orderId)}\`\n` +
    `Jumlah: ${formatAmount(tx.amount, tx.currency)}\n` +
    (tx.reason ? `Alasan: ${escapeMarkdown(tx.reason)}\n` : "");
  await broadcastToAdmins(msg);
}

export async function notifyAllProvidersDown(): Promise<void> {
  if (!notificationsEnabled) return;
  await broadcastToAdmins(
    `🚨 *Gateway Critical!*\n\nSemua provider pembayaran tidak respon. Customer tidak bisa charge sekarang.\n\nCek health: /health`,
  );
}

export async function notifyRefund(tx: {
  orderId: string;
  amount: number;
  currency: string;
}): Promise<void> {
  if (!notificationsEnabled) return;
  await broadcastToAdmins(
    `💸 *Refund*\n\nOrder ID: \`${escapeMarkdown(tx.orderId)}\`\nJumlah: ${formatAmount(tx.amount, tx.currency)}`,
  );
}

export async function notifyOrderKuotaTokenExpired(): Promise<void> {
  if (!notificationsEnabled) return;
  await broadcastToAdmins(
    `🔑 *OrderKuota Token Expired*\n\nPerlu login ulang OTP di dashboard /orderkuota.`,
  );
}

async function broadcastToAdmins(message: string): Promise<void> {
  if (!bot) return;
  for (const chatId of adminChatIds) {
    try {
      await bot.telegram.sendMessage(chatId, message, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      logger.error(
        { chatId, err: (err as Error).message },
        "Failed to send Telegram notification",
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// Interactive commands
// ════════════════════════════════════════════════════════════════════

function setupCommands(b: Telegraf): void {
  b.start((ctx) => sendMainMenu(ctx));
  b.help((ctx) => sendHelp(ctx));

  b.command("menu", async (ctx) => {
    if (!authorize(ctx)) return;
    await sendMainMenu(ctx);
  });

  b.command("cancel", async (ctx) => {
    if (!authorize(ctx)) return;
    pendingActions.delete(String(ctx.chat?.id ?? ""));
    await ctx.reply("✅ Mode input dibatalkan.");
  });

  b.command("stats", async (ctx) => {
    if (!authorize(ctx)) return;
    await sendStats(ctx);
  });

  b.command("last", async (ctx) => {
    if (!authorize(ctx)) return;
    const arg = ctx.message.text.split(/\s+/)[1];
    const n = arg ? parseInt(arg, 10) : 5;
    await sendLastTransactions(
      ctx,
      Math.min(20, Math.max(1, Number.isFinite(n) ? n : 5)),
    );
  });

  b.command("health", async (ctx) => {
    if (!authorize(ctx)) return;
    await sendHealth(ctx);
  });

  b.command("sync", async (ctx) => {
    if (!authorize(ctx)) return;
    await runOrderKuotaSync(ctx);
  });

  b.command("refund", async (ctx) => {
    if (!authorize(ctx)) return;
    const arg = ctx.message.text.split(/\s+/)[1];
    if (!arg) {
      await ctx.reply("Format: /refund <orderId>");
      return;
    }
    await initiateRefund(ctx, arg);
  });

  b.command("settings", async (ctx) => {
    if (!authorize(ctx)) return;
    await sendSettings(ctx);
  });

  b.command("provider", async (ctx) => {
    if (!authorize(ctx)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    await handleProviderCommand(ctx, args);
  });

  b.command("restart", async (ctx) => {
    if (!authorize(ctx)) return;
    await confirmRestartServer(ctx);
  });

  b.on("callback_query", async (ctx) => {
    if (!authorize(ctx)) return;
    const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore Telegram callback timeout/network race
    }
    await handleMenuCallback(ctx, data);
  });

  b.on("message", async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) return;
    if (!authorize(ctx)) return;
    await handleTextInput(ctx, ctx.message.text.trim());
  });
}

async function sendMainMenu(ctx: Context): Promise<void> {
  if (!authorize(ctx)) return;
  await ctx.reply(
    `*KetantechPay Admin Panel*\n\n` +
      `Pilih menu di bawah. Command lama tetap bisa dipakai kalau butuh cepat.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📊 Ringkasan Hari Ini", callback_data: "menu:stats" },
            { text: "💳 Transaksi Terakhir", callback_data: "menu:last" },
          ],
          [
            { text: "🟢 Health Provider", callback_data: "menu:health" },
            { text: "🔄 Sync OrderKuota", callback_data: "menu:sync" },
          ],
          [
            { text: "⚙️ Provider", callback_data: "menu:provider" },
            { text: "🔐 Credentials", callback_data: "menu:credentials" },
          ],
          [
            { text: "🧾 Refund", callback_data: "menu:refund" },
            { text: "❓ Bantuan", callback_data: "menu:help" },
          ],
        ],
      },
    },
  );
}

async function handleMenuCallback(ctx: Context, data: string): Promise<void> {
  if (!data) return;

  if (data === "menu:home") return sendMainMenu(ctx);
  if (data === "menu:help") return sendHelp(ctx);
  if (data === "menu:stats") return sendStats(ctx);
  if (data === "menu:health") return sendHealth(ctx);
  if (data === "menu:sync") return runOrderKuotaSync(ctx);
  if (data === "menu:settings") return sendSettings(ctx);
  if (data === "menu:restart") return confirmRestartServer(ctx);
  if (data === "menu:refund") return askRefundInput(ctx);

  if (data === "menu:last") return sendLastMenu(ctx);
  if (data.startsWith("last:")) {
    const n = parseInt(data.split(":")[1] || "5", 10);
    return sendLastTransactions(ctx, Math.min(20, Math.max(1, n)));
  }

  if (data === "menu:provider") return sendProviderMenu(ctx);
  if (data === "provider:order") return sendProviderOrderMenu(ctx);
  if (data.startsWith("provider:enable:")) {
    const provider = toProviderName(data.split(":")[2]);
    if (!provider) { await ctx.reply("❌ Provider tidak valid."); return; }
    return setProviderForceDownFromMenu(ctx, provider, false);
  }
  if (data.startsWith("provider:disable:")) {
    const provider = toProviderName(data.split(":")[2]);
    if (!provider) { await ctx.reply("❌ Provider tidak valid."); return; }
    return setProviderForceDownFromMenu(ctx, provider, true);
  }

  if (data === "menu:credentials") return sendCredentialsMenu(ctx);
  if (data.startsWith("credentials:provider:")) {
    const provider = toProviderName(data.split(":")[2]);
    if (!provider) { await ctx.reply("❌ Provider tidak valid."); return; }
    return sendCredentialProviderMenu(ctx, provider);
  }
  if (data.startsWith("credential:field:")) {
    const [, , providerRaw, fieldRaw] = data.split(":");
    const provider = toProviderName(providerRaw);
    if (!provider || !isCredentialField(provider, fieldRaw)) {
      await ctx.reply("❌ Field credential tidak valid.");
      return;
    }
    return sendCredentialFieldMenu(ctx, provider, fieldRaw);
  }
  if (data.startsWith("credential:set:")) {
    const [, , providerRaw, fieldRaw] = data.split(":");
    const provider = toProviderName(providerRaw);
    if (!provider || !isCredentialField(provider, fieldRaw)) {
      await ctx.reply("❌ Field credential tidak valid.");
      return;
    }
    return askCredentialValue(ctx, provider, fieldRaw);
  }
  if (data.startsWith("credential:clear:")) {
    const [, , providerRaw, fieldRaw] = data.split(":");
    const provider = toProviderName(providerRaw);
    if (!provider || !isCredentialField(provider, fieldRaw)) {
      await ctx.reply("❌ Field credential tidak valid.");
      return;
    }
    return askCredentialClearConfirmation(ctx, provider, fieldRaw);
  }
}

async function sendLastMenu(ctx: Context): Promise<void> {
  await ctx.reply("Pilih jumlah transaksi terakhir:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "5 terakhir", callback_data: "last:5" },
          { text: "10 terakhir", callback_data: "last:10" },
          { text: "20 terakhir", callback_data: "last:20" },
        ],
        [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
      ],
    },
  });
}

async function sendProviderMenu(ctx: Context): Promise<void> {
  const settings = settingsStore.snapshot();
  const keyboard = VALID_PROVIDERS.map((p) => {
    const disabled = settingsStore.isForceDown(p);
    return [
      {
        text: `${disabled ? "✅ Enable" : "⛔ Disable"} ${p}`,
        callback_data: `provider:${disabled ? "enable" : "disable"}:${p}`,
      },
    ];
  });
  await ctx.reply(
    `*Provider Control*\n\n` +
      `Urutan fallback:\n${settings.providerOrder.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚙️ Lihat Settings Detail", callback_data: "menu:settings" }],
          ...keyboard,
          [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
        ],
      },
    },
  );
}

async function sendProviderOrderMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    `Untuk ubah urutan fallback, sementara masih pakai command:\n\n` +
      `\`/provider order autogopay,orderkuota,midtrans\`\n\n` +
      `Saya sengaja belum bikin drag/sort via tombol supaya tidak rawan salah urutan.`,
    { parse_mode: "Markdown" },
  );
}

async function setProviderForceDownFromMenu(
  ctx: Context,
  provider: ProviderName,
  forceDown: boolean,
): Promise<void> {
  settingsStore.setForceDown(provider, forceDown);
  auditLogStore.record({
    action: `telegram.provider.${forceDown ? "disable" : "enable"}`,
    actor: `chat:${ctx.chat?.id ?? "?"}`,
    targetType: "settings",
    targetId: provider,
    details: { provider, forceDown, username: ctx.from?.username, via: "button" },
  });
  await ctx.reply(`${forceDown ? "⏸️" : "✅"} Provider *${provider}* ${forceDown ? "dinonaktifkan" : "diaktifkan"}`, {
    parse_mode: "Markdown",
  });
  await sendProviderMenu(ctx);
}

async function sendCredentialsMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    `*Credentials Manager* 🔐\n\n` +
      `Pilih provider. Nilai secret hanya ditampilkan masked. Untuk keamanan, input credential baru dikirim sebagai pesan berikutnya dan bisa dibatalkan dengan /cancel.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          ...VALID_PROVIDERS.map((p) => [
            { text: providerLabel(p), callback_data: `credentials:provider:${p}` },
          ]),
          [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
        ],
      },
    },
  );
}

async function sendCredentialProviderMenu(
  ctx: Context,
  provider: ProviderName,
): Promise<void> {
  const snapshot = settingsStore.credentialsSnapshot()[provider];
  const lines = CREDENTIAL_FIELDS_BY_PROVIDER[provider].map((field) => {
    const item = snapshot[field];
    const status = item.source === "db" ? "DB override" : item.source === "env" ? "ENV fallback" : "empty";
    const value = item.value ? `\`${escapeMarkdown(item.value)}\`` : "_not set_";
    return `• *${field}* — ${status}: ${value}`;
  });

  await ctx.reply(`*${providerLabel(provider)} Credentials*\n\n${lines.join("\n")}`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        ...CREDENTIAL_FIELDS_BY_PROVIDER[provider].map((field) => [
          { text: `✏️ Edit ${field}`, callback_data: `credential:field:${provider}:${field}` },
        ]),
        [{ text: "⬅️ Provider List", callback_data: "menu:credentials" }],
      ],
    },
  });
}

async function sendCredentialFieldMenu(
  ctx: Context,
  provider: ProviderName,
  field: CredentialField,
): Promise<void> {
  const item = settingsStore.credentialsSnapshot()[provider][field];
  const value = item.value ? `\`${escapeMarkdown(item.value)}\`` : "_not set_";
  await ctx.reply(
    `*${providerLabel(provider)} / ${field}*\n\n` +
      `Source: *${item.source}*\n` +
      `Current: ${value}\n\n` +
      `Pilih aksi:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Set / Update", callback_data: `credential:set:${provider}:${field}` }],
          [{ text: "🧹 Hapus DB Override", callback_data: `credential:clear:${provider}:${field}` }],
          [{ text: "⬅️ Kembali", callback_data: `credentials:provider:${provider}` }],
        ],
      },
    },
  );
}

async function askCredentialValue(
  ctx: Context,
  provider: ProviderName,
  field: CredentialField,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  pendingActions.set(chatId, {
    kind: "credential:set",
    provider,
    field,
    expiresAt: Date.now() + INPUT_TIMEOUT_MS,
  });
  await ctx.reply(
    `Kirim nilai baru untuk *${provider}.${field}* sekarang.\n\n` +
      `Ketik /cancel untuk batal. Secret tidak akan ditampilkan ulang full.`,
    { parse_mode: "Markdown" },
  );
}

async function askCredentialClearConfirmation(
  ctx: Context,
  provider: ProviderName,
  field: CredentialField,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  pendingActions.set(chatId, {
    kind: "credential:clear",
    provider,
    field,
    expiresAt: Date.now() + REFUND_CONFIRM_TIMEOUT_MS,
  });
  await ctx.reply(
    `Hapus DB override untuk *${provider}.${field}*?\n\n` +
      `Kalau ada nilai di .env, gateway akan fallback ke .env. Balas *YA* untuk lanjut atau *TIDAK* untuk batal.`,
    { parse_mode: "Markdown" },
  );
}

async function askRefundInput(ctx: Context): Promise<void> {
  await ctx.reply(
    `Kirim orderId atau transactionId yang mau direfund dengan format:\n\n` +
      `\`/refund ORDER_ID\`\n\n` +
      `Saya belum ambil ID transaksi via tombol supaya refund tetap eksplisit dan aman.`,
    { parse_mode: "Markdown" },
  );
}

async function sendHelp(ctx: Context): Promise<void> {
  if (!authorize(ctx)) return;
  await ctx.reply(
    `*KetantechPay Bot* 🤖\n\n` +
      `*Monitoring:*\n` +
      `/stats — Ringkasan transaksi hari ini\n` +
      `/last [n] — n transaksi terakhir (default 5, max 20)\n` +
      `/health — Status semua provider\n\n` +
      `*Actions:*\n` +
      `/sync — Trigger OrderKuota sync mutasi\n` +
      `/refund <orderId> — Refund transaksi\n` +
      `/restart — Restart server (butuh PM2/systemd)\n\n` +
      `*Settings:*\n` +
      `/settings — Lihat konfigurasi gateway\n` +
      `/provider order <list> — Ubah urutan fallback\n` +
      `/provider enable <name> — Aktifkan provider\n` +
      `/provider disable <name> — Nonaktifkan provider\n\n` +
      `/help — Tampilkan menu ini\n\n` +
      `📢 Notifikasi otomatis aktif untuk: pembayaran sukses, gagal, refund, provider down.`,
    { parse_mode: "Markdown" },
  );
}

async function sendStats(ctx: Context): Promise<void> {
  const all = transactionStore.list();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = all.filter(
    (t) => new Date(t.createdAt).getTime() >= todayStart.getTime(),
  );

  const counts = countByStatus(today);
  const totalSuccess = today
    .filter((t) => t.status === "success")
    .reduce((s, t) => s + t.amount, 0);

  const msg =
    `📊 *Statistik Hari Ini*\n\n` +
    `Total transaksi: *${today.length}*\n` +
    `Sukses: ${counts.success} · ${formatAmount(totalSuccess, "IDR")}\n` +
    `Pending: ${counts.pending}\n` +
    `Gagal: ${counts.failed}\n` +
    `Expired: ${counts.expired}\n` +
    `Refunded: ${counts.refunded}`;

  await ctx.reply(msg, { parse_mode: "Markdown" });
}

async function sendLastTransactions(ctx: Context, n: number): Promise<void> {
  const all = transactionStore.list().slice(0, n);
  if (all.length === 0) {
    await ctx.reply("Belum ada transaksi.");
    return;
  }
  const lines = all.map((t, i) => {
    const emoji = statusEmoji(t.status);
    const time = new Date(t.createdAt).toLocaleString("id-ID", {
      dateStyle: "short",
      timeStyle: "short",
    });
    return (
      `${i + 1}. ${emoji} \`${escapeMarkdown(t.orderId)}\`\n` +
      `   ${formatAmount(t.amount, t.currency)} · ${t.providerName} · ${time}`
    );
  });
  await ctx.reply(
    `*${n} Transaksi Terakhir*\n\n` + lines.join("\n\n"),
    { parse_mode: "Markdown" },
  );
}

async function sendHealth(ctx: Context): Promise<void> {
  const providers = getOrderedProviders();
  const results = await Promise.all(
    providers.map(async (p) => ({
      name: p.name,
      healthy: await safe(() => p.isHealthy()),
      forceDown: settingsStore.isForceDown(p.name),
    })),
  );
  const lines = results.map((r) => {
    const icon = r.forceDown ? "⏸️" : r.healthy ? "✅" : "❌";
    const note = r.forceDown ? " (force-down)" : r.healthy ? "" : " — DOWN";
    return `${icon} *${r.name}*${note}`;
  });
  await ctx.reply(`*Provider Health*\n\n` + lines.join("\n"), {
    parse_mode: "Markdown",
  });
}

async function runOrderKuotaSync(ctx: Context): Promise<void> {
  await ctx.reply("🔄 Syncing OrderKuota mutasi...");
  try {
    const res = await syncOrderKuotaStatus();
    auditLogStore.record({
      action: "telegram.orderkuota.sync",
      actor: `chat:${ctx.chat?.id ?? "?"}`,
      details: {
        matched: res.matched,
        pendingCount: res.pendingCount,
        mutasiCount: res.mutasiCount,
        username: ctx.from?.username,
      },
    });

    await ctx.reply(
      `✅ Sync selesai\n\n` +
        `Pending: ${res.pendingCount}\n` +
        `Mutasi diperiksa: ${res.mutasiCount}\n` +
        `Match: *${res.matched}*`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await ctx.reply(`❌ Sync gagal: ${(err as Error).message}`);
  }
}

async function initiateRefund(ctx: Context, orderId: string): Promise<void> {
  // Cari transaksi by orderId, fallback ke gateway tx ID kalau user kirim itu
  const tx =
    transactionStore.findByOrderId(orderId) ??
    transactionStore.findById(orderId);

  if (!tx) {
    await ctx.reply(`❌ Transaksi \`${escapeMarkdown(orderId)}\` tidak ditemukan.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (tx.status !== "success") {
    await ctx.reply(
      `❌ Tidak bisa refund — status saat ini: *${tx.status}*. Hanya transaksi success yang bisa di-refund.`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  const chatId = String(ctx.chat?.id ?? "");
  pendingActions.set(chatId, {
    kind: "refund",
    txId: tx.id,
    orderId: tx.orderId,
    expiresAt: Date.now() + REFUND_CONFIRM_TIMEOUT_MS,
  });

  await ctx.reply(
    `Refund \`${escapeMarkdown(tx.orderId)}\` sebesar ${formatAmount(tx.amount, tx.currency)}?\n\n` +
      `Balas *YA* dalam 30 detik untuk konfirmasi, atau *TIDAK* untuk batal.`,
    { parse_mode: "Markdown" },
  );
}

async function handleTextInput(ctx: Context, rawText: string): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const pending = pendingActions.get(chatId);
  if (!pending) return;

  if (rawText.toLowerCase() === "/cancel") {
    pendingActions.delete(chatId);
    await ctx.reply("✅ Mode input dibatalkan.");
    return;
  }

  if (Date.now() > pending.expiresAt) {
    pendingActions.delete(chatId);
    await ctx.reply("⌛ Sesi input/konfirmasi expired. Silakan ulangi dari /menu.");
    return;
  }

  if (pending.kind === "refund") {
    await handleRefundConfirmation(ctx, rawText.toUpperCase(), pending);
    return;
  }

  if (pending.kind === "credential:clear") {
    await handleCredentialClearConfirmation(ctx, rawText.toUpperCase(), pending);
    return;
  }

  if (pending.kind === "credential:set") {
    await handleCredentialValueInput(ctx, rawText, pending);
    return;
  }

  if (pending.kind === "restart") {
    await handleRestartConfirmation(ctx, rawText.toUpperCase(), pending);
  }
}

async function handleRefundConfirmation(
  ctx: Context,
  text: string,
  pending: Extract<PendingAction, { kind: "refund" }>,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!["YA", "YES", "Y", "TIDAK", "NO", "N"].includes(text)) {
    await ctx.reply("Balas *YA* untuk konfirmasi refund atau *TIDAK* untuk batal.", {
      parse_mode: "Markdown",
    });
    return;
  }

  pendingActions.delete(chatId);

  const isYes = ["YA", "YES", "Y"].includes(text);
  if (!isYes) {
    await ctx.reply("Refund dibatalkan.");
    return;
  }

  try {
    const updated = await refundPayment(pending.txId);
    auditLogStore.record({
      action: "telegram.refund",
      actor: `chat:${chatId}`,
      targetType: "transaction",
      targetId: updated.id,
      details: {
        orderId: updated.orderId,
        amount: updated.amount,
        currency: updated.currency,
        username: ctx.from?.username,
      },
    });

    await ctx.reply(
      `✅ Refund sukses\n\nOrder: \`${escapeMarkdown(updated.orderId)}\`\nStatus: ${updated.status}`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await ctx.reply(`❌ Refund gagal: ${(err as Error).message}`);
  }
}

async function handleCredentialClearConfirmation(
  ctx: Context,
  text: string,
  pending: Extract<PendingAction, { kind: "credential:clear" }>,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!["YA", "YES", "Y", "TIDAK", "NO", "N"].includes(text)) {
    await ctx.reply("Balas *YA* untuk hapus override atau *TIDAK* untuk batal.", {
      parse_mode: "Markdown",
    });
    return;
  }

  pendingActions.delete(chatId);
  const isYes = ["YA", "YES", "Y"].includes(text);
  if (!isYes) {
    await ctx.reply("Hapus credential dibatalkan.");
    return;
  }

  try {
    settingsStore.setCredential(pending.provider, pending.field, "");
    auditLogStore.record({
      action: "telegram.credentials.clear",
      actor: `chat:${chatId}`,
      targetType: "settings",
      targetId: `${pending.provider}.${pending.field}`,
      details: { provider: pending.provider, field: pending.field, username: ctx.from?.username },
    });
    await ctx.reply(`✅ DB override *${pending.provider}.${pending.field}* dihapus.`, {
      parse_mode: "Markdown",
    });
    await sendCredentialProviderMenu(ctx, pending.provider);
  } catch (err) {
    await ctx.reply(`❌ Gagal hapus credential: ${(err as Error).message}`);
  }
}

async function handleCredentialValueInput(
  ctx: Context,
  value: string,
  pending: Extract<PendingAction, { kind: "credential:set" }>,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!value.trim()) {
    await ctx.reply("Nilai kosong tidak disimpan. Kirim nilai baru atau /cancel.");
    return;
  }

  try {
    settingsStore.setCredential(pending.provider, pending.field, value.trim());
    pendingActions.delete(chatId);
    auditLogStore.record({
      action: "telegram.credentials.set",
      actor: `chat:${chatId}`,
      targetType: "settings",
      targetId: `${pending.provider}.${pending.field}`,
      details: {
        provider: pending.provider,
        field: pending.field,
        valuePreview: maskSecret(value.trim()),
        username: ctx.from?.username,
      },
    });
    await ctx.reply(
      `✅ Credential *${pending.provider}.${pending.field}* tersimpan.\n\n` +
        `Preview: \`${escapeMarkdown(maskSecret(value.trim()))}\``,
      { parse_mode: "Markdown" },
    );
    await sendCredentialProviderMenu(ctx, pending.provider);
  } catch (err) {
    await ctx.reply(`❌ Gagal simpan credential: ${(err as Error).message}`);
  }
}

async function sendSettings(ctx: Context): Promise<void> {
  const settings = settingsStore.snapshot();
  const providers = getOrderedProviders();

  const orderList = settings.providerOrder.map((p, i) => `${i + 1}. ${p}`).join("\n");

  const forceDownList = providers
    .filter((p) => settingsStore.isForceDown(p.name))
    .map((p) => p.name);

  const msg =
    `⚙️ *Gateway Settings*\n\n` +
    `*Provider Order (Fallback):*\n${orderList}\n\n` +
    `*Force Down:* ${forceDownList.length > 0 ? forceDownList.join(", ") : "Tidak ada"}\n\n` +
    `Gunakan command berikut untuk mengubah:\n` +
    `/provider order <list>` +
    ` — Ubah urutan\n` +
    `/provider enable <name>` +
    ` — Aktifkan provider\n` +
    `/provider disable <name>` +
    ` — Nonaktifkan provider`;

  await ctx.reply(msg, { parse_mode: "Markdown" });
}

async function handleProviderCommand(
  ctx: Context,
  args: string[],
): Promise<void> {
  if (args.length === 0) {
    await ctx.reply(
      `Format command:\n\n` +
        `/provider order midtrans,xendit,autogopay` +
        ` — Ubah urutan fallback\n` +
        `/provider enable <name>` +
        ` — Aktifkan provider\n` +
        `/provider disable <name>` +
        ` — Nonaktifkan provider\n\n` +
        `Provider tersedia: midtrans, xendit, doku, tripay, orderkuota, autogopay`,
    );
    return;
  }

  const subcommand = args[0].toLowerCase();
  const chatId = String(ctx.chat?.id ?? "");

  try {
    if (subcommand === "order") {
      if (args.length < 2) {
        await ctx.reply("Format: /provider order midtrans,xendit,autogopay");
        return;
      }
      const newOrder = args[1].split(",").map((s) => s.trim());
      const validProviders = ["midtrans", "xendit", "doku", "tripay", "orderkuota", "autogopay"];

      // Validasi
      for (const p of newOrder) {
        if (!validProviders.includes(p)) {
          await ctx.reply(`❌ Provider tidak valid: ${p}\n\nProvider tersedia: ${validProviders.join(", ")}`);
          return;
        }
      }

      if (newOrder.length === 0) {
        await ctx.reply("❌ Minimal harus ada 1 provider");
        return;
      }

      const before = settingsStore.snapshot().providerOrder;
      settingsStore.setProviderOrder(newOrder as any);

      auditLogStore.record({
        action: "telegram.provider.order",
        actor: `chat:${chatId}`,
        targetType: "settings",
        details: {
          before,
          after: newOrder,
          username: ctx.from?.username,
        },
      });

      await ctx.reply(
        `✅ *Provider order diubah*\n\n` +
          `Urutan baru:\n${newOrder.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
        { parse_mode: "Markdown" },
      );
    } else if (subcommand === "enable" || subcommand === "disable") {
      if (args.length < 2) {
        await ctx.reply(`Format: /provider ${subcommand} <provider_name>`);
        return;
      }

      const providerName = args[1].toLowerCase();
      const validProviders = ["midtrans", "xendit", "doku", "tripay", "orderkuota", "autogopay"];

      if (!validProviders.includes(providerName)) {
        await ctx.reply(`❌ Provider tidak valid: ${providerName}\n\nProvider tersedia: ${validProviders.join(", ")}`);
        return;
      }

      const forceDown = subcommand === "disable";
      settingsStore.setForceDown(providerName as any, forceDown);

      auditLogStore.record({
        action: `telegram.provider.${subcommand}`,
        actor: `chat:${chatId}`,
        targetType: "settings",
        targetId: providerName,
        details: {
          provider: providerName,
          forceDown,
          username: ctx.from?.username,
        },
      });

      const emoji = forceDown ? "⏸️" : "✅";
      const status = forceDown ? "dinonaktifkan" : "diaktifkan";
      await ctx.reply(`${emoji} Provider *${providerName}* ${status}`, {
        parse_mode: "Markdown",
      });
    } else {
      await ctx.reply(`❌ Subcommand tidak dikenal: ${subcommand}\n\nGunakan: order, enable, atau disable`);
    }
  } catch (err) {
    await ctx.reply(`❌ Error: ${(err as Error).message}`);
  }
}

async function confirmRestartServer(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  pendingActions.set(chatId, { kind: "restart", expiresAt: Date.now() + 30_000 });

  await ctx.reply(
    `⚠️ *RESTART SERVER?*\n\n` +
      `Server akan mati lalu hidup lagi jika service manager aktif.\n\n` +
      `Balas *YA* dalam 30 detik untuk konfirmasi, atau *TIDAK* untuk batal.`,
    { parse_mode: "Markdown" },
  );
}

async function handleRestartConfirmation(
  ctx: Context,
  text: string,
  _pending: Extract<PendingAction, { kind: "restart" }>,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!["YA", "YES", "Y", "TIDAK", "NO", "N"].includes(text)) {
    await ctx.reply("Balas *YA* untuk restart atau *TIDAK* untuk batal.", {
      parse_mode: "Markdown",
    });
    return;
  }

  pendingActions.delete(chatId);
  const isYes = ["YA", "YES", "Y"].includes(text);
  if (!isYes) {
    await ctx.reply("Restart dibatalkan.");
    return;
  }

  auditLogStore.record({
    action: "telegram.system.restart",
    actor: `chat:${chatId}`,
    targetType: "system",
    details: {
      note: "Server restart confirmed via Telegram bot",
      processId: process.pid,
      username: ctx.from?.username,
    },
  });

  await ctx.reply(
    `🔄 Server akan restart dalam 3 detik...\n\n` +
      `Bot akan offline sebentar. Tunggu beberapa saat lalu coba command lagi.`,
  );

  setTimeout(() => {
    logger.info("Server restart initiated by Telegram bot");
    process.exit(0);
  }, 3000);
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function toProviderName(value: string | undefined): ProviderName | null {
  if (!value) return null;
  return (VALID_PROVIDERS as string[]).includes(value) ? (value as ProviderName) : null;
}

function isCredentialField(
  provider: ProviderName,
  field: string | undefined,
): field is CredentialField {
  if (!field) return false;
  return (CREDENTIAL_FIELDS_BY_PROVIDER[provider] as readonly string[]).includes(field);
}

function providerLabel(provider: ProviderName): string {
  const labels: Record<ProviderName, string> = {
    midtrans: "Midtrans",
    xendit: "Xendit",
    doku: "DOKU",
    tripay: "Tripay",
    orderkuota: "OrderKuota",
    autogopay: "AutoGoPay",
  };
  return labels[provider];
}

function authorize(ctx: Context): boolean {
  const chatIdStr = String(ctx.chat?.id ?? "");
  if (!chatIdStr || !adminChatIds.includes(chatIdStr)) {
    // Silent ignore — tidak balas, supaya tidak leak info ke orang random
    logger.warn(
      {
        chatId: chatIdStr,
        username: ctx.from?.username,
      },
      "Telegram unauthorized access attempt",
    );
    return false;
  }
  // Rate limit
  const now = Date.now();
  let counter = messageCounters.get(chatIdStr);
  if (!counter || counter.resetAt < now) {
    counter = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    messageCounters.set(chatIdStr, counter);
  }
  counter.count++;
  if (counter.count > RATE_LIMIT_MAX) {
    ctx.reply("⚠️ Rate limit. Tunggu 1 menit.").catch(() => {});
    return false;
  }
  return true;
}

function statusEmoji(status: PaymentStatus): string {
  switch (status) {
    case "success":
      return "✅";
    case "pending":
      return "⏳";
    case "failed":
      return "❌";
    case "expired":
      return "⌛";
    case "refunded":
      return "↩️";
    default:
      return "·";
  }
}

function countByStatus(
  txs: Array<{ status: PaymentStatus }>,
): Record<PaymentStatus, number> {
  const out: Record<PaymentStatus, number> = {
    pending: 0,
    success: 0,
    failed: 0,
    expired: 0,
    refunded: 0,
  };
  for (const t of txs) out[t.status]++;
  return out;
}

function formatAmount(amount: number, currency: string): string {
  if (currency === "IDR") {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  }
  return `${currency} ${amount.toLocaleString("id-ID")}`;
}

/**
 * Escape karakter Markdown khusus supaya order ID dengan dash/underscore
 * tidak bikin Telegram parse error.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, "\\$1");
}

async function safe<T>(fn: () => Promise<T>): Promise<T | false> {
  try {
    return await fn();
  } catch {
    return false as T | false;
  }
}
