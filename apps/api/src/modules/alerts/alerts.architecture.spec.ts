import { MODULE_METADATA } from '@nestjs/common/constants';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { AlertsModule } from './alerts.module';

/**
 * T079 dependency direction (plan.md "Alert module dependency direction"):
 * feature modules import AlertsModule, never the reverse, and nothing uses
 * forwardRef. Outside `common/`, `config/`, and `prisma/`, alert code may
 * import only the one pure feature file it reuses, `goals/goal-feasibility`
 * (the budget threshold rule lives in common/finance).
 */

const ALERTS_DIR = __dirname;
const MODULES_DIR = resolve(ALERTS_DIR, '..');
const ALLOWED_FEATURE_FILES = new Set([join('goals', 'goal-feasibility')]);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(
    (match) => match[1],
  );

describe('AlertsModule dependency direction (T079)', () => {
  it('declares no module imports at all', () => {
    const imports = (Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AlertsModule,
    ) ?? []) as unknown[];
    expect(imports).toEqual([]);
  });

  it('never uses forwardRef', () => {
    for (const file of sourceFiles(ALERTS_DIR)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/forwardRef\s*\(/);
    }
  });

  it('imports no feature code except the pure goal-feasibility file', () => {
    const offending: string[] = [];
    for (const file of sourceFiles(ALERTS_DIR)) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(file, '..', specifier);
        if (!target.startsWith(MODULES_DIR + sep)) continue; // common, config, prisma
        const inModules = relative(MODULES_DIR, target);
        if (inModules.startsWith('alerts' + sep)) continue;
        if (!ALLOWED_FEATURE_FILES.has(inModules)) {
          offending.push(`${relative(ALERTS_DIR, file)} -> ${specifier}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('keeps the reused feature file free of Nest and feature imports', () => {
    for (const file of ALLOWED_FEATURE_FILES) {
      const specifiers = importsOf(join(MODULES_DIR, `${file}.ts`));
      expect(specifiers.filter((s) => s.startsWith('@nestjs'))).toEqual([]);
      expect(
        specifiers.filter((s) => s.startsWith('.') && !s.includes('common/')),
      ).toEqual([]);
    }
  });
});
