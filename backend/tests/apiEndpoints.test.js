import { describe, it, before, after, expect } from './testHelper.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { WorkflowConfig } from '../src/models/WorkflowConfig.js';
import { loanApprovalConfig } from '../src/seeds/seed.js';

describe('REST API Layer & Controller Endpoints', () => {
  let app;

  before(async () => {
    await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform');
    app = createApp();
    await WorkflowConfig.deleteMany({ workflowType: 'LOAN_APPLICATION' });
    await WorkflowConfig.create(loanApprovalConfig);
  });

  after(async () => {
    await disconnectDB();
  });

  it('GET /api/health returns UP status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });

  it('POST /api/workflows/execute validates required payload and rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/workflows/execute')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/workflows/execute processes loan application and returns decision + explanation', async () => {
    const payload = {
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'API Applicant',
        email: 'api@example.com',
        monthlyIncome: 65000,
        creditScore: 780,
        loanAmount: 200000,
        employmentStatus: 'EMPLOYED'
      }
    };

    const res = await request(app)
      .post('/api/workflows/execute')
      .set('Idempotency-Key', 'API-IDEM-001')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.instance.decision).toBe('APPROVED');
    expect(res.body.data.explanation.decision).toBe('APPROVED');

    // Duplicate submission with same Idempotency-Key returns 200 and cached response
    const duplicateRes = await request(app)
      .post('/api/workflows/execute')
      .set('Idempotency-Key', 'API-IDEM-001')
      .send(payload);

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.headers['x-cache-lookup']).toBe('HIT');
    expect(duplicateRes.body.data.instance.requestId).toBe(res.body.data.instance.requestId);
  });

  it('GET /api/workflows/:id returns instance details and audit trail', async () => {
    // 1. Submit an application
    const execRes = await request(app)
      .post('/api/workflows/execute')
      .send({
        workflowType: 'LOAN_APPLICATION',
        inputData: {
          applicantName: 'Audit Test',
          email: 'audit@example.com',
          monthlyIncome: 45000,
          creditScore: 680,
          loanAmount: 150000,
          employmentStatus: 'EMPLOYED'
        }
      });

    const instanceId = execRes.body.data.instance._id;

    // 2. Query status
    const getRes = await request(app).get(`/api/workflows/${instanceId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.instance.status).toBe('MANUAL_REVIEW');

    // 3. Query audit trail
    const auditRes = await request(app).get(`/api/workflows/${instanceId}/audit`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.auditTrail.length).toBeGreaterThan(0);

    // 4. Query explanation
    const expRes = await request(app).get(`/api/workflows/${instanceId}/explanation`);
    expect(expRes.status).toBe(200);
    expect(expRes.body.data.decision).toBe('MANUAL_REVIEW');
  });

  it('POST /api/workflows/:id/review enforces ADMIN authorization', async () => {
    // Submit an application that routes to MANUAL_REVIEW
    const execRes = await request(app)
      .post('/api/workflows/execute')
      .send({
        workflowType: 'LOAN_APPLICATION',
        inputData: {
          applicantName: 'Review User',
          email: 'review@example.com',
          monthlyIncome: 55000,
          creditScore: 680,
          loanAmount: 100000,
          employmentStatus: 'EMPLOYED'
        }
      });
    const instanceId = execRes.body.data.instance._id;

    // 1. Unauthorized attempt (without role header or user role)
    const unauthorizedRes = await request(app)
      .post(`/api/workflows/${instanceId}/review`)
      .send({ action: 'APPROVE', comment: 'Looks acceptable' });

    expect(unauthorizedRes.status).toBe(403);
    expect(unauthorizedRes.body.error.code).toBe('FORBIDDEN');

    // 2. Authorized attempt with x-user-role: admin
    const authorizedRes = await request(app)
      .post(`/api/workflows/${instanceId}/review`)
      .set('x-user-role', 'admin')
      .send({ action: 'APPROVE', comment: 'Verified income documents; approved manually.' });

    expect(authorizedRes.status).toBe(200);
    expect(authorizedRes.body.data.instance.status).toBe('APPROVED');
    expect(authorizedRes.body.data.instance.decision).toBe('APPROVED');
    expect(authorizedRes.body.data.instance.manualReview.action).toBe('APPROVE');
  });

  it('GET /api/dashboard/stats returns real aggregated statistics', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.totalRequests).toBeGreaterThan(0);
    expect(res.body.data.decisionDistribution.length).toBeGreaterThan(0);
  });

  it('GET /api/configs and POST /api/configs manage configurations with versioning', async () => {
    const listRes = await request(app).get('/api/configs');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);

    // Create new version with admin role
    const createRes = await request(app)
      .post('/api/configs')
      .set('x-user-role', 'admin')
      .send({
        name: 'Auto Loan Express Config',
        workflowType: 'LOAN_APPLICATION',
        rules: []
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.version).toBeGreaterThan(1);
  });
});

