import { collectLists, directoryIncomplete, parseUser, profileName, type JsonObject } from './core';
import type { ApiRequest, Snapshot, ListItem } from './types';

export interface Transport {
  account(): string;
  pathname(): string;
  query(operation: 'UserByScreenName' | 'ListsManagementPageTimeline' | 'ListAddMember' | 'ListRemoveMember', variables: JsonObject): Promise<JsonObject>;
  now(): number;
  resolveUser?(screenName: string): Promise<string>;
  memberships?(userId: string): Promise<string[]>;
  membershipsByScreenName?(screenName: string): Promise<string[]>;
}
export class ListService {
  private cache = new Map<string, Snapshot>();
  private directories = new Map<string, { lists: ListItem[]; warnings: string[]; fetchedAt: number }>();
  private busy = new Set<string>();
  private generation = 0;
  constructor(private transport: Transport) {}
  invalidate(): void { this.generation++; this.cache.clear(); this.directories.clear(); }
  private guard(account: string, screenName: string): void {
    if (this.transport.account() !== account) throw new Error('登录账号已切换，请刷新状态。');
    if (profileName(this.transport.pathname())?.toLowerCase() !== screenName.toLowerCase()) throw new Error('已离开此用户主页，请在当前主页重试。');
  }
  async run(request: ApiRequest): Promise<Snapshot> {
    const accountId = this.transport.account();
    if (request.action === 'preview') {
      const path = this.transport.pathname();
      return this.load(accountId, request.screenName, request.force === true, () => {
        if (this.transport.account() !== accountId) throw new Error('登录账号已切换，请重新查看。');
        if (this.transport.pathname() !== path) throw new Error('页面已切换，请重新查看。');
      }, true);
    }
    this.guard(accountId, request.screenName);
    const key = `${accountId}:${request.screenName.toLowerCase()}`;
    if (request.action === 'load') return this.load(accountId, request.screenName, request.force === true);
    if (request.accountId !== accountId) throw new Error('登录账号已切换，请刷新状态。');
    if (this.busy.has(key)) throw new Error('正在保存，请等待当前操作完成。');
    const snapshot = this.cache.get(key);
    const list = snapshot?.lists.find(item => item.id === request.listId);
    if (!snapshot || snapshot.userId !== request.userId || !list || list.member === null) throw new Error('列表状态尚未确认，请先刷新。');
    if (this.transport.now() - snapshot.fetchedAt > 60_000) throw new Error('列表状态已过期，请先刷新再操作。');
    if (list.member === request.member) return snapshot;
    this.busy.add(key);
    // Invalidate before writing: if the response is lost, the next load must consult X.
    this.cache.delete(key);
    this.cache.delete(`${accountId}:preview:${request.screenName.toLowerCase()}`);
    this.directories.clear();
    const generation = ++this.generation;
    try {
      let verifiedMemberships: Set<string> | undefined;
      try {
        const result = await this.transport.query(request.member ? 'ListAddMember' : 'ListRemoveMember', { listId: request.listId, userId: request.userId });
        const returnedId = result.data?.list?.id_str ?? result.data?.list?.rest_id;
        if (returnedId !== request.listId) throw new Error('X 未确认保存结果，请刷新状态后再操作。');
      } catch (writeError) {
        // An error while serializing the mutation's return fields need not mean the
        // write failed. Confirm through a fresh, complete read; never repeat the write.
        this.guard(accountId, request.screenName);
        if (generation !== this.generation) throw new Error('列表在其他地方发生了变化，请刷新状态。');
        if (!this.transport.memberships) throw writeError;
        try {
          verifiedMemberships = new Set(await this.transport.memberships(request.userId));
        } catch (readError) {
          throw new Error(`${writeError instanceof Error ? writeError.message : 'X 未确认保存结果'}\n保存后读取状态也失败：${readError instanceof Error ? readError.message : '请刷新状态。'}`);
        }
        this.guard(accountId, request.screenName);
        if (generation !== this.generation) throw new Error('列表在其他地方发生了变化，请刷新状态。');
        if (verifiedMemberships.has(request.listId) !== request.member) throw writeError;
      }
      this.guard(accountId, request.screenName);
      if (generation !== this.generation) throw new Error('列表在其他地方发生了变化，请刷新状态。');
      const updated: Snapshot = { ...snapshot, ...(verifiedMemberships ? { fetchedAt: this.transport.now() } : {}), lists: snapshot.lists.map(item => verifiedMemberships ? { ...item, member: verifiedMemberships.has(item.id) } : item.id === request.listId ? { ...item, member: request.member } : item) };
      this.cache.set(key, updated);
      return updated;
    } finally { this.busy.delete(key); }
  }
  private async load(accountId: string, screenName: string, force: boolean, guard = () => this.guard(accountId, screenName), preview = false): Promise<Snapshot> {
    guard();
    const baseKey = `${accountId}:${screenName.toLowerCase()}`;
    const key = preview ? `${accountId}:preview:${screenName.toLowerCase()}` : baseKey;
    if (this.busy.has(baseKey)) throw new Error('正在保存，请稍后刷新。');
    const cached = this.cache.get(key);
    if (!force && cached && this.transport.now() - cached.fetchedAt < 30_000) return cached;
    const generation = this.generation;
    const warnings = new Set<string>();
    // Read-only hover snapshots deliberately contain no mutation identity. Resolve
    // memberships by the card's handle, independent of the user-details feature flags.
    if (preview && !this.transport.membershipsByScreenName) throw new Error('悬停卡片的列表查询未初始化，请刷新页面。');
    const userId = preview ? '' : this.transport.resolveUser ? await this.transport.resolveUser(screenName) : parseUser(await this.transport.query('UserByScreenName', { screen_name: screenName, withSafetyModeUserFields: true }), screenName);
    guard();
    const cachedDirectory = this.directories.get(accountId);
    const reuseDirectory = !force && cachedDirectory && this.transport.now() - cachedDirectory.fetchedAt < 30_000;
    if (reuseDirectory) for (const warning of cachedDirectory.warnings) warnings.add(warning);
    const directory = reuseDirectory ? cachedDirectory.lists : await collectLists(cursor => {
      guard();
      return this.transport.query('ListsManagementPageTimeline', { count: 100, ...(cursor ? { cursor } : {}) }).then(data => {
        if (directoryIncomplete(data, accountId)) warnings.add('X 返回了部分目录错误，当前仅显示已验证的列表，目录可能不完整。');
        return data;
      });
    }, accountId, 'management');
    guard();
    if (generation !== this.generation) throw new Error('读取期间列表发生了变化，请刷新状态。');
    if (!reuseDirectory) {
      this.directories.set(accountId, { lists: directory, warnings: [...warnings], fetchedAt: this.transport.now() });
      if (this.directories.size > 4) this.directories.delete(this.directories.keys().next().value!);
    }
    let lists = directory;
    if (preview || this.transport.memberships) {
      const memberships = new Set(await (preview ? this.transport.membershipsByScreenName!(screenName) : this.transport.memberships!(userId)));
      guard();
      lists = directory.map(list => ({ ...list, member: memberships.has(list.id) }));
    }
    if (generation !== this.generation) throw new Error('读取期间列表发生了变化，请刷新状态。');
    const snapshot = { accountId, userId, screenName, lists, fetchedAt: this.transport.now(), ...(warnings.size ? { warnings: [...warnings] } : {}) };
    this.cache.set(key, snapshot);
    // Keep only a small in-memory cache. No membership data survives a reload.
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
    return snapshot;
  }
}
