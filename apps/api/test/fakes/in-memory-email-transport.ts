import {
  EmailFailureCode,
  EmailSendError,
  EmailTransport,
  OutgoingEmail,
} from '../../src/modules/alerts/delivery/email-transport';

/**
 * In-memory email transport for unit and e2e tests (T077): records every
 * accepted message and can be scripted to fail, hang, or take time. It never
 * touches the network.
 *
 * - `script` lists outcomes for the next attempts, in order: 'ok', a failure
 *   code, or 'hang' (never settles). When the script is empty, sends succeed.
 * - `onAttempt` runs at the start of every attempt, for example to advance a
 *   fake clock.
 */
export type ScriptedOutcome = 'ok' | 'hang' | EmailFailureCode;

export class InMemoryEmailTransport implements EmailTransport {
  readonly provider = 'smtp' as const;
  readonly sent: OutgoingEmail[] = [];
  attempts = 0;
  script: ScriptedOutcome[] = [];
  onAttempt?: (attempt: number) => void;

  send(message: OutgoingEmail): Promise<{ messageId: string }> {
    this.attempts += 1;
    this.onAttempt?.(this.attempts);
    const outcome = this.script.shift() ?? 'ok';
    if (outcome === 'hang') return new Promise(() => undefined);
    if (outcome !== 'ok') return Promise.reject(new EmailSendError(outcome));
    this.sent.push({ ...message });
    return Promise.resolve({ messageId: `fake-${this.sent.length}` });
  }

  reset() {
    this.sent.length = 0;
    this.attempts = 0;
    this.script = [];
    this.onAttempt = undefined;
  }
}
