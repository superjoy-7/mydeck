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
  for (const color of DYNAMIC_BASE_COLORS) {
    if (!usedMainColors.has(color)) return { main: color, light: '#EFF6FF', text: '#2563EB' };
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
      // Migrate legacy format (color string or missing updatedAt)
      const legacy = base as unknown as { color?: string };
      return {
        id: base.id,
        name: base.name,
        createdAt: base.createdAt || new Date(0).toISOString(),
        updatedAt: (base as KnowledgeBase).updatedAt || new Date(0).toISOString(),
        palette: base.palette ?? (
          legacy.color
            ? { main: legacy.color, light: '#EFF6FF', text: '#2563EB' }
            : FALLBACK_PALETTE
        ),
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
    palette,
    createdAt: now,
    updatedAt: now,
  };

  saveAllBases([...bases, newBase]);
  return newBase;
}

/** Rename a knowledge base. Only the name is updated, cards are untouched. */
export function renameKnowledgeBase(baseId: string, newName: string): void {
  const bases = loadAllBases();
  const idx = bases.findIndex(b => b.id === baseId);
  if (idx === -1) return;

  const trimmed = newName.trim();
  if (!trimmed) return;
  // Prevent name collision
  if (bases.some(b => b.id !== baseId && b.name === trimmed)) return;

  bases[idx] = { ...bases[idx], name: trimmed, updatedAt: new Date().toISOString() };
  saveAllBases(bases);
}

/** Delete a knowledge base. Its cards have knowledgeBaseId set to null (cards are preserved). */
export function deleteKnowledgeBase(baseId: string): number {
  const bases = loadAllBases();
  const base = bases.find(b => b.id === baseId);
  if (!base) return 0;

  saveAllBases(bases.filter(b => b.id !== baseId));

  // Clear knowledgeBaseId on all cards that belonged to this base (don't delete cards)
  const cards = loadCards();
  let movedCount = 0;
  const updated = cards.map(c => {
    if (c.knowledgeBaseId === baseId) {
      movedCount++;
      return { ...c, knowledgeBaseId: null };
    }
    return c;
  });
  if (movedCount > 0) saveCards(updated);

  return movedCount;
}

/** Get all bases sorted by creation time (oldest first). */
export function getAllBases(): KnowledgeBase[] {
  return loadAllBases().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Get a single base by id. */
export function getBaseById(baseId: string): KnowledgeBase | undefined {
  return loadAllBases().find(b => b.id === baseId);
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

/** All known base names — used for LLM context only, not for rendering. */
export function getAllBaseNames(): string[] {
  return loadAllBases().map(b => b.name);
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
