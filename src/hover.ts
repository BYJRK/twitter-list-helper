import { element, listIcon } from './ui';
import type { ApiResult, Settings, Snapshot } from './types';

interface CardState {
  host: HTMLElement;
  key: string;
  name: string;
  text: HTMLElement;
  note: HTMLElement;
  retry: HTMLButtonElement;
  copy: HTMLButtonElement;
  error?: string;
  loading?: boolean;
  value?: Snapshot;
  timer?: ReturnType<typeof setTimeout>;
}
const cards = new Map<HTMLElement, CardState>();
let currentSettings: Settings;
function identity(card: HTMLElement): string | undefined {
  const userName = card.querySelector('[data-testid="UserName"]');
  const handle = userName?.textContent?.match(/@([a-zA-Z0-9_]{1,15})(?![a-zA-Z0-9_])/i)?.[1];
  if (handle) return handle.toLowerCase();
  // Some X card variants have no UserName marker. Require a handle link matching its href.
  for (const link of card.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const match = /^@([a-zA-Z0-9_]{1,15})$/.exec(link.textContent?.trim() ?? '');
    if (match && new URL(link.href, location.origin).pathname.toLowerCase() === `/${match[1]!.toLowerCase()}`) return match[1]!.toLowerCase();
  }
}
function cardKey(name: string): string {
  const account = document.cookie.split(';').find(value => value.trim().startsWith('twid=')) ?? '';
  return `${account}:${location.pathname}:${name}`;
}
function active(card: HTMLElement, state: CardState): boolean {
  return cards.get(card) === state && card.isConnected && !card.closest('[hidden], [aria-hidden="true"]') && state.host.isConnected && identity(card) === state.name && cardKey(state.name) === state.key;
}
function setText(node: HTMLElement, value: string): void { if (node.textContent !== value) node.textContent = value; }
function show(state: CardState): void {
  const value = state.value;
  if (!value) return;
  const members = value.lists.filter(list => list.member === true);
  setText(state.text, members.length ? currentSettings.display === 'count' ? `已加入 ${members.length} 个列表` : members.map(list => list.name).join(' · ') : value.lists.some(list => list.member === null) ? '列表状态未知' : '未加入列表');
  const title = members.map(list => list.name).join('、');
  if (state.text.title !== title) state.text.title = title;
  setText(state.note, value.warnings?.length ? '目录可能不完整' : '');
  const warning = value.warnings?.join(' ') ?? '';
  if (state.note.title !== warning) state.note.title = warning;
}
async function read(card: HTMLElement, state: CardState, force = false): Promise<void> {
  if (!active(card, state) || state.loading) return;
  clearTimeout(state.timer); state.timer = undefined;
  state.loading = true;
  state.value = undefined;
  state.error = undefined;
  state.text.textContent = '正在读取列表…';
  state.text.title = '';
  state.retry.hidden = true;
  state.copy.hidden = true;
  state.copy.textContent = '复制错误';
  state.note.textContent = '';
  try {
    const result: ApiResult = await chrome.runtime.sendMessage({ type: 'api', request: { action: 'preview', screenName: state.name, force } });
    if (!active(card, state)) return;
    if (!result?.ok) throw new Error(result?.error ?? '请刷新 X 页面后重试。');
    if (result.value.screenName.toLowerCase() !== state.name) throw new Error('用户已切换，请重新查看。');
    state.value = result.value;
    show(state);
  } catch (error) {
    if (!active(card, state)) return;
    state.text.textContent = '列表状态读取失败';
    state.error = error instanceof Error ? error.message : '请重试。';
    state.text.title = state.error;
    state.note.textContent = state.error;
    state.retry.hidden = false;
    state.copy.hidden = false;
    if (!force && /尚未捕获|尚未获取接口的真实功能开关/.test(state.error)) {
      state.text.textContent = '正在等待接口就绪…';
      state.timer = setTimeout(() => { state.timer = undefined; void read(card, state, true); }, 1000);
    }
  } finally {
    state.loading = false;
  }
}
function cardContents(card: HTMLElement): { container: HTMLElement; anchor?: HTMLElement } {
  const identity = card.querySelector<HTMLElement>('[data-testid="UserName"]')
    ?? [...card.querySelectorAll<HTMLAnchorElement>('a[href]')].find(link => /^@[a-zA-Z0-9_]{1,15}$/.test(link.textContent?.trim() ?? ''));
  if (!identity) return { container: card };
  // HoverCard can be a pointer-events:none positioning wrapper. Keep our controls
  // inside the native body that owns X's hover handlers, beside the existing bio.
  let branch: HTMLElement = identity;
  for (let parent = branch.parentElement; parent && card.contains(parent); parent = branch.parentElement) {
    if (parent.querySelector('button, [role="button"]') && getComputedStyle(parent).pointerEvents !== 'none') return { container: parent, anchor: branch };
    branch = parent;
    if (parent === card) break;
  }
  return { container: card, anchor: branch === card ? undefined : branch };
}
function mount(card: HTMLElement, name: string): CardState {
  const host = element('div');
  host.className = 'xlh-hover-lists';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = element('style', ':host{display:block;pointer-events:auto;margin:8px 0;color:inherit;font:14px/1.5 system-ui,sans-serif}.line{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.list-icon{width:20px;height:20px;fill:currentColor;flex:none}.text{min-width:0;overflow-wrap:anywhere}.note{font-size:12px;opacity:.7;margin-top:3px;max-height:60px;overflow:auto;overflow-wrap:anywhere}.note:empty{display:none}button{border:0;background:transparent;color:#1d9bf0;font:inherit;cursor:pointer;padding:4px;flex:none}button[hidden]{display:none}button:focus-visible{outline:2px solid #1d9bf0;outline-offset:2px}');
  const line = element('div', undefined, 'line');
  const text = element('span', '正在读取列表…', 'text');
  text.setAttribute('role', 'status');
  const note = element('div', undefined, 'note');
  const retry = element('button', '重试');
  retry.className = 'retry';
  retry.type = 'button'; retry.hidden = true;
  const copy = element('button', '复制错误', 'copy');
  copy.type = 'button'; copy.hidden = true;
  line.append(listIcon(), text, retry, copy);
  shadow.append(style, line, note);
  const position = cardContents(card);
  if (position.anchor) position.anchor.after(host); else position.container.append(host);
  const state: CardState = { host, key: cardKey(name), name, text, note, retry, copy };
  retry.onclick = () => { void read(card, state, true); };
  copy.onclick = () => {
    const error = state.error ?? '暂无错误';
    void chrome.runtime.sendMessage({ type: 'diagnostics' }).then(details => navigator.clipboard.writeText(`X 列表助手 ${chrome.runtime.getManifest().version}\n${error}\n${typeof details === 'string' ? details : '暂无请求诊断'}`))
      .then(() => { if (active(card, state)) copy.textContent = '已复制'; })
      .catch(() => { if (active(card, state)) copy.textContent = '复制失败'; });
  };
  state.timer = setTimeout(() => { state.timer = undefined; void read(card, state); }, 250);
  return state;
}
export function scanHoverCards(settings: Settings): void {
  currentSettings = settings;
  for (const [card, state] of cards) {
    if (!active(card, state)) {
      clearTimeout(state.timer); state.host.remove(); cards.delete(card);
    } else show(state);
  }
  for (const card of document.querySelectorAll<HTMLElement>('[data-testid="HoverCard"], [data-testid="UserHoverCard"], [data-testid="hoverCardParent"] [role="dialog"]')) {
    if (cards.has(card) || card.closest('[hidden], [aria-hidden="true"]')) continue;
    const name = identity(card);
    if (name) cards.set(card, mount(card, name));
  }
}
export function refreshHoverCards(): void {
  for (const [card, state] of cards) {
    if (active(card, state) && (state.error || state.value && Date.now() - state.value.fetchedAt >= 30_000)) void read(card, state, true);
  }
}
