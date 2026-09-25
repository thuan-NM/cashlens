import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Request correlation (ERR-006). Every request gets a fresh opaque id: a
 * random UUID generated here, never taken from the client (the spec allows
 * no client-supplied id, and trusting one would let a caller forge or
 * collide log entries). The id is returned in this header and in every
 * response body, and pino-http logs it as the request id.
 */
export const CORRELATION_HEADER = 'x-correlation-id';

type WithId = IncomingMessage & { id?: unknown };

/** The request's correlation id, assigning one if the request has none. */
export const correlationIdOf = (req: IncomingMessage): string => {
  const request = req as WithId;
  if (typeof request.id !== 'string' || request.id === '') {
    request.id = randomUUID();
  }
  return request.id;
};

/**
 * First middleware of the pipeline: assigns the id (overwriting anything a
 * client sent) and exposes it in the response header.
 */
export const assignCorrelationId = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void => {
  (req as WithId).id = randomUUID();
  res.setHeader(CORRELATION_HEADER, correlationIdOf(req));
  next();
};
