import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionDirection } from '@prisma/client';
import { isISO4217CurrencyCode } from 'class-validator';
import safeRegex from 'safe-regex2';
import {
  CURRENCY_CODE_PATTERN,
  MAX_TRANSACTION_AMOUNT,
  isMoney,
} from '../../common/finance/finance-validation';
import { startOfLocalDay } from '../../common/finance/financial-period-policy';
import { ParserTemplateWithFields } from './parser.mapper';

/** Sanitized parse-failure codes: the only failure text stored or returned. */
export type ParserFailureCode =
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_AMOUNT'
  | 'INVALID_CURRENCY'
  | 'INVALID_DATETIME'
  | 'AMBIGUOUS_DIRECTION'
  | 'AMBIGUOUS_VALUE'
  | 'NO_BANK_PROVIDER'
  | 'NO_TEMPLATE_MATCHED'
  | 'PARSER_ERROR';

/** Invalid parser output (EMAIL-011): carries a code and field names only. */
export class ParserOutputError extends Error {
  constructor(
    readonly code: ParserFailureCode,
    readonly fields: string[] = [],
  ) {
    super(fields.length ? `${code}: ${fields.join(', ')}` : code);
  }
}

/** Whether each template field was found; never the captured text. */
export type FieldEvidence = 'MATCHED' | 'FALLBACK' | 'MISSING';

/** A parse result that passed the gate: every required value is valid. */
export type NormalizedTransaction = {
  amount: number;
  currency: string;
  direction: TransactionDirection;
  transactionTime: string;
  description?: string;
  balanceAfter?: number;
  transactionCode?: string;
  merchantName?: string;
  counterpartyName?: string;
};

/** @deprecated Kept for callers typed against the previous shape. */
export type NormalizedPayload = Partial<NormalizedTransaction>;

/**
 * `vi_datetime` values are wall-clock times printed by Vietnamese banks, read
 * in the bank's zone (UTC+07:00 all year), never in the server's zone.
 */
export const VI_DATETIME_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const EVIDENCE_RANK: Record<FieldEvidence, number> = {
  MISSING: 0,
  FALLBACK: 1,
  MATCHED: 2,
};
/** Facts that decide the transaction and its identity: never two values. */
const FACT_FIELDS = new Set([
  'amount',
  'currency',
  'direction',
  'transaction_time',
  'transaction_code',
  'balance_after',
]);
/** A money, currency, direction, or time value is never longer than this. */
const MAX_VALUE_LENGTH = 64;
/** Free text (description, merchant, counterparty) is cut to this length. */
const MAX_TEXT_LENGTH = 500;
/** Bank direction labels, without diacritics; any other label is ambiguous. */
const DEBIT_LABELS = new Set([
  'ghi no',
  'bao no',
  'no',
  'debit',
  'dr',
  'tru tien',
  'chi',
  'chi tien',
]);
const CREDIT_LABELS = new Set([
  'ghi co',
  'bao co',
  'co',
  'credit',
  'cr',
  'nhan tien',
  'cong tien',
]);
/** ISO 4217 codes that are not spending currencies (funds, metals, testing). */
const NON_SPENDING_CODES = new Set([
  'BOV',
  'CHE',
  'CHW',
  'CLF',
  'COU',
  'MXV',
  'USN',
  'UYI',
  'UYW',
]);
/** Grouping spaces banks print: space, no-break, narrow no-break, thin. */
const GROUP_SPACES = new Set([' ', '\u00a0', '\u202f', '\u2009']);
const isDigit = (char: string) => char >= '0' && char <= '9';
const DEBIT = new Set<TransactionDirection>(['EXPENSE', 'TRANSFER_OUT']);
const CREDIT = new Set<TransactionDirection>(['INCOME', 'TRANSFER_IN']);
const VND_SPELLINGS = new Set(['VND', 'VNĐ', 'Đ', 'đ', '₫']);

const stripDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

