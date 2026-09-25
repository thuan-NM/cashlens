import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export const VALIDATION_FAILED = 'VALIDATION_FAILED';

/**
 * The global ValidationPipe with actionable field errors (ERR-001). The
 * `message` list is exactly what the default pipe produces, so existing
 * clients keep working; `fields` adds the same messages grouped by the
 * top-level property they concern, and `code` is VALIDATION_FAILED.
 */
export class FieldValidationPipe extends ValidationPipe {
  public createExceptionFactory() {
    return (errors: ValidationError[] = []) => {
      const fields: Record<string, string[]> = {};
      for (const error of errors) {
        const messages = this.flattenValidationErrors([error]);
        if (messages.length) {
          fields[error.property] = [
            ...(fields[error.property] ?? []),
            ...messages,
          ];
        }
      }
      return new BadRequestException({
        statusCode: 400,
        message: this.flattenValidationErrors(errors),
        error: 'Bad Request',
        code: VALIDATION_FAILED,
        fields,
      });
    };
  }
}
