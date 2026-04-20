export interface KnowledgeCard {
  id: string;
  title: string;
  source_url: string;
  source_type: 'link' | 'text';
  original_text: string;
  summary: string;
  key_points: string[];
  actionable_tips: string[];
  tags: string[];
  /** Stable ID reference to knowledge base entity */
  knowledgeBaseId: string | null;
  /** Legacy display field — kept for backward compatibility, synced from knowledgeBaseId */
  knowledge_base: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  referencedCards: string[];
  created_at: string;
}

export interface ChatSession {
  id: string;
  name: string;
  scope: string | null;
  messages: ChatMessage[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  /** Historical names — populated when a base is renamed, enables AI alias resolution */
  aliases: string[];
  /** Persisted palette */
  palette: { main: string; light: string; text: string };
  /** When this base was first created */
  createdAt: string;
  /** When this base was last updated */
  updatedAt: string;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// Extract meaningful title from text (first meaningful line)
export function extractTitle(text: string): string {
  const lines = text.split('\n').filter(l => l.trim().length > 5);
  const firstLine = lines[0] || '未命名内容';
  return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;
}

// Validate if a URL is a valid Xiaohongshu link
export function isValidXiaohongshuUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('xiaohongshu.com') ||
           parsed.hostname.includes('xhslink.com');
  } catch {
    return false;
  }
}
