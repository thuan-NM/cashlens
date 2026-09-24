import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { GmailApiService } from '../src/modules/email-ingestion/gmail-api.service';
import { ClassificationRepository } from '../src/modules/transactions/classification.repository';
import { ClassificationService } from '../src/modules/transactions/classification.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  RUN_ID,
  TestUser,
  absentId,
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

jest.setTimeout(120_000);

/** Every text this suite classifies carries the run marker, so its system rules match nothing else. */
const MARK = `cls-e2e-${RUN_ID}`;
const SWEEP_PREFIX = 'cls-e2e-';
const BANK = 'bank_vcb';
const SENDER = 'notify@vcb.example.test';
const SUBJECT_TAG = `T057-${RUN_ID}`;
/** Repeated runs of a conflict fixture (SC-006). */
const REPEATS = 5;
/** Replays of an unchanged mailbox (SC-004 with classification). */
const REPLAYS = 3;

const SYS_FOOD = 'sys_cat_expense_food';
const SYS_TRANSPORT = 'sys_cat_expense_transport';
const SYS_SHOPPING = 'sys_cat_expense_shopping';
const SYS_BILLS = 'sys_cat_expense_bills';

type Explanation = {
  candidates: Array<{
    ruleId: string;
    scope: 'USER' | 'SYSTEM';
    priority: number;
    createdAt: string;
    categoryId: string;
  }>;
  winnerRuleId: string | null;
  runnerUpRuleId: string | null;
  tieBreak: 'SCOPE' | 'PRIORITY' | 'CREATED_AT' | 'ID' | null;
  conflict: boolean;
};
type Tx = {
  id: string;
  categoryId: string | null;
  classificationSource: string;
  classificationRuleId: string | null;
  classificationConfidence: number | null;
  classifiedAt: string | null;
  isDuplicate: boolean;
  status: string;
  userNote: string | null;
};
type CorrectionResponse = Tx & {
  decision: { source: string; reason: string; eventId: string | null };
};
type ReclassifyResponse = Tx & {
  decision: {
    source: string;
    categoryId: string | null;
    ruleId: string | null;
    reason: string;
    explanation: Explanation;
    eventId: string;
  };
};
type HistoryEvent = {
  id: string;
  sequence: number;
  createdAt: string;
  source: string;
  trigger: string;
  reason: string;
  actorType: string;
  actorUserId: string | null;
  merchantRuleId: string | null;
  previousCategory: { id: string; name: string | null } | null;
  newCategory: { id: string; name: string | null } | null;
  explanation: Explanation | null;
};
type Rule = {
  id: string;
  scope: 'USER' | 'SYSTEM';
  categoryId: string | null;
  merchantPattern: string | null;
  descriptionPattern: string | null;
  bankName: string | null;
  direction: string | null;
  priority: number;
  isActive: boolean;
};

