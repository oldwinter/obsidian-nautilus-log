import { CandidateError } from "./candidate-object.mjs";

function fail(path, message) {
  throw new CandidateError(`${path}: ${message}`);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function typeMatches(value, type) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function resolveReference(rootSchema, reference, path) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) {
    fail(path, `unsupported schema reference ${String(reference)}`);
  }
  let target = rootSchema;
  for (const segment of reference.slice(2).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!target || typeof target !== "object" || !Object.hasOwn(target, key)) {
      fail(path, `unresolved schema reference ${reference}`);
    }
    target = target[key];
  }
  return target;
}

function isValid(value, schema, rootSchema) {
  try {
    validateNode(value, schema, "$conditional", rootSchema);
    return true;
  } catch (error) {
    if (error instanceof CandidateError) return false;
    throw error;
  }
}

function validateNode(value, schema, path, rootSchema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    fail(path, "schema node must be an object");
  }
  if (schema.$ref !== undefined) {
    validateNode(value, resolveReference(rootSchema, schema.$ref, path), path, rootSchema);
  }
  if (schema.const !== undefined && !sameJson(value, schema.const)) {
    fail(path, `must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined
    && (!Array.isArray(schema.enum) || !schema.enum.some((entry) => sameJson(value, entry)))) {
    fail(path, "must equal one of the declared values");
  }
  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    fail(path, `must be ${schema.type}`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const nested of schema.allOf) validateNode(value, nested, path, rootSchema);
  }
  if (schema.if !== undefined) {
    const branch = isValid(value, schema.if, rootSchema) ? schema.then : schema.else;
    if (branch !== undefined) validateNode(value, branch, path, rootSchema);
  }
  if (schema.not !== undefined && isValid(value, schema.not, rootSchema)) {
    fail(path, "matches a forbidden schema");
  }

  if (schema.type === "object" || schema.properties !== undefined
    || schema.required !== undefined || schema.additionalProperties !== undefined) {
    if (!typeMatches(value, "object")) fail(path, "must be an object");
    const required = schema.required ?? [];
    if (!Array.isArray(required)) fail(path, "schema required must be an array");
    for (const key of required) {
      if (!Object.hasOwn(value, key)) fail(path, `missing required field ${key}`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateNode(value[key], child, `${path}.${key}`, rootSchema);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) fail(path, `unexpected field ${key}`);
      }
    }
  }

  if (schema.type === "array" || schema.items !== undefined || schema.minItems !== undefined
    || schema.maxItems !== undefined || schema.uniqueItems !== undefined) {
    if (!Array.isArray(value)) fail(path, "must be an array");
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, `must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, `must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const identities = value.map((entry) => JSON.stringify(entry));
      if (new Set(identities).size !== identities.length) fail(path, "must contain unique items");
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => validateNode(entry, schema.items, `${path}[${index}]`, rootSchema));
    }
  }

  if (schema.type === "string" || schema.minLength !== undefined || schema.pattern !== undefined) {
    if (typeof value !== "string") fail(path, "must be a string");
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(path, `must contain at least ${schema.minLength} characters`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern, "u")).test(value)) {
      fail(path, `must match ${schema.pattern}`);
    }
  }
  if ((schema.type === "integer" || schema.type === "number")
    && schema.minimum !== undefined && value < schema.minimum) {
    fail(path, `must be at least ${schema.minimum}`);
  }
  if ((schema.type === "integer" || schema.type === "number")
    && schema.maximum !== undefined && value > schema.maximum) {
    fail(path, `must be at most ${schema.maximum}`);
  }
}

export function validateJsonAgainstSchema(value, schema, label = "document") {
  validateNode(value, schema, label, schema);
  return value;
}
