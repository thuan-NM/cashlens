# Phase 0 Research: Operational CashLens MVP

## Brownfield modular monolith

**Decision**: Extend existing NestJS modules and React feature pages.  
**Rationale**: GitNexus shows cohesive modules and existing execution paths; gaps are policies/orchestration.  
**Alternatives considered**: New backend, microservices, event platform—rejected as duplication and operational overhead.

## Authorization

**Decision**: Add a small role guard for admin-only account/system configuration; keep mandatory repository owner scoping, with no admin bypass.  
**Rationale**: Current Users CRUD is JWT-only and accepts role/status, while only USER/ADMIN behavior is needed.  
**Alternatives considered**: ACL/policy framework and super-admin data access—unnecessary and contrary to SEC-008.

## Configuration and sessions

**Decision**: Validate configuration through existing ConfigModule at startup; retain rotating cookie sessions and permit one client refresh retry only for safe/idempotent requests.  
**Rationale**: Closes placeholder-secret and expiry gaps without replacing auth.  
**Alternatives considered**: Lazy service validation, localStorage tokens, external auth—later failure or needless risk.

## Gmail synchronization

**Decision**: Keep synchronous user-triggered sync; persist cursor/backfill boundary and a database lease, cap each batch, return continuation, and retry only transient failures with bounded exponential backoff/jitter.  
**Rationale**: Meets incremental/concurrent-safe requirements without a scheduler/worker.  
**Alternatives considered**: Cron, Redis queue, Gmail push, unbounded request—outside clarified MVP.

## Parsing and deduplication

**Decision**: Provider-message uniqueness first, then normalized transaction identity, then owner-scoped deterministic fingerprint; store strategy/key as sanitized evidence.  
**Rationale**: Covers retries and the same event reported by different messages, with DB uniqueness as concurrency defense.  
**Alternatives considered**: Message ID only or fuzzy/ML dedupe—insufficient or unexplainable.

## Classification

**Decision**: Extend `MerchantRule` for nullable system ownership and append `TransactionCategoryEvent`; evaluate manual protection, user priority, system priority, then fallback.  
**Rationale**: Reuses existing patterns/priority/category/provenance and adds only missing audit evidence.  
**Alternatives considered**: Second rules subsystem or JSON history—duplicate or poorly queryable.

## Financial calculations

**Decision**: Share one eligibility/period/currency query policy across dashboard, budgets, alerts, and goals. Goals average up to three completed months and require two.  
**Rationale**: Prevents contradictory totals and removes hard-coded capacity.  
**Alternatives considered**: Materialized reporting store, current-month extrapolation, inferred interest, AI advice—unnecessary or prohibited.

## Alerts and delivery

**Decision**: Run synchronous evaluators after relevant successful writes and explicit recalculation; persist condition lifecycle and delivery attempts; commit in-app before bounded email delivery.  
**Rationale**: Adequate for one host and manual activity; condition keys prevent spam.  
**Alternatives considered**: Event bus/outbox worker/scheduled scanner—excess MVP infrastructure.

## Testing and deployment

**Decision**: Retain Jest/Supertest; add at most one Vite-compatible component runner and one headless E2E tool. Keep dev compose and add immutable release images/compose with explicit migration/readiness.  
**Rationale**: Uses current tooling and separates developer convenience from production behavior.  
**Alternatives considered**: Test-stack migration or Kubernetes/cloud-specific deployment—out of scope.

## Resolved Unknowns

No `NEEDS CLARIFICATION` remains. Email transport is intentionally behind a narrow adapter because SMTP versus HTTP provider does not alter domain/API design; implementation should choose the smallest deployment-compatible option.
