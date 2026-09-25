import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { CORRELATION_HEADER, correlationIdOf } from '../http/correlation';

/**
 * The global safe exception filter (ERR-001–ERR-006). Every error response
 * keeps the Nest shape and adds a stable `code` and the request's
 * `correlationId` (contracts/openapi.yaml `Error`):
 *
 *   { statusCode, message, error, code, correlationId, fields? }
 *
 * - An HttpException keeps its status, message, and reason phrase, and its
 *   application code when it has one (RECONNECT_REQUIRED, ALERT_RESOLVED,
 *   ...); otherwise the code is derived from the status. Only these keys are
 *   copied, so nothing else a thrower attached can leak.
 * - A database outage (Prisma cannot connect, times out, or the connection
 *   pool is exhausted) is 503 SERVICE_UNAVAILABLE with a fixed message
 *   (ERR-004).
 * - Anything else is 500 INTERNAL_ERROR with a fixed message. The exception's
 *   message, stack, SQL, and provider text never reach the response; the
 *   operator log gets the exception class and, for Prisma, its error code.
 *
 * 401, 403, and owner-safe 404 keep their status and wording exactly.
 */

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/** The standard reason phrase: 413 -> "Payload Too Large". */
export const reasonFor = (status: number): string =>
  String(HttpStatus[status] ?? 'Error')
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** Prisma errors that mean the database is unreachable or overloaded. */
const UNAVAILABLE_PRISMA_CODES = new Set([
  'P1001', // cannot reach the database server
  'P1002', // the server timed out
  'P1008', // operation timed out
  'P1017', // the server closed the connection
  'P2024', // timed out fetching a connection from the pool
  'P2037', // too many database connections
]);

/** Driver-adapter error kinds that mean the database cannot serve. */
const UNAVAILABLE_ADAPTER_KINDS = new Set([
  'DatabaseNotReachable',
  'TooManyConnections',
  'SocketTimeout',
  'ConnectionClosed',
]);

/** Socket failures of the pg driver. */
const SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
]);

/** SQLSTATE: connection exceptions (08), shutdown (57P01-57P03), too many clients. */
const UNAVAILABLE_SQLSTATE = /^(08[0-9A-Z]{3}|57P0[1-3]|53300)$/;

/** JSON.parse messages that Nest turns into a 400 carrying the parser text. */
const JSON_PARSE_MESSAGE =
  /(is not valid JSON|Unexpected (token|end of JSON|non-whitespace)|JSON at position|Expected (property name|',' or|double-quoted)|Bad control character|Unterminated string in JSON)/;

export type ApiErrorBody = {
  statusCode: number;
  message: string | string[];
  error: string;
  code: string;
  correlationId: string;
  fields?: Record<string, string[]>;
};

const codeFor = (status: number) => DEFAULT_CODES[status] ?? `HTTP_${status}`;

const isFieldMap = (value: unknown): value is Record<string, string[]> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((text) => typeof text === 'string'),
  );

const isSafeMessage = (value: unknown): value is string | string[] =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));

/**
 * Whether a thrown value means the database is unavailable (ERR-004). With
 * the pg driver adapter the evidence can sit on the Prisma error, on its
 * `cause`, or on the adapter error it carries in `meta`, or the raw pg
 * error can arrive unwrapped.
 */
export const isDatabaseUnavailable = (exception: unknown): boolean => {
  if (exception instanceof Prisma.PrismaClientInitializationError) return true;
  const meta = (exception as { meta?: Record<string, unknown> } | null)?.meta;
  const adapter = meta?.driverAdapterError as { cause?: unknown } | undefined;
  const candidates = [
    exception,
    (exception as { cause?: unknown } | null)?.cause,
    adapter,
    adapter?.cause,
  ];
  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    if (candidate instanceof HttpException) return false;
    if (
      candidate instanceof Prisma.PrismaClientKnownRequestError &&
      UNAVAILABLE_PRISMA_CODES.has(candidate.code)
    ) {
      return true;
    }
    const { code, kind, originalCode, message } = candidate as Record<
      string,
      unknown
    >;
    if (typeof kind === 'string' && UNAVAILABLE_ADAPTER_KINDS.has(kind)) {
      return true;
    }
    for (const value of [code, originalCode]) {
      if (
        typeof value === 'string' &&
        (UNAVAILABLE_SQLSTATE.test(value) || SOCKET_CODES.has(value))
      ) {
        return true;
      }
    }
    return (
      typeof message === 'string' && /^Connection terminated/.test(message)
    );
  });
};

