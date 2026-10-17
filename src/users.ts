import { walk } from './core';

/** Accept explicit user identities from native X responses, never tweet IDs or numeric coercions. */
export function nativeUsers(data: unknown): Map<string, string> {
  const users = new Map<string, string>();
  walk(data, node => {
    const name = node.core?.screen_name ?? node.legacy?.screen_name ?? node.screen_name;
    const id = node.rest_id ?? node.id_str;
    if (typeof name === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(name) && typeof id === 'string' && /^\d+$/.test(id)) users.set(name.toLowerCase(), id);
  });
  return users;
}
