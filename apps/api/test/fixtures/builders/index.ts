/**
 * Shared synthetic fixture builders (T098, TEST-008). Suite-specific helpers
 * stay in test/helpers/*: auth-fixtures (users and sessions),
 * email-fixtures (Gmail connections, messages, templates, rules),
 * alert-fixtures (US5 clock, email transport, import harness), parser-gate
 * (declared parser fixtures).
 */
export * from './ledger';
export * from './worked-examples';
