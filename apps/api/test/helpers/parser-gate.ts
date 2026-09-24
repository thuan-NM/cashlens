import { existsSync, readdirSync, readFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

/**
 * The per-parser release gate (T048, SC-005): each declared parser is
 * measured on its own fixtures, never averaged with another parser.
 */
export const PARSER_GATE = {
  minRate: 0.85,
  minValid: 10,
  minMalformed: 2,
} as const;

export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
export const DECLARATION_FILE = join(
  REPO_ROOT,
  'docs',
  'operations',
  'supported-parsers.md',
);

const BEGIN = '<!-- supported-parsers:begin -->';
const END = '<!-- supported-parsers:end -->';
const HEADER = ['Bank', 'Channel', 'Version', 'Template', 'Fixtures'];

export type ParserDeclaration = {
  bank: string;
  channel: string;
  version: number;
  template: string;
  fixtures: string;
};

export type ExpectedTransaction = {
  amount: number;
  currency: string;
  direction: string;
  transactionTime: string;
  transactionCode?: string;
  description?: string;
  balanceAfter?: number;
};

export type EmailFixture = {
  file: string;
  description: string;
  message: {
    from: string;
    subject: string;
    receivedAt: string;
    body: string[];
  };
  expected?: ExpectedTransaction;
  expectedFailure?: string;
};

export type ParserResult = {
  declaration: ParserDeclaration;
  valid: number;
  malformed: number;
  exact: number;
  rate: number;
  mismatched: string[];
  malformedCreated: string[];
};

/** An unreadable declaration fails the gate like a failing parser does. */
export class DeclarationError extends Error {}

export function readDeclarations(markdown: string): ParserDeclaration[] {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start < 0 || end < start) {
    throw new DeclarationError('The supported-parsers markers are missing');
  }
  const lines = markdown
    .slice(start + BEGIN.length, end)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cells = (line: string) => {
    if (!line.startsWith('|') || !line.endsWith('|')) {
      throw new DeclarationError(`Not a table row: ${line}`);
    }
    return line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
  };
  if (lines.length < 2 || cells(lines[0]).join('|') !== HEADER.join('|')) {
    throw new DeclarationError(
      `The table header must be: ${HEADER.join(' | ')}`,
    );
  }
  if (!cells(lines[1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new DeclarationError('The table header separator is missing');
  }
  const declarations = lines.slice(2).map((line) => {
    const row = cells(line);
    const version = Number(row[2]);
    if (
      row.length !== HEADER.length ||
      !/^[a-z0-9_]+$/.test(row[0]) ||
      !/^[A-Z]+$/.test(row[1]) ||
      !Number.isInteger(version) ||
      version < 1 ||
      !row[3] ||
      !row[4]
    ) {
      throw new DeclarationError(`Unreadable declaration row: ${line}`);
    }
    return {
      bank: row[0],
      channel: row[1],
      version,
      template: row[3],
      fixtures: row[4],
    };
  });
  if (!declarations.length) {
    throw new DeclarationError('No parser is declared');
  }
  return declarations;
}

/** Declared paths are repository-relative; temporary ones may be absolute. */
export const repoPath = (value: string) =>
  isAbsolute(value) ? value : join(REPO_ROOT, value);

export function loadFixtures(directory: string) {
  const read = (kind: 'valid' | 'malformed'): EmailFixture[] => {
    const folder = join(repoPath(directory), kind);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => ({
        file: `${kind}/${file}`,
        ...(JSON.parse(readFileSync(join(folder, file), 'utf8')) as Omit<
          EmailFixture,
          'file'
        >),
      }));
  };
  return { valid: read('valid'), malformed: read('malformed') };
}

export const parserId = (d: ParserDeclaration) =>
  `${d.bank} ${d.channel} v${d.version}`;

export function gateFailures(results: ParserResult[]): string[] {
  if (!results.length) return ['No parser is declared'];
  return results.flatMap((result) => {
    const id = parserId(result.declaration);
    const failures: string[] = [];
    if (result.valid < PARSER_GATE.minValid) {
      failures.push(
        `${id}: ${result.valid} valid fixtures; at least ${PARSER_GATE.minValid} are required`,
      );
    }
    if (result.malformed < PARSER_GATE.minMalformed) {
      failures.push(
        `${id}: ${result.malformed} malformed fixtures; at least ${PARSER_GATE.minMalformed} are required`,
      );
    }
    if (result.rate < PARSER_GATE.minRate) {
      failures.push(
        `${id}: rate ${(result.rate * 100).toFixed(1)}% is below ${PARSER_GATE.minRate * 100}%`,
      );
    }
    if (result.malformedCreated.length) {
      failures.push(
        `${id}: malformed fixtures created transactions: ${result.malformedCreated.join(', ')}`,
      );
    }
    return failures;
  });
}

/** The per-parser evidence table printed by the gate. */
export function formatResults(results: ParserResult[]): string {
  const rows = results.map((r) =>
    [
      parserId(r.declaration),
      `${r.exact}/${r.valid}`,
      `${(r.rate * 100).toFixed(1)}%`,
      String(r.malformed),
      String(r.malformedCreated.length),
      gateFailures([r]).length ? 'FAIL' : 'PASS',
    ].join(' | '),
  );
  return [
    'Parser | Exact/valid | Rate | Malformed | Malformed posted | Gate',
    ...rows,
  ].join('\n');
}
