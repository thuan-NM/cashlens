import { ConflictException } from '@nestjs/common';
import type { ParserField } from '@prisma/client';
import {
  ParserEngineService,
  ParserOutputError,
} from './parser-engine.service';
import type { ParserTemplateWithFields } from './parser.mapper';
import type { ParserRepository } from './parser.repository';
import { ParserService } from './parser.service';

// T039 (EMAIL-007–EMAIL-012, TEST-002): the strict parser-output gate.
// Invalid or ambiguous output never becomes a transaction, every value is
// normalized deterministically (whatever the server timezone), and parser
// evidence carries match status and codes only, never captured text.

const field = (
  fieldName: string,
  regexPattern: string,
  normalizer: string | null = null,
  isRequired = false,
): ParserField => ({
  id: `field-${fieldName}`,
  parserTemplateId: 'tpl-1',
  fieldName,
  fieldType: 'TEXT',
  regexPattern,
  regexGroupIndex: 1,
  normalizer,
  isRequired,
  fallbackValue: null,
  priority: 100,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
});

const template = (
  over: Partial<ParserTemplateWithFields> = {},
): ParserTemplateWithFields => ({
  id: 'tpl-1',
  bankProviderId: 'bank_vcb',
  name: 'T039 synthetic balance change',
  version: 1,
  channel: 'EMAIL',
  language: 'vi',
  directionHint: null,
  subjectPattern: 'Biến động số dư',
  bodyPattern: null,
  isActive: true,
  priority: 100,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  fields: [
    field('direction', 'Loại giao dịch:\\s*([^\\n;]+)'),
    field('amount', 'Số tiền:\\s*([+-]?\\s*[\\d.,]+)', 'vnd_money', true),
    field('currency', 'Số tiền:\\s*[+-]?\\s*[\\d.,]+\\s*([^\\s\\d;]+)'),
    field(
      'transaction_time',
      'Thời gian:\\s*(\\d{1,2}/\\d{1,2}/\\d{4}(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?)',
      'vi_datetime',
      true,
    ),
    field('transaction_code', 'Số tham chiếu:\\s*([A-Za-z0-9]+)'),
    field('description', 'Nội dung:\\s*([^\\n;]+)'),
    field('balance_after', 'Số dư:\\s*([\\d.,]+)', 'vnd_money'),
  ],
  ...over,
});

const SUBJECT = 'Biến động số dư';
const RECEIVED = new Date('2026-06-20T08:31:00.000Z');
const body = (parts: Record<string, string | null>) =>
  Object.entries({
    'Loại giao dịch': 'Ghi nợ',
    'Số tiền': '-1,250,000 VND',
    'Thời gian': '20/06/2026 15:30:00',
    'Số tham chiếu': 'FT26171ABC',
    'Nội dung': 'Thanh toan QR',
    'Số dư': '8,750,000 VND',
    ...parts,
  })
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join('; ');

const ALL_MATCHED = {
  direction: 'MATCHED',
  amount: 'MATCHED',
  currency: 'MATCHED',
  transaction_time: 'MATCHED',
  transaction_code: 'MATCHED',
  description: 'MATCHED',
  balance_after: 'MATCHED',
};

