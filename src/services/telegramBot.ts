import TelegramBot from "node-telegram-bot-api";
import { logger } from "../utils/logger";
import { transactionStore } from "../store/transactionStore";
import { settingsStore } from "../store/settingsStore";
import { getOrderedProviders } from "../providers";
import { syncOrderKuotaStatus } from "./orderkuotaSyncService";
import { refundPayment } from "./refundService";
import { PaymentStatus, ProviderName } from "../types";

/**
 * Telegram bot integration — notifikasi event + command interaktif untuk admin.
 *
 * Dua peran utama:
 *  1. **Notifier** — push event penting ke chat admin (charge sukses, provider down,
 *     refund, error rate tinggi, OrderKuota token expired).
 *  2. **Interactive bot** — admin bisa chat command untuk cek status / control gateway:
 *     /stats, /last, /refund, /health, /sync, /help.
 *
 * Auth: hanya chat ID yang ada di TELEGRAM_ADMIN_CHAT_IDS yang boleh kirim command.
 * Tanpa whitelist ini, siapa pun yang tahu username bot bisa control gateway —
 * tidak boleh.
 *
 * Rate limit chat: tiap chat dibatasi 30 message/menit (cegah spam loop bug).
 */

let bot: TelegramBot | null = null;
let adminChatIds: string[] = [];
let notificationsEnabled = false;

