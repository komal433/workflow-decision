import { describe, it, expect } from './testHelper.js';
import { ExternalCreditBureauService } from '../src/services/externalService.js';
import { ExternalServiceError } from '../src/utils/errors.js';

describe('ExternalCreditBureauService Simulation', () => {
  const service = new ExternalCreditBureauService({ simulatedLatencyMs: 0 });

  it('returns valid credit bureau verification on normal execution', async () => {
    const applicant = { applicantName: 'John Doe', creditScore: 740, monthlyIncome: 60000, loanAmount: 150000 };
    const result = await service.verifyCreditProfile(applicant);

    expect(result.verified).toBe(true);
    expect(result.bureauScore).toBe(740);
    expect(result.serviceName).toContain('SimEngine');
    expect(result.delinquentAccounts).toBe(0);
    expect(result.fraudRiskScore).toBe('MEDIUM');
  });

  it('simulates external service timeout when forceTimeout flag is passed', async () => {
    const applicant = { applicantName: 'Timeout User', creditScore: 700 };
    let errorCaught = null;
    try {
      await service.verifyCreditProfile(applicant, { forceTimeout: true });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught instanceof ExternalServiceError).toBe(true);
    expect(errorCaught.isRetryable).toBe(true);
    expect(errorCaught.message).toContain('timeout');
  });

  it('simulates transient 503 outage when forceFailure flag is passed', async () => {
    const applicant = { applicantName: 'Fail User', creditScore: 700 };
    let errorCaught = null;
    try {
      await service.verifyCreditProfile(applicant, {
        forceFailure: true,
        failureType: 'EXTERNAL_SERVICE_UNAVAILABLE'
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught instanceof ExternalServiceError).toBe(true);
    expect(errorCaught.isRetryable).toBe(true);
    expect(errorCaught.details.errorType).toBe('EXTERNAL_SERVICE_UNAVAILABLE');
  });

  it('flags fatal non-retryable error if invalid credentials simulated', async () => {
    const applicant = { applicantName: 'Auth Fail', creditScore: 700 };
    let errorCaught = null;
    try {
      await service.verifyCreditProfile(applicant, {
        forceFailure: true,
        failureType: 'INVALID_CREDENTIALS'
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught.isRetryable).toBe(false);
  });
});

