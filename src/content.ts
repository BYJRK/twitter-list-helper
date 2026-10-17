import { profileName } from './core';
import { DEFAULT_SETTINGS, readSettings, type ApiRequest, type ApiResult, type Snapshot, type Settings } from './types';
import { styles, element, listIcon } from './ui';
import { menuPosition } from './layout';
import { scanHoverCards, refreshHoverCards } from './hover';

let settings: Settings = DEFAULT_SETTINGS;
let host: HTMLElement | undefined;
let shadow: ShadowRoot | undefined;
let currentKey = '';
let currentName = '';
let snapshot: Snapshot | undefined;
let generation = 0;
let loading = false;
let pendingId = '';
let uncertain = false;
let errorText = '';
let opened = false;
let filter = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let trigger: HTMLButtonElement;
let panel: HTMLElement;
let items: HTMLElement;
let status: HTMLElement;
let search: HTMLInputElement;
let refresh: HTMLButtonElement;
let diagnostics: HTMLDetailsElement;
let errorDetail: HTMLElement;

function positionMenu(): void {
  if (!opened || !host?.isConnected) return;
  const rect = trigger.getBoundingClientRect();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  panel.style.maxHeight = `${Math.max(0, viewport.height - 24)}px`;
  const bounds = menuPosition(rect, Math.min(340, viewport.width - 24), panel.getBoundingClientRect().height, viewport);
  panel.style.left = `${bounds.left}px`;
  panel.style.top = `${bounds.top}px`;
  panel.style.maxHeight = `${bounds.maxHeight}px`;
}

