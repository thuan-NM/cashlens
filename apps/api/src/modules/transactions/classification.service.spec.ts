import { ConflictException } from '@nestjs/common';
import type {
  ClassificationSource,
  Prisma,
  TransactionDirection,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClassificationFacts,
  ClassificationRule,
  Decision,
  ClassificationService,
  DecisionMode,
  decide,
} from './classification.service';
import type { ClassificationRepository } from './classification.repository';
import type { PrismaService } from '../../prisma/prisma.service';

// T051 (CLASS-001–CLASS-007, TX-004, TEST-002): the classification matrix.
// Precedence: a MANUAL decision is protected from automatic runs; then the
// matching user rule with the highest priority; then the matching system rule
// with the highest priority; then the explicit uncategorized fallback. Ties:
// earliest createdAt, then the lexicographically smallest id. Every row has
// exactly one explained outcome.

const USER = 'user-1';
const OTHER = 'user-2';
const JAN = new Date('2026-01-01T00:00:00.000Z');

type Category = NonNullable<ClassificationRule['category']>;
const own = (id: string): Category => ({
  id,
  userId: USER,
  isSystem: false,
  status: 'ACTIVE',
});
const system = (id: string): Category => ({
  id,
  userId: null,
  isSystem: true,
  status: 'ACTIVE',
});

/** A user rule matching "coffee" in the description, targeting own food. */
const userRule = (
  id: string,
  over: Partial<ClassificationRule> = {},
): ClassificationRule => ({
  id,
  userId: USER,
  categoryId: 'cat-food',
  category: own('cat-food'),
  merchantPattern: null,
  descriptionPattern: 'coffee',
  bankName: null,
  direction: null,
  priority: 100,
  isActive: true,
  createdAt: JAN,
  ...over,
});
const systemRule = (
  id: string,
  over: Partial<ClassificationRule> = {},
): ClassificationRule => ({
  ...userRule(id),
  userId: null,
  categoryId: 'sys_cat_expense_food',
  category: system('sys_cat_expense_food'),
  ...over,
});

const facts = (
  over: Partial<ClassificationFacts> = {},
): ClassificationFacts => ({
  userId: USER,
  merchantName: null,
  counterpartyName: null,
  description: 'Coffee at Highlands',
  bankName: 'Vietcombank',
  direction: 'EXPENSE',
  ...over,
});

const run = (
  rules: ClassificationRule[],
  over: {
    facts?: Partial<ClassificationFacts>;
    mode?: DecisionMode;
    source?: ClassificationSource;
    categoryId?: string | null;
  } = {},
): Decision =>
  decide(facts(over.facts), rules, {
    mode: over.mode ?? 'AUTOMATIC',
    current: {
      source: over.source ?? 'UNKNOWN',
      categoryId: over.categoryId ?? null,
    },
  });

/** Every matrix row has exactly one explained outcome (T051). */
const expectExplained = (decision: Decision) => {
  if (decision.outcome === 'PROTECTED') {
    expect(decision).toEqual({
      outcome: 'PROTECTED',
      source: 'MANUAL',
      categoryId: decision.categoryId,
      ruleId: null,
      reason: null,
      explanation: null,
    });
    return;
  }
  expect(['USER_RULE', 'SYSTEM_RULE', 'FALLBACK']).toContain(decision.source);
  expect(decision.reason).toBe(
    decision.source === 'FALLBACK' ? 'NO_RULE_MATCHED' : 'RULE_MATCHED',
  );
  expect(decision.explanation.winnerRuleId).toBe(decision.ruleId);
  expect(decision.explanation.candidates[0]?.ruleId ?? null).toBe(
    decision.ruleId,
  );
};

