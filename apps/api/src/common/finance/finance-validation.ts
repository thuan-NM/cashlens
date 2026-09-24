import { applyDecorators } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IsISO4217CurrencyCode,
  IsISO8601,
  Matches,
  ValidateBy,
} from 'class-validator';

/**
 * Field rules shared by financial write and query DTOs (TX-002, ERR-001).
 *
 * - Currency codes are upper-case ISO 4217, so one currency never forms two
 *   groups ("vnd" and "VND") in totals.
 * - Instants carry an explicit UTC offset (or `Z`). A timestamp without one
 *   would be read in the server's own timezone, making periods depend on the
 *   host (DASH-002, DASH-003).
 * - Amounts stay within 15 significant digits with cents, the range that JSON
 *   numbers carry exactly into the Decimal(18, 2) columns.
 */

export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
export const MAX_TRANSACTION_AMOUNT = 9_999_999_999_999.99;
export const MONEY_DECIMAL_PLACES = 2;

const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A finite number with at most two decimal places. Decimal places are counted
 * exactly, including numbers JSON writes with an exponent (1e-7), for which
 * class-validator's own maxDecimalPlaces check throws instead of failing.
 */
export const isMoney = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  new Prisma.Decimal(value).decimalPlaces() <= MONEY_DECIMAL_PLACES;

export const IsMoney = () =>
  ValidateBy({
    name: 'isMoney',
    validator: {
      validate: (value) => isMoney(value),
      defaultMessage: (args) =>
        `${args?.property ?? 'value'} must be a number with at most ${MONEY_DECIMAL_PLACES} decimal places`,
    },
  });

export const IsCurrencyCode = () =>
  applyDecorators(
    Matches(CURRENCY_CODE_PATTERN, {
      message: ({ property }) =>
        `${property} must be an upper-case ISO 4217 currency code, such as VND`,
    }),
    IsISO4217CurrencyCode({
      message: ({ property }) =>
        `${property} must be an upper-case ISO 4217 currency code, such as VND`,
    }),
  );

export const IsInstant = () =>
  applyDecorators(
    IsISO8601(
      { strict: true, strictSeparator: true },
      {
        message: ({ property }) =>
          `${property} must be a valid ISO 8601 date-time with a UTC offset, such as 2026-09-23T10:00:00+07:00`,
      },
    ),
    Matches(INSTANT_PATTERN, {
      message: ({ property }) =>
        `${property} must be a valid ISO 8601 date-time with a UTC offset, such as 2026-09-23T10:00:00+07:00`,
    }),
  );
