# Knowledge Ingestion Skill

## Purpose

Standardizes the "content import and organization" workflow for Knowledge Organizer. This skill transforms raw content (links or text) into structured knowledge cards and automatically classifies them into appropriate knowledge bases.

## When to Use

Use this skill when:
- User pastes a Xiaohongshu (小红书) link or raw text content
- User wants to import and organize content into knowledge cards
- User needs automatic content classification and tagging

## Workflow Steps

### Step 1: Identify Input Type

Analyze the input to determine if it's:
- A URL (contains `xiaohongshu.com` or similar)
- Plain text content
- Mixed input (both URL and text)

### Step 2: Process Content

For URLs:
- Attempt to extract meaningful content
- If extraction fails, fall back to manual text input
- Do NOT rely on successful web scraping - always support fallback

For plain text:
- Skip extraction step
- Directly proceed to card generation

### Step 3: Generate Knowledge Card

Transform content into a structured `KnowledgeCard`:

```
{
  id: auto-generated unique ID,
  title: extracted or generated title,
  source_url: original URL or empty string,
  source_type: "link" or "text",
  original_text: full text content,
  summary: 2-3 sentence summary,
  key_points: array of 3-5 bullet points,
  actionable_tips: array of 2-3 actionable recommendations,
  tags: auto-generated relevance tags,
  knowledge_base: classified base category,
  created_at: ISO timestamp
}
```

### Step 4: Classify into Knowledge Base

Classify the card into one of three knowledge bases:

| Base ID | Name | Keywords |
|---------|------|----------|
| `operations` | 运营灵感 | 运营, 引流, 私域, 增长, 用户, 裂变, 推广 |
| `methodology` | 内容方法论 | 技巧, 方法, 公式, 套路, 教程, 设计, 创作 |
| `observation` | 产品/商业观察 | 分析, 案例, 品牌, 产品, 商业, 行业, 趋势 |

Use keyword matching to determine the best category. If uncertain, default to `methodology`.

### Step 5: Generate Tags

Based on content analysis, generate 3-6 relevant tags including:
- Category indicators (运营策略, 方法论, 商业洞察)
- Platform indicators (小红书, 抖音, 短视频, 私域)
- Topic indicators (品牌, 增长, 用户获取, etc.)

### Step 6: Save to Storage

Save the generated card to local storage (`knowledge_organizer_cards` key in localStorage).

## Usage Example

```typescript
import { useIngestion } from '@/lib/useIngestion';

const { processContent, isProcessing } = useIngestion();

// When user submits content
const card = await processContent(textContent, url);

// Card is automatically:
// - Classified into appropriate knowledge base
// - Tagged with relevant labels
// - Saved to local storage
// - Ready for chat retrieval
```

## File Locations

- Skill implementation: `src/lib/useIngestion.ts`
- Data persistence: `src/lib/data.ts`
- Type definitions: `src/lib/types.ts`

## Key Features

1. **Graceful Degradation**: If link extraction fails, prompts user to paste text manually
2. **Auto-Classification**: Automatically assigns knowledge base based on content analysis
3. **Tag Generation**: Creates relevant tags for discoverability
4. **localStorage Persistence**: Cards persist across sessions

## Demo Flow

1. User pastes content → skill identifies type
2. Card generated with structured fields
3. Auto-classification determines knowledge base
4. Card saved and immediately visible in UI
5. Chat can now retrieve and reference this card