import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldValidationPipe } from '../pipes/field-validation.pipe';
import {
  ApiExceptionFilter,
  describeFailure,
  isDatabaseUnavailable,
  toErrorBody,
} from './api-exception.filter';

/** T093: the public error body for every kind of thrown value. */

const ID = 'c0ffee00-0000-4000-8000-000000000000';
const SECRET = 'synthetic-leak-secret';

describe('toErrorBody (T093)', () => {
  it.each([
    [new UnauthorizedException(), 401, 'UNAUTHORIZED', 'Unauthorized'],
    [new ForbiddenException(), 403, 'FORBIDDEN', 'Forbidden'],
    [
      new NotFoundException('Transaction not found'),
      404,
      'NOT_FOUND',
      'Transaction not found',
    ],
    [new ConflictException('Busy'), 409, 'CONFLICT', 'Busy'],
    [
      new BadRequestException(['a must be b']),
      400,
      'BAD_REQUEST',
      ['a must be b'],
    ],
  ])(
    '%p keeps its status and message with a derived code',
    (exception, status, code, message) => {
      expect(toErrorBody(exception, ID)).toEqual({
        statusCode: status,
        message,
        error: expect.any(String) as string,
        code,
        correlationId: ID,
      });
    },
  );

  it('keeps an application code and fields, and drops any other key', () => {
    const body = toErrorBody(
      new ServiceUnavailableException({
        statusCode: 503,
        message: 'Reconnect Gmail to continue synchronizing',
        error: 'Service Unavailable',
        code: 'RECONNECT_REQUIRED',
        fields: { connection: ['expired'] },
        stack: SECRET,
        token: SECRET,
      }),
      ID,
    );
    expect(body).toEqual({
      statusCode: 503,
      message: 'Reconnect Gmail to continue synchronizing',
      error: 'Service Unavailable',
      code: 'RECONNECT_REQUIRED',
      correlationId: ID,
      fields: { connection: ['expired'] },
    });
  });

  it('ignores a malformed fields value', () => {
    const body = toErrorBody(
      new BadRequestException({ message: 'x', fields: { a: SECRET } }),
      ID,
    );
    expect(body).not.toHaveProperty('fields');
  });

  it('an HttpException with a string response', () => {
    expect(toErrorBody(new HttpException('Gone away', 410), ID)).toMatchObject({
      statusCode: 410,
      message: 'Gone away',
      code: 'HTTP_410',
    });
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])(
    'Prisma %s is a 503 with a fixed message',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError(SECRET, {
        code,
        clientVersion: '7.7.0',
      });
      expect(isDatabaseUnavailable(error)).toBe(true);
      expect(toErrorBody(error, ID)).toEqual({
        statusCode: 503,
        message: 'Service temporarily unavailable',
        error: 'Service Unavailable',
        code: 'SERVICE_UNAVAILABLE',
        correlationId: ID,
      });
    },
  );

  it('a Prisma initialization error is a 503', () => {
    const error = new Prisma.PrismaClientInitializationError(SECRET, '7.7.0');
    expect(toErrorBody(error, ID).statusCode).toBe(503);
  });

  it.each([
    new Prisma.PrismaClientKnownRequestError(SECRET, {
      code: 'P2002',
      clientVersion: '7.7.0',
    }),
    new Error(SECRET),
    new TypeError(SECRET),
    SECRET,
    undefined,
    { status: 200, type: 'weird', message: SECRET },
  ])(
    'anything else is a generic 500 that never carries its text (%#)',
    (error) => {
      const body = toErrorBody(error, ID);
      expect(body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        correlationId: ID,
      });
      expect(JSON.stringify(body)).not.toContain(SECRET);
    },
  );

  it('a body-parser failure is a 400 without the parser text', () => {
    const error = Object.assign(new SyntaxError(`Unexpected token ${SECRET}`), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(toErrorBody(error, ID)).toEqual({
      statusCode: 400,
      message: 'Request body is not valid JSON',
      error: 'Bad Request',
      code: 'BAD_REQUEST',
      correlationId: ID,
    });
  });
});

