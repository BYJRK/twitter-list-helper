import { apiErrorDetails, directoryIncomplete, walk, type JsonObject } from './core';
export interface RequestDiagnostic {
  operation: string;
  source: string;
  queryId: string;
  method: string;
  stage?: 'prepare' | 'request';
  variables: Record<string, string | number | boolean>;
  features: Record<string, boolean>;
  fieldToggles: Record<string, boolean>;
  result?: { httpStatus: number; hasData: boolean; error: string; errorPaths: (string | number)[][]; directory?: { timelineCount: number; recordCount: number; validOwned: number; otherOwners: number; missingOwner: number; incomplete?: boolean } };
}
function booleans(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => /^[\w]{1,150}$/.test(key) && typeof entry === 'boolean')) as Record<string, boolean>;
}
export function requestDiagnostic(operation: string, id: string, source: string, payload: JsonObject, method: string): RequestDiagnostic {
  const variables: RequestDiagnostic['variables'] = {};
  for (const [key, value] of Object.entries(payload.variables ?? {})) {
    if (!/^[\w]{1,80}$/.test(key)) continue;
    variables[key] = key === 'count' && typeof value === 'number' ? value : typeof value === 'boolean' ? value : `[${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}]`;
  }
  return { operation, queryId: /^[\w-]{1,100}$/.test(id) ? id : '[invalid]', source, method, variables, features: booleans(payload.features), fieldToggles: booleans(payload.fieldToggles) };
}
export function responseDiagnostic(status: number, data: JsonObject, accountId?: string): RequestDiagnostic['result'] {
  const knownFields = new Set(['data', 'viewer', 'user', 'result', 'timeline', 'lists_management_timeline', 'list_management_timeline', 'instructions', 'entries', 'entry', 'content', 'items', 'item', 'itemContent', 'list', 'list_results', 'user_results', 'core', 'legacy', 'name', 'screen_name', 'rest_id', 'id_str', 'mode', 'description', 'member_count', 'subscriber_count', 'banner', 'image', 'avatar', 'tweets', 'tweet_results', 'cursor', 'value']);
  const errorPaths = Array.isArray(data?.errors) ? data.errors.slice(0, 10).map(error => Array.isArray(error?.path) ? error.path.map((part: unknown) => typeof part === 'number' ? part : typeof part === 'string' && knownFields.has(part) ? part : '[field]') : []) : [];
  const directory = { timelineCount: 0, recordCount: 0, validOwned: 0, otherOwners: 0, missingOwner: 0 };
  walk(data?.data, node => {
    if (Array.isArray(node.instructions)) directory.timelineCount++;
    const raw = node.list_results?.result ?? node.list;
    if (!raw || typeof raw !== 'object') return;
    directory.recordCount++;
    const owner = raw.user_results?.result?.rest_id ?? raw.user?.rest_id ?? raw.user?.id_str;
    if (!owner) directory.missingOwner++;
    else if (accountId && owner === accountId && typeof (raw.name ?? raw.legacy?.name) === 'string' && typeof (raw.id_str ?? raw.rest_id) === 'string') directory.validOwned++;
    else directory.otherOwners++;
  });
  return { httpStatus: status, hasData: !!data?.data || Array.isArray(data?.lists), error: apiErrorDetails(data ?? {}), errorPaths, ...(directory.timelineCount ? { directory: { ...directory, ...(accountId ? { incomplete: directoryIncomplete(data, accountId) } : {}) } } : {}) };
}
