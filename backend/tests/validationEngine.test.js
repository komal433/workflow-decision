import { describe, it, expect } from './testHelper.js';
import { ValidationEngine } from '../src/engines/validationEngine.js';
import { ValidationError } from '../src/utils/errors.js';

describe('ValidationEngine', () => {
  const sampleSchema = {
    type: 'object',
    required: ['applicantName', 'email', 'monthlyIncome', 'creditScore', 'loanAmount'],
    properties: {
      applicantName: { type: 'string', minLength: 2 },
      email: { type: 'string', format: 'email' },
      monthlyIncome: { type: 'number', minimum: 0 },
      creditScore: { type: 'integer', minimum: 300, maximum: 850 },
      loanAmount: { type: 'number', minimum: 1000 },
      employmentStatus: { type: 'string', enum: ['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'STUDENT'] }
    }
  };

  it('passes on valid loan application payload', () => {
    const validData = {
      applicantName: 'Alice Johnson',
      email: 'alice@example.com',
      monthlyIncome: 65000,
      creditScore: 780,
      loanAmount: 250000,
      employmentStatus: 'EMPLOYED'
    };

    const result = ValidationEngine.validate(sampleSchema, validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects when mandatory required fields are missing', () => {
    const invalidData = {
      applicantName: 'Alice Johnson',
      monthlyIncome: 65000
      // email, creditScore, loanAmount missing
    };

    const result = ValidationEngine.validate(sampleSchema, invalidData);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    const fields = result.errors.map(e => e.field);
    expect(fields).toContain('email');
    expect(fields).toContain('creditScore');
    expect(fields).toContain('loanAmount');
  });

  it('rejects invalid data types and out-of-range values', () => {
    const invalidTypes = {
      applicantName: 'Bob',
      email: 'not-an-email',
      monthlyIncome: 'lots-of-money', // string instead of number
      creditScore: 999, // out of range [300, 850]
      loanAmount: 500, // below minimum 1000
      employmentStatus: 'INVALID_STATUS'
    };

    const result = ValidationEngine.validate(sampleSchema, invalidTypes);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.field === 'email')).toBe(true);
    expect(result.errors.some(e => e.field === 'monthlyIncome')).toBe(true);
    expect(result.errors.some(e => e.field === 'creditScore')).toBe(true);
    expect(result.errors.some(e => e.field === 'loanAmount')).toBe(true);
    expect(result.errors.some(e => e.field === 'employmentStatus')).toBe(true);
  });

  it('throws ValidationError via assertValid when invalid', () => {
    expect(() => {
      ValidationEngine.assertValid(sampleSchema, {});
    }).toThrow(ValidationError);
  });
});
