/**
 * Knowledge Base Classification — normalization + controlled vocabulary.
 *
 * Problem this solves:
 * - LLM outputs varied, expressive category names (e.g. "多模型平台", "AI工具集", "ChatGPT客户端")
 * - Without normalization, each variation creates a separate knowledge base
 * - "AIGC" becomes a catch-all dustbin for anything AI-related
 *
 * Solution:
 * - CANONICAL_BASES: a fixed, small set of stable, productized topic names
 * - NORMALIZATION_MAP: maps any near-synonym or substring-match to a canonical name
 * - normalizeBase(input): takes raw LLM output or keyword-match result,
 *   returns the stable canonical name (or '其他' if truly uncategorizable)
 *
 * Design principles:
 * 1. Categories represent "knowledge domains / tool types" not "content type"
 * 2. Each category should be independently useful for browsing and accumulation
 * 3. No category is so broad it swallows everything (no "AIGC" as catch-all)
 * 4. New cards can expand the set, but only through deliberate normalization
 */

// ---------------------------------------------------------------------------
// Canonical knowledge base vocabulary
// ---------------------------------------------------------------------------

export const CANONICAL_BASES = [
  // AI & Tools
  'AI工具',          // AI product/tool reviews, comparisons, usage tips
  '多模型平台',      // Platforms that host multiple models (OpenRouter, Cherry Studio, etc.)
  'Vibe Coding',    // AI-assisted coding, Design-to-Code, cursor/windsurf/etc.
  'AIGC',           // Image/video generation: Midjourney, SD, DALL-E, Flux, ComfyUI

  // Content & Creation
  '内容方法论',      // Writing, content creation, copywriting, storytelling
  '内容平台',        // Platforms: 小红书, 抖音, B站, TikTok

  // Business & Product
  '产品/商业观察',   // Product strategy, business analysis, competitive research
  '运营灵感',        // Growth, user acquisition, monetization, operations

  // Tools & Methods
  '知识管理',        // Note-taking, PKM, knowledge organization tools/methods
  '品牌设计',        // Visual design, brand identity, UI/UX, typography

  // Domain-specific
  '医疗健康',        // Health, medicine, wellness
  '节假日',          // Holidays, festivals, vacation, holiday arrangements

  // Misc
  '其他',            // Truly uncategorizable or one-off content
] as const;

export type CanonicalBase = typeof CANONICAL_BASES[number];

// ---------------------------------------------------------------------------
// Normalization map — maps any string to a canonical name
// Order matters: more specific keys should come before general ones.
// ---------------------------------------------------------------------------

type NormalizationEntry = {
  canonical: CanonicalBase;
  // Keywords that map to this canonical base
  // Supports substring matching (case-insensitive)
  keywords: string[];
};

