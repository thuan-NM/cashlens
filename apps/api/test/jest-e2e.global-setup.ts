import {
  databaseName,
  dropStaleE2eSchemas,
  dropStaleIsolatedDatabases,
  ensureDatabaseExists,
  migrateDatabase,
  resolveE2eDatabaseUrl,
} from './helpers/test-database';

/**
 * Runs once before the e2e suites (research.md "E2E test database strategy"):
 * guards and migrates the shared test database, removes leftovers from
 * crashed runs, and points the application under test at the test database.
 */
export default async function globalSetup(): Promise<void> {
  // Aborts unless E2E_DATABASE_URL names a database containing "test".
  const url = resolveE2eDatabaseUrl();
  await ensureDatabaseExists(url);
  migrateDatabase(url);
  await dropStaleIsolatedDatabases();
  await dropStaleE2eSchemas(url);

  process.env.E2E_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
  console.log(`e2e: using test database "${databaseName(url)}"`);
}
