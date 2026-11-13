import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Generic Validation Engine
 * Validates arbitrary input data against JSON Schema-like definition stored in WorkflowConfig
 */
export class ValidationEngine {
  /**
   * Validates data against the configurable inputSchema
   * @param {Object} inputSchema - Schema definition from WorkflowConfig
   * @param {Object} data - Payload data submitted by caller
   * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }> }}
   */
  static validate(inputSchema, data) {
    const errors = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        isValid: false,
        errors: [{ field: 'root', message: 'Input data must be a valid JSON object' }]
      };
    }

    if (!inputSchema || !inputSchema.properties) {
      // If no schema defined, accept payload
      return { isValid: true, errors: [] };
    }

    const { required = [], properties = {} } = inputSchema;

    // 1. Required field checks
    for (const field of required) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        errors.push({
          field,
          message: `Missing required field: '${field}'`,
          code: 'REQUIRED_FIELD_MISSING'
        });
      }
    }

    // 2. Field-level type and constraint checks
    for (const [fieldName, spec] of Object.entries(properties)) {
      const val = data[fieldName];
      if (val === undefined || val === null) {
        continue; // handled by required check if mandatory
      }

      const expectedType = (spec.type || 'string').toLowerCase();

      switch (expectedType) {
        case 'string':
          if (typeof val !== 'string') {
            errors.push({ field: fieldName, message: `'${fieldName}' must be a string`, code: 'INVALID_TYPE' });
          } else {
            if (spec.format === 'email') {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(val)) {
                errors.push({ field: fieldName, message: `'${fieldName}' must be a valid email address`, code: 'INVALID_FORMAT' });
              }
            }
            if (spec.minLength !== undefined && val.length < spec.minLength) {
              errors.push({ field: fieldName, message: `'${fieldName}' length must be >= ${spec.minLength}`, code: 'MIN_LENGTH' });
            }
            if (spec.maxLength !== undefined && val.length > spec.maxLength) {
              errors.push({ field: fieldName, message: `'${fieldName}' length must be <= ${spec.maxLength}`, code: 'MAX_LENGTH' });
            }
            if (spec.enum && !spec.enum.includes(val)) {
              errors.push({ field: fieldName, message: `'${fieldName}' must be one of [${spec.enum.join(', ')}]`, code: 'INVALID_ENUM' });
            }
          }
          break;

        case 'number':
        case 'integer':
          if (typeof val !== 'number' || isNaN(val)) {
            errors.push({ field: fieldName, message: `'${fieldName}' must be a number`, code: 'INVALID_TYPE' });
          } else {
            if (expectedType === 'integer' && !Number.isInteger(val)) {
              errors.push({ field: fieldName, message: `'${fieldName}' must be an integer`, code: 'INVALID_INTEGER' });
            }
            const min = spec.minimum !== undefined ? spec.minimum : spec.min;
            const max = spec.maximum !== undefined ? spec.maximum : spec.max;
            if (min !== undefined && val < min) {
              errors.push({ field: fieldName, message: `'${fieldName}' must be >= ${min}`, code: 'MIN_VALUE' });
            }
            if (max !== undefined && val > max) {
              errors.push({ field: fieldName, message: `'${fieldName}' must be <= ${max}`, code: 'MAX_VALUE' });
            }
          }
          break;

        case 'boolean':
          if (typeof val !== 'boolean') {
            errors.push({ field: fieldName, message: `'${fieldName}' must be a boolean`, code: 'INVALID_TYPE' });
          }
          break;

        case 'array':
          if (!Array.isArray(val)) {
            errors.push({ field: fieldName, message: `'${fieldName}' must be an array`, code: 'INVALID_TYPE' });
          }
          break;

        default:
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Helper that throws ValidationError if invalid
   */
  static assertValid(inputSchema, data) {
    const result = this.validate(inputSchema, data);
    if (!result.isValid) {
      throw new ValidationError(
        `Input validation failed: ${result.errors.map(e => e.message).join('; ')}`,
        result.errors
      );
    }
    return true;
  }
}

