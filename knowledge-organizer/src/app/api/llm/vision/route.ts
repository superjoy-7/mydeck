import { NextRequest, NextResponse } from 'next/server';
import { normalizeBase } from '@/lib/classify';
import type { KnowledgeCard, OutlineNode } from '@/lib/types';

function getServerLLMConfig() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = process.env.OPENAI_BASE_URL || '';
  const model = process.env.OPENAI_MODEL || '';
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl, model };
}

const VISION_SYSTEM_PROMPT_PART = `你是一个专业的内容整理助手，负责从截图中提取结构化知识。

【第一步：判断内容主形态】
在内部判断这张图片内容的主要形态（仅供提取策略参考，不需要在结果中单独输出）：
- framework（框架型）：图片中有清晰的模块划分、维度组合、章节区块，如PPT目录框架、思维导图结构、报告模块等
- process（流程型）：图片中有明确的阶段顺序、步骤流向、链路关系，如流程图、阶段图、步骤分解等
- checklist（清单型）：图片中是一组并列条目、无固定顺序，如评分标准列表、checklist、特征清单等
- knowledge（知识说明型）：图片主要在解释概念、呈现信息、无明显结构或结构不是核心价值
- resource（资源型）：截图内容是工具介绍页、链接集合、参考资料，结构本身不是核心价值

【第二步：按形态决定提取策略】

**如果图片内容是 framework / process / checklist 型：**
- 必须提取 core_structure 字段（见下方 JSON schema 说明）
- key_points 的前1-2条必须概括完整的结构骨架，不能只输出零散结论
- 即使截图有区域分割、模块标注、步骤编号，也应识别并提取完整结构
- 不要把结构型内容强行压缩成普通摘要

**如果图片内容是 knowledge / resource 型：**
- 不必强求 core_structure
- 以 summary + key_points 为主
- 如果截图中有有价值的小标题/标签/分类框架，也可保留在 core_structure 中

**【第二步附：判断是否提取 outline（大纲架构）】**

**何时必须提取 outline：**
- 截图中有清晰的多级标题结构（如PPT目录、报告章节、课程大纲）
- 截图中有编号的模块划分（如"一、xxx / 1.1 xxx"）
- 截图是模板、流程图、SOP、思维导图，有明显层次节点
- 截图是课程笔记、操作手册，有章节分区

**何时不必提取 outline：**
- 截图是单张信息图、无层级关系
- 截图是对话截图、评论截图
- 截图信息过于碎片化
- outline_points 已足够承载结构时

**outline 的提取要求：**
- 忠实保留图片中可见的标题层级，不改写、不总结
- 只取标题文字，不把内容压缩进去
- 一般不超过3级，层级过深时只保留前2-3级
- 如果图片无明显层级结构，不要生成此字段

【第三步：提取字段说明】
请提取以下字段并以JSON格式返回：

1. title: 图片中的主要标题或主题（不超过50字，如果图片没有明确标题，请根据内容概括一个）
2. summary: 100-150字的内容摘要
3. key_points: 3-5个核心要点（从图片内容中提炼，每个不超过80字）
   【职责分工：当内容成功提取了 outline（大纲架构）时，key_points 必须转而提炼结构内部的高价值说明，禁止再重复描述整体结构骨架】

   如果图片内容没有 outline：
   - 可以用第1条概括整体结构（如"可见 A → B → C 三阶段框架"）
   - 后续条目补充各模块要点

   如果图片内容成功提取了 outline（存在大纲层级结构）：
   - 禁止再用第1条写"图片分为 X 部分""整体包含 A、B、C、D 模块"等重复 outline 内容
   - 禁止写"建议按四模块展开""内容可分为三个阶段"这类已在 outline 承载的信息
   - key_points 应优先提炼：各模块内部的判断标准、分类方式、概念解释、补充说明、复用细节、对比维度、落地要点
   - 示例：outline 为"① 竞品分析 - ② 用户研究 - ③ 需求整理 - ④ 方案设计"，则 key_points 应写：
     "竞品分析维度包括功能对比、价格策略、用户体验三方面"
     "用户研究可通过问卷、访谈、行为数据三种方式交叉验证"
     "需求优先级按"用户价值 × 实现成本"矩阵评估"
     （而非再写"图片按竞品分析→用户研究→需求整理→方案设计四模块展开"）

   适用内容类型：
   - 方法论类截图：提炼"判断标准、分析维度、落地方法"
   - 模板类截图：提炼"字段含义、使用场景、填写标准"
   - 知识库类截图：提炼"概念解释、分类方式、关键细节"
   - 资源库类截图：提炼"来源性质、用途说明、适用条件"
4. suggested_base: 推荐的知识库分类名称（只能从以下分类中选择：AI工具、多模型平台、Vibe Coding、AIGC、知识管理、品牌设计、内容平台、运营灵感、内容方法论、产品/商业观察、医疗健康、节假日、其他）

【分类定义说明】：
- 产品/商业观察：产品分析、产品体验报告、用户研究、竞品分析、业务模式、产品功能设计、onboarding方法、需求分析、信息架构、页面流程、商业分析等。**产品经理工作方法、用户体验相关、分析框架类内容均归此类**
- AI工具：具体AI产品/工具的使用技巧、对比、测评
- AIGC：图像/视频生成AI工具（Midjourney、SD等），**不是所有AI相关都归这里**
- 其他：确实无法归入以上分类的内容，**严禁将产品/商业相关内容和AI产品混到"其他"**
5. raw_input: 原始输入（本次为图片，填"图片内容"即可，最多截取前2000字）
6. core_takeaway: 2-3句话的核心收获总结（比summary更精炼）
7. outline_points: 3-5个结构化要点（用"① 主题 - 说明"的格式，每个不超过50字）
8. note_value: 内容类型
    - methodology（方法论）：方法框架、分析思路、经验总结、教程指南、实战方法、工作流拆解等
    - template（模板）：模板、SOP、checklist、prompt、提纲、固定格式文本、可直接套用的输出骨架等
    - knowledge（知识库）：概念说明、原理解释、知识整理、信息总结、科普说明等
    - resource（资源库）：网站/工具/产品链接、外部资料、参考信息、摘录等
    - other（其它）：确实无法归入以上四类的内容。优先尝试归入前四类，只有在确实无法判断时才使用"other"
9. outline: 仅当图片中有明显层级结构时生成，格式如下（不存在时不要生成此字段）：
   [
     { "title": "一级标题名称", "children": [
       { "title": "二级标题名称" },
       { "title": "二级标题名称", "children": [{ "title": "三级标题名称" }] }
     ]},
     { "title": "另一节一级标题" }
   ]
   - 只保留图片中可见的标题文字，不要改写、不总结内容
   - 不超过3级，顺序与图片中一致
   - 图片无明显层级结构时不要生成此字段
10. core_structure: 仅当图片内容明显存在结构骨架时生成，格式如下（不存在时不要生成此字段）：
   {
     "type": "framework" | "process" | "checklist",
     "title": "结构名称（如：产品体验报告四模块框架 / 四阶段创作流程 / 工具选择七项标准）",
     "items": ["模块1名称", "模块2名称", "模块3名称", ...]（一般4-8项，不要超过10项）
   }
   - type=framework：模块型结构，如"问题定义 → 用户研究 → 需求分析 → 方案设计"
   - type=process：阶段/步骤型结构，如"收集 → 整理 → 分析 → 输出 → 复盘"
   - type=checklist：并列清单型结构，如"需求合理性 → 技术可行性 → 商业价值 → 用户体验"

【重要原则】
- 尽量选择具体分类，避免动不动就用"其他"
- "AIGC"专指AI生成图像/视频，不要把AI工具类产品也归到这里`;

