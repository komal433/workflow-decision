import { describe, it, before, after, expect } from './testHelper.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { IdempotencyRecord } from '../src/models/IdempotencyRecord.js';
import { IdempotencyService } from '../src/services/idempotencyService.js';
import { IdempotencyConflictError } from '../src/utils/errors.js';

describe('Idempotency Reliability & Concurrency Guard', () => {
  before(async () => {
    await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform');
    await IdempotencyRecord.deleteMany({});
  });

  after(async () => {
    await disconnectDB();
  });

  it('reserves a new idempotency key atomically', async () => {
    const key = 'IDEM-TEST-001';
    const payload = { amount: 50000 };
    const reservation = await IdempotencyService.reserveKey(key, 'LOAN_APPLICATION', payload);

    expect(reservation.isReplay).toBe(false);
    expect(reservation.record.status).toBe('IN_PROGRESS');

    // Complete key
    await IdempotencyService.completeKey(key, null, { decision: 'APPROVED' });
  });

  it('replays cached response for duplicate request with same key and payload', async () => {
    const key = 'IDEM-TEST-001';
    const payload = { amount: 50000 };
    const reservation = await IdempotencyService.reserveKey(key, 'LOAN_APPLICATION', payload);

    expect(reservation.isReplay).toBe(true);
    expect(reservation.cachedResponse.decision).toBe('APPROVED');
  });

  it('rejects with IdempotencyConflictError when same key has different payload', async () => {
    const key = 'IDEM-TEST-001';
    const differentPayload = { amount: 999999 }; // altered payload

    let errorCaught = null;
    try {
      await IdempotencyService.reserveKey(key, 'LOAN_APPLICATION', differentPayload);
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught instanceof IdempotencyConflictError).toBe(true);
    expect(errorCaught.message).toContain('different request payload');
  });

  it('prevents concurrent execution when key is currently IN_PROGRESS', async () => {
    const concurrentKey = 'IDEM-CONCURRENT-002';
    const payload = { test: 'race-condition' };

    // Thread 1 reserves key
    const t1 = await IdempotencyService.reserveKey(concurrentKey, 'LOAN_APPLICATION', payload);
    expect(t1.isReplay).toBe(false);

    // Thread 2 attempts to reserve same key concurrently while IN_PROGRESS
    let errorCaught = null;
    try {
      await IdempotencyService.reserveKey(concurrentKey, 'LOAN_APPLICATION', payload);
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught instanceof IdempotencyConflictError).toBe(true);
    expect(errorCaught.message).toContain('currently being processed');

    // Clean up
    await IdempotencyService.completeKey(concurrentKey, null, { done: true });
  });
});