describe('classification precedence (T051, CLASS-002)', () => {
  it('a MANUAL decision is protected from automatic classification', () => {
    const decision = run([userRule('rule-a')], {
      source: 'MANUAL',
      categoryId: 'cat-mine',
    });
    expect(decision).toEqual({
      outcome: 'PROTECTED',
      source: 'MANUAL',
      categoryId: 'cat-mine',
      ruleId: null,
      reason: null,
      explanation: null,
    });
    expectExplained(decision);
  });

  it('a MANUAL clear (no category) is protected too', () => {
    expect(
      run([userRule('rule-a')], { source: 'MANUAL', categoryId: null }),
    ).toMatchObject({ outcome: 'PROTECTED', categoryId: null });
  });

  it('explicit reclassification releases the manual lock and applies the rules', () => {
    const decision = run([userRule('rule-a')], {
      mode: 'EXPLICIT',
      source: 'MANUAL',
      categoryId: 'cat-mine',
    });
    expect(decision).toMatchObject({
      outcome: 'DECIDED',
      source: 'USER_RULE',
      categoryId: 'cat-food',
      ruleId: 'rule-a',
      reason: 'RULE_MATCHED',
    });
    expectExplained(decision);
  });

  it('explicit reclassification with no matching rule replaces a manual category with the fallback', () => {
    const decision = run([], {
      mode: 'EXPLICIT',
      source: 'MANUAL',
      categoryId: 'cat-mine',
    });
    expect(decision).toMatchObject({
      outcome: 'DECIDED',
      source: 'FALLBACK',
      categoryId: null,
      ruleId: null,
      reason: 'NO_RULE_MATCHED',
    });
  });

  it('a row decided by a rule earlier is evaluated again by an automatic run', () => {
    expect(
      run([userRule('rule-a')], { source: 'SYSTEM_RULE', categoryId: 'x' }),
    ).toMatchObject({ outcome: 'DECIDED', source: 'USER_RULE' });
  });

  it('a matching user rule beats every system rule, whatever the priorities', () => {
    const decision = run([
      systemRule('rule-sys', { priority: 999_999 }),
      userRule('rule-user', { priority: 0 }),
    ]);
    expect(decision).toMatchObject({
      source: 'USER_RULE',
      ruleId: 'rule-user',
      explanation: { tieBreak: 'SCOPE', runnerUpRuleId: 'rule-sys' },
    });
    expectExplained(decision);
  });

  it('only system rules match: the highest system priority wins', () => {
    const decision = run([
      systemRule('rule-low', { priority: 5 }),
      systemRule('rule-high', { priority: 50 }),
    ]);
    expect(decision).toMatchObject({
      source: 'SYSTEM_RULE',
      ruleId: 'rule-high',
      categoryId: 'sys_cat_expense_food',
      explanation: { tieBreak: 'PRIORITY' },
    });
  });

  describe.each([
    ['user', userRule],
    ['system', systemRule],
  ] as const)('ties within the %s scope', (_scope, make) => {
    it('the highest numeric priority wins', () => {
      expect(
        run([
          make('rule-a', { priority: 10 }),
          make('rule-b', { priority: 20 }),
        ]),
      ).toMatchObject({
        ruleId: 'rule-b',
        explanation: { tieBreak: 'PRIORITY' },
      });
    });

    it('equal priority: the earliest creation time wins', () => {
      expect(
        run([
          make('rule-a', { createdAt: new Date('2026-02-01T00:00:00.000Z') }),
          make('rule-b', { createdAt: JAN }),
        ]),
      ).toMatchObject({
        ruleId: 'rule-b',
        explanation: { tieBreak: 'CREATED_AT', runnerUpRuleId: 'rule-a' },
      });
    });

    it('equal priority and creation time: the lexicographically smallest id wins', () => {
      expect(
        run([make('rule-b'), make('rule-a'), make('rule-c')]),
      ).toMatchObject({
        ruleId: 'rule-a',
        explanation: { tieBreak: 'ID', runnerUpRuleId: 'rule-b' },
      });
    });
  });

  it('no rule matches: the explicit uncategorized fallback (CLASS-004)', () => {
    const decision = run([userRule('rule-a', { descriptionPattern: 'taxi' })]);
    expect(decision).toEqual({
      outcome: 'DECIDED',
      source: 'FALLBACK',
      categoryId: null,
      ruleId: null,
      reason: 'NO_RULE_MATCHED',
      explanation: {
        candidates: [],
        winnerRuleId: null,
        runnerUpRuleId: null,
        tieBreak: null,
        conflict: false,
      },
    });
    expectExplained(decision);
  });
});

