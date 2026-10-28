'use strict';

const { ValidationError } = require('./errors');

function assertObject(value, path = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Expected an object', path);
  return value;
}

function requiredString(value, path, options = {}) {
  const { minLength = 1, maxLength = 4096 } = options;
  if (typeof value !== 'string') throw new ValidationError('Expected a string', path);
  if (value.length < minLength || value.length > maxLength) {
    throw new ValidationError(`Length must be between ${minLength} and ${maxLength}`, path);
  }
  return value;
}

function atomicAmount(value, path = 'amount') {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new ValidationError('Amount must be a non-negative safe integer or decimal string', path);
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new ValidationError('Amount must be a decimal string, bigint, or safe integer', path);
  }
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new ValidationError('Amount must use canonical atomic-unit decimal notation', path);
  if (BigInt(text) <= 0n) throw new ValidationError('Amount must be greater than zero', path);
  return text;
}

function boundedInteger(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(`Expected an integer between ${minimum} and ${maximum}`, path);
  }
  return value;
}

function httpUrl(value, path, allowX402 = false) {
  requiredString(value, path, { maxLength: 2048 });
  let parsed;
  try { parsed = new URL(value); } catch { throw new ValidationError('Expected an absolute URL', path); }
  const protocols = allowX402 ? ['http:', 'https:', 'x402:'] : ['http:', 'https:'];
  if (!protocols.includes(parsed.protocol)) throw new ValidationError(`Protocol must be ${protocols.join(' or ')}`, path);
  if (parsed.username || parsed.password) throw new ValidationError('Credentials are not allowed in URLs', path);
  return value;
}

function validateSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    assertObject(value, path);
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) throw new ValidationError('Required property is missing', `${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) throw new ValidationError('Unknown property', `${path}.${key}`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateSchema(value[key], child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new ValidationError('Expected an array', path);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new ValidationError(`Expected at least ${schema.minItems} items`, path);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new ValidationError(`Expected at most ${schema.maxItems} items`, path);
    value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'string') {
    requiredString(value, path, { minLength: schema.minLength || 0, maxLength: schema.maxLength || 1000000 });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new ValidationError(`Must match ${schema.pattern}`, path);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new ValidationError('Expected an integer', path);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError('Expected a finite number', path);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new ValidationError('Expected a boolean', path);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new ValidationError(`Expected one of ${schema.enum.join(', ')}`, path);
  if (schema.minimum !== undefined && value < schema.minimum) throw new ValidationError(`Must be at least ${schema.minimum}`, path);
  if (schema.maximum !== undefined && value > schema.maximum) throw new ValidationError(`Must be at most ${schema.maximum}`, path);
}

module.exports = { assertObject, requiredString, atomicAmount, boundedInteger, httpUrl, validateSchema };
