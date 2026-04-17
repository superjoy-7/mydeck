import { KnowledgeCard, KnowledgeBase, generateId } from './types';
import { BASE_PALETTES, FALLBACK_PALETTE, DYNAMIC_BASE_COLORS } from './classify';

const CARDS_KEY = 'ko_cards';
const SESSIONS_KEY = 'ko_sessions';

// --- Card Storage ---

export function loadCards(): KnowledgeCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CARDS_KEY);
    return stored ? JSON.parse(stored) : [];
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
  const filtered = cards.filter(c => c.id !== cardId);
  saveCards(filtered);
}

export function getCardsByBase(baseId: string | null): KnowledgeCard[] {
  const cards = loadCards();
  if (!baseId || baseId === 'all') return cards;
  return cards.filter(c => c.knowledge_base === baseId);
}

export function searchCards(query: string, baseId?: string | null): KnowledgeCard[] {
  let cards = loadCards();
  if (baseId && baseId !== 'all') {
    cards = cards.filter(c => c.knowledge_base === baseId);
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

// --- Dynamic Knowledge Bases ---

export function getDynamicKnowledgeBases(): KnowledgeBase[] {
  const cards = loadCards();
  const baseMap = new Map<string, { name: string; count: number }>();

  cards.forEach(card => {
    const existing = baseMap.get(card.knowledge_base);
    if (existing) {
      existing.count++;
    } else {
      baseMap.set(card.knowledge_base, { name: card.knowledge_base, count: 1 });
    }
  });

  const bases: KnowledgeBase[] = [];
  let colorIndex = 0;
  baseMap.forEach((value, id) => {
    const palette = BASE_PALETTES[id] ?? {
      main: DYNAMIC_BASE_COLORS[colorIndex % DYNAMIC_BASE_COLORS.length],
      light: '#EFF6FF',
      text: '#2563EB',
    };
    bases.push({ id, name: value.name, color: palette.main });
    colorIndex++;
  });

  return bases.sort((a, b) => {
    const aCount = cards.filter(c => c.knowledge_base === a.id).length;
    const bCount = cards.filter(c => c.knowledge_base === b.id).length;
    return bCount - aCount;
  });
}

export function getKnowledgeBaseName(baseId: string): string {
  const bases = getDynamicKnowledgeBases();
  const found = bases.find(b => b.id === baseId);
  return found?.name || baseId;
}

export function getKnowledgeBaseColor(baseId: string): string {
  const bases = getDynamicKnowledgeBases();
  const found = bases.find(b => b.id === baseId);
  return found?.color || '#4E90F5';
}

// Returns { main, light, text } for a given knowledge base id
export function getKnowledgeBasePalette(baseId: string): { main: string; light: string; text: string } {
  return BASE_PALETTES[baseId] ?? FALLBACK_PALETTE;
}

// --- Sessions Storage ---

export function loadSessions(): import('@/lib/types').ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: import('@/lib/types').ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}