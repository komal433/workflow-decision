import { describe, it, expect } from './testHelper.js';
import { WorkflowEngine, DEFAULT_TRANSITIONS } from '../src/engines/workflowEngine.js';
import { TransitionError } from '../src/utils/errors.js';

describe('Workflow State Machine Transitions', () => {
  it('allows valid state progression: RECEIVED -> VALIDATING', () => {
    expect(() => {
      WorkflowEngine.validateTransition('RECEIVED', 'VALIDATING', DEFAULT_TRANSITIONS);
    }).not?.toThrow();
  });

  it('allows valid progression: VALIDATING -> EVALUATING_RULES', () => {
    expect(() => {
      WorkflowEngine.validateTransition('VALIDATING', 'EVALUATING_RULES', DEFAULT_TRANSITIONS);
    }).not?.toThrow();
  });

  it('allows valid progression: EVALUATING_RULES -> APPROVED', () => {
    expect(() => {
      WorkflowEngine.validateTransition('EVALUATING_RULES', 'APPROVED', DEFAULT_TRANSITIONS);
    }).not?.toThrow();
  });

  it('rejects invalid state jump from RECEIVED directly to APPROVED', () => {
    expect(() => {
      WorkflowEngine.validateTransition('RECEIVED', 'APPROVED', DEFAULT_TRANSITIONS);
    }).toThrow(TransitionError);
  });

  it('rejects invalid transition out of terminal state: APPROVED -> EVALUATING_RULES', () => {
    expect(() => {
      WorkflowEngine.validateTransition('APPROVED', 'EVALUATING_RULES', DEFAULT_TRANSITIONS);
    }).toThrow(TransitionError);
  });

  it('rejects invalid transition out of terminal state: REJECTED -> APPROVED', () => {
    expect(() => {
      WorkflowEngine.validateTransition('REJECTED', 'APPROVED', DEFAULT_TRANSITIONS);
    }).toThrow(TransitionError);
  });
});