const NORMALIZATION_MAP: NormalizationEntry[] = [
  // === AI & Tools ===
  {
    canonical: '多模型平台',
    keywords: [
      // Exact tool names that are multi-model platforms
      'openrouter', 'cherry studio', 'chatsimple',
      'oneapi', 'one-chat', 'next-chat',
      // Generic platform descriptors
      '多模型平台', '多模型聚合', '模型聚合平台', '模型平台',
      'ai聚合', 'ai平台', '聚合ai', 'ai hub',
      '模型市场', '模型商店',
      'lmarena', 'lm arena', 'chatbot arena',
      'huggingchat', 'hugging face',
      // Substrings that shouldn't match "AI工具"
      '模型客户端', '模型管理平台',
    ],
  },
  {
    canonical: 'AI工具',
    keywords: [
      // Tool name keywords
      'claude', 'chatgpt', 'gpt-4', 'gpt4', 'gpt3',
      'copilot', 'github copilot', 'cursor', 'windsurf', 'codeium',
      'aider', 'replit', 'augment', 'codeium',
      'perplexity', 'phind', 'you.com',
      'notion ai', 'notion',
      'gamma', 'beautiful.ai', 'tome',
      // Substrings that shouldn't be caught by AIGC
      'ai工具', 'ai assistant', 'ai产品', 'ai应用',
      'ai软件', 'ai助手', 'ai平台',
      'chatbot', '聊天机器人', '智能助手',
      'writing assistant', 'ai写作',
      // Short generic before AIGC catches them
      'ai',
    ],
  },
  {
    canonical: 'Vibe Coding',
    keywords: [
      'vibe coding', 'vibe', 'design to code', 'design-to-code',
      'bolt', 'lovable', 'piece', 'saas', 'saas building',
      'browse', 'browse.lol', 'browsing',
      'cursor rules', 'windsurf rules',
      'windsurf',
      'ai编程', 'ai代码', '智能编程',
      'lowcode', 'nocode', '零代码',
    ],
  },
  {
    canonical: 'AIGC',
    keywords: [
      'midjourney', 'stable diffusion', 'dall-e', 'dalle',
      'flux', 'comfyui', 'runway', 'pika',
      'ai绘画', 'ai绘图', 'ai生成图像', 'ai生成图片',
      'ai视频', 'ai生成视频', 'aigc',
      '文生图', '图生图', '图像生成',
      'video generation', 'ai video',
      'generative ai', 'genai',
    ],
  },

  // === Content & Creation ===
  {
    canonical: '内容方法论',
    keywords: [
      '内容创作', '创作方法', '写作方法', '写作技巧',
      '文案', '文案写作', '爆款文案', '种草文案',
      '选题', '标题党', '标题技巧', '内容标题',
      '脚本', '短视频脚本', '口播脚本',
      '小红书写作', '抖音文案', '内容营销',
      'content creation', 'writing', 'copywriting',
      'storytelling', '叙事', '内容策划',
      '创作思路', '创作心得',
    ],
  },
  {
    canonical: '内容平台',
    keywords: [
      '小红书', 'xiaohongshu', 'rednote',
      '抖音', 'tiktok', ' TikTok ',
      'b站', 'bilibili', '哔哩哔哩', 'acfun',
      '快手', '视频号',
      'youtube', 'twitter', 'x.com', '微博',
      'threads', 'mastodon',
      '内容平台', '社交平台', '短视频平台',
    ],
  },

  // === Business & Product ===
  {
    canonical: '产品/商业观察',
    keywords: [
      '产品经理', 'pm', 'prd', '产品设计', '产品策略',
      '产品体验', '产品功能', '产品思考',
      '商业模式', '盈利模式', '商业化', '变现',
      '商业分析', '行业分析', '市场分析', '竞品分析',
      '公司分析', '公司研究', '企业分析',
      '战略', '战略规划', '商业战略',
      'product manager', 'product strategy', 'product market fit',
      'startup', '创业', '融资', '投资',
      'saas商业模式', '订阅制',
    ],
  },
  {
    canonical: '运营灵感',
    keywords: [
      '运营', '用户运营', '内容运营', '活动运营', '电商运营',
      '直播运营', '社群运营', '私域运营',
      '引流', '获客', '增长', '用户增长', '裂变',
      '转化', '复购', '留存', '促活',
      '推广', '投放', '广告投放', '广告',
      '小红书运营', '抖音运营',
      'growth', 'growth hacking', 'acquisition',
      'marketing', '运营策略', '运营思路',
    ],
  },

  // === Tools & Methods ===
  {
    canonical: '知识管理',
    keywords: [
      '知识管理', 'pkM', '个人知识库', '知识体系',
      '笔记', '笔记方法', '笔记工具', '笔记软件',
      'obsidian', 'logseq', 'roam research', 'flomo',
      'notion', '线性', 'finite', 'anytype',
      '卡片盒', '卡片笔记', 'zettelkasten',
      '知识沉淀', '知识整理', '知识归纳',
      '第二大脑', '外包大脑',
      'note-taking', 'knowledge management',
    ],
  },
  {
    canonical: '品牌设计',
    keywords: [
      '品牌设计', '视觉设计', '品牌视觉', '品牌标识',
      'ui设计', 'ux设计', '界面设计', '交互设计',
      'figma', 'sketch', 'adobe', 'canva', '即时设计',
      '字体', '字体设计', '字体选择',
      '配色', '色彩设计', '色彩搭配',
      'icon', '图标', '图标设计', '插画',
      '设计系统', 'design system', '组件库',
      'logo', '商标', 'vi设计',
      '品牌策划', '品牌定位', 'brand',
    ],
  },

  // === Domain-specific ===
  {
    canonical: '医疗健康',
    keywords: [
      '医疗', '健康', '医药', '药品', '药物',
      '诊疗', '医生', '医院', '医疗机构',
      '健康管理', '慢病管理', '疾病',
      '临床', '医学', '药学',
      'healthcare', 'medical', 'health',
      '保健', '养生', '预防医学',
    ],
  },
  {
    canonical: '节假日',
    keywords: [
      // Holiday names
      '节假日', '法定节假日', '假期', '放假', '放假安排',
      '春节', '国庆', '中秋', '清明', '端午', '劳动节', '五一', '元旦', '除夕',
      '元宵节', '重阳节', '端午节', '清明节', '中秋节', '国庆节',
      '黄金周', '小长假', '调休', '补休',
      '节日', '节庆', '节日安排', '假期安排',
      'holiday', 'vacation', 'festival', 'chinese new year',
      '五一假期', '国庆假期', '春节假期', '清明假期',
      '年假', '带薪年假', '婚假', '产假', '丧假',
      '调休安排', '放假通知', '假期通知',
    ],
  },
];

