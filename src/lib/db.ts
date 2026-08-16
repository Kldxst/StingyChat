import Dexie, { type EntityTable } from 'dexie';
import type {
  Conversation,
  KnowledgeChunk,
  KnowledgeDocument,
  OptimizationSettings,
  ProviderProfile,
  SemanticCacheEntry,
} from '../types';

interface EncryptedSecretRecord {
  profileId: string;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  updatedAt: number;
}

interface SettingsRecord {
  id: 'global';
  value: OptimizationSettings;
  beforeExtreme?: OptimizationSettings;
}

class StingyDatabase extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>;
  profiles!: EntityTable<ProviderProfile, 'id'>;
  documents!: EntityTable<KnowledgeDocument, 'id'>;
  chunks!: EntityTable<KnowledgeChunk, 'id'>;
  cache!: EntityTable<SemanticCacheEntry, 'id'>;
  secrets!: EntityTable<EncryptedSecretRecord, 'profileId'>;
  settings!: EntityTable<SettingsRecord, 'id'>;

  constructor() {
    super('stingy-chat');
    this.version(1).stores({
      conversations: 'id, updatedAt',
      profiles: 'id, kind',
      documents: 'id, createdAt',
      chunks: 'id, documentId',
      cache: 'id, conversationId, fingerprint, createdAt',
      secrets: 'profileId',
      settings: 'id',
    });
  }
}

export const db = new StingyDatabase();
