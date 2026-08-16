import { db } from './db';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PERSONAL_GLM_SECRET_ID = '__stingy_internal_glm__';

export async function saveProviderSecret(profileId: string, secret: string): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(secret));
  await db.secrets.put({ profileId, key, iv, ciphertext, updatedAt: Date.now() });
}

export async function loadProviderSecret(profileId: string): Promise<string | undefined> {
  const record = await db.secrets.get(profileId);
  if (!record) return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      record.key,
      record.ciphertext,
    );
    return decoder.decode(plaintext);
  } catch {
    await db.secrets.delete(profileId);
    return undefined;
  }
}

export const savePersonalGlmSecret = (secret: string) => saveProviderSecret(PERSONAL_GLM_SECRET_ID, secret);
export const loadPersonalGlmSecret = () => loadProviderSecret(PERSONAL_GLM_SECRET_ID);
export const removePersonalGlmSecret = () => db.secrets.delete(PERSONAL_GLM_SECRET_ID);