async function rpc(request: ApiRequest): Promise<Snapshot> {
  const result: ApiResult = await chrome.runtime.sendMessage({ type: 'api', request });
  if (!result?.ok) throw new Error(result?.error ?? '扩展连接失效，请刷新 X 页面。');
  return result.value;
}
async function saveLists(value: Snapshot): Promise<void> {
  if (value.warnings?.length) return; // Do not replace a complete saved directory with a partial one.
  await chrome.storage.local.set({ [`account:${value.accountId}`]: { lists: value.lists.map(({ id, name, private: isPrivate }) => ({ id, name, private: isPrivate })), updatedAt: value.fetchedAt } });
}
async function load(force = false): Promise<void> {
  if (loading || pendingId || !currentName) return;
  const version = generation;
  const name = currentName;
  loading = true;
  errorText = '';
  render();
  try {
    const value = await rpc({ action: 'load', screenName: name, force });
    if (version !== generation) return;
    snapshot = value;
    uncertain = false;
    void saveLists(value).catch(() => {});
  } catch (error) {
    if (version === generation) { errorText = error instanceof Error ? error.message : '读取失败，请重试。'; uncertain = true; }
  } finally {
    if (version === generation) { loading = false; render(); }
  }
}
async function toggle(id: string): Promise<void> {
  const old = snapshot;
  const list = old?.lists.find(item => item.id === id);
  if (!old || !list || list.member === null || loading || pendingId || uncertain) return;
  if (Date.now() - old.fetchedAt > 60_000) { errorText = '状态已过期，请点击刷新后再操作。'; uncertain = true; render(); return; }
  const version = generation;
  pendingId = id;
  errorText = '';
  render();
  try {
    const value = await rpc({ action: 'toggle', screenName: currentName, accountId: old.accountId, userId: old.userId, listId: id, member: !list.member });
    if (version === generation) snapshot = value;
  } catch (error) {
    if (version === generation) { errorText = error instanceof Error ? error.message : '保存失败，请刷新状态。'; uncertain = true; }
  } finally { if (version === generation) { pendingId = ''; render(); } }
}
async function favorite(id: string): Promise<void> {
  if (!snapshot) return;
  const accountId = snapshot.accountId;
  const saved = await chrome.storage.local.get('settings');
  const next = readSettings(saved.settings);
  const favorites = new Set(next.favorites?.[accountId] ?? []);
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  settings = { ...next, favorites: { ...next.favorites, [accountId]: [...favorites] } };
  await chrome.storage.local.set({ settings });
  render();
}
function setOpen(value: boolean): void {
  opened = value;
  panel.hidden = !value;
  trigger.setAttribute('aria-expanded', String(value));
  if (value) {
    if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open')) panel.showPopover();
    positionMenu();
    if (snapshot && Date.now() - snapshot.fetchedAt >= 30_000 && !loading && !pendingId) void load(true);
    search.focus({ preventScroll: true });
  } else {
    if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
    filter = ''; search.value = ''; render();
  }
}
function render(): void {
  if (!host) return;
  const lists = snapshot?.lists ?? [];
  const members = lists.filter(list => list.member === true);
  const unknown = lists.some(list => list.member === null);
  const label = loading && !snapshot ? '正在读取列表…' : !snapshot ? (errorText ? '读取失败' : '列表状态未读取') : uncertain ? '列表状态待刷新' : members.length ? (settings.display === 'count' ? `已加入 ${members.length} 个列表` : members.slice(0, 2).map(list => list.name).join(' · ') + (members.length > 2 ? ` +${members.length - 2}` : '')) : unknown ? '部分列表状态未知' : '未加入列表';
  trigger.querySelector('.caption')!.textContent = label;
  trigger.setAttribute('aria-label', `列表：${label}`);
  trigger.title = members.map(list => list.name).join('、') || label;
  status.className = `status${errorText ? ' error' : ''}`;
  status.textContent = errorText ? (snapshot ? '操作未确认，请刷新状态。' : '列表读取失败，请重试或查看错误详情。') : (pendingId ? '正在保存…' : loading ? '正在刷新…' : snapshot?.warnings?.length ? snapshot.warnings.join(' ') : unknown ? '部分状态未返回，未知项不可操作。' : snapshot ? `已读取 ${lists.length} 个列表` : '');
  diagnostics.hidden = !errorText && !snapshot?.warnings?.length;
  errorDetail.textContent = errorText || snapshot?.warnings?.join(' ') || '';
  refresh.disabled = loading || !!pendingId;
  items.replaceChildren();
  if (!snapshot) { items.append(element('div', loading ? '正在读取你的列表…' : '暂时无法显示列表。', 'empty')); positionMenu(); return; }
  const favorites = settings.favorites?.[snapshot.accountId] ?? [];
  const visible = lists.filter(list => list.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.name.localeCompare(b.name));
  if (!visible.length) items.append(element('div', lists.length ? '没有匹配的列表。' : '你还没有创建列表，可先在 X 中创建。', 'empty'));
  for (const list of visible) {
    const item = element('div', undefined, 'item');
    const row = element('button', undefined, 'row');
    row.type = 'button';
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', list.member === null ? 'mixed' : String(list.member));
    row.disabled = loading || !!pendingId || uncertain || list.member === null;
    row.title = list.member === null ? 'X 未返回此列表的成员状态' : list.member ? `从「${list.name}」移除` : `加入「${list.name}」`;
    row.append(element('span', pendingId === list.id ? '…' : list.member === null ? '?' : list.member ? '✓' : '○', 'mark'), element('span', list.name, 'name'));
    if (list.private) row.append(element('span', '私密', 'private'));
    row.onclick = () => { void toggle(list.id); };
    const star = element('button', favorites.includes(list.id) ? '★' : '☆', 'star');
    star.type = 'button';
    star.setAttribute('aria-label', `${favorites.includes(list.id) ? '取消' : '设为'}常用：${list.name}`);
    star.setAttribute('aria-pressed', String(favorites.includes(list.id)));
    star.onclick = () => { void favorite(list.id).catch(() => { errorText = '常用列表设置保存失败，请重试。'; render(); }); };
    item.append(row, star);
    items.append(item);
  }
  positionMenu();
}
function placeHost(anchor: HTMLElement, toolbar?: HTMLElement): void {
  if (!host) return;
  host.toggleAttribute('toolbar', !!toolbar);
  if (toolbar) {
    if (toolbar.firstElementChild !== host) toolbar.prepend(host);
    const native = toolbar.querySelector<HTMLElement>('[data-testid="userActions"], [data-testid="editProfileButton"]');
    if (native) {
      const rect = native.getBoundingClientRect();
      if (rect.height > 0) {
        const row = toolbar.getBoundingClientRect();
        const style = getComputedStyle(toolbar);
        const inset = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
        const metrics = { '--xlh-control-height': `${rect.height}px`, '--xlh-control-offset': `${Math.max(0, rect.top - row.top - inset)}px` };
        for (const [key, value] of Object.entries(metrics)) if (host.style.getPropertyValue(key) !== value) host.style.setProperty(key, value);
      }
    }
  } else if (anchor.nextElementSibling !== host) anchor.after(host);
}
function profileToolbar(primary: HTMLElement): HTMLElement | undefined {
  // X wraps individual controls separately. Find their shared row, excluding post menus.
  const control = [...primary.querySelectorAll<HTMLElement>('[data-testid="userActions"], [data-testid="editProfileButton"]')].find(node => !node.closest('article'));
  if (!control) return;
  let row = control.parentElement;
  for (let depth = 0; row && row !== primary && depth < 5; depth++, row = row.parentElement) {
    if (row.querySelector('[data-testid="UserName"], article')) return;
    const controls = row.querySelectorAll('button, a[role="button"], div[role="button"]');
    if (controls.length > 1) return row;
    // Our injected host must not change which row qualifies on the next scan.
    const nativeChildren = [...row.children].filter(child => child !== host);
    if (control.dataset.testid === 'editProfileButton' && nativeChildren.length === 1) return row;
  }
}
function mount(anchor: HTMLElement, toolbar?: HTMLElement): void {
  host?.remove();
  host = element('div');
  host.id = 'x-list-helper';
  shadow = host.attachShadow({ mode: 'open' });
  const style = element('style', styles);
  const wrap = element('div', undefined, 'wrap');
  trigger = element('button', undefined, 'trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', String(opened));
  trigger.setAttribute('aria-controls', 'xlh-menu');
  trigger.append(listIcon(), element('span', undefined, 'caption'), element('span', '▾', 'chevron'));
  trigger.onclick = () => setOpen(!opened);
  panel = element('div', undefined, 'panel');
  panel.id = 'xlh-menu';
  panel.setAttribute('popover', 'manual');
  panel.hidden = !opened;
  const head = element('div', undefined, 'head');
  head.append(element('div', '我的列表', 'title'), element('div', '点击即保存 · ☆ 将常用列表置顶', 'hint'));
  search = element('input', undefined, 'search');
  search.type = 'search'; search.placeholder = '搜索列表'; search.value = filter;
  search.setAttribute('aria-label', '搜索我的列表');
  search.oninput = () => { filter = search.value; render(); };
  head.append(search);
  items = element('div', undefined, 'items');
  items.setAttribute('role', 'menu');
  items.setAttribute('aria-label', '我的列表');
  const foot = element('div', undefined, 'foot');
  refresh = element('button', '刷新状态', 'tool');
  refresh.onclick = () => { void load(true); };
  const options = element('button', '设置', 'tool');
  options.onclick = () => { void chrome.runtime.sendMessage({ type: 'options' }); };
  foot.append(refresh, options);
  status = element('div', undefined, 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  diagnostics = element('details', undefined, 'diagnostics');
  diagnostics.hidden = true;
  errorDetail = element('pre');
  const copyError = element('button', '复制错误详情', 'tool');
  copyError.type = 'button';
  copyError.onclick = () => {
    void chrome.runtime.sendMessage({ type: 'diagnostics' }).then(details => {
      const text = `X 列表助手 ${chrome.runtime.getManifest().version}\n${errorText || snapshot?.warnings?.join(' ') || ''}\n${typeof details === 'string' ? details : '暂无请求诊断'}`;
      return navigator.clipboard.writeText(text);
    }).then(() => { copyError.textContent = '已复制'; }).catch(() => { copyError.textContent = '复制失败，请手动选中详情'; });
  };
  diagnostics.append(element('summary', '查看错误详情'), errorDetail, copyError);
  diagnostics.addEventListener('toggle', positionMenu);
  panel.append(head, status, diagnostics, items, foot);
  wrap.append(trigger, panel);
  shadow.append(style, wrap);
  placeHost(anchor, toolbar);
  shadow.addEventListener('keydown', event => {
    const e = event as KeyboardEvent;
    if (e.key === 'Escape') { setOpen(false); trigger.focus(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && opened) {
      const rows = [...items.querySelectorAll<HTMLButtonElement>('.row:not(:disabled)')];
      if (!rows.length) return;
      e.preventDefault();
      const index = rows.indexOf(shadow!.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? (index + 1) % rows.length : (index <= 0 ? rows.length : index) - 1;
      rows[next]?.focus();
    }
  });
  theme();
  render();
  if (opened) setOpen(true);
}
function theme(): void {
  const background = getComputedStyle(document.body).backgroundColor;
  const rgb = background.match(/\d+/g)?.slice(0, 3).map(Number);
  host?.toggleAttribute('dark', !!rgb && (rgb[0]! * .299 + rgb[1]! * .587 + rgb[2]! * .114 < 130));
}
function scan(): void {
  scanHoverCards(settings);
  const name = profileName(location.pathname);
  const cookie = document.cookie.split(';').find(part => part.trim().startsWith('twid=')) ?? '';
  const key = `${cookie}:${name?.toLowerCase() ?? ''}`;
  if (key !== currentKey) {
    currentKey = key; currentName = name ?? ''; generation++;
    host?.remove(); host = undefined; shadow = undefined; snapshot = undefined;
    opened = false; filter = ''; loading = false; pendingId = ''; uncertain = false; errorText = '';
  }
  if (!name) return;
  const primary = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  const anchor = primary?.querySelector<HTMLElement>('[data-testid="UserName"]');
  const handles = anchor?.textContent?.match(/@[a-zA-Z0-9_]{1,15}/g) ?? [];
  if (!anchor || !handles.some(handle => handle.toLowerCase() === `@${name.toLowerCase()}`)) { host?.remove(); return; }
  const toolbar = primary ? profileToolbar(primary) : undefined;
  if (!host?.isConnected) { mount(anchor, toolbar); if (!snapshot && !loading) void load(); }
  else placeHost(anchor, toolbar);
  theme();
}
function schedule(): void { if (!timer) timer = setTimeout(() => { timer = undefined; scan(); }, 120); }
document.addEventListener('pointerdown', event => { if (opened && host && !event.composedPath().includes(host)) setOpen(false); });
window.addEventListener('popstate', schedule);
window.addEventListener('resize', positionMenu);
window.addEventListener('scroll', positionMenu, { capture: true, passive: true });
window.addEventListener('focus', () => { scan(); refreshHoverCards(); if (snapshot && Date.now() - snapshot.fetchedAt >= 30_000) void load(true); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) { settings = readSettings(changes.settings.newValue); render(); } });
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
// Covers pushState route changes and account switches with no DOM mutation.
setInterval(() => { if (!document.hidden) scan(); }, 1500);
void chrome.storage.local.get('settings').then(saved => { settings = readSettings(saved.settings); scan(); }).catch(() => { scan(); });
