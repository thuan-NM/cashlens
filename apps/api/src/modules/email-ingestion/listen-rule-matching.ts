import type { EmailListenRule } from '@prisma/client';

/** The listen-rule criteria a sync uses (EMAIL-004). */
export type ListenRuleCriteria = Pick<
  EmailListenRule,
  | 'senderEmail'
  | 'senderDomain'
  | 'subjectContains'
  | 'bodyContains'
  | 'syncFromDate'
>;

/**
 * The Gmail search clauses for the enabled rules: sender and subject only.
 * The time window is added per run (sync-policy); the body is checked after
 * the message is read (`matchesListenRule`).
 */
export const gmailRuleQuery = (rules: ListenRuleCriteria[]): string => {
  const clauses = rules.flatMap((rule) => {
    const values: string[] = [];
    if (rule.senderEmail) values.push(`from:${rule.senderEmail}`);
    if (rule.senderDomain) values.push(`from:@${rule.senderDomain}`);
    if (rule.subjectContains) values.push(`subject:"${rule.subjectContains}"`);
    return values;
  });
  return clauses.length ? `{${clauses.join(' ')}}` : '';
};

/**
 * True when every criterion the rule sets holds for the message; sender,
 * subject, and body comparisons ignore letter case.
 */
export const matchesListenRule = (
  rule: ListenRuleCriteria,
  message: { sender: string; subject: string; body: string; receivedAt: Date },
): boolean => {
  const normalizedSender = message.sender.toLowerCase();
  return (
    (!rule.syncFromDate || message.receivedAt >= rule.syncFromDate) &&
    (!rule.senderEmail ||
      normalizedSender === rule.senderEmail.toLowerCase()) &&
    (!rule.senderDomain ||
      normalizedSender.endsWith(`@${rule.senderDomain.toLowerCase()}`)) &&
    (!rule.subjectContains ||
      message.subject
        .toLowerCase()
        .includes(rule.subjectContains.toLowerCase())) &&
    (!rule.bodyContains ||
      message.body.toLowerCase().includes(rule.bodyContains.toLowerCase()))
  );
};

/** Display name and lower-cased address of a `From` header value. */
export const parseSender = (value: string) => {
  const match = value.match(/^(.*?)<([^>]+)>$/);
  return {
    name: match?.[1]?.trim().replace(/^"|"$/g, '') || undefined,
    email: (match?.[2] ?? value).trim().toLowerCase(),
  };
};
