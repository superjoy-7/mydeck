/**
 * Client-safe LLM utilities.
 *
 * Architecture:
 * - page.tsx (browser) calls functions here
 * - These functions call Next.js API routes (/api/llm/card, /api/llm/chat, /api/llm/vision)
 * - API routes run on the server and read .env.local (OPENAI_API_KEY etc.)
 * - llm.ts itself never reads process.env directly — only NEXT_PUBLIC_ vars
 *   are embedded in the browser bundle at build time.
 */

export interface CardReference {
  id: string;
  title: string;
  summary: string;
  key_points: string[];
}

// Check if LLM is configured by calling the server-side debug endpoint.
// Never reads sensitive env vars directly on the client.
let _llmConfiguredCache: boolean | null = null;

export async function isLLMConfiguredAsync(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (_llmConfiguredCache !== null) return _llmConfiguredCache;
  try {
    const res = await fetch('/api/llm/debug');
    if (!res.ok) {
      _llmConfiguredCache = false;
      return false;
    }
    const data = await res.json();
    _llmConfiguredCache = !!data.allConfigured;
    return _llmConfiguredCache;
  } catch {
    _llmConfiguredCache = false;
    return false;
  }
}

// Synchronous version — only valid after the async version has been called at least once.
// For the initial render, use the async version in a useEffect.
export function isLLMConfigured(): boolean {
  return _llmConfiguredCache ?? false;
}

// --- Knowledge Card Generation (text input) ---

export async function generateKnowledgeCard(
  content: string,
  sourceUrl: string,
  existingBases?: string[],
): Promise<{
  title: string;
  summary: string;
  key_points: string[];
  suggested_base: string;
  // New structured fields
  raw_input: string;
  core_takeaway: string;
  outline_points: string[];
  note_value: 'methodology' | 'template' | 'knowledge' | 'resource' | 'other';
  core_structure?: {
    type: 'framework' | 'process' | 'checklist';
    title: string;
    items: string[];
  };
  outline?: {
    title: string;
    children?: {
      title: string;
      children?: { title: string }[];
    }[];
  }[];
}> {
  const response = await fetch('/api/llm/card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, sourceUrl, existingBases }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error ${response.status}`);
  }

  return response.json();
}

// --- Knowledge Chat ---

export async function generateChatResponse(
  userQuery: string,
  cards: CardReference[],
  prevMessages: { role: 'user' | 'assistant'; content: string }[],
): Promise<{ response: string; referencedCards: string[] }> {
  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userQuery, cards, prevMessages }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error ${response.status}`);
  }

  return response.json();
}

// --- Image Understanding ---

export async function understandImage(
  imageBase64: string,
  text?: string,
  existingBases?: string[],
): Promise<{
  title: string;
  summary: string;
  key_points: string[];
  suggested_base: string;
  // New structured fields
  raw_input: string;
  core_takeaway: string;
  outline_points: string[];
  note_value: 'methodology' | 'template' | 'knowledge' | 'resource' | 'other';
  core_structure?: {
    type: 'framework' | 'process' | 'checklist';
    title: string;
    items: string[];
  };
  outline?: {
    title: string;
    children?: {
      title: string;
      children?: { title: string }[];
    }[];
  }[];
}> {
  const response = await fetch('/api/llm/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, text, existingBases }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error ${response.status}`);
  }

  return response.json();
}

// --- Link Extraction ---

export interface ExtractSuccess {
  ok: true;
  url: string;
  hostname: string;
  title: string;
  description: string;
  extractedText: string;
}

export interface ExtractFailure {
  ok: false;
  error: string;
  stage: 'url_invalid' | 'fetch_failed' | 'parse_failed' | 'content_empty' | 'content_too_short';
}

export type ExtractResponse = ExtractSuccess | ExtractFailure;

export async function extractLinkContent(url: string): Promise<ExtractSuccess> {
  const response = await fetch('/api/link/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data: ExtractFailure | ExtractSuccess = await response.json();

  if (!data.ok) {
    const err = new Error(data.error);
    (err as Error & { stage: string }).stage = data.stage;
    throw err;
  }

  return data;
}
