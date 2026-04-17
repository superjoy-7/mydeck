import { NextRequest, NextResponse } from 'next/server';
import { normalizeBase } from '@/lib/classify';

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

你会收到一段内容（可能来自网页、文章或笔记），请提取以下信息：
1. title: 简洁有力的标题（不超过50字）
2. summary: 100-150字的摘要
3. key_points: 3-5个核心要点（每个不超过80字）
4. actionable_tips: 1-2条可执行的建议（如果有可执行内容的话，否则空数组）
5. tags: 3-6个标签词
6. knowledge_base: 知识库分类名（从以下稳定分类中选择一个最合适的，或填"其他"）：
   - AI工具：具体AI产品/工具的使用技巧、对比、测评
   - 多模型平台：整合多个AI模型的平台（OpenRouter、Cherry Studio等）
   - Vibe Coding：AI辅助编程、Design-to-Code相关
   - AIGC：图像/视频生成AI工具（Midjourney、SD等）
   - 知识管理：笔记工具、知识整理方法
   - 品牌设计：视觉设计、UI/UX、品牌相关
   - 内容平台：社交/内容平台运营（小红书、抖音、B站等）
   - 运营灵感：增长、获客、转化、运营策略
   - 内容方法论：写作技巧、内容创作方法
   - 产品/商业观察：产品分析、商业模式、行业观察
   - 医疗健康：医疗、健康、医药相关
   - 节假日：法定节假日、假期安排、节日庆典（春节、国庆等）
   - 其他：无法归入以上分类的内容

【重要原则】
- 尽量选择具体分类（如"AI工具"、"多模型平台"），避免动不动就用"其他"
- "AIGC"专指AI生成图像/视频，不要把AI工具类产品也归到这里
- 分类名必须从上面列表中选择，不要自己发明新分类名

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

    // Normalize the LLM-suggested knowledge base to our canonical list
    const rawBase = parsed.knowledge_base || '其他';
    const suggestedBase = normalizeBase(rawBase);

    return NextResponse.json({
      title: parsed.title || '未命名内容',
      summary: parsed.summary || content.substring(0, 120),
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5) : [],
      actionable_tips: Array.isArray(parsed.actionable_tips) ? parsed.actionable_tips.slice(0, 2) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
      suggested_base: suggestedBase,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
