import type { EmailConnectionStatus } from '@prisma/client';
import { evaluateReconnectRequired } from './reconnect-required.evaluator';

/**
 * ALERT-009 reconnect-required row (T076). Reconnect-required is the stored
 * provider-auth state: EXPIRED on a connection the user did not disconnect.
 * A user disconnect is REVOKED with a disconnect time, and a provider or
 * project failure (ERROR, including a project-wide 403) is not an
 * authorization failure.
 */

const connection = (status: EmailConnectionStatus, disconnected = false) => ({
  id: 'c1',
  status,
  disconnectedAt: disconnected ? new Date('2026-09-23T00:00:00Z') : null,
});

const evaluate = (
  connections: ReturnType<typeof connection>[],
  openKeys: string[] = [],
) => evaluateReconnectRequired({ connections, openKeys });

describe('evaluateReconnectRequired (T076)', () => {
  it('holds as a SYSTEM CRITICAL after a provider-auth failure', () => {
    expect(evaluate([connection('EXPIRED')])).toEqual([
      expect.objectContaining({
        key: 'reconnect:c1',
        holds: true,
        mayCreate: true,
        type: 'SYSTEM',
        severity: 'CRITICAL',
        target: { resourceType: 'email_connection', resourceId: 'c1' },
        metadata: expect.objectContaining({
          condition: 'RECONNECT_REQUIRED',
        }) as object,
      }),
    ]);
  });

  it('never holds for a user disconnect', () => {
    expect(evaluate([connection('REVOKED', true)])[0]).toMatchObject({
      holds: false,
      resolutionReason: 'DISCONNECTED',
    });
    expect(evaluate([connection('EXPIRED', true)])[0].holds).toBe(false);
  });

  it('never holds for a provider or project error (ERROR)', () => {
    expect(evaluate([connection('ERROR')])[0].holds).toBe(false);
  });

  it('resolves with RECONNECTED once the connection is ACTIVE again', () => {
    expect(evaluate([connection('ACTIVE')])[0]).toMatchObject({
      holds: false,
      resolutionReason: 'RECONNECTED',
    });
  });

  it('resolves the open key of a removed connection with TARGET_REMOVED', () => {
    expect(evaluate([], ['reconnect:gone'])).toEqual([
      expect.objectContaining({
        key: 'reconnect:gone',
        holds: false,
        resolutionReason: 'TARGET_REMOVED',
      }),
    ]);
  });
});
