// Анонимный device-token: 32 байта в base64url. Хранится ТОЛЬКО в storage.local (device-bound секрет).
import { browser } from 'wxt/browser';
import { STORAGE } from './constants';

function genSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // base64url, 43 симв.
}

export async function getDeviceSecret(): Promise<string> {
  const got = await browser.storage.local.get(STORAGE.secret);
  let s = got[STORAGE.secret] as string | undefined;
  if (!s) {
    s = genSecret();
    await browser.storage.local.set({ [STORAGE.secret]: s });
  }
  return s;
}
