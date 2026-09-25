import { NestFactory } from '@nestjs/core';
import { ConfigValidationError } from '../config/configuration';
import { AdminBootstrapService } from '../modules/users/admin-bootstrap.service';

/**
 * Operator-run first-administrator provisioning (SEC-009, research.md
 * "Administrator bootstrap"). It needs host and database access and is never
 * reachable over the network.
 *
 *   --email <email>            promote an existing ACTIVE self-registered account
 *   --list-admins              list administrators (no credentials)
 *   --revoke --email <email>   remove the administrator role (audited)
 *
 * Exit codes: 0 done or no-op; 2 target missing, disabled, deleted, or not
 * self-registered; 3 another active administrator exists; 1 configuration,
 * database, or usage error. Output never contains a credential or the
 * connection string.
 *
 * Development: yarn workspace api admin:bootstrap --email <email>
 * Production:  node dist/src/scripts/bootstrap-admin.js --email <email>
 */

type Command =
  | { mode: 'promote'; email: string }
  | { mode: 'revoke'; email: string }
  | { mode: 'list' };

const USAGE =
  'Usage: bootstrap-admin --email <email> | --list-admins | --revoke --email <email>';

function parseArgs(argv: string[]): Command | null {
  const isEmail = (value: string | undefined): value is string =>
    typeof value === 'string' && value.includes('@') && !value.startsWith('--');

  if (argv.length === 1 && argv[0] === '--list-admins') {
    return { mode: 'list' };
  }
  if (argv.length === 2 && argv[0] === '--email' && isEmail(argv[1])) {
    return { mode: 'promote', email: argv[1] };
  }
  if (argv.length === 3 && argv.includes('--revoke')) {
    const rest = argv.filter((arg) => arg !== '--revoke');
    if (rest.length === 2 && rest[0] === '--email' && isEmail(rest[1])) {
      return { mode: 'revoke', email: rest[1] };
    }
  }
  return null;
}

async function run(argv: string[]): Promise<number> {
  const command = parseArgs(argv);
  if (!command) {
    console.error(USAGE);
    return 1;
  }

  // Loaded here, not imported at the top: configuration is validated when the
  // module loads, and a failure must end in exit code 1, not a stack trace.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BootstrapAdminModule } = require('./bootstrap-admin.module') as {
    BootstrapAdminModule: new () => unknown;
  };
  const app = await NestFactory.createApplicationContext(BootstrapAdminModule, {
    logger: false,
  });

  try {
    const service = app.get(AdminBootstrapService);

    if (command.mode === 'list') {
      const admins = await service.listAdmins();
      console.log(`Administrators: ${admins.length}`);
      for (const admin of admins) {
        console.log(
          [
            admin.id,
            admin.email,
            admin.status,
            `created ${admin.createdAt.toISOString()}`,
            `last login ${admin.lastLoginAt?.toISOString() ?? 'never'}`,
          ].join('  '),
        );
      }
      return 0;
    }

    if (command.mode === 'revoke') {
      const outcome = await service.revoke(command.email);
      if (outcome === 'TARGET_INVALID') {
        console.error('Refused: no account with that email exists.');
        return 2;
      }
      console.log(
        outcome === 'REVOKED'
          ? 'Administrator role removed; audit record written.'
          : 'No change: the account is not an administrator.',
      );
      return 0;
    }

    const outcome = await service.promote(command.email);
    switch (outcome) {
      case 'PROMOTED':
        console.log('Promoted to administrator; audit record written.');
        return 0;
      case 'ALREADY_ADMIN':
        console.log('No change: the account is already an administrator.');
        return 0;
      case 'ADMIN_EXISTS':
        console.error('Refused: an active administrator already exists.');
        return 3;
      default:
        console.error(
          'Refused: the account is missing, disabled, deleted, or not self-registered.',
        );
        return 2;
    }
  } finally {
    await app.close();
  }
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Configuration errors name keys only; any other error prints its class
    // and its short error code (Prisma `P2028`, SQLSTATE `3D000`), never a
    // message that could contain the connection string.
    const code = (error as { code?: unknown } | null)?.code;
    const safeCode =
      typeof code === 'string' && /^[A-Z0-9]{4,6}$/.test(code)
        ? ` (code ${code})`
        : '';
    const detail =
      error instanceof ConfigValidationError
        ? error.message
        : error instanceof Error
          ? `${error.name}${safeCode}`
          : 'unknown error';
    console.error(`Configuration or database error: ${detail}`);
    process.exitCode = 1;
  });
