// Import this first in e2e suites that load AppModule. Configuration is
// validated when AppModule is imported, so synthetic development settings must
// exist beforehand. Existing values (for example from CI) are left untouched.
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_SECRET ??= 'e2e-synthetic-jwt-secret';
