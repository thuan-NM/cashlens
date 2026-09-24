import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { App } from 'supertest/types';
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

jest.setTimeout(60_000);

type SettingsView = {
  storeRawEmailBody: boolean;
  rawEmailBodyAvailable: boolean;
};
type UserView = { settings: SettingsView | null };

const SENDER = 'notify@vcb.example.test';
const RAW_MARKER = `t045a-raw-${randomBytes(8).toString('hex')}`;
const SUBJECT_TAG = `T045a-${RUN_ID}`;

// T045a (DATA-001, EMAIL-012, TEST-004): raw email bodies are never retained.
// The preference cannot be enabled, a legacy stored `true` is preserved but
// has no effect, and every self view says raw bodies are unavailable.
describe('Raw email body preference is locked off (T045a)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let admin: TestUser;
  let templateId: string | undefined;

  const settingsOf = (userId: string) =>
    prisma.userSettings.findUniqueOrThrow({ where: { userId } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 't045a-alice');
    admin = await registerUser(app, 't045a-admin');
    await promoteToAdminForTest(prisma, admin.id);
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, admin?.id]);
      if (templateId) {
        await prisma.parserTemplate.deleteMany({ where: { id: templateId } });
      }
    }
    await app?.close();
  });

  it('PATCH storeRawEmailBody: true is refused with RAW_EMAIL_BODY_UNAVAILABLE and nothing changes', async () => {
    const before = await settingsOf(alice.id);
    const response = await alice.agent
      .patch('/api/users/me/settings')
      .send({
        storeRawEmailBody: true,
        notificationEnabled: !before.notificationEnabled,
      })
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'RAW_EMAIL_BODY_UNAVAILABLE',
      fields: { storeRawEmailBody: [expect.any(String)] },
    });
    expect(await settingsOf(alice.id)).toEqual(before);
  });

  it('PATCH storeRawEmailBody: false is accepted', async () => {
    const response = await alice.agent
      .patch('/api/users/me/settings')
      .send({ storeRawEmailBody: false })
      .expect(200);
    expect(dataOf<UserView>(response).settings).toMatchObject({
      storeRawEmailBody: false,
      rawEmailBodyAvailable: false,
    });
    expect((await settingsOf(alice.id)).storeRawEmailBody).toBe(false);
  });

  it('every self view reports rawEmailBodyAvailable: false', async () => {
    for (const path of ['/api/users/me', '/api/auth/me']) {
      const response = await alice.agent.get(path).expect(200);
      expect(dataOf<UserView>(response).settings?.rawEmailBodyAvailable).toBe(
        false,
      );
    }
  });

  it('with a legacy stored true, a fixture sync persists no raw body anywhere', async () => {
    await prisma.userSettings.update({
      where: { userId: alice.id },
      data: { storeRawEmailBody: true },
    });
    const view = dataOf<UserView>(
      await alice.agent.get('/api/users/me').expect(200),
    );
    // The legacy value is preserved and shown, but has no effect.
    expect(view.settings).toMatchObject({
      storeRawEmailBody: true,
      rawEmailBodyAvailable: false,
    });

    templateId = await createParserTemplate(admin.agent, {
      bankProviderId: 'bank_vcb',
      name: `T045a synthetic ${RUN_ID}`,
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
      ],
    });
    const connection = await createGmailConnection(app, alice.id, 't045a');
    await createListenRule(alice.agent, {
      connectionId: connection.id,
      senderEmail: SENDER,
      bankProviderId: 'bank_vcb',
    });

    const gmail = app.get(GmailApiService);
    const providerId = `t045a-${RUN_ID}`;
    jest
      .spyOn(gmail, 'listMessageIds')
      .mockResolvedValue({ ids: [providerId] });
    jest.spyOn(gmail, 'getMessage').mockResolvedValue(
      gmailMessage({
        id: providerId,
        from: `VCB <${SENDER}>`,
        subject: `Biến động số dư ${SUBJECT_TAG}`,
        receivedAt: new Date(Date.now() - 60 * 60 * 1000),
        body: [
          'Loại giao dịch: Ghi nợ',
          'Số tiền: -150,000 VND',
          'Thời gian: 20/09/2026 10:15:00',
          `Số tham chiếu: FT${randomBytes(4).toString('hex').toUpperCase()}`,
          `Ghi chú riêng tư: ${RAW_MARKER}`,
        ].join('\n'),
      }),
    );

    const sync = await alice.agent
      .post(`/api/email-connections/${idPath(connection.id)}/sync`)
      .expect(201);
    expect(
      dataOf<{ status: string; transactionsCreated: number }>(sync),
    ).toMatchObject({
      status: 'SUCCESS',
      transactionsCreated: 1,
    });

    const messages = await prisma.emailMessage.findMany({
      where: { userId: alice.id },
      include: { parserRuns: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].snippet).toBeNull();
    const persisted = JSON.stringify({
      messages,
      transactions: await prisma.transaction.findMany({
        where: { userId: alice.id },
      }),
      runs: await prisma.emailSyncRun.findMany({
        where: { emailConnectionId: connection.id },
      }),
      audit: await prisma.auditLog.findMany({ where: { userId: alice.id } }),
      connection: await prisma.emailConnection.findUnique({
        where: { id: connection.id },
      }),
    });
    expect(persisted.includes(RAW_MARKER)).toBe(false);
    expect(persisted.includes('Ghi chú riêng tư')).toBe(false);
  });
});
