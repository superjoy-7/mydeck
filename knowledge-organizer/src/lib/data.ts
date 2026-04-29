import { KnowledgeCard, KnowledgeBase, ChatSession, generateId } from './types';
import { BASE_PALETTES, FALLBACK_PALETTE, DYNAMIC_BASE_COLORS } from './classify';

/** Map legacy note_value strings to the current 5-type system */
function migrateNoteValue(raw: string | undefined): KnowledgeCard['note_value'] {
  if (!raw) return 'other';
  const map: Record<string, KnowledgeCard['note_value']> = {
    // Legacy values → current values
    method: 'methodology', idea: 'methodology', reference: 'methodology',
    template: 'template',
    concept: 'knowledge',
    resource: 'resource',
    // Legacy archive/pending → other
    archive: 'other', pending: 'other',
  };
  return map[raw] ?? 'other';
}

const CARDS_KEY = 'ko_cards';
const BASES_KEY = 'ko_bases';
const SESSIONS_KEY = 'ko_sessions';

// ---------------------------------------------------------------------------
// Unified color assignment — stable, conflict-free, palette-aware
// ---------------------------------------------------------------------------

/** Assign a palette for a new base, avoiding colors already used by existing bases. */
function assignPalette(baseName: string, usedMainColors: Set<string>): { main: string; light: string; text: string } {
  // 1. Canonical preset (by name)
  if (BASE_PALETTES[baseName]) return BASE_PALETTES[baseName];
  // 2. First unused from dynamic pool
  for (const palette of DYNAMIC_BASE_COLORS) {
    if (!usedMainColors.has(palette.main)) return palette;
  }
  // 3. Deterministic fallback
  return FALLBACK_PALETTE;
}

// ---------------------------------------------------------------------------
// Knowledge Base CRUD — independent, persistent entities
// ---------------------------------------------------------------------------

/** Load all bases, migrating legacy formats + deduplicating. No repairBases auto-creation. */
export function loadAllBases(): KnowledgeBase[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: KnowledgeBase[] = JSON.parse(localStorage.getItem(BASES_KEY) || '[]');

    // Deduplicate by id: keep the one with latest updatedAt when duplicates exist
    const seenIds = new Map<string, KnowledgeBase>();
    for (const base of raw) {
      const existing = seenIds.get(base.id);
      if (!existing) {
        seenIds.set(base.id, base);
      } else {
        // Keep whichever has more recent updatedAt
        const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const incomingTime = base.updatedAt ? new Date(base.updatedAt).getTime() : 0;
        if (incomingTime > existingTime) {
          seenIds.set(base.id, base);
        }
      }
    }

    const deduplicated = Array.from(seenIds.values());

    return deduplicated.map(base => {
      // Migrate legacy format (color string, missing updatedAt, missing aliases)
      const legacy = base as unknown as { color?: string };
      return {
        id: base.id,
        name: base.name,
        aliases: base.aliases ?? [],
        createdAt: base.createdAt || new Date(0).toISOString(),
        updatedAt: (base as KnowledgeBase).updatedAt || new Date(0).toISOString(),
        palette: (() => {
          if (!base.palette) {
            return legacy.color
              ? (DYNAMIC_BASE_COLORS.find(p => p.main === legacy.color) ?? FALLBACK_PALETTE)
              : FALLBACK_PALETTE;
          }
          // Re-assign if saved with old buggy blue placeholder
          if (base.palette.light === '#EFF6FF' && base.palette.text === '#2563EB') {
            return DYNAMIC_BASE_COLORS.find(p => p.main === base.palette.main) ?? FALLBACK_PALETTE;
          }
          return base.palette;
        })(),
      } satisfies KnowledgeBase;
    });
  } catch {
    return [];
  }
}