/** The public body for any thrown value; never includes exception text. */
export function toErrorBody(
  exception: unknown,
  correlationId: string,
): ApiErrorBody {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const shape: Record<string, unknown> =
      typeof response === 'string'
        ? { message: response }
        : (response as Record<string, unknown>);
    let message = isSafeMessage(shape.message)
      ? shape.message
      : exception.message;
    const code = typeof shape.code === 'string' ? shape.code : codeFor(status);
    if (
      status === 400 &&
      typeof message === 'string' &&
      JSON_PARSE_MESSAGE.test(message)
    ) {
      // A body-parser SyntaxError that Nest mapped: its text quotes the body.
      message = 'Request body is not valid JSON';
    }
    if (status === 404 && typeof message === 'string') {
      // Nest's unknown-route message: keep the path, drop the query string.
      message = message.replace(/^(Cannot \w+ [^?\s]*)\?\S*$/, '$1');
    }
    if (status === 500 && typeof shape.code !== 'string') {
      // An unexpected 500 never carries its thrower's text.
      message = 'Internal server error';
    }
    const body: ApiErrorBody = {
      statusCode: status,
      message,
      error: typeof shape.error === 'string' ? shape.error : reasonFor(status),
      code,
      correlationId,
    };
    if (isFieldMap(shape.fields)) body.fields = shape.fields;
    return body;
  }
  if (isDatabaseUnavailable(exception)) {
    return {
      statusCode: 503,
      message: 'Service temporarily unavailable',
      error: 'Service Unavailable',
      code: 'SERVICE_UNAVAILABLE',
      correlationId,
    };
  }
  // Express/body-parser errors (for example a body that is not valid JSON)
  // carry a client status and a fixed `type`; their text is not echoed.
  const parserError = exception as { status?: unknown; type?: unknown };
  if (
    typeof parserError?.status === 'number' &&
    parserError.status >= 400 &&
    parserError.status < 500 &&
    typeof parserError.type === 'string'
  ) {
    const status = parserError.status;
    return {
      statusCode: status,
      message:
        parserError.type === 'entity.parse.failed'
          ? 'Request body is not valid JSON'
          : 'Invalid request',
      error: reasonFor(status),
      code: codeFor(status),
      correlationId,
    };
  }
  return {
    statusCode: 500,
    message: 'Internal server error',
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    correlationId,
  };
}

/**
 * Sanitized operator detail: the class, the Prisma code, and the stack frames
 * (where it failed). The message line is left out: exception messages can
 * embed query arguments or provider text.
 */
export const describeFailure = (exception: unknown) => ({
  errorName:
    exception instanceof Error ? exception.constructor.name : typeof exception,
  ...(exception instanceof Prisma.PrismaClientKnownRequestError
    ? { prismaCode: exception.code }
    : {}),
  ...(exception instanceof Error && typeof exception.stack === 'string'
    ? {
        stackFrames: exception.stack
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 12)
          .map((line) => line.trim()),
      }
    : {}),
});

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const correlationId = correlationIdOf(request);
    const body = toErrorBody(exception, correlationId);

    // Requests refused before the request logger ran (body-parser errors)
    // have no request line: this is their only log evidence (ERR-006).
    const logged = Boolean((request as { log?: unknown }).log);
    if (body.statusCode >= 500) {
      this.logger.error({
        event: 'request.failed',
        ...(logged ? {} : { correlationId }),
        statusCode: body.statusCode,
        errorCode: body.code,
        method: request.method,
        route: routeOf(request),
        ...describeFailure(exception),
      });
    } else if (!logged) {
      this.logger.warn({
        event: 'request.rejected',
        correlationId,
        statusCode: body.statusCode,
        errorCode: body.code,
        method: request.method,
      });
    }
    if (response.headersSent) {
      // Too late for a body: close the response, as Nest's own filter does.
      response.end();
      return;
    }
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.status(body.statusCode).json(body);
  }
}

/** The matched route pattern, never the concrete URL (ids, query values). */
const routeOf = (request: Request): string | undefined => {
  const route = (request as { route?: { path?: unknown } }).route;
  return typeof route?.path === 'string'
    ? `${request.baseUrl ?? ''}${route.path}`
    : undefined;
};