@Injectable()
export class ParserEngineService {
  validateTemplate(template: {
    subjectPattern?: string;
    bodyPattern?: string;
    fields?: Array<{ regexPattern: string }>;
  }) {
    const patterns = [
      template.subjectPattern,
      template.bodyPattern,
      ...(template.fields?.map((field) => field.regexPattern) ?? []),
    ].filter((value): value is string => Boolean(value));

    for (const pattern of patterns) {
      if (!safeRegex(pattern)) {
        throw new BadRequestException(
          'Parser contains an unsafe regex pattern',
        );
      }
      try {
        new RegExp(pattern, 'im');
      } catch {
        throw new BadRequestException(
          'Parser contains an invalid regex pattern',
        );
      }
    }
  }

  matches(template: ParserTemplateWithFields, subject: string, body: string) {
    return (
      (!template.subjectPattern ||
        new RegExp(template.subjectPattern, 'im').test(subject)) &&
      (!template.bodyPattern ||
        new RegExp(template.bodyPattern, 'im').test(body))
    );
  }

  /**
   * Extracts and validates one message (EMAIL-010, EMAIL-011). The result is
   * either a complete normalized transaction or a `ParserOutputError`; invalid
   * or ambiguous output never reaches a transaction.
   */
  parse(
    template: ParserTemplateWithFields,
    subject: string,
    body: string,
    receivedAt: Date,
  ): {
    evidence: Record<string, FieldEvidence>;
    normalized: NormalizedTransaction;
    confidence: number;
  } {
    // Composed Unicode, so labels match however the mail was encoded.
    const source = `${subject}\n${body}`.normalize('NFC');
    const evidence: Record<string, FieldEvidence> = {};
    const values = new Map<
      string,
      { raw: string; normalizer: string | null }
    >();
    const required = new Set<string>();
    const ambiguous = new Set<string>();

    // Rows sharing a field name are fallbacks in template order: the first
    // match wins, and a fallback value applies only when no row matched.
    for (const field of template.fields) {
      if (field.isRequired) required.add(field.fieldName);
      const captures = [
        ...source.matchAll(new RegExp(field.regexPattern, 'gim')),
      ]
        .map((match) => match[field.regexGroupIndex])
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim() !== '',
        )
        .map((value) => value.trim());
      const matched = captures.length > 0;
      const fallback = field.fallbackValue?.trim() || null;
      const status: FieldEvidence = matched
        ? 'MATCHED'
        : fallback
          ? 'FALLBACK'
          : 'MISSING';
      const current = evidence[field.fieldName];
      if (
        current === undefined ||
        EVIDENCE_RANK[status] > EVIDENCE_RANK[current]
      ) {
        evidence[field.fieldName] = status;
        if (status !== 'MISSING') {
          values.set(field.fieldName, {
            raw: matched ? captures[0] : fallback!,
            normalizer: field.normalizer,
          });
        }
        // Two different values for one fact (EMAIL-011): refuse, never pick.
        if (FACT_FIELDS.has(field.fieldName) && new Set(captures).size > 1) {
          ambiguous.add(field.fieldName);
        }
      }
    }
    const missing = [...required].filter((name) => !values.has(name));

    const amountValue = values.get('amount');
    if (!amountValue) missing.push('amount');
    const directionValue = values.get('direction');
    const direction = directionValue
      ? this.direction(directionValue.raw)
      : (template.directionHint ?? undefined);
    if (!directionValue && !direction) missing.push('direction');
    if (missing.length) {
      throw new ParserOutputError('MISSING_REQUIRED_FIELDS', [
        ...new Set(missing),
      ]);
    }
    if (ambiguous.size) {
      throw new ParserOutputError('AMBIGUOUS_VALUE', [...ambiguous]);
    }

