/**
 * Generic Configuration-Driven Business Rules Engine
 * Evaluates arbitrary rules against input and external data.
 * Zero hardcoded business logic.
 */

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  if (obj[path] !== undefined) return obj[path];
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateAtomicCondition(actual, operator, expected) {
  switch (operator) {
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '==':
      return actual === expected || String(actual) === String(expected);
    case '!=':
      return actual !== expected && String(actual) !== String(expected);
    case 'IN':
      return Array.isArray(expected) ? expected.includes(actual) : false;
    case 'NOT_IN':
      return Array.isArray(expected) ? !expected.includes(actual) : true;
    case 'BETWEEN':
      return Array.isArray(expected) && expected.length === 2 && actual >= expected[0] && actual <= expected[1];
    case 'CONTAINS':
      return typeof actual === 'string' && actual.includes(String(expected));
    case 'REGEX':
      try {
        const regex = new RegExp(expected);
        return regex.test(String(actual));
      } catch (err) {
        return false;
      }
    default:
      return false;
  }
}

export class RulesEngine {
  /**
   * Evaluates a single rule definition against context
   */
  static evaluateRule(rule, context) {
    const { field, operator, value, conditions = [] } = rule;

    // Compound AND
    if (operator === 'AND' && conditions.length > 0) {
      const conditionResults = conditions.map(c => {
        const actual = getNestedValue(context, c.field);
        const pass = evaluateAtomicCondition(actual, c.operator, c.value);
        return {
          field: c.field,
          operator: c.operator,
          expected: c.value,
          actual,
          pass
        };
      });
      const passed = conditionResults.every(r => r.pass);
      const explanation = passed
        ? (rule.passMessage || `All conditions satisfied for '${rule.name || rule.ruleId}'`)
        : (rule.failureMessage || `Condition not satisfied for '${rule.name || rule.ruleId}': ${conditionResults.filter(r => !r.pass).map(r => `${r.field} (${r.actual}) ${r.operator} ${r.expected}`).join(', ')}`);

      return {
        ruleId: rule.ruleId,
        name: rule.name || rule.ruleId,
        passed,
        actualValue: conditionResults.map(r => ({ [r.field]: r.actual })),
        expectedValue: conditions,
        operator,
        resultAction: rule.result,
        priority: rule.priority,
        isMandatory: !!rule.isMandatory,
        explanation
      };
    }

    // Compound OR
    if (operator === 'OR' && conditions.length > 0) {
      const conditionResults = conditions.map(c => {
        const actual = getNestedValue(context, c.field);
        const pass = evaluateAtomicCondition(actual, c.operator, c.value);
        return {
          field: c.field,
          operator: c.operator,
          expected: c.value,
          actual,
          pass
        };
      });
      const passed = conditionResults.some(r => r.pass);
      const explanation = passed
        ? (rule.passMessage || `At least one condition satisfied for '${rule.name || rule.ruleId}'`)
        : (rule.failureMessage || `None of the conditions were satisfied for '${rule.name || rule.ruleId}'`);

      return {
        ruleId: rule.ruleId,
        name: rule.name || rule.ruleId,
        passed,
        actualValue: conditionResults.map(r => ({ [r.field]: r.actual })),
        expectedValue: conditions,
        operator,
        resultAction: rule.result,
        priority: rule.priority,
        isMandatory: !!rule.isMandatory,
        explanation
      };
    }

    // Single atomic condition
    const actual = getNestedValue(context, field);
    const passed = evaluateAtomicCondition(actual, operator, value);

    const explanation = passed
      ? (rule.passMessage || `Condition met for '${rule.name || rule.ruleId}': ${field} (${actual}) ${operator} ${JSON.stringify(value)}`)
      : (rule.failureMessage || `Condition not met for '${rule.name || rule.ruleId}': ${field} (${actual ?? 'undefined'}) does not satisfy ${operator} ${JSON.stringify(value)}`);

    return {
      ruleId: rule.ruleId,
      name: rule.name || rule.ruleId,
      field,
      passed,
      actualValue: actual,
      expectedValue: value,
      operator,
      resultAction: rule.result,
      priority: rule.priority,
      isMandatory: !!rule.isMandatory,
      explanation
    };
  }

  /**
   * Evaluates all rules from configuration and determines final decision
   * Priority sorting: lower number = higher precedence (1 before 2).
   */
  static evaluateAll(rules = [], context = {}) {
    if (!Array.isArray(rules) || rules.length === 0) {
      return {
        decision: 'APPROVED',
        explanation: 'No business rules configured; default approved.',
        rulesEvaluated: [],
        passedRules: [],
        failedRules: [],
        summary: { total: 0, passed: 0, failed: 0 }
      };
    }

    const sortedRules = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const traces = [];
    const passedRules = [];
    const failedRules = [];

    let decision = null;
    let primaryReason = '';

    for (const rule of sortedRules) {
      const evaluation = this.evaluateRule(rule, context);
      traces.push(evaluation);

      if (evaluation.passed) {
        passedRules.push(evaluation);

        // If this rule condition triggered a state action
        if (!decision) {
          if (evaluation.resultAction === 'REJECT') {
            decision = 'REJECTED';
            primaryReason = evaluation.explanation;
          } else if (evaluation.resultAction === 'MANUAL_REVIEW') {
            decision = 'MANUAL_REVIEW';
            primaryReason = evaluation.explanation;
          } else if (evaluation.resultAction === 'APPROVE') {
            decision = 'APPROVED';
            primaryReason = evaluation.explanation;
          }
        }
      } else {
        failedRules.push(evaluation);

        // If a mandatory eligibility check (resultAction === 'APPROVE') failed, reject
        if (evaluation.isMandatory && evaluation.resultAction === 'APPROVE' && !decision) {
          decision = 'REJECTED';
          primaryReason = `Mandatory eligibility check failed: ${evaluation.explanation}`;
        }
      }
    }

    // Fallback if no explicit terminal rule matched
    if (!decision) {
      decision = 'APPROVED';
      primaryReason = 'The application satisfied all mandatory eligibility conditions and business rules.';
    }

    return {
      decision,
      explanation: primaryReason,
      rulesEvaluated: traces,
      passedRules,
      failedRules,
      summary: {
        total: traces.length,
        passed: passedRules.length,
        failed: failedRules.length
      }
    };
  }
}
