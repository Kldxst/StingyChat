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

interface ConversationSyncRecord {
  id?: number;
  namespace: string;
  conversationId: string;
  operation: 'upsert' | 'delete';
  updatedAt: number;
}

class StingyDatabase extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>;
  profiles!: EntityTable<ProviderProfile, 'id'>;
  documents!: EntityTable<KnowledgeDocument, 'id'>;
  chunks!: EntityTable<KnowledgeChunk, 'id'>;
  cache!: EntityTable<SemanticCacheEntry, 'id'>;
  secrets!: EntityTable<EncryptedSecretRecord, 'profileId'>;
  settings!: EntityTable<SettingsRecord, 'id'>;
  conversationSync!: EntityTable<ConversationSyncRecord, 'id'>;

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
    this.version(2).stores({
      conversations: 'id, namespace, [namespace+updatedAt], updatedAt',
      profiles: 'id, kind', documents: 'id, createdAt', chunks: 'id, documentId',
      cache: 'id, conversationId, fingerprint, createdAt', secrets: 'profileId', settings: 'id',
      conversationSync: '++id, namespace, conversationId, updatedAt, [namespace+conversationId]',
    }).upgrade(async (transaction) => {
      await transaction.table<Conversation, string>('conversations').toCollection().modify((conversation) => {
        conversation.namespace = conversation.namespace || 'anonymous';
        conversation.revision = conversation.revision ?? 0;
        conversation.syncState = conversation.syncState ?? 'local-only';
      });
    });
  }
}

export const db = new StingyDatabase();