    const { amount, sign } = this.money(
      amountValue!.raw,
      amountValue!.normalizer,
    );
    if (amount === undefined || amount <= 0) {
      throw new ParserOutputError('INVALID_AMOUNT', ['amount']);
    }
    if (!direction) {
      throw new ParserOutputError('AMBIGUOUS_DIRECTION', ['direction']);
    }
    // A sign may confirm the direction, never contradict or replace it.
    if (
      (sign === '-' && !DEBIT.has(direction)) ||
      (sign === '+' && !CREDIT.has(direction))
    ) {
      throw new ParserOutputError('AMBIGUOUS_DIRECTION', ['direction']);
    }

    const currencyValue = values.get('currency');
    const currency = currencyValue ? this.currency(currencyValue.raw) : 'VND';
    if (!currency) {
      throw new ParserOutputError('INVALID_CURRENCY', ['currency']);
    }

    const timeValue = values.get('transaction_time');
    const transactionTime = timeValue
      ? this.dateTime(timeValue.raw, timeValue.normalizer)
      : receivedAt.toISOString();
    if (!transactionTime) {
      throw new ParserOutputError('INVALID_DATETIME', ['transaction_time']);
    }

    const normalized: NormalizedTransaction = {
      amount,
      currency,
      direction,
      transactionTime,
    };
    const text = (name: string) =>
      values.get(name)?.raw.slice(0, MAX_TEXT_LENGTH) || undefined;
    const code = values.get('transaction_code')?.raw;
    const balance = values.get('balance_after');
    const balanceMoney = balance
      ? this.money(balance.raw, balance.normalizer)
      : undefined;
    const optional = {
      description: text('description'),
      // A negative balance (overdraft) is valid; an unreadable one is dropped.
      balanceAfter:
        balanceMoney?.amount !== undefined && balanceMoney.sign === '-'
          ? -balanceMoney.amount
          : balanceMoney?.amount,
      transactionCode:
        code && code.length <= MAX_VALUE_LENGTH ? code : undefined,
      merchantName: text('merchant_name'),
      counterpartyName: text('counterparty_name'),
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) {
        (normalized as Record<string, unknown>)[key] = value;
      }
    }

    const found = Object.values(evidence).filter((e) => e !== 'MISSING').length;
    return {
      evidence,
      normalized,
      confidence: template.fields.length ? found / template.fields.length : 0,
    };
  }

  /**
   * A positive amount with at most two decimals, and its sign if any. One
   * trailing currency token is allowed; anything else after the number makes
   * the value unreadable rather than guessed (EMAIL-011). Thousands
   * separators must be consistent and never start with a 0 group. `vnd_money`
   * is whole dong, so only an all-zero fraction is accepted; `decimal_money`
   * accepts a 1–2 digit fraction after the other mark. Scans are linear.
   */
  private money(raw: string, normalizer: string | null) {
    const unreadable = { amount: undefined, sign: undefined };
    if (raw.length > MAX_VALUE_LENGTH) return unreadable;
    // A Unicode minus or dash is a minus; banks' grouping spaces are spaces.
    const value = [...raw.trim()]
      .map((char, index) =>
        index === 0 && (char === '\u2212' || char === '\u2013')
          ? '-'
          : GROUP_SPACES.has(char)
            ? ' '
            : char,
      )
      .join('');
    const first = value[0];
    const sign = first === '+' || first === '-' ? first : undefined;
    let start = sign ? 1 : 0;
    while (start < value.length && value[start] === ' ') start += 1;
    let end = value.length;
    const tokenEnd = end;
    while (
      end > start &&
      value[end - 1] !== ' ' &&
      !isDigit(value[end - 1]) &&
      value[end - 1] !== '.' &&
      value[end - 1] !== ','
    ) {
      end -= 1;
    }
    if (end < tokenEnd) {
      while (end > start && value[end - 1] === ' ') end -= 1;
    }
    const number = value.slice(start, end);
    const match =
      /^([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{0,2}(?: \d{3})+|[1-9]\d*|0)(?:([.,])(\d{1,2}))?$/.exec(
        number,
      );
    if (!match) return { amount: undefined, sign };
    const [, whole, mark, fraction] = match;
    const wholeUnitsOnly = normalizer !== 'decimal_money';
    if (
      mark &&
      (whole.includes(mark) || (wholeUnitsOnly && !/^0+$/.test(fraction)))
    ) {
      return { amount: undefined, sign };
    }
    const digits = whole.replace(/\D/g, '');
    const amount = Number(fraction ? `${digits}.${fraction}` : digits);
    if (!isMoney(amount) || amount > MAX_TRANSACTION_AMOUNT) {
      return { amount: undefined, sign };
    }
    return { amount, sign };
  }

  /**
   * Upper-case ISO 4217 spending currencies; the usual Vietnamese dong
   * spellings (VNĐ, đ, ₫, đồng) mean VND. X-codes and fund codes are refused.
   */
  private currency(raw: string) {
    if (raw.length > MAX_VALUE_LENGTH) return undefined;
    let value = raw.trim();
    while (value && '.;:,'.includes(value[value.length - 1])) {
      value = value.slice(0, -1);
    }
    const plain = stripDiacritics(value).toUpperCase();
    if (
      VND_SPELLINGS.has(value) ||
      VND_SPELLINGS.has(value.toUpperCase()) ||
      plain === 'DONG'
    ) {
      return 'VND';
    }
    const code = value.toUpperCase();
    return CURRENCY_CODE_PATTERN.test(code) &&
      isISO4217CurrencyCode(code) &&
      !code.startsWith('X') &&
      !NON_SPENDING_CODES.has(code)
      ? code
      : undefined;
  }

  /**
   * Enum names, or bank direction labels (Vietnamese or English, without
   * diacritics or case): every part of the label, such as "Ghi có (Credit)",
   * must be a known label of the same direction. Anything else — a sentence
   * that merely contains a direction word — is ambiguous, never guessed.
   */
  private direction(raw: string): TransactionDirection | undefined {
    if (raw.length > MAX_VALUE_LENGTH) return undefined;
    const upper = raw.trim().toUpperCase().replaceAll(' ', '_');
    if (
      Object.values(TransactionDirection).includes(
        upper as TransactionDirection,
      )
    ) {
      return upper as TransactionDirection;
    }
    const parts = stripDiacritics(raw)
      .toLowerCase()
      .split(/[()[\]/|,;-]+/)
      .map((part) => part.split(' ').filter(Boolean).join(' '))
      .filter(Boolean);
    const kinds = new Set(
      parts.map((part) =>
        DEBIT_LABELS.has(part)
          ? 'EXPENSE'
          : CREDIT_LABELS.has(part)
            ? 'INCOME'
            : 'UNKNOWN',
      ),
    );
    if (kinds.size !== 1 || kinds.has('UNKNOWN')) return undefined;
    return kinds.has('EXPENSE') ? 'EXPENSE' : 'INCOME';
  }

  /** An instant, or undefined when the value is not a real date and time. */
  private dateTime(raw: string, normalizer: string | null) {
    if (raw.length > MAX_VALUE_LENGTH) return undefined;
    if (normalizer === 'vi_datetime') {
      const match =
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
          raw.trim(),
        );
      if (!match) return undefined;
      const [day, month, year, hour, minute, second] = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      ];
      const calendar = new Date(Date.UTC(year, month - 1, day));
      if (
        calendar.getUTCFullYear() !== year ||
        calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day ||
        // The supported calendar, as for month keys (DASH-002).
        year < 1900 ||
        year > 2099 ||
        hour > 23 ||
        minute > 59 ||
        second > 59
      ) {
        return undefined;
      }
      const date = `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // The zone has no daylight saving, so the day start plus the time of day is exact.
      const start = startOfLocalDay(date, VI_DATETIME_TIME_ZONE).getTime();
      return new Date(
        start + ((hour * 60 + minute) * 60 + second) * 1000,
      ).toISOString();
    }
    // Any other normalizer needs an ISO 8601 instant with an explicit offset.
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        raw.trim(),
      )
    ) {
      return undefined;
    }
    const instant = new Date(raw.trim());
    return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
  }
}
