import { Telegraf, Context } from "telegraf";
import { logger } from "../utils/logger";
import { transactionStore } from "../store/transactionStore";
import { settingsStore } from "../store/settingsStore";
import { getOrderedProviders } from "../providers";
import { syncOrderKuotaStatus } from "./orderkuotaSyncService";
import { refundPayment } from "./refundService";
import { auditLogStore } from "../store/auditLogStore";
import { PaymentStatus } from "../types";

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

// Pending refund confirmations (per chat)
const pendingRefunds = new Map<
  string,
  { txId: string; orderId: string; expiresAt: number }
>();
const REFUND_CONFIRM_TIMEOUT_MS = 30_000;

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
    bot = new Telegraf(token, {
      // 30 detik timeout — cukup untuk operasi sync, tidak terlalu lama
      // sampai bikin user nunggu kelamaan.
      handlerTimeout: 30_000,
    });
    adminChatIds = chatIds;
    notificationsEnabled = true;

    setupCommands(bot);

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
  b.start((ctx) => sendHelp(ctx));
  b.help((ctx) => sendHelp(ctx));

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

  // Listen untuk text yang bukan command (untuk konfirmasi YA/TIDAK)
  b.on("message", async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) return;
    const text = ctx.message.text.trim().toUpperCase();
    if (!["YA", "YES", "Y", "TIDAK", "NO", "N"].includes(text)) return;
    if (!authorize(ctx)) return;
    await handleRefundConfirmation(ctx, text);
  });
}

async function sendHelp(ctx: Context): Promise<void> {
  if (!authorize(ctx)) return;
  await ctx.reply(
    `*KetantechPay Bot* 🤖\n\n` +
      `Available commands:\n\n` +
      `/stats — Ringkasan transaksi hari ini\n` +
      `/last [n] — n transaksi terakhir (default 5, max 20)\n` +
      `/health — Status semua provider\n` +
      `/sync — Trigger OrderKuota sync mutasi\n` +
      `/refund <orderId> — Refund transaksi (idempotent)\n` +
      `/help — Tampilkan menu ini\n\n` +
      `Notifikasi otomatis aktif untuk: pembayaran sukses, gagal, refund, provider down.`,
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
  pendingRefunds.set(chatId, {
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

async function handleRefundConfirmation(
  ctx: Context,
  text: string,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const pending = pendingRefunds.get(chatId);
  if (!pending) return; // Tidak ada refund pending — abaikan

  if (Date.now() > pending.expiresAt) {
    pendingRefunds.delete(chatId);
    await ctx.reply("⌛ Konfirmasi refund expired (timeout 30 detik).");
    return;
  }

  pendingRefunds.delete(chatId);

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

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

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
