/**
 * Decision Explanation Generator
 * Produces structured, transparent, human-readable explanations
 * based on actual rules evaluated, criteria passed/failed, and external factors.
 */
export class ExplanationService {
  /**
   * Generates a detailed explanation report from a workflow instance
   * @param {Object} instance - WorkflowInstance document or lean object
   * @returns {Object} Structured explanation
   */
  static generateExplanation(instance) {
    if (!instance) {
      return {
        decision: 'UNKNOWN',
        summary: 'Workflow instance not found',
        rulesTriggered: [],
        externalFactors: []
      };
    }

    const {
      decision = 'PENDING',
      status,
      inputData = {},
      ruleEvaluationResults = [],
      externalServiceResults = [],
      manualReview = {},
      failureDetails = null
    } = instance;

    // Format rule results into readable bullet points
    const rulesTriggered = (ruleEvaluationResults || []).map(r => {
      const fieldDesc = r.field ? `${r.field} (${JSON.stringify(r.actualValue)})` : 'Conditions';
      const outcome = r.passed ? 'PASSED' : 'FAILED';
      return {
        ruleId: r.ruleId,
        name: r.name || r.ruleId,
        status: outcome,
        priority: r.priority,
        action: r.resultAction,
        explanation: r.explanation,
        detail: `${r.name || r.ruleId}: ${outcome} - ${r.explanation}`
      };
    });

    // Format external factors
    const externalFactors = (externalServiceResults || []).map(ext => ({
      service: ext.serviceName || 'External Service',
      bureauScore: ext.bureauScore,
      fraudRiskScore: ext.fraudRiskScore,
      verified: ext.verified,
      referenceId: ext.bureauReferenceId,
      verifiedAt: ext.verifiedAt
    }));

    // Build human-friendly summary based on status and decision
    let summary = '';
    let justification = [];

    if (decision === 'APPROVED') {
      const passedRulesCount = rulesTriggered.filter(r => r.status === 'PASSED').length;
      summary = `The application was APPROVED. It successfully passed ${passedRulesCount} business rules and met all mandatory criteria.`;
      justification = rulesTriggered.filter(r => r.status === 'PASSED').map(r => r.explanation);
    } else if (decision === 'REJECTED') {
      const fatalRules = rulesTriggered.filter(r => (r.action === 'REJECT' && r.status === 'PASSED') || (r.status === 'FAILED'));
      if (fatalRules.length > 0) {
        summary = `The application was REJECTED due to failure to meet risk standards: ${fatalRules.map(r => r.explanation).join('; ')}`;
        justification = fatalRules.map(r => r.explanation);
      } else {
        summary = `The application was REJECTED. It failed to satisfy baseline qualification policies.`;
      }
    } else if (status === 'MANUAL_REVIEW') {
      const reviewRules = rulesTriggered.filter(r => r.action === 'MANUAL_REVIEW' && r.status === 'PASSED');
      summary = reviewRules.length > 0
        ? `The application was flagged for MANUAL REVIEW: ${reviewRules.map(r => r.explanation).join('; ')}`
        : `The application requires underwriter manual review.`;
      justification = reviewRules.map(r => r.explanation);
    } else if (status === 'RETRY_PENDING') {
      summary = `The application is currently in RETRY_PENDING state waiting for an external service dependency.`;
      if (failureDetails) {
        justification.push(`External dependency issue: ${failureDetails.message || failureDetails.errorType}`);
      }
    } else if (status === 'FAILED') {
      summary = `The application processing FAILED due to system error: ${failureDetails?.message || 'Unknown error'}`;
      if (failureDetails) justification.push(failureDetails.message);
    } else {
      summary = `Workflow is currently in status '${status}'.`;
    }

    // Add manual review note if present
    if (manualReview && manualReview.reviewedBy) {
      summary += ` [Manual Review override by ${manualReview.reviewedBy}: ${manualReview.action} - "${manualReview.comment}"]`;
    }

    return {
      requestId: instance.requestId,
      workflowType: instance.workflowType,
      configVersion: instance.workflowConfigVersion,
      currentStage: instance.currentStage,
      status: instance.status,
      decision: instance.decision || 'PENDING',
      inputSummary: {
        applicantName: inputData.applicantName,
        monthlyIncome: inputData.monthlyIncome,
        creditScore: inputData.creditScore,
        loanAmount: inputData.loanAmount,
        employmentStatus: inputData.employmentStatus
      },
      summary,
      justification,
      rulesTriggered,
      externalFactors,
      manualReviewNote: manualReview?.comment || null,
      evaluatedAt: instance.completedAt || instance.updatedAt
    };
  }
}