// ---------------------------------------------------------------------------
// Normalization function
// ---------------------------------------------------------------------------

/**
 * Normalize a raw category string (from LLM output or keyword match)
 * to a canonical knowledge base name.
 *
 * Strategy:
 * 1. Exact match against CANONICAL_BASES (case-insensitive)
 * 2. Substring match against NORMALIZATION_MAP keywords
 * 3. Fall back to '其他' if nothing matches
 */
export function normalizeBase(raw: string): CanonicalBase {
  if (!raw) return '其他';

  const trimmed = raw.trim();

  // 1. Exact match (case-insensitive)
  const exact = CANONICAL_BASES.find(
    b => b.toLowerCase() === trimmed.toLowerCase()
  );
  if (exact) return exact;

  // 2. Substring match — check each normalization entry
  const lower = trimmed.toLowerCase();

  // Sort entries: longer keyword first (more specific wins)
  const sortedEntries = [...NORMALIZATION_MAP].sort(
    (a, b) => b.keywords[0].length - a.keywords[0].length
  );

  for (const entry of sortedEntries) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return entry.canonical;
      }
    }
  }

  // 3. No match — check if it's too generic/uncategorizable
  return '其他';
}

// ---------------------------------------------------------------------------
// Legacy keyword classifier — used for text-without-LLM-classification path
// Returns a canonical base directly (already normalized).
// ---------------------------------------------------------------------------

