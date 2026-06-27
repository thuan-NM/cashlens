import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionDirection } from '@prisma/client';
import safeRegex from 'safe-regex2';
import { ParserTemplateWithFields } from './parser.mapper';

export type NormalizedPayload = {
  amount?: number;
  currency?: string;
  direction?: TransactionDirection;
  transactionTime?: string;
  description?: string;
  balanceAfter?: number;
  transactionCode?: string;
  merchantName?: string;
  counterpartyName?: string;
};

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
        throw new BadRequestException('Parser contains an unsafe regex pattern');
      }
      try {
        new RegExp(pattern, 'im');
      } catch {
        throw new BadRequestException('Parser contains an invalid regex pattern');
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

  parse(
    template: ParserTemplateWithFields,
    subject: string,
    body: string,
    receivedAt: Date,
  ) {
    const source = `${subject}\n${body}`;
    const extracted: Record<string, string | null> = {};
    const normalized: NormalizedPayload = {};
    const missing: string[] = [];

    for (const field of template.fields) {
      const match = new RegExp(field.regexPattern, 'im').exec(source);
      const raw =
        match?.[field.regexGroupIndex] ?? field.fallbackValue ?? null;
      extracted[field.fieldName] = raw;

      if (raw === null) {
        if (field.isRequired) missing.push(field.fieldName);
        continue;
      }

      const value = this.normalize(field.fieldName, field.normalizer, raw);
      this.assign(normalized, field.fieldName, value);
    }

    normalized.direction ??= template.directionHint ?? undefined;
    normalized.transactionTime ??= receivedAt.toISOString();
    normalized.currency ??= 'VND';

    for (const required of ['amount', 'direction', 'transaction_time']) {
      if (
        (required === 'transaction_time' && !normalized.transactionTime) ||
        (required === 'amount' && !normalized.amount) ||
        (required === 'direction' && !normalized.direction)
      ) {
        missing.push(required);
      }
    }

    if (missing.length) {
      throw new BadRequestException(
        `Missing required parser fields: ${[...new Set(missing)].join(', ')}`,
      );
    }

    const extractedCount = Object.values(extracted).filter(Boolean).length;
    return {
      extracted,
      normalized,
      confidence:
        template.fields.length > 0
          ? extractedCount / template.fields.length
          : 0,
    };
  }

  private normalize(fieldName: string, normalizer: string | null, raw: string) {
    const value = raw.trim();
    if (normalizer === 'vnd_money' || fieldName.includes('amount')) {
      return Number(value.replace(/[^\d-]/g, ''));
    }
    if (normalizer === 'decimal_money') {
      return Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    }
    if (normalizer === 'vi_datetime') {
      const match = value.match(
        /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
      );
      if (!match) throw new BadRequestException('Invalid Vietnamese datetime');
      return new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      ).toISOString();
    }
    if (fieldName === 'direction') {
      const normalized = value.toUpperCase().replaceAll(' ', '_');
      if (Object.values(TransactionDirection).includes(normalized as TransactionDirection)) {
        return normalized as TransactionDirection;
      }
      if (/(credit|income|nhan|ghi co|bao co)/i.test(value)) return 'INCOME';
      if (/(debit|expense|chi|ghi no|bao no|tru tien)/i.test(value)) return 'EXPENSE';
      throw new BadRequestException('Unable to normalize transaction direction');
    }
    return value;
  }

  private assign(
    payload: NormalizedPayload,
    fieldName: string,
    value: string | number,
  ) {
    const keyMap: Record<string, keyof NormalizedPayload> = {
      amount: 'amount',
      currency: 'currency',
      direction: 'direction',
      transaction_time: 'transactionTime',
      description: 'description',
      balance_after: 'balanceAfter',
      transaction_code: 'transactionCode',
      merchant_name: 'merchantName',
      counterparty_name: 'counterpartyName',
    };
    const key = keyMap[fieldName];
    if (key) (payload as Record<string, unknown>)[key] = value;
  }
}
