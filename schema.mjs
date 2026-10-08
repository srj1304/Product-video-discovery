export function assertSchema(value, schema, path = '$') {
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(actual)) throw new Error(`Schema validation failed at ${path}: expected ${types.join('|')}, got ${actual}`);
  if (value == null) return true;
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Schema validation failed at ${path}: invalid enum value`);
  if (actual === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) throw new Error(`Schema validation failed at ${path}.${key}: required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) assertSchema(value[key], childSchema, `${path}.${key}`);
    }
  }
  if (actual === 'array') {
    for (let i = 0; i < value.length; i += 1) assertSchema(value[i], schema.items || {}, `${path}[${i}]`);
  }
  return true;
}
