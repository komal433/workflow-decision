import crypto from 'node:crypto';
import { IdempotencyRecord } from '../models/IdempotencyRecord.js';
import { IdempotencyConflictError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Idempotency Service
 * Provides transactional reservation, hash integrity checking,
 * concurrent execution blocking, and replay caching.
 */
export class IdempotencyService {
  /**
   * Generates a deterministic SHA-256 hash of the request payload and workflow type
   */
  static generateHash(workflowType, payload) {
    const serialized = JSON.stringify({
      workflowType: (workflowType || '').toUpperCase(),
      data: payload || {}
    });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Attempts to reserve an Idempotency-Key for execution
   * @param {string} key - Idempotency-Key
   * @param {string} workflowType
   * @param {Object} payload
   * @returns {Promise<{ isReplay: boolean, existingRecord: Object|null }>}
   */
  static async reserveKey(key, workflowType, payload) {
    if (!key) {
      return { isReplay: false, existingRecord: null };
    }

    const requestHash = this.generateHash(workflowType, payload);

    try {
      // Try to create an IN_PROGRESS idempotency record atomically
      const record = new IdempotencyRecord({
        key,
        requestHash,
        status: 'IN_PROGRESS'
      });
      await record.save();
      return { isReplay: false, record };
    } catch (err) {
      // Duplicate key error (E11000)
      if (err.code === 11000 || err.name === 'MongoServerError') {
        const existing = await IdempotencyRecord.findOne({ key });
        if (!existing) {
          throw new IdempotencyConflictError('Idempotency collision detected; please retry.');
        }

        // Verify request payload hash integrity
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError(
            `Idempotency-Key '${key}' was previously used with a different request payload. Reusing keys across different payloads is forbidden.`
          );
        }

        // If still in progress, prevent concurrent race condition
        if (existing.status === 'IN_PROGRESS') {
          throw new IdempotencyConflictError(
            `A request with Idempotency-Key '${key}' is currently being processed. Please wait for completion.`
          );
        }

        // Request has completed; return cached result for replay
        logger.info(`Replaying cached response for idempotency key: ${key}`);
        return {
          isReplay: true,
          cachedResponse: existing.responseData,
          workflowInstanceId: existing.workflowInstanceId
        };
      }
      throw err;
    }
  }

  /**
   * Marks idempotency record as COMPLETED and stores response
   */
  static async completeKey(key, workflowInstanceId, responseData) {
    if (!key) return;
    try {
      await IdempotencyRecord.updateOne(
        { key },
        {
          status: 'COMPLETED',
          workflowInstanceId,
          responseData
        }
      );
    } catch (err) {
      logger.error('Failed to update idempotency record to COMPLETED', { key, error: err.message });
    }
  }

  /**
   * Marks idempotency record as FAILED on unexpected unrecoverable errors
   */
  static async failKey(key, errorDetails) {
    if (!key) return;
    try {
      await IdempotencyRecord.updateOne(
        { key },
        {
          status: 'FAILED',
          responseData: { error: errorDetails }
        }
      );
    } catch (err) {
      logger.error('Failed to mark idempotency record as FAILED', { key, error: err.message });
    }
  }
}

