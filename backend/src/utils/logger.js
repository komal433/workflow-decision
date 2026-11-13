/**
 * Structured Logger for the Workflow Decision Platform
 */
const LOG_LEVELS = {
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4
};

const CURRENT_LEVEL = process.env.LOG_LEVEL || 'INFO';

function formatMessage(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  });
}

export const logger = {
  debug(message, meta) {
    if (LOG_LEVELS[CURRENT_LEVEL] <= LOG_LEVELS.DEBUG) {
      console.debug(formatMessage('DEBUG', message, meta));
    }
  },
  info(message, meta) {
    if (LOG_LEVELS[CURRENT_LEVEL] <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', message, meta));
    }
  },
  warn(message, meta) {
    if (LOG_LEVELS[CURRENT_LEVEL] <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, meta));
    }
  },
  error(message, meta) {
    if (LOG_LEVELS[CURRENT_LEVEL] <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', message, meta));
    }
  }
};

