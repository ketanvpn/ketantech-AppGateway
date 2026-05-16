import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { GatewayError } from "../types";
import { logger } from "../utils/logger";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid request body",
      details: err.errors,
    });
    return;
  }

  if (err instanceof GatewayError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }

  logger.error({ err }, "unhandled error");
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
  });
};
