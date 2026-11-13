# Configurable Workflow Decision Platform

> A production-minded, modular, configuration-driven decisioning and workflow orchestration platform built with Node.js (ES Modules), MongoDB, and Mongoose.

[![Tests](https://img.shields.io/badge/Tests-36%20Passed%20(100%25)-emerald.svg)]()
[![Node](https://img.shields.io/badge/Node-v20%2B-blue.svg)]()
[![Database](https://img.shields.io/badge/MongoDB-v6%2B%20%7C%20v8%2B-green.svg)]()
[![Architecture](https://img.shields.io/badge/Architecture-Modular%20Monolith-indigo.svg)]()

---

## 1. Project Overview

Real-world business applications (e.g. Loan Approvals, Insurance Claim Processing, Vendor Onboarding, Employee Verification) frequently face changing risk policies, regulatory updates, transient third-party outages, and duplicate submissions.

This platform replaces hardcoded `if/else` logic with a **generic, configuration-driven decision and workflow engine**:
- **Dynamic Rules Engine**: Reads rules, thresholds, priority order, and compound `AND`/`OR` conditions from MongoDB without source-code modifications.
- **Explainable Decisions**: Translates rule evaluation traces into human-readable rationales explaining the exact mathematical criteria.
- **Resilient Fault Handling**: Simulates external dependency failures with exponential backoff retries and automatic escalation.
- **Idempotency & Concurrency Safety**: Prevents duplicate execution, double-charging, and race conditions using atomic database locks and SHA-256 payload integrity hashing.
- **Append-Only Auditing**: Records every state transition, external call, rule evaluation, and human underwriter review.
- **Multi-Workflow Support**: Supports `LOAN_APPLICATION` (fully implemented primary use-case), `INSURANCE_CLAIM`, and `VENDOR_APPROVAL`.

---

## 2. Technology Stack

- **Runtime & Language**: Node.js v20+ with ECMAScript Modules (`"type": "module"`).
- **Web Framework**: Express.js with centralized error handling.
- **Database**: MongoDB with Mongoose ODM (indexes, validation, schema versioning).
- **Validation**: Schema-driven validation engine with Zod compatibility.
- **Test Harness**: Node.js native test runner (`node:test`, `node:assert`) + Supertest for end-to-end API testing.
- **Evaluator UI**: Lightweight, interactive single-page dashboard served directly by the Express server (`http://localhost:5000/`) + Interactive CLI Demo Runner (`npm run demo`).

---

## 3. Folder Structure

```
home-assignment/
├── backend/
│   ├── src/
│   │   ├── config/              # MongoDB connection & environment configuration
│   │   ├── controllers/         # Thin controllers (Workflow, Config, Dashboard, Audit)
│   │   ├── engines/             # Core engines: RulesEngine, ValidationEngine, WorkflowEngine
│   │   ├── middlewares/         # Centralized error handler, RBAC auth, logging
│   │   ├── models/              # Mongoose models: WorkflowConfig, WorkflowInstance, AuditLog, IdempotencyRecord
│   │   ├── routes/              # Express REST API routes
│   │   ├── seeds/               # Seed scripts for Loan, Insurance, and Vendor workflows
│   │   ├── services/            # RetryManager, ExternalServiceAdapter, AuditService, Explainer
│   │   ├── utils/               # Structured logger, custom domain errors, standard responses
│   │   ├── app.js               # Express application setup
│   │   └── server.js            # Main server entrypoint & background retry worker
│   ├── public/                  # Minimal evaluator web dashboard (served at http://localhost:5000/)
│   ├── tests/                   # 36 comprehensive automated test suites
│   │   ├── validationEngine.test.js
│   │   ├── rulesEngine.test.js
│   │   ├── stateMachine.test.js
│   │   ├── externalService.test.js
│   │   ├── idempotency.test.js
│   │   ├── workflowIntegration.test.js
│   │   └── apiEndpoints.test.js
│   ├── demo.js                  # Interactive evaluator CLI demo runner
│   ├── testRunner.js            # Automated test runner with MongoDB integration
│   ├── seedRunner.js            # Seed runner with local MongoDB instance
│   ├── package.json
│   └── .env.example
├── docs/
│   └── architecture.md          # Architectural specification, Mermaid diagrams & trade-off defense
└── README.md
```

---

## 4. Quick Start & Installation

### Prerequisites
- Node.js (v20.x or v22.x)
- MongoDB Server running locally on port `27017` (or remote MongoDB connection string)

### Step 1: Clone & Install
```bash
cd backend
npm install
```

### Step 2: Environment Variables
Create `.env` file in the `backend/` directory (already configured in `.env.example`):
```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/workflow_decision_platform
LOG_LEVEL=INFO
NODE_ENV=development
```

### Step 3: Seed Database with Demo Workflows
Seeds 3 workflow types (`LOAN_APPLICATION`, `INSURANCE_CLAIM`, `VENDOR_APPROVAL`) and runs initial test instances:
```bash
npm run seed
```

### Step 4: Run the Interactive CLI Demo
Demonstrates all 6 required real-world hackathon scenarios in the terminal:
```bash
npm run demo
```

### Step 5: Start the Server & Web Dashboard
```bash
npm start
```
- **Backend API**: `http://localhost:5000`
- **Health Check**: `http://localhost:5000/api/health`
- **Evaluator Web Dashboard**: Open `http://localhost:5000/` in any browser!

---

## 5. Running Automated Tests

The automated test suite contains **36 test scenarios** covering unit logic, state machine guards, external dependencies, retries, idempotency, and REST API controllers with **100% pass rate**.

### Run Unit Tests (Fast, zero-dependency)
```bash
npm run test:unit
```
*Executes ValidationEngine, RulesEngine, StateMachine, and ExternalService tests.*

### Run Complete End-to-End Test Suite
```bash
npm test
```
*Runs all 7 test suites against MongoDB, testing live database state, versioning, retries, and Supertest HTTP endpoints.*

---

## 6. Decision Explanation Examples (Required PDF Deliverable #6)

The platform returns transparent, human-readable rationales synthesized directly from the rule execution traces.

### Example 1: Automatic Prime Approval
**Input Payload**:
```json
{
  "applicantName": "Sarah Jenkins",
  "monthlyIncome": 75000,
  "creditScore": 790,
  "loanAmount": 250000,
  "employmentStatus": "EMPLOYED"
}
```
**Rules Triggered**:
- `min_income_threshold` (Income < 30000): **FAILED** (Applicant makes $75,000; non-violation)
- `subprime_credit_risk` (Credit < 600): **FAILED** (Applicant has 790; non-violation)
- `borderline_credit_manual_review` (600 <= Score < 750): **FAILED** (Score exceeds borderline)
- `prime_tier1_auto_approval` (Score >= 750 AND Income >= 40000): **PASSED**

**Final Output**:
```json
{
  "decision": "APPROVED",
  "status": "APPROVED",
  "explanation": "Applicant satisfies all Prime Tier 1 automatic approval criteria"
}
```
**Audit Reasoning**:
`[DECISION_GENERATED] The application satisfied all mandatory eligibility conditions and business rules. Score (790 >= 750), Income ($75,000 >= $40,000).`

---

### Example 2: Rejection Due to Subprime Credit Risk
**Input Payload**:
```json
{
  "applicantName": "Marcus Vance",
  "monthlyIncome": 45000,
  "creditScore": 530,
  "loanAmount": 180000,
  "employmentStatus": "EMPLOYED"
}
```
**Rules Triggered**:
- `subprime_credit_risk` (Credit Score < 600): **PASSED** (Rule violation triggered; Fatal Rejection priority 2)

**Final Output**:
```json
{
  "decision": "REJECTED",
  "status": "REJECTED",
  "explanation": "Credit score is below 600 minimum threshold"
}
```
**Audit Reasoning**:
`[RULE_EVALUATED] Rule 'subprime_credit_risk' triggered REJECT action. Score (530) < 600.`

---

### Example 3: Borderline Credit Routed for Manual Review
**Input Payload**:
```json
{
  "applicantName": "David Kim",
  "monthlyIncome": 62000,
  "creditScore": 680,
  "loanAmount": 220000,
  "employmentStatus": "SELF_EMPLOYED"
}
```
**Rules Triggered**:
- `borderline_credit_manual_review` (600 <= Score < 750): **PASSED** (Routes to underwriter manual review)

**Final Output**:
```json
{
  "decision": "MANUAL_REVIEW",
  "status": "MANUAL_REVIEW",
  "explanation": "Credit score is in borderline tier (600 - 749); routed for underwriter manual review"
}
```
**Underwriter Review Action**:
An authorized underwriter approves with comment:
```http
POST /api/workflows/:id/review
Header: x-user-role: admin
Body: { "action": "APPROVE", "comment": "Verified tax documents; approved standard APR." }
```
**Audit Log Update**:
`[MANUAL_REVIEW_SUBMITTED] Status transitioned from MANUAL_REVIEW -> APPROVED by Senior Underwriter.`

---

## 7. REST API Documentation

### 1. Execute Workflow
`POST /api/workflows/execute`
- **Headers**:
  - `Idempotency-Key` (Optional): Unique string (e.g. `UUID`).
  - `x-simulate-failure` (Optional): `true` to simulate third-party 503 outage.
  - `x-simulate-timeout` (Optional): `true` to simulate gateway timeout.
- **Body**:
```json
{
  "workflowType": "LOAN_APPLICATION",
  "inputData": {
    "applicantName": "John Doe",
    "email": "john.doe@example.com",
    "monthlyIncome": 65000,
    "creditScore": 760,
    "loanAmount": 200000,
    "employmentStatus": "EMPLOYED"
  }
}
```
- **Response (`201 Created` or `200 OK` on replay)**:
```json
{
  "success": true,
  "message": "Workflow executed successfully",
  "data": {
    "instance": {
      "requestId": "92cbe234-17c2-45cc-add1-d2dc79b5ec4d",
      "workflowType": "LOAN_APPLICATION",
      "workflowConfigVersion": 1,
      "status": "APPROVED",
      "decision": "APPROVED",
      "currentStage": "COMPLETED"
    },
    "explanation": {
      "decision": "APPROVED",
      "summary": "Applicant satisfies all Prime Tier 1 automatic approval criteria",
      "rulesTriggered": [...]
    }
  }
}
```

### 2. Get Workflow Status & Details
`GET /api/workflows/:id`
Returns instance execution state, input snapshot, rule traces, external bureau outputs, and decision.

### 3. Get Complete Audit Trail
`GET /api/workflows/:id/audit`
Returns the append-only chronological audit log of all events for the given workflow instance.

### 4. Decision Explanation
`GET /api/workflows/:id/explanation`
Returns transparent human-readable justification.

### 5. Manual Underwriter Review
`POST /api/workflows/:id/review`
- **Headers**: `x-user-role: admin`
- **Body**: `{ "action": "APPROVE", "comment": "Income verified via paystubs." }`

### 6. Retry Failed Instance
`POST /api/workflows/:id/retry`
Manually triggers re-execution for an instance currently in `RETRY_PENDING` status.

### 7. Workflow Configurations
- `GET /api/configs`: Lists all versioned configurations.
- `POST /api/configs`: Creates new configuration or increments version (Requires `x-user-role: admin`).
- `POST /api/configs/:id/activate`: Activates a specific configuration version.

### 8. Dashboard Analytics
`GET /api/dashboard/stats`
Returns aggregated live metrics: total requests, decision distribution, retries executed, and recent audit activity.

---

## 8. Demo Scenarios & Edge Cases Covered

1. **Happy Path Prime Approval**: Validates schema, calls external bureau, matches Tier 1 Prime rule $\rightarrow$ `APPROVED`.
2. **Subprime Rejection**: Credit score < 600 $\rightarrow$ `REJECTED`.
3. **Borderline Manual Review**: Credit score between 600-749 $\rightarrow$ `MANUAL_REVIEW`.
4. **External Dependency Failure**: Credit bureau returns 503 $\rightarrow$ transitions to `RETRY_PENDING` with exponential backoff.
5. **Retry Recovery**: Subsequent retry succeeds $\rightarrow$ proceeds to rules evaluation and completes.
6. **Retry Exhaustion**: After exceeding `maxRetries` (3 attempts), escalates to `MANUAL_REVIEW` according to policy.
7. **Idempotency & Concurrent Request Safety**: Identical key returns cached result; altered payload with same key returns `409 Conflict`.
8. **Dynamic Policy Updates Without Code Changes**: Deploying Config $v2$ immediately changes decision logic for new requests while preserving version immutability for past applications.

---

## 9. Evaluation Criteria & Architecture Defense

For detailed architecture diagrams, sequence flows, state machine matrices, and trade-off defense, please consult:
👉 **[Architecture Specification Document](docs/architecture.md)**

