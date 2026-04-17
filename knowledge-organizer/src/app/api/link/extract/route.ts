import { NextRequest, NextResponse } from 'next/server';

export interface ExtractResult {
  ok: true;
  url: string;
  hostname: string;
  title: string;
  description: string;
  extractedText: string;
}

export interface ExtractError {
  ok: false;
  error: string;
  stage: 'url_invalid' | 'fetch_failed' | 'parse_failed' | 'content_empty' | 'content_too_short';
}

export type ExtractResponse = ExtractResult | ExtractError;

// Known noise selectors to remove
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'path',
  'nav', 'header', 'footer', 'aside',
  '.nav', '.header', '.footer', '.aside', '.sidebar',
  '#nav', '#header', '#footer', '#sidebar',
  '.menu', '.navigation', '.nav-links', '.breadcrumb',
  '.advertisement', '.ad', '.ads', '.sidebar',
  '.social', '.share', '.sharing', '.comments',
  '.related', '.recommended', '.recommend',
  '.copyright', '.legal', '.footer-links',
];

// Max content length to send to LLM (roughly 50k chars)
const MAX_TEXT_LENGTH = 50000;

function isNoiseTag(tagName: string): boolean {
  return NOISE_SELECTORS.includes(tagName.toLowerCase());
}

/**
 * Strip HTML tags and decode basic entities.
 */
function stripHtml(html: string): string {
  return html
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract content from a simple div/article-like structure.
 * Removes known noise tags first, then extracts text.
 */
function extractBodyText(html: string): string {
  let text = html;

  // Remove noise tags (scripts, styles, nav, footer, etc.)
  for (const selector of NOISE_SELECTORS) {
    // Handle tag names (e.g., 'script', 'nav')
    if (!selector.includes('.' ) && !selector.includes('#')) {
      const regex = new RegExp(`<${selector}[\\s\\S]*?<\\/${selector}>`, 'gi');
      text = text.replace(regex, ' ');
    }
  }

  // Now strip all remaining HTML
  text = stripHtml(text);

  return text;
}

/**
 * Find the largest text block — heuristic for main content.
 * Looks for <div>, <section>, <article>, <main> with substantial text.
 */
function findMainContent(html: string): string {
  // Try to find <article> or <main> first
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (articleMatch && articleMatch[1].length > 200) {
    return extractBodyText(articleMatch[1]);
  }

  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  if (mainMatch && mainMatch[1].length > 200) {
    return extractBodyText(mainMatch[1]);
  }

  // Try to find the div with the most text content
  // Simple heuristic: split by block elements and find the longest text
  const blockSplit = html.split(/<\/?(?:div|p|section|article|main|h[1-6])[^>]*>/i);
  let bestText = '';
  let bestLength = 0;

  for (const block of blockSplit) {
    const cleaned = stripHtml(block).trim();
    if (cleaned.length > bestLength) {
      bestLength = cleaned.length;
      bestText = cleaned;
    }
  }

  // Fallback: just strip all HTML and return
  if (bestLength < 100) {
    return extractBodyText(html);
  }

  return bestText;
}

/**
 * Extract <title> content.
 */
function extractTitle(html: string, fallbackUrl: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // Try og:title
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogMatch && ogMatch[1].trim()) {
    return ogMatch[1].trim();
  }

  // Try first h1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1].trim()) {
    return stripHtml(h1Match[1]).trim();
  }

  // Fallback: use hostname
  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return '未命名内容';
  }
}

/**
 * Extract meta description.
 */
function extractDescription(html: string): string {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // Try og:description
  const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (ogMatch && ogMatch[1].trim()) {
    return ogMatch[1].trim();
  }

  return '';
}

function validateUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractResponse>> {
  let url: string;

  try {
    const body = await request.json();
    url = body.url;
  } catch {
    return NextResponse.json<ExtractError>(
      { ok: false, error: '请求格式无效，请提供 JSON body。', stage: 'url_invalid' },
      { status: 400 }
    );
  }

  const validatedUrl = validateUrl(url);
  if (!validatedUrl) {
    return NextResponse.json<ExtractError>(
      { ok: false, error: '链接格式无效，请提供以 http:// 或 https:// 开头的完整网址。', stage: 'url_invalid' },
      { status: 400 }
    );
  }

  let html: string;
  let fetchOk = false;

  try {
    const response = await fetch(validatedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MyDeck/1.0; +https://mydeck.app)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      // Timeout: 15 seconds
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json<ExtractError>(
        { ok: false, error: `网页返回错误状态码 ${response.status} ${response.statusText}`, stage: 'fetch_failed' },
        { status: 200 }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return NextResponse.json<ExtractError>(
        { ok: false, error: `该链接内容不是网页（Content-Type: ${contentType}），无法提取正文。`, stage: 'fetch_failed' },
        { status: 200 }
      );
    }

    html = await response.text();
    fetchOk = true;
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json<ExtractError>(
        { ok: false, error: '网页加载超时（15秒），目标站点响应过慢或无法访问。', stage: 'fetch_failed' },
        { status: 200 }
      );
    }
    return NextResponse.json<ExtractError>(
      { ok: false, error: `无法访问该链接：${err instanceof Error ? err.message : '网络错误'}`, stage: 'fetch_failed' },
      { status: 200 }
    );
  }

  if (!fetchOk || !html) {
    return NextResponse.json<ExtractError>(
      { ok: false, error: '网页内容为空，无法提取正文。', stage: 'content_empty' },
      { status: 200 }
    );
  }

  try {
    const hostname = new URL(validatedUrl).hostname;
    const title = extractTitle(html, validatedUrl);
    const description = extractDescription(html);
    let extractedText = findMainContent(html);

    // Basic cleanup
    extractedText = extractedText.replace(/\s+/g, ' ').trim();

    // Check minimum content
    if (extractedText.length < 50) {
      return NextResponse.json<ExtractError>(
        { ok: false, error: '网页正文过短（少于50字），无法生成有效卡片内容。', stage: 'content_too_short' },
        { status: 200 }
      );
    }

    // Truncate if too long
    let truncated = false;
    if (extractedText.length > MAX_TEXT_LENGTH) {
      extractedText = extractedText.substring(0, MAX_TEXT_LENGTH);
      truncated = true;
    }

    // Remove trailing incomplete sentence if truncated
    if (truncated) {
      const lastPeriod = extractedText.lastIndexOf('。');
      const lastNewline = extractedText.lastIndexOf('\n');
      const cutoff = Math.max(lastPeriod, lastNewline);
      if (cutoff > MAX_TEXT_LENGTH * 0.7) {
        extractedText = extractedText.substring(0, cutoff + 1);
      }
    }

    return NextResponse.json<ExtractResult>({
      ok: true,
      url: validatedUrl,
      hostname,
      title,
      description,
      extractedText,
    });
  } catch (err) {
    return NextResponse.json<ExtractError>(
      { ok: false, error: `网页解析失败：${err instanceof Error ? err.message : '未知错误'}`, stage: 'parse_failed' },
      { status: 200 }
    );
  }
}
