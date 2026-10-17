import type { ListItem } from './types';

export type JsonObject = Record<string, any>;
export function walk(value: unknown, visit: (node: JsonObject) => void): void {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) visit(value as JsonObject);
  for (const child of Object.values(value)) walk(child, visit);
}

const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'help', 'jobs', 'communities']);
export function profileName(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const name = parts[0];
  if (!name || !/^[a-zA-Z0-9_]{1,15}$/.test(name) || RESERVED.has(name.toLowerCase())) return null;
  if (parts.length > 2 || (parts[1] && !['with_replies', 'media', 'highlights', 'articles'].includes(parts[1]))) return null;
  return name;
}

export function parseUser(data: unknown, screenName: string): string {
  let id = '';
  walk(data, node => {
    const handle = node.core?.screen_name ?? node.legacy?.screen_name;
    if (typeof handle === 'string' && handle.toLowerCase() === screenName.toLowerCase() && /^\d+$/.test(node.rest_id)) id = node.rest_id;
  });
  if (!id) throw new Error('无法识别当前用户，账号可能不可用，或 X 返回格式已变化。');
  return id;
}

/** Only list nodes inside a recognized timeline are accepted; missing membership stays unknown. */
export function parseLists(data: JsonObject, accountId: string, mode: 'owned' | 'management' = 'owned', partial = false): { lists: ListItem[]; cursor?: string } {
  let instructions = data.data?.user?.result?.timeline?.timeline?.instructions
    ?? data.data?.user?.result?.timeline?.instructions;
  if (mode === 'management') {
    // Management responses include both subscribed and owned-list modules. Locate the timeline,
    // then require the owner's exact ID for every list we expose for editing.
    const candidates: unknown[][] = [];
    walk(data.data, node => { if (Array.isArray(node.instructions)) candidates.push(node.instructions); });
    if (candidates.length !== 1) throw new Error('列表管理响应没有唯一的列表时间线，未读取不确定的数据。');
    instructions = candidates[0];
  }
  if (!Array.isArray(instructions)) throw new Error('X 列表响应格式未识别，未将其当作空列表。请打开原生列表窗口后重试。');
  const lists = new Map<string, ListItem>();
  let cursor: string | undefined;
  let terminated = false;
  walk(instructions, node => {
    if (node.type === 'TimelineTerminateTimeline' && node.direction === 'Bottom') terminated = true;
    if (node.cursorType === 'Bottom' && typeof node.value === 'string') cursor = node.value;
    const raw = node.list_results?.result ?? node.list;
    if (!raw || typeof raw !== 'object') return;
    const id = raw.id_str ?? raw.rest_id;
    const name = raw.name ?? raw.legacy?.name;
    if (typeof id !== 'string' || !/^\d+$/.test(id) || typeof name !== 'string') return;
    const owner = raw.user_results?.result?.rest_id ?? raw.user?.rest_id ?? raw.user?.id_str;
    if (mode === 'management' && !owner) {
      if (partial) return;
      throw new Error('列表管理响应缺少列表所有者信息，无法安全筛选自己的列表。');
    }
    if (owner && owner !== accountId) return;
    const membership = raw.is_member ?? raw.legacy?.is_member;
    lists.set(id, { id, name, member: typeof membership === 'boolean' ? membership : null, private: (raw.mode ?? raw.legacy?.mode) === 'Private' || (raw.mode ?? raw.legacy?.mode) === 'private' });
  });
  return { lists: [...lists.values()], cursor: terminated ? undefined : cursor };
}

export async function collectLists(fetchPage: (cursor?: string) => Promise<JsonObject>, accountId: string, mode: 'owned' | 'management' = 'owned'): Promise<ListItem[]> {
  const lists = new Map<string, ListItem>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const data = await fetchPage(cursor);
    const partial = mode === 'management' && isPartialDirectory(data);
    if (partial) checkDirectoryResponse(200, data, accountId);
    const parsed = parseLists(data, accountId, mode, partial);
    for (const list of parsed.lists) lists.set(list.id, list);
    if (!parsed.cursor) return [...lists.values()];
    if (seen.has(parsed.cursor)) throw new Error('X 返回重复分页游标，列表读取不完整，请刷新重试。');
    seen.add(parsed.cursor);
    cursor = parsed.cursor;
  }
  throw new Error('列表分页过多，未展示不完整的结果。');
}

