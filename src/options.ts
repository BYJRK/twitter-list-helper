import { DEFAULT_SETTINGS, readSettings, readAccount, type Settings, type SavedAccount } from './types';
import { element } from './ui';
const display = document.querySelector<HTMLSelectElement>('#display')!;
const account = document.querySelector<HTMLSelectElement>('#account')!;
const favorites = document.querySelector<HTMLElement>('#favorites')!;
const status = document.querySelector<HTMLElement>('#status')!;
let settings: Settings = DEFAULT_SETTINGS;
let accounts: Record<string, SavedAccount> = {};
async function updateSettings(change: (current: Settings) => Settings): Promise<void> {
  try {
    const saved = await chrome.storage.local.get('settings');
    settings = change(readSettings(saved.settings));
    await chrome.storage.local.set({ settings });
    status.textContent = '已保存';
  } catch { status.textContent = '保存失败，请重试。'; }
}
function renderFavorites(): void {
  favorites.replaceChildren();
  const id = account.value;
  const data = accounts[id];
  if (!data?.lists.length) { favorites.append(element('p', '暂无列表目录，请先打开一个 X 用户主页并刷新列表状态。', 'muted')); return; }
  for (const list of data.lists) {
    const label = element('label', undefined, 'favorite');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = (settings.favorites?.[id] ?? []).includes(list.id);
    checkbox.onchange = () => {
      const checked = checkbox.checked;
      checkbox.disabled = true;
      void updateSettings(current => {
        const next = new Set(current.favorites?.[id] ?? []);
        checked ? next.add(list.id) : next.delete(list.id);
        return { ...current, favorites: { ...current.favorites, [id]: [...next] } };
      }).finally(() => { checkbox.disabled = false; });
    };
    label.append(checkbox, element('span', list.name + (list.private ? ' · 私密' : '')));
    favorites.append(label);
  }
}
async function reload(): Promise<void> {
  const saved = await chrome.storage.local.get(null);
  settings = readSettings(saved.settings);
  display.value = settings.display;
  accounts = {};
  for (const [key, value] of Object.entries(saved)) {
    const parsed = readAccount(value);
    if (/^account:\d+$/.test(key) && parsed) accounts[key.slice(8)] = parsed;
  }
  const selected = account.value;
  account.replaceChildren();
  for (const id of Object.keys(accounts)) { const option = element('option', `账号 ${id}`); option.value = id; account.append(option); }
  if (accounts[selected]) account.value = selected;
  account.disabled = !Object.keys(accounts).length;
  renderFavorites();
}
display.onchange = () => { const value = display.value === 'count' ? 'count' : 'names'; void updateSettings(current => ({ ...current, display: value })); };
account.onchange = renderFavorites;
document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
  if (!account.value) return;
  void chrome.storage.local.remove(`account:${account.value}`).then(reload).then(() => { status.textContent = '本地目录已清除，打开 X 主页刷新后会重新读取。'; }).catch(() => { status.textContent = '清除失败，请重试。'; });
};
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void reload(); });
void reload().catch(() => { status.textContent = '读取设置失败，请重新打开此页面。'; });
