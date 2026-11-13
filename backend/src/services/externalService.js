import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Simulated External Credit Bureau & Risk Verification Service
 * Simulates real-world external dependency behavior including timeouts,
 * rate-limits, transient outages, and deterministic test failure injections.
 */
export class ExternalCreditBureauService {
  constructor(options = {}) {
    this.failureProbability = options.failureProbability ?? 0.0; // 0% by default
    this.simulatedLatencyMs = options.simulatedLatencyMs ?? 50;
  }

  /**
   * Verifies applicant data with simulated external credit bureau
   * @param {Object} applicantData - User submitted data (e.g. creditScore, monthlyIncome)
   * @param {Object} options - Simulation flags ({ forceFailure, forceTimeout, failureType })
   * @returns {Promise<Object>} Verification report
   */
  async verifyCreditProfile(applicantData, options = {}) {
    logger.info('External credit bureau verification initiated', {
      applicant: applicantData.applicantName,
      options
    });

    // 1. Check for simulated timeout
    if (options.forceTimeout) {
      throw new ExternalServiceError(
        'Credit Bureau API gateway timeout after 5000ms',
        true,
        { errorType: 'TIMEOUT', service: 'CreditBureauGateway' }
      );
    }

    // 2. Check for deterministic test-controlled failure injection
    if (options.forceFailure) {
      const failureType = options.failureType || 'EXTERNAL_SERVICE_UNAVAILABLE';
      const isRetryable = failureType !== 'INVALID_CREDENTIALS';
      throw new ExternalServiceError(
        `External Credit Bureau error: [${failureType}] - System temporarily unreachable`,
        isRetryable,
        { errorType: failureType, service: 'CreditBureauGateway' }
      );
    }

    // 3. Check for probabilistic random failure (if configured in environment/options)
    if (this.failureProbability > 0 && Math.random() < this.failureProbability) {
      throw new ExternalServiceError(
        'Credit Bureau upstream service transient failure (HTTP 503)',
        true,
        { errorType: 'EXTERNAL_SERVICE_UNAVAILABLE', service: 'CreditBureauGateway' }
      );
    }

    // Optional simulated small network latency
    if (this.simulatedLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatencyMs));
    }

    // Return realistic verified credit bureau profile
    const baseScore = Number(applicantData.creditScore) || 700;
    // Bureau calculation: slight variation of provided score or verification delta
    const bureauScore = Math.max(300, Math.min(850, baseScore));
    const delinquentAccounts = bureauScore < 600 ? 2 : 0;
    const debtToIncomeRatio = applicantData.loanAmount && applicantData.monthlyIncome
      ? Number((applicantData.loanAmount / (applicantData.monthlyIncome * 12)).toFixed(2))
      : 0.35;

    return {
      verified: true,
      serviceName: 'TransUnion/Equifax SimEngine',
      bureauReferenceId: `BUR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      bureauScore,
      delinquentAccounts,
      debtToIncomeRatio,
      fraudRiskScore: bureauScore >= 750 ? 'LOW' : bureauScore >= 600 ? 'MEDIUM' : 'HIGH',
      verifiedAt: new Date().toISOString()
    };
  }
}

export const externalCreditBureauService = new ExternalCreditBureauService();

