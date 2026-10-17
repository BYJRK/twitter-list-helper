import { OPERATIONS, type Operation, type OperationName } from './core';

interface XRuntime {
  (id: string): any;
  m: Record<string, (...args: any[]) => unknown>;
}
let runtime: XRuntime | undefined;
/** Obtain X's already-loaded webpack runtime; no remote code is loaded or evaluated. */
function getRuntime(): XRuntime | undefined {
  if (runtime) return runtime;
  const scope = window as unknown as Record<string, unknown>;
  const key = Object.keys(scope).find(name => name.startsWith('webpackChunk') && Array.isArray(scope[name]));
  if (!key) return undefined;
  const chunks = scope[key] as any[];
  chunks.push([[`xlh-${crypto.randomUUID()}`], {}, (require: XRuntime) => { if (require.m) runtime = require; }]);
  return runtime;
}
function exportedObjects(exports: any): any[] {
  if (!exports || (typeof exports !== 'object' && typeof exports !== 'function')) return [];
  const result = [exports];
  for (const key of Object.keys(exports)) { try { result.push(exports[key]); } catch { /* Lazy export unavailable. */ } }
  return result;
}
export function nativeOperations(): Map<OperationName, Operation> {
  const result = new Map<OperationName, Operation>();
  try {
    const require = getRuntime();
    if (!require) return result;
    for (const [id, factory] of Object.entries(require.m)) {
      const source = Function.prototype.toString.call(factory);
      if (!OPERATIONS.some(name => source.includes(`operationName:"${name}"`) || source.includes(`operationName:'${name}'`))) continue;
      for (const value of exportedObjects(require(id))) {
        if (!value || !OPERATIONS.includes(value.operationName) || typeof value.queryId !== 'string') continue;
        const features: Record<string, boolean> = {};
        const requiredFeatures: string[] = [];
        for (const flag of value.metadata?.featureSwitches ?? []) {
          if (typeof flag === 'string') requiredFeatures.push(flag);
          else if (flag && typeof flag.name === 'string') {
            requiredFeatures.push(flag.name);
            if (typeof flag.value === 'boolean') features[flag.name] = flag.value;
          }
        }
        const fieldToggles: Record<string, boolean> = {};
        // A field name in metadata is a capability, not a true/false setting.
        for (const flag of value.metadata?.fieldToggles ?? []) if (flag && typeof flag.name === 'string' && typeof flag.value === 'boolean') fieldToggles[flag.name] = flag.value;
        result.set(value.operationName, { id: value.queryId, features, requiredFeatures, fieldToggles, source: 'bundle' });
      }
    }
  } catch { /* The page may use a different module loader after an X update. */ }
  return result;
}
let transaction: ((host: string, path: string, method: string) => Promise<string>) | undefined;
export async function transactionId(path: string, method: string): Promise<string | undefined> {
  try {
    const require = getRuntime();
    if (!require) return undefined;
    if (!transaction) {
      for (const [id, factory] of Object.entries(require.m)) {
        if (!Function.prototype.toString.call(factory).includes('x-client-transaction-id')) continue;
        const exports = require(id);
        // Observed X web export: kc(host, path, method). Never reuse captured IDs for a new path.
        if (typeof exports?.kc === 'function' && exports.kc.length === 3) { transaction = exports.kc; break; }
      }
    }
    if (!transaction) return undefined;
    const value = await transaction(location.host, path, method);
    return typeof value === 'string' && value.length < 1024 && !value.startsWith('e:') ? value : undefined;
  } catch { return undefined; }
}
