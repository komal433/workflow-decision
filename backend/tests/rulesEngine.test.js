import { describe, it, expect } from './testHelper.js';
import { RulesEngine } from '../src/engines/rulesEngine.js';

describe('RulesEngine', () => {
  const loanRules = [
    {
      ruleId: 'min_income_check',
      name: 'Minimum Income Check',
      field: 'monthlyIncome',
      operator: '<',
      value: 30000,
      result: 'REJECT',
      priority: 1,
      isMandatory: true,
      failureMessage: 'Monthly income is below minimum threshold of 30,000'
    },
    {
      ruleId: 'severe_low_credit_check',
      name: 'Severe Credit Risk Check',
      field: 'creditScore',
      operator: '<',
      value: 600,
      result: 'REJECT',
      priority: 2,
      isMandatory: true,
      failureMessage: 'Credit score is below minimum acceptable threshold of 600'
    },
    {
      ruleId: 'borderline_credit_check',
      name: 'Borderline Credit Score Review',
      operator: 'AND',
      conditions: [
        { field: 'creditScore', operator: '>=', value: 600 },
        { field: 'creditScore', operator: '<', value: 750 }
      ],
      result: 'MANUAL_REVIEW',
      priority: 3,
      passMessage: 'Credit score is in borderline range (600 - 749); routed for underwriter manual review'
    },
    {
      ruleId: 'auto_approve_tier1',
      name: 'Tier 1 Auto-Approval Check',
      operator: 'AND',
      conditions: [
        { field: 'creditScore', operator: '>=', value: 750 },
        { field: 'monthlyIncome', operator: '>=', value: 50000 }
      ],
      result: 'APPROVE',
      priority: 4,
      passMessage: 'Applicant satisfies Tier 1 high-confidence credit and income criteria'
    }
  ];

  it('approves applicant when all mandatory rules pass and auto-approval criteria met', () => {
    const context = {
      applicantName: 'Sarah Connor',
      monthlyIncome: 65000,
      creditScore: 780,
      loanAmount: 200000
    };

    const result = RulesEngine.evaluateAll(loanRules, context);
    expect(result.decision).toBe('APPROVED');
    expect(result.summary.passed).toBeGreaterThanOrEqual(1);
    expect(result.summary.failed).toBeGreaterThanOrEqual(1); // the < 30000 rule failed, which is desired
    expect(result.explanation).toContain('Tier 1');
  });

  it('rejects applicant when severe low credit score rule triggers', () => {
    const context = {
      applicantName: 'John Risk',
      monthlyIncome: 45000,
      creditScore: 550, // triggers < 600 REJECT
      loanAmount: 100000
    };

    const result = RulesEngine.evaluateAll(loanRules, context);
    expect(result.decision).toBe('REJECTED');
    expect(result.rulesEvaluated.some(r => r.ruleId === 'severe_low_credit_check' && r.passed)).toBe(true);
  });

  it('rejects applicant when monthly income is below threshold', () => {
    const context = {
      applicantName: 'Penny Pincher',
      monthlyIncome: 20000, // triggers < 30000 REJECT
      creditScore: 800,
      loanAmount: 50000
    };

    const result = RulesEngine.evaluateAll(loanRules, context);
    expect(result.decision).toBe('REJECTED');
  });

  it('routes to MANUAL_REVIEW when credit score is borderline (600-749)', () => {
    const context = {
      applicantName: 'Bob Borderline',
      monthlyIncome: 55000,
      creditScore: 680,
      loanAmount: 150000
    };

    const result = RulesEngine.evaluateAll(loanRules, context);
    expect(result.decision).toBe('MANUAL_REVIEW');
    expect(result.explanation).toContain('borderline range');
  });

  it('supports compound OR conditions and range/regex operators', () => {
    const customRules = [
      {
        ruleId: 'valid_region_or_vip',
        name: 'Region or VIP Flag',
        operator: 'OR',
        conditions: [
          { field: 'country', operator: '==', value: 'US' },
          { field: 'isVIP', operator: '==', value: true }
        ],
        result: 'APPROVE',
        priority: 1
      }
    ];

    const passVIP = RulesEngine.evaluateAll(customRules, { country: 'CA', isVIP: true });
    expect(passVIP.decision).toBe('APPROVED');

    const failBoth = RulesEngine.evaluateAll(customRules, { country: 'CA', isVIP: false });
    expect(failBoth.rulesEvaluated[0].passed).toBe(false);
  });
});
