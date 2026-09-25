import {
  ListenRuleCriteria,
  gmailRuleQuery,
  matchesListenRule,
  parseSender,
} from './listen-rule-matching';

const rule = (
  criteria: Partial<ListenRuleCriteria> = {},
): ListenRuleCriteria => ({
  senderEmail: null,
  senderDomain: null,
  subjectContains: null,
  bodyContains: null,
  syncFromDate: null,
  ...criteria,
});

const message = {
  sender: 'notify@vcb.example.test',
  subject: 'Vietcombank - Biến động số dư tài khoản',
  body: 'Số tiền: -1,250,000 VND',
  receivedAt: new Date('2026-09-13T02:01:00.000Z'),
};

describe('gmailRuleQuery (EMAIL-004)', () => {
  it('ORs every sender and subject clause of the enabled rules', () => {
    expect(
      gmailRuleQuery([
        rule({ senderEmail: 'notify@vcb.example.test' }),
        rule({
          senderDomain: 'bank.example.test',
          subjectContains: 'Biến động',
        }),
      ]),
    ).toBe(
      '{from:notify@vcb.example.test from:@bank.example.test subject:"Biến động"}',
    );
  });

  it('is empty when no rule has a searchable clause (body-only rules)', () => {
    expect(gmailRuleQuery([rule({ bodyContains: 'VND' })])).toBe('');
    expect(gmailRuleQuery([])).toBe('');
  });
});

describe('matchesListenRule (EMAIL-004)', () => {
  it('matches when every set criterion holds, ignoring letter case', () => {
    expect(
      matchesListenRule(
        rule({
          senderEmail: 'NOTIFY@vcb.example.test',
          subjectContains: 'biến động',
          bodyContains: 'vnd',
          syncFromDate: new Date('2026-09-01T00:00:00.000Z'),
        }),
        message,
      ),
    ).toBe(true);
    expect(
      matchesListenRule(rule({ senderDomain: 'VCB.example.test' }), message),
    ).toBe(true);
    expect(matchesListenRule(rule(), message)).toBe(true);
  });

  it('rejects when any single criterion fails', () => {
    expect(
      matchesListenRule(
        rule({ senderEmail: 'other@vcb.example.test' }),
        message,
      ),
    ).toBe(false);
    expect(
      matchesListenRule(rule({ senderDomain: 'example.test' }), message),
    ).toBe(false);
    expect(
      matchesListenRule(rule({ subjectContains: 'Sao kê' }), message),
    ).toBe(false);
    expect(matchesListenRule(rule({ bodyContains: 'USD' }), message)).toBe(
      false,
    );
    expect(
      matchesListenRule(
        rule({ syncFromDate: new Date('2026-09-14T00:00:00.000Z') }),
        message,
      ),
    ).toBe(false);
  });
});

describe('parseSender', () => {
  it('splits a display name from a lower-cased address', () => {
    expect(parseSender('"Vietcombank" <Notify@VCB.example.test>')).toEqual({
      name: 'Vietcombank',
      email: 'notify@vcb.example.test',
    });
    expect(parseSender('  Notify@VCB.example.test ')).toEqual({
      name: undefined,
      email: 'notify@vcb.example.test',
    });
  });
});