export interface Operation { id: string; features?: Record<string, boolean>; requiredFeatures?: string[]; fieldToggles?: JsonObject; variables?: JsonObject; source: 'bundle' | 'request' }
export const OPERATIONS = ['UserByScreenName', 'ListsManagementPageTimeline', 'ListAddMember', 'ListRemoveMember'] as const;
export type OperationName = typeof OPERATIONS[number];
export function extractOperations(source: string): Map<OperationName, Operation> {
  const found = new Map<OperationName, Operation>();
  const expression = /queryId:\s*["']([\w-]+)["']\s*,\s*operationName:\s*["'](\w+)["']/g;
  for (const match of source.matchAll(expression)) {
    const name = match[2] as OperationName;
    if (!OPERATIONS.includes(name) || !match[1]) continue;
    const tail = source.slice(match.index! + match[0].length, match.index! + match[0].length + 5000).split('queryId:')[0] ?? '';
    const requiredFeatures: string[] = [];
    const featureMatch = /featureSwitches:\s*\[([^\]]*)\]/.exec(tail);
    for (const flag of featureMatch?.[1]?.matchAll(/["']([\w]+)["']/g) ?? []) if (flag[1]) requiredFeatures.push(flag[1]);
    found.set(name, { id: match[1], requiredFeatures, source: 'bundle' });
  }
  return found;
}

export function operationFeatures(operation: Operation | undefined, observed: Record<string, boolean>, initialState: unknown, defaults: Record<string, boolean>): Record<string, boolean> {
  if (operation?.source === 'request' && operation.features) return { ...operation.features };
  const state = initialState as JsonObject | undefined;
  const switchState = state?.featureSwitch;
  const values: Record<string, boolean> = {};
  // User configuration overrides the defaults. Only actual boolean values are accepted.
  for (const config of [switchState?.defaultConfig, switchState?.user?.config, switchState?.user?.userConfig, switchState?.user?.userConfig?.config]) {
    if (!config || typeof config !== 'object') continue;
    for (const [name, entry] of Object.entries(config)) {
      const value = typeof entry === 'boolean' ? entry : (entry as JsonObject | null)?.value;
      if (typeof value === 'boolean') values[name] = value;
    }
  }
  const known = { ...defaults, ...operation?.features, ...values, ...observed };
  const required = operation?.requiredFeatures;
  if (!required) return known;
  const missing = required.filter(name => typeof known[name] !== 'boolean');
  if (missing.length) throw new Error(`尚未获取接口的真实功能开关（${missing.slice(0, 4).join(', ')}）。请稍后重试；若持续失败，请复制错误详情。`);
  return Object.fromEntries(required.map(name => [name, known[name]!])) as Record<string, boolean>;
}

export function apiErrorDetails(data: JsonObject): string {
  const messages = Array.isArray(data.errors) ? data.errors.slice(0, 3).map(error => {
    const code = error?.code ?? error?.extensions?.code;
    const message = typeof error?.message === 'string' ? error.message : 'Unknown GraphQL error';
    // Retain parameter/feature names, but strip credentials, URLs and long token-like strings.
    const safe = message.replace(/https?:\/\/\S+/g, '[URL]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(?:authorization|auth_token|ct0|cookie)\s*[:=]\s*[^\s,;]+/gi, '[redacted]').replace(/[A-Za-z0-9_%=-]{48,}/g, '[redacted]').slice(0, 400);
    const safeCode = typeof code === 'number' || (typeof code === 'string' && /^[\w-]{1,40}$/.test(code)) ? ` [${code}]` : '';
    return safe + safeCode;
  }) : [];
  return messages.join('；');
}
export function checkApiResponse(status: number, data: JsonObject, graphql = true): void {
  if (status === 429) throw new Error('X 请求频率受限，请稍后再刷新。');
  if (status === 401 || status === 403) throw new Error('X 拒绝了请求，请确认登录状态；也可能需要更新网页接口适配。');
  if (status < 200 || status >= 300) throw new Error(`X 请求失败（HTTP ${status}），请打开原生列表窗口后刷新重试。`);
  if (Array.isArray(data.errors) && data.errors.length) throw new Error(`X 接口错误（HTTP ${status}）：${apiErrorDetails(data)}`);
  if (graphql && (!data.data || typeof data.data !== 'object')) throw new Error('X 未返回有效数据，操作未确认成功。');
}

export function isPartialDirectory(data: JsonObject): boolean {
  return !!data.data && Array.isArray(data.errors) && data.errors.length > 0 && data.errors.every(error => (error?.code ?? error?.extensions?.code) === 214 && typeof error.message === 'string' && error.message.includes('DecodeException'));
}
/** A directory error matters only when it can hide a record, its identity/owner, or pagination.
 * Unknown paths remain warnings. Nonessential fields are ignored only on a validated list. */
export function directoryIncomplete(data: JsonObject, accountId: string): boolean {
  if (!Array.isArray(data.errors) || !data.errors.length) return false;
  if (!isPartialDirectory(data)) return true;
  try { if (!parseLists(data, accountId, 'management', true).lists.length) return true; }
  catch { return true; }
  const valid = (raw: JsonObject | null | undefined): boolean => {
    const id = raw?.id_str ?? raw?.rest_id;
    const owner = raw?.user_results?.result?.rest_id ?? raw?.user?.rest_id ?? raw?.user?.id_str;
    return typeof id === 'string' && /^\d+$/.test(id) && typeof (raw?.name ?? raw?.legacy?.name) === 'string' && typeof owner === 'string' && /^\d+$/.test(owner);
  };
  let invalidRecord = false;
  walk(data.data, node => {
    if (!Object.hasOwn(node, 'list') && !Object.hasOwn(node, 'list_results')) return;
    if (!valid(node.list_results?.result ?? node.list)) invalidRecord = true;
  });
  if (invalidRecord) return true;
  return data.errors.some(error => {
    const path: unknown[] = error?.path;
    if (!Array.isArray(path) || !path.includes('instructions') || !path.includes('entries')) return true;
    const normalized = path[0] === 'data' ? path.slice(1) : path;
    let node: unknown = data.data;
    for (let i = 0; i < normalized.length; i++) {
      const key = normalized[i];
      if ((typeof key !== 'string' && typeof key !== 'number') || !node || typeof node !== 'object' || !Object.hasOwn(node, key)) return true;
      node = (node as JsonObject)[key];
      if (key !== 'list' && !(key === 'result' && normalized[i - 1] === 'list_results')) continue;
      if (!valid(node as JsonObject)) continue;
      const suffix = normalized.slice(i + 1);
      if (!suffix.length) return true;
      const first = suffix[0];
      if (['id_str', 'rest_id', 'name', 'mode'].includes(String(first))) return true;
      if (first === 'legacy') return suffix.length < 2 || ['id_str', 'rest_id', 'name', 'mode'].includes(String(suffix[1]));
      if (first === 'user' || first === 'user_results') {
        const ownerSuffix = first === 'user_results' && suffix[1] === 'result' ? suffix.slice(2) : suffix.slice(1);
        return !ownerSuffix.length || ['id_str', 'rest_id'].includes(String(ownerSuffix[0]));
      }
      if (first === 'list_results') return true;
      // This path is confined to an ancillary field of a fully identified list.
      return false;
    }
    return true;
  });
}
/** Read-only recovery: expose verified owned records with an explicit incompleteness warning.
 * Never apply this policy to mutations or membership responses. */
export function checkDirectoryResponse(status: number, data: JsonObject, accountId: string): void {
  if (status < 200 || status >= 300 || !isPartialDirectory(data)) { checkApiResponse(status, data); return; }
  // Still require a recognized timeline and at least one independently valid owned list.
  const parsed = parseLists(data, accountId, 'management', true);
  if (!parsed.lists.length) checkApiResponse(status, data);
}

export function parseMembershipPage(data: JsonObject): { ids: string[]; cursor?: string } {
  if (!Array.isArray(data.lists)) throw new Error('列表归属响应格式未识别，未将缺失数据当作未加入。');
  const ids = data.lists.map(list => {
    const id = list?.id_str;
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('列表归属响应缺少准确的列表 ID。');
    return id;
  });
  const cursor = data.next_cursor_str ?? (Number.isSafeInteger(data.next_cursor) ? String(data.next_cursor) : undefined);
  if (typeof cursor !== 'string' || !/^-?\d+$/.test(cursor)) throw new Error('列表归属响应缺少有效分页信息，状态尚未确认。');
  return { ids, cursor: cursor === '0' ? undefined : cursor };
}
export async function collectMemberships(fetchPage: (cursor: string) => Promise<JsonObject>): Promise<string[]> {
  const ids = new Set<string>();
  const seen = new Set<string>(['-1']);
  let cursor = '-1';
  for (let page = 0; page < 50; page++) {
    const next = parseMembershipPage(await fetchPage(cursor));
    for (const id of next.ids) ids.add(id);
    if (!next.cursor) return [...ids];
    if (seen.has(next.cursor)) throw new Error('列表归属分页游标重复，状态尚未确认。');
    seen.add(next.cursor);
    cursor = next.cursor;
  }
  throw new Error('列表归属分页过多，状态尚未确认。');
}
