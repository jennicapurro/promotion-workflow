/**
 * utils/logger.ts
 *
 * Structured Winston logger. Every log line emits JSON in production for easy
 * ingestion by Union Station's log aggregator. In development, logs are pretty-
 * printed for readability.
 *
 * Always log with a correlationId (see correlation.ts) so you can trace a single
 * promotion through every step.
 */

import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, correlationId, ...meta }) => {
    const cid = correlationId ? ` [${correlationId}]` : '';
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}${cid}: ${message}${extra}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = winston.createLogger({
  level: config.app.logLevel,
  format: config.app.env === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'promotion-workflow' },
  transports: [new winston.transports.Console()],
});

/** Returns a child logger pre-bound with a correlation ID. */
export function childLogger(correlationId: string): winston.Logger {
  return logger.child({ correlationId });
}
