function fail(message, code = 'VALIDATION_ERROR') { throw Object.assign(new Error(message), { code }); }
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || Object.hasOwn(Object.prototype, value)) fail('Invalid content dependency id');
  return value;
}
function identities(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) fail(`${label} must contain unique ids`);
  return result;
}
/** Lock latest content in deterministic dependency-before-parent order without mutating state. */
export function resolveContentGraph(state, rootIds) {
  const roots = identities(rootIds, 'Root ids');
  const content = state?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) fail('Content state must be a map');
  const visited = new Set();
  const stack = [];
  const result = [];
  function visit(id) {
    const cycleIndex = stack.indexOf(id);
    if (cycleIndex !== -1) fail(`Content dependency cycle: ${[...stack.slice(cycleIndex), id].join(' -> ')}`);
    if (visited.has(id)) return;
    const history = Object.hasOwn(content, id) ? content[id] : undefined;
    const revision = Array.isArray(history) ? history.at(-1) : undefined;
    if (!revision || revision.id !== id) fail(`Missing content dependency: ${[...stack, id].join(' -> ')}`, 'NOT_FOUND');
    stack.push(id);
    for (const dependency of identities(revision.dependencies ?? [], `Dependencies for ${id}`)) visit(dependency);
    stack.pop();
    visited.add(id);
    result.push(structuredClone(revision));
  }
  for (const root of roots) visit(root);
  return result;
}
