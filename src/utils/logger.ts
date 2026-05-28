import pino from "pino";
import { config } from "../config";

/**
 * Pino logger dengan PII redaction.
 *
 * Field yang dianggap sensitif (email, phone, customer name, secret keys)
 * akan diganti dengan "[REDACTED]" sebelum di-log. Kepada storage log
 * eksternal, hanya request shape yang ter-log, bukan data customer.
 *
 * Path redact pakai dot-notation Pino: https://getpino.io/#/docs/redaction
 */
const REDACT_PATHS = [
  // Body request
  "req.body.customer.email",
  "req.body.customer.phone",
  "req.body.customer.name",
  "body.customer.email",
  "body.customer.phone",
  "body.customer.name",
  "customer.email",
  "customer.phone",
  "customer.name",

  // Headers yang berisi secret
  'req.headers["x-admin-key"]',
  'req.headers["x-client-key"]',
  'req.headers["x-callback-token"]',
  'req.headers["idempotency-key"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers["x-admin-key"]',
  'headers["x-client-key"]',
  'headers["x-callback-token"]',
  'headers.authorization',
  'headers.cookie',

  // Provider credentials yang nyasar masuk log
  "serverKey",
  "secretKey",
  "privateKey",
  "callbackToken",
  "apiKey",
  "authToken",
  "password",
  "token",

  // Telegram bot token (kalau ke-spread accident)
  "req.body.botToken",
  "body.botToken",
  "botToken",
  "telegramBotToken",
  "TELEGRAM_BOT_TOKEN",

  // OTP code (sensitive temporary credential)
  "otp",
  "otpCode",
];


export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  transport:
    config.nodeEnv === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});