// Rate limit per chat ID
const messageCounters = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getEnv(): { token: string; chatIds: string[]; enabled: boolean } {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const enabled = Boolean(token) && chatIds.length > 0;
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
    bot = new TelegramBot(token, { polling: true });
    adminChatIds = chatIds;
    notificationsEnabled = true;

    setupCommands();

    bot.on("polling_error", (err: Error) => {
      logger.error({ err: err.message }, "Telegram bot polling error");
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
    bot.stopPolling().catch(() => {});
    bot = null;
    notificationsEnabled = false;
    logger.info("Telegram bot stopped");
  }
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
    `Order ID: \`${tx.orderId}\`\n` +
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
    `Order ID: \`${tx.orderId}\`\n` +
    `Jumlah: ${formatAmount(tx.amount, tx.currency)}\n` +
    (tx.reason ? `Alasan: ${tx.reason}\n` : "");
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
    `💸 *Refund*\n\nOrder ID: \`${tx.orderId}\`\nJumlah: ${formatAmount(tx.amount, tx.currency)}`,
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
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
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

function setupCommands(): void {
  if (!bot) return;

  bot.onText(/^\/start$|^\/help$/, async (msg: TelegramBot.Message) => {
    if (!authorize(msg)) return;
    await bot!.sendMessage(
      msg.chat.id,
      `*KetantechPay Bot* 🤖\n\n` +
        `Available commands:\n\n` +
        `/stats — Ringkasan transaksi hari ini\n` +
        `/last [n] — n transaksi terakhir (default 5)\n` +
        `/health — Status semua provider\n` +
        `/sync — Trigger OrderKuota sync mutasi\n` +
        `/refund <orderId> — Refund transaksi (idempotent)\n` +
        `/help — Tampilkan menu ini\n\n` +
        `Notifikasi otomatis aktif untuk: pembayaran sukses, refund, provider down.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.onText(/^\/stats$/, async (msg: TelegramBot.Message) => {
    if (!authorize(msg)) return;
    await sendStats(msg.chat.id);
  });

  bot.onText(/^\/last(?:\s+(\d+))?$/, async (msg: TelegramBot.Message, match) => {
    if (!authorize(msg)) return;
    const n = match?.[1] ? parseInt(match[1], 10) : 5;
    await sendLastTransactions(msg.chat.id, Math.min(20, Math.max(1, n)));
  });

  bot.onText(/^\/health$/, async (msg: TelegramBot.Message) => {
    if (!authorize(msg)) return;
    await sendHealth(msg.chat.id);
  });

  bot.onText(/^\/sync$/, async (msg: TelegramBot.Message) => {
    if (!authorize(msg)) return;
    await runOrderKuotaSync(msg.chat.id);
  });

  bot.onText(/^\/refund\s+(\S+)$/, async (msg: TelegramBot.Message, match) => {
    if (!authorize(msg)) return;
    const orderId = match?.[1];
    if (!orderId) return;
    await runRefund(msg.chat.id, orderId);
  });
}

async function sendStats(chatId: number): Promise<void> {
  if (!bot) return;
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

  await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

async function sendLastTransactions(chatId: number, n: number): Promise<void> {
  if (!bot) return;
  const all = transactionStore.list().slice(0, n);
  if (all.length === 0) {
    await bot.sendMessage(chatId, "Belum ada transaksi.");
    return;
  }
  const lines = all.map((t, i) => {
    const emoji = statusEmoji(t.status);
    const time = new Date(t.createdAt).toLocaleString("id-ID", {
      dateStyle: "short",
      timeStyle: "short",
    });
    return (
      `${i + 1}. ${emoji} \`${t.orderId}\`\n` +
      `   ${formatAmount(t.amount, t.currency)} · ${t.providerName} · ${time}`
    );
  });
  await bot.sendMessage(
    chatId,
    `*${n} Transaksi Terakhir*\n\n` + lines.join("\n\n"),
    { parse_mode: "Markdown" },
  );
}

async function sendHealth(chatId: number): Promise<void> {
  if (!bot) return;
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
  await bot.sendMessage(
    chatId,
    `*Provider Health*\n\n` + lines.join("\n"),
    { parse_mode: "Markdown" },
  );
}

async function runOrderKuotaSync(chatId: number): Promise<void> {
  if (!bot) return;
  await bot.sendMessage(chatId, "🔄 Syncing OrderKuota mutasi...");
  try {
    const res = await syncOrderKuotaStatus();
    await bot.sendMessage(
      chatId,
      `✅ Sync selesai\n\n` +
        `Pending: ${res.pendingCount}\n` +
        `Mutasi diperiksa: ${res.mutasiCount}\n` +
        `Match: *${res.matched}*`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await bot.sendMessage(
      chatId,
      `❌ Sync gagal: ${(err as Error).message}`,
    );
  }
}

async function runRefund(chatId: number, orderId: string): Promise<void> {
  if (!bot) return;
  // Cari transaksi by orderId (atau ID langsung)
  const tx =
    transactionStore.findByOrderId?.(orderId) ??
    transactionStore.findById(orderId);
  if (!tx) {
    await bot.sendMessage(chatId, `❌ Transaksi \`${orderId}\` tidak ditemukan.`, {
      parse_mode: "Markdown",
    });
    return;
  }
  await bot.sendMessage(
    chatId,
    `Refund \`${tx.orderId}\` sebesar ${formatAmount(tx.amount, tx.currency)}?\n\nKirim balik *YA* dalam 30 detik untuk konfirmasi.`,
    { parse_mode: "Markdown" },
  );
  // Wait for confirmation
  const confirmed = await waitForConfirmation(chatId, 30_000);
  if (!confirmed) {
    await bot.sendMessage(chatId, "Refund dibatalkan.");
    return;
  }
  try {
    const updated = await refundPayment(tx.id);
    await bot.sendMessage(
      chatId,
      `✅ Refund sukses\n\nOrder: \`${updated.orderId}\`\nStatus: ${updated.status}`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await bot.sendMessage(
      chatId,
      `❌ Refund gagal: ${(err as Error).message}`,
    );
  }
}

function waitForConfirmation(chatId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!bot) return resolve(false);
    const handler = (msg: TelegramBot.Message) => {
      if (String(msg.chat.id) !== String(chatId)) return;
      if (!msg.text) return;
      const txt = msg.text.trim().toUpperCase();
      if (txt === "YA" || txt === "YES" || txt === "Y") {
        bot!.removeListener("message", handler);
        clearTimeout(t);
        resolve(true);
      } else if (txt === "TIDAK" || txt === "NO" || txt === "N") {
        bot!.removeListener("message", handler);
        clearTimeout(t);
        resolve(false);
      }
    };
    bot.on("message", handler);
    const t = setTimeout(() => {
      bot!.removeListener("message", handler);
      resolve(false);
    }, timeoutMs);
  });
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function authorize(msg: TelegramBot.Message): boolean {
  const chatIdStr = String(msg.chat.id);
  if (!adminChatIds.includes(chatIdStr)) {
    // Silent ignore — tidak balas, supaya tidak leak info ke orang random
    logger.warn(
      { chatId: chatIdStr, username: msg.from?.username },
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
    bot
      ?.sendMessage(chatIdStr, "⚠️ Rate limit. Tunggu 1 menit.")
      .catch(() => {});
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

async function safe<T>(fn: () => Promise<T>): Promise<T | false> {
  try {
    return await fn();
  } catch {
    return false as T | false;
  }
}
