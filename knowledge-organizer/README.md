# Knowledge Organizer - 知识整理助手

帮助用户围绕「小红书内容」进行知识整理与沉淀的本地 MVP 应用。

## 功能特性

- **内容导入**: 支持粘贴小红书链接或直接粘贴正文，天然支持 fallback
- **知识卡片生成**: 调用大模型自动将内容结构化为精美的 knowledge card
- **知识库分类**: 自动将卡片分类到运营灵感 / 内容方法论 / 产品商业观察
- **知识库浏览**: 按分类浏览和筛选卡片
- **AI 对话**: 基于本地知识库内容进行问答（大模型驱动）

## 大模型配置

应用支持接入任意 OpenAI兼容 API 接口（包括 MiniMax、硅基流动、OpenAI、Claude 等）。

### 环境变量配置

在项目根目录创建 `.env.local` 文件：

```bash
# MiniMax 示例
OPENAI_API_KEY=sk-api-yVx_7IfLSD1rfEgcvdbO0MYWsOFp1MLJLpK4JEx010zFpCz2vqd_aRmH2S2rh8iWuS8QsrD9_QQ8Um9bKSecROLjDcfmlzBOlF_-GyFoyKjNxQSSpFX5Emc
OPENAI_BASE_URL=https://api.minimaxi.com/v1
OPENAI_MODEL=MiniMax-M2.7
```

`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 三项必须同时配置，缺一不可。

如使用其他 OpenAI 兼容服务商，修改 `OPENAI_BASE_URL` 和 `OPENAI_MODEL` 即可。

### 验证配置

配置完成后重新启动 `npm run dev`，左侧边栏底部状态指示灯：
- **绿色** = AI 助手已连接
- **红色** = 未配置模型接口（检查 .env.local）

## 本地运行

```bash
cd knowledge-organizer
npm install
npm run dev
```

访问 http://localhost:3000

## 项目结构

```
knowledge-organizer/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # 根布局
│   │   ├── page.tsx       # 主页面（三栏布局）
│   │   └── globals.css     # 全局样式
│   └── lib/
│       ├── types.ts       # 类型定义与工具函数
│       ├── data.ts        # 数据层（localStorage 读写）
│       └── llm.ts         # 大模型 API 调用层
├── .env.local             # 环境变量（需手动创建）
├── .env.example           # 环境变量示例
└── package.json
```

## Claude Code Skill

项目包含一个可复用的 Claude Code skill，定义在 `.claude/skills/knowledge-ingestion.md`。

### Skill 作用

标准化「内容导入与整理」工作流：
1. 识别输入类型（链接 / 纯文本 / 混合）
2. 处理内容（支持 fallback）
3. 生成结构化知识卡片
4. 自动分类到合适知识库
5. 保存到本地存储

### 使用方式

当用户粘贴内容时，应用自动触发 skill 流程，无需手动调用。

## 演示建议（3 分钟）

1. **开场** (30s): 介绍产品定位 - 知识整理助手，不是爬虫工具
2. **配置验证** (30s): 确认左侧边栏底部 AI 状态灯为绿色
3. **导入新内容** (45s): 粘贴一段文字，生成新卡片，看到 AI 自动提炼摘要/要点/标签
4. **知识库对话** (45s): 切换到右侧 chat 面板，提问「总结这个知识库的主要主题」
5. **切换知识库** (30s): 展示按分类筛选的效果

## 设计关键词

- iOS 风格
- 蓝绿色系
- 卡片式布局
- 轻阴影、大圆角、充足留白