export function saveAllBases(bases: KnowledgeBase[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(BASES_KEY, JSON.stringify(bases));
}

/** Create a new knowledge base entity with stable id + palette. Returns the new base. */
export function createKnowledgeBase(name: string): KnowledgeBase {
  const nameTrimmed = name.trim();
  if (!nameTrimmed) throw new Error('分类名称不能为空');

  const bases = loadAllBases();
  // Prevent duplicate names
  if (bases.some(b => b.name === nameTrimmed)) {
    throw new Error('该分类已存在');
  }

  const usedMainColors = new Set(bases.map(b => b.palette.main));
  const palette = assignPalette(nameTrimmed, usedMainColors);
  const now = new Date().toISOString();

  const newBase: KnowledgeBase = {
    id: generateId(),
    name: nameTrimmed,
    aliases: [],
    palette,
    createdAt: now,
    updatedAt: now,
  };

  saveAllBases([...bases, newBase]);
  return newBase;
}

/** Rename a knowledge base. Preserves old name in aliases for AI resolution. */
export function renameKnowledgeBase(baseId: string, newName: string): void {
  const bases = loadAllBases();
  const idx = bases.findIndex(b => b.id === baseId);
  if (idx === -1) return;

  const trimmed = newName.trim();
  if (!trimmed) return;
  // If the new name is the same as current name, this is a no-op
  if (bases[idx].name === trimmed) return;
  // Prevent any name collision with other bases
  if (bases.some(b => b.name === trimmed)) return;

  const oldName = bases[idx].name;
  // Push old name to aliases so AI results matching the old name still resolve correctly
  const aliases = oldName !== trimmed && !bases[idx].aliases.includes(oldName)
    ? [...bases[idx].aliases, oldName]
    : bases[idx].aliases;

  bases[idx] = {
    ...bases[idx],
    name: trimmed,
    aliases,
    updatedAt: new Date().toISOString(),
  };
  saveAllBases(bases);
}

/** Delete a knowledge base. Its cards have knowledgeBaseId set to null (cards are preserved). */
export function deleteKnowledgeBase(baseId: string): number {
  const bases = loadAllBases();
  const base = bases.find(b => b.id === baseId);
  if (!base) return 0;

  saveAllBases(bases.filter(b => b.id !== baseId));

  // Cascade delete: remove all cards belonging to this base
  const cards = loadCards();
  const remaining = cards.filter(c => c.knowledgeBaseId !== baseId);
  const deletedCount = cards.length - remaining.length;
  saveCards(remaining);

  return deletedCount;
}

/** Get all bases sorted by creation time (oldest first). */
export function getAllBases(): KnowledgeBase[] {
  return loadAllBases().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Get a single base by id. */
export function getBaseById(baseId: string): KnowledgeBase | undefined {
  return loadAllBases().find(b => b.id === baseId);
}

/**
 * Resolve a knowledge base from an AI-suggested category name.
 * 1. Exact match on current name (case-insensitive)
 * 2. Exact match on any alias (case-insensitive) — handles renamed bases
 * 3. Canonical base name (from CANONICAL_BASES) not yet created → auto-create it
 * Returns the matching base, or null if no match.
 */
export function resolveKnowledgeBaseFromAIResult(suggestedName: string): KnowledgeBase | null {
  if (!suggestedName) return null;
  const trimmed = suggestedName.trim();
  if (!trimmed) return null;
  const bases = loadAllBases();
  const lower = trimmed.toLowerCase();

  // Priority 1: exact match on current name
  const byName = bases.find(b => b.name.toLowerCase() === lower);
  if (byName) return byName;

  // Priority 2: exact match on any alias (handles rename history)
  for (const base of bases) {
    if (base.aliases.some(a => a.toLowerCase() === lower)) {
      return base;
    }
  }

  // Priority 3: canonical base name not yet created → auto-create it
  const canonicalNames = [
    'AI工具', '多模型平台', 'Vibe Coding', 'AIGC',
    '内容方法论', '内容平台',
    '产品/商业观察', '运营灵感',
    '知识管理', '品牌设计',
    '医疗健康', '节假日',
    '其他',
  ];
  if (canonicalNames.includes(trimmed)) {
    // Safeguard: if a base with this name already exists (even if id != name due to past bugs), use it
    const existingByName = bases.find(b => b.name === trimmed);
    if (existingByName) return existingByName;
    try {
      const newBase = createKnowledgeBase(trimmed);
      return newBase;
    } catch {
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Card Storage + Legacy Migration
// ---------------------------------------------------------------------------

/** Load cards, migrating legacy format (knowledge_base string → knowledgeBaseId) and new fields. */
export function loadCards(): KnowledgeCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CARDS_KEY);
    if (!stored) return [];

    const bases = loadAllBases();
    const baseNameToId = new Map(bases.map(b => [b.name, b.id]));

    const rawCards: KnowledgeCard[] = JSON.parse(stored);
    return rawCards.map(card => {
      // Migrate: add knowledgeBaseId if missing (legacy)
      let knowledgeBaseId = (card as KnowledgeCard).knowledgeBaseId as string | null;
      if (knowledgeBaseId === undefined) {
        const baseName = (card as KnowledgeCard).knowledge_base;
        knowledgeBaseId = baseName ? (baseNameToId.get(baseName) ?? null) : null;
      }

      // Migrate: new structured fields default to mirrored legacy fields
      const raw = card as KnowledgeCard;
      const now = new Date().toISOString();

      return {
        ...raw,
        knowledgeBaseId,
        // New structured fields: fall back from legacy equivalents
        raw_input:        raw.raw_input        ?? raw.original_text ?? '',
        core_takeaway:    raw.core_takeaway    ?? raw.summary        ?? '',
        outline_points:   raw.outline_points   ?? raw.key_points      ?? [],
        cleaned_tags:     raw.cleaned_tags     ?? (Array.isArray(raw.tags) ? raw.tags : []),
        // Status fields: sensible defaults for old cards
        note_value:       migrateNoteValue(raw.note_value),
        note_status:      raw.note_status      ?? 'pending',
        updated_at:       raw.updated_at       ?? raw.created_at      ?? now,
      } satisfies KnowledgeCard;
    });
  } catch {
    return [];
  }
}

export function saveCards(cards: KnowledgeCard[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

export function addCard(card: KnowledgeCard): void {
  const cards = loadCards();
  cards.unshift(card);
  saveCards(cards);
}

export function deleteCard(cardId: string): void {
  const cards = loadCards();
  saveCards(cards.filter(c => c.id !== cardId));
}

/** Update a card's note_status and related timestamps. Returns the updated card, or null. */
export function updateCardStatus(
  cardId: string,
  status: KnowledgeCard['note_status'],
): KnowledgeCard | null {
  const cards = loadCards();
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const updates: Partial<KnowledgeCard> = {
    note_status: status,
    updated_at: now,
  };
  if (status === 'exported') updates.exported_at = now;

  cards[idx] = { ...cards[idx], ...updates };
  saveCards(cards);
  return cards[idx];
}

/** Update a card's note_value (content type). Returns the updated card, or null. */
export function updateCardNoteValue(
  cardId: string,
  noteValue: KnowledgeCard['note_value'],
): KnowledgeCard | null {
  const cards = loadCards();
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx === -1) return null;

  cards[idx] = {
    ...cards[idx],
    note_value: noteValue,
    updated_at: new Date().toISOString(),
  };
  saveCards(cards);
  return cards[idx];
}

/**
 * Update note_status for multiple cards at once.
 * Returns the count of updated cards.
 */
export function bulkUpdateCardStatus(
  cardIds: string[],
  status: KnowledgeCard['note_status'],
): number {
  if (cardIds.length === 0) return 0;
  const cards = loadCards();
  const now = new Date().toISOString();
  const idSet = new Set(cardIds);
  let count = 0;

  for (let i = 0; i < cards.length; i++) {
    if (idSet.has(cards[i].id)) {
      const updates: Partial<KnowledgeCard> = {
        note_status: status,
        updated_at: now,
      };
      if (status === 'exported') updates.exported_at = now;
      cards[i] = { ...cards[i], ...updates };
      count++;
    }
  }

  if (count > 0) saveCards(cards);
  return count;
}

/**
 * Get cards filtered by note_status.
 * Use for "export selected" / incremental export scenarios.
 */
export function getCardsByStatus(status: KnowledgeCard['note_status']): KnowledgeCard[] {
  return loadCards().filter(c => c.note_status === status);
}

/**
 * Get cards by knowledge base AND note_status (for filtered incremental export).
 */
export function getCardsByBaseAndStatus(
  baseId: string | null,
  status: KnowledgeCard['note_status'],
): KnowledgeCard[] {
  return loadCards().filter(c =>
    c.knowledgeBaseId === baseId && c.note_status === status,
  );
}

/**
 * Get all cards with note_status = 'pending' (default "ready to export" pool).
 */
export function getSelectedCards(): KnowledgeCard[] {
  return getCardsByStatus('pending');
}

/**
 * Move a card to a different knowledge base.
 * @returns the updated card, or null if not found
 */
export function moveCardToKnowledgeBase(cardId: string, knowledgeBaseId: string | null): KnowledgeCard | null {
  const cards = loadCards();
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx === -1) return null;

  const base = knowledgeBaseId ? getBaseById(knowledgeBaseId) : null;
  cards[idx] = {
    ...cards[idx],
    knowledgeBaseId,
    knowledge_base: base?.name ?? '',
  };
  saveCards(cards);
  return cards[idx];
}

/**
 * Create a new knowledge base AND move a card into it in one atomic step.
 * Returns the new base (card is updated as a side effect).
 */
export function createKnowledgeBaseAndMoveCard(cardId: string, baseName: string): KnowledgeBase | null {
  const newBase = createKnowledgeBase(baseName);
  const updated = moveCardToKnowledgeBase(cardId, newBase.id);
  if (!updated) return null;
  return newBase;
}

/** Filter cards by base id (or all cards if baseId is null/'all'). */
export function getCardsByBase(baseId: string | null): KnowledgeCard[] {
  const cards = loadCards();
  if (!baseId || baseId === 'all') return cards;
  return cards.filter(c => c.knowledgeBaseId === baseId);
}

/** Search cards by text across title, summary, tags, key_points. */
export function searchCards(query: string, baseId?: string | null): KnowledgeCard[] {
  let cards = loadCards();
  if (baseId && baseId !== 'all') {
    cards = cards.filter(c => c.knowledgeBaseId === baseId);
  }
  if (!query.trim()) return cards;
  const q = query.toLowerCase();
  return cards.filter(c =>
    c.title.toLowerCase().includes(q) ||
    c.summary.toLowerCase().includes(q) ||
    (c.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
    c.key_points.some(p => p.toLowerCase().includes(q))
  );
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Real-time card count for a given base id — derived from current localStorage. */
export function getBaseCardCount(baseId: string): number {
  return loadCards().filter(c => c.knowledgeBaseId === baseId).length;
}

/** Real-time total card count. */
export function getTotalCardCount(): number {
  return loadCards().length;
}

/** Get palette for a base id. Reads from stored base first, falls back to presets. */
export function getBasePalette(baseId: string): { main: string; light: string; text: string } {
  const base = getBaseById(baseId);
  if (base) return base.palette;
  return BASE_PALETTES[baseId] ?? FALLBACK_PALETTE;
}

export function getBaseColor(baseId: string): string {
  return getBasePalette(baseId).main;
}

export function getBaseName(baseId: string): string {
  const base = getBaseById(baseId);
  return base?.name || baseId;
}

/** All known base names and aliases — used for LLM context only, not for rendering. */
export function getAllBaseNames(): string[] {
  const names = new Set<string>();
  for (const base of loadAllBases()) {
    names.add(base.name);
    for (const alias of base.aliases) names.add(alias);
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Sessions Storage
// ---------------------------------------------------------------------------

export function loadSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}