describe('conflict explanation (T051, CLASS-003)', () => {
  it('conflicting matches list every candidate in rank order with the winner, runner-up, and tie-break', () => {
    const decision = run([
      userRule('rule-drink', {
        priority: 10,
        categoryId: 'cat-drink',
        category: own('cat-drink'),
      }),
      userRule('rule-food', { priority: 20 }),
      systemRule('rule-sys', { priority: 999 }),
    ]);
    expect(decision).toMatchObject({
      ruleId: 'rule-food',
      categoryId: 'cat-food',
    });
    expect(decision.explanation).toEqual({
      candidates: [
        {
          ruleId: 'rule-food',
          scope: 'USER',
          priority: 20,
          createdAt: JAN.toISOString(),
          categoryId: 'cat-food',
        },
        {
          ruleId: 'rule-drink',
          scope: 'USER',
          priority: 10,
          createdAt: JAN.toISOString(),
          categoryId: 'cat-drink',
        },
        {
          ruleId: 'rule-sys',
          scope: 'SYSTEM',
          priority: 999,
          createdAt: JAN.toISOString(),
          categoryId: 'sys_cat_expense_food',
        },
      ],
      winnerRuleId: 'rule-food',
      runnerUpRuleId: 'rule-drink',
      tieBreak: 'PRIORITY',
      conflict: true,
    });
  });

  it('several matches on one category are not a conflict', () => {
    expect(
      run([
        userRule('rule-a', { priority: 1 }),
        userRule('rule-b', { priority: 2 }),
      ]).explanation,
    ).toMatchObject({
      conflict: false,
      tieBreak: 'PRIORITY',
      winnerRuleId: 'rule-b',
    });
  });

  it('a single match has no runner-up and no tie-break', () => {
    expect(run([userRule('rule-a')]).explanation).toEqual({
      candidates: [
        {
          ruleId: 'rule-a',
          scope: 'USER',
          priority: 100,
          createdAt: JAN.toISOString(),
          categoryId: 'cat-food',
        },
      ],
      winnerRuleId: 'rule-a',
      runnerUpRuleId: null,
      tieBreak: null,
      conflict: false,
    });
  });

  it('the explanation holds ids and codes only, never rule or transaction text', () => {
    const text = JSON.stringify(
      run([userRule('rule-a', { descriptionPattern: 'secret-pattern' })], {
        facts: { description: 'a secret-pattern purchase' },
      }),
    );
    expect(text).not.toMatch(/secret-pattern|purchase|Highlands|Vietcombank/);
  });
});

describe('rules that are never candidates (T051, CLASS-001, T052 invariant)', () => {
  it.each([
    ['an inactive rule', userRule('rule-x', { isActive: false })],
    [
      'a rule whose category was deleted',
      userRule('rule-x', { categoryId: null, category: null }),
    ],
    [
      'a rule targeting an archived category',
      userRule('rule-x', {
        category: { ...own('cat-food'), status: 'ARCHIVED' },
      }),
    ],
    [
      "another user's rule",
      userRule('rule-x', {
        userId: OTHER,
        category: { ...own('cat-food'), userId: OTHER },
      }),
    ],
    [
      "a user rule targeting another user's category",
      userRule('rule-x', { category: { ...own('cat-food'), userId: OTHER } }),
    ],
    [
      "a system rule targeting the owner's private category",
      systemRule('rule-x', {
        categoryId: 'cat-food',
        category: own('cat-food'),
      }),
    ],
    [
      'a system rule targeting a non-system category without owner',
      systemRule('rule-x', {
        category: { ...system('sys_cat_expense_food'), isSystem: false },
      }),
    ],
    [
      'a rule with no text criterion',
      userRule('rule-x', { descriptionPattern: null, direction: 'EXPENSE' }),
    ],
  ])(
    '%s is skipped and never appears in the explanation',
    (_label, skipped) => {
      const decision = run([skipped]);
      expect(decision).toMatchObject({ source: 'FALLBACK', categoryId: null });
      expect(JSON.stringify(decision)).not.toContain('rule-x');
    },
  );

  it('skipped rules never set a conflict next to a valid match', () => {
    const decision = run([
      userRule('rule-ok'),
      userRule('rule-off', {
        isActive: false,
        categoryId: 'cat-drink',
        category: own('cat-drink'),
      }),
    ]);
    expect(decision.explanation).toMatchObject({
      candidates: [expect.objectContaining({ ruleId: 'rule-ok' })],
      conflict: false,
      runnerUpRuleId: null,
    });
    expect(decision.explanation!.candidates).toHaveLength(1);
  });
});