// T057 (CLASS-001–CLASS-007, TX-004, TEST-004, TEST-005, SC-006): rules,
// precedence, manual corrections, explicit reclassification, the append-only
// history, and email import replays, end to end through the HTTP API and the
// Gmail pipeline (Gmail itself is a spy).
describe('Deterministic classification (T057)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rules: ClassificationRepository;
  let classification: ClassificationService;
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  let templateId: string | undefined;
  /** alice's own categories, and one of bob's. */
  let catA: string;
  let catB: string;
  let bobCat: string;
  const systemRuleIds: string[] = [];
  /** alice's rules by role. */
  const r: Record<string, Rule> = {};
  /** alice's transactions by role. */
  const tx: Record<string, string> = {};

  // --- helpers -------------------------------------------------------------

  const sweepSystemRules = () =>
    prisma.merchantRule.deleteMany({
      where: {
        userId: null,
        OR: [
          { merchantPattern: { startsWith: SWEEP_PREFIX } },
          { descriptionPattern: { startsWith: SWEEP_PREFIX } },
        ],
      },
    });

  const systemRule = async (data: {
    categoryId: string;
    descriptionPattern?: string;
    merchantPattern?: string;
    priority: number;
  }) => {
    const rule = await rules.createSystemRule(data);
    systemRuleIds.push(rule.id);
    return rule;
  };

  const createRule = async (user: TestUser, body: Record<string, unknown>) =>
    dataOf<Rule>(
      await user.agent.post('/api/classification-rules').send(body).expect(201),
    );

  const createTx = async (
    user: TestUser,
    description: string,
    extra: Record<string, unknown> = {},
  ) =>
    dataOf<Tx>(
      await user.agent
        .post('/api/transactions')
        .send({
          amount: 50_000,
          currency: 'VND',
          direction: 'EXPENSE',
          transactionTime: new Date().toISOString(),
          description,
          ...extra,
        })
        .expect(201),
    );

  const txOf = async (user: TestUser, id: string) =>
    dataOf<Tx>(
      await user.agent.get(`/api/transactions/${idPath(id)}`).expect(200),
    );

  const eventsOf = (transactionId: string) =>
    prisma.transactionCategoryEvent.findMany({
      where: { transactionId },
      orderBy: { sequence: 'asc' },
    });

  const eventCount = (userId: string) =>
    prisma.transactionCategoryEvent.count({ where: { userId } });

  const history = async (user: TestUser, id: string) =>
    dataOf<HistoryEvent[]>(
      await user.agent
        .get(`/api/transactions/${idPath(id)}/category-history`)
        .expect(200),
    );

  const setCategory = (user: TestUser, id: string, body: unknown) =>
    user.agent
      .patch(`/api/transactions/${idPath(id)}/category`)
      .send(body as object);

  const reclassify = (user: TestUser, id: string, body: object = {}) =>
    user.agent.post(`/api/transactions/${idPath(id)}/reclassify`).send(body);

  const auditsOf = (resourceId: string, action: string) =>
    prisma.auditLog.findMany({
      where: { resourceId, action },
      orderBy: { createdAt: 'asc' },
    });

  const classificationState = (id: string) =>
    prisma.transaction.findUniqueOrThrow({
      where: { id },
      select: {
        categoryId: true,
        classificationSource: true,
        classificationRuleId: true,
        classificationConfidence: true,
        classifiedAt: true,
        updatedAt: true,
      },
    });

  const setAutoClassification = (user: TestUser, enabled: boolean) =>
    user.agent
      .patch('/api/users/me/settings')
      .send({ autoClassificationEnabled: enabled })
      .expect(200);

  // --- lifecycle -----------------------------------------------------------

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    rules = app.get(ClassificationRepository);
    classification = app.get(ClassificationService);
    await sweepSystemRules(); // leftovers of an interrupted run

    alice = await registerUser(app, 't057-alice');
    bob = await registerUser(app, 't057-bob');
    admin = await registerUser(app, 't057-admin');
    await promoteToAdminForTest(prisma, admin.id);
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);

    const category = async (user: TestUser, name: string) =>
      dataOf<{ id: string }>(
        await user.agent
          .post('/api/transaction-categories')
          .send({ name: `${name} ${RUN_ID}`, type: 'EXPENSE' })
          .expect(201),
      ).id;
    catA = await category(alice, 'T057 Cà phê');
    catB = await category(alice, 'T057 Khác');
    bobCat = await category(bob, 'T057 Bob');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      try {
        await cleanupUsers(prisma, [alice?.id, bob?.id, admin?.id]);
        if (templateId) {
          await prisma.parserTemplate.deleteMany({ where: { id: templateId } });
        }
      } finally {
        await prisma.merchantRule.deleteMany({
          where: { id: { in: systemRuleIds } },
        });
        await sweepSystemRules();
      }
    }
    await app?.close();
  });

  // --- rules (CLASS-001, T052) ---------------------------------------------

  describe('rules', () => {
    it('alice creates user rules for her own and system categories; the response carries no owner', async () => {
      r.coffee = await createRule(alice, {
        categoryId: catA,
        descriptionPattern: `${MARK} coffee`,
        priority: 10,
      });
      expect(r.coffee).toMatchObject({
        scope: 'USER',
        categoryId: catA,
        descriptionPattern: `${MARK} coffee`,
        merchantPattern: null,
        bankName: null,
        direction: null,
        priority: 10,
        isActive: true,
      });
      expect(r.coffee).not.toHaveProperty('userId');

      const toSystem = await createRule(alice, {
        categoryId: SYS_BILLS,
        descriptionPattern: `${MARK} electricity`,
        direction: 'EXPENSE',
      });
      expect(toSystem).toMatchObject({
        scope: 'USER',
        categoryId: SYS_BILLS,
        priority: 100, // the default
        direction: 'EXPENSE',
      });
    });

    it('refuses invalid rules with 400 and hides other owners’ categories with 404', async () => {
      const post = (body: Record<string, unknown>) =>
        alice.agent.post('/api/classification-rules').send(body);
      const before = await prisma.merchantRule.count({
        where: { userId: alice.id },
      });

      // No text criterion: direction alone would match every expense.
      await post({ categoryId: catA, direction: 'EXPENSE' }).expect(400);
      await post({ categoryId: catA, descriptionPattern: '' }).expect(400);
      await post({ categoryId: catA, merchantPattern: 'x'.repeat(201) }).expect(
        400,
      );
      await post({
        categoryId: catA,
        merchantPattern: 'a',
        priority: -1,
      }).expect(400);
      await post({
        categoryId: catA,
        merchantPattern: 'a',
        priority: 1.5,
      }).expect(400);
      // Ownership and scope are derived on the server (SEC-004).
      await post({
        categoryId: catA,
        merchantPattern: 'a',
        userId: bob.id,
      }).expect(400);
      await post({
        categoryId: catA,
        merchantPattern: 'a',
        scope: 'SYSTEM',
      }).expect(400);
      // Another owner's, absent, and archived categories are all not found.
      for (const categoryId of [bobCat, absentId()]) {
        const response = await post({
          categoryId,
          merchantPattern: 'a',
        }).expect(404);
        expect((response.body as { message: string }).message).toBe(
          'Transaction category not found',
        );
      }
      const archived = dataOf<{ id: string }>(
        await alice.agent
          .post('/api/transaction-categories')
          .send({ name: `T057 archived ${RUN_ID}`, type: 'EXPENSE' })
          .expect(201),
      ).id;
      await alice.agent
        .delete(`/api/transaction-categories/${idPath(archived)}`)
        .expect(200);
      await post({ categoryId: archived, merchantPattern: 'a' }).expect(404);

      expect(
        await prisma.merchantRule.count({ where: { userId: alice.id } }),
      ).toBe(before);
    });

    it('the database refuses rule targets outside the rule’s scope (T052)', async () => {
      await expect(
        prisma.merchantRule.create({
          data: { userId: null, categoryId: catA, descriptionPattern: MARK },
        }),
      ).rejects.toThrow(
        /A system classification rule must target a system category/,
      );
      await expect(
        prisma.merchantRule.create({
          data: {
            userId: alice.id,
            categoryId: bobCat,
            descriptionPattern: MARK,
          },
        }),
      ).rejects.toThrow(/must target a system category or one of its owner/);
      await expect(
        prisma.merchantRule.update({
          where: { id: r.coffee.id },
          data: { categoryId: bobCat },
        }),
      ).rejects.toThrow(/must target a system category or one of its owner/);
      expect(await rules.ruleTargetAllowed('SYSTEM', catA)).toBe(false);
      expect(await rules.ruleTargetAllowed('SYSTEM', SYS_FOOD)).toBe(true);
      expect(await rules.ruleTargetAllowed({ userId: alice.id }, bobCat)).toBe(
        false,
      );
      expect(await rules.ruleTargetAllowed({ userId: alice.id }, catA)).toBe(
        true,
      );
      expect(
        await rules.ruleTargetAllowed({ userId: alice.id }, SYS_FOOD),
      ).toBe(true);
      expect(
        (
          await prisma.merchantRule.findUniqueOrThrow({
            where: { id: r.coffee.id },
          })
        ).categoryId,
      ).toBe(catA);
    });

    it('system rules are listed read-only; other owners’ rules are invisible and untouchable', async () => {
      const coffee = await systemRule({
        categoryId: SYS_FOOD,
        descriptionPattern: `${MARK} coffee`,
        priority: 900,
      });
      const bobRule = await createRule(bob, {
        categoryId: bobCat,
        descriptionPattern: `${MARK} coffee`,
        priority: 1_000_000,
      });
      r.bob = bobRule;

      const aliceList = dataOf<Rule[]>(
        await alice.agent.get('/api/classification-rules').expect(200),
      );
      const ids = aliceList.map((rule) => rule.id);
      expect(ids).toEqual(expect.arrayContaining([r.coffee.id, coffee.id]));
      expect(ids).not.toContain(bobRule.id);
      expect(aliceList.find((rule) => rule.id === coffee.id)).toMatchObject({
        scope: 'SYSTEM',
        categoryId: SYS_FOOD,
      });

      // A system rule cannot be changed or deleted through the API, and bob's
      // rule is not found for alice or the administrator.
      for (const user of [alice, admin]) {
        for (const id of [coffee.id, bobRule.id]) {
          await user.agent
            .patch(`/api/classification-rules/${idPath(id)}`)
            .send({ priority: 1 })
            .expect(404);
          await user.agent
            .delete(`/api/classification-rules/${idPath(id)}`)
            .expect(404);
        }
      }
      expect(
        dataOf<Rule[]>(
          await bob.agent.get('/api/classification-rules').expect(200),
        ).map((rule) => rule.id),
      ).not.toContain(r.coffee.id);
      expect(
        await prisma.merchantRule.findUniqueOrThrow({
          where: { id: bobRule.id },
        }),
      ).toMatchObject({ priority: 1_000_000, userId: bob.id });
      expect(
        await prisma.merchantRule.findUniqueOrThrow({
          where: { id: coffee.id },
        }),
      ).toMatchObject({ priority: 900, userId: null });
    });

    it('PATCH changes only what is sent; null clears a pattern but never the category, priority, or state', async () => {
      const rule = await createRule(alice, {
        categoryId: catB,
        merchantPattern: `${MARK} patch-me`,
        descriptionPattern: `${MARK} patch-desc`,
      });
      const path = `/api/classification-rules/${idPath(rule.id)}`;
      const patched = dataOf<Rule>(
        await alice.agent
          .patch(path)
          .send({ priority: 55, descriptionPattern: null })
          .expect(200),
      );
      expect(patched).toMatchObject({
        priority: 55,
        descriptionPattern: null,
        merchantPattern: `${MARK} patch-me`,
        categoryId: catB,
      });
      const refused: Array<[Record<string, unknown>, number]> = [
        [{ categoryId: null }, 400],
        [{ priority: null }, 400],
        [{ isActive: null }, 400],
        [{ merchantPattern: null }, 400], // would leave no text criterion
        [{ userId: bob.id }, 400],
        [{ categoryId: bobCat }, 404],
      ];
      for (const [body, status] of refused) {
        const response = await alice.agent.patch(path).send(body);
        expect([body, response.status]).toEqual([body, status]);
      }
      expect(
        await prisma.merchantRule.findUniqueOrThrow({ where: { id: rule.id } }),
      ).toMatchObject({
        userId: alice.id,
        categoryId: catB,
        priority: 55,
        isActive: true,
        merchantPattern: `${MARK} patch-me`,
      });
      await alice.agent.delete(path).expect(200);
      await alice.agent.delete(path).expect(404);
    });
  });

  // --- precedence on creation (CLASS-002–CLASS-004, T055) ------------------

  describe('precedence', () => {
    beforeAll(async () => {
      await systemRule({
        categoryId: SYS_TRANSPORT,
        descriptionPattern: `${MARK} taxi`,
        priority: 50,
      });
    });

    it('a user rule outranks a matching system rule of higher priority (SCOPE), with the conflict explained', async () => {
      const created = await createTx(alice, `${MARK} Coffee sáng`);
      tx.coffee = created.id;
      expect(created).toMatchObject({
        categoryId: catA,
        classificationSource: 'USER_RULE',
        classificationRuleId: r.coffee.id,
        classificationConfidence: 1,
      });
      expect(created.classifiedAt).toEqual(expect.any(String));

      const [event] = await history(alice, created.id);
      expect(event).toMatchObject({
        sequence: 1,
        trigger: 'CREATE',
        source: 'USER_RULE',
        reason: 'RULE_MATCHED',
        actorType: 'SYSTEM',
        actorUserId: null,
        merchantRuleId: r.coffee.id,
        previousCategory: null,
        newCategory: { id: catA, name: `T057 Cà phê ${RUN_ID}` },
      });
      expect(event.explanation).toMatchObject({
        winnerRuleId: r.coffee.id,
        tieBreak: 'SCOPE',
        conflict: true,
      });
      // bob's higher-priority rule for the same text is never a candidate.
      expect(event.explanation!.candidates.map((c) => c.scope)).toEqual([
        'USER',
        'SYSTEM',
      ]);
      expect(event.explanation!.candidates[0]).toEqual({
        ruleId: r.coffee.id,
        scope: 'USER',
        priority: 10,
        createdAt: expect.any(String) as string,
        categoryId: catA,
      });
    });

    it('bob’s transaction uses bob’s rule, never alice’s', async () => {
      const created = await createTx(bob, `${MARK} coffee`);
      expect(created).toMatchObject({
        categoryId: bobCat,
        classificationSource: 'USER_RULE',
        classificationRuleId: r.bob.id,
      });
    });

    it('with no user rule, the matching system rule decides', async () => {
      const created = await createTx(alice, `${MARK} TAXI về nhà`);
      tx.taxi = created.id;
      expect(created).toMatchObject({
        categoryId: SYS_TRANSPORT,
        classificationSource: 'SYSTEM_RULE',
        classificationConfidence: 1,
      });
      const [event] = await eventsOf(created.id);
      expect(event).toMatchObject({
        source: 'SYSTEM_RULE',
        reason: 'RULE_MATCHED',
        explanation: {
          tieBreak: null,
          conflict: false,
          runnerUpRuleId: null,
        },
      });
    });

    it('with no match, the explicit fallback: no category, source FALLBACK, and a recorded reason (CLASS-004)', async () => {
      const created = await createTx(alice, `${MARK} misc`);
      tx.misc = created.id;
      expect(created).toMatchObject({
        categoryId: null,
        classificationSource: 'FALLBACK',
        classificationRuleId: null,
        classificationConfidence: null,
      });
      expect(await history(alice, created.id)).toEqual([
        expect.objectContaining({
          trigger: 'CREATE',
          source: 'FALLBACK',
          reason: 'NO_RULE_MATCHED',
          merchantRuleId: null,
          newCategory: null,
          explanation: {
            candidates: [],
            winnerRuleId: null,
            runnerUpRuleId: null,
            tieBreak: null,
            conflict: false,
          },
        }),
      ]);
    });

    it('a category chosen at creation is MANUAL; rules are not consulted', async () => {
      const created = await createTx(alice, `${MARK} coffee`, {
        categoryId: SYS_SHOPPING,
      });
      expect(created).toMatchObject({
        categoryId: SYS_SHOPPING,
        classificationSource: 'MANUAL',
        classificationRuleId: null,
      });
      expect(await eventsOf(created.id)).toEqual([
        expect.objectContaining({
          trigger: 'CREATE',
          source: 'MANUAL',
          reason: 'MANUAL_SET',
          actorType: 'USER',
          actorUserId: alice.id,
          explanation: null,
        }),
      ]);
    });

    it('with automatic classification off, a new transaction stays UNKNOWN and no event is written', async () => {
      await setAutoClassification(alice, false);
      try {
        const created = await createTx(alice, `${MARK} coffee`);
        expect(created).toMatchObject({
          categoryId: null,
          classificationSource: 'UNKNOWN',
          classificationRuleId: null,
          classifiedAt: null,
        });
        expect(await eventsOf(created.id)).toEqual([]);
        expect(await history(alice, created.id)).toEqual([]);
        expect(
          await classification.applyAutomatic(alice.id, created.id),
        ).toEqual({ outcome: 'DISABLED' });
        tx.unknown = created.id;
      } finally {
        await setAutoClassification(alice, true);
      }
    });

    it('equal-priority rules resolve by earliest createdAt, then smallest id; the same winner on every run (SC-006)', async () => {
      const pinned = (suffix: string) => `cls-${RUN_ID}-tie-${suffix}`;
      const base = {
        userId: alice.id,
        descriptionPattern: `${MARK} tie`,
      };
      await prisma.merchantRule.createMany({
        data: [
          // Created in an order unrelated to the ranking.
          {
            ...base,
            id: pinned('c'),
            categoryId: catB,
            priority: 300,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            ...base,
            id: pinned('0'),
            categoryId: catB,
            priority: 299,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
          {
            ...base,
            id: pinned('a'),
            categoryId: catB,
            priority: 300,
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          },
          {
            ...base,
            id: pinned('b'),
            categoryId: catA,
            priority: 300,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      });
      const system = await systemRule({
        categoryId: SYS_FOOD,
        descriptionPattern: `${MARK} tie`,
        priority: 1_000,
      });
      const candidate = (
        ruleId: string,
        scope: 'USER' | 'SYSTEM',
        priority: number,
        createdAt: string,
        categoryId: string,
      ) => ({ ruleId, scope, priority, createdAt, categoryId });
      // User rules first; then priority; then earliest createdAt; then id.
      const expected: Explanation = {
        candidates: [
          candidate(pinned('b'), 'USER', 300, '2026-01-01T00:00:00.000Z', catA),
          candidate(pinned('c'), 'USER', 300, '2026-01-01T00:00:00.000Z', catB),
          candidate(pinned('a'), 'USER', 300, '2026-02-01T00:00:00.000Z', catB),
          candidate(pinned('0'), 'USER', 299, '2025-01-01T00:00:00.000Z', catB),
          candidate(
            system.id,
            'SYSTEM',
            1_000,
            system.createdAt.toISOString(),
            SYS_FOOD,
          ),
        ],
        winnerRuleId: pinned('b'),
        runnerUpRuleId: pinned('c'),
        tieBreak: 'ID',
        conflict: true,
      };

      const created = await createTx(alice, `${MARK} tie breaker`);
      tx.tie = created.id;
      expect(created).toMatchObject({
        categoryId: catA,
        classificationRuleId: pinned('b'),
      });
      expect((await eventsOf(created.id))[0].explanation).toEqual(expected);

      for (let run = 1; run <= REPEATS; run++) {
        const response = dataOf<ReclassifyResponse>(
          await reclassify(alice, created.id).expect(200),
        );
        expect([run, response.decision]).toEqual([
          run,
          {
            source: 'USER_RULE',
            categoryId: catA,
            ruleId: pinned('b'),
            reason: 'RULE_MATCHED',
            explanation: expected,
            eventId: expect.any(String) as string,
          },
        ]);
      }
      const events = await eventsOf(created.id);
      expect(events.map((e) => [e.sequence, e.trigger])).toEqual([
        [1, 'CREATE'],
        ...Array.from({ length: REPEATS }, (_, i) => [
          i + 2,
          'EXPLICIT_RECLASSIFY',
        ]),
      ]);
      // jsonb reorders keys, so the stored explanations are compared as values.
      for (const event of events) {
        expect([event.sequence, event.explanation]).toEqual([
          event.sequence,
          expected,
        ]);
      }
      // An explicit request is always audited, even with an unchanged result.
      const audits = await auditsOf(created.id, 'TRANSACTION_RECLASSIFIED');
      expect(audits).toHaveLength(REPEATS);
      expect(audits[0]).toMatchObject({
        userId: alice.id,
        actorType: 'USER',
        metadata: {
          fromCategoryId: catA,
          toCategoryId: catA,
          source: 'USER_RULE',
        },
      });
      // Automatic reruns of the unchanged decision write nothing.
      expect(await classification.applyAutomatic(alice.id, created.id)).toEqual(
        expect.objectContaining({ outcome: 'UNCHANGED' }),
      );
      expect(await eventsOf(created.id)).toHaveLength(REPEATS + 1);
    });
  });

  // --- manual correction and explicit reclassification (TX-004, CLASS-006) --

  describe('manual correction', () => {
    it('PATCH /category is a MANUAL decision with an event and an audit row', async () => {
      const before = await classificationState(tx.coffee);
      const response = await setCategory(alice, tx.coffee, {
        categoryId: SYS_SHOPPING,
      }).expect(200);
      const body = dataOf<CorrectionResponse>(response);
      expect(body).toMatchObject({
        categoryId: SYS_SHOPPING,
        classificationSource: 'MANUAL',
        classificationRuleId: null,
        classificationConfidence: 1,
        decision: {
          source: 'MANUAL',
          reason: 'MANUAL_SET',
          eventId: expect.any(String) as string,
        },
      });
      const events = await eventsOf(tx.coffee);
      expect(events.at(-1)).toMatchObject({
        id: body.decision.eventId,
        sequence: 2,
        trigger: 'MANUAL_CORRECTION',
        source: 'MANUAL',
        reason: 'MANUAL_SET',
        previousCategoryId: before.categoryId,
        newCategoryId: SYS_SHOPPING,
        merchantRuleId: null,
        actorType: 'USER',
        actorUserId: alice.id,
        explanation: null,
      });
      const audits = await auditsOf(
        tx.coffee,
        'TRANSACTION_CATEGORY_CORRECTED',
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toEqual({
        fromCategoryId: catA,
        toCategoryId: SYS_SHOPPING,
      });
    });

    it('repeating the same manual choice writes nothing', async () => {
      const before = await classificationState(tx.coffee);
      const body = dataOf<CorrectionResponse>(
        await setCategory(alice, tx.coffee, {
          categoryId: SYS_SHOPPING,
        }).expect(200),
      );
      expect(body.decision).toEqual({
        source: 'MANUAL',
        reason: 'MANUAL_SET',
        eventId: null,
      });
      expect(await classificationState(tx.coffee)).toEqual(before);
      expect(await eventsOf(tx.coffee)).toHaveLength(2);
      expect(
        await auditsOf(tx.coffee, 'TRANSACTION_CATEGORY_CORRECTED'),
      ).toHaveLength(1);
    });

    it('automatic reruns never overwrite a manual category (SC-006, TX-004)', async () => {
      const before = await classificationState(tx.coffee);
      for (let run = 0; run < REPEATS; run++) {
        expect(
          await classification.applyAutomatic(alice.id, tx.coffee),
        ).toEqual({ outcome: 'PROTECTED' });
      }
      expect(await classificationState(tx.coffee)).toEqual(before);
      expect(await eventsOf(tx.coffee)).toHaveLength(2);
    });

    it('editing other fields leaves the classification alone', async () => {
      const before = await classificationState(tx.taxi);
      const events = await eventCount(alice.id);
      const body = dataOf<Tx>(
        await alice.agent
          .patch(`/api/transactions/${idPath(tx.taxi)}`)
          .send({ userNote: 'T057 note', description: `${MARK} coffee now` })
          .expect(200),
      );
      expect(body.userNote).toBe('T057 note');
      const after = await classificationState(tx.taxi);
      expect({ ...after, updatedAt: null }).toEqual({
        ...before,
        updatedAt: null,
      });
      expect(await eventCount(alice.id)).toBe(events);
    });

    it('PATCH /:id with a category is the same manual correction; null clears and still locks', async () => {
      const set = dataOf<Tx>(
        await alice.agent
          .patch(`/api/transactions/${idPath(tx.taxi)}`)
          .send({ categoryId: catB })
          .expect(200),
      );
      expect(set).toMatchObject({
        categoryId: catB,
        classificationSource: 'MANUAL',
      });
      const cleared = dataOf<CorrectionResponse>(
        await setCategory(alice, tx.taxi, { categoryId: null }).expect(200),
      );
      expect(cleared).toMatchObject({
        categoryId: null,
        classificationSource: 'MANUAL',
        classificationConfidence: null,
        decision: { source: 'MANUAL', reason: 'MANUAL_CLEARED' },
      });
      // A cleared category is a manual choice too: automatic runs keep it.
      expect(await classification.applyAutomatic(alice.id, tx.taxi)).toEqual({
        outcome: 'PROTECTED',
      });
      expect((await txOf(alice, tx.taxi)).categoryId).toBeNull();
      expect(
        (await eventsOf(tx.taxi)).map((e) => [e.trigger, e.reason]),
      ).toEqual([
        ['CREATE', 'RULE_MATCHED'],
        ['MANUAL_CORRECTION', 'MANUAL_SET'],
        ['MANUAL_CORRECTION', 'MANUAL_CLEARED'],
      ]);
      expect(
        (await auditsOf(tx.taxi, 'TRANSACTION_CATEGORY_CORRECTED')).map(
          (a) => a.metadata,
        ),
      ).toEqual([
        { fromCategoryId: SYS_TRANSPORT, toCategoryId: catB },
        { fromCategoryId: catB, toCategoryId: null },
      ]);
    });

    it('refused corrections and reclassifications change nothing and append nothing', async () => {
      const before = await classificationState(tx.coffee);
      const events = await eventCount(alice.id);
      await setCategory(alice, tx.coffee, {}).expect(400);
      await setCategory(alice, tx.coffee, { categoryId: '' }).expect(400);
      await setCategory(alice, tx.coffee, { categoryId: 42 }).expect(400);
      await setCategory(alice, tx.coffee, {
        categoryId: catA,
        classificationSource: 'USER_RULE',
      }).expect(400);
      for (const categoryId of [bobCat, absentId()]) {
        await setCategory(alice, tx.coffee, { categoryId }).expect(404);
      }
      await reclassify(alice, tx.coffee, { categoryId: catA }).expect(400);
      await reclassify(alice, tx.coffee, { mode: 'AUTOMATIC' }).expect(400);
      expect(await classificationState(tx.coffee)).toEqual(before);
      expect(await eventCount(alice.id)).toBe(events);
    });

    it('an explicit reclassification releases the manual lock, records who asked, and is audited (CLASS-006)', async () => {
      const response = dataOf<ReclassifyResponse>(
        await reclassify(alice, tx.coffee).expect(200),
      );
      expect(response).toMatchObject({
        categoryId: catA,
        classificationSource: 'USER_RULE',
        classificationRuleId: r.coffee.id,
        decision: {
          source: 'USER_RULE',
          categoryId: catA,
          ruleId: r.coffee.id,
          reason: 'RULE_MATCHED',
          explanation: { winnerRuleId: r.coffee.id, tieBreak: 'SCOPE' },
        },
      });
      expect((await eventsOf(tx.coffee)).at(-1)).toMatchObject({
        id: response.decision.eventId,
        trigger: 'EXPLICIT_RECLASSIFY',
        source: 'USER_RULE',
        previousCategoryId: SYS_SHOPPING,
        newCategoryId: catA,
        merchantRuleId: r.coffee.id,
        actorType: 'USER',
        actorUserId: alice.id,
      });
      expect(
        (await auditsOf(tx.coffee, 'TRANSACTION_RECLASSIFIED')).map(
          (a) => a.metadata,
        ),
      ).toEqual([
        {
          fromCategoryId: SYS_SHOPPING,
          toCategoryId: catA,
          source: 'USER_RULE',
        },
      ]);

      // A cleared manual category is released too, and the rules see the
      // current facts: the description was edited to a coffee text.
      const released = dataOf<ReclassifyResponse>(
        await reclassify(alice, tx.taxi).expect(200),
      );
      expect(released).toMatchObject({
        categoryId: catA,
        classificationSource: 'USER_RULE',
        decision: { source: 'USER_RULE', ruleId: r.coffee.id },
      });
      expect((await eventsOf(tx.taxi)).at(-1)).toMatchObject({
        trigger: 'EXPLICIT_RECLASSIFY',
        previousCategoryId: null,
        newCategoryId: catA,
      });

      // With no match, an explicit request records the fallback again.
      const fallback = dataOf<ReclassifyResponse>(
        await reclassify(alice, tx.misc).expect(200),
      );
      expect(fallback).toMatchObject({
        categoryId: null,
        classificationSource: 'FALLBACK',
        decision: {
          source: 'FALLBACK',
          categoryId: null,
          ruleId: null,
          reason: 'NO_RULE_MATCHED',
        },
      });
      expect(
        (await eventsOf(tx.misc)).map((e) => [e.trigger, e.reason]),
      ).toEqual([
        ['CREATE', 'NO_RULE_MATCHED'],
        ['EXPLICIT_RECLASSIFY', 'NO_RULE_MATCHED'],
      ]);
    });

    it('rule changes apply to later decisions only; an automatic rerun updates rule-decided rows and never manual ones', async () => {
      // A new rule does not touch existing rows by itself.
      const misc = await createRule(alice, {
        categoryId: catB,
        descriptionPattern: `${MARK} misc`,
        priority: 5,
      });
      expect(await txOf(alice, tx.misc)).toMatchObject({
        categoryId: null,
        classificationSource: 'FALLBACK',
      });
      const events = await eventsOf(tx.misc);

      const applied = await classification.applyAutomatic(alice.id, tx.misc);
      expect(applied).toMatchObject({
        outcome: 'APPLIED',
        decision: { source: 'USER_RULE', categoryId: catB, ruleId: misc.id },
      });
      expect((await eventsOf(tx.misc)).at(-1)).toMatchObject({
        sequence: events.length + 1,
        trigger: 'AUTOMATIC_RERUN',
        source: 'USER_RULE',
        previousCategoryId: null,
        newCategoryId: catB,
        actorType: 'SYSTEM',
        actorUserId: null,
      });
      // Idempotent: the same rules give the same decision and no event.
      expect(await classification.applyAutomatic(alice.id, tx.misc)).toEqual(
        expect.objectContaining({ outcome: 'UNCHANGED' }),
      );
      expect(await eventsOf(tx.misc)).toHaveLength(events.length + 1);
      // Owner-scoped: bob's id never reaches alice's row.
      expect(await classification.applyAutomatic(bob.id, tx.misc)).toEqual({
        outcome: 'NOT_FOUND',
      });

      // A deleted rule leaves the row's category and its history intact.
      await alice.agent
        .delete(`/api/classification-rules/${idPath(misc.id)}`)
        .expect(200);
      expect(await txOf(alice, tx.misc)).toMatchObject({
        categoryId: catB,
        classificationSource: 'USER_RULE',
        classificationRuleId: null,
      });
      expect((await eventsOf(tx.misc)).at(-1)?.merchantRuleId).toBe(misc.id);
    });
  });

  // --- email import (T055, EMAIL-010) --------------------------------------

  describe('email import', () => {
    let connectionId: string;
    let bankName: string;
    const mailbox = new Map<string, { subject: string; body: string[] }>();
    const providerId = (label: string) => `t057-${RUN_ID}-${label}`;
    const code = () => `FT${randomBytes(5).toString('hex').toUpperCase()}`;
    const message = (lines: {
      time: string;
      amount: string;
      description: string;
      code?: string;
      merchant?: string;
    }) => [
      'Loại giao dịch: Ghi nợ',
      `Số tiền: -${lines.amount} VND`,
      `Thời gian: ${lines.time}`,
      ...(lines.code ? [`Số tham chiếu: ${lines.code}`] : []),
      ...(lines.merchant ? [`Đơn vị: ${lines.merchant}`] : []),
      `Nội dung: ${lines.description}`,
    ];

    const sync = async () =>
      dataOf<{ status: string; transactionsCreated: number }>(
        await alice.agent
          .post(`/api/email-connections/${idPath(connectionId)}/sync`)
          .expect(201),
      );
    const importedTx = (label: string) =>
      prisma.transaction.findFirst({
        where: {
          userId: alice.id,
          emailMessage: {
            emailConnectionId: connectionId,
            providerMessageId: providerId(label),
          },
        },
      });
    const snapshot = async () => ({
      transactions: await prisma.transaction.findMany({
        where: { userId: alice.id, sourceType: 'EMAIL' },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          categoryId: true,
          classificationSource: true,
          classificationRuleId: true,
          classifiedAt: true,
          isDuplicate: true,
          duplicateOfTransactionId: true,
          status: true,
        },
      }),
      events: await eventCount(alice.id),
      runs: await prisma.parserRun.count({
        where: { emailMessage: { userId: alice.id } },
      }),
    });

    beforeAll(async () => {
      bankName = (
        await prisma.bankProvider.findUniqueOrThrow({ where: { id: BANK } })
      ).name;
      templateId = await createParserTemplate(admin.agent, {
        bankProviderId: BANK,
        name: `T057 synthetic ${RUN_ID}`,
        version: 1,
        channel: 'EMAIL',
        language: 'vi',
        subjectPattern: SUBJECT_TAG,
        priority: 0,
        fields: [
          {
            fieldName: 'direction',
            fieldType: 'DIRECTION',
            regexPattern: 'Loại giao dịch:\\s*([^\\n;]+)',
            isRequired: true,
          },
          {
            fieldName: 'amount',
            fieldType: 'MONEY',
            regexPattern: 'Số tiền:\\s*([+-]?\\s*[\\d.,]+)',
            normalizer: 'vnd_money',
            isRequired: true,
          },
          {
            fieldName: 'transaction_time',
            fieldType: 'DATETIME',
            regexPattern:
              'Thời gian:\\s*(\\d{1,2}/\\d{1,2}/\\d{4}\\s+\\d{1,2}:\\d{2}:\\d{2})',
            normalizer: 'vi_datetime',
            isRequired: true,
          },
          {
            fieldName: 'transaction_code',
            fieldType: 'TEXT',
            regexPattern: 'Số tham chiếu:\\s*([A-Za-z0-9]+)',
          },
          {
            fieldName: 'merchant_name',
            fieldType: 'TEXT',
            regexPattern: 'Đơn vị:\\s*([^\\n]+)',
          },
          {
            fieldName: 'description',
            fieldType: 'TEXT',
            regexPattern: 'Nội dung:\\s*([^\\n]+)',
          },
        ],
      });
      connectionId = (await createGmailConnection(app, alice.id, 't057')).id;
      await createListenRule(alice.agent, {
        connectionId,
        senderEmail: SENDER,
        bankProviderId: BANK,
      });

      r.cafe = await createRule(alice, {
        categoryId: catA,
        descriptionPattern: `${MARK} ca phe`,
        priority: 20,
      });
      // AND across criteria: the bank must equal too.
      r.otherBank = await createRule(alice, {
        categoryId: catB,
        descriptionPattern: `${MARK} phi`,
        bankName: 'Another Bank',
        priority: 900,
      });
      r.thisBank = await createRule(alice, {
        categoryId: SYS_BILLS,
        descriptionPattern: `${MARK} phi`,
        bankName: bankName.toUpperCase(),
        priority: 1,
      });
      await systemRule({
        categoryId: SYS_TRANSPORT,
        merchantPattern: `${MARK} petrolimex`,
        priority: 10,
      });

      const cafeCode = code();
      const set = (label: string, subject: string, body: string[]) =>
        mailbox.set(providerId(label), { subject, body });
      set(
        'cafe',
        `Thong bao ${SUBJECT_TAG}`,
        message({
          time: '10/09/2026 08:00:00',
          amount: '45,000',
          code: cafeCode,
          description: `${MARK} Cà Phê   Sữa đá`,
        }),
      );
      set(
        'fuel',
        `Thong bao ${SUBJECT_TAG}`,
        message({
          time: '10/09/2026 09:00:00',
          amount: '500,000',
          code: code(),
          merchant: `${MARK} PETROLIMEX CH 12`,
          description: `${MARK} xang`,
        }),
      );
      set(
        'fee',
        `Thong bao ${SUBJECT_TAG}`,
        message({
          time: '10/09/2026 10:00:00',
          amount: '11,000',
          code: code(),
          description: `${MARK} Phí SMS`,
        }),
      );
      set(
        'none',
        `Thong bao ${SUBJECT_TAG}`,
        message({
          time: '10/09/2026 11:00:00',
          amount: '70,000',
          code: code(),
          description: `${MARK} khong ro`,
        }),
      );
      const atm = message({
        time: '10/09/2026 12:00:00',
        amount: '200,000',
        description: `${MARK} ca phe ATM`,
      });
      set('atm', `Thong bao ${SUBJECT_TAG}`, atm);
      // The same event again: a code match is certain, a fingerprint match suspected.
      set(
        'cafe-resend',
        `Thong bao ${SUBJECT_TAG} (gui lai)`,
        message({
          time: '10/09/2026 08:00:00',
          amount: '45,000',
          code: cafeCode,
          description: `${MARK} Cà Phê   Sữa đá`,
        }),
      );
      set('atm-resend', `Thong bao ${SUBJECT_TAG} (gui lai)`, atm);

      const gmail = app.get(GmailApiService);
      jest
        .spyOn(gmail, 'listMessageIds')
        .mockImplementation(() =>
          Promise.resolve({ ids: [...mailbox.keys()] }),
        );
      jest.spyOn(gmail, 'getMessage').mockImplementation((_token, id) => {
        const item = mailbox.get(id);
        return item
          ? Promise.resolve(
              gmailMessage({
                id,
                from: `VCB <${SENDER}>`,
                subject: item.subject,
                receivedAt: new Date(Date.now() - 60 * 60 * 1000),
                body: item.body.join('\n'),
              }),
            )
          : Promise.reject(new Error('T057: unknown message'));
      });
    });

    it('each created row gets the automatic decision and one IMPORT event; a certain duplicate creates neither', async () => {
      const events = await eventCount(alice.id);
      // Six rows: five events plus the kept suspected duplicate.
      expect(await sync()).toMatchObject({
        status: 'SUCCESS',
        transactionsCreated: 6,
      });

      const expectImported = async (
        label: string,
        expected: Record<string, unknown>,
      ) => {
        const row = await importedTx(label);
        expect([label, row]).toEqual([
          label,
          expect.objectContaining(expected),
        ]);
        const rowEvents = await eventsOf(row!.id);
        expect([label, rowEvents]).toEqual([
          label,
          [
            expect.objectContaining({
              sequence: 1,
              trigger: 'IMPORT',
              source: expected.classificationSource,
              actorType: 'SYSTEM',
              actorUserId: null,
              previousCategoryId: null,
              newCategoryId: expected.categoryId,
            }),
          ],
        ]);
        return row!;
      };
      // Diacritics and extra spaces do not matter (documented matching).
      tx.cafe = (
        await expectImported('cafe', {
          categoryId: catA,
          classificationSource: 'USER_RULE',
          classificationRuleId: r.cafe.id,
          isDuplicate: false,
        })
      ).id;
      // Merchant contains-match by a system rule.
      tx.fuel = (
        await expectImported('fuel', {
          categoryId: SYS_TRANSPORT,
          classificationSource: 'SYSTEM_RULE',
        })
      ).id;
      // The higher-priority rule for another bank does not match (AND).
      tx.fee = (
        await expectImported('fee', {
          categoryId: SYS_BILLS,
          classificationSource: 'USER_RULE',
          classificationRuleId: r.thisBank.id,
        })
      ).id;
      tx.none = (
        await expectImported('none', {
          categoryId: null,
          classificationSource: 'FALLBACK',
        })
      ).id;
      const atm = await expectImported('atm', {
        categoryId: catA,
        classificationSource: 'USER_RULE',
        isDuplicate: false,
      });
      // A suspected duplicate is classified like any row and stays flagged
      // and excluded from totals (US3 semantics unchanged).
      await expectImported('atm-resend', {
        categoryId: catA,
        classificationSource: 'USER_RULE',
        isDuplicate: true,
        duplicateOfTransactionId: atm.id,
        status: 'POSTED',
      });
      expect(await importedTx('cafe-resend')).toBeNull();
      expect(await eventCount(alice.id)).toBe(events + 6);
    });

    it(`replaying the unchanged mailbox ${REPLAYS} times changes no classification and appends no event`, async () => {
      const before = await snapshot();
      for (let replay = 1; replay <= REPLAYS; replay++) {
        expect([replay, await sync()]).toEqual([
          replay,
          expect.objectContaining({ transactionsCreated: 0 }),
        ]);
        expect([replay, await snapshot()]).toEqual([replay, before]);
      }
    });

    it('a manual correction on an imported row survives replays, manual parses, and automatic reruns', async () => {
      await setCategory(alice, tx.fuel, { categoryId: catB }).expect(200);
      const before = await snapshot();
      await sync();
      const messageId = (
        await prisma.emailMessage.findFirstOrThrow({
          where: {
            emailConnectionId: connectionId,
            providerMessageId: providerId('fuel'),
          },
        })
      ).id;
      const parsed = dataOf<{ transactionId: string; created: boolean }>(
        await alice.agent
          .post(`/api/email-messages/${idPath(messageId)}/parse`)
          .expect(201),
      );
      expect(parsed).toEqual({ transactionId: tx.fuel, created: false });
      expect(await classification.applyAutomatic(alice.id, tx.fuel)).toEqual({
        outcome: 'PROTECTED',
      });
      expect(await snapshot()).toEqual(before);
      expect(await txOf(alice, tx.fuel)).toMatchObject({
        categoryId: catB,
        classificationSource: 'MANUAL',
      });
    });
  });

  // --- concurrent rule deletion (review findings; data-model "Atomicity") ---

  describe('concurrent rule deletion', () => {
    const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
    // The real query, from a second (stateless) instance, for the spies below.
    const real = () => new ClassificationRepository(prisma);
    afterEach(() => jest.restoreAllMocks());

    it('a winning rule deleted right after the rules were read is not written: the decision is taken again', async () => {
      const rule = await createRule(alice, {
        categoryId: catA,
        descriptionPattern: `${MARK} race-fk`,
      });
      jest
        .spyOn(rules, 'rulesFor')
        .mockImplementationOnce(async (userId, db) => {
          const read = await real().rulesFor(userId, db);
          // Committed on another connection before the winner is written.
          await prisma.merchantRule.delete({ where: { id: rule.id } });
          return read;
        });
      const created = await createTx(alice, `${MARK} race-fk`);
      expect(created).toMatchObject({
        categoryId: null,
        classificationSource: 'FALLBACK',
        classificationRuleId: null,
      });
      expect(await eventsOf(created.id)).toEqual([
        expect.objectContaining({ trigger: 'CREATE', merchantRuleId: null }),
      ]);
    });

    it('reclassify and a concurrent delete of the rule it holds do not deadlock', async () => {
      const rule = await createRule(alice, {
        categoryId: catA,
        descriptionPattern: `${MARK} race-lock`,
      });
      const created = await createTx(alice, `${MARK} race-lock`);
      expect(created.classificationRuleId).toBe(rule.id);

      let deletion:
        | Promise<{ row?: { id: string }; error?: unknown }>
        | undefined;
      jest
        .spyOn(rules, 'rulesFor')
        .mockImplementationOnce(async (userId, db) => {
          // The reclassify holds its locks now; the delete must queue behind
          // them. then() starts it at once (Prisma queries are lazy).
          deletion = prisma.merchantRule
            .delete({ where: { id: rule.id } })
            .then(
              (row) => ({ row }),
              (error: unknown) => ({ error }),
            );
          await pause(500);
          return real().rulesFor(userId, db);
        });
      const response = dataOf<ReclassifyResponse>(
        await reclassify(alice, created.id).expect(200),
      );
      expect(response.decision.ruleId).toBe(rule.id);
      expect(await deletion).toEqual({
        row: expect.objectContaining({ id: rule.id }) as unknown,
      });
      // The delete ran after the reclassify committed, and cleared the link.
      expect(await classificationState(created.id)).toMatchObject({
        categoryId: catA,
        classificationSource: 'USER_RULE',
        classificationRuleId: null,
      });
      expect((await eventsOf(created.id)).at(-1)).toMatchObject({
        trigger: 'EXPLICIT_RECLASSIFY',
        merchantRuleId: rule.id,
      });
    });
  });

  // --- history, ownership, and immutability --------------------------------

  describe('history', () => {
    it('lists the owner’s events oldest first, with category names the owner can read', async () => {
      const events = await history(alice, tx.coffee);
      expect(events.map((e) => [e.sequence, e.trigger, e.source])).toEqual([
        [1, 'CREATE', 'USER_RULE'],
        [2, 'MANUAL_CORRECTION', 'MANUAL'],
        [3, 'EXPLICIT_RECLASSIFY', 'USER_RULE'],
      ]);
      expect(events[1]).toMatchObject({
        previousCategory: { id: catA, name: `T057 Cà phê ${RUN_ID}` },
        newCategory: { id: SYS_SHOPPING, name: 'Mua sắm' },
        actorType: 'USER',
        actorUserId: alice.id,
      });
      expect(Object.keys(events[0]).sort()).toEqual(
        [
          'actorType',
          'actorUserId',
          'createdAt',
          'explanation',
          'id',
          'merchantRuleId',
          'newCategory',
          'previousCategory',
          'reason',
          'sequence',
          'source',
          'trigger',
        ].sort(),
      );
    });

    it('bob, the administrator, and absent ids get 404 on the new routes, and nothing is written', async () => {
      const events = await eventCount(alice.id);
      const before = await classificationState(tx.coffee);
      for (const user of [bob, admin]) {
        await user.agent
          .get(`/api/transactions/${idPath(tx.coffee)}/category-history`)
          .expect(404);
        await reclassify(user, tx.coffee).expect(404);
      }
      await alice.agent
        .get(`/api/transactions/${absentId()}/category-history`)
        .expect(404);
      await reclassify(alice, absentId()).expect(404);
      await request(app.getHttpServer())
        .get(`/api/transactions/${idPath(tx.coffee)}/category-history`)
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/transactions/${idPath(tx.coffee)}/reclassify`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/classification-rules')
        .expect(401);
      expect(await eventCount(alice.id)).toBe(events);
      expect(await classificationState(tx.coffee)).toEqual(before);
    });

    it('events are append-only: updates and direct deletes are refused; a transaction’s removal cascades', async () => {
      const [first] = await eventsOf(tx.coffee);
      await expect(
        prisma.$executeRaw`UPDATE "TransactionCategoryEvent" SET "reason" = 'MANUAL_SET' WHERE "id" = ${first.id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.transactionCategoryEvent.update({
          where: { id: first.id },
          data: { newCategoryId: null },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM "TransactionCategoryEvent" WHERE "id" = ${first.id}`,
      ).rejects.toThrow(/append-only/);
      expect((await eventsOf(tx.coffee))[0]).toEqual(first);

      // A soft-deleted transaction keeps its history but no longer exposes it.
      const events = await eventsOf(tx.tie);
      await alice.agent
        .delete(`/api/transactions/${idPath(tx.tie)}`)
        .expect(200);
      await alice.agent
        .get(`/api/transactions/${idPath(tx.tie)}/category-history`)
        .expect(404);
      await reclassify(alice, tx.tie).expect(404);
      expect(await eventsOf(tx.tie)).toEqual(events);

      // Removing the row (retention, account deletion) cascades its events.
      const throwaway = await createTx(alice, `${MARK} coffee to remove`);
      expect(await eventsOf(throwaway.id)).toHaveLength(1);
      await prisma.transaction.delete({ where: { id: throwaway.id } });
      expect(await eventsOf(throwaway.id)).toEqual([]);
    });

    it('events hold ids and codes only, never transaction text (SEC-006)', async () => {
      const events = await prisma.transactionCategoryEvent.findMany({
        where: { userId: alice.id },
      });
      expect(events.length).toBeGreaterThan(10);
      const text = JSON.stringify(events);
      for (const fragment of [
        MARK,
        'coffee',
        'Coffee',
        'TAXI',
        'Cà Phê',
        'PETROLIMEX',
        'T057 note',
        `T057 Cà phê ${RUN_ID}`,
      ]) {
        expect([fragment, text.includes(fragment)]).toEqual([fragment, false]);
      }
    });

    it('classification never changes financial totals (US2 policy)', async () => {
      const totals = async () =>
        dataOf<{ totals: unknown }>(
          await alice.agent
            .get('/api/transactions')
            .query({ limit: '100' })
            .expect(200),
        ).totals;
      const before = await totals();
      await reclassify(alice, tx.coffee).expect(200);
      await setCategory(alice, tx.none, { categoryId: SYS_FOOD }).expect(200);
      await reclassify(alice, tx.none).expect(200);
      expect(await totals()).toEqual(before);
    });
  });
});
