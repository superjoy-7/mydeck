import { NextRequest, NextResponse } from 'next/server';
import { normalizeBase } from '@/lib/classify';
import type { KnowledgeCard, OutlineNode } from '@/lib/types';

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

/**
 * Extract the first complete JSON object from a string using brace counting.
 * Handles nested objects and ignores braces inside string values.
 * Strips common markdown code fences before parsing.
 */
function extractFirstJSONObject(raw: string): string | null {
  // Step 1: strip markdown code fences
  let s = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Step 2: find first opening brace
  const firstBrace = s.indexOf('{');
  if (firstBrace === -1) return null;

  // Step 3: count braces to find the matching closing brace of the FIRST object
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Found matching close brace for the first open brace
        return s.substring(firstBrace, i + 1);
      }
    }
  }
  return null;
}

const CARD_SYSTEM_PROMPT_BASE = `你是一个专业的内容整理助手，负责将用户输入的内容提炼为结构化知识卡片。

【第一步：判断内容主形态】
在内部判断这段内容的主要形态（仅供提取策略参考，不需要在结果中单独输出一个字段）：
- framework（框架型）：内容有清晰的模块划分、章节结构、维度组合，如"四步法"、"三分法"、"A+B+C模型"、产品体验报告框架等
- process（流程型）：内容有明确的阶段顺序、操作步骤、时间线性链路，如"先X再Y最后Z"、"5步流程"、"3阶段模型"等
- checklist（清单型）：内容是一组可独立存在的条目，无固定顺序，重要性相近，如"选择工具的7个标准"、"好标题的5个特征"等
- knowledge（知识说明型）：内容主要在解释概念、说明原理、介绍背景，无明显结构或结构不是核心价值
- resource（资源型）：内容主要是链接、工具、参考资料、摘录，结构本身不是核心价值

【第二步：按形态决定提取策略】

**如果内容是 framework / process / checklist 型（即有明显结构）：**
- 必须提取 core_structure 字段（见下方 JSON schema 说明）
- key_points 的前1-2条必须概括完整的结构骨架，不能只输出零散结论
- 即使无法画出完整流程图，也要在 key_points 前两条中保留"可按X→Y→Z阶段推进"或"建议按A、B、C、D四模块展开"这类结构表达
- 不要把结构型内容强行压缩成普通摘要

**如果内容是 knowledge / resource 型：**
- 不必强求 core_structure
- 以 summary + key_points 为主
- 如果原文自带分类结构且有价值，可以保留在 core_structure 中

【第二步附：判断是否提取 outline（大纲架构）】

**何时必须提取 outline：**
- 原文有明显的多级标题结构（如"一、xxx / 1.1 xxx / 1.1.1 xxx"）
- 原文有章节、模块、部分的层级划分
- 原文是课程笔记、报告框架、操作手册等有明显目录的内容
- 原文是模板、SOP、提纲类内容，结构本身就是核心价值

**何时不必提取 outline：**
- 原文是碎片化的要点集合，无层级关系
- 原文是对话、评论、零散摘录
- 原文过于简短（少于300字）且无明显结构
- outline_points 已足够承载结构时

**outline 的提取要求：**
- 忠实保留原文的标题层级，不改写、不总结
- 只取标题文字，不把内容压缩进去
- 一般不超过3级，层级过深时只保留前2-3级
- 如果原文只有1级标题，则为单层数组

【第三步：提取字段说明】
请提取以下字段并以JSON格式返回：

1. title: 简洁有力的标题（不超过50字）
2. summary: 100-150字的摘要
3. key_points: 3-5个核心要点（每个不超过80字）
   【职责分工：当内容成功提取了 outline（大纲架构）时，key_points 必须转而提炼结构内部的高价值说明，禁止再重复描述整体结构骨架】

   如果原文没有 outline：
   - 可以用第1条概括整体结构（如"可按 A → B → C 三阶段推进"）
   - 后续条目补充各模块要点

   如果原文成功提取了 outline（存在大纲层级结构）：
   - 禁止再用第1条写"本文分为 X 部分""整体包含 A、B、C、D 模块"等重复 outline 内容
   - 禁止写"建议按四模块展开""内容可分为三个阶段"这类已在 outline 承载的信息
   - key_points 应优先提炼：各模块内部的判断标准、分类方式、概念解释、补充说明、复用细节、对比维度、落地要点
   - 示例：outline 为"① 竞品分析 - ② 用户研究 - ③ 需求整理 - ④ 方案设计"，则 key_points 应写：
     "竞品分析维度包括功能对比、价格策略、用户体验三方面"
     "用户研究可通过问卷、访谈、行为数据三种方式交叉验证"
     "需求优先级按"用户价值 × 实现成本"矩阵评估"
     （而非再写"文章按竞品分析→用户研究→需求整理→方案设计四模块展开"）

   适用内容类型：
   - 方法论内容：提炼"判断标准、分析维度、落地方法"
   - 模板内容：提炼"字段含义、使用场景、填写标准"
   - 知识库内容：提炼"概念解释、分类方式、关键细节"
   - 资源库内容：提炼"来源性质、用途说明、适用条件"
4. knowledge_base: 知识库分类名
5. raw_input: 原始输入内容（保留原文，不做删改，最多截取前2000字）
6. core_takeaway: 2-3句话的核心收获总结（比summary更精炼，直击要点）
7. outline_points: 3-5个结构化要点（用"① 主题 - 说明"的格式，每个不超过50字）
8. note_value: 内容类型
    - methodology（方法论）：方法框架、分析思路、经验总结、教程指南、实战方法、工作流拆解、写作方法、产品分析方法等
    - template（模板）：模板、SOP、checklist、prompt、提纲、固定格式文本、可直接套用的输出骨架等
    - knowledge（知识库）：概念说明、原理解释、知识整理、信息总结、科普说明等。如节假日概览、工具介绍、平台知识整理等
    - resource（资源库）：网站/工具/产品链接、外部资料、参考信息、摘录等
    - other（其它）：确实无法归入以上四类的内容。优先尝试归入前四类，只有在确实无法判断时才使用"other"
9. outline: 仅当原文有明显层级结构时生成，格式如下（不存在时不要生成此字段）：
   [
     { "title": "一级标题名称", "children": [
       { "title": "二级标题名称" },
       { "title": "二级标题名称", "children": [{ "title": "三级标题名称" }] }
     ]},
     { "title": "另一节一级标题" }
   ]
   - 只保留标题文字，不要把内容填进去
   - 不超过3级，顺序与原文一致
   - 原文无层级结构时不要生成此字段
10. core_structure: 仅当内容明显存在结构骨架时生成，格式如下（不存在时不要生成此字段）：
   {
     "type": "framework" | "process" | "checklist",
     "title": "结构名称（如：产品体验报告四模块框架 / 四阶段内容创作流程 / 工具选择七项标准）",
     "items": ["模块1名称", "模块2名称", "模块3名称", ...]（一般4-8项，不要超过10项）
   }
   - type=framework：模块型结构，如"前言 → 用户分析 → 产品分析 → 使用体验"
   - type=process：阶段/步骤型结构，如"选题 → 收集 → 整理 → 输出 → 复盘"
   - type=checklist：并列清单型结构，如"相关性 → 原创性 → 深度 → 可读性 → 时效性"

请以JSON格式返回，不要包含任何其他内容。`;