describe('matching semantics (T051, CLASS-001)', () => {
  it('patterns match as case- and diacritic-insensitive "contains", with collapsed spaces', () => {
    const rule = userRule('rule-a', { descriptionPattern: 'Cà   phê ĐEN' });
    expect(
      run([rule], { facts: { description: 'mua CA PHE den da' } }),
    ).toMatchObject({
      ruleId: 'rule-a',
    });
    expect(
      run([rule], { facts: { description: 'mua tra sua' } }),
    ).toMatchObject({
      source: 'FALLBACK',
    });
  });

  it('every criterion that is set must match (AND)', () => {
    const rule = userRule('rule-a', { bankName: 'Techcombank' });
    expect(run([rule])).toMatchObject({ source: 'FALLBACK' });
    expect(run([rule], { facts: { bankName: 'techcombank' } })).toMatchObject({
      ruleId: 'rule-a',
    });
  });

  it('bankName is an equals-match, not "contains"', () => {
    const rule = userRule('rule-a', {
      descriptionPattern: null,
      bankName: 'Vietcombank',
    });
    expect(run([rule], { facts: { bankName: 'VIETCOMBANK' } })).toMatchObject({
      ruleId: 'rule-a',
    });
    expect(
      run([rule], { facts: { bankName: 'Vietcombank Hanoi' } }),
    ).toMatchObject({
      source: 'FALLBACK',
    });
  });

  it('merchantPattern reads the merchant name, or the counterparty when there is no merchant', () => {
    const rule = userRule('rule-a', {
      descriptionPattern: null,
      merchantPattern: 'grab',
    });
    expect(run([rule], { facts: { merchantName: 'GRAB*TRIP' } })).toMatchObject(
      { ruleId: 'rule-a' },
    );
    expect(
      run([rule], { facts: { counterpartyName: 'Grab Vietnam' } }),
    ).toMatchObject({
      ruleId: 'rule-a',
    });
    expect(
      run([rule], {
        facts: { merchantName: 'Be', counterpartyName: 'Grab Vietnam' },
      }),
    ).toMatchObject({ source: 'FALLBACK' });
  });

  it('a missing transaction attribute never matches a set criterion', () => {
    expect(
      run([userRule('rule-a')], { facts: { description: null } }),
    ).toMatchObject({
      source: 'FALLBACK',
    });
  });

  it.each<TransactionDirection>([
    'INCOME',
    'EXPENSE',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'ADJUSTMENT',
  ])(
    'a rule without a direction matches %s; a rule with one matches only that direction',
    (direction) => {
      expect(
        run([userRule('rule-any')], { facts: { direction } }),
      ).toMatchObject({
        ruleId: 'rule-any',
      });
      expect(
        run([userRule('rule-in', { direction: 'INCOME' })], {
          facts: { direction },
        }),
      ).toMatchObject(
        direction === 'INCOME' ? { ruleId: 'rule-in' } : { source: 'FALLBACK' },
      );
    },
  );
});