describe('ParserEngineService strict output gate (T039)', () => {
  const engine = new ParserEngineService();
  const parse = (text: string, tpl = template()) =>
    engine.parse(tpl, SUBJECT, text, RECEIVED);
  const failure = (text: string, tpl = template()) => {
    try {
      parse(text, tpl);
    } catch (error: unknown) {
      return error;
    }
    return null;
  };

  let originalTz: string | undefined;
  beforeAll(() => {
    // A server far from Vietnam must still read Vietnamese bank times correctly.
    originalTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('normalizes a valid debit notification exactly, whatever the server timezone', () => {
    const result = parse(body({}));
    expect(result.normalized).toEqual({
      amount: 1250000,
      currency: 'VND',
      direction: 'EXPENSE',
      // 20/06/2026 15:30:00 in Asia/Ho_Chi_Minh (UTC+07:00).
      transactionTime: '2026-06-20T08:30:00.000Z',
      transactionCode: 'FT26171ABC',
      description: 'Thanh toan QR',
      balanceAfter: 8750000,
    });
    expect(result.evidence).toEqual(ALL_MATCHED);
  });

  it('accepts a sign that agrees with the direction and stores the positive amount', () => {
    const credit = parse(
      body({ 'Loại giao dịch': 'Ghi có', 'Số tiền': '+500,000 VNĐ' }),
    ).normalized;
    expect(credit).toMatchObject({
      amount: 500000,
      currency: 'VND',
      direction: 'INCOME',
    });
    expect(
      parse(body({ 'Số tiền': '2,000,000 VND' })).normalized,
    ).toMatchObject({ amount: 2000000, direction: 'EXPENSE' });
  });

  it.each([
    ['vnd', 'VND'],
    ['VNĐ', 'VND'],
    ['đ', 'VND'],
    ['₫', 'VND'],
    ['usd', 'USD'],
  ])('normalizes the currency %s to %s', (raw, expected) => {
    expect(
      parse(body({ 'Số tiền': `-500,000 ${raw}` })).normalized.currency,
    ).toBe(expected);
  });

  it('reads a date without a time as local midnight in Asia/Ho_Chi_Minh', () => {
    expect(
      parse(body({ 'Thời gian': '01/07/2026' })).normalized.transactionTime,
    ).toBe('2026-06-30T17:00:00.000Z');
  });

  it.each([
    [
      'a missing amount',
      { 'Số tiền': null },
      'MISSING_REQUIRED_FIELDS',
      ['amount'],
    ],
    [
      'a missing time',
      { 'Thời gian': null },
      'MISSING_REQUIRED_FIELDS',
      ['transaction_time'],
    ],
    ['a zero amount', { 'Số tiền': '0 VND' }, 'INVALID_AMOUNT', ['amount']],
    [
      'an amount beyond the supported maximum',
      { 'Số tiền': '-99,999,999,999,999,999 VND' },
      'INVALID_AMOUNT',
      ['amount'],
    ],
    [
      'an unknown currency',
      { 'Số tiền': '-500,000 XYZ' },
      'INVALID_CURRENCY',
      ['currency'],
    ],
    [
      'an impossible date',
      { 'Thời gian': '31/02/2026 10:00:00' },
      'INVALID_DATETIME',
      ['transaction_time'],
    ],
    [
      'an impossible time',
      { 'Thời gian': '20/06/2026 25:61:00' },
      'INVALID_DATETIME',
      ['transaction_time'],
    ],
    [
      'a minus sign on a credit',
      { 'Loại giao dịch': 'Ghi có', 'Số tiền': '-500,000 VND' },
      'AMBIGUOUS_DIRECTION',
      ['direction'],
    ],
    [
      'a plus sign on a debit',
      { 'Loại giao dịch': 'Ghi nợ', 'Số tiền': '+500,000 VND' },
      'AMBIGUOUS_DIRECTION',
      ['direction'],
    ],
    [
      'an unrecognized direction',
      { 'Loại giao dịch': 'Khác' },
      'AMBIGUOUS_DIRECTION',
      ['direction'],
    ],
    [
      'no direction at all',
      { 'Loại giao dịch': null },
      'MISSING_REQUIRED_FIELDS',
      ['direction'],
    ],
  ])('rejects %s', (_label, parts, code, fields) => {
    const error = failure(body(parts));
    expect(error).toBeInstanceOf(ParserOutputError);
    expect(error).toMatchObject({ code, fields });
  });

  it('reads a zero fraction as whole dong and rejects any other fraction or grouping', () => {
    expect(
      parse(body({ 'Số tiền': '-1,250,000.00 VND' })).normalized.amount,
    ).toBe(1250000);
    for (const amount of [
      '-1,250,000.50 VND',
      '-1,25,0000 VND',
      '-1.250,000 VND',
    ]) {
      expect(failure(body({ 'Số tiền': amount }))).toMatchObject({
        code: 'INVALID_AMOUNT',
        fields: ['amount'],
      });
    }
  });

  it('several patterns for one field are fallbacks: the first match wins', () => {
    const base = template();
    const tpl = template({
      fields: [
        // Tried first; this synthetic format has no English label.
        field('amount', 'Amount:\\s*([\\d.,]+)', 'vnd_money', true),
        field('description', 'Nội dung:\\s*([^\\n;]+)'),
        field('description', 'Số tham chiếu:\\s*([A-Za-z0-9]+)'),
        ...base.fields.filter((f) => f.fieldName !== 'description'),
      ],
    });
    const result = parse(body({}), tpl);
    expect(result.normalized).toMatchObject({
      amount: 1250000,
      description: 'Thanh toan QR',
    });
    expect(result.evidence).toMatchObject({
      amount: 'MATCHED',
      description: 'MATCHED',
    });
    // Required means "no pattern for the field matched".
    expect(failure(body({ 'Số tiền': null }), tpl)).toMatchObject({
      code: 'MISSING_REQUIRED_FIELDS',
      fields: ['amount'],
    });
  });

  it('never infers the direction from the sign alone', () => {
    const error = failure(
      body({ 'Loại giao dịch': null, 'Số tiền': '-500,000 VND' }),
    );
    expect(error).toMatchObject({
      code: 'MISSING_REQUIRED_FIELDS',
      fields: ['direction'],
    });
  });

  it('uses the template direction hint when the message has no direction', () => {
    const hinted = template({ directionHint: 'EXPENSE' });
    expect(
      parse(body({ 'Loại giao dịch': null }), hinted).normalized.direction,
    ).toBe('EXPENSE');
  });

  it('failure text carries the code and field names only, never captured values', () => {
    const error = failure(
      body({ 'Số tiền': '-500,000 XYZ', 'Nội dung': 'SECRET-MEMO-42' }),
    ) as Error;
    expect(error.message).toBe('INVALID_CURRENCY: currency');
    for (const raw of ['XYZ', '500,000', 'SECRET-MEMO-42']) {
      expect(error.message.includes(raw)).toBe(false);
    }
  });

  it('evidence records match status only, never captured text', () => {
    const result = parse(body({ 'Số dư': null }));
    expect(result.evidence).toEqual({
      ...ALL_MATCHED,
      balance_after: 'MISSING',
    });
    expect(JSON.stringify(result.evidence)).not.toMatch(
      /Thanh toan|FT26171ABC|1,250,000|8,750,000/,
    );
  });
});

describe('ParserService never posts malformed output (T039)', () => {
  const message = {
    id: 'msg-1',
    userId: 'user-1',
    emailConnectionId: 'conn-1',
    providerMessageId: 'gmail-1',
    bankProviderId: 'bank_vcb',
    senderEmail: 'notify@vcb.example.test',
    subject: SUBJECT,
    snippet: null,
    receivedAt: RECEIVED,
    transaction: null,
  };

  const build = () => {
    const repository = {
      findMessageOwned: jest.fn().mockResolvedValue(message),
      activeTemplates: jest.fn().mockResolvedValue([template()]),
      findBankProvider: jest.fn().mockResolvedValue({ name: 'Vietcombank' }),
      createTransactionFromParse: jest.fn(),
      createFailureRun: jest.fn((data: { errorMessage: string }) =>
        Promise.resolve({
          id: 'run-1',
          status: 'FAILED',
          confidenceScore: null,
          createdAt: new Date(),
          createdTransactionId: null,
          ...data,
        }),
      ),
    };
    const service = new ParserService(
      repository as unknown as ParserRepository,
      new ParserEngineService(),
    );
    return { repository, service };
  };

  it.each([
    ['a zero amount', { 'Số tiền': '0 VND' }, 'INVALID_AMOUNT: amount'],
    [
      'a missing amount',
      { 'Số tiền': null },
      'MISSING_REQUIRED_FIELDS: amount',
    ],
    [
      'a contradictory sign',
      { 'Loại giao dịch': 'Ghi có', 'Số tiền': '-500,000 VND' },
      'AMBIGUOUS_DIRECTION: direction',
    ],
  ])(
    '%s is recorded as a sanitized failure and creates nothing',
    async (_label, parts, code) => {
      const { repository, service } = build();
      await service.parseMessage(
        { id: 'user-1' },
        'msg-1',
        body({
          ...(parts as Record<string, string | null>),
          'Nội dung': 'SECRET-MEMO-42',
        }),
      );
      expect(repository.createTransactionFromParse).not.toHaveBeenCalled();
      const [run] = repository.createFailureRun.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(run.errorMessage).toBe(code);
      expect(JSON.stringify(run)).not.toMatch(/SECRET-MEMO-42|500,000|0 VND/);
    },
  );

  it('a valid message is imported with match evidence only', async () => {
    const { repository, service } = build();
    repository.createTransactionFromParse.mockResolvedValue({
      transaction: { id: 'tx-1' },
      created: true,
    });
    await service.parseMessage({ id: 'user-1' }, 'msg-1', body({}));
    expect(repository.createFailureRun).not.toHaveBeenCalled();
    const [input] = repository.createTransactionFromParse.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      amount: 1250000,
      currency: 'VND',
      direction: 'EXPENSE',
      transactionTime: new Date('2026-06-20T08:30:00.000Z'),
      evidence: ALL_MATCHED,
    });
    expect(JSON.stringify(input.evidence)).not.toMatch(/Thanh toan|FT26171ABC/);
  });

  it('a message whose body is not stored is refused before any record is written', async () => {
    const { repository, service } = build();
    // Synced after T045: no snippet, and no transient body is supplied.
    const error = await service
      .parseMessage({ id: 'user-1' }, 'msg-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'EMAIL_BODY_UNAVAILABLE',
    });
    expect(repository.createFailureRun).not.toHaveBeenCalled();
    expect(repository.createTransactionFromParse).not.toHaveBeenCalled();
  });
});

