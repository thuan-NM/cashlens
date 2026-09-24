import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import type { Transaction } from '@prisma/client';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { App } from 'supertest/types';
import { isDeepStrictEqual } from 'util';
import { GmailApiService } from '../src/modules/email-ingestion/gmail-api.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  RUN_ID,
  TestUser,
  cleanupUsers,
  dataOf,
  idPath,
  promoteToAdminForTest,
  registerUser,
} from './helpers/auth-fixtures';
import {
  createGmailConnection,
  createListenRule,
  createParserTemplate,
  gmailMessage,
} from './helpers/email-fixtures';
import {
  DECLARATION_FILE,
  DeclarationError,
  EmailFixture,
  ExpectedTransaction,
  ParserDeclaration,
  ParserResult,
  formatResults,
  gateFailures,
  loadFixtures,
  readDeclarations,
  repoPath,
} from './helpers/parser-gate';

jest.setTimeout(180_000);

const DECLARED = readFileSync(DECLARATION_FILE, 'utf8');
const REAL = readDeclarations(DECLARED)[0];

const senderOf = (from: string) =>
  (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

/** The transaction as the fixture states it; the subject is the default description. */
const asExpected = (tx: Transaction, subject: string): ExpectedTransaction => ({
  amount: Number(tx.amount),
  currency: tx.currency,
  direction: tx.direction,
  transactionTime: tx.transactionTime.toISOString(),
  ...(tx.transactionCode ? { transactionCode: tx.transactionCode } : {}),
  ...(tx.description && tx.description !== subject
    ? { description: tx.description }
    : {}),
  ...(tx.balanceAfter !== null
    ? { balanceAfter: Number(tx.balanceAfter) }
    : {}),
});

const declarationTable = (rows: ParserDeclaration[]) =>
  [
    '<!-- supported-parsers:begin -->',
    '| Bank | Channel | Version | Template | Fixtures |',
    '|---|---|---|---|---|',
    ...rows.map(
      (d) =>
        `| ${d.bank} | ${d.channel} | ${d.version} | ${d.template} | ${d.fixtures} |`,
    ),
    '<!-- supported-parsers:end -->',
  ].join('\n');

// T048 (SC-005, EMAIL-010, EMAIL-011): every declared parser is measured on
// its own fixtures through the real pipeline (stubbed Gmail → manual sync →
// parser → transaction import) and must reach 85% exact transactions, with
// at least 10 valid and 2 malformed fixtures and no malformed posting.
describe('Per-parser fixture rate gate (T048)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TestUser;
  let listSpy: jest.SpiedFunction<GmailApiService['listMessageIds']>;
  let getSpy: jest.SpiedFunction<GmailApiService['getMessage']>;
  const userIds: string[] = [];
  const tempDirs: string[] = [];
  let failureCodes = new Map<string, string | null>();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = await registerUser(app, 't048-admin');
    userIds.push(admin.id);
    await promoteToAdminForTest(prisma, admin.id);
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    const gmail = app.get(GmailApiService);
    listSpy = jest.spyOn(gmail, 'listMessageIds');
    getSpy = jest.spyOn(gmail, 'getMessage');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    if (prisma) await cleanupUsers(prisma, userIds);
    await app?.close();
  });

  /** Runs one declared parser's fixtures through a fresh user's mailbox. */
  async function measure(
    declaration: ParserDeclaration,
  ): Promise<ParserResult> {
    const template = JSON.parse(
      readFileSync(repoPath(declaration.template), 'utf8'),
    ) as {
      name: string;
      bankProviderId: string;
      channel: string;
      version: number;
    };
    expect(template).toMatchObject({
      bankProviderId: declaration.bank,
      channel: declaration.channel,
      version: declaration.version,
    });
    const { valid, malformed } = loadFixtures(declaration.fixtures);
    const fixtures: EmailFixture[] = [...valid, ...malformed];

    const user = await registerUser(app, 't048-gate');
    userIds.push(user.id);
    await prisma.parserTemplate.deleteMany({
      where: {
        bankProviderId: declaration.bank,
        name: template.name,
        version: declaration.version,
      },
    });
    const templateId = await createParserTemplate(admin.agent, template);
    try {
      const connection = await createGmailConnection(app, user.id, 't048');
      for (const sender of new Set(
        fixtures.map((f) => senderOf(f.message.from)),
      )) {
        await createListenRule(user.agent, {
          connectionId: connection.id,
          senderEmail: sender,
          bankProviderId: declaration.bank,
        });
      }
      const ids = fixtures.map((_, index) => `t048-${RUN_ID}-${index}`);
      const byId = new Map(ids.map((id, index) => [id, fixtures[index]]));
      listSpy.mockResolvedValue({ ids });
      getSpy.mockImplementation((_token, id) => {
        const fixture = byId.get(id)!;
        return Promise.resolve(
          gmailMessage({
            id,
            from: fixture.message.from,
            subject: fixture.message.subject,
            receivedAt: new Date(fixture.message.receivedAt),
            body: fixture.message.body.join('\n'),
          }),
        );
      });
      for (let batch = 0; batch < 5; batch++) {
        const run = dataOf<{ hasMore: boolean }>(
          await user.agent
            .post(`/api/email-connections/${idPath(connection.id)}/sync`)
            .expect(201),
        );
        if (!run.hasMore) break;
      }

      const messages = await prisma.emailMessage.findMany({
        where: { emailConnectionId: connection.id },
        include: {
          transaction: true,
          parserRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      const byProvider = new Map(messages.map((m) => [m.providerMessageId, m]));
      const outcome = (fixture: EmailFixture) =>
        byProvider.get(ids[fixtures.indexOf(fixture)]);

      const mismatched = valid
        .filter((fixture) => {
          const tx = outcome(fixture)?.transaction;
          return !(
            tx &&
            tx.status === 'POSTED' &&
            tx.sourceType === 'EMAIL' &&
            isDeepStrictEqual(
              asExpected(tx, fixture.message.subject),
              fixture.expected,
            )
          );
        })
        .map((fixture) => fixture.file);
      failureCodes = new Map(
        malformed.map((fixture) => [
          fixture.file,
          outcome(fixture)?.parserRuns[0]?.errorMessage ?? null,
        ]),
      );
      const exact = valid.length - mismatched.length;
      return {
        declaration,
        valid: valid.length,
        malformed: malformed.length,
        exact,
        rate: valid.length ? exact / valid.length : 0,
        mismatched,
        malformedCreated: malformed
          .filter((fixture) => outcome(fixture)?.transaction)
          .map((fixture) => fixture.file),
      };
    } finally {
      await prisma.parserTemplate.deleteMany({ where: { id: templateId } });
      listSpy.mockReset();
      getSpy.mockReset();
    }
  }

  /** The gate: a declaration problem fails it like a failing parser does. */
  async function runGate(markdown: string) {
    let declarations: ParserDeclaration[];
    try {
      declarations = readDeclarations(markdown);
    } catch (error) {
      if (error instanceof DeclarationError) {
        return { results: [], failures: [error.message] };
      }
      throw error;
    }
    const results: ParserResult[] = [];
    for (const declaration of declarations) {
      results.push(await measure(declaration));
    }
    return { results, failures: gateFailures(results) };
  }

  /** A temporary copy of the real fixtures, changed by `edit`. */
  function tempFixtures(edit: (dir: string) => void): ParserDeclaration {
    const dir = mkdtempSync(join(tmpdir(), 't048-'));
    tempDirs.push(dir);
    cpSync(repoPath(REAL.fixtures), dir, { recursive: true });
    edit(dir);
    return { ...REAL, fixtures: dir };
  }

  it('every declared parser reaches the gate on its own fixtures', async () => {
    const { results, failures } = await runGate(DECLARED);
    // Release evidence: one row per declared parser.
    console.log(`T048 parser gate\n${formatResults(results)}`);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(failures).toEqual([]);
    for (const result of results) {
      expect(result.mismatched).toEqual([]);
    }
    // Each malformed fixture fails for the reason it was written for.
    const { malformed } = loadFixtures(REAL.fixtures);
    for (const fixture of malformed) {
      expect([fixture.file, failureCodes.get(fixture.file)]).toEqual([
        fixture.file,
        fixture.expectedFailure,
      ]);
    }
  });

  it('fails when no parser is declared', async () => {
    const { failures } = await runGate(declarationTable([]));
    expect(failures).toEqual(['No parser is declared']);
  });

  it.each([
    [
      'the markers are missing',
      DECLARED.replace('<!-- supported-parsers:begin -->', ''),
    ],
    ['a row is unreadable', declarationTable([{ ...REAL, version: 0 }])],
    [
      'the header is changed',
      declarationTable([REAL]).replace('| Bank |', '| Provider |'),
    ],
  ])('fails when %s', async (_label, markdown) => {
    const { results, failures } = await runGate(markdown);
    expect(results).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('fails when a single parser is below 85%', async () => {
    // Just enough wrong expectations to fall below 85%, whatever the count.
    const validCount = readdirSync(
      join(repoPath(REAL.fixtures), 'valid'),
    ).length;
    const wrong = Math.floor(validCount * 0.15) + 1;
    const declaration = tempFixtures((dir) => {
      for (const file of readdirSync(join(dir, 'valid'))
        .sort()
        .slice(0, wrong)) {
        const path = join(dir, 'valid', file);
        const fixture = JSON.parse(readFileSync(path, 'utf8')) as Omit<
          EmailFixture,
          'file'
        >;
        fixture.expected!.amount += 1;
        writeFileSync(path, JSON.stringify(fixture));
      }
    });
    const { results, failures } = await runGate(
      declarationTable([declaration]),
    );
    expect(results[0]).toMatchObject({
      valid: validCount,
      exact: validCount - wrong,
    });
    expect(failures).toEqual([expect.stringContaining('below 85%')]);
  });

  it('fails when a parser has fewer than 10 valid fixtures', async () => {
    const declaration = tempFixtures((dir) => {
      for (const file of readdirSync(join(dir, 'valid')).sort().slice(9)) {
        rmSync(join(dir, 'valid', file));
      }
    });
    const { failures } = await runGate(declarationTable([declaration]));
    expect(failures).toEqual([expect.stringContaining('9 valid fixtures')]);
  });

  it('fails when a parser has fewer than 2 malformed fixtures', async () => {
    const declaration = tempFixtures((dir) => {
      for (const file of readdirSync(join(dir, 'malformed')).sort().slice(1)) {
        rmSync(join(dir, 'malformed', file));
      }
    });
    const { failures } = await runGate(declarationTable([declaration]));
    expect(failures).toEqual([expect.stringContaining('1 malformed fixtures')]);
  });

  it('fails when a malformed fixture creates a transaction', async () => {
    // A "malformed" fixture that is in fact a valid, distinct event.
    const declaration = tempFixtures((dir) => {
      const fixture = JSON.parse(
        readFileSync(
          join(dir, 'valid', '03-debit-unsigned-amount.json'),
          'utf8',
        ),
      ) as Omit<EmailFixture, 'file'>;
      fixture.message.body = fixture.message.body.map((line: string) =>
        line.replace('FT26182CF01', 'FT26182CF99'),
      );
      delete fixture.expected;
      fixture.expectedFailure = 'INVALID_AMOUNT: amount';
      writeFileSync(
        join(dir, 'malformed', 'm99-posts.json'),
        JSON.stringify(fixture),
      );
    });
    const { failures } = await runGate(declarationTable([declaration]));
    expect(failures).toEqual([
      expect.stringContaining(
        'malformed fixtures created transactions: malformed/m99-posts.json',
      ),
    ]);
  });
});
