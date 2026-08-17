import type { OptimizationSettings, SyncStatus, UserPreferencesEnvelope } from '../types';
import { updateUserPreferences } from './auth';

type Snapshot = () => UserPreferencesEnvelope;
type Apply = (value: UserPreferencesEnvelope) => void;
type Status = (value: SyncStatus, detail?: string) => void;

let dirty: Partial<OptimizationSettings> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let rerun = false;
let callbacks: { snapshot: Snapshot; apply: Apply; status: Status } | undefined;

export function schedulePreferenceSync(patch: Partial<OptimizationSettings>, snapshot: Snapshot, apply: Apply, status: Status): void {
  dirty = { ...dirty, ...patch }; callbacks = { snapshot, apply, status }; rerun = true; status('pending');
  clearTimeout(timer); timer = setTimeout(() => void flushPreferenceSync(), 200);
}

async function flushPreferenceSync(): Promise<void> {
  if (!callbacks || inFlight || !rerun) return;
  if (!navigator.onLine) { callbacks.status('offline'); return; }
  inFlight = true; rerun = false; const sentDirty = dirty; dirty = {}; callbacks.status('syncing');
  try {
    const value = await updateUserPreferences(callbacks.snapshot()); callbacks.apply({ ...value, settings: { ...value.settings, ...dirty } });
    callbacks.status(Object.keys(dirty).length ? 'pending' : 'idle');
  } catch (error) {
    const latest = (error as Error & { latest?: UserPreferencesEnvelope }).latest;
    if (latest) {
      callbacks.apply({ ...latest, settings: { ...latest.settings, ...sentDirty, ...dirty } });
      dirty = { ...sentDirty, ...dirty }; rerun = true; callbacks.status('pending', '已合并其他页面的设置更新');
    } else {
      dirty = { ...sentDirty, ...dirty }; rerun = true; callbacks.status(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : '设置等待同步');
      clearTimeout(timer); timer = setTimeout(() => void flushPreferenceSync(), 5_000);
    }
  } finally {
    inFlight = false;
    if (rerun && navigator.onLine) { clearTimeout(timer); timer = setTimeout(() => void flushPreferenceSync(), 200); }
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void flushPreferenceSync());
