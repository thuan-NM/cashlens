import {
  createEmailTransport,
  deliveryOptions,
} from './email-transport.provider';
import { LogEmailTransport } from './log-email.transport';
import { SmtpEmailTransport, classifySmtpError } from './smtp-email.transport';

/** T078: transport selection and SMTP failure classes. No connection is made. */

const config = (values: Record<string, string>) => ({
  get: <T>(key: string) => values[key] as T,
});

describe('email transport binding (T078)', () => {
  it('binds no transport when disabled or unset', () => {
    expect(
      createEmailTransport(config({ EMAIL_TRANSPORT: 'disabled' })),
    ).toBeNull();
    expect(createEmailTransport(config({}))).toBeNull();
  });

  it('binds the redacted log transport for log', () => {
    expect(
      createEmailTransport(config({ EMAIL_TRANSPORT: 'log' })),
    ).toBeInstanceOf(LogEmailTransport);
  });

  it('binds nodemailer SMTP for smtp without connecting', () => {
    const transport = createEmailTransport(
      config({
        EMAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'placeholder-for-test',
        EMAIL_FROM: 'CashLens <alerts@example.test>',
      }),
    );
    expect(transport).toBeInstanceOf(SmtpEmailTransport);
    expect(transport?.provider).toBe('smtp');
  });

  it('reads the delivery budget and public URL', () => {
    expect(
      deliveryOptions(
        config({
          EMAIL_ATTEMPT_TIMEOUT_MS: '5000',
          EMAIL_TOTAL_BUDGET_MS: '12000',
          APP_PUBLIC_URL: 'https://cashlens.example.test',
        }),
      ),
    ).toEqual({
      attemptTimeoutMs: 5000,
      totalBudgetMs: 12000,
      appPublicUrl: 'https://cashlens.example.test',
    });
  });

  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'AUTH'],
    [{ responseCode: 530 }, 'AUTH'],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'REJECTED'],
    [{ responseCode: 554 }, 'REJECTED'],
    [{ code: 'EENVELOPE', responseCode: 451 }, 'TEMPORARY'],
    [{ responseCode: 421 }, 'TEMPORARY'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
    [{ code: 'ECONNECTION' }, 'CONNECTION'],
    [{ code: 'ESOCKET' }, 'CONNECTION'],
    [new Error('unknown'), 'CONNECTION'],
  ])('classifies %p as %s', (error, code) => {
    expect(classifySmtpError(error)).toBe(code);
  });
});
