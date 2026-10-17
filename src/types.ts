export type Membership = boolean | null;
export interface ListItem { id: string; name: string; member: Membership; private: boolean }
// userId is empty for read-only hover snapshots, which are isolated from profile mutation state.
export interface Snapshot { accountId: string; userId: string; screenName: string; lists: ListItem[]; fetchedAt: number; warnings?: string[] }
export type ApiRequest =
  | { action: 'preview'; screenName: string; force?: boolean }
  | { action: 'load'; screenName: string; force?: boolean }
  | { action: 'toggle'; screenName: string; accountId: string; userId: string; listId: string; member: boolean };
export type ApiResult = { ok: true; value: Snapshot } | { ok: false; error: string };
export interface PageApi { run(request: ApiRequest): Promise<ApiResult>; diagnostics(): string }
export interface Settings { display: 'names' | 'count'; favorites: Record<string, string[]> }
export const DEFAULT_SETTINGS: Settings = { display: 'names', favorites: {} };
export interface SavedAccount { lists: Pick<ListItem, 'id' | 'name' | 'private'>[]; updatedAt: number }
export function readSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { display: 'names', favorites: {} };
  const raw = value as Record<string, unknown>;
  const favorites: Record<string, string[]> = {};
  if (raw.favorites && typeof raw.favorites === 'object') {
    for (const [account, ids] of Object.entries(raw.favorites)) {
      if (/^\d+$/.test(account) && Array.isArray(ids)) favorites[account] = ids.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id));
    }
  }
  return { display: raw.display === 'count' ? 'count' : 'names', favorites };
}
export function readAccount(value: unknown): SavedAccount | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.lists) || typeof raw.updatedAt !== 'number') return null;
  const lists = raw.lists.filter((item): item is SavedAccount['lists'][number] => item && typeof item.id === 'string' && /^\d+$/.test(item.id) && typeof item.name === 'string' && typeof item.private === 'boolean');
  return { lists, updatedAt: raw.updatedAt };
}
