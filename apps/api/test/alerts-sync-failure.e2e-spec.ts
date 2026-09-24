import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { GmailOAuthService } from '../src/modules/email-connections/gmail-oauth.service';
import {
  GmailApiError,
  GmailApiService,
} from '../src/modules/email-ingestion/gmail-api.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  createGmailConnection,
  createListenRule,
} from './helpers/email-fixtures';
import {
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T089 (SC-007, ALERT-009 repeated-sync-failure row): three consecutive
 * terminal failures of one connection (FAILED, EXPIRED including a stale
 * lease, PARTIAL_FAILED) open a SYSTEM WARNING; a success or a disconnect
 * resolves it. Gmail is spied; nothing reaches Google.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');

describe('Repeated sync-failure alerts (T089)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const users: TestUser[] = [];
  let listSpy: jest.SpiedFunction<GmailApiService['listMessageIds']>;

  /** A user with one Gmail connection and an enabled listen rule. */
  const setup = async (label: string) => {
    const user = await registerUser(app, label);
    users.push(user);
    const connectionId = (await createGmailConnection(app, user.id, label)).id;
    await createListenRule(user.agent, {
      connectionId,
      senderEmail: 'notify@vcb.example.test',
      bankProviderId: 'bank_vcb',
    });
    const sync = async () =>
      dataOf<{ status: string }>(
        await user.agent
          .post(`/api/email-connections/${idPath(connectionId)}/sync`)
          .expect(201),
      ).status;
    return { user, connectionId, sync, key: `sync-failure:${connectionId}` };
  };
  const failNext = () =>
    listSpy.mockRejectedValueOnce(new GmailApiError('TRANSIENT', 503));

  beforeAll(async () => {
    app = await createAlertTestApp({ clock });
    prisma = app.get(PrismaService);
    listSpy = jest
      .spyOn(app.get(GmailApiService), 'listMessageIds')
      .mockResolvedValue({ ids: [] });
    jest
      .spyOn(app.get(GmailOAuthService), 'revokeToken')
      .mockResolvedValue(true);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma)
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    await app?.close();
  });

  it('opens a SYSTEM WARNING at the third consecutive failed run, not before', async () => {
    const { user, connectionId, sync, key } = await setup('us5-sync-three');
    failNext();
    expect(await sync()).toBe('FAILED');
    failNext();
    expect(await sync()).toBe('FAILED');
    expect(await alertsWithKey(user.agent, key)).toEqual([]);

    failNext();
    expect(await sync()).toBe('FAILED');
    const [alert] = await alertsWithKey(user.agent, key);
    expect(alert).toMatchObject({
      type: 'SYSTEM',
      severity: 'WARNING',
      status: 'ACTIVE',
      resourceType: 'email_connection',
      resourceId: connectionId,
      metadata: expect.objectContaining({
        condition: 'REPEATED_SYNC_FAILURE',
        runStatuses: 'FAILED,FAILED,FAILED',
      }) as object,
      // No transport in this app (EMAIL_TRANSPORT=disabled).
      emailDelivery: expect.objectContaining({
        skipReason: 'TRANSPORT_DISABLED',
      }) as object,
    });
    // The failures never became a reconnect-required alert.
    expect(
      await alertsWithKey(user.agent, `reconnect:${connectionId}`),
    ).toEqual([]);
  });

  it('a fully successful run resolves it with SYNC_SUCCEEDED', async () => {
    const { user, sync, key } = await setup('us5-sync-recover');
    for (let run = 0; run < 3; run++) {
      failNext();
      await sync();
    }
    expect(await sync()).toBe('SUCCESS');
    expect(await alertsWithKey(user.agent, key)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'SYNC_SUCCEEDED',
      }),
    ]);
  });

  it('counts a stale-lease expiry and a partially failed run as failures', async () => {
    const { user, connectionId, sync, key } = await setup('us5-sync-mixed');
    failNext();
    await sync();
    // A run that stopped mid-way: still RUNNING, its lease long expired.
    await prisma.emailSyncRun.create({
      data: {
        emailConnectionId: connectionId,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    // The next sync takes the lease, records that run EXPIRED, and fails.
    failNext();
    expect(await sync()).toBe('FAILED');
    const runs = await prisma.emailSyncRun.findMany({
      where: { emailConnectionId: connectionId },
      select: { status: true },
    });
    expect(runs.map((run) => run.status).sort()).toEqual([
      'EXPIRED',
      'FAILED',
      'FAILED',
    ]);
    const [alert] = await alertsWithKey(user.agent, key);
    expect(alert).toMatchObject({ status: 'ACTIVE' });
    expect(String(alert.metadata?.runStatuses).split(',').sort()).toEqual([
      'EXPIRED',
      'FAILED',
      'FAILED',
    ]);
  });

  it('a user disconnect resolves it and never alerts reconnect-required', async () => {
    const { user, connectionId, sync, key } = await setup(
      'us5-sync-disconnect',
    );
    for (let run = 0; run < 3; run++) {
      failNext();
      await sync();
    }
    await user.agent
      .delete(`/api/email-connections/${idPath(connectionId)}`)
      .expect(200);
    expect(await alertsWithKey(user.agent, key)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'DISCONNECTED',
      }),
    ]);
    expect(
      (await alertsOf(user.agent)).filter((a) =>
        a.conditionKey?.startsWith('reconnect:'),
      ),
    ).toEqual([]);
  });
});
