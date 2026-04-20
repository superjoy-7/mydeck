/**
 * Backup & Restore — export all MyDeck data to JSON, or restore from a backup file.
 *
 * Storage layout in localStorage:
 *   ko_cards     → KnowledgeCard[]
 *   ko_sessions → ChatSession[]
 *
 * Backup file format:
 *   {
 *     "app": "MyDeck",
 *     "version": "1.0",
 *     "schemaVersion": 1,
 *     "exportedAt": "<ISO 8601>",
 *     "data": {
 *       "cards": [...],
 *       "sessions": [...],
 *       "meta": { "cardCount": N, "sessionCount": N }
 *     }
 *   }
 *
 * Import strategy: full overwrite with explicit user confirmation.
 * (Rationale: a backup is a point-in-time snapshot; merging introduces complex
 *  id-collision rules that are confusing to debug. Overwrite is deterministic
 *  and easy to reason about for a personal, single-user app.)
 */

import { KnowledgeCard, ChatSession } from './types';
import { loadCards, saveCards } from './data';
import { loadSessions, saveSessions } from './data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupMeta {
  cardCount: number;
  sessionCount: number;
}

export interface BackupData {
  cards: KnowledgeCard[];
  sessions: ChatSession[];
  meta: BackupMeta;
}

export interface BackupManifest {
  app: 'MyDeck';
  version: string;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  warning?: string;
  restoredCards: number;
  restoredSessions: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(value: unknown, space: number = 2): string {
  return JSON.stringify(value, null, space);
}

function cleanCardForExport(card: KnowledgeCard): KnowledgeCard {
  return {
    id: card.id,
    title: card.title ?? '',
    source_url: card.source_url ?? '',
    source_type: card.source_type ?? 'text',
    original_text: card.source_type === 'link' ? '' : (card.original_text ?? ''),
    summary: card.summary ?? '',
    key_points: Array.isArray(card.key_points) ? card.key_points : [],
    actionable_tips: Array.isArray(card.actionable_tips) ? card.actionable_tips : [],
    tags: Array.isArray(card.tags) ? card.tags : [],
    knowledgeBaseId: card.knowledgeBaseId ?? null,
    knowledge_base: card.knowledge_base ?? '其他',
    created_at: card.created_at ?? new Date().toISOString(),
  };
}

function cleanSessionForExport(session: ChatSession): ChatSession {
  return {
    id: session.id,
    name: session.name ?? '未命名对话',
    scope: session.scope ?? null,
    messages: Array.isArray(session.messages)
      ? session.messages.map(msg => ({
          id: msg.id ?? '',
          role: msg.role ?? 'user',
          content: msg.content ?? '',
          referencedCards: Array.isArray(msg.referencedCards) ? msg.referencedCards : [],
          created_at: msg.created_at ?? new Date().toISOString(),
        }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportBackup(): void {
  const cards = loadCards();
  const sessions = loadSessions();

  const manifest: BackupManifest = {
    app: 'MyDeck',
    version: '1.0',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      cards: cards.map(cleanCardForExport),
      sessions: sessions.map(cleanSessionForExport),
      meta: {
        cardCount: cards.length,
        sessionCount: sessions.length,
      },
    },
  };

  const json = safeStringify(manifest);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('-');
  const filename = `mydeck-backup-${dateStr}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

export interface ValidateResult {
  ok: false;
  error: string;
  manifest?: never;
  data?: never;
}

export interface ValidateSuccess {
  ok: true;
  manifest: BackupManifest;
  data: BackupData;
}

export type ValidateImportResult = ValidateResult | ValidateSuccess;

export function validateBackupJson(raw: string): ValidateImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON 格式，请选择正确的 .json 备份文件。' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: '备份文件格式无效，无法解析。' };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.app !== 'MyDeck') {
    return { ok: false, error: `不是 MyDeck 备份文件（app="${obj.app}"）。` };
  }

  if (typeof obj.version !== 'string') {
    return { ok: false, error: '备份文件缺少 version 字段。' };
  }

  if (!obj.data || typeof obj.data !== 'object') {
    return { ok: false, error: '备份文件缺少 data 字段。' };
  }

  const data = obj.data as Record<string, unknown>;

  if (!Array.isArray(data.cards)) {
    return { ok: false, error: '备份文件 data.cards 格式无效（非数组）。' };
  }

  if (!Array.isArray(data.sessions)) {
    return { ok: false, error: '备份文件 data.sessions 格式无效（非数组）。' };
  }

  const manifest = obj as unknown as BackupManifest;
  return { ok: true, manifest, data: manifest.data };
}

// ---------------------------------------------------------------------------
// Import (overwrite strategy)
// ---------------------------------------------------------------------------

export function restoreFromBackup(
  data: BackupData,
): ImportResult {
  try {
    // Restore cards
    const validCards: KnowledgeCard[] = data.cards
      .filter(c => c && typeof c === 'object' && typeof (c as KnowledgeCard).id === 'string')
      .map(c => cleanCardForExport(c as KnowledgeCard));

    saveCards(validCards);

    // Restore sessions
    const validSessions: ChatSession[] = data.sessions
      .filter(s => s && typeof s === 'object' && typeof (s as ChatSession).id === 'string')
      .map(s => cleanSessionForExport(s as ChatSession));

    saveSessions(validSessions);

    return {
      ok: true,
      restoredCards: validCards.length,
      restoredSessions: validSessions.length,
      warning:
        validCards.length < data.cards.length
          ? `导入了 ${validCards.length}/${data.cards.length} 张卡片（部分数据因格式问题被跳过）。`
          : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return { ok: false, error: `恢复失败：${msg}`, restoredCards: 0, restoredSessions: 0 };
  }
}