interface MessageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

async function chatCompletion(
  config: { apiKey: string; baseUrl: string; model: string },
  messages: { role: 'system' | 'user' | 'assistant'; content: string | MessageContentPart[] }[],
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
  let s = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = s.indexOf('{');
  if (firstBrace === -1) return null;

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
        return s.substring(firstBrace, i + 1);
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const config = getServerLLMConfig();
  if (!config) {
    return NextResponse.json({ error: 'LLM not configured on server' }, { status: 500 });
  }

  const body = await request.json();
  const { imageBase64, text, existingBases } = body as { imageBase64: string; text?: string; existingBases?: string[] };

  if (!imageBase64) {
    return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
  }

  // Build system prompt with existing bases context
  const existingBasesHint = existingBases && existingBases.length > 0
    ? `\n\n【已有分类参考】当前已存在的分类有：${existingBases.join('、')}。★请优先将内容归入这些已有分类，只有在确实没有合适匹配时才从以下固定列表中选择，并在 response 中说明理由。

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
    : `\n\n【分类定义说明】：
- 产品/商业观察：产品分析、产品体验报告、用户研究、竞品分析、业务模式、产品功能设计、onboarding方法、需求分析、信息架构、页面流程、商业分析等。**产品经理工作方法、用户体验相关、分析框架类内容均归此类**
- AI工具：具体AI产品/工具的使用技巧、对比、测评
- AIGC：图像/视频生成AI工具（Midjourney、SD等），**不是所有AI相关都归这里**
- 其他：确实无法归入以上分类的内容，**严禁将产品/商业相关内容和AI产品混到"其他"**`;
  const systemPrompt = VISION_SYSTEM_PROMPT_PART + existingBasesHint + '\n\n请以JSON格式返回，不要包含任何其他内容。';

  // Build content parts: text prompt + image
  const contentParts: MessageContentPart[] = [
    {
      type: 'text',
      text: text || '请仔细分析这张图片，提取其中的主要内容，并以JSON格式返回整理结果。',
    },
    {
      type: 'image_url',
      image_url: { url: imageBase64 },
    },
  ];

  const messages: { role: 'system' | 'user' | 'assistant'; content: string | MessageContentPart[] }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contentParts },
  ];

  try {
    const result = await chatCompletion(config, messages, 0.5);

    // Extract JSON from response using robust brace-counting method
    const jsonStr = extractFirstJSONObject(result);
    if (!jsonStr) {
      console.error('[vision/route] Raw LLM response — no JSON found:', result);
      return NextResponse.json({ error: `LLM returned no JSON object. Response: ${result.substring(0, 500)}` }, { status: 500 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[vision/route] JSON parse error. Raw response:', result);
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error';
      return NextResponse.json({ error: `JSON parse failed: ${msg}. Response: ${result.substring(0, 500)}` }, { status: 500 });
    }

    // Normalize the LLM-suggested knowledge base to our canonical list
    const rawBase = (typeof parsed.suggested_base === 'string' ? parsed.suggested_base : '其他');
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
      title: (typeof parsed.title === 'string' ? parsed.title : '') || '未识别标题',
      summary: (typeof parsed.summary === 'string' ? parsed.summary : '') || '无法提取摘要',
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5) : [],
      suggested_base: suggestedBase,
      raw_input: (typeof parsed.raw_input === 'string' ? parsed.raw_input : '') || '图片内容',
      core_takeaway: (typeof parsed.core_takeaway === 'string' ? parsed.core_takeaway : (typeof parsed.summary === 'string' ? parsed.summary : '')) || '无法提取核心收获',
      outline_points: Array.isArray(parsed.outline_points) ? parsed.outline_points.slice(0, 5) : [],
      note_value: noteValue,
      ...(structuredOutline ? { core_structure: structuredOutline } : {}),
      ...(validatedOutline && validatedOutline.length > 0 ? { outline: validatedOutline } : {}),
    });
  } catch (err) {
    console.error('[vision/route] Unexpected error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Unexpected error: ${message}` }, { status: 500 });
  }
}
