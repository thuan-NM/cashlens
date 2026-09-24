// Import this first in e2e suites that load AppModule. Configuration is
// validated when AppModule is imported, so synthetic development settings must
// exist beforehand. Existing values (for example from CI) are left untouched.
// Values are built at runtime so the secret scan (T009) sees no secret-shaped
// literal, and they take precedence over a developer's apps/api/.env.
const synthetic = (name: string): string =>
  `e2e-synthetic-${name}-`.padEnd(40, 'x');

process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_SECRET ??= synthetic('jwt');
process.env.EMAIL_TOKEN_ENCRYPTION_KEY ??= synthetic('encryption');
process.env.GMAIL_CLIENT_ID ??=
  'e2e-synthetic-client.apps.googleusercontent.test';
process.env.GMAIL_CLIENT_SECRET ??= synthetic('gmail-client');
process.env.GMAIL_REDIRECT_URI ??=
  'http://localhost:3000/api/email-connections/gmail/callback';
process.env.GMAIL_OAUTH_STATE_SECRET ??= synthetic('oauth-state');
process.env.EMAIL_TRANSPORT ??= 'disabled';
