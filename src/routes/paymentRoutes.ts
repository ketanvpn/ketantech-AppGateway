import { Router, RequestHandler } from "express";
import { z } from "zod";
import { chargePayment } from "../services/paymentService";
import { transactionStore } from "../store/transactionStore";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { clientAuth } from "../middleware/auth";
import { GatewayError } from "../types";

const chargeSchema = z.object({
  orderId: z.string().min(1).max(64),
  amount: z.number().positive().int(),
  currency: z.string().length(3),
  method: z.enum(["credit_card", "bank_transfer", "ewallet", "qris"]),
  customer: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(160),
    phone: z.string().max(32).optional(),
  }),
  description: z.string().max(255).optional(),
});

/** Wrapper agar async error otomatis ke errorHandler */
const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const paymentRoutes = Router();

// Semua endpoint /payments diauth (kalau CLIENT_API_KEYS di-set).
// Cegah enumerasi transaksi & expose PII customer.
paymentRoutes.use(clientAuth);

/**
 * POST /api/v1/payments/charge
 * Header wajib: Idempotency-Key
 */
paymentRoutes.post(
  "/charge",
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const parsed = chargeSchema.parse(req.body);
    const record = await chargePayment(parsed);
    res.status(201).json({ data: record });
  }),
);

/** GET /api/v1/payments/:id */
paymentRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const record = transactionStore.findById(req.params.id);
    if (!record) {
      throw new GatewayError("NOT_FOUND", "Transaction not found", 404);
    }
    res.json({ data: record });
  }),
);

/** GET /api/v1/payments?orderId=... */
paymentRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.query.orderId) {
      const record = transactionStore.findByOrderId(String(req.query.orderId));
      if (!record) {
        throw new GatewayError("NOT_FOUND", "Transaction not found", 404);
      }
      res.json({ data: record });
      return;
    }
    // Tanpa filter orderId — kita TIDAK return all transactions di endpoint
    // public ini supaya tidak bocor data. Pakai /api/v1/admin/transactions
    // (admin auth) kalau butuh list.
    throw new GatewayError(
      "BAD_REQUEST",
      "Query 'orderId' wajib. Untuk list semua, pakai /api/v1/admin/transactions.",
      400,
    );
  }),
);
