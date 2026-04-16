import { NextRequest, NextResponse } from 'next/server';

// Server-side only: reads .env.local (never exposed to browser)
function getServerLLMConfig() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = process.env.OPENAI_BASE_URL || '';
  const model = process.env.OPENAI_MODEL || '';
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl, model };
}

async function chatCompletion(
  config: { apiKey: string; baseUrl: string; model: string },
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  temperature = 0.5,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

const CARD_SYSTEM_PROMPT = `你是一个专业的内容整理助手，负责将用户输入的内容提炼为结构化知识卡片。

你会收到一段内容（可能来自小红书帖子、文章或笔记），请提取以下信息：
1. title: 简洁有力的标题（不超过50字）
2. summary: 100-150字的摘要
3. key_points: 3-5个核心要点（每个不超过80字）
4. actionable_tips: 1-2条可执行的建议（如果有可执行内容的话，否则空数组）
5. tags: 3-6个标签词

【分类要求 — 非常重要】
请根据内容的主题来生成一个简洁、具体、贴近核心主题的分类名。
优先使用具体的产品/技术/品牌名称作为分类（如"Claude"、"AIGC"、"Vibe Coding"、"品牌设计"、"医疗健康"），而不是宽泛的上位类。
只在内容确实非常通用、无法归入任何具体主题时才使用"其他"。

【推荐分类参考】
- Claude / Claude Code / AI工具使用经验
- AIGC / 生成式AI / AI工作流
- Vibe Coding / Design-to-Code / AI编程
- 品牌设计 / 视觉设计 / UI设计
- 医疗健康 / 生物医药
- 运营灵感 / 增长策略 / 私域运营
- 内容方法论 / 创作技巧 / 写作方法
- 产品/商业观察 / 行业分析 / 商业模式

请以JSON格式返回，不要包含任何其他内容。`;

export async function POST(request: NextRequest) {
  const config = getServerLLMConfig();
  if (!config) {
    return NextResponse.json({ error: 'LLM not configured on server' }, { status: 500 });
  }

  const body = await request.json();
  const { content, sourceUrl } = body as { content: string; sourceUrl: string };

  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const userContent = sourceUrl
    ? `内容来源: ${sourceUrl}\n\n${content}`
    : content;

  try {
    const result = await chatCompletion(
      config,
      [
        { role: 'system', content: CARD_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      0.5,
    );

    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse LLM response as JSON' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      title: parsed.title || '未命名内容',
      summary: parsed.summary || content.substring(0, 120),
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5) : [],
      actionable_tips: Array.isArray(parsed.actionable_tips) ? parsed.actionable_tips.slice(0, 2) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
