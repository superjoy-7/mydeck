export interface KnowledgeCard {
  id: string;
  title: string;
  source_url: string;
  source_type: 'link' | 'text';
  // --- Legacy display fields (kept for backward compat + fallback) ---
  original_text: string;
  summary: string;
  key_points: string[];
  /** @deprecated Removed from primary UI — kept for backward compat during migration */
  actionable_tips?: string[];
  /** @deprecated Removed from primary UI — kept for backward compat during migration */
  tags?: string[];
  /** Stable ID reference to knowledge base entity */
  knowledgeBaseId: string | null;
  /** Legacy display field — kept for backward compatibility, synced from knowledgeBaseId */
  knowledge_base: string;
  created_at: string;
  // --- New structured fields (page rendering prefers these; fallbacks mirror legacy fields) ---
  /** Raw original input — mirrors original_text, enables full content export */
  raw_input: string;
  /** Short excerpt if source is a link */
  raw_excerpt?: string;
  /** Condensed takeaway: 2-3 sentences, replaces summary as primary display */
  core_takeaway: string;
  /** Structured bullet points — replaces key_points as primary display */
  outline_points: string[];
  /** @deprecated Removed from primary UI — kept for backward compat during migration */
  cleaned_tags?: string[];
  /** Content type for note workflow — 方法论/模板/知识库/资源库/其它 */
  note_value: 'methodology' | 'template' | 'knowledge' | 'resource' | 'other';
  /** Processing state — pending = 待整理, exported = 已导出, archived = 已归档 */
  note_status: 'pending' | 'exported' | 'archived';
  /** Last modification time */
  updated_at: string;
  /** When this card was last exported as a note */
  exported_at?: string;
  /**
   * Optional structured skeleton for framework/process/checklist content.
   * Only present when the source has a clear structural organization.
   * type: framework | process | checklist
   */
  core_structure?: {
    type: 'framework' | 'process' | 'checklist';
    title: string;
    items: string[];
  };
  /**
   * Hierarchical document outline — preserves the original heading structure.
   * Only present when the source has clear title/subtitle hierarchies.
   * Each item is a node: { title: string; children?: { title: string }[] }
   */
  outline?: OutlineNode[];
}

export type OutlineNode = {
  title: string;
  children?: OutlineChild[];
};

export type OutlineChild = {
  title: string;
  children?: { title: string }[];
};

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
