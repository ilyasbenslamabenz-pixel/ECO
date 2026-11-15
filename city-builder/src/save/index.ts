/**
 * Sauvegardes (thread principal) : API asynchrone recommandée.
 * - SaveStore : emplacements multiples (IndexedDB -> localStorage -> mémoire), gzip, export/import ;
 * - Autosaver : sauvegarde automatique périodique en rotation ;
 * - cloud.ts : sauvegardes en ligne (artifact claude.ai), CloudSlotProvider = SaveStore synchronisé ;
 * - account.ts : comptes joueurs Supabase (docs/COMPTES.md), AccountStore = SaveStore du joueur courant ;
 * - sync.ts : moteur commun de synchronisation « local d'abord » (cloud.ts et account.ts) ;
 * - storage.ts : ancienne API synchrone (localStorage, JSON brut), conservée pour main.ts.
 */
export { SaveStore, downloadBlob, SLOT_RE, type SlotInfo } from './store';
export { Autosaver, type AutosaveOptions } from './autosave';
export { encodeSave, decodeSave, compressionAvailable, type Result } from './codec';
export { CloudSlotProvider, attachCloudSaves, CLOUD_SAVE_EVENT, type CloudSaveStatus, type CloudSaveState } from './cloud';
export { openBestBackend, IndexedDbBackend, LocalStorageBackend, MemoryBackend, type SaveBackend, type BackendKind } from './backends';
export { AccountManager, AccountStore, attachAccounts, ACCOUNT_EVENT, type AccountSnapshot } from './account';
export { SyncedSlotProvider, type RemoteSlots, type RemoteMeta } from './sync';
