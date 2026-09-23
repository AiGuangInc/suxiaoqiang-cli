import { t } from './i18n.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE = 'suxiaoqiang-cli';

export class CredentialStoreError extends Error {}
export class CredentialStoreUnavailableError extends CredentialStoreError {}

function lacksLinuxSessionBus(): boolean {
  if (process.platform !== 'linux') return false;
  if (process.env.DBUS_SESSION_BUS_ADDRESS?.trim()) return false;
  const runtime = process.env.XDG_RUNTIME_DIR;
  return !runtime || !existsSync(join(runtime, 'bus'));
}

/** Load native bindings only for saved credentials; CI environment tokens do not need them. */
async function entryFor(apiBase: string) {
  // A headless Linux session without D-Bus cannot use the pinned Secret Service backend.
  if (lacksLinuxSessionBus()) throw new CredentialStoreUnavailableError(t('credential.unavailable'));
  try {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    const account = `access-token:${new URL(apiBase).href.replace(/\/+$/, '')}`;
    // Require persistent storage on Linux, rather than the kernel's volatile keyring fallback.
    return new AsyncEntry(SERVICE, account, { linux: { store: 'secret-service' } });
  } catch {
    throw new CredentialStoreError(t('credential.unavailable'));
  }
}

export async function readCredential(apiBase: string): Promise<string | undefined> {
  const entry = await entryFor(apiBase);
  try {
    return (await entry.getPassword()) ?? undefined;
  } catch {
    throw new CredentialStoreError(t('credential.unavailable'));
  }
}

export async function writeCredential(apiBase: string, token: string): Promise<void> {
  try {
    const entry = await entryFor(apiBase);
    await entry.setPassword(token);
    if (await entry.getPassword() !== token) throw new Error('Credential verification failed');
  } catch {
    // Never include native errors: a backend may embed credential data in its error text.
    throw new CredentialStoreError(t('credential.saveFailed'));
  }
}

export async function deleteCredential(apiBase: string): Promise<void> {
  try {
    await (await entryFor(apiBase)).deleteCredential();
  } catch {
    throw new CredentialStoreError(t('credential.deleteFailed'));
  }
}
