import { KnowledgeCard, KnowledgeBase, generateId } from './types';

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

// Named theme palettes per knowledge base — each has a main color + light bg + tint text
const THEME_PALETTES: Record<string, { main: string; light: string; text: string }> = {
  'Vibe Coding':     { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  'Claude':         { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  'AIGC':           { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  '品牌设计':        { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  '医疗健康':        { main: '#769365', light: '#EDF3EB', text: '#4E6B42' },
  '知识管理':        { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '内容平台':        { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '运营灵感':        { main: '#769365', light: '#EDF3EB', text: '#4E6B42' },
  '内容方法论':      { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '产品/商业观察':   { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  '其他':           { main: '#42423A', light: '#F0F1F0', text: '#42423A' },
};

const FALLBACK_PALETTE = { main: '#769365', light: '#EDF3EB', text: '#4E6B42' };
const BASE_COLORS = [
  '#769365', '#749AB2', '#C6D6E5', '#5D4C68',
  '#8A9199', '#A8BCCC', '#5DA29D', '#C77DBA'
];

export function getDynamicKnowledgeBases(): KnowledgeBase[] {
  const cards = loadCards();
  const baseMap = new Map<string, { name: string; count: number }>();

  cards.forEach(card => {
    const existing = baseMap.get(card.knowledge_base);
    if (existing) {
      existing.count++;
    } else {
      const name = (card.knowledge_base && card.knowledge_base !== '其他')
        ? card.knowledge_base
        : (card.tags[0] || card.knowledge_base);
      baseMap.set(card.knowledge_base, { name, count: 1 });
    }
  });

  const bases: KnowledgeBase[] = [];
  let colorIndex = 0;
  baseMap.forEach((value, id) => {
    const palette = THEME_PALETTES[id] ?? { main: BASE_COLORS[colorIndex % BASE_COLORS.length], light: '#EFF6FF', text: '#2563EB' };
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
  return THEME_PALETTES[baseId] ?? FALLBACK_PALETTE;
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