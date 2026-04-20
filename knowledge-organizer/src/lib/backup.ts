/**
 * Backup & Restore — export all MyDeck data to JSON, or restore from a backup file.
 *
 * Storage layout in localStorage:
 *   ko_cards     → KnowledgeCard[]
 *   ko_bases    → KnowledgeBase[]
 *   ko_sessions → ChatSession[]
 *
 * Backup file format (schemaVersion 2+):
 *   {
 *     "app": "MyDeck",
 *     "version": "1.0",
 *     "schemaVersion": 2,
 *     "exportedAt": "<ISO 8601>",
 *     "data": {
 *       "cards": [...],
 *       "bases": [...],        // schemaVersion 2+ — knowledge base entities
 *       "sessions": [...],
 *       "meta": { "cardCount": N, "sessionCount": N, "baseCount": N }
 *     }
 *   }
 *
 * Import strategy: full overwrite with explicit user confirmation.
 * Fallback: if bases are missing from backup, rebuild them from cards.
 */

import { KnowledgeCard, ChatSession, KnowledgeBase } from './types';
import { loadCards, saveCards, loadAllBases, saveAllBases, getBaseById } from './data';
import { loadSessions, saveSessions } from './data';
import { BASE_PALETTES, FALLBACK_PALETTE, DYNAMIC_BASE_COLORS } from './classify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupMeta {
  cardCount: number;
  sessionCount: number;
  baseCount: number;
}

export interface BackupData {
  cards: KnowledgeCard[];
  bases?: KnowledgeBase[];   // schemaVersion 2+
  sessions: ChatSession[];
  meta: BackupMeta;
}

export interface BackupManifest {
  app: string;
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
  restoredBases: number;
  restoredSessions: number;
}

// ---------------------------------------------------------------------------
// Color assignment — same logic as data.ts, needed here for fallback rebuild
// ---------------------------------------------------------------------------

function assignPalette(baseName: string, usedMainColors: Set<string>): { main: string; light: string; text: string } {
  if (BASE_PALETTES[baseName]) return BASE_PALETTES[baseName];
  for (const color of DYNAMIC_BASE_COLORS) {
    if (!usedMainColors.has(color)) return { main: color, light: '#EFF6FF', text: '#2563EB' };
  }
  return FALLBACK_PALETTE;
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

function cleanBaseForExport(base: KnowledgeBase): KnowledgeBase {
  return {
    id: base.id,
    name: base.name,
    aliases: base.aliases ?? [],
    palette: base.palette,
    createdAt: base.createdAt ?? new Date(0).toISOString(),
    updatedAt: base.updatedAt ?? new Date(0).toISOString(),
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
  const bases = loadAllBases();
  const sessions = loadSessions();

  const manifest: BackupManifest = {
    app: 'MyDeck',
    version: '1.0',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    data: {
      cards: cards.map(cleanCardForExport),
      bases: bases.map(cleanBaseForExport),
      sessions: sessions.map(cleanSessionForExport),
      meta: {
        cardCount: cards.length,
        sessionCount: sessions.length,
        baseCount: bases.length,
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
  return { ok: true, manifest, data: manifest.data as BackupData };
}

// ---------------------------------------------------------------------------
// Import — overwrite strategy with knowledge base rebuild fallback
// ---------------------------------------------------------------------------

/**
 * Rebuild knowledge base entities from cards when backup has no bases.
 * Groups cards by knowledgeBaseId (primary) or knowledge_base (legacy fallback),
 * creates base entities with stable colors, then writes both bases and updated cards.
 */
function rebuildBasesFromCards(cards: KnowledgeCard[]): KnowledgeBase[] {
  const seenNames = new Set<string>();
  const seenColors = new Set<string>();
  const result: KnowledgeBase[] = [];

  for (const card of cards) {
    // Prefer knowledgeBaseId -> base name, fallback to knowledge_base string
    const baseName = card.knowledgeBaseId
      ? (getBaseById(card.knowledgeBaseId)?.name ?? null)
      : null;
    const name = baseName ?? card.knowledge_base ?? '其他';
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const palette = assignPalette(name, seenColors);
    seenColors.add(palette.main);

    result.push({
      id: name,
      name,
      aliases: [],
      palette,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
  }

  return result;
}

export function restoreFromBackup(
  data: BackupData,
): ImportResult {
  try {
    // ---- 1. Restore cards (migrate knowledgeBaseId if missing) ----
    const validCards: KnowledgeCard[] = data.cards
      .filter(c => c && typeof c === 'object' && typeof (c as KnowledgeCard).id === 'string')
      .map(c => cleanCardForExport(c as KnowledgeCard));

    saveCards(validCards);

    // ---- 2. Restore or rebuild knowledge bases ----
    let restoredBases = 0;
    if (data.bases && data.bases.length > 0) {
      // Priority 1: restore explicit bases from backup
      const validBases: KnowledgeBase[] = data.bases
        .filter(b => b && typeof b === 'object' && typeof (b as KnowledgeBase).id === 'string')
        .map(b => ({
          id: (b as KnowledgeBase).id,
          name: (b as KnowledgeBase).name ?? (b as KnowledgeBase).id,
          aliases: (b as KnowledgeBase).aliases ?? [],
          palette: (b as KnowledgeBase).palette ?? FALLBACK_PALETTE,
          createdAt: (b as KnowledgeBase).createdAt ?? new Date(0).toISOString(),
          updatedAt: (b as KnowledgeBase).updatedAt ?? new Date(0).toISOString(),
        }));
      saveAllBases(validBases);
      restoredBases = validBases.length;
    } else {
      // Priority 2: rebuild bases from cards (handles legacy backups + early schemaVersion 1 exports)
      const rebuilt = rebuildBasesFromCards(validCards);
      saveAllBases(rebuilt);
      restoredBases = rebuilt.length;
    }

    // ---- 3. Restore sessions ----
    const validSessions: ChatSession[] = data.sessions
      .filter(s => s && typeof s === 'object' && typeof (s as ChatSession).id === 'string')
      .map(s => cleanSessionForExport(s as ChatSession));

    saveSessions(validSessions);

    const skippedCards = data.cards.length - validCards.length;
    return {
      ok: true,
      restoredCards: validCards.length,
      restoredBases,
      restoredSessions: validSessions.length,
      warning: skippedCards > 0
        ? `导入了 ${validCards.length}/${data.cards.length} 张卡片（部分数据因格式问题被跳过）。`
        : restoredBases > 0 && !data.bases
        ? `未在备份中找到知识库，已根据卡片分类自动重建了 ${restoredBases} 个知识库。`
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return { ok: false, error: `恢复失败：${msg}`, restoredCards: 0, restoredBases: 0, restoredSessions: 0 };
  }
}
