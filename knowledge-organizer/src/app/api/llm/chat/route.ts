import { NextRequest, NextResponse } from 'next/server';

interface CardReference {
  id: string;
  title: string;
  summary: string;
  key_points: string[];
  tags: string[];
}

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
  temperature = 0.7,
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

const CHAT_SYSTEM_PROMPT = `你是一个基于本地知识库的助手。用户会根据知识库中的卡片内容提问，请根据卡片内容给出有帮助的回答。

当用户提问时：
1. 结合相关卡片的内容进行回答
2. 如果是总结类问题，提炼共同主题
3. 如果是对比类问题，指出异同
4. 如果是可执行建议类问题，给出具体建议
5. 如果知识库内容不足以回答，说明情况

直接回答，不需要询问其他问题。`;

export async function POST(request: NextRequest) {
  const config = getServerLLMConfig();
  if (!config) {
    return NextResponse.json({ error: 'LLM not configured on server' }, { status: 500 });
  }

  const body = await request.json();
  const { userQuery, cards, prevMessages } = body as {
    userQuery: string;
    cards: CardReference[];
    prevMessages: { role: 'user' | 'assistant'; content: string }[];
  };

  if (!userQuery) {
    return NextResponse.json({ error: 'userQuery is required' }, { status: 400 });
  }

  if (!cards || cards.length === 0) {
    return NextResponse.json({ response: '当前知识库为空，请先导入内容。', referencedCards: [] });
  }

  // Build context from cards
  const cardContext = cards
    .map((c, i) => `【卡片 ${i + 1}】${c.title}\n${c.summary}\n要点: ${c.key_points.join('、')}\n标签: ${c.tags.join(', ')}`)
    .join('\n\n');

  // Build conversation history
  const historyContext = prevMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
  ];

  if (historyContext) {
    messages.push({
      role: 'user',
      content: `对话历史：\n${historyContext}\n\n知识库内容：\n${cardContext}`,
    });
    messages.push({ role: 'user', content: userQuery });
  } else {
    messages.push({
      role: 'user',
      content: `知识库内容：\n${cardContext}\n\n用户问题：${userQuery}`,
    });
  }

  try {
    const response = await chatCompletion(config, messages, 0.7);
    return NextResponse.json({
      response,
      referencedCards: cards.map(c => c.id),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