export function classifyByKeywords(content: string, tags: string[]): CanonicalBase {
  const contentLower = content.toLowerCase();
  const tagStr = tags.join(' ').toLowerCase();
  const combined = contentLower + ' ' + tagStr;

  type Classifier = { keywords: string[]; base: CanonicalBase };

  const classifiers: Classifier[] = [
    {
      base: 'Vibe Coding',
      keywords: [
        'vibe coding', 'design-to-code', 'bolt.new', 'lovable',
        'piece', 'augment', 'cursor', 'windsurf', 'copilot',
        'ai编程', 'design to code', 'vibe',
      ],
    },
    {
      base: 'AIGC',
      keywords: [
        'midjourney', 'stable diffusion', 'dall-e', 'flux',
        'comfyui', 'runway', 'pika', 'ai绘画', 'ai绘图',
        'ai生成图像', 'ai生成视频', '文生图', '图生图',
      ],
    },
    {
      base: '多模型平台',
      keywords: [
        'openrouter', 'cherry studio', 'chatsimple', 'oneapi',
        '多模型平台', '多模型聚合', 'ai hub', 'hugging chat',
        '模型聚合', '模型平台', '聚合ai',
      ],
    },
    {
      base: 'AI工具',
      keywords: [
        'claude', 'chatgpt', 'gpt', 'copilot', 'cursor',
        'perplexity', 'phind', 'you.com', 'writesonic',
        'jasper', 'copy.ai', 'notion ai', 'gamma ai',
        'ai工具', 'ai助手', 'ai软件', 'ai产品',
        'writing assistant', 'ai写作', '聊天机器人',
        'aider', 'codeium', 'replit', 'augment',
      ],
    },
    {
      base: '知识管理',
      keywords: [
        'obsidian', 'logseq', 'roam', 'flomo',
        'notion', '笔记工具', '笔记方法', '知识管理',
        '卡片盒', 'zettelkasten', '第二大脑',
        'pkM', '个人知识库', '知识沉淀',
      ],
    },
    {
      base: '品牌设计',
      keywords: [
        'figma', 'sketch', 'adobe', 'canva',
        '品牌设计', '视觉设计', 'ui设计', 'ux设计',
        '字体', '配色', 'icon', '图标', '插画',
        'design system', 'logo', '品牌策划',
      ],
    },
    {
      base: '医疗健康',
      keywords: [
        '医疗', '健康', '医药', '药品', '医生',
        '医院', '诊疗', '健康管理', '保健',
      ],
    },
    {
      base: '节假日',
      keywords: [
        '节假日', '法定节假日', '假期', '放假', '放假安排',
        '春节', '国庆', '中秋', '清明', '端午', '劳动节', '五一',
        '元宵节', '重阳节', '黄金周', '小长假', '调休',
        '节日', '节庆', '假期安排', '年假',
      ],
    },
    {
      base: '内容平台',
      keywords: [
        '小红书', 'xiaohongshu', '抖音', 'tiktok',
        'b站', 'bilibili', '快手', '视频号',
        'youtube', '内容平台', '社交平台',
      ],
    },
    {
      base: '运营灵感',
      keywords: [
        '运营', '引流', '获客', '增长', '裂变',
        '转化', '复购', '私域', '社群',
        '投放', '广告', '电商运营', '直播运营',
      ],
    },
    {
      base: '内容方法论',
      keywords: [
        '写作', '创作', '文案', '内容创作', '爆款',
        '选题', '标题', '脚本', '短视频', '种草',
        '内容营销', '内容方法', 'storytelling',
      ],
    },
    {
      base: '产品/商业观察',
      keywords: [
        '产品经理', '产品设计', 'pm', 'prd',
        '商业模式', '商业分析', '行业分析', '竞品分析',
        '公司分析', '战略', '盈利模式',
        'product manager', 'product strategy',
      ],
    },
  ];

  let bestBase: CanonicalBase = '其他';
  let bestScore = 0;

  for (const clf of classifiers) {
    let score = 0;
    for (const kw of clf.keywords) {
      if (combined.includes(kw.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestBase = clf.base;
    }
  }

  return bestBase;
}

// ---------------------------------------------------------------------------
// Theme palette registry — separate from classification logic
// Each canonical base may have a fixed color palette.
// Unknown bases get a color from a rotating pool.
// ---------------------------------------------------------------------------

export const BASE_PALETTES: Record<string, { main: string; light: string; text: string }> = {
  'Vibe Coding':      { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  'Claude':           { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  'AIGC':             { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  'AI工具':           { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '多模型平台':       { main: '#5DA29D', light: '#EDF7F6', text: '#3D7A74' },
  '知识管理':         { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '品牌设计':         { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  '医疗健康':         { main: '#769365', light: '#EDF3EB', text: '#4E6B42' },
  '节假日':           { main: '#C97D4E', light: '#FDF3EC', text: '#8B4E1E' },
  '内容平台':         { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '运营灵感':         { main: '#769365', light: '#EDF3EB', text: '#4E6B42' },
  '内容方法论':       { main: '#749AB2', light: '#EDF3F7', text: '#5A7A8A' },
  '产品/商业观察':     { main: '#5D4C68', light: '#F2EFF5', text: '#5D4C68' },
  '其他':             { main: '#42423A', light: '#F0F1F0', text: '#42423A' },
};

export const FALLBACK_PALETTE = { main: '#769365', light: '#EDF3EB', text: '#4E6B42' };

export function getCanonicalPalette(baseId: string): { main: string; light: string; text: string } {
  return BASE_PALETTES[baseId] ?? FALLBACK_PALETTE;
}

// Pool of palettes for dynamically created bases (that aren't in BASE_PALETTES)
export const DYNAMIC_BASE_COLORS: { main: string; light: string; text: string }[] = [
  { main: '#769365', light: '#EDF3EB', text: '#4E6B42' },
  { main: '#749AB2', light: '#EBF3F8', text: '#2D6A8F' },
  { main: '#C6D6E5', light: '#EEF4F9', text: '#3A5C73' },
  { main: '#5D4C68', light: '#F0EBF5', text: '#4A3556' },
  { main: '#8A9199', light: '#F0F1F3', text: '#4E5760' },
  { main: '#A8BCCC', light: '#EEF4F8', text: '#3A5A70' },
  { main: '#5DA29D', light: '#EAF4F3', text: '#2D7670' },
  { main: '#C77DBA', light: '#F7EBF5', text: '#8A3A80' },
];
