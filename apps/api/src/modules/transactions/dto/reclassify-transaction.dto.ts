/**
 * An explicit reclassification takes no input: the decision comes from the
 * rules alone (CLASS-002), so the global ValidationPipe rejects any property,
 * such as a category id, with 400 (SEC-004).
 */
export class ReclassifyTransactionDto {}
