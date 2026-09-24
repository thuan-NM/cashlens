import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { AlertEvaluationService } from './alert-evaluation.service';
import type { AlertLifecycleService } from './alert-lifecycle.service';
import type { AlertsRepository } from './alerts.repository';
import type { AlertDeliveryService } from './delivery/alert-delivery.service';
import type { AlertInputsQuery } from './queries/alert-inputs.query';

/**
 * T079: evaluation never fails the caller, and email is attempted only after
 * the evaluation transaction has committed. The database paths are covered
 * end to end in T085–T091.
 */

const NOW = new Date('2026-09-23T03:00:00.000Z');

const setup = (
  options: { failTransaction?: boolean; failSweep?: boolean } = {},
) => {
  const order: string[] = [];
  const delivery = {
    sweepInterrupted: jest.fn(() =>
      options.failSweep
        ? Promise.reject(new Error('sweep failed'))
        : Promise.resolve(0),
    ),
    plan: jest.fn(() => {
      order.push('plan');
      return Promise.resolve({ id: 'd1', status: 'PENDING' });
    }),
    deliver: jest.fn(() => {
      order.push('deliver');
      return Promise.resolve();
    }),
  };
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      if (options.failTransaction) throw new Error('database down');
      const result = await work({});
      order.push('commit');
      return result;
    }),
  };
  const inputs = {
    context: jest.fn(() =>
      Promise.resolve({
        settings: { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 },
        baseCurrency: 'VND',
        notificationEnabled: true,
        preference: () => ({
          inAppEnabled: true,
          emailEnabled: true,
          threshold: null,
        }),
      }),
    ),
    connections: jest.fn(() =>
      Promise.resolve([{ id: 'c1', status: 'EXPIRED', disconnectedAt: null }]),
    ),
    connectionRuns: jest.fn(() => Promise.resolve([])),
    openKeys: jest.fn(() => Promise.resolve([])),
  };
  const lifecycle = {
    applyConditions: jest.fn(() =>
      Promise.resolve({
        created: [
          {
            id: 'a1',
            userId: 'u1',
            type: 'SYSTEM',
            severity: 'CRITICAL',
            conditionKey: 'reconnect:c1',
          },
        ],
        resolved: [],
        suppressed: [],
      }),
    ),
  };
  const alerts = { lockUserEvaluation: jest.fn(() => Promise.resolve(1)) };
  const service = new AlertEvaluationService(
    prisma as unknown as PrismaService,
    { now: () => NOW },
    inputs as unknown as AlertInputsQuery,
    lifecycle as unknown as AlertLifecycleService,
    delivery as unknown as AlertDeliveryService,
    alerts as unknown as AlertsRepository,
  );
  return { service, order, delivery, lifecycle, alerts };
};

describe('AlertEvaluationService (T079)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('locks the user, applies the lifecycle, plans delivery in the transaction, and delivers after commit', async () => {
    const { service, order, alerts, delivery } = setup();

    const result = await service.onConnectionStatusChanged('u1');

    expect(result).toMatchObject({ ok: true, created: 1 });
    expect(alerts.lockUserEvaluation).toHaveBeenCalledWith({}, 'u1');
    expect(order).toEqual(['plan', 'commit', 'deliver']);
    expect(delivery.deliver).toHaveBeenCalledWith('d1');
  });

  it('never rejects when the evaluation transaction fails, and sends nothing', async () => {
    const { service, delivery } = setup({ failTransaction: true });

    const result = await service.onTransactionsChanged('u1');

    expect(result).toMatchObject({ ok: false });
    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('starts every pending delivery at once, so none sits unattempted behind another (review finding)', async () => {
    const { service, delivery, lifecycle } = setup();
    const created = (id: string) => ({
      id,
      userId: 'u1',
      type: 'SYSTEM',
      severity: 'CRITICAL',
      conditionKey: `reconnect:${id}`,
    });
    lifecycle.applyConditions.mockResolvedValueOnce({
      created: [created('a1'), created('a2'), created('a3')],
      resolved: [],
      suppressed: [],
    });
    let planned = 0;
    delivery.plan.mockImplementation(() =>
      Promise.resolve({ id: `d${++planned}`, status: 'PENDING' }),
    );
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    delivery.deliver.mockImplementation(((id: string) => {
      started.push(id);
      return gate;
    }) as never);

    const running = service.onConnectionStatusChanged('u1');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual(['d1', 'd2', 'd3']);
    release();
    await expect(running).resolves.toMatchObject({ ok: true, created: 3 });
  });

  it('never rejects when the interrupted-delivery sweep fails', async () => {
    const { service } = setup({ failSweep: true });
    await expect(service.onBudgetChanged('u1')).resolves.toMatchObject({
      ok: false,
    });
  });

  it('gates creation on in-app delivery but still passes conditions for resolution', async () => {
    const { service, lifecycle } = setup();
    const inputs = (service as unknown as { inputs: { context: jest.Mock } })
      .inputs;
    inputs.context.mockResolvedValueOnce({
      settings: { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 },
      baseCurrency: 'VND',
      notificationEnabled: true,
      preference: () => ({
        inAppEnabled: false,
        emailEnabled: true,
        threshold: null,
      }),
    });

    await service.onConnectionStatusChanged('u1');

    const calls = lifecycle.applyConditions.mock.calls as unknown as [
      unknown,
      string,
      { key: string; holds: boolean; mayCreate: boolean }[],
    ][];
    const conditions = calls[0][2];
    const reconnect = conditions.find((c) => c.key === 'reconnect:c1');
    expect(reconnect).toMatchObject({ holds: true, mayCreate: false });
  });
});
