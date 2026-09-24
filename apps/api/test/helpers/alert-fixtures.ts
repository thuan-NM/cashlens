import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Clock } from '../../src/common/time/clock';
import {
  DELIVERY_OPTIONS,
  DeliveryOptions,
} from '../../src/modules/alerts/delivery/alert-delivery.service';
import { DeliveryTimer } from '../../src/modules/alerts/delivery/delivery-timer';
import { EMAIL_TRANSPORT } from '../../src/modules/alerts/delivery/email-transport';
import { GmailApiService } from '../../src/modules/email-ingestion/gmail-api.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InMemoryEmailTransport } from '../fakes/in-memory-email-transport';
import {
  Agent,
  RUN_ID,
  TestUser,
  dataOf,
  idPath,
  promoteToAdminForTest,
  registerUser,
} from './auth-fixtures';
import {
  createGmailConnection,
  createListenRule,
  createParserTemplate,
  gmailMessage,
} from './email-fixtures';
import { createTestApp } from './test-app';

/**
 * Shared fixtures of the US5 alert suites (T085–T091). Time is a mutable
 * clock injected for every `Clock` consumer; email goes to the in-memory
 * transport; Gmail never runs (its API is spied). Nothing touches the
 * network.
 */

export class MutableClock {
  constructor(public current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(instant: string | Date) {
    this.current = new Date(instant);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const HOUR = 60 * 60 * 1000;

export type AlertView = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  isRead: boolean;
  readAt: string | null;
  status: 'ACTIVE' | 'DISMISSED' | 'RESOLVED';
  conditionKey: string | null;
  thresholdValue: number | null;
  observedValue: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  dismissedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  emailDelivery: {
    channel: string;
    status: string;
    skipReason: string | null;
    attemptCount: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    failureCode: string | null;
  } | null;
};

/** The app with a controlled clock and, optionally, the fake email transport. */
export async function createAlertTestApp(options: {
  clock: MutableClock;
  transport?: InMemoryEmailTransport;
  delivery?: Partial<DeliveryOptions>;
}): Promise<INestApplication<App>> {
  return createTestApp((builder) => {
    let configured = builder
      .overrideProvider(Clock)
      .useValue(options.clock)
      // Backoff sleeps are instant; budgets still run on real time.
      .overrideProvider(DeliveryTimer)
      .useValue({ now: () => Date.now(), sleep: () => Promise.resolve() });
    if (options.transport) {
      configured = configured
        .overrideProvider(EMAIL_TRANSPORT)
        .useValue(options.transport)
        .overrideProvider(DELIVERY_OPTIONS)
        .useValue({
          attemptTimeoutMs: 5000,
          totalBudgetMs: 12000,
          appPublicUrl: 'https://cashlens.example.test',
          ...options.delivery,
        });
    }
    return configured;
  });
}

/** Every alert of the caller through the API (ALERT-004), newest first. */
export async function alertsOf(
  agent: Agent,
  query: Record<string, string> = {},
): Promise<AlertView[]> {
  const response = await agent
    .get('/api/alerts')
    .query({ limit: '100', ...query })
    .expect(200);
  return dataOf<{ data: AlertView[] }>(response).data;
}

/** The caller's alerts with this condition key, oldest first. */
export async function alertsWithKey(agent: Agent, key: string) {
  return (await alertsOf(agent))
    .filter((alert) => alert.conditionKey === key)
    .sort((a, b) => a.triggeredAt.localeCompare(b.triggeredAt));
}

export async function openAlerts(agent: Agent) {
  return (await alertsOf(agent)).filter(
    (alert) => alert.status !== 'RESOLVED' && alert.conditionKey !== null,
  );
}

export async function createCategory(agent: Agent, name: string) {
  const response = await agent
    .post('/api/transaction-categories')
    .send({ name: `${name} ${RUN_ID}`, type: 'EXPENSE' })
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}

export async function createTransaction(
  agent: Agent,
  body: {
    amount: number;
    transactionTime: string;
    direction?: string;
    categoryId?: string;
    currency?: string;
  },
) {
  const response = await agent
    .post('/api/transactions')
    .send({ direction: 'EXPENSE', currency: 'VND', ...body })
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}

export async function setMonthStartDay(agent: Agent, day: number) {
  await agent
    .patch('/api/users/me/settings')
    .send({ defaultMonthStartDay: day })
    .expect(200);
}

/**
 * The real Gmail pipeline for imported transactions: a synthetic parser
 * template (admin), a listen rule, and a stored connection, with the Gmail
 * API spied to serve a synthetic mailbox of debit or credit notices.
 */
export class EmailImportHarness {
  readonly mailbox = new Map<string, { subject: string; body: string[] }>();
  private sequence = 0;

  private constructor(
    private readonly app: INestApplication<App>,
    private readonly owner: TestUser,
    readonly connectionId: string,
    readonly templateId: string,
    private readonly tag: string,
  ) {}

  static readonly BANK = 'bank_vcb';
  static readonly SENDER = 'notify@vcb.example.test';

  static async create(
    app: INestApplication<App>,
    owner: TestUser,
    label: string,
  ): Promise<{ harness: EmailImportHarness; admin: TestUser }> {
    const prisma = app.get(PrismaService);
    const admin = await registerUser(app, `${label}-admin`);
    await promoteToAdminForTest(prisma, admin.id);
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    const tag = `${label}-${RUN_ID}`;
    const templateId = await createParserTemplate(admin.agent, {
      bankProviderId: EmailImportHarness.BANK,
      name: `US5 synthetic ${tag}`,
      version: 1,
      channel: 'EMAIL',
      language: 'vi',
      subjectPattern: tag,
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
          fieldName: 'description',
          fieldType: 'TEXT',
          regexPattern: 'Nội dung:\\s*([^\\n]+)',
        },
      ],
    });
    const connectionId = (await createGmailConnection(app, owner.id, label)).id;
    await createListenRule(owner.agent, {
      connectionId,
      senderEmail: EmailImportHarness.SENDER,
      bankProviderId: EmailImportHarness.BANK,
    });
    const harness = new EmailImportHarness(
      app,
      owner,
      connectionId,
      templateId,
      tag,
    );
    const gmail = app.get(GmailApiService);
    jest
      .spyOn(gmail, 'listMessageIds')
      .mockImplementation(() =>
        Promise.resolve({ ids: [...harness.mailbox.keys()] }),
      );
    jest.spyOn(gmail, 'getMessage').mockImplementation((_token, id) => {
      const item = harness.mailbox.get(id);
      return item
        ? Promise.resolve(
            gmailMessage({
              id,
              from: `VCB <${EmailImportHarness.SENDER}>`,
              subject: item.subject,
              receivedAt: new Date(Date.now() - HOUR),
              body: item.body.join('\n'),
            }),
          )
        : Promise.reject(new Error('US5: unknown message'));
    });
    return { harness, admin };
  }