describe('review findings (T093 review)', () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(SECRET, {
      code,
      clientVersion: '7.7.0',
      meta,
    });

  it.each([
    ['P2037 too many connections', known('P2037')],
    [
      'an adapter TooManyConnections kind',
      known('P2010', {
        driverAdapterError: { cause: { kind: 'TooManyConnections' } },
      }),
    ],
    [
      'an unmapped postgres 57P01 (admin shutdown)',
      known('P2010', {
        driverAdapterError: { cause: { kind: 'postgres', code: '57P01' } },
      }),
    ],
    [
      'an unmapped postgres 57P03 (starting up)',
      known('P2010', {
        driverAdapterError: {
          cause: { kind: 'postgres', originalCode: '57P03' },
        },
      }),
    ],
    [
      'a raw pg "Connection terminated unexpectedly"',
      new Error('Connection terminated unexpectedly'),
    ],
    [
      'a raw socket ECONNRESET',
      Object.assign(new Error(SECRET), { code: 'ECONNRESET' }),
    ],
    [
      'a raw SQLSTATE 08006',
      Object.assign(new Error(SECRET), { code: '08006' }),
    ],
  ])('treats %s as a database outage (503)', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
    expect(toErrorBody(error, ID)).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it.each([
    known('P2002'),
    known('P2010', {
      driverAdapterError: { cause: { kind: 'postgres', code: '23505' } },
    }),
    Object.assign(new Error(SECRET), { code: 'ERR_SOMETHING' }),
    new ServiceUnavailableException('Service is not ready'),
  ])('keeps other failures out of the outage class (%#)', (error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });

  it('replaces the JSON parser text that Nest puts in a 400', () => {
    const body = toErrorBody(
      new BadRequestException(
        `Unexpected token 'a', "{"token": ${SECRET}"... is not valid JSON`,
      ),
      ID,
    );
    expect(body).toMatchObject({
      statusCode: 400,
      message: 'Request body is not valid JSON',
      code: 'BAD_REQUEST',
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("drops the query string from Nest's unknown-route 404", () => {
    expect(
      toErrorBody(
        new NotFoundException(`Cannot GET /api/nope?token=${SECRET}`),
        ID,
      ).message,
    ).toBe('Cannot GET /api/nope');
  });

  it('labels a 413 body-parser error with its own reason', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    expect(toErrorBody(error, ID)).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Invalid request',
    });
  });

  it('never passes a 500 HttpException message through', () => {
    expect(
      toErrorBody(new HttpException(`db said ${SECRET}`, 500), ID),
    ).toMatchObject({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('logs stack frames but not the exception message', () => {
    const detail = describeFailure(new Error(SECRET));
    expect(detail.errorName).toBe('Error');
    expect(detail.stackFrames?.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain(SECRET);
  });

  it('ends a response whose headers were already sent', () => {
    const end = jest.fn();
    const status = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ id: ID, method: 'GET' }),
        getResponse: () => ({
          headersSent: true,
          end,
          status,
          setHeader: jest.fn(),
        }),
      }),
    };
    new ApiExceptionFilter().catch(new Error(SECRET), host as never);
    expect(end).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});

describe('FieldValidationPipe (T093)', () => {
  class Dto {}
  it('groups the flat messages by property and sets VALIDATION_FAILED', () => {
    const factory = new FieldValidationPipe().createExceptionFactory();
    const exception = factory([
      {
        property: 'amount',
        constraints: { min: 'amount must not be less than 0' },
        children: [],
      },
      {
        property: 'meta',
        children: [
          {
            property: 'note',
            constraints: { isString: 'note must be a string' },
            children: [],
          },
        ],
      },
    ]);
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      message: ['amount must not be less than 0', 'meta.note must be a string'],
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      fields: {
        amount: ['amount must not be less than 0'],
        meta: ['meta.note must be a string'],
      },
    });
    void Dto;
  });
});
