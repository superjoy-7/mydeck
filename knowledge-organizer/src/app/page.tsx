'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { KnowledgeCard, ChatMessage, KnowledgeBase, generateId, isValidXiaohongshuUrl, extractTitle } from '@/lib/types';
import { loadCards, getCardsByBase, searchCards, deleteCard, getAllBases, getBaseCardCount, getBaseColor, getBaseName, getBasePalette, loadSessions, saveSessions, getAllBaseNames, addCard, createKnowledgeBase, moveCardToKnowledgeBase, createKnowledgeBaseAndMoveCard, deleteKnowledgeBase, getBaseById, renameKnowledgeBase, resolveKnowledgeBaseFromAIResult } from '@/lib/data';
import { generateKnowledgeCard, generateChatResponse, isLLMConfiguredAsync, understandImage, extractLinkContent, CardReference } from '@/lib/llm';
import { exportBackup, validateBackupJson, restoreFromBackup, type BackupManifest } from '@/lib/backup';
import { readImageFile, revokePreview, formatFileSize, ImageUpload } from '@/lib/image';

interface ChatSession {
  id: string;
  name: string;
  scope: string | null;
  messages: ChatMessage[];
}

type LinkState = 'idle' | 'valid_link_fallback' | 'valid_url' | 'invalid_url';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string>('all');
  const [linkInput, setLinkInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showTextArea, setShowTextArea] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('idle');
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUploads, setImageUploads] = useState<ImageUpload[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const MAX_IMAGES = 9;

  // Derived: palette map for all bases — computed once from knowledgeBases state
  const basePaletteMap = useMemo(() => {
    const map: Record<string, { main: string; light: string; text: string }> = {};
    for (const kb of knowledgeBases) {
      map[kb.id] = kb.palette;
    }
    return map;
  }, [knowledgeBases]);

  // Derived: current knowledge base color (for header decoration)
  const kbColor = selectedBaseId !== 'all' ? (basePaletteMap[selectedBaseId]?.main ?? '#769365') : '#769365';

  // Derived: full base info map (name + palette) from knowledgeBases state
  const baseInfoMap = useMemo(() => {
    const map: Record<string, { name: string; palette: { main: string; light: string; text: string } }> = {};
    for (const kb of knowledgeBases) {
      map[kb.id] = { name: kb.name, palette: kb.palette };
    }
    return map;
  }, [knowledgeBases]);

  // Manual classification state
  // Base selector for the import section — '' means AI auto-decide
  const [importBaseId, setImportBaseId] = useState<string>('');
  const [showImportBaseSettings, setShowImportBaseSettings] = useState(false);
  const [showCreateBase, setShowCreateBase] = useState(false);
  const [createBaseInput, setCreateBaseInput] = useState('');
  // Card detail — category edit
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingBaseId, setEditingBaseId] = useState<string>('');

  // Delete base modal
  const [deletingBase, setDeletingBase] = useState<{ id: string; name: string } | null>(null);

  // Rename base modal
  const [renamingBase, setRenamingBase] = useState<{ id: string; name: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');

  // Hover state for sidebar items
  const [hoveredBaseId, setHoveredBaseId] = useState<string | null>(null);

  // Chat sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Card detail modal
  const [selectedCard, setSelectedCard] = useState<KnowledgeCard | null>(null);

  // Chat panel collapse state
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);

  // Backup panel state
  const [showBackup, setShowBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize on mount (client-only)
  useEffect(() => {
    setMounted(true);
    const loadedCards = loadCards();
    setCards(loadedCards);
    setKnowledgeBases(getAllBases());

    // Load sessions
    const loadedSessions = loadSessions();
    if (loadedSessions.length > 0) {
      setSessions(loadedSessions);
      setActiveSessionId(loadedSessions[0].id);
    } else {
      const firstSession: ChatSession = {
        id: generateId(),
        name: '新对话',
        scope: 'all',
        messages: [],
      };
      setSessions([firstSession]);
      setActiveSessionId(firstSession.id);
    }

    // Check LLM config server-side (safe — never leaks secrets)
    isLLMConfiguredAsync().then(configured => {
      setLlmConfigured(configured);
    });
  }, []);

  // Update cards and knowledge bases when selection changes
  useEffect(() => {
    if (!mounted) return;
    // Reload all cards from localStorage on mount
    setCards(loadCards());
    setKnowledgeBases(getAllBases());
  }, [mounted]);

  // Derived: visible cards filtered by selected base — does NOT mutate cards state
  const visibleCards = useMemo(() => {
    if (selectedBaseId === 'all') return cards;
    return cards.filter(c => c.knowledgeBaseId === selectedBaseId);
  }, [cards, selectedBaseId]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId]);

  // Persist sessions
  useEffect(() => {
    if (mounted && sessions.length > 0) {
      saveSessions(sessions);
    }
  }, [sessions, mounted]);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // --- Link input handling ---
  const isValidHttpUrl = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLinkInput(value);
    setError(null);

    if (!value.trim()) {
      setLinkState('idle');
      return;
    }

    if (isValidXiaohongshuUrl(value)) {
      setLinkState('valid_link_fallback');
    } else if (isValidHttpUrl(value)) {
      setLinkState('valid_url');
    } else {
      if (value.includes('.') && !value.includes(' ')) {
        setLinkState('invalid_url');
      } else {
        setLinkState('idle');
      }
    }
  };

  const handleLinkFocus = () => {
    if (linkInput.trim() && isValidXiaohongshuUrl(linkInput)) {
      setShowTextArea(true);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    setError(null);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImageError(null);
    try {
      for (const file of Array.from(files)) {
        if (imageUploads.length >= MAX_IMAGES) {
          setImageError(`最多支持 ${MAX_IMAGES} 张图片`);
          break;
        }
        const upload = await readImageFile(file);
        setImageUploads(prev => [...prev, upload]);
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片读取失败');
    }
    // Reset input so same files can be re-selected
    e.target.value = '';
  };

  const handleImageRemove = (index: number) => {
    const upload = imageUploads[index];
    if (upload) {
      revokePreview(upload.preview);
      setImageUploads(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;

        if (imageUploads.length >= MAX_IMAGES) {
          setImageError(`最多支持 ${MAX_IMAGES} 张图片`);
          return;
        }

        setImageError(null);
        try {
          const upload = await readImageFile(file);
          setImageUploads(prev => [...prev, upload]);
        } catch (err) {
          setImageError(err instanceof Error ? err.message : '图片读取失败');
        }
      }
    }
  }, [imageUploads.length]);

  const handleProcess = async () => {
    const content = textInput.trim();
    const url = linkInput.trim();

    // Determine mode:
    // 1. Image mode: images provided
    // 2. Link extraction mode: valid http/https URL, no text, no images
    // 3. Text mode: text provided, optional URL as source
    const hasImages = imageUploads.length > 0;
    const isLinkExtractionMode = linkState === 'valid_url' && !content && !hasImages;
    const isTextMode = !!content || hasImages;

    // Need at least one input mode
    if (!isTextMode && !isLinkExtractionMode) {
      setError('请提供文本内容、上传图片，或输入网页链接后点击"提取并生成卡片"。');
      return;
    }

    if (!llmConfigured) {
      setError('未配置大模型接口，请检查 .env.local 中的 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL 是否配置正确。');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let title = '';
      let summary = '';
      let key_points: string[] = [];
      let actionable_tips: string[] = [];
      let tags: string[] = [];
      let suggestedBase = '其他';
      let finalUrl = url;
      let finalContent = content;

      // Collect existing base names for AI context — prioritize reuse
      const existingBases = getAllBaseNames();

      if (hasImages) {
        // Image understanding — process first image, include text as context
        const result = await understandImage(imageUploads[0].base64, content || undefined, existingBases);
        title = result.title;
        summary = result.summary;
        key_points = result.key_points;
        actionable_tips = result.actionable_tips;
        tags = result.tags;
        suggestedBase = result.suggested_base;

        // If multiple images, append note
        if (imageUploads.length > 1) {
          summary = `[多图共${imageUploads.length}张] ${summary}`;
        }
      } else if (isLinkExtractionMode) {
        // Extract content from URL first
        setError('正在提取网页内容，请稍候...');
        // Yield to render the message
        await new Promise(r => setTimeout(r, 50));

        let extractResult;
        try {
          extractResult = await extractLinkContent(url);
        } catch (extractErr) {
          const errMsg = extractErr instanceof Error ? extractErr.message : '未知错误';
          setError(`网页内容提取失败: ${errMsg}`);
          setIsProcessing(false);
          return;
        }

        finalContent = extractResult.extractedText;
        finalUrl = extractResult.url;

        // Use extracted title as hint for the card title (LLM will refine it)
        // Also pass the page title to the LLM for context
        const pageTitleHint = extractResult.title && extractResult.title !== new URL(finalUrl).hostname
          ? `【页面标题: ${extractResult.title}】\n`
          : '';

        setError('正在生成知识卡片，请稍候...');
        await new Promise(r => setTimeout(r, 50));

        const result = await generateKnowledgeCard(pageTitleHint + finalContent, finalUrl, existingBases);
        title = result.title;
        summary = result.summary;
        key_points = result.key_points;
        actionable_tips = result.actionable_tips;
        tags = result.tags;
        suggestedBase = result.suggested_base;

        // Use extracted title if LLM title is generic
        if (extractResult.title && extractResult.title !== new URL(finalUrl).hostname) {
          title = extractResult.title;
        }
      } else {
        // Text-only
        const result = await generateKnowledgeCard(content, url, existingBases);
        title = result.title;
        summary = result.summary;
        key_points = result.key_points;
        actionable_tips = result.actionable_tips;
        tags = result.tags;
        suggestedBase = result.suggested_base;
      }

      // Use LLM title if good, otherwise fallback to extractTitle
      const finalTitle = title && title !== '未命名内容' && title.length > 3 ? title : extractTitle(finalContent);

      // Resolve knowledgeBaseId: explicit selection > LLM suggestion (with alias support)
      // Priority: user-selected base > resolve AI result (handles rename aliases)
      const resolvedBase = importBaseId
        ? (knowledgeBases.find(b => b.name === importBaseId) ?? null)
        : resolveKnowledgeBaseFromAIResult(suggestedBase);
      const newCard: KnowledgeCard = {
        id: generateId(),
        title: finalTitle,
        source_url: finalUrl || '',
        source_type: finalUrl ? 'link' : 'text',
        original_text: isLinkExtractionMode ? '' : finalContent,
        summary: summary || finalContent.substring(0, 120),
        key_points: key_points.length > 0 ? key_points : ['暂无明确的要点提炼'],
        actionable_tips: actionable_tips || [],
        tags: tags.length > 0 ? tags : ['其他'],
        knowledgeBaseId: resolvedBase?.id ?? null,
        knowledge_base: resolvedBase?.name ?? (suggestedBase || '其他'),
        created_at: new Date().toISOString(),
      };

      // Save to storage
      addCard(newCard);

      // Update UI — direct set from storage (already written)
      setCards(getCardsByBase(selectedBaseId === 'all' ? null : selectedBaseId));
      setKnowledgeBases(getAllBases());

      // Reset form
      setLinkInput('');
      setTextInput('');
      setShowTextArea(false);
      setLinkState('idle');
      setError(null);
      setImportBaseId('');
      setShowImportBaseSettings(false);
      // Clean up image previews
      imageUploads.forEach(u => revokePreview(u.preview));
      setImageUploads([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败，请重试';
      setError(`生成知识卡片失败: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteCard = useCallback((cardId: string) => {
    deleteCard(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
    setKnowledgeBases(getAllBases());
  }, []);

  // Create a new custom knowledge base
  const handleCreateBase = useCallback(() => {
    const name = createBaseInput.trim();
    if (!name) return;
    try {
      createKnowledgeBase(name);
      setKnowledgeBases(getAllBases());
      setCreateBaseInput('');
      setShowCreateBase(false);
    } catch (err) {
      // silently ignore duplicate/empty
    }
  }, [createBaseInput]);

  // Update a card's knowledge base from the detail modal (by base id)
  const handleCardBaseChange = useCallback((cardId: string, newBaseId: string | null) => {
    const updated = moveCardToKnowledgeBase(cardId, newBaseId);
    if (!updated) return;
    setCards(prev => prev.map(c => c.id === cardId ? updated : c));
    setKnowledgeBases(getAllBases());
    setSelectedCard(updated);
    setEditingCardId(null);
  }, []);

  // Create a new base from within the card detail modal and move the card to it
  const handleCreateBaseFromModal = useCallback((baseName: string) => {
    const cardId = selectedCard?.id;
    if (!cardId) return;
    const newBase = createKnowledgeBaseAndMoveCard(cardId, baseName);
    if (!newBase) return;
    const updated = loadCards().find(c => c.id === cardId) ?? null;
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, knowledgeBaseId: newBase.id, knowledge_base: newBase.name } : c));
    setKnowledgeBases(getAllBases());
    setSelectedCard(updated ? { ...updated } : null);
    setEditingCardId(null);
  }, [selectedCard]);

  // Delete a knowledge base (cards are preserved with knowledgeBaseId = null)
  const handleDeleteBase = useCallback((baseId: string, baseName: string) => {
    // Cascade delete: removes base AND all its cards in data.ts
    deleteKnowledgeBase(baseId);
    if (selectedBaseId === baseId) {
      setSelectedBaseId('all');
    }
    // Filter deleted cards from UI state (data.ts already persisted the removal)
    setCards(prev => prev.filter(c => c.knowledgeBaseId !== baseId));
    setKnowledgeBases(getAllBases());
  }, [selectedBaseId]);

  // Rename a knowledge base
  const handleRenameBase = useCallback((baseId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    renameKnowledgeBase(baseId, trimmed);
    setKnowledgeBases(getAllBases());
    setRenamingBase(null);
  }, []);

  // Chat functions
  const createNewSession = () => {
    const existingNames = sessions
      .map(s => s.name)
      .filter(n => n.startsWith('新对话'))
      .map(n => {
        const match = n.match(/新对话\s*(\d+)?/);
        return match ? (match[1] ? parseInt(match[1]) : 1) : 0;
      });
    const nextNum = existingNames.length > 0 ? Math.max(...existingNames) + 1 : 1;
    const newSession: ChatSession = {
      id: generateId(),
      name: `新对话 ${nextNum}`,
      scope: selectedBaseId,
      messages: [],
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newSession.id);
  };

  const switchSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || !activeSession) return;

    if (!llmConfigured) {
      setError('未配置大模型接口，请检查 .env.local 配置。');
      return;
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      referencedCards: [],
      created_at: new Date().toISOString(),
    };

    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const isFirstUserMsg = s.messages.filter(m => m.role === 'user').length === 0;
      const newMessages = [...s.messages, userMessage];
      // Auto-rename to first user message content (once)
      const newName = isFirstUserMsg ? deriveSessionName(content) : s.name;
      return { ...s, name: newName, messages: newMessages };
    }));

    setIsChatLoading(true);
    setError(null);

    try {
      const scopeId = activeSession.scope === 'all' ? null : activeSession.scope;
      const allCards = searchCards('', scopeId);

      // Build card references for LLM
      const cardRefs: CardReference[] = allCards.map(c => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        key_points: c.key_points,
        tags: c.tags,
      }));

      // Build previous messages for context
      const prevMessages = activeSession.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const { response, referencedCards } = await generateChatResponse(
        content,
        cardRefs,
        prevMessages,
      );

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: response,
        referencedCards,
        created_at: new Date().toISOString(),
      };

      setSessions(prev => prev.map(s =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, assistantMessage] }
          : s
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '对话失败，请重试';
      setError(`知识对话失败: ${msg}`);
    } finally {
      setIsChatLoading(false);
    }
  };

  const clearCurrentSession = () => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [] }
        : s
    ));
  };

  const deleteSession = (sessionId: string) => {
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== sessionId);
      if (remaining.length === 0) {
        // Create a new blank session
        const newSession: ChatSession = {
          id: generateId(),
          name: '新对话',
          scope: selectedBaseId,
          messages: [],
        };
        setActiveSessionId(newSession.id);
        return [newSession];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  };

  // Compute once: { [baseId]: count } + '__total__'
  // Derived from React state `cards` which is always the full card set.
  // selectedBaseId changes filter cards into visibleCards but do NOT change cards state.
  const allCardCountMap = useMemo(() => {
    const map: Record<string, number> = { __total__: cards.length };
    for (const c of cards) {
      const kbId = c.knowledgeBaseId ?? c.knowledge_base;
      map[kbId] = (map[kbId] ?? 0) + 1;
    }
    return map;
  }, [cards]);

  const getTotalCardCount = () => allCardCountMap.__total__;
  const getBaseCardCount = (baseId: string) => allCardCountMap[baseId] ?? 0;

  // Derive a session name from the first user message — lightweight local logic
  const deriveSessionName = (content: string): string => {
    const raw = content.trim();
    // Strip common prefixes
    const cleaned = raw.replace(/^(我想问|请问|想问一下|问一下|你好|hi|hello|嗨|我想知道|想问)\s*/i, '');
    if (cleaned.length <= 24) return cleaned;
    // Truncate at ~22 chars, keeping whole words if possible
    return cleaned.substring(0, 22).replace(/\s+\S*$/, '') + '…';
  };

  const renameSession = (sessionId: string, name: string) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, name } : s
    ));
  };

  const getScopeLabel = (scope: string | null) => {
    if (!scope || scope === 'all') return '全部卡片';
    return baseInfoMap[scope]?.name || scope;
  };

  // Before mounted, render stable placeholder
  if (!mounted) {
    return (
      <div className="flex h-screen" style={{ backgroundColor: '#F7F8F6' }}>
        <div className="w-64 bg-white border-r flex flex-col items-center justify-center" style={{ borderColor: '#DFE2DE' }}>
          <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center" style={{ backgroundColor: '#769365' }}>
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          <p className="text-sm" style={{ color: '#8A9199' }}>MyDeck 加载中...</p>
        </div>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#EDF3EB' }}>
              <svg className="w-8 h-8" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: '#8A9199' }}>正在初始化...</p>
          </div>
        </main>
        <div className="w-80 bg-white border-l flex items-center justify-center" style={{ borderColor: '#DFE2DE' }}>
          <p className="text-xs font-medium" style={{ color: '#769365' }}>MyDeck</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#F7F8F6' }}>
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r flex flex-col" style={{ borderColor: '#DFE2DE' }}>
        {/* Logo */}
        <div className="p-5 border-b" style={{ borderColor: '#DFE2DE' }}>
          <div className="flex items-center gap-3">
            {/* Stacked cards brand icon */}
            <div className="relative w-10 h-10 flex-shrink-0">
              {/* Back card (most offset) */}
              <div
                className="absolute rounded-lg"
                style={{
                  width: '20px',
                  height: '24px',
                  backgroundColor: '#DDE5EC',
                  top: '4px',
                  left: '12px',
                  border: '1px solid #C2D0DC',
                }}
              />
              {/* Middle card */}
              <div
                className="absolute rounded-lg"
                style={{
                  width: '20px',
                  height: '24px',
                  backgroundColor: '#C2D0DC',
                  top: '2px',
                  left: '6px',
                  border: '1px solid #A8BCCC',
                }}
              />
              {/* Front card */}
              <div
                className="absolute rounded-lg flex items-center justify-center"
                style={{
                  width: '20px',
                  height: '24px',
                  backgroundColor: '#769365',
                  top: '0px',
                  left: '0px',
                  border: '1px solid #769365',
                }}
              >
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
            <div>
              <h1 className="font-semibold text-base" style={{ color: '#42423A' }}>MyDeck</h1>
              <p className="text-xs" style={{ color: '#8A9199' }}>知识沉淀</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <button
            onClick={() => setSelectedBaseId('all')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={
              selectedBaseId === 'all'
                ? { backgroundColor: '#769365', color: 'white' }
                : { color: '#42423A' }
            }
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              全部卡片
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={
                selectedBaseId === 'all'
                  ? { backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }
                  : { backgroundColor: '#EDF3EB', color: '#769365' }
              }
            >
              {getTotalCardCount()}
            </span>
          </button>

          {knowledgeBases.length > 0 && (
            <div className="pt-3 pb-1">
              <p className="px-3 text-xs font-medium uppercase tracking-wider" style={{ color: '#8A9199' }}>知识库</p>
            </div>
          )}

          {knowledgeBases.map((kb) => (
            <div
              key={kb.id}
              className="relative flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer"
              style={
                selectedBaseId === kb.id
                  ? { backgroundColor: '#EDF3F7', color: '#42423A' }
                  : { color: '#42423A' }
              }
              onClick={() => setSelectedBaseId(kb.id)}
              onMouseEnter={() => setHoveredBaseId(kb.id)}
              onMouseLeave={() => setHoveredBaseId(null)}
            >
              <span className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: kb.palette.main }}
                />
                <span className="truncate">{kb.name}</span>
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                style={
                  selectedBaseId === kb.id
                    ? { backgroundColor: '#769365', color: 'white' }
                    : { backgroundColor: '#F0F1F0', color: '#8A9199' }
                }
              >
                {getBaseCardCount(kb.id)}
              </span>

              {/* Action buttons — only shown on hover */}
              {hoveredBaseId === kb.id && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {/* Rename button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenamingBase({ id: kb.id, name: kb.name }); setRenameInput(kb.name); }}
                    className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: '#F5F5F5', color: '#8A9199' }}
                    title="重命名知识库"
                    onMouseOver={e => { e.currentTarget.style.backgroundColor = '#EDF3EB'; e.currentTarget.style.color = '#769365'; }}
                    onMouseOut={e => { e.currentTarget.style.backgroundColor = '#F5F5F5'; e.currentTarget.style.color = '#8A9199'; }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingBase({ id: kb.id, name: kb.name }); }}
                    className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: '#F5F5F5', color: '#8A9199' }}
                    title="删除知识库"
                    onMouseOver={e => { e.currentTarget.style.backgroundColor = '#FEF2F2'; e.currentTarget.style.color = '#DC2626'; }}
                    onMouseOut={e => { e.currentTarget.style.backgroundColor = '#F5F5F5'; e.currentTarget.style.color = '#8A9199'; }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}

          {knowledgeBases.length === 0 && (
            <div className="px-3 py-4 text-center">
              <p className="text-xs" style={{ color: '#8A9199' }}>
                导入内容后<br />自动生成分类
              </p>
            </div>
          )}

          {/* Create base input — shown inline */}
          {showCreateBase ? (
            <div className="px-2 pt-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={createBaseInput}
                  onChange={e => setCreateBaseInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateBase();
                    if (e.key === 'Escape') { setShowCreateBase(false); setCreateBaseInput(''); }
                  }}
                  placeholder="分类名称..."
                  autoFocus
                  className="flex-1 px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                  style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6', color: '#42423A' }}
                />
                <button
                  onClick={handleCreateBase}
                  className="p-1.5 rounded-lg"
                  style={{ backgroundColor: '#769365', color: 'white' }}
                  title="保存"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={() => { setShowCreateBase(false); setCreateBaseInput(''); }}
                  className="p-1.5 rounded-lg"
                  style={{ backgroundColor: '#F0F1F0', color: '#8A9199' }}
                  title="取消"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateBase(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
              style={{ color: '#8A9199' }}
              onMouseOver={e => e.currentTarget.style.backgroundColor = '#F0F1F0'}
              onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建分类
            </button>
          )}
        </nav>

        {/* Status + Backup */}
        <div className="p-4 border-t" style={{ borderColor: '#DFE2DE' }}>
          {/* Status */}
          <div className="rounded-xl p-3 mb-2" style={{ backgroundColor: '#F0F1F0' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: '#42423A' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: llmConfigured ? '#769365' : '#DC2626' }} />
              {llmConfigured ? 'AI 助手已连接' : '未配置模型接口'}
            </div>
            <p className="text-xs mt-1" style={{ color: '#8A9199' }}>基于 {getTotalCardCount()} 张卡片</p>
          </div>

          {/* Backup toggle */}
          <button
            onClick={() => setShowBackup(prev => !prev)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all"
            style={{
              backgroundColor: showBackup ? '#EDF3EB' : 'transparent',
              color: '#42423A',
            }}
            onMouseOver={(e) => { if (!showBackup) e.currentTarget.style.backgroundColor = '#F0F1F0'; }}
            onMouseOut={(e) => { if (!showBackup) e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              数据备份
            </span>
            <svg
              className="w-3 h-3 transition-transform"
              style={{ transform: showBackup ? 'rotate(180deg)' : 'rotate(0deg)', color: '#8A9199' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Backup panel */}
          {showBackup && (
            <div className="mt-2 space-y-2">
              <p className="text-xs px-1" style={{ color: '#8A9199' }}>
                当前数据仅保存在本浏览器，建议定期导出备份
              </p>

              {/* Export button */}
              <button
                onClick={() => {
                  exportBackup();
                  setBackupFeedback({ type: 'success', message: '备份文件已开始下载' });
                  setTimeout(() => setBackupFeedback(null), 3000);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all"
                style={{ backgroundColor: '#769365', color: 'white' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#6a8660'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#769365'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                导出全部数据
              </button>

              {/* Import button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all"
                style={{ backgroundColor: '#F0F1F0', color: '#42423A' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#E4E7E4'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#F0F1F0'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                导入备份文件
              </button>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBackupFeedback(null);

                  let text: string;
                  try {
                    text = await file.text();
                  } catch {
                    setBackupFeedback({ type: 'error', message: '文件读取失败，请重试。' });
                    e.target.value = '';
                    return;
                  }

                  const validation = validateBackupJson(text);
                  if (!validation.ok) {
                    setBackupFeedback({ type: 'error', message: validation.error });
                    e.target.value = '';
                    return;
                  }

                  const { data } = validation;

                  const confirmed = window.confirm(
                    `即将用备份覆盖当前数据（${data.cards.length} 张卡片，${data.sessions.length} 条对话）。\n\n建议：导入前先点击「导出全部数据」保留当前备份。\n\n确认继续吗？`,
                  );
                  if (!confirmed) {
                    e.target.value = '';
                    return;
                  }

                  const result = restoreFromBackup(data);
                  if (!result.ok) {
                    setBackupFeedback({ type: 'error', message: result.error ?? '导入失败' });
                    e.target.value = '';
                    return;
                  }

                  // Reload UI state
                  setCards(loadCards());
                  setKnowledgeBases(getAllBases());
                  const sessions = loadSessions();
                  setSessions(sessions);
                  setActiveSessionId(sessions[0]?.id ?? null);

                  let msg = `已恢复 ${result.restoredCards} 张卡片、${result.restoredBases} 个知识库、${result.restoredSessions} 条对话。`;
                  if (result.warning) msg += `\n${result.warning}`;
                  setBackupFeedback({ type: 'success', message: msg });
                  e.target.value = '';
                  setTimeout(() => setBackupFeedback(null), 5000);
                }}
              />

              {/* Feedback */}
              {backupFeedback && (
                <div
                  className="text-xs px-3 py-2 rounded-xl"
                  style={
                    backupFeedback.type === 'success'
                      ? { backgroundColor: '#EDF3EB', color: '#4E6B42' }
                      : { backgroundColor: '#FEF2F2', color: '#DC2626' }
                  }
                >
                  {backupFeedback.message}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b bg-white" style={{ borderColor: '#DFE2DE' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {selectedBaseId !== 'all' && (
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: kbColor }} />
                )}
                <h2 className="text-lg font-semibold" style={{ color: '#42423A' }}>
                  {selectedBaseId === 'all' ? '全部知识卡片' : (baseInfoMap[selectedBaseId]?.name ?? selectedBaseId)}
                </h2>
              </div>
              <p className="text-sm mt-0.5" style={{ color: '#8A9199' }}>
                {visibleCards.length} 张卡片
                {selectedBaseId !== 'all' && (
                  <button
                    onClick={() => setSelectedBaseId('all')}
                    className="ml-3 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors"
                    style={{ backgroundColor: '#F0F1F0', color: '#8A9199' }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#E0E1E0'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#F0F1F0'; }}
                  >
                    去导入
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </p>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {/* Import Section — only shown on "all cards" page */}
          {selectedBaseId === 'all' && (
          <div
            className="p-6 border-b"
            style={{ backgroundColor: '#F7F8F6', borderColor: '#DFE2DE' }}
            onPaste={handlePaste}
          >
            {/* Env Warning */}
            {!llmConfigured && (
              <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#DC2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#DC2626' }}>未配置大模型接口</p>
                    <p className="text-xs mt-0.5" style={{ color: '#991b1b' }}>
                      请在 <code className="px-1 py-0.5 rounded" style={{ backgroundColor: '#FEE2E2' }}>.env.local</code> 中配置 <code className="px-1 py-0.5 rounded" style={{ backgroundColor: '#FEE2E2' }}>OPENAI_API_KEY</code>、<code className="px-1 py-0.5 rounded" style={{ backgroundColor: '#FEE2E2' }}>OPENAI_BASE_URL</code>、<code className="px-1 py-0.5 rounded" style={{ backgroundColor: '#FEE2E2' }}>OPENAI_MODEL</code>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#DC2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-medium mb-4 flex items-center gap-2" style={{ color: '#42423A' }}>
                <svg className="w-5 h-5" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                导入内容
              </h3>

              <div className="space-y-3">
                {/* Link Input (source only, no longer triggers textarea) */}
                <div>
                  <input
                    type="text"
                    value={linkInput}
                    onChange={handleLinkChange}
                    placeholder="粘贴网页链接，可以是博客、文章、文档等..."
                    className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all"
                    style={{
                      borderColor: linkState === 'invalid_url' ? '#ef4444' : '#DFE2DE',
                      backgroundColor: '#F7F8F6'
                    }}
                  />
                  {/* Invalid URL warning */}
                  {linkState === 'invalid_url' && (
                    <div className="mt-2 p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                      <p className="text-xs">链接格式无效，请检查是否是正确的网址</p>
                    </div>
                  )}
                  {/* Valid xiaohongshu link - info */}
                  {linkState === 'valid_link_fallback' && (
                    <div className="mt-2 p-3 rounded-lg text-sm" style={{ backgroundColor: '#EDF3EB', color: '#4E6B42' }}>
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs" style={{ opacity: 0.9 }}>
                          链接仅记录来源，当前版本暂不支持自动解析正文
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Valid URL for extraction — show info */}
                {linkState === 'valid_url' && (
                  <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#EDF3EB', color: '#4E6B42' }}>
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs" style={{ opacity: 0.9 }}>
                        检测到网页链接。点击下方「提取并生成卡片」将从页面提取正文内容
                      </p>
                    </div>
                  </div>
                )}

                {/* Image Upload — always show upload area + previews */}
                <div>
                  {/* Image previews */}
                  {imageUploads.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {imageUploads.map((upload, index) => (
                        <div key={upload.preview} className="relative w-20 h-20 rounded-xl border overflow-hidden" style={{ borderColor: '#DFE2DE' }}>
                          <img
                            src={upload.preview}
                            alt={`图片${index + 1}`}
                            className="w-full h-full object-cover"
                            style={{ backgroundColor: '#f5f5f5' }}
                          />
                          <button
                            onClick={() => handleImageRemove(index)}
                            className="absolute top-1 right-1 p-1 rounded-full shadow-sm"
                            style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                            title="移除图片"
                          >
                            <svg className="w-3 h-3" style={{ color: '#DC2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                          {imageUploads.length > 1 && (
                            <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded text-xs text-white" style={{ backgroundColor: 'rgba(0,0,0,0.5)', fontSize: '10px' }}>
                              {index + 1}/{imageUploads.length}
                            </span>
                          )}
                        </div>
                      ))}
                      {/* Add more button */}
                      {imageUploads.length < MAX_IMAGES && (
                        <label
                          className="w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all"
                          style={{ borderColor: '#C8CCC8', backgroundColor: '#F7F8F6' }}
                          onMouseOver={(e) => { (e.currentTarget as HTMLLabelElement).style.borderColor = '#769365'; }}
                          onMouseOut={(e) => { (e.currentTarget as HTMLLabelElement).style.borderColor = '#C8CCC8'; }}
                        >
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                            multiple
                            className="hidden"
                            onChange={handleImageSelect}
                          />
                          <svg className="w-5 h-5" style={{ color: '#A8BCCC' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </label>
                      )}
                    </div>
                  )}

                  {/* Upload hint when no images yet */}
                  {imageUploads.length === 0 && (
                    <label
                      className="flex flex-col items-center justify-center py-5 rounded-xl border-2 border-dashed cursor-pointer transition-all"
                      style={{ borderColor: '#C8CCC8', backgroundColor: '#F7F8F6' }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLLabelElement).style.borderColor = '#769365'; }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLLabelElement).style.borderColor = '#C8CCC8'; }}
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                        multiple
                        className="hidden"
                        onChange={handleImageSelect}
                      />
                      <svg className="w-8 h-8 mb-2" style={{ color: '#A8BCCC' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm" style={{ color: '#8A9199' }}>点击上传或直接粘贴图片</span>
                      <span className="text-xs mt-1" style={{ color: '#A8BCCC' }}>支持多张图片逐步添加，最多 {MAX_IMAGES} 张</span>
                    </label>
                  )}
                </div>

                {/* Image error */}
                {imageError && (
                  <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                    <p className="text-xs">{imageError}</p>
                  </div>
                )}

                {/* Text Input - always visible */}
                <textarea
                  value={textInput}
                  onChange={handleTextChange}
                  placeholder={linkState === 'valid_url' ? '可选：粘贴补充内容，或留空使用链接中的全部正文...' : '粘贴正文内容，或描述你想从图片中提取的内容...'}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all resize-none"
                  style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6' }}
                />

                {/* Supported inputs hint */}
                <div className="flex items-center gap-2 text-xs px-1" style={{ color: '#8A9199' }}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  支持：纯文本 / 粘贴图片 / 网页链接提取正文；暂不支持：视频自动解析 / 小红书正文抓取
                </div>

                {/* Lightweight classification override — collapsed by default */}
                {showImportBaseSettings ? (
                  <div className="p-2 rounded-xl" style={{ backgroundColor: '#F7F8F6' }}>
                    <div className="flex items-center gap-2">
                      <ImportBaseDropdown
                        bases={knowledgeBases}
                        value={importBaseId}
                        onChange={setImportBaseId}
                      />
                      <button
                        onClick={() => { setShowImportBaseSettings(false); setImportBaseId(''); }}
                        className="text-xs px-2 py-1.5 rounded-lg"
                        style={{ color: '#8A9199', backgroundColor: '#F0F1F0' }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowImportBaseSettings(true)}
                    className="flex items-center gap-1 text-xs"
                    style={{ color: '#769365' }}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    手动指定分类
                  </button>
                )}

                {/* Process Button */}
                <button
                  onClick={handleProcess}
                  disabled={
                    isProcessing ||
                    (!textInput.trim() && imageUploads.length === 0 && linkState !== 'valid_url') ||
                    !llmConfigured
                  }
                  className="w-full py-3 font-medium rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#769365', color: 'white' }}
                >
                  {isProcessing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      AI 识别中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {imageUploads.length > 0
                        ? `分析${imageUploads.length > 1 ? `${imageUploads.length}张图片` : '图片'}生成卡片`
                        : linkState === 'valid_url' && !textInput.trim()
                        ? '提取并生成卡片'
                        : '生成知识卡片'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Cards Grid */}
          <div className="p-6">
            {cards.length === 0 ? (
              <div className="text-center py-16">
                <div
                  className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: '#EDF3EB' }}
                >
                  <svg className="w-10 h-10" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="font-medium text-lg mb-2" style={{ color: '#42423A' }}>该分类下还没有知识卡片</h3>
                {selectedBaseId === 'all' ? (
                  <>
                    <p className="text-sm mb-4" style={{ color: '#8A9199' }}>上传图片或粘贴正文，开始整理你的第一条内容</p>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm" style={{ backgroundColor: '#EDF3EB', color: '#769365' }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      上传图片或粘贴正文即可生成
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm mb-4" style={{ color: '#8A9199' }}>在全部卡片页面导入新内容，系统将自动归入该分类</p>
                    <button
                      onClick={() => setSelectedBaseId('all')}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
                      style={{ backgroundColor: '#EDF3EB', color: '#769365' }}
                      onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#E0EBE0'; }}
                      onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#EDF3EB'; }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      去全部卡片页面导入
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {visibleCards.map((card) => (
                  <KnowledgeCardComponent
                    key={card.id}
                    card={card}
                    knowledgeBases={knowledgeBases}
                    onDelete={handleDeleteCard}
                    onViewDetail={setSelectedCard}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Right Chat Panel */}
      {chatPanelCollapsed ? (
        /* === Collapsed Narrow Sidebar === */
        <aside
          className="h-full flex flex-col items-center py-3 gap-1"
          style={{ width: '48px', backgroundColor: 'white', borderLeft: '1px solid #DFE2DE' }}
        >
          {/* Expand button */}
          <button
            onClick={() => setChatPanelCollapsed(false)}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
            style={{ color: '#769365' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#EDF3EB'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="展开对话"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>

          {/* Session icons */}
          <div className="flex-1 flex flex-col items-center gap-1 overflow-y-auto py-1">
            {sessions.map(session => {
                const scopeLabel = session.scope && session.scope !== 'all'
                  ? (baseInfoMap[session.scope!]?.name || session.scope)
                  : '全部';
                return (
              <button
                key={session.id}
                onClick={() => {
                  switchSession(session.id);
                  setChatPanelCollapsed(false);
                }}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                style={
                  session.id === activeSessionId
                    ? { backgroundColor: '#769365', color: 'white' }
                    : { color: '#8A9199' }
                }
                onMouseOver={(e) => {
                  if (session.id !== activeSessionId) {
                    e.currentTarget.style.backgroundColor = '#EDF3EB';
                    e.currentTarget.style.color = '#769365';
                  }
                }}
                onMouseOut={(e) => {
                  if (session.id !== activeSessionId) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#8A9199';
                  }
                }}
                title={`${session.name} · ${scopeLabel}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            );
            })}
          </div>

          {/* New session button */}
          <button
            onClick={createNewSession}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
            style={{ color: '#8A9199' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#EDF3F7'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="新建对话"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </aside>
      ) : (
        /* === Expanded Chat Panel === */
        <aside className="w-80 bg-white border-l flex flex-col shrink-0" style={{ borderColor: '#DFE2DE' }}>
          {/* Chat Header */}
          <div className="p-4 border-b" style={{ borderColor: '#DFE2DE' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: '#42423A' }}>
                <svg className="w-5 h-5" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                知识对话
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={createNewSession}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: '#8A9199' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F0F1F0'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="新建对话"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
                <button
                  onClick={() => setChatPanelCollapsed(true)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: '#8A9199' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F0F1F0'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="收起对话"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Scope indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: '#EDF3EB', color: '#769365' }}>
                {getScopeLabel(activeSession?.scope || 'all')}
              </span>
              <span className="text-xs" style={{ color: '#8A9199' }}>
                {getTotalCardCount()} 张卡片
              </span>
            </div>
            {/* Session list */}
            {sessions.length > 0 && (
              <div className="mt-3 flex items-center gap-2 overflow-x-visible pb-1 pr-3">
                <div className="flex gap-1.5 flex-1 min-w-0">
                  {sessions.map(session => (
                    <SessionTab
                      key={session.id}
                      session={session}
                      isActive={session.id === activeSessionId}
                      baseInfoMap={baseInfoMap}
                      onSelect={() => switchSession(session.id)}
                      onDelete={() => deleteSession(session.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!llmConfigured ? (
              <div className="text-center py-8">
                <div
                  className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#FEF2F2' }}
                >
                  <svg className="w-6 h-6" style={{ color: '#DC2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-sm mb-1" style={{ color: '#DC2626' }}>未配置大模型接口</p>
                <p className="text-xs" style={{ color: '#8a9b8a' }}>请在 .env.local 中配置环境变量</p>
              </div>
            ) : !activeSession || activeSession.messages.length === 0 ? (
              <div className="text-center py-8">
                <div
                  className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#EDF3EB' }}
                >
                  <svg className="w-6 h-6" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="text-sm mb-1" style={{ color: '#42423A' }}>基于当前知识库内容回答</p>
                <div className="mt-4 space-y-2 text-left">
                  {[
                    '这个知识库主要在讲什么',
                    '有哪些共通的方法论',
                    '提炼与运营相关的内容',
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      className="w-full text-xs text-left px-3 py-2 rounded-lg transition-colors"
                      style={{ backgroundColor: '#F0F1F0', color: '#42423A' }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#EDF3F7'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#F0F1F0'}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeSession.messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] px-4 py-3 rounded-2xl ${
                      msg.role === 'user'
                        ? 'text-white rounded-br-md'
                        : 'rounded-bl-md'
                    }`}
                    style={msg.role === 'user'
                      ? { backgroundColor: '#769365' }
                      : { backgroundColor: '#F7F8F6', color: '#42423A' }
                    }
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    {msg.role === 'assistant' && msg.referencedCards.length > 0 && (
                      <div className="mt-2 pt-2 border-t" style={{ borderColor: '#DFE2DE' }}>
                        <p className="text-xs" style={{ color: '#8A9199' }}>
                          参考了 {msg.referencedCards.length} 张卡片
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl rounded-bl-md" style={{ backgroundColor: '#F7F8F6' }}>
                  <div className="flex items-center gap-2 text-sm" style={{ color: '#8A9199' }}>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    AI 思考中...
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t" style={{ borderColor: '#DFE2DE' }}>
            <ChatInput
              disabled={!llmConfigured}
              onSend={(text) => {
                sendMessage(text);
                // auto-collapse the textarea after send
              }}
            />
          </div>
        </aside>
      )}

      {/* Card Detail Modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          knowledgeBases={knowledgeBases}
          onBaseChange={handleCardBaseChange}
          onCreateBase={handleCreateBaseFromModal}
        />
      )}

      {/* Delete Knowledge Base Confirmation Modal */}
      {deletingBase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setDeletingBase(null)}
        >
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <div
            className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6"
            style={{ backgroundColor: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Title */}
            <h3 className="text-center font-semibold text-lg mb-4" style={{ color: '#42423A' }}>
              删除知识库「{deletingBase.name}」
            </h3>

            {/* Risk description */}
            <div className="mb-4 p-3.5 rounded-xl border" style={{ borderColor: '#DFE2DE', backgroundColor: '#FAFAF8' }}>
              <p className="text-sm leading-relaxed" style={{ color: '#6B7280' }}>
                删除后，该知识库下的
                <strong style={{ color: '#42423A' }}>
                  {getBaseCardCount(deletingBase.id)} 张知识卡片
                </strong>
                也将一并删除，且此操作<strong style={{ color: '#42423A' }}>不可撤销</strong>。
              </p>
            </div>

            {/* Backup hint */}
            <p className="text-xs text-center mb-5" style={{ color: '#9CA3AF' }}>
              如有需要，请先导出备份
            </p>

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setDeletingBase(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
                style={{ borderColor: '#DFE2DE', color: '#6B7280', backgroundColor: '#FAFAF8' }}
                onMouseOver={e => e.currentTarget.style.backgroundColor = '#F5F5F5'}
                onMouseOut={e => e.currentTarget.style.backgroundColor = '#FAFAF8'}
              >
                取消
              </button>
              <button
                onClick={() => {
                  handleDeleteBase(deletingBase.id, deletingBase.name);
                  setDeletingBase(null);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: '#8B4E1E' }}
                onMouseOver={e => e.currentTarget.style.backgroundColor = '#6B3D15'}
                onMouseOut={e => e.currentTarget.style.backgroundColor = '#8B4E1E'}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Knowledge Base Modal */}
      {renamingBase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setRenamingBase(null)}
        >
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <div
            className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6"
            style={{ backgroundColor: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Title */}
            <h3 className="text-center font-semibold text-lg mb-4" style={{ color: '#42423A' }}>
              重命名知识库
            </h3>

            {/* Input */}
            <input
              type="text"
              value={renameInput}
              onChange={e => setRenameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameInput.trim()) handleRenameBase(renamingBase.id, renameInput);
                if (e.key === 'Escape') setRenamingBase(null);
              }}
              placeholder="输入新名称..."
              autoFocus
              className="w-full px-4 py-3 rounded-xl border text-sm outline-none mb-4"
              style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6', color: '#42423A' }}
            />

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setRenamingBase(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
                style={{ borderColor: '#DFE2DE', color: '#6B7280', backgroundColor: '#FAFAF8' }}
                onMouseOver={e => e.currentTarget.style.backgroundColor = '#F5F5F5'}
                onMouseOut={e => e.currentTarget.style.backgroundColor = '#FAFAF8'}
              >
                取消
              </button>
              <button
                onClick={() => {
                  handleRenameBase(renamingBase.id, renameInput);
                }}
                disabled={!renameInput.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#769365' }}
                onMouseOver={e => { if (renameInput.trim()) e.currentTarget.style.backgroundColor = '#6a8660'; }}
                onMouseOut={e => e.currentTarget.style.backgroundColor = '#769365'}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Knowledge Card Component with Delete & Detail ---
function KnowledgeCardComponent({ card, knowledgeBases, onDelete, onViewDetail }: { card: KnowledgeCard; knowledgeBases: KnowledgeBase[]; onDelete: (id: string) => void; onViewDetail: (card: KnowledgeCard) => void }) {
  const [showDelete, setShowDelete] = useState(false);
  // Derive base info from passed-in knowledgeBases via stable knowledgeBaseId
  const cardBaseInfo = useMemo(() => {
    // Primary: look up by stable knowledgeBaseId
    const found = card.knowledgeBaseId
      ? knowledgeBases.find(kb => kb.id === card.knowledgeBaseId)
      : null;
    if (found) return { name: found.name, palette: found.palette };
    // Fallback: orphan card with no knowledgeBaseId — use legacy field (should be rare)
    return { name: card.knowledge_base || '其他', palette: { main: '#769365', light: '#EDF3EB', text: '#4E6B42' } };
  }, [knowledgeBases, card.knowledgeBaseId]);
  const hasValidUrl = card.source_url && card.source_type === 'link';

  return (
    <div
      className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group cursor-pointer"
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onClick={() => onViewDetail(card)}
    >
      {/* Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium line-clamp-2" style={{ color: '#42423A' }}>
              {card.title}
            </h4>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {cardBaseInfo.name && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: cardBaseInfo.palette.main }}
                >
                  {cardBaseInfo.name}
                </span>
              )}
              <span className="text-xs" style={{ color: '#8A9199' }}>
                {new Date(card.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
          {/* Actions */}
          <div className="flex items-center gap-1">
            {hasValidUrl && (
              <a
                href={card.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg transition-colors"
                style={{ color: '#8A9199' }}
                onClick={(e) => e.stopPropagation()}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#EDF3EB';
                  e.currentTarget.style.color = '#769365';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#8A9199';
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
            {showDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('确定要删除这张卡片吗？')) {
                    onDelete(card.id);
                  }
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: '#8A9199' }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#FEF2F2';
                  e.currentTarget.style.color = '#DC2626';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#8A9199';
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="px-5 pb-4">
        <p className="text-sm line-clamp-2" style={{ color: '#42423A' }}>{card.summary}</p>
      </div>

      {/* Key Points */}
      {card.key_points.length > 0 && card.key_points[0] !== '暂无明确的要点提炼' && (
        <div className="px-5 pb-4">
          <div className="space-y-2">
            {card.key_points.slice(0, 3).map((point, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: cardBaseInfo.palette.main }} />
                <span className="text-sm line-clamp-1" style={{ color: '#42423A' }}>{point}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {card.tags.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {card.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#F0F1F0', color: '#42423A' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actionable Tips */}
      {card.actionable_tips.length > 0 && (
        <div className="px-5 pb-5">
          <div className="rounded-xl p-3" style={{ backgroundColor: cardBaseInfo.palette.light }}>
            <p className="text-xs font-medium flex items-center gap-1 mb-1" style={{ color: cardBaseInfo.palette.text }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              可执行建议
            </p>
            <p className="text-xs line-clamp-2" style={{ color: '#42423A' }}>{card.actionable_tips[0]}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Import Base Dropdown (custom select matching MyDeck design) ---
function ImportBaseDropdown({
  bases,
  value,
  onChange,
}: {
  bases: KnowledgeBase[];
  value: string; // '' means AI auto
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = bases.filter(kb =>
    kb.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedBase = bases.find(kb => kb.name === value);

  return (
    <div ref={dropRef} className="relative flex-1">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs text-left transition-all"
        style={{
          borderColor: open ? '#769365' : '#DFE2DE',
          backgroundColor: 'white',
          color: selectedBase ? '#42423A' : '#8A9199',
          boxShadow: open ? '0 0 0 2px #EDF3EB' : 'none',
        }}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selectedBase ? (
            <>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedBase.palette.main }}
              />
              <span className="truncate">{selectedBase.name}</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span>自动分类（AI推荐）</span>
            </>
          )}
        </span>
        <svg
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: '#8A9199' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 rounded-xl border shadow-lg z-20 overflow-hidden"
          style={{ borderColor: '#DFE2DE', backgroundColor: 'white' }}
        >
          {/* Search */}
          {bases.length > 5 && (
            <div className="p-2 border-b" style={{ borderColor: '#EFF0EE' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索分类..."
                autoFocus
                className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6', color: '#42423A' }}
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}

          {/* Option list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {/* AI auto option */}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
              style={{
                backgroundColor: value === '' ? '#EDF3EB' : 'transparent',
                color: value === '' ? '#4E6B42' : '#42423A',
              }}
              onMouseOver={e => { if (value !== '') e.currentTarget.style.backgroundColor = '#F7F8F6'; }}
              onMouseOut={e => { if (value !== '') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span>自动分类（AI推荐）</span>
              {value === '' && (
                <svg className="w-3 h-3 ml-auto" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Divider */}
            {bases.length > 0 && <div className="my-1 border-t" style={{ borderColor: '#EFF0EE' }} />}

            {/* Base options */}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs" style={{ color: '#8A9199' }}>无匹配分类</div>
            ) : (
              filtered.map(kb => (
                <button
                  type="button"
                  key={kb.id}
                  onClick={() => { onChange(kb.name); setOpen(false); setSearch(''); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
                  style={{
                    backgroundColor: value === kb.name ? '#EDF3EB' : 'transparent',
                    color: value === kb.name ? '#4E6B42' : '#42423A',
                  }}
                  onMouseOver={e => { if (value !== kb.name) e.currentTarget.style.backgroundColor = '#F7F8F6'; }}
                  onMouseOut={e => { if (value !== kb.name) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: kb.palette.main }}
                  />
                  <span className="truncate">{kb.name}</span>
                  {value === kb.name && (
                    <svg className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Card Detail Modal ---
function CardDetailModal({
  card,
  onClose,
  knowledgeBases,
  onBaseChange,
  onCreateBase,
}: {
  card: KnowledgeCard;
  onClose: () => void;
  knowledgeBases: KnowledgeBase[];
  onBaseChange: (cardId: string, baseId: string | null) => void;
  onCreateBase: (baseName: string) => void;
}) {
  const modalBaseInfoMap = useMemo(() => {
    const map: Record<string, { name: string; palette: { main: string; light: string; text: string } }> = {};
    for (const kb of knowledgeBases) {
      map[kb.id] = { name: kb.name, palette: kb.palette };
    }
    return map;
  }, [knowledgeBases]);

  const kbInfo = card.knowledgeBaseId
    ? (modalBaseInfoMap[card.knowledgeBaseId] ?? { name: card.knowledge_base || '其他', palette: { main: '#769365', light: '#EDF3EB', text: '#4E6B42' } })
    : { name: card.knowledge_base || '其他', palette: { main: '#769365', light: '#EDF3EB', text: '#4E6B42' } };
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const [baseSearch, setBaseSearch] = useState('');
  const [showNewBaseInput, setShowNewBaseInput] = useState(false);
  const [newBaseName, setNewBaseName] = useState('');

  const filteredBases = knowledgeBases.filter(kb =>
    kb.name.toLowerCase().includes(baseSearch.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b" style={{ borderColor: '#DFE2DE' }}>
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-lg font-semibold" style={{ color: '#42423A' }}>{card.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* Category badge — clickable dropdown */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowBaseDropdown(prev => !prev); setBaseSearch(''); }}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-white transition-opacity"
                  style={{ backgroundColor: kbInfo.palette.main }}
                  title="点击修改分类"
                >
                  {kbInfo.name}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown */}
                {showBaseDropdown && (
                  <div
                    className="absolute top-full left-0 mt-1.5 w-48 rounded-xl shadow-lg border overflow-hidden z-10"
                    style={{ backgroundColor: 'white', borderColor: '#DFE2DE' }}
                    onClick={e => e.stopPropagation()}
                    onMouseLeave={() => setShowBaseDropdown(false)}
                  >
                    <div className="p-2 border-b" style={{ borderColor: '#DFE2DE' }}>
                      <input
                        type="text"
                        value={baseSearch}
                        onChange={e => setBaseSearch(e.target.value)}
                        placeholder="搜索分类..."
                        autoFocus
                        className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                        style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6', color: '#42423A' }}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto py-1">
                      {filteredBases.length === 0 && !showNewBaseInput && (
                        <div className="px-3 py-2 text-xs" style={{ color: '#8A9199' }}>无匹配分类</div>
                      )}
                      {filteredBases.map(kb => (
                        <button
                          key={kb.id}
                          onClick={() => {
                            onBaseChange(card.id, kb.id);
                            setShowBaseDropdown(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                          style={{
                            backgroundColor: kb.name === kbInfo.name ? '#EDF3EB' : 'transparent',
                            color: '#42423A',
                          }}
                          onMouseOver={e => { if (kb.name !== kbInfo.name) e.currentTarget.style.backgroundColor = '#F7F8F6'; }}
                          onMouseOut={e => { if (kb.name !== kbInfo.name) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: kb.palette.main }} />
                          <span className="truncate">{kb.name}</span>
                          {kb.name === kbInfo.name && (
                            <svg className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: '#769365' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}

                      {/* Inline create new base */}
                      {showNewBaseInput ? (
                        <div className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={newBaseName}
                              onChange={e => setNewBaseName(e.target.value)}
                              placeholder="分类名称..."
                              autoFocus
                              className="flex-1 px-2 py-1 rounded border text-xs outline-none"
                              style={{ borderColor: '#DFE2DE', backgroundColor: '#F7F8F6', color: '#42423A' }}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newBaseName.trim()) {
                                  onCreateBase(newBaseName.trim());
                                  setShowNewBaseInput(false);
                                  setNewBaseName('');
                                }
                                if (e.key === 'Escape') {
                                  setShowNewBaseInput(false);
                                  setNewBaseName('');
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (newBaseName.trim()) {
                                  onCreateBase(newBaseName.trim());
                                  setShowNewBaseInput(false);
                                  setNewBaseName('');
                                }
                              }}
                              className="px-2 py-1 rounded text-xs text-white"
                              style={{ backgroundColor: '#769365' }}
                            >
                              创建
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setShowNewBaseInput(true);
                            setNewBaseName(baseSearch);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                          style={{ color: '#769365' }}
                          onMouseOver={e => e.currentTarget.style.backgroundColor = '#F7F8F6'}
                          onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span>新建分类</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <span className="text-xs" style={{ color: '#8A9199' }}>
                {new Date(card.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors flex-shrink-0"
            style={{ color: '#8A9199' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F0F1F0'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary */}
          {card.summary && (
            <div>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#8A9199' }}>摘要</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#42423A' }}>{card.summary}</p>
            </div>
          )}

          {/* Key Points */}
          {card.key_points.length > 0 && card.key_points[0] !== '暂无明确的要点提炼' && (
            <div>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#8A9199' }}>核心要点</h3>
              <div className="space-y-3">
                {card.key_points.map((point, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: kbInfo.palette.main }} />
                    <span className="text-sm leading-relaxed" style={{ color: '#42423A' }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actionable Tips */}
          {card.actionable_tips.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#8A9199' }}>可执行建议</h3>
              <div className="space-y-2">
                {card.actionable_tips.map((tip, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ backgroundColor: kbInfo.palette.light }}>
                    <p className="text-sm leading-relaxed" style={{ color: kbInfo.palette.text }}>{tip}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {card.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#8A9199' }}>标签</h3>
              <div className="flex flex-wrap gap-2">
                {card.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: '#F0F1F0', color: '#42423A' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source URL */}
          {card.source_url && (
            <div>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#8A9199' }}>来源</h3>
              <a
                href={card.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline break-all"
                style={{ color: '#769365' }}
              >
                {card.source_url}
              </a>
            </div>
          )}

          {/* Extracted Text — only for non-link cards; link cards have messy raw content not worth showing */}
          {card.original_text && card.source_type !== 'link' && (
            <div>
              <button
                onClick={() => {
                  const el = document.getElementById(`extracted-text-${card.id}`);
                  if (el) el.classList.toggle('hidden');
                }}
                className="text-sm font-medium mb-2 flex items-center gap-1 transition-colors"
                style={{ color: '#8A9199' }}
                onMouseOver={(e) => e.currentTarget.style.color = '#5A5F58'}
                onMouseOut={(e) => e.currentTarget.style.color = '#8A9199'}
              >
                <span>提取文本</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                id={`extracted-text-${card.id}`}
                className="hidden text-sm leading-relaxed whitespace-pre-wrap rounded-xl p-4 overflow-auto max-h-64"
                style={{ backgroundColor: '#F7F8F6', color: '#42423A', border: '1px solid #DFE2DE' }}>
                {card.original_text}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Chat Input (multi-line textarea, ~3 rows default) ---
function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !disabled) {
        onSend(text.trim());
        setText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend(text.trim());
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? '请先配置大模型接口' : '输入问题...（Enter 发送，Shift+Enter 换行）'}
          disabled={disabled}
          rows={3}
          className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none transition-all resize-none"
          style={{
            borderColor: '#DFE2DE',
            backgroundColor: '#F7F8F6',
            minHeight: '76px',
            maxHeight: '160px',
            lineHeight: '1.5',
          }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="px-4 py-3 rounded-xl transition-all flex items-center justify-center self-end mb-0.5 disabled:opacity-40"
          style={{ backgroundColor: disabled ? '#ccc' : '#769365', color: 'white' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Session Tab (div wrapper + direct hover delete, no button nesting) ---
function SessionTab({ session, isActive, baseInfoMap, onSelect, onDelete }: {
  session: ChatSession;
  isActive: boolean;
  baseInfoMap: Record<string, { name: string; palette: { main: string; light: string; text: string } }>;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const scopeLabel = session.scope && session.scope !== 'all'
    ? (baseInfoMap[session.scope!]?.name || session.scope)
    : '全部';

  return (
    <div className="relative flex-shrink-0 group" style={{ paddingBottom: '2px' }}>
      <div
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer mr-3"
        style={
          isActive
            ? { backgroundColor: '#769365', color: 'white' }
            : { backgroundColor: '#F0F1F0', color: '#42423A' }
        }
        onClick={onSelect}
        onMouseOver={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = '#EDF3EB';
            e.currentTarget.style.color = '#769365';
          }
        }}
        onMouseOut={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = '#F0F1F0';
            e.currentTarget.style.color = '#42423A';
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
      >
        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="truncate max-w-[80px]">{session.name}</span>
      </div>

      {/* Scope label below tab */}
      <div
        className="text-xs truncate px-1 mt-0.5"
        style={{
          color: '#8A9199',
          maxWidth: '90px',
        }}
        title={`${session.name} · ${scopeLabel}`}
      >
        {scopeLabel}
      </div>

      {/* Delete button — only on non-active tabs, visible on group hover */}
      {!isActive && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`确定删除「${session.name}」？`)) {
              onDelete();
            }
          }}
          className="absolute -top-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: '#e2e8f0', color: '#94a3b8', right: '8px' }}
          title="删除对话"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