describe('determinism (T051, SC-006) and deterministic sources (CLASS-007)', () => {
  const fixture = [
    userRule('rule-c', { priority: 30 }),
    userRule('rule-b', {
      priority: 30,
      categoryId: 'cat-drink',
      category: own('cat-drink'),
    }),
    userRule('rule-a', {
      priority: 30,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    }),
    systemRule('rule-s1', { priority: 999 }),
    systemRule('rule-s2', { priority: 1 }),
  ];
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
          permutations([
            ...items.slice(0, index),
            ...items.slice(index + 1),
          ]).map((rest) => [item, ...rest]),
        );

  it('all 120 input orders of a 5-rule conflict fixture give the identical decision', () => {
    const expected = run(fixture);
    expect(expected).toMatchObject({
      ruleId: 'rule-b',
      categoryId: 'cat-drink',
      explanation: { tieBreak: 'ID', runnerUpRuleId: 'rule-c', conflict: true },
    });
    const orders = permutations(fixture);
    expect(orders).toHaveLength(120);
    for (const order of orders) {
      expect(run(order)).toEqual(expected);
    }
  });

  it('decisions only ever use MANUAL, USER_RULE, SYSTEM_RULE, or FALLBACK', () => {
    const sources = new Set(
      [
        run(fixture),
        run([]),
        run(fixture, { source: 'MANUAL' }),
        run([systemRule('rule-s')]),
      ].map((decision) => decision.source),
    );
    expect([...sources].sort()).toEqual([
      'FALLBACK',
      'MANUAL',
      'SYSTEM_RULE',
      'USER_RULE',
    ]);
  });

  it('the classifier has no ML or LLM path', () => {
    const source = readFileSync(
      join(__dirname, 'classification.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\b(ML|LLM)\b/);
  });
});

// A winning rule deleted between the read and the write cannot be held, so the
// decision is taken again without it: no foreign-key failure, no stale rule id.
describe('ClassificationService holds the winning rule until commit', () => {
  const tx = {} as Prisma.TransactionClient;
  const make = (
    reads: ClassificationRule[][],
    held: (id: string) => boolean,
  ) => {
    let read = 0;
    const repository = {
      autoClassificationEnabled: jest.fn(() => Promise.resolve(true)),
      rulesFor: jest.fn(() =>
        Promise.resolve(reads[Math.min(read++, reads.length - 1)]),
      ),
      lockRule: jest.fn((_tx: unknown, id: string) =>
        Promise.resolve(held(id)),
      ),
    };
    const service = new ClassificationService(
      repository as unknown as ClassificationRepository,
      {} as PrismaService,
    );
    return { service, repository };
  };

  it('locks the winner and decides once when it still exists', async () => {
    const { service, repository } = make([[userRule('rule-a')]], () => true);
    await expect(service.decideNew(tx, facts())).resolves.toMatchObject({
      source: 'USER_RULE',
      ruleId: 'rule-a',
    });
    expect(repository.rulesFor).toHaveBeenCalledTimes(1);
    expect(repository.lockRule).toHaveBeenCalledWith(tx, 'rule-a');
  });

  it('decides again without a winner deleted after the read', async () => {
    const { service, repository } = make(
      [[userRule('rule-a'), systemRule('rule-s')], [systemRule('rule-s')]],
      (id) => id !== 'rule-a',
    );
    await expect(service.decideNew(tx, facts())).resolves.toMatchObject({
      source: 'SYSTEM_RULE',
      ruleId: 'rule-s',
    });
    expect(repository.rulesFor).toHaveBeenCalledTimes(2);
  });

  it('a fallback holds no rule', async () => {
    const { service, repository } = make([[]], () => false);
    await expect(service.decideNew(tx, facts())).resolves.toMatchObject({
      source: 'FALLBACK',
      ruleId: null,
    });
    expect(repository.lockRule).not.toHaveBeenCalled();
  });

  it('gives up with 409 when every winner disappears', async () => {
    const { service, repository } = make([[userRule('rule-a')]], () => false);
    await expect(service.decideNew(tx, facts())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.rulesFor).toHaveBeenCalledTimes(3);
  });
});
