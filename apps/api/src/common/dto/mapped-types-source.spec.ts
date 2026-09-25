import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * T101 regression: `PartialType`/`PickType`/`OmitType` from
 * `@nestjs/mapped-types` carry validation metadata but no OpenAPI metadata, so
 * the generated swagger.json showed an empty request body for PATCH /budgets
 * and PATCH /goals (contract BudgetWrite.thresholdPercent was missing). DTOs
 * must use the `@nestjs/swagger` variants, which carry both.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('DTO mapped types', () => {
  it('come from @nestjs/swagger, so the OpenAPI document keeps their fields', () => {
    const root = join(__dirname, '..', '..');
    const offenders = sourceFiles(root)
      .filter((file) =>
        /from '@nestjs\/mapped-types'/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(root, file).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