  /**
   * Queues one notice. `time` is local Vietnam time, `dd/mm/yyyy hh:mm:ss`;
   * `amount` is whole VND.
   */
  queue(input: {
    amount: number;
    time: string;
    direction?: 'EXPENSE' | 'INCOME';
  }) {
    this.sequence += 1;
    const id = `us5-${this.tag}-${this.sequence}`;
    const debit = (input.direction ?? 'EXPENSE') === 'EXPENSE';
    this.mailbox.set(id, {
      subject: `Thong bao ${this.tag}`,
      body: [
        `Loại giao dịch: ${debit ? 'Ghi nợ' : 'Ghi có'}`,
        `Số tiền: ${debit ? '-' : '+'}${input.amount.toLocaleString('en-US')} VND`,
        `Thời gian: ${input.time}`,
        `Số tham chiếu: FT${randomBytes(5).toString('hex').toUpperCase()}`,
        `Nội dung: US5 ${this.tag} ${this.sequence}`,
      ],
    });
    return id;
  }

  /** One sync batch through the API. */
  async sync() {
    return dataOf<{ status: string; transactionsCreated: number }>(
      await this.owner.agent
        .post(`/api/email-connections/${idPath(this.connectionId)}/sync`)
        .expect(201),
    );
  }

  /** The transaction imported from a queued message. */
  importedTransaction(providerMessageId: string) {
    return this.app.get(PrismaService).transaction.findFirstOrThrow({
      where: {
        userId: this.owner.id,
        emailMessage: {
          emailConnectionId: this.connectionId,
          providerMessageId,
        },
      },
    });
  }

  async cleanup() {
    await this.app
      .get(PrismaService)
      .parserTemplate.deleteMany({ where: { id: this.templateId } });
  }
}

export { request };