export async function POST(request: NextRequest) {
  const config = getServerLLMConfig();
  if (!config) {
    return NextResponse.json({ error: 'LLM not configured on server' }, { status: 500 });
  }

  const body = await request.json();
  const { content, sourceUrl, existingBases } = body as { content: string; sourceUrl: string; existingBases?: string[] };

  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  // Build system prompt with existing bases as priority context
  let systemPrompt = CARD_SYSTEM_PROMPT_BASE;
  if (existingBases && existingBases.length > 0) {
    systemPrompt = systemPrompt.replace(
      '6. knowledge_base: 知识库分类名',
      `6. knowledge_base: 知识库分类名

【已有分类参考】当前已存在的分类有：${existingBases.join('、')}。★请优先将内容归入这些已有分类，只有在确实没有合适匹配时才从以下固定列表中选择，并在 response 中说明理由。

【固定分类列表】（仅在已有分类均不适合时使用）：
- AI工具：具体AI产品/工具的使用技巧、对比、测评
- 多模型平台：整合多个AI模型的平台（OpenRouter、Cherry Studio等）
- Vibe Coding：AI辅助编程、Design-to-Code相关
- AIGC：图像/视频生成AI工具（Midjourney、SD等）
- 知识管理：笔记工具、知识整理方法
- 品牌设计：视觉设计、UI/UX、品牌相关
- 内容平台：社交/内容平台运营（小红书、抖音、B站等）
- 运营灵感：增长、获客、转化、运营策略
- 内容方法论：写作技巧、内容创作方法
- 产品/商业观察：产品分析、产品体验报告、用户研究、竞品分析、业务模式、产品功能设计、onboarding方法、需求分析、信息架构、页面流程、商业分析等。**产品经理工作方法、用户体验相关、分析框架类内容均归此类**
- 医疗健康：医疗、健康、医药相关
- 节假日：法定节假日、假期安排、节日庆典（春节、国庆等）
- 其他：确实无法归入以上分类的内容，**严禁将产品/商业相关内容和AI产品混到"其他"**

【重要原则】
- 产品分析、用户研究、竞品分析、onboarding、业务模式、功能设计、需求分析等 → 必须归"产品/商业观察"
- 优先匹配已有分类，不要轻易使用"其他"
- "AIGC"专指AI生成图像/视频，不要把AI工具类产品也归到这里`
    );
  } else {
    // No existing bases — still provide full category definitions so LLM doesn't fall back to "其他" too easily
    systemPrompt = systemPrompt.replace(
      '6. knowledge_base: 知识库分类名',
      `6. knowledge_base: 知识库分类名

【固定分类列表】（请优先从以下分类中选择，确实没有合适匹配时才用"其他"）：
- AI工具：具体AI产品/工具的使用技巧、对比、测评
- 多模型平台：整合多个AI模型的平台（OpenRouter、Cherry Studio等）
- Vibe Coding：AI辅助编程、Design-to-Code相关
- AIGC：图像/视频生成AI工具（Midjourney、SD等）
- 知识管理：笔记工具、知识整理方法
- 品牌设计：视觉设计、UI/UX、品牌相关
- 内容平台：社交/内容平台运营（小红书、抖音、B站等）
- 运营灵感：增长、获客、转化、运营策略
- 内容方法论：写作技巧、内容创作方法
- 产品/商业观察：产品分析、产品体验报告、用户研究、竞品分析、业务模式、产品功能设计、onboarding方法、需求分析、信息架构、页面流程、商业分析等。**产品经理工作方法、用户体验相关、分析框架类内容均归此类**
- 医疗健康：医疗、健康、医药相关
- 节假日：法定节假日、假期安排、节日庆典（春节、国庆等）
- 其他：确实无法归入以上分类的内容，**严禁将产品/商业相关内容和AI产品混到"其他"**

【重要原则】
- 产品分析、用户研究、竞品分析、onboarding、业务模式、功能设计、需求分析等 → 必须归"产品/商业观察"
- "AIGC"专指AI生成图像/视频，不要把AI工具类产品也归到这里`
    );
  }

  const userContent = sourceUrl
    ? `内容来源: ${sourceUrl}\n\n${content}`
    : content;

  try {
    const result = await chatCompletion(
      config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      0.5,
    );

    // Extract JSON from response using robust brace-counting method
    const jsonStr = extractFirstJSONObject(result);
    if (!jsonStr) {
      console.error('[card/route] Raw LLM response — no JSON found:', result);
      return NextResponse.json({ error: `LLM returned no JSON object. Response: ${result.substring(0, 500)}` }, { status: 500 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[card/route] JSON parse error. Raw response:', result);
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error';
      return NextResponse.json({ error: `JSON parse failed: ${msg}. Response: ${result.substring(0, 500)}` }, { status: 500 });
    }

    // Normalize the LLM-suggested knowledge base to our canonical list
    const rawBase = (typeof parsed.knowledge_base === 'string' ? parsed.knowledge_base : '其他');
    const suggestedBase = normalizeBase(rawBase);

    const validNoteValues = ['methodology', 'template', 'knowledge', 'resource', 'other'];
    const noteValue: KnowledgeCard['note_value'] = validNoteValues.includes(parsed.note_value as string)
      ? (parsed.note_value as KnowledgeCard['note_value'])
      : 'other';

    // Validate and pick up core_structure if present
    const rawCoreStructure = parsed.core_structure as Record<string, unknown> | undefined;
    const structuredOutline = rawCoreStructure && typeof rawCoreStructure.title === 'string' && Array.isArray(rawCoreStructure.items)
      ? {
          type: (['framework', 'process', 'checklist'].includes(rawCoreStructure.type as string) ? rawCoreStructure.type : 'framework') as 'framework' | 'process' | 'checklist',
          title: String(rawCoreStructure.title).substring(0, 60),
          items: (rawCoreStructure.items as unknown[]).filter((i: unknown) => typeof i === 'string').slice(0, 10),
        }
      : undefined;

    // Validate outline: must be an array of OutlineNode
    const rawOutline = parsed.outline as unknown;
    const validatedOutline = ((): OutlineNode[] | undefined => {
      if (!Array.isArray(rawOutline)) return undefined;
      type RawNode = { title: unknown; children?: unknown[] };
      const isRawNode = (v: unknown): v is RawNode =>
        v !== null && v !== undefined && typeof (v as RawNode).title === 'string';
      const topItems = rawOutline.filter(isRawNode);
      const result = topItems.map<OutlineNode>(item => ({
        title: String(item.title).substring(0, 80),
        children: Array.isArray(item.children) && item.children.filter(isRawNode).length > 0
          ? item.children.filter(isRawNode).map(c => ({
              title: String(c.title).substring(0, 80),
              children: Array.isArray(c.children) && c.children.filter(isRawNode).length > 0
                ? c.children.filter(isRawNode).map(gc => ({
                    title: String((gc as RawNode).title).substring(0, 80),
                  }))
                : undefined,
            }))
          : undefined,
      }));
      const filtered = result.filter(n => n.title.length > 0);
      return filtered.length > 0 ? filtered.slice(0, 20) : undefined;
    })();

    return NextResponse.json({
      title: (typeof parsed.title === 'string' ? parsed.title : '未命名内容') || '未命名内容',
      summary: (typeof parsed.summary === 'string' ? parsed.summary : '') || content.substring(0, 120),
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5) : [],
      suggested_base: suggestedBase,
      // New structured fields
      raw_input: (typeof parsed.raw_input === 'string' ? parsed.raw_input : '') || content.substring(0, 2000),
      core_takeaway: (typeof parsed.core_takeaway === 'string' ? parsed.core_takeaway : (typeof parsed.summary === 'string' ? parsed.summary : '')) || content.substring(0, 150),
      outline_points: Array.isArray(parsed.outline_points) ? parsed.outline_points.slice(0, 5) : [],
      note_value: noteValue,
      ...(structuredOutline ? { core_structure: structuredOutline } : {}),
      ...(validatedOutline && validatedOutline.length > 0 ? { outline: validatedOutline } : {}),
    });
  } catch (err) {
    console.error('[card/route] Unexpected error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Unexpected error: ${message}` }, { status: 500 });
  }
}