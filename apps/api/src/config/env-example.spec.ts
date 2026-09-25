import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlaceholderSecret } from './placeholder-secrets';

/**
 * CFG-003 (T098): apps/api/.env.example enumerates every setting the API
 * reads, tags each as required, production-only, SMTP-only, or optional,
 * and contains no usable secret.
 */

const example = readFileSync(
  join(__dirname, '..', '..', '.env.example'),
  'utf8',
);
const config = readFileSync(join(__dirname, 'configuration.ts'), 'utf8');

/** Every variable configuration.ts reads through its EnvReader. */
const readKeys = [
  ...new Set(
    [...config.matchAll(/reader\.\w+\(\s*'([A-Z][A-Z0-9_]*)'/g)].map(
      (m) => m[1],
    ),
  ),
];

/** Example entries: key, value, and the comment block just above. */
const entries = (() => {
  const lines = example.split(/\r?\n/);
  const found = new Map<string, { value: string; comment: string }>();
  lines.forEach((line, index) => {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)="([^"]*)"/.exec(line);
    if (!match) return;
    const comment: string[] = [];
    // Grouped entries share the comment above the group: read past sibling
    // entries (commented out or not) up to it.
    for (
      let i = index - 1;
      i >= 0 &&
      (lines[i].startsWith('#') || /^[A-Z][A-Z0-9_]*=/.test(lines[i]));
      i--
    ) {
      if (/^#?\s*[A-Z][A-Z0-9_]*=/.test(lines[i])) continue; // a sibling entry
      comment.unshift(lines[i]);
    }
    found.set(match[1], { value: match[2], comment: comment.join('\n') });
  });
  return found;
})();

const SECRET_KEYS = [
  'JWT_SECRET',
  'EMAIL_TOKEN_ENCRYPTION_KEY',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_OAUTH_STATE_SECRET',
  'SMTP_PASSWORD',
];

describe('.env.example (CFG-003)', () => {
  it('finds the settings configuration.ts reads', () => {
    expect(readKeys.length).toBeGreaterThanOrEqual(20);
    expect(readKeys).toEqual(expect.arrayContaining(SECRET_KEYS));
  });

  it.each(readKeys)('documents %s', (key) => {
    expect(entries.has(key)).toBe(true);
  });

  it.each(readKeys)('tags %s as required, prod, smtp, or optional', (key) => {
    expect(entries.get(key)?.comment ?? '').toMatch(
      /\[(required|prod|smtp|optional)\]/,
    );
  });

  it.each(SECRET_KEYS)('gives %s only a placeholder value', (key) => {
    const value = entries.get(key)?.value ?? '';
    expect(value === '' || isPlaceholderSecret(value)).toBe(true);
  });

  it('contains a placeholder database password only', () => {
    const url = entries.get('DATABASE_URL')?.value ?? '';
    const password = decodeURIComponent(new URL(url).password);
    expect(isPlaceholderSecret(password)).toBe(true);
  });
});
