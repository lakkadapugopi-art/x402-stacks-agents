'use strict';

class ValidationError extends Error {
  constructor(message, path) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    if (path) this.path = path;
  }
}

class PaymentError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

module.exports = { ValidationError, PaymentError };