describe('ParserEngineService hardening from the fuzz review (T045)', () => {
  const engine = new ParserEngineService();
  // Full-line captures, like the declared parser: the engine sees each whole
  // value and must refuse anything it cannot read exactly.
  const lineTemplate = template({
    fields: [
      field('direction', '^Loại giao dịch:[ \\t]*([^\\n]+)'),
      field('amount', '^Số tiền:[ \\t]*([^\\n]+)', 'vnd_money', true),
      field(
        'currency',
        '^Số tiền:[^\\n]*[\\d \\t\\u00a0\\u202f\\u2009]([^\\s\\d.,;:+\\-]+)[ \\t]*$',
      ),
      field(
        'transaction_time',
        '^Thời gian:[ \\t]*([^\\n]+)',
        'vi_datetime',
        true,
      ),
      field('transaction_code', '^Số tham chiếu:[ \\t]*([A-Za-z0-9]+)[ \\t]*$'),
      field('balance_after', '^Số dư:[ \\t]*([^\\n]+)', 'vnd_money'),
    ],
  });
  const lines = (
    over: Record<string, string | null> = {},
    extra: string[] = [],
  ) =>
    [
      ...Object.entries({
        'Loại giao dịch': 'Ghi nợ',
        'Số tiền': '-1,250,000 VND',
        'Thời gian': '20/06/2026 15:30:00',
        ...over,
      })
        .filter(([, value]) => value !== null)
        .map(([label, value]) => `${label}: ${value}`),
      ...extra,
    ].join('\n');
  const parse = (text: string) =>
    engine.parse(lineTemplate, SUBJECT, text, RECEIVED);
  const failure = (text: string) => {
    try {
      parse(text);
    } catch (error: unknown) {
      return error;
    }
    return null;
  };

  it.each([
    ['a non-breaking space', '-1 250 000 VND'],
    ['a narrow no-break space', '-1 250 000 VND'],
    ['a thin space', '-1 250 000 VND'],
    ['a Unicode minus sign', '−1,250,000 VND'],
  ])('reads grouping with %s', (_label, amount) => {
    expect(parse(lines({ 'Số tiền': amount })).normalized).toMatchObject({
      amount: 1250000,
      currency: 'VND',
      direction: 'EXPENSE',
    });
  });

  it('keeps a currency written after a non-breaking space', () => {
    expect(parse(lines({ 'Số tiền': '-45,000 USD' })).normalized).toMatchObject(
      { amount: 45000, currency: 'USD' },
    );
  });

  it.each([
    '-0,500 VND',
    '-0.500 VND',
    '-0500 VND',
    '-1,250,000 VND trả góp 12',
  ])('rejects the amount %s rather than guess', (amount) => {
    expect(failure(lines({ 'Số tiền': amount }))).toMatchObject({
      code: 'INVALID_AMOUNT',
      fields: ['amount'],
    });
  });

  it.each([
    ['a 12-hour time', '20/06/2026 3:30:00 PM'],
    ['an explicit zone', '20/06/2026 15:30:00 +09:00'],
    ['a year after 2099', '20/06/2150 15:30:00'],
    ['a year before 1900', '20/06/1899 15:30:00'],
  ])('rejects %s rather than misread it', (_label, time) => {
    expect(failure(lines({ 'Thời gian': time }))).toMatchObject({
      code: 'INVALID_DATETIME',
      fields: ['transaction_time'],
    });
  });

  it.each(['XTS', 'XXX', 'XAU', 'XDR', 'BOV', 'USN'])(
    'rejects %s, which is not a spending currency',
    (code) => {
      expect(failure(lines({ 'Số tiền': `-500,000 ${code}` }))).toMatchObject({
        code: 'INVALID_CURRENCY',
        fields: ['currency'],
      });
    },
  );

  it('reads "đồng" as VND', () => {
    expect(
      parse(lines({ 'Số tiền': '-500,000 đồng' })).normalized.currency,
    ).toBe('VND');
  });

  it.each([
    'Credit card payment',
    'Chuyển khoản Chi nhánh Hà Nội',
    'Không nhận',
    'Refund of debit',
    'Discredited',
  ])(
    'refuses the direction label "%s" instead of guessing from a word',
    (type) => {
      expect(failure(lines({ 'Loại giao dịch': type }))).toMatchObject({
        code: 'AMBIGUOUS_DIRECTION',
        fields: ['direction'],
      });
    },
  );

  it.each([
    ['Ghi có (Credit)', '+1,250,000 VND', 'INCOME'],
    ['Nợ', '-1,250,000 VND', 'EXPENSE'],
    ['DEBIT', '1,250,000 VND', 'EXPENSE'],
    ['Báo có', '1,250,000 VND', 'INCOME'],
  ])('reads the direction label "%s"', (type, amount, direction) => {
    expect(
      parse(lines({ 'Loại giao dịch': type, 'Số tiền': amount })).normalized
        .direction,
    ).toBe(direction);
  });

  it('refuses two different values for one fact, and accepts a repeat of the same value', () => {
    expect(failure(lines({}, ['Số tiền: -9,000,000 USD']))).toMatchObject({
      code: 'AMBIGUOUS_VALUE',
      fields: ['amount', 'currency'],
    });
    expect(
      parse(lines({}, ['Số tiền: -1,250,000 VND'])).normalized.amount,
    ).toBe(1250000);
  });

  it('a code that is not one alphanumeric token is absent, never truncated', () => {
    for (const code of ['N/A', 'FT26171-ABC12', 'Mã GD 123']) {
      expect(
        parse(lines({ 'Số tham chiếu': code })).normalized,
      ).not.toHaveProperty('transactionCode');
    }
  });

  it('reads a body in decomposed Unicode', () => {
    expect(parse(lines().normalize('NFD')).normalized).toMatchObject({
      amount: 1250000,
      direction: 'EXPENSE',
    });
  });

  it.each([
    ['a long separator run', `-1${','.repeat(100_000)}1 VND`],
    ['a long punctuation run', `-1 ${':'.repeat(100_000)}x`],
    ['long padding', `${' '.repeat(100_000)}x`],
  ])('stays linear on %s', (_label, amount) => {
    const started = Date.now();
    expect(failure(lines({ 'Số tiền': amount }))).toBeInstanceOf(
      ParserOutputError,
    );
    expect(Date.now() - started).toBeLessThan(250);
  });
});
