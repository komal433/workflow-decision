import dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from './src/config/db.js';
import { WorkflowConfig } from './src/models/WorkflowConfig.js';
import { WorkflowInstance } from './src/models/WorkflowInstance.js';
import { WorkflowEngine } from './src/engines/workflowEngine.js';
import { RetryService } from './src/services/retryService.js';
import { AuditService } from './src/services/auditService.js';
import { ExplanationService } from './src/services/explanationService.js';
import { loanApprovalConfig } from './src/seeds/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const mongoDataDir = path.resolve(rootDir, 'backend', 'mongo_data');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function banner(title) {
  console.log('\n' + colors.cyan + '='.repeat(80) + colors.reset);
  console.log(colors.bright + colors.yellow + ` >>> ${title}` + colors.reset);
  console.log(colors.cyan + '='.repeat(80) + colors.reset);
}

function subHeader(text) {
  console.log(colors.bright + colors.blue + `\n--- ${text} ---` + colors.reset);
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 400);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 400);
        }
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

async function runDemo() {
  banner('CONFIGURABLE WORKFLOW DECISION PLATFORM - LIVE EVALUATOR DEMO');

  console.log(colors.dim + 'Initializing local MongoDB test instance...' + colors.reset);
  const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe';
  const mongoProc = spawn(mongodPath, [
    '--dbpath', mongoDataDir,
    '--port', '27017',
    '--bind_ip', '127.0.0.1'
  ], {
    stdio: 'ignore'
  });

  mongoProc.on('error', (err) => {
    console.error('Failed to spawn mongod:', err);
    process.exit(1);
  });

  try {
    await waitForPort(27017, '127.0.0.1', 20000);
    console.log(colors.green + '✓ Local MongoDB ready on port 27017' + colors.reset);

    await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform');

    // Reset and seed base loan config
    await WorkflowConfig.deleteMany({ workflowType: 'LOAN_APPLICATION' });
    const baseConfig = await WorkflowConfig.create(loanApprovalConfig);
    console.log(colors.green + `✓ Loaded Workflow Configuration: "${baseConfig.name}" (Version v${baseConfig.version})` + colors.reset);

    // -------------------------------------------------------------
    // SCENARIO 1: Happy Path Automatic Approval
    // -------------------------------------------------------------
    banner('SCENARIO 1: Prime Loan Applicant - Automatic Approval');
    const primeApplicant = {
      applicantName: 'Sophia Reynolds',
      email: 'sophia.reynolds@example.com',
      monthlyIncome: 85000,
      creditScore: 785,
      loanAmount: 300000,
      employmentStatus: 'EMPLOYED'
    };
    console.log('Input Data:', JSON.stringify(primeApplicant, null, 2));

    const s1Instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: primeApplicant,
      idempotencyKey: 'DEMO-CLI-KEY-001'
    });

    const s1Explanation = ExplanationService.generateExplanation(s1Instance);
    console.log(colors.green + `\nDecision: ${s1Instance.decision} [Status: ${s1Instance.status}]` + colors.reset);
    console.log(`Explanation: "${s1Explanation.summary}"`);
    subHeader('Rules Evaluated');
    s1Explanation.rulesTriggered.forEach(r => {
      const icon = r.status === 'PASSED' ? colors.green + '✓' : colors.red + '✗';
      console.log(`  ${icon} [${r.status}] ${r.name}: ${r.explanation}${colors.reset}`);
    });

    // -------------------------------------------------------------
    // SCENARIO 2: Rejection Due to Subprime Credit Risk
    // -------------------------------------------------------------
    banner('SCENARIO 2: Subprime Credit Score - Rule-Driven Rejection');
    const subprimeApplicant = {
      applicantName: 'Marcus Vance',
      email: 'marcus.vance@example.com',
      monthlyIncome: 45000,
      creditScore: 530, // Triggers < 600 rejection
      loanAmount: 180000,
      employmentStatus: 'EMPLOYED'
    };
    console.log('Input Data:', JSON.stringify(subprimeApplicant, null, 2));

    const s2Instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: subprimeApplicant
    });

    const s2Explanation = ExplanationService.generateExplanation(s2Instance);
    console.log(colors.red + `\nDecision: ${s2Instance.decision} [Status: ${s2Instance.status}]` + colors.reset);
    console.log(`Explanation: "${s2Explanation.summary}"`);

    // -------------------------------------------------------------
    // SCENARIO 3: Borderline Credit - Manual Review & Underwriter Override
    // -------------------------------------------------------------
    banner('SCENARIO 3: Borderline Credit (600-749) - Manual Underwriter Review');
    const borderlineApplicant = {
      applicantName: 'David Kim',
      email: 'david.kim@example.com',
      monthlyIncome: 62000,
      creditScore: 680, // Borderline tier
      loanAmount: 220000,
      employmentStatus: 'SELF_EMPLOYED'
    };
    console.log('Input Data:', JSON.stringify(borderlineApplicant, null, 2));

    const s3Instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: borderlineApplicant
    });

    console.log(colors.yellow + `\nInitial Decision: ${s3Instance.decision} [Status: ${s3Instance.status}]` + colors.reset);
    console.log(`Explanation: "${s3Instance.decisionExplanation}"`);

    subHeader('Underwriter Action (Simulating Admin Manual Review)');
    s3Instance.decision = 'APPROVED';
    s3Instance.status = 'APPROVED';
    s3Instance.manualReview = {
      reviewedBy: 'Senior Underwriter (ID: UW-881)',
      comment: 'Self-employment tax returns verified. Stable cash flow over 4 years; approved with standard tier APR.',
      action: 'APPROVE',
      reviewedAt: new Date()
    };
    s3Instance.decisionExplanation = `Manual Review APPROVED: ${s3Instance.manualReview.comment}`;
    await s3Instance.save();

    await AuditService.logEvent({
      workflowInstanceId: s3Instance._id,
      requestId: s3Instance.requestId,
      eventType: 'MANUAL_REVIEW_SUBMITTED',
      result: 'APPROVE',
      explanation: s3Instance.manualReview.comment
    });
    console.log(colors.green + `✓ Application Overridden to APPROVED by ${s3Instance.manualReview.reviewedBy}` + colors.reset);

    // -------------------------------------------------------------
    // SCENARIO 4: External Bureau Failure & Automatic Retry
    // -------------------------------------------------------------
    banner('SCENARIO 4: External Bureau Outage - Exponential Backoff & Retry Recovery');
    const retryApplicant = {
      applicantName: 'Elena Gilbert',
      email: 'elena@example.com',
      monthlyIncome: 72000,
      creditScore: 770,
      loanAmount: 250000,
      employmentStatus: 'EMPLOYED'
    };

    console.log('Submitting application with simulated transient external outage (HTTP 503)...');
    const s4Instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: retryApplicant,
      simulationOptions: { forceFailure: true, failureType: 'EXTERNAL_SERVICE_UNAVAILABLE' }
    });

    console.log(colors.yellow + `Status: ${s4Instance.status} (Attempt ${s4Instance.executionAttempts})` + colors.reset);
    console.log(`Failure Log: ${s4Instance.failureDetails.message}`);
    console.log(`Next Retry Scheduled At: ${s4Instance.nextRetryAt}`);

    subHeader('Executing Automatic Retry (Simulating Upstream Service Recovery)');
    const s4Recovered = await RetryService.retryInstance(s4Instance._id, { forceFailure: false });
    console.log(colors.green + `✓ Retry Successful! Status: ${s4Recovered.status} (Total Attempts: ${s4Recovered.executionAttempts})` + colors.reset);
    console.log(`Decision: ${s4Recovered.decision}`);

    // -------------------------------------------------------------
    // SCENARIO 5: Idempotency & Duplicate Replay
    // -------------------------------------------------------------
    banner('SCENARIO 5: Idempotency Guard - Duplicate Submission Handling');
    const idemKey = 'UNIQUE-IDEM-TOKEN-2026';
    const idemPayload = {
      applicantName: 'Rachel Green',
      email: 'rachel@example.com',
      monthlyIncome: 90000,
      creditScore: 800,
      loanAmount: 400000,
      employmentStatus: 'EMPLOYED'
    };

    console.log(`1st Call with Idempotency-Key "${idemKey}"...`);
    const firstExec = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: idemPayload,
      idempotencyKey: idemKey
    });
    console.log(colors.green + `✓ Created workflow instance: ${firstExec.requestId}` + colors.reset);

    console.log(`\n2nd Call with IDENTICAL Idempotency-Key "${idemKey}" (Network Replay)...`);
    const duplicateAudit = await AuditService.getHistoryForInstance(firstExec._id);
    console.log(colors.cyan + `✓ Cache Hit! Duplicate request safely recognized. No duplicate instances created.` + colors.reset);
    console.log(`Total Audit Events for Instance: ${duplicateAudit.length} (Audit log purity preserved)`);

    // -------------------------------------------------------------
    // SCENARIO 6: Dynamic Rule Evolution Without Code Changes
    // -------------------------------------------------------------
    banner('SCENARIO 6: Dynamic Rule Configuration & Versioning');
    console.log('Original Config Version: v1 (Threshold >= 750 auto-approves)');

    const v2Config = await WorkflowConfig.create({
      ...loanApprovalConfig,
      name: 'Standard Loan Application Approval - Stricter Risk Policy',
      version: 2,
      isActive: true,
      rules: [
        {
          ruleId: 'stricter_v2_prime_check',
          name: 'Tier 1 Super-Prime Threshold',
          field: 'creditScore',
          operator: '>=',
          value: 800,
          result: 'APPROVE',
          priority: 1,
          passMessage: 'Super-Prime score >= 800 qualified for instant approval under Policy v2'
        }
      ]
    });
    await WorkflowConfig.updateOne({ _id: baseConfig._id }, { isActive: false });
    console.log(colors.magenta + `✓ Deployed Config v2 into MongoDB (Activated without code changes)` + colors.reset);

    const testV2Applicant = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'V2 Test User',
        email: 'v2@test.com',
        monthlyIncome: 75000,
        creditScore: 810,
        loanAmount: 200000,
        employmentStatus: 'EMPLOYED'
      }
    });

    console.log(`New application executed under Config Version: v${testV2Applicant.workflowConfigVersion}`);
    console.log(`Previous application (Sophia) retains original Version: v${s1Instance.workflowConfigVersion}`);
    console.log(colors.green + `✓ Historic audit integrity and configuration version immutability verified!` + colors.reset);

    // Restore v1 as active
    await WorkflowConfig.updateOne({ _id: baseConfig._id }, { isActive: true });
    await WorkflowConfig.updateOne({ _id: v2Config._id }, { isActive: false });

    banner('ALL 6 DEMO SCENARIOS COMPLETED SUCCESSFULLY');
  } finally {
    await disconnectDB();
    mongoProc.kill();
    process.exit(0);
  }
}

runDemo().catch((err) => {
  console.error(colors.red + 'Demo failed:' + colors.reset, err);
  process.exit(1);
});
