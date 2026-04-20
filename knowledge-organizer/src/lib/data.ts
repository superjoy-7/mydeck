import { KnowledgeCard, KnowledgeBase, ChatSession } from './types';
import { BASE_PALETTES, FALLBACK_PALETTE, DYNAMIC_BASE_COLORS } from './classify';

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

/** Load all bases, migrating legacy formats. No repairBases auto-creation. */
export function loadAllBases(): KnowledgeBase[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: KnowledgeBase[] = JSON.parse(localStorage.getItem(BASES_KEY) || '[]');
    return raw.map(base => {
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
    id: nameTrimmed, // id == name for canonical lookup simplicity
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
  // Prevent name collision
  if (bases.some(b => b.id !== baseId && b.name === trimmed)) return;

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

/** Load cards, migrating legacy format (knowledge_base string → knowledgeBaseId). */
export function loadCards(): KnowledgeCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CARDS_KEY);
    if (!stored) return [];

    const bases = loadAllBases();
    const baseNameToId = new Map(bases.map(b => [b.name, b.id]));

    const rawCards: KnowledgeCard[] = JSON.parse(stored);
    return rawCards.map(card => {
      // Migrate: add knowledgeBaseId if missing
      if (!('knowledgeBaseId' in (card as object))) {
        const baseName = (card as KnowledgeCard).knowledge_base;
        const baseId = baseName ? (baseNameToId.get(baseName) ?? null) : null;
        return {
          ...(card as KnowledgeCard),
          knowledgeBaseId: baseId,
        } satisfies KnowledgeCard;
      }
      return card;
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
    c.tags.some(t => t.toLowerCase().includes(q)) ||
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
