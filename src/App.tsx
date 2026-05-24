import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  Calculator,
  Clock3,
  Download,
  FileText,
  FilePlus2,
  Gauge,
  Layers,
  Library,
  LoaderCircle,
  MessageSquareText,
  NotebookTabs,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { calculateScale, findKnowledge, findRecipes, formatScaleResult, parseKnowledgeMarkdown, parseRecipeMarkdown, searchByIngredient } from './bakerCore';
import { handleRuleChat, type ChatAction } from './chatEngine';
import { knowledgeFiles, recipeFiles } from './dataManifest';
import {
  askAiGroundedReply,
  askAiRecipeDraft,
  browserPreviewAiStatus,
  getAiStatus,
  aiRuntimeLabel,
  isAiReady,
  readDesktopRecipePacks,
  stopAiRuntime,
  type AiIntentPayload,
  type AiRuntimeStatus,
} from './desktopAi';
import type { ChatMessage, Ingredient, KnowledgeDoc, PinItem, Recipe, ScaleResult } from './types';

type ViewMode = 'chat' | 'recipes' | 'techniques' | 'import';
type RecipeLibrarySelection = 'recipe' | 'formula';
type EditableMetadata = {
  featured?: boolean;
  badges?: string[];
};
type MetadataOverrideMap = Record<string, EditableMetadata>;
type BackupEntry = {
  id: string;
  path: string;
  raw: string;
};

function BakerDeskLogo({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="baker-logo" fill="none" height={size} viewBox="0 0 32 32" width={size}>
      <path
        d="M9.7 16.4a5.2 5.2 0 0 1 1.4-10.2c1.2 0 2.4.4 3.3 1.1A5.8 5.8 0 0 1 24 11.6a4.8 4.8 0 0 1-1.7 9.3H10a4.3 4.3 0 0 1-.3-4.5Z"
        fill="currentColor"
      />
      <path d="M10 18.2h12.2v6.4H10z" fill="currentColor" />
      <path d="M11.5 21.2h9.2" stroke="#246e65" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
type UserDataBackup = {
  app: 'Baker Desk';
  version: 1;
  exportedAt: string;
  localRecipes: BackupEntry[];
  metadataOverrides: MetadataOverrideMap;
  pins: PinItem[];
};

type DraftIngredient = {
  id: string;
  name: string;
  grams: string;
};

const quickPrompts = ['适合早餐的配方', '可以融合坚果的配方', '帮我把 brioche 缩放到 500g 面粉', '甘那许比例是多少'];

const formulaDocIds = new Set([
  'biscuit-joconde-dacquoise',
  'creme-mousseline',
  'creme-patissiere',
  'ganache',
  'meringue',
  'pate-a-choux',
  'pate-sucree',
  'praline-croustillant',
]);

const badgeOptions = [
  'stable',
  'scalable',
  'fast',
  'filling',
  'structure',
  'chocolate',
  'crisp',
  'mousse',
  'tart',
  'make-ahead',
  'classic',
  'light',
  'rich',
  'flexible',
  'sauce',
  'decoration',
  'fruit',
  'nutty',
];

export default function App() {
  const [baseRecipes, setBaseRecipes] = useState<Recipe[]>([]);
  const [customRecipes, setCustomRecipes] = useState<Recipe[]>([]);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [metadataOverrides, setMetadataOverrides] = useState<MetadataOverrideMap>(() => loadMetadataOverrides());
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [recipeLibrarySelection, setRecipeLibrarySelection] = useState<RecipeLibrarySelection>('recipe');
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [baseHint, setBaseHint] = useState('farine');
  const [targetGrams, setTargetGrams] = useState(500);
  const [aiStatus, setAiStatus] = useState<AiRuntimeStatus>(browserPreviewAiStatus);
  const [aiBusy, setAiBusy] = useState(false);
  const [pins, setPins] = useState<PinItem[]>(() => loadStoredPins());
  const [pinboardOpen, setPinboardOpen] = useState(() => loadPinboardOpenPreference());
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComponent, setDraftComponent] = useState('Appareil principal 主体');
  const [draftIngredients, setDraftIngredients] = useState<DraftIngredient[]>([
    { id: crypto.randomUUID(), name: 'farine T45', grams: '100' },
    { id: crypto.randomUUID(), name: 'sucre', grams: '60' },
  ]);
  const [draftSteps, setDraftSteps] = useState('');
  const [markdownInput, setMarkdownInput] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [importAssistBusy, setImportAssistBusy] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [recipeEditMarkdown, setRecipeEditMarkdown] = useState('');
  const [recipeEditNotice, setRecipeEditNotice] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Baker Desk 已进入本地规则模式。你可以查配方、缩放配方，或打开技法卡片；右侧图钉板可以保留要对照的内容。',
    },
  ]);

  const knowledgeItems = useMemo(
    () => knowledgeDocs.map((doc) => applyKnowledgeMetadataOverride(doc, metadataOverrides)),
    [knowledgeDocs, metadataOverrides],
  );
  const availableRecipes = useMemo(
    () => [...baseRecipes, ...customRecipes].map((recipe) => applyRecipeMetadataOverride(recipe, metadataOverrides)),
    [baseRecipes, customRecipes, metadataOverrides],
  );
  const referencedRecipes = useMemo(
    () => buildReferencedRecipes(knowledgeItems, availableRecipes).map((recipe) => applyRecipeMetadataOverride(recipe, metadataOverrides)),
    [knowledgeItems, availableRecipes, metadataOverrides],
  );
  const recipes = useMemo(() => [...availableRecipes, ...referencedRecipes], [availableRecipes, referencedRecipes]);
  const selectedRecipeView = useMemo(
    () => (selectedRecipe ? applyRecipeMetadataOverride(selectedRecipe, metadataOverrides) : null),
    [selectedRecipe, metadataOverrides],
  );
  const selectedDocView = useMemo(
    () => (selectedDoc ? applyKnowledgeMetadataOverride(selectedDoc, metadataOverrides) : null),
    [selectedDoc, metadataOverrides],
  );

  useEffect(() => {
    async function loadData() {
      const storedRecipes = loadStoredRecipes();
      const packRecipes = await loadDesktopPackRecipes();
      const customRecipeMap = new Map<string, Recipe>();
      packRecipes.forEach((recipe) => customRecipeMap.set(recipe.id, recipe));
      storedRecipes.forEach((recipe) => customRecipeMap.set(recipe.id, recipe));
      const mergedCustomRecipes = [...customRecipeMap.values()];
      setCustomRecipes(mergedCustomRecipes);
      if (packRecipes.length) {
        persistStoredRecipes(mergedCustomRecipes);
        setImportNotice(`已自动读取 ${packRecipes.length} 份 recipe-packs 配方；本地已有同名配方会优先保留。`);
      }
      const loadedRecipes = await Promise.all(
        recipeFiles.map(async (file) => {
          const raw = await fetch(file.path).then((response) => response.text());
          return parseRecipeMarkdown(file.id, file.path, raw);
        }),
      );
      const loadedDocs = await Promise.all(
        knowledgeFiles.map(async (file) => {
          const raw = await fetch(file.path).then((response) => response.text());
          return parseKnowledgeMarkdown(file.id, file.path, raw);
        }),
      );

      setBaseRecipes(loadedRecipes);
      setKnowledgeDocs(loadedDocs);
      setSelectedRecipe(loadedRecipes[0] ?? null);
      setSelectedDoc(loadedDocs.find((doc) => doc.id === 'ganache') ?? loadedDocs[0] ?? null);
    }

    void loadData();
  }, []);

  useEffect(() => {
    void refreshAiStatus();
  }, []);

  const recipeResults = useMemo(() => sortRecipesByPriority(findRecipes(recipes, searchQuery)), [recipes, searchQuery]);
  const recipeBackedDocIds = useMemo(
    () => new Set(availableRecipes.map((recipe) => recipe.sourceDocId).filter(Boolean)),
    [availableRecipes],
  );
  const formulaDocs = useMemo(() => knowledgeItems.filter(isFormulaDoc), [knowledgeItems]);
  const techniqueDocs = useMemo(() => knowledgeItems.filter((doc) => !isFormulaDoc(doc)), [knowledgeItems]);
  const formulaResults = useMemo(
    () => sortKnowledgeByPriority(filterKnowledge(formulaDocs.filter((doc) => !recipeBackedDocIds.has(doc.id)), searchQuery)),
    [formulaDocs, recipeBackedDocIds, searchQuery],
  );
  const techniqueResults = useMemo(() => sortKnowledgeByPriority(filterKnowledge(techniqueDocs, searchQuery)), [techniqueDocs, searchQuery]);
  const scaleResult = useMemo(
    () => (selectedRecipeView && selectedRecipeView.status !== 'referenced' ? calculateScale(selectedRecipeView, baseHint, targetGrams) : null),
    [selectedRecipeView, baseHint, targetGrams],
  );

  async function refreshAiStatus() {
    try {
      setAiStatus(await getAiStatus());
    } catch (error) {
      setAiStatus({
        ...browserPreviewAiStatus,
        mode: 'rules',
        detail: `AI 状态读取失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async function stopAiService() {
    try {
      await stopAiRuntime();
      await refreshAiStatus();
      pushMessage(
        'assistant',
        aiStatus.mode === 'ollama-local'
          ? '已停止 Baker Desk 自己启动的内置 Qwen；Ollama 是外部服务，需要在 Ollama 客户端或系统托盘里关闭。'
          : '本地 Qwen 服务已停止。下次对话会按需重新启动。',
      );
    } catch (error) {
      pushMessage('assistant', `停止本地 AI 服务失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function pushMessage(role: ChatMessage['role'], text: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }]);
  }

  function applyChatAction(action: ChatAction) {
    if (action.type === 'selectRecipe') {
      setSelectedRecipe(action.recipe);
      setBaseHint(action.recipe.baseHint ?? baseHint);
      setViewMode('recipes');
    }

    if (action.type === 'showKnowledge') {
      setSelectedDoc(action.doc);
      if (isFormulaDoc(action.doc)) {
        setRecipeLibrarySelection('formula');
        setViewMode('recipes');
      } else {
        setViewMode('techniques');
      }
    }

    pushMessage('assistant', action.response);
  }

  async function runPrompt(prompt: string) {
    if (!prompt.trim()) return;
    const aiPrompt = buildAiPromptWithContext(prompt, messages);
    pushMessage('user', prompt);

    if (isAiReady(aiStatus)) {
      setAiBusy(true);
      try {
        const localAction = handleRuleChat(prompt, recipes, knowledgeItems);
        const voicedAction = await addGroundedAiVoice(prompt, aiPrompt, localAction);
        applyChatAction(withAnswerSource(voicedAction, '本地规则'));
      } catch (error) {
        const fallback = handleRuleChat(prompt, recipes, knowledgeItems);
        applyChatAction(withAnswerSource({ ...fallback, response: `${fallback.response}\n\n${formatAiFallbackReason(error)}` }, '本地规则（AI 调用失败）'));
      } finally {
        setAiBusy(false);
      }
      return;
    }

    applyChatAction(withAnswerSource(handleRuleChat(prompt, recipes, knowledgeItems), '本地规则'));
  }

  async function addGroundedAiVoice(prompt: string, aiPrompt: string, action: ChatAction): Promise<ChatAction> {
    if (!shouldUseGroundedAiVoice(prompt, action)) return action;
    try {
      const reply = await askAiGroundedReply(aiPrompt, buildLocalReplyForAi(action), recipes, knowledgeItems);
      if (!reply) {
        return {
          ...action,
          response: `${action.response}\n\n提示：本地 AI 这次返回为空或被判定不可用，没有参与最终回答。`,
        };
      }
      return { ...action, response: `${reply.text}\n\n来源：${reply.source}（候选、计算与库内上下文来自 Baker Desk）` };
    } catch (error) {
      return {
        ...action,
        response: `${action.response}\n\n${formatAiFallbackReason(error)}`,
      };
    }
  }

  function buildAiPromptWithContext(prompt: string, messages: ChatMessage[]): string {
    const context = messages
      .slice(-6)
      .map((message) => `${message.role === 'user' ? '用户' : 'Baker Desk'}：${stripAnswerSource(message.text)}`)
      .join('\n');
    if (!context.trim()) return prompt;
    return `对话上下文：\n${context}\n\n当前用户问题：\n${prompt}`;
  }

  function stripAnswerSource(text: string): string {
    return text
      .replace(/\n\n来源：[\s\S]*$/m, '')
      .replace(/\n\n提示：[\s\S]*$/m, '')
      .trim();
  }

  function buildLocalReplyForAi(action: ChatAction): string {
    if (!action.grounding) return action.response;
    return `${action.response}\n\n规则评分材料：\n${action.grounding}`;
  }

  function withAnswerSource(action: ChatAction, source: string): ChatAction {
    if (/\n\n来源：/.test(action.response)) return action;
    return { ...action, response: `${action.response}\n\n来源：${source}` };
  }

  function resolveAiIntent(intent: AiIntentPayload | null, prompt: string): ChatAction | null {
    if (!intent?.intent) return null;
    const kind = intent.intent;
    if (looksLikeLocalRulePrompt(prompt)) return null;
    if (kind !== 'recommend_recipe' && looksLikePreferencePrompt(prompt) && !looksLikeExplicitLookupPrompt(prompt)) return null;

    if (kind === 'scale_recipe') {
      if (!looksLikeScalePrompt(prompt)) return null;
      const query = firstText(intent.recipeQuery, intent.recipe_query, prompt);
      const recipe = findRecipes(recipes, query)[0];
      if (!recipe || recipe.status === 'referenced') {
        return { type: 'plain', response: `本地 AI 判断你想缩放「${query}」，但本地可计算配方库里还没找到它。` };
      }
      const target = firstNumber(intent.targetGrams, intent.target_grams, extractGramsFromPrompt(prompt));
      const hint = firstText(intent.baseHint, intent.base_hint, recipe.baseHint, baseHint);
      const result = calculateScale(recipe, hint, target ?? undefined);
      return {
        type: 'selectRecipe',
        recipe,
        response: `已识别为配方缩放。\n${formatScaleResult(recipe, result, target ?? undefined)}`,
      };
    }

    if (kind === 'find_recipe') {
      const query = firstText(intent.recipeQuery, intent.recipe_query, prompt);
      const recipe = findRecipes(recipes, query)[0];
      if (!recipe) return { type: 'plain', response: `本地 AI 判断你在找「${query}」，但本地库里暂时没有匹配配方。` };
      return {
        type: 'selectRecipe',
        recipe,
        response: `已识别为配方查询：${displayRecipeTitle(recipe.title)}。`,
      };
    }

    if (kind === 'ingredient_search') {
      const query = firstText(intent.ingredientQuery, intent.ingredient_query, prompt);
      const matches = searchByIngredient(recipes, query);
      if (!matches.length) return { type: 'plain', response: `本地 AI 判断你在按原料查「${query}」，但暂时没有匹配配方。` };
      return {
        type: 'plain',
        response: `已识别为原料检索。找到 ${matches.length} 个相关配方：\n${matches
          .map((recipe) => `- ${displayRecipeTitle(recipe.title)}`)
          .join('\n')}`,
      };
    }

    if (kind === 'recommend_recipe') {
      const ruleInput = firstText([prompt, intent.reply].filter(Boolean).join(' '), prompt);
      const action = handleRuleChat(ruleInput, recipes, knowledgeItems);
      return {
        ...action,
        response: action.response.startsWith('已识别') ? action.response : `已识别为偏好推荐。\n${action.response}`,
      };
    }

    if (kind === 'show_knowledge') {
      const query = firstText(intent.docQuery, intent.doc_query, intent.reply, prompt);
      const doc = findKnowledge(knowledgeItems, query);
      if (!doc) return { type: 'plain', response: `本地 AI 判断你想看「${query}」相关技法，但技法库里还没有匹配卡片。` };
      return { type: 'showKnowledge', doc, response: `已识别为技法查询：${displayKnowledgeTitle(doc.title)}。` };
    }

    if (kind === 'answer' && intent.reply?.trim()) {
      return { type: 'plain', response: intent.reply.trim() };
    }

    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = chatInput.trim();
    setChatInput('');
    void runPrompt(prompt);
  }

  function selectRecipe(recipe: Recipe) {
    setSelectedRecipe(recipe);
    setBaseHint(recipe.baseHint ?? baseHint);
    setRecipeLibrarySelection('recipe');
    setViewMode('recipes');
  }

  function selectDoc(doc: KnowledgeDoc) {
    setSelectedDoc(doc);
    if (isFormulaDoc(doc)) {
      setRecipeLibrarySelection('formula');
      setViewMode('recipes');
    } else {
      setViewMode('techniques');
    }
  }

  function saveRecipeMarkdown(raw: string, origin: 'form' | 'markdown') {
    const validation = validateRecipeMarkdown(raw);
    if (validation.length) {
      setImportNotice(`录入规则检查：${validation.join('；')}`);
      return;
    }
    const title = raw.match(/^titre:\s*(.+)$/m)?.[1]?.trim() ?? raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'LOCAL RECIPE';
    const id = `local-${slugify(title)}-${Date.now()}`;
    const recipe = parseRecipeMarkdown(id, `/local-recipes/${id}.md`, raw);
    const next = [recipe, ...customRecipes];
    setCustomRecipes(next);
    persistStoredRecipes(next);
    setSelectedRecipe(recipe);
    setViewMode('recipes');
    setImportNotice(
      origin === 'form' ? `已录入 ${displayRecipeTitle(recipe.title)}，并加入配方库。` : `已导入 ${displayRecipeTitle(recipe.title)}，并加入配方库。`,
    );
  }

  function saveDraftRecipe() {
    const validRows = draftIngredients.filter((item) => item.name.trim() && Number(item.grams) > 0);
    if (!draftTitle.trim() || !validRows.length) {
      setImportNotice('请至少填写配方名和一行有效原料。');
      return;
    }
    saveRecipeMarkdown(buildRecipeMarkdown(draftTitle, draftComponent, validRows, draftSteps), 'form');
  }

  function importMarkdownRecipe() {
    if (!markdownInput.trim()) {
      setImportNotice('请先粘贴 Markdown 配方。');
      return;
    }
    saveRecipeMarkdown(markdownInput, 'markdown');
  }

  function startRecipeEdit(recipe: Recipe) {
    if (recipe.status === 'referenced') {
      setRecipeEditNotice('这条只是知识库实例引用，还没有完整 Markdown 原料表；请先在“录入”页导入完整配方。');
      return;
    }
    setEditingRecipeId(recipe.id);
    setRecipeEditMarkdown(recipe.raw);
    setRecipeEditNotice(
      recipe.path.startsWith('/local-recipes/')
        ? '正在编辑本地配方。保存后会更新这个本地版本，并参与搜索、缩放和备份。'
        : '这是内置配方。保存时会另存为本地副本，不会改动内置库。',
    );
  }

  function cancelRecipeEdit() {
    setEditingRecipeId(null);
    setRecipeEditMarkdown('');
    setRecipeEditNotice('');
  }

  function saveRecipeEdit(recipe: Recipe) {
    if (!recipeEditMarkdown.trim()) {
      setRecipeEditNotice('编辑内容为空，不能保存。');
      return;
    }

    const validation = validateRecipeMarkdown(recipeEditMarkdown);
    if (validation.length) {
      setRecipeEditNotice(`保存前需要修正：${validation.join('；')}`);
      return;
    }

    const isLocal = recipe.path.startsWith('/local-recipes/');
    const title =
      recipeEditMarkdown.match(/^titre:\s*(.+)$/m)?.[1]?.trim() ??
      recipeEditMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      recipe.title;
    const id = isLocal ? recipe.id : `local-${slugify(title)}-${Date.now()}`;
    const path = isLocal ? recipe.path : `/local-recipes/${id}.md`;
    const parsed = parseRecipeMarkdown(id, path, recipeEditMarkdown);
    const next = isLocal ? customRecipes.map((item) => (item.id === recipe.id ? parsed : item)) : [parsed, ...customRecipes];

    setCustomRecipes(next);
    persistStoredRecipes(next);
    setSelectedRecipe(parsed);
    setRecipeLibrarySelection('recipe');
    setViewMode('recipes');
    setEditingRecipeId(null);
    setRecipeEditMarkdown('');
    setRecipeEditNotice(isLocal ? `已保存 ${displayRecipeTitle(parsed.title)} 的本地修改。` : `已将 ${displayRecipeTitle(parsed.title)} 另存为本地配方。`);
  }

  async function organizeMarkdownRecipe() {
    if (!markdownInput.trim()) {
      setImportNotice('先粘贴手写转文字、网页片段或随手记，再点整理草稿。');
      return;
    }

    setImportAssistBusy(true);
    try {
      let aiDraft: string | null = null;
      if (isAiReady(aiStatus)) {
        try {
          aiDraft = await askAiRecipeDraft(markdownInput);
        } catch {
          aiDraft = null;
        }
      }

      const draft = chooseAssistedRecipeMarkdown(markdownInput, aiDraft);
      setMarkdownInput(draft);
      const validation = validateRecipeMarkdown(draft);
      const source = aiDraft ? '已用本地 AI 整理成 Markdown 草稿' : '已用本地规则整理成 Markdown 草稿';
      setImportNotice(validation.length ? `${source}；仍需人工检查：${validation.join('；')}` : `${source}，请复核后点“导入”。`);
    } finally {
      setImportAssistBusy(false);
    }
  }

  function updateDraftIngredient(id: string, patch: Partial<DraftIngredient>) {
    setDraftIngredients((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addDraftIngredient() {
    setDraftIngredients((current) => [...current, { id: crypto.randomUUID(), name: '', grams: '' }]);
  }

  function removeDraftIngredient(id: string) {
    setDraftIngredients((current) => current.filter((item) => item.id !== id));
  }

  function togglePin(item: PinItem) {
    setPins((current) => {
      const next = current.some((pin) => pin.id === item.id)
        ? current.filter((pin) => pin.id !== item.id)
        : [item, ...current].slice(0, 8);
      persistStoredPins(next);
      return next;
    });
  }

  function togglePinboardOpen() {
    setPinboardOpen((current) => {
      const next = !current;
      persistPinboardOpenPreference(next);
      return next;
    });
  }

  function isPinned(id: string) {
    return pins.some((pin) => pin.id === id);
  }

  function updateMetadataOverride(key: string, metadata: EditableMetadata) {
    setMetadataOverrides((current) => {
      const next = {
        ...current,
        [key]: {
          featured: Boolean(metadata.featured),
          badges: uniqueBadgeKeys(metadata.badges ?? []),
        },
      };
      persistMetadataOverrides(next);
      return next;
    });
  }

  function updateRecipeMetadata(recipe: Recipe, metadata: EditableMetadata) {
    updateMetadataOverride(metadataKey('recipe', recipe.id), metadata);
  }

  function updateKnowledgeMetadata(doc: KnowledgeDoc, metadata: EditableMetadata) {
    updateMetadataOverride(metadataKey('knowledge', doc.id), metadata);
  }

  function exportUserData() {
    const backup: UserDataBackup = {
      app: 'Baker Desk',
      version: 1,
      exportedAt: new Date().toISOString(),
      localRecipes: serializeLocalRecipes(customRecipes),
      metadataOverrides,
      pins,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `baker-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 200);
    setImportNotice(`已导出 ${backup.localRecipes.length} 份本地配方、${Object.keys(metadataOverrides).length} 条标签设置和 ${pins.length} 个固定项。`);
  }

  async function importUserData(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<UserDataBackup>;
      if (parsed.app !== 'Baker Desk' || parsed.version !== 1) {
        setImportNotice('这个文件不是 Baker Desk v1 数据包。');
        return;
      }

      const backupEntries = Array.isArray(parsed.localRecipes) ? parsed.localRecipes : [];
      const importedRecipes = backupEntries
        .filter(isBackupEntry)
        .map((entry) => parseRecipeMarkdown(entry.id, entry.path, entry.raw));
      const importedOverrides = normalizeMetadataOverrides(parsed.metadataOverrides);
      const importedPins = Array.isArray(parsed.pins) ? parsed.pins : [];
      const recipeMap = new Map<string, Recipe>();
      [...customRecipes, ...importedRecipes].forEach((recipe) => recipeMap.set(recipe.id, recipe));
      const nextRecipes = [...recipeMap.values()];
      setCustomRecipes(nextRecipes);
      persistStoredRecipes(nextRecipes);

      const nextOverrides = {
        ...metadataOverrides,
        ...importedOverrides,
      };
      setMetadataOverrides(nextOverrides);
      persistMetadataOverrides(nextOverrides);

      const nextPins = mergePins(pins, importedPins);
      setPins(nextPins);
      persistStoredPins(nextPins);

      if (importedRecipes[0]) {
        setSelectedRecipe(importedRecipes[0]);
        setRecipeLibrarySelection('recipe');
        setViewMode('recipes');
      }
      setImportNotice(`已导入 ${importedRecipes.length} 份本地配方、${Object.keys(importedOverrides).length} 条标签设置和 ${nextPins.length} 个固定项。`);
    } catch {
      setImportNotice('导入失败：数据包不是有效 JSON，或内容已损坏。');
    }
  }

  return (
    <div className={`app-shell ${pinboardOpen ? 'pinboard-open' : 'pinboard-collapsed'}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <BakerDeskLogo size={28} />
          </div>
          <div>
            <h1>Baker Desk</h1>
            <p>本地烘焙配方助手</p>
          </div>
        </div>

        <div className="mode-line">
          {isAiReady(aiStatus) ? <Bot size={16} /> : <Gauge size={16} />}
          <span>{isAiReady(aiStatus) ? `规则检索 + ${aiRuntimeLabel(aiStatus)} 回答` : '本地规则模式'}</span>
        </div>

        <nav className="view-nav" aria-label="主视图">
          <button className={viewMode === 'chat' ? 'active' : ''} onClick={() => setViewMode('chat')}>
            <MessageSquareText size={17} />
            对话
          </button>
          <button className={viewMode === 'recipes' ? 'active' : ''} onClick={() => setViewMode('recipes')}>
            <Library size={17} />
            配方库
          </button>
          <button className={viewMode === 'techniques' ? 'active' : ''} onClick={() => setViewMode('techniques')}>
            <NotebookTabs size={17} />
            技法库
          </button>
          <button className={viewMode === 'import' ? 'active' : ''} onClick={() => setViewMode('import')}>
            <FilePlus2 size={17} />
            录入
          </button>
        </nav>

        <label className="search-box" aria-label="搜索">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索配方、技法、原料"
          />
        </label>

        <section className="sidebar-summary">
          <span>{baseRecipes.length} 个内置可计算</span>
          <span>{customRecipes.length} 份本地录入</span>
          <span>{referencedRecipes.length} 条库内实例引用</span>
          <span>{techniqueDocs.length} 张技法卡片</span>
        </section>
      </aside>

      <main className="main-panel">
        {viewMode === 'chat' && (
          <ChatView
            aiBusy={aiBusy}
            aiStatus={aiStatus}
            chatInput={chatInput}
            messages={messages}
            quickPrompts={quickPrompts}
            refreshAiStatus={refreshAiStatus}
            stopAiService={stopAiService}
            setChatInput={setChatInput}
            handleSubmit={handleSubmit}
            runPrompt={runPrompt}
          />
        )}

        {viewMode === 'recipes' && (
          <RecipeLibraryView
            baseHint={baseHint}
            formulaResults={formulaResults}
            isPinned={isPinned}
            recipes={recipes}
            recipeResults={recipeResults}
            scaleResult={scaleResult}
            searchQuery={searchQuery}
            selectedFormulaDoc={
              recipeLibrarySelection === 'formula' && selectedDocView && isFormulaDoc(selectedDocView) ? selectedDocView : null
            }
            selectedRecipe={selectedRecipeView}
            selectDoc={selectDoc}
            selectRecipe={selectRecipe}
            cancelRecipeEdit={cancelRecipeEdit}
            editingRecipeId={editingRecipeId}
            recipeEditMarkdown={recipeEditMarkdown}
            recipeEditNotice={recipeEditNotice}
            saveRecipeEdit={saveRecipeEdit}
            setBaseHint={setBaseHint}
            setRecipeEditMarkdown={setRecipeEditMarkdown}
            setTargetGrams={setTargetGrams}
            startRecipeEdit={startRecipeEdit}
            targetGrams={targetGrams}
            togglePin={togglePin}
            updateDocMetadata={updateKnowledgeMetadata}
            updateRecipeMetadata={updateRecipeMetadata}
          />
        )}

        {viewMode === 'techniques' && (
          <TechniqueLibraryView
            docs={techniqueResults}
            isPinned={isPinned}
            recipes={recipes}
            selectedDoc={selectedDocView && !isFormulaDoc(selectedDocView) ? selectedDocView : techniqueResults[0] ?? null}
            selectDoc={selectDoc}
            selectRecipe={selectRecipe}
            togglePin={togglePin}
            updateDocMetadata={updateKnowledgeMetadata}
          />
        )}

        {viewMode === 'import' && (
          <RecipeImportView
            addDraftIngredient={addDraftIngredient}
            aiStatus={aiStatus}
            draftComponent={draftComponent}
            draftIngredients={draftIngredients}
            draftSteps={draftSteps}
            draftTitle={draftTitle}
            importMarkdownRecipe={importMarkdownRecipe}
            importAssistBusy={importAssistBusy}
            importNotice={importNotice}
            importUserData={importUserData}
            markdownInput={markdownInput}
            organizeMarkdownRecipe={organizeMarkdownRecipe}
            removeDraftIngredient={removeDraftIngredient}
            saveDraftRecipe={saveDraftRecipe}
            setDraftComponent={setDraftComponent}
            setDraftSteps={setDraftSteps}
            setDraftTitle={setDraftTitle}
            setMarkdownInput={setMarkdownInput}
            updateDraftIngredient={updateDraftIngredient}
            exportUserData={exportUserData}
          />
        )}
      </main>

      <Pinboard
        docs={knowledgeItems}
        isOpen={pinboardOpen}
        pins={pins}
        recipes={recipes}
        selectDoc={selectDoc}
        selectRecipe={selectRecipe}
        toggleOpen={togglePinboardOpen}
        togglePin={togglePin}
      />
    </div>
  );
}

function ChatView({
  aiBusy,
  aiStatus,
  chatInput,
  handleSubmit,
  messages,
  quickPrompts,
  refreshAiStatus,
  stopAiService,
  runPrompt,
  setChatInput,
}: {
  aiBusy: boolean;
  aiStatus: AiRuntimeStatus;
  chatInput: string;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  messages: ChatMessage[];
  quickPrompts: string[];
  refreshAiStatus: () => Promise<void>;
  stopAiService: () => Promise<void>;
  runPrompt: (prompt: string) => void | Promise<void>;
  setChatInput: (value: string) => void;
}) {
  const aiReady = isAiReady(aiStatus);
  const runtimeLabel = aiRuntimeLabel(aiStatus);

  return (
    <section className="chat-panel">
      <div className="panel-header">
        <div>
          <h2>智能问答</h2>
          <p>{aiReady ? `本地库先检索候选，${runtimeLabel} 再组织自然回答；每条回答会标注来源。` : '本地烘焙规则可用；桌面版会继续检测本机 Ollama 或内置 Qwen。'}</p>
        </div>
        <div className={`status-pill ${aiReady ? 'ready' : ''}`}>
          <Bot size={16} />
          {aiReady ? `${runtimeLabel} 可用` : '规则已就绪'}
        </div>
      </div>

      <div className="quick-prompts" aria-label="快捷命令">
        {quickPrompts.map((prompt) => (
          <button disabled={aiBusy} key={prompt} onClick={() => void runPrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="ai-status-card">
        <div className="ai-status-head">
          <div>
            <span className="card-kicker">本机智能</span>
            <h3>{aiReady ? `规则候选 + ${runtimeLabel} 回答` : '本地规则模式'}</h3>
          </div>
          <div className="ai-status-actions">
            <button className="secondary-action" onClick={() => void refreshAiStatus()} type="button">
              <RefreshCw size={15} />
              刷新
            </button>
            <button className="secondary-action" onClick={() => void stopAiService()} type="button">
              <X size={15} />
              停止 AI
            </button>
          </div>
        </div>
        <p>{aiStatus.detail}</p>
        <div className="ai-runtime-grid">
          <span>
            运行器
            <strong>{aiStatus.engine}</strong>
          </span>
          <span>
            模型
            <strong>{aiStatus.model}</strong>
          </span>
        </div>
      </div>

      <div className="message-list">
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="bubble">{message.text}</div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder="输入：帮我把 brownie 缩放到 500g 面粉"
        />
        <button aria-label="发送" disabled={aiBusy} type="submit">
          {aiBusy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </section>
  );
}

function DisplayName({ original, primary }: { original: string; primary: string }) {
  const secondary = secondaryLanguageLabel(original, primary);
  return (
    <>
      {primary}
      {secondary && <small className="secondary-language">{secondary}</small>}
    </>
  );
}

function IngredientName({ ingredient }: { ingredient: Ingredient }) {
  return <DisplayName original={ingredient.originalName ?? ingredient.name} primary={displayIngredientName(ingredient.name)} />;
}

function RecipeTitle({ recipe }: { recipe: Recipe }) {
  return <DisplayName original={recipe.originalTitle ?? recipe.title} primary={displayRecipeTitle(recipe.title)} />;
}

function KnowledgeTitle({ doc }: { doc: KnowledgeDoc }) {
  return <DisplayName original={doc.title} primary={displayKnowledgeTitle(doc.title)} />;
}

function RecipeLibraryView({
  baseHint,
  cancelRecipeEdit,
  editingRecipeId,
  formulaResults,
  isPinned,
  recipeEditMarkdown,
  recipeEditNotice,
  recipes,
  recipeResults,
  saveRecipeEdit,
  scaleResult,
  searchQuery,
  selectedFormulaDoc,
  selectedRecipe,
  selectDoc,
  selectRecipe,
  setBaseHint,
  setRecipeEditMarkdown,
  setTargetGrams,
  startRecipeEdit,
  targetGrams,
  togglePin,
  updateDocMetadata,
  updateRecipeMetadata,
}: {
  baseHint: string;
  cancelRecipeEdit: () => void;
  editingRecipeId: string | null;
  formulaResults: KnowledgeDoc[];
  isPinned: (id: string) => boolean;
  recipeEditMarkdown: string;
  recipeEditNotice: string;
  recipes: Recipe[];
  recipeResults: Recipe[];
  saveRecipeEdit: (recipe: Recipe) => void;
  scaleResult: ScaleResult | null;
  searchQuery: string;
  selectedFormulaDoc: KnowledgeDoc | null;
  selectedRecipe: Recipe | null;
  selectDoc: (doc: KnowledgeDoc) => void;
  selectRecipe: (recipe: Recipe) => void;
  setBaseHint: (value: string) => void;
  setRecipeEditMarkdown: (value: string) => void;
  setTargetGrams: (value: number) => void;
  startRecipeEdit: (recipe: Recipe) => void;
  targetGrams: number;
  togglePin: (item: PinItem) => void;
  updateDocMetadata: (doc: KnowledgeDoc, metadata: EditableMetadata) => void;
  updateRecipeMetadata: (recipe: Recipe, metadata: EditableMetadata) => void;
}) {
  const baseFormulaCount = recipeResults.filter((recipe) => recipe.status !== 'referenced' && recipe.sourceDocId).length;
  const availableCount = recipeResults.filter((recipe) => recipe.status !== 'referenced' && !recipe.sourceDocId).length;
  const referencedCount = recipeResults.filter((recipe) => recipe.status === 'referenced').length;
  const formulaCount = formulaResults.length;

  return (
    <section className="library-panel">
      <div className="panel-header">
        <div>
          <h2>配方库</h2>
          <p>
            {searchQuery ? `当前搜索：${searchQuery}` : '管理可计算配方、基础母配方和知识库实例。'}
          </p>
        </div>
        <div className="status-pill">
          <Calculator size={16} />
          {availableCount} 常规 / {baseFormulaCount + formulaCount} 基础 / {referencedCount} 实例
        </div>
      </div>

      <div className="library-layout">
        <div className="result-grid">
          {recipeResults.map((recipe) => (
            <button
              className={!selectedFormulaDoc && recipe.id === selectedRecipe?.id ? 'result-card active' : 'result-card'}
              key={recipe.id}
              onClick={() => selectRecipe(recipe)}
            >
              <span className="card-kicker">{recipeCardLabel(recipe)}</span>
              <strong>
                <RecipeTitle recipe={recipe} />
              </strong>
              <MetadataStrip badges={recipe.badges} featured={recipe.featured} />
              <small>
                {recipe.status === 'referenced'
                  ? recipe.referencePath
                  : `${recipe.components.length} 个组成 · ${countIngredients(recipe)} 个原料`}
              </small>
              <small className="source-line">来源：{recipeSourceLabel(recipe)}</small>
            </button>
          ))}
          {formulaResults.map((doc) => (
            <button
              className={doc.id === selectedFormulaDoc?.id ? 'result-card active' : 'result-card'}
              key={doc.id}
              onClick={() => selectDoc(doc)}
            >
              <span className="card-kicker">{knowledgeCardLabel(doc)}</span>
              <strong>
                <KnowledgeTitle doc={doc} />
              </strong>
              <MetadataStrip badges={doc.badges} featured={doc.featured} />
              <small>{knowledgePreview(doc)}</small>
              <small className="source-line">来源：{knowledgeSourceLabel(doc)}</small>
            </button>
          ))}
        </div>

        <div className="detail-pane">
          {selectedFormulaDoc ? (
            <KnowledgeDetail
              doc={selectedFormulaDoc}
              isPinned={isPinned}
              recipes={recipes}
              selectRecipe={selectRecipe}
              togglePin={togglePin}
              updateDocMetadata={updateDocMetadata}
            />
          ) : selectedRecipe ? (
            <RecipeDetail
              baseHint={baseHint}
              cancelRecipeEdit={cancelRecipeEdit}
              editingRecipeId={editingRecipeId}
              isPinned={isPinned}
              recipe={selectedRecipe}
              recipeEditMarkdown={recipeEditMarkdown}
              recipeEditNotice={recipeEditNotice}
              saveRecipeEdit={saveRecipeEdit}
              scaleResult={scaleResult}
              setBaseHint={setBaseHint}
              setRecipeEditMarkdown={setRecipeEditMarkdown}
              setTargetGrams={setTargetGrams}
              startRecipeEdit={startRecipeEdit}
              targetGrams={targetGrams}
              togglePin={togglePin}
              updateRecipeMetadata={updateRecipeMetadata}
            />
          ) : (
            <p className="empty-state">选择一份配方或基础配方后显示详情。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function MetadataStrip({ badges = [], featured, limit = 4 }: { badges?: string[]; featured?: boolean; limit?: number }) {
  const uniqueBadges = visibleBadgeKeys(badges).slice(0, limit);
  if (!featured && uniqueBadges.length === 0) return null;

  return (
    <div className="badge-row" aria-label="常用与优势标签">
      {featured && (
        <span className="meta-chip featured" title="常用 / 推荐优先查看">
          <Star size={12} />
          常用
        </span>
      )}
      {uniqueBadges.map((badge) => (
        <span className="meta-chip" key={badge} title={badgeTitle(badge)}>
          {badgeIcon(badge)}
          {badgeLabel(badge)}
        </span>
      ))}
    </div>
  );
}

function MetadataEditor({
  badges = [],
  featured,
  onChange,
}: {
  badges?: string[];
  featured?: boolean;
  onChange: (metadata: EditableMetadata) => void;
}) {
  const [customBadge, setCustomBadge] = useState('');
  const selectedBadges = uniqueBadgeKeys(badges);
  const optionKeys = badgeOptions.map(normalizeBadgeKey);
  const customBadges = selectedBadges.filter((badge) => !optionKeys.includes(normalizeBadgeKey(badge)));

  function toggleBadge(badge: string) {
    const normalized = normalizeBadgeKey(badge);
    const exists = selectedBadges.some((item) => normalizeBadgeKey(item) === normalized);
    const nextBadges = exists ? selectedBadges.filter((item) => normalizeBadgeKey(item) !== normalized) : [...selectedBadges, badge];
    onChange({ featured, badges: nextBadges });
  }

  function toggleFeatured() {
    onChange({ featured: !featured, badges: selectedBadges });
  }

  function addCustomBadge() {
    const value = customBadge.trim();
    if (!value) return;
    const exists = selectedBadges.some((badge) => normalizeBadgeKey(badge) === normalizeBadgeKey(value));
    onChange({ featured, badges: exists ? selectedBadges : [...selectedBadges, value] });
    setCustomBadge('');
  }

  return (
    <div className="metadata-editor">
      <button className={featured ? 'tag-option active featured' : 'tag-option'} onClick={toggleFeatured} type="button">
        <Star size={13} />
        常用
      </button>
      <div className="tag-palette">
        {badgeOptions.map((badge) => {
          const active = selectedBadges.some((item) => normalizeBadgeKey(item) === normalizeBadgeKey(badge));
          return (
            <button className={active ? 'tag-option active' : 'tag-option'} key={badge} onClick={() => toggleBadge(badge)} type="button">
              {badgeIcon(badge)}
              {badgeLabel(badge)}
            </button>
          );
        })}
        {customBadges.map((badge) => (
          <button className="tag-option active" key={badge} onClick={() => toggleBadge(badge)} type="button">
            {badgeIcon(badge)}
            {badgeLabel(badge)}
            <X size={12} />
          </button>
        ))}
      </div>
      <div className="custom-tag-row">
        <input
          onChange={(event) => setCustomBadge(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addCustomBadge();
            }
          }}
          placeholder="自定义标签"
          value={customBadge}
        />
        <button aria-label="添加标签" onClick={addCustomBadge} type="button">
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

function RecipeDetail({
  baseHint,
  cancelRecipeEdit,
  editingRecipeId,
  isPinned,
  recipe,
  recipeEditMarkdown,
  recipeEditNotice,
  saveRecipeEdit,
  scaleResult,
  setBaseHint,
  setRecipeEditMarkdown,
  setTargetGrams,
  startRecipeEdit,
  targetGrams,
  togglePin,
  updateRecipeMetadata,
}: {
  baseHint: string;
  cancelRecipeEdit: () => void;
  editingRecipeId: string | null;
  isPinned: (id: string) => boolean;
  recipe: Recipe;
  recipeEditMarkdown: string;
  recipeEditNotice: string;
  saveRecipeEdit: (recipe: Recipe) => void;
  scaleResult: ScaleResult | null;
  setBaseHint: (value: string) => void;
  setRecipeEditMarkdown: (value: string) => void;
  setTargetGrams: (value: number) => void;
  startRecipeEdit: (recipe: Recipe) => void;
  targetGrams: number;
  togglePin: (item: PinItem) => void;
  updateRecipeMetadata: (recipe: Recipe, metadata: EditableMetadata) => void;
}) {
  const pinId = `recipe:${recipe.id}`;
  const isEditing = editingRecipeId === recipe.id;

  return (
    <>
      <div className="detail-heading">
        <div>
          <span className="card-kicker">{recipe.status === 'referenced' ? '知识库实例' : '配方工作区'}</span>
          <h3>
            <RecipeTitle recipe={recipe} />
          </h3>
          <p>来源：{recipeSourceLabel(recipe)}</p>
          <MetadataStrip badges={recipe.badges} featured={recipe.featured} limit={8} />
          <MetadataEditor
            badges={recipe.badges}
            featured={recipe.featured}
            onChange={(metadata) => updateRecipeMetadata(recipe, metadata)}
          />
        </div>
        <div className="detail-actions">
          {recipe.status !== 'referenced' && (
            <button
              className={isEditing ? 'icon-button active' : 'icon-button'}
              onClick={() => (isEditing ? cancelRecipeEdit() : startRecipeEdit(recipe))}
              title={recipe.path.startsWith('/local-recipes/') ? '编辑本地配方' : '复制为本地版本并编辑'}
              type="button"
            >
              {isEditing ? <X size={17} /> : <PencilLine size={17} />}
            </button>
          )}
          <button
            className={isPinned(pinId) ? 'icon-button active' : 'icon-button'}
            onClick={() =>
              togglePin({
                id: pinId,
                type: 'recipe',
                title: displayRecipeTitle(recipe.title),
                subtitle: recipe.status === 'referenced' ? '知识库实例' : `${recipe.components.length} 个组成`,
                recipeId: recipe.id,
              })
            }
            title="固定配方"
            type="button"
          >
            <Pin size={17} />
          </button>
        </div>
      </div>

      {recipe.status === 'referenced' ? (
        <div className="reference-note">
          <strong>知识库已经给出的信息</strong>
          <p>{displayRecipeTitle(recipe.title)}</p>
          {extractRatioFragments(recipe.title).length > 0 && (
            <div className="reference-facts">
              {extractRatioFragments(recipe.title).map((fragment) => (
                <span key={fragment}>{fragment}</span>
              ))}
            </div>
          )}
          <small>{recipe.referencePath}</small>
          <p>
            这不是“没有配方信息”，而是当前包里还没有这条实例对应的完整原料表文件。已有的实例说明可以作为技法参考；只有导入完整 Markdown
            原料表后，才会参与 Baker&apos;s %、缩放和原料级对照。
          </p>
        </div>
      ) : (
        <>
          {isEditing && (
            <section className="recipe-editor-panel">
              <div className="recipe-editor-head">
                <div>
                  <span className="card-kicker">页面编辑</span>
                  <h4>{recipe.path.startsWith('/local-recipes/') ? '编辑本地配方' : '另存本地副本'}</h4>
                </div>
                <div className="import-card-actions">
                  <button className="secondary-action" onClick={cancelRecipeEdit} type="button">
                    <X size={15} />
                    取消
                  </button>
                  <button className="primary-action" onClick={() => saveRecipeEdit(recipe)} type="button">
                    <Save size={15} />
                    保存
                  </button>
                </div>
              </div>
              {recipeEditNotice && <p className="edit-notice">{recipeEditNotice}</p>}
              <textarea
                className="recipe-markdown-editor"
                onChange={(event) => setRecipeEditMarkdown(event.target.value)}
                spellCheck={false}
                value={recipeEditMarkdown}
              />
            </section>
          )}

          <div className="recipe-overview">
            <div>
              <span>组成</span>
              <strong>{recipe.components.length}</strong>
            </div>
            <div>
              <span>原料</span>
              <strong>{countIngredients(recipe)}</strong>
            </div>
            <div>
              <span>原始总量</span>
              <strong>{formatGrams(totalOriginalGrams(recipe))}</strong>
            </div>
            <div>
              <span>缩放总量</span>
              <strong>{formatGrams(totalScaledGrams(scaleResult))}</strong>
            </div>
          </div>

          <div className="kitchen-strip">
            {recipeSignals(recipe).map((signal) => (
              <div key={`${signal.label}-${signal.value}`}>
                <span>{signal.label}</span>
                <strong>{signal.value}</strong>
              </div>
            ))}
          </div>

          <div className="scale-controls">
            <label>
              基准原料
              <input value={baseHint} onChange={(event) => setBaseHint(event.target.value)} />
            </label>
            <label>
              目标重量
              <input min={1} type="number" value={targetGrams} onChange={(event) => setTargetGrams(Number(event.target.value))} />
            </label>
          </div>

          <div className="base-summary">
            <Scale size={16} />
            {scaleResult?.base
              ? `${displayIngredientName(scaleResult.base.name)} ${scaleResult.base.grams}g = 100%，倍率 ×${scaleResult.factor.toFixed(2)}`
              : '未识别基准原料'}
          </div>

          <div className="structure-panel">
            <div>
              <h4>原料结构</h4>
              <div className="role-grid">
                {ingredientRoleTotals(recipe).map((role) => (
                  <div key={role.role}>
                    <span>{role.role}</span>
                    <strong>{formatGrams(role.grams)}</strong>
                    <small>{role.percent.toFixed(1)}%</small>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4>观察提示</h4>
              <ul className="risk-list">
                {recipeRiskNotes(recipe, scaleResult).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>组成</th>
                  <th>原料</th>
                  <th>原始</th>
                  <th>Baker%</th>
                  <th>缩放</th>
                  <th aria-label="固定原料" />
                </tr>
              </thead>
              <tbody>
                {scaleResult?.rows.map((row) => (
                  <tr key={`${row.component}-${row.ingredient.name}-${row.ingredient.quantityText}`}>
                    <td>
                      <DisplayName original={row.componentOriginalName ?? row.component} primary={displayComponentName(row.component)} />
                    </td>
                    <td>
                      <IngredientName ingredient={row.ingredient} />
                    </td>
                    <td>{row.ingredient.grams ? `${row.ingredient.grams}g` : row.ingredient.quantityText || 'QS'}</td>
                    <td>{row.percent === null ? '-' : `${row.percent.toFixed(1)}%`}</td>
                    <td>{row.scaled === null ? '-' : `${row.scaled.toFixed(1)}g`}</td>
                    <td>
                      <button
                        className="mini-icon-button"
                        onClick={() => togglePin(ingredientPin(recipe, row.ingredient, row.percent))}
                        title="固定原料"
                      >
                        <Pin size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="component-cards">
            {recipe.components.map((component) => (
              <section key={component.name}>
                <h4>
                  <DisplayName original={component.originalName ?? component.name} primary={displayComponentName(component.name)} />
                </h4>
                <div>
                  {component.ingredients.map((ingredient) => (
                    <span key={`${component.name}-${ingredient.name}`}>
                      <IngredientName ingredient={ingredient} /> · {ingredient.grams ? formatGrams(ingredient.grams) : ingredient.quantityText || 'QS'}
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="recipe-notes">
            <h4>制作流程</h4>
            {workflowSteps(recipe).length ? (
              <div className="workflow-steps">
                {workflowSteps(recipe).map((step, index) => (
                  <div key={`${step}-${index}`}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </div>
                ))}
              </div>
            ) : recipeInstructions(recipe).length ? (
              <ol>
                {recipeInstructions(recipe).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p>这份配方暂时只有结构化原料表，没有步骤文本。</p>
            )}
          </div>

          <div className="calculation-note">
            <strong>计算说明</strong>
            <p>
              Baker&apos;s % 以识别到的基准原料作为 100%。当前基准是 {scaleResult?.base ? displayIngredientName(scaleResult.base.name) : baseHint}
              ；如果是甘那许、奶油馅或巧克力制品，可以把基准改成巧克力、奶油或其他主原料再对比。
            </p>
          </div>
        </>
      )}
    </>
  );
}

function TechniqueLibraryView({
  docs,
  isPinned,
  recipes,
  selectedDoc,
  selectDoc,
  selectRecipe,
  togglePin,
  updateDocMetadata,
}: {
  docs: KnowledgeDoc[];
  isPinned: (id: string) => boolean;
  recipes: Recipe[];
  selectedDoc: KnowledgeDoc | null;
  selectDoc: (doc: KnowledgeDoc) => void;
  selectRecipe: (recipe: Recipe) => void;
  togglePin: (item: PinItem) => void;
  updateDocMetadata: (doc: KnowledgeDoc, metadata: EditableMetadata) => void;
}) {
  return (
    <section className="library-panel">
      <div className="panel-header">
        <div>
          <h2>技法库</h2>
          <p>技法先作为知识卡片浏览；搜索或点开后再展示完整逻辑。</p>
        </div>
        <div className="status-pill">
          <BookOpen size={16} />
          {docs.filter((doc) => knowledgeStatus(doc) === 'active').length} 技法 /{' '}
          {docs.filter((doc) => knowledgeStatus(doc) === 'archive').length} 归档
        </div>
      </div>

      <div className="library-layout">
        <div className="result-grid">
          {docs.map((doc) => (
            <button className={doc.id === selectedDoc?.id ? 'result-card active' : 'result-card'} key={doc.id} onClick={() => selectDoc(doc)}>
              <span className="card-kicker">{knowledgeCardLabel(doc)}</span>
              <strong>
                <KnowledgeTitle doc={doc} />
              </strong>
              <MetadataStrip badges={doc.badges} featured={doc.featured} />
              <small>{knowledgePreview(doc)}</small>
              <small className="source-line">来源：{knowledgeSourceLabel(doc)}</small>
            </button>
          ))}
        </div>

        <div className="detail-pane">
          {selectedDoc ? (
            <KnowledgeDetail
              doc={selectedDoc}
              isPinned={isPinned}
              recipes={recipes}
              selectRecipe={selectRecipe}
              togglePin={togglePin}
              updateDocMetadata={updateDocMetadata}
            />
          ) : (
            <p className="empty-state">选择一张技法卡片后显示内容。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function KnowledgeDetail({
  doc,
  isPinned,
  recipes,
  selectRecipe,
  togglePin,
  updateDocMetadata,
}: {
  doc: KnowledgeDoc;
  isPinned: (id: string) => boolean;
  recipes: Recipe[];
  selectRecipe: (recipe: Recipe) => void;
  togglePin: (item: PinItem) => void;
  updateDocMetadata: (doc: KnowledgeDoc, metadata: EditableMetadata) => void;
}) {
  const pinId = `technique:${doc.id}`;
  const blocks = knowledgeBlocks(doc.raw);
  const examples = extractKnowledgeExamples(doc.raw);
  const categoryLabel = knowledgeCardLabel(doc);
  const pinSubtitle = isFormulaDoc(doc)
    ? examples.length
      ? `${examples.length} 个配方实例`
      : '母配方/标准比例'
    : knowledgeStatus(doc) === 'archive'
      ? '资料归档'
    : examples.length
      ? `${examples.length} 个库内实例`
      : '技法卡片';

  return (
    <>
      <div className="detail-heading">
        <div>
          <span className="card-kicker">{categoryLabel}</span>
          <h3>
            <KnowledgeTitle doc={doc} />
          </h3>
          <p>来源：{knowledgeSourceLabel(doc)}</p>
          <MetadataStrip badges={doc.badges} featured={doc.featured} limit={8} />
          <MetadataEditor badges={doc.badges} featured={doc.featured} onChange={(metadata) => updateDocMetadata(doc, metadata)} />
        </div>
        <button
          className={isPinned(pinId) ? 'icon-button active' : 'icon-button'}
          onClick={() =>
            togglePin({
              id: pinId,
              type: 'technique',
              title: displayKnowledgeTitle(doc.title),
              subtitle: pinSubtitle,
              docId: doc.id,
            })
          }
          title={isFormulaDoc(doc) ? '固定基础配方' : '固定技法'}
        >
          <Pin size={17} />
        </button>
      </div>

      <div className="knowledge-content">
        {blocks.map((block, index) => {
          if (block.kind === 'heading') return <h4 key={index}>{block.text}</h4>;
          if (block.kind === 'paragraph') return <p key={index}>{block.text}</p>;
          if (block.kind === 'list') {
            return (
              <ul key={index}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          }
          if (block.kind === 'table') return <MarkdownTable key={index} rows={block.rows} />;
          return null;
        })}
      </div>

      {examples.length > 0 && (
        <div className="example-section">
          <h4>{isFormulaDoc(doc) ? '配方实例' : '库内实例'}</h4>
          <div className="example-grid">
            {examples.map((example) => {
              const recipe = findRecipeReference(recipes, example.path, example.note);
              return (
                <button className="example-card" key={`${example.path}-${example.note}`} onClick={() => recipe && selectRecipe(recipe)}>
                  <span>{recipe?.status === 'referenced' ? '知识库实例' : '可计算'}</span>
                  <strong>{example.note || prettifyPath(example.path)}</strong>
                  {extractRatioFragments(example.note).length > 0 && (
                    <div className="example-facts">
                      {extractRatioFragments(example.note).map((fragment) => (
                        <em key={fragment}>{fragment}</em>
                      ))}
                    </div>
                  )}
                  <small>{example.path}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function RecipeImportView({
  addDraftIngredient,
  aiStatus,
  draftComponent,
  draftIngredients,
  draftSteps,
  draftTitle,
  exportUserData,
  importMarkdownRecipe,
  importAssistBusy,
  importNotice,
  importUserData,
  markdownInput,
  organizeMarkdownRecipe,
  removeDraftIngredient,
  saveDraftRecipe,
  setDraftComponent,
  setDraftSteps,
  setDraftTitle,
  setMarkdownInput,
  updateDraftIngredient,
}: {
  addDraftIngredient: () => void;
  aiStatus: AiRuntimeStatus;
  draftComponent: string;
  draftIngredients: DraftIngredient[];
  draftSteps: string;
  draftTitle: string;
  exportUserData: () => void;
  importMarkdownRecipe: () => void;
  importAssistBusy: boolean;
  importNotice: string;
  importUserData: (file: File) => void;
  markdownInput: string;
  organizeMarkdownRecipe: () => void;
  removeDraftIngredient: (id: string) => void;
  saveDraftRecipe: () => void;
  setDraftComponent: (value: string) => void;
  setDraftSteps: (value: string) => void;
  setDraftTitle: (value: string) => void;
  setMarkdownInput: (value: string) => void;
  updateDraftIngredient: (id: string, patch: Partial<DraftIngredient>) => void;
}) {
  return (
    <section className="import-panel">
      <div className="panel-header">
        <div>
          <h2>配方录入</h2>
          <p>先保存到浏览器本地；桌面版会改为保存到本地配方文件夹。</p>
        </div>
        <div className="status-pill">
          <FilePlus2 size={16} />
          本地保存
        </div>
      </div>

      {importNotice && <div className="import-notice">{importNotice}</div>}

      <section className="migration-panel">
        <div>
          <span className="card-kicker">数据迁移</span>
          <h3>换电脑或补配方时带走本地资料</h3>
          <p>导出会包含本地录入配方、星标/优势标签和固定项；配方包也可以只包含新增配方，导入后直接进库，不需要重新安装 AI 模型。</p>
        </div>
        <div className="backup-actions">
          <button className="primary-action" onClick={exportUserData} type="button">
            <Download size={16} />
            导出本地数据包
          </button>
          <label className="file-action">
            <Upload size={16} />
            导入数据/配方包
            <input
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importUserData(file);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        </div>
      </section>

      <div className="import-layout">
        <section className="import-card">
          <div className="import-card-header">
            <div>
              <span className="card-kicker">表单录入</span>
              <h3>新建可计算配方</h3>
            </div>
            <button className="primary-action" onClick={saveDraftRecipe}>
              <Save size={16} />
              保存配方
            </button>
          </div>

          <div className="form-grid">
            <label>
              配方名
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：Brownie Noisette" />
            </label>
            <label>
              组成名称
              <input value={draftComponent} onChange={(event) => setDraftComponent(event.target.value)} placeholder="例如：Appareil à Brownie 布朗尼面糊" />
            </label>
          </div>

          <div className="ingredient-editor">
            <div className="ingredient-editor-head">
              <span>原料</span>
              <button onClick={addDraftIngredient}>
                <Plus size={15} />
                添加原料
              </button>
            </div>
            {draftIngredients.map((ingredient) => (
              <div className="ingredient-row" key={ingredient.id}>
                <input
                  value={ingredient.name}
                  onChange={(event) => updateDraftIngredient(ingredient.id, { name: event.target.value })}
                  placeholder="原料名：farine T45 / 黄油 / chocolat noir"
                />
                <input
                  min={0}
                  type="number"
                  value={ingredient.grams}
                  onChange={(event) => updateDraftIngredient(ingredient.id, { grams: event.target.value })}
                  placeholder="g"
                />
                <button onClick={() => removeDraftIngredient(ingredient.id)} title="删除原料">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <label className="textarea-label">
            步骤/备注
            <textarea
              value={draftSteps}
              onChange={(event) => setDraftSteps(event.target.value)}
              placeholder="例如：混合巧克力和黄油，加入糖和鸡蛋，拌入粉类，170°C 烘烤 20min。"
            />
          </label>
        </section>

        <section className="import-card">
          <div className="import-card-header">
            <div>
              <span className="card-kicker">Markdown 导入</span>
              <h3>粘贴已有配方</h3>
            </div>
            <div className="import-card-actions">
              <button className="secondary-action" disabled={importAssistBusy} onClick={organizeMarkdownRecipe} type="button">
                {importAssistBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                整理草稿
              </button>
              <button className="primary-action" onClick={importMarkdownRecipe}>
                <Save size={16} />
                导入
              </button>
            </div>
          </div>
          <p className="assist-hint">
            {isAiReady(aiStatus)
              ? `桌面版会先用${aiRuntimeLabel(aiStatus)}抽取标题、原料和步骤；若失败则回退本地规则。`
              : '浏览器预览使用本地规则整理；桌面版可调用 Ollama 或内置 Qwen 辅助抽取。'}
          </p>
          <textarea
            className="markdown-import"
            value={markdownInput}
            onChange={(event) => setMarkdownInput(event.target.value)}
            placeholder={`---\ntitre: BRIOCHE TEST\nsource_file: local\n---\n\n# BRIOCHE TEST\n\n## Pâte\n\n| Ingrédients | 食材 |\n|---|---|\n| 250 g de farine T45 | 250 克面粉 |\n| 150 g de beurre | 150 克黄油 |\n\nPétrir puis cuire à 180°C / 20min.`}
          />
        </section>
      </div>

      <section className="rules-panel">
        <div>
          <span className="card-kicker">录入规则</span>
          <h3>让配方能被稳定搜索、计算和缩放</h3>
        </div>
        <div className="rules-grid">
          <div>
            <strong>名称</strong>
            <p>标题尽量用“法文/英文 + 中文”的形式，例如 `BRIOCHE CLASSIQUE 经典布里欧修`。</p>
          </div>
          <div>
            <strong>原料</strong>
            <p>每一行必须有数字重量，优先用 `g`。液体可以用 `ml`，系统会按 1ml≈1g 临时处理。</p>
          </div>
          <div>
            <strong>组成</strong>
            <p>多组件配方用多个 `##` 分段，例如 biscuit、mousse、ganache、glaçage。</p>
          </div>
          <div>
            <strong>基准</strong>
            <p>面团默认找 `farine`，甘那许建议用 `chocolat`，奶油馅可手动改成主原料。</p>
          </div>
          <div>
            <strong>步骤</strong>
            <p>步骤里写清温度、时间、发酵、冷藏、凝固等关键信息，方便后续生成厨房流程。</p>
          </div>
          <div>
            <strong>版权</strong>
            <p>只录入自己有权使用的配方；课程/书籍配方建议仅用于个人本地学习。</p>
          </div>
        </div>
      </section>
    </section>
  );
}

function Pinboard({
  docs,
  isOpen,
  pins,
  recipes,
  selectDoc,
  selectRecipe,
  toggleOpen,
  togglePin,
}: {
  docs: KnowledgeDoc[];
  isOpen: boolean;
  pins: PinItem[];
  recipes: Recipe[];
  selectDoc: (doc: KnowledgeDoc) => void;
  selectRecipe: (recipe: Recipe) => void;
  toggleOpen: () => void;
  togglePin: (item: PinItem) => void;
}) {
  if (!isOpen) {
    return (
      <aside className="pinboard collapsed" aria-label="固定板已隐藏">
        <button className="pinboard-rail-button" onClick={toggleOpen} title="展开固定板" type="button">
          <Pin size={17} />
          <span>{pins.length}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="pinboard">
      <div className="pinboard-header">
        <div>
          <h2>固定板</h2>
          <p>把配方、技法、原料钉在这里对照。</p>
        </div>
        <button className="mini-icon-button" onClick={toggleOpen} title="隐藏固定板" type="button">
          <PinOff size={15} />
        </button>
      </div>

      {pins.length === 0 ? (
        <p className="empty-state">还没有固定内容。点配方、技法或原料旁的图钉即可保留。</p>
      ) : (
        <div className="pin-list">
          {pins.map((pin) => (
            <div className={`pin-card ${pin.type}`} key={pin.id}>
              <button
                className="pin-main"
                onClick={() => {
                  if (pin.type === 'recipe') {
                    const recipe = recipes.find((item) => item.id === pin.recipeId);
                    if (recipe) selectRecipe(recipe);
                  }
                  if (pin.type === 'technique') {
                    const doc = docs.find((item) => item.id === pin.docId);
                    if (doc) selectDoc(doc);
                  }
                }}
              >
                <span>{pinLabel(pin, docs)}</span>
                <strong>{pin.title}</strong>
                <small>{pin.subtitle}</small>
                {pin.type === 'ingredient' && <small>{pin.note}</small>}
              </button>
              <button className="mini-icon-button" onClick={() => togglePin(pin)} title="取消固定">
                <PinOff size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function MarkdownTable({ rows }: { rows: string[][] }) {
  if (rows.length < 2) return null;
  return (
    <div className="knowledge-table">
      <table>
        <thead>
          <tr>
            {rows[0].map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, index) => (
            <tr key={index}>
              {row.map((cell) => (
                <td key={cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function firstNumber(...values: Array<number | null | undefined>): number | null {
  const value = values.find((item) => typeof item === 'number' && Number.isFinite(item) && item > 0);
  return value ?? null;
}

function extractGramsFromPrompt(prompt: string): number | null {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:g|克|gram|grams)/i);
  return match ? Number(match[1]) : null;
}

function looksLikeScalePrompt(prompt: string): boolean {
  return /缩放|放大|重算|计算|算一下|比例|baker|\d+(?:\.\d+)?\s*(?:g|克|gram|grams)/i.test(prompt);
}

function looksLikePreferencePrompt(prompt: string): boolean {
  return /不油腻|不腻|清爽|轻盈|少油|低油|低糖|少糖|减糖|控糖|降糖|淡一点|负担|入口轻|甜度|不太甜|不要太甜|口感|黄油为主|主要材料|主料|不要|不需要|不用|无奶油|适合|夏天|夹心|内馅|推荐|早餐|早饭|升糖|血糖|低\s*gi|低GI/i.test(prompt);
}

function looksLikeExplicitLookupPrompt(prompt: string): boolean {
  return /查|查询|搜索|寻找|找|打开|缩放|放大|重算|计算|算一下|用到了|含有|包含|哪些配方|比例|\d+(?:\.\d+)?\s*(?:g|克|gram|grams)/i.test(prompt);
}

function looksLikeLocalRulePrompt(prompt: string): boolean {
  return /替代|代替|换成|换掉|能不能用|可以用|没有.*怎么办|模具|烤盘|寸|吋|圆模|方盘|温度|时间|烤多久|多少度|预热|热风|风炉|平炉|上色|高海拔|为什么|塌陷|回缩|开裂|夹生|没熟|外焦内生|太硬|太干|太黏|发不起来|消泡|失败/i.test(prompt);
}

function shouldUseGroundedAiVoice(prompt: string, action: ChatAction): boolean {
  if (/缩放|放大|重算|Baker'?s|百分比|\d+(?:\.\d+)?\s*(?:g|克|gram|grams)/i.test(prompt)) return false;
  if (action.response.startsWith('已识别为配方查询') || action.response.startsWith('已识别为原料检索')) return false;
  if (action.response.startsWith('我可以处理：')) return true;
  return /推荐|需要|想要|适合|给我|早餐|早饭|午餐|晚餐|饭后|餐后|升糖|血糖|低\s*gi|低GI|低糖|少糖|减糖|控糖|降糖|不油腻|不腻|清爽|轻盈|少油|低油|黄油.*少|甜点|口感|为什么|怎么办/i.test(prompt);
}

const ingredientNameMap: Array<[RegExp, string]> = [
  [/farine\s*t45/i, 'T45 面粉'],
  [/farine\s*t55/i, 'T55 面粉'],
  [/farine|flour/i, '面粉'],
  [/sucre\s*glace|powdered sugar|icing sugar/i, '糖粉'],
  [/sucre|sugar/i, '糖'],
  [/sel|salt/i, '盐'],
  [/levure|yeast/i, '酵母'],
  [/beurre|butter/i, '黄油'],
  [/oeufs|œufs|egg\b|eggs/i, '鸡蛋'],
  [/jaunes|egg yolks?|yolks?/i, '蛋黄'],
  [/blancs?\s*d['’]?œufs?|blancs?\s*d['’]?oeufs?|egg whites?/i, '蛋清'],
  [/chocolat\s*au\s*lait|milk chocolate/i, '牛奶巧克力'],
  [/chocolat\s*noir|dark chocolate/i, '黑巧克力'],
  [/chocolat|chocolate/i, '巧克力'],
  [/cacao|cocoa/i, '可可粉'],
  [/cr[eè]me|cream|heavy cream/i, '淡奶油'],
  [/lait|milk/i, '牛奶'],
  [/poudre\s*d['’]?amandes?|almond powder|almond flour/i, '杏仁粉'],
  [/amandes?|almonds?/i, '杏仁'],
  [/noix|walnut/i, '核桃'],
  [/pralin[ée]|praline/i, '帕林内'],
  [/feuilletine/i, '薄脆片'],
  [/lemon juice|jus\s*de\s*citron/i, '柠檬汁'],
  [/lemon zest|zeste\s*de\s*citron/i, '柠檬皮屑'],
  [/vanilla|vanille/i, '香草'],
  [/cream of tartar/i, '塔塔粉'],
  [/water|eau/i, '水'],
  [/glucose/i, '葡萄糖浆'],
  [/miel|honey/i, '蜂蜜'],
  [/g[eé]latine|gelatin/i, '吉利丁'],
];

const componentNameMap: Array<[RegExp, string]> = [
  [/p[aâ]te\s*[àa]\s*brioche|brioche/i, '布里欧修面团'],
  [/appareil\s*[àa]\s*brownie|brownie/i, '布朗尼面糊'],
  [/cr[eè]me\s*p[aâ]tissi[eè]re|patissiere/i, '卡仕达酱'],
  [/cr[eè]me\s*mousseline|mousseline/i, '慕斯林奶油'],
  [/p[aâ]te\s*[àa]\s*choux|choux/i, '泡芙面糊'],
  [/p[aâ]te\s*sucr[eé]e|sucree/i, '甜酥皮'],
  [/ganache\s*mont[eé]e/i, '打发甘那许'],
  [/ganache/i, '甘那许'],
  [/biscuit\s*joconde|joconde/i, '杏仁蛋糕体'],
  [/dacquoise/i, '达克瓦兹'],
  [/meringue/i, '蛋白霜'],
  [/croustillant/i, '帕林内脆底'],
  [/pralin[ée]|praline/i, '帕林内'],
  [/caramel/i, '焦糖'],
  [/curd/i, '凝乳'],
  [/whipped cream/i, '打发奶油'],
];

const recipeTitleMap: Array<[RegExp, string]> = [
  [/brioche/i, '经典布里欧修'],
  [/brownie/i, '经典布朗尼'],
  [/cr[eè]me\s*p[aâ]tissi[eè]re|patissiere/i, '标准卡仕达酱'],
  [/cr[eè]me\s*mousseline|mousseline/i, '经典慕斯林奶油'],
  [/p[aâ]te\s*[àa]\s*choux|choux/i, '标准泡芙面糊'],
  [/p[aâ]te\s*sucr[eé]e|sucree/i, '标准甜酥皮'],
  [/ganache\s*mont[eé]e/i, '打发黑巧甘那许'],
  [/ganache/i, '甘那许'],
  [/biscuit\s*joconde|joconde/i, '标准杏仁蛋糕体'],
  [/dacquoise/i, '标准达克瓦兹'],
  [/meringue/i, '蛋白霜'],
  [/croustillant/i, '帕林内脆底'],
  [/pralin[ée]|praline/i, '帕林内'],
  [/caramel/i, '焦糖'],
  [/curd/i, '柠檬凝乳'],
  [/whipped cream/i, '基础打发奶油'],
];

function displayIngredientName(name: string): string {
  return mapDisplayName(name, ingredientNameMap);
}

function displayComponentName(name: string): string {
  return mapDisplayName(name, componentNameMap);
}

function displayRecipeTitle(title: string): string {
  return mapDisplayName(title, recipeTitleMap);
}

function displayKnowledgeTitle(title: string): string {
  return mapDisplayName(title, []);
}

function mapDisplayName(name: string, map: Array<[RegExp, string]>): string {
  const clean = name.trim();
  const explicitChinese = clean.match(/[\u4e00-\u9fff][\u4e00-\u9fff\d\s%％：:（）()·/+\-.]*/)?.[0]?.trim();
  if (explicitChinese) return explicitChinese;
  return map.find(([pattern]) => pattern.test(clean))?.[1] ?? clean;
}

function secondaryLanguageLabel(original: string, primary: string): string {
  const clean = original.trim();
  if (!clean || normalizeLoose(clean) === normalizeLoose(primary)) return '';
  const withoutChinese = clean.replace(/[\u4e00-\u9fff][\u4e00-\u9fff\d\s%％：:（）()·/+\-.]*/g, '').trim();
  const secondary = (withoutChinese || clean).replace(/\s{2,}/g, ' ').replace(/[-·/：:]\s*$/, '').trim();
  return normalizeLoose(secondary) === normalizeLoose(primary) ? '' : secondary;
}

const instructionTranslations: Array<[RegExp, string]> = [
  [/fondre\s+le\s+chocolat\s+et\s+le\s+beurre\s+ensemble/gi, '将巧克力和黄油一起融化'],
  [/fondre\s+le\s+chocolat/gi, '融化巧克力'],
  [/m[ée]langer\s+avec\s+le\s+pralin[ée]/gi, '与帕林内混合'],
  [/incorporer\s+la\s+feuilletine/gi, '拌入薄脆片'],
  [/puis\s+[ée]taler\s+finement\s+avant\s+prise/gi, '在凝固前薄薄摊开'],
  [/ajouter\s+le\s+sucre/gi, '加入糖'],
  [/les\s+œufs|les\s+oeufs/gi, '鸡蛋'],
  [/puis\s+les\s+poudres\s+tamis[ée]es/gi, '再加入过筛粉类'],
  [/incorporer\s+les\s+noix/gi, '拌入核桃'],
  [/cuire\s+[àa]\s*(\d+)\s*°?c/gi, '以 $1°C 烘烤'],
  [/heat\s+cream/gi, '加热奶油'],
  [/pour\s+over\s+chocolate/gi, '倒入巧克力'],
  [/rest\s+briefly/gi, '短暂静置'],
  [/then\s+stir\s+from\s+the\s+center\s+until\s+glossy\s+and\s+emulsified/gi, '再从中心搅拌至乳化发亮'],
  [/whip\s+egg\s+whites/gi, '打发蛋清'],
  [/add\s+sugar\s+gradually/gi, '分次加入糖'],
  [/fold\s+in/gi, '拌入'],
  [/boil\s+water/gi, '煮沸水'],
  [/add\s+flour/gi, '加入面粉'],
  [/beat\s+in\s+eggs\s+gradually/gi, '分次加入鸡蛋拌匀'],
];

function containsChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function displayInstructionText(value: string): string {
  const clean = value.trim();
  if (!clean || containsChinese(clean)) return clean;

  let translated = clean;
  let changed = false;
  for (const [pattern, replacement] of instructionTranslations) {
    pattern.lastIndex = 0;
    if (pattern.test(translated)) {
      pattern.lastIndex = 0;
      translated = translated.replace(pattern, replacement);
      changed = true;
    }
  }

  if (!changed) return clean;

  return translated
    .replace(/\s*,\s*/g, '，')
    .replace(/\s*\.\s*/g, '。')
    .replace(/\s+and\s+/gi, '，')
    .replace(/\s+then\s+/gi, '，')
    .replace(/\s+puis\s+/gi, '，')
    .replace(/，+/g, '，')
    .replace(/。+/g, '。')
    .replace(/[，。]\s*$/, '。')
    .trim();
}

function uniqueInstructionLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = normalizeLoose(line).replace(/[，。；;,.]\s*/g, '').replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatAiFallbackReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message && message !== 'undefined' ? `\n错误：${message.slice(0, 260)}` : '';
  if (/503|Service Unavailable|未就绪|启动超时/i.test(message)) {
    return `提示：本地模型可能还在加载，稍等几秒再问一次通常会切回 AI 回答。${detail}`;
  }
  if (/400|Bad Request|500|Internal Server Error/i.test(message)) {
    return `提示：这次没有拿到本地 AI 的有效解析，已改用 Baker Desk 本地烘焙规则处理。${detail}`;
  }
  return `提示：这次本地 AI 没有及时返回有效解析，已改用 Baker Desk 本地烘焙规则处理。${detail}`;
}

function loadStoredRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem('baker-desk-local-recipes');
    if (!raw) return [];
    const entries = JSON.parse(raw) as unknown;
    if (!Array.isArray(entries)) return [];
    return entries.filter(isBackupEntry).map((entry) => parseRecipeMarkdown(entry.id, entry.path, entry.raw));
  } catch {
    return [];
  }
}

async function loadDesktopPackRecipes(): Promise<Recipe[]> {
  try {
    const packs = await readDesktopRecipePacks();
    return packs.flatMap((pack) => parseRecipePackRaw(pack.raw));
  } catch {
    return [];
  }
}

function parseRecipePackRaw(raw: string): Recipe[] {
  try {
    const parsed = JSON.parse(raw) as Partial<UserDataBackup>;
    if (parsed.app !== 'Baker Desk' || parsed.version !== 1 || !Array.isArray(parsed.localRecipes)) return [];
    return parsed.localRecipes.filter(isBackupEntry).map((entry) => parseRecipeMarkdown(entry.id, entry.path, entry.raw));
  } catch {
    return [];
  }
}

function persistStoredRecipes(recipes: Recipe[]) {
  localStorage.setItem('baker-desk-local-recipes', JSON.stringify(serializeLocalRecipes(recipes)));
}

function serializeLocalRecipes(recipes: Recipe[]): BackupEntry[] {
  return recipes
    .filter((recipe) => recipe.path.startsWith('/local-recipes/'))
    .map((recipe) => ({ id: recipe.id, path: recipe.path, raw: recipe.raw }));
}

function isBackupEntry(item: unknown): item is BackupEntry {
  if (!item || typeof item !== 'object') return false;
  const entry = item as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.path === 'string' && typeof entry.raw === 'string';
}

function loadStoredPins(): PinItem[] {
  try {
    const raw = localStorage.getItem('baker-desk-pins');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isValidPinItem).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function persistStoredPins(pins: PinItem[]) {
  localStorage.setItem('baker-desk-pins', JSON.stringify(pins.filter(isValidPinItem).slice(0, 8)));
}

function loadPinboardOpenPreference(): boolean {
  try {
    const saved = localStorage.getItem('baker-desk-pinboard-open');
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // Ignore unavailable storage and fall back to viewport width.
  }
  return typeof window === 'undefined' ? true : window.innerWidth >= 1440;
}

function persistPinboardOpenPreference(open: boolean) {
  localStorage.setItem('baker-desk-pinboard-open', String(open));
}

function mergePins(current: PinItem[], imported: unknown[]): PinItem[] {
  const byId = new Map<string, PinItem>();
  [...imported, ...current].filter(isValidPinItem).forEach((pin) => byId.set(pin.id, pin));
  return [...byId.values()].slice(0, 8);
}

function isValidPinItem(item: unknown): item is PinItem {
  if (!item || typeof item !== 'object') return false;
  const pin = item as Record<string, unknown>;
  if (typeof pin.id !== 'string' || typeof pin.title !== 'string' || typeof pin.subtitle !== 'string') return false;
  if (pin.type === 'recipe') return typeof pin.recipeId === 'string';
  if (pin.type === 'technique') return typeof pin.docId === 'string';
  if (pin.type === 'ingredient') return typeof pin.note === 'string';
  return false;
}

function loadMetadataOverrides(): MetadataOverrideMap {
  try {
    const raw = localStorage.getItem('baker-desk-metadata-overrides');
    if (!raw) return {};
    return normalizeMetadataOverrides(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function normalizeMetadataOverrides(value: unknown): MetadataOverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, metadata]) => metadata && typeof metadata === 'object' && !Array.isArray(metadata))
      .map(([key, metadata]) => {
        const entry = metadata as Record<string, unknown>;
        const badges = Array.isArray(entry.badges) ? entry.badges.filter((badge): badge is string => typeof badge === 'string') : [];
        return [
          key,
          {
            featured: Boolean(entry.featured),
            badges: uniqueBadgeKeys(badges),
          },
        ];
      }),
  );
}

function persistMetadataOverrides(overrides: MetadataOverrideMap) {
  localStorage.setItem('baker-desk-metadata-overrides', JSON.stringify(overrides));
}

function applyRecipeMetadataOverride(recipe: Recipe, overrides: MetadataOverrideMap): Recipe {
  const override = overrides[metadataKey('recipe', recipe.id)];
  if (!override) return recipe;
  return {
    ...recipe,
    featured: override.featured ?? recipe.featured,
    badges: override.badges ?? recipe.badges,
  };
}

function applyKnowledgeMetadataOverride(doc: KnowledgeDoc, overrides: MetadataOverrideMap): KnowledgeDoc {
  const override = overrides[metadataKey('knowledge', doc.id)];
  if (!override) return doc;
  return {
    ...doc,
    featured: override.featured ?? doc.featured,
    badges: override.badges ?? doc.badges,
  };
}

function metadataKey(kind: 'recipe' | 'knowledge', id: string): string {
  return `${kind}:${id}`;
}

function buildRecipeMarkdown(title: string, component: string, ingredients: DraftIngredient[], steps: string): string {
  const safeTitle = title.trim() || 'LOCAL RECIPE';
  const safeComponent = component.trim() || 'Appareil principal 主体';
  const ingredientRows = ingredients
    .map((ingredient) => {
      const grams = Number(ingredient.grams);
      const displayName = ingredient.name.trim();
      const frenchName = toFrenchIngredientName(displayName);
      return `| ${grams} g de ${frenchName} | ${grams} 克 ${displayName} |`;
    })
    .join('\n');

  return `---\ntitre: ${safeTitle}\nniveau: local\nsource: baker-desk-local\nsource_file: local-entry\n---\n\n# ${safeTitle}\n\n## ${safeComponent}\n\n| Ingrédients | 食材 |\n|-------------|------|\n${ingredientRows}\n\n${steps.trim() || 'Mélanger les ingrédients dans l’ordre de la recette, puis cuire selon le résultat souhaité.'}\n`;
}

function chooseAssistedRecipeMarkdown(raw: string, aiDraft: string | null): string {
  if (aiDraft && !validateRecipeMarkdown(aiDraft).length && looksLikeRecipeMarkdown(aiDraft)) return aiDraft.trim();
  return buildRecipeMarkdownFromLooseText(raw);
}

function looksLikeRecipeMarkdown(raw: string): boolean {
  return /^#{1,3}\s+.+/m.test(raw) && /\|\s*Ingrédients\s*\|\s*食材\s*\|/i.test(raw) && /\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|cl|dl|l|克|毫升)/i.test(raw);
}

function buildRecipeMarkdownFromLooseText(raw: string): string {
  if (looksLikeRecipeMarkdown(raw) && !validateRecipeMarkdown(raw).length) return raw.trim();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = extractLooseRecipeTitle(lines);
  const ingredients: DraftIngredient[] = [];
  const usedLines = new Set<number>();

  lines.forEach((line, index) => {
    const parsed = parseLooseIngredientLine(line);
    if (!parsed) return;
    usedLines.add(index);
    ingredients.push({ id: crypto.randomUUID(), name: parsed.name, grams: parsed.grams });
  });

  const steps = lines
    .filter((line, index) => index !== 0 && !usedLines.has(index) && !/^[-—|#:]+$/.test(line))
    .join('\n')
    .trim();
  const safeIngredients = ingredients.length ? ingredients : [{ id: crypto.randomUUID(), name: '原料待补', grams: '0' }];
  const markdown = buildRecipeMarkdown(title, inferLooseComponentName(title), safeIngredients, steps || '步骤待补；缺重量或工艺时请人工复核后再导入。');
  return safeIngredients.some((ingredient) => Number(ingredient.grams) <= 0)
    ? `${markdown}\n<!-- 缺重量的原料需要人工补齐后再导入。 -->\n`
    : markdown;
}

function extractLooseRecipeTitle(lines: string[]): string {
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  if (heading) return heading.replace(/^#{1,3}\s+/, '').trim();
  const candidate = lines.find((line) => !parseLooseIngredientLine(line) && line.length <= 40 && !/[。；;，,]/.test(line));
  return candidate?.replace(/^标题[:：]\s*/, '').trim() || 'LOCAL RECIPE 本地配方';
}

function parseLooseIngredientLine(line: string): { name: string; grams: string } | null {
  const cleaned = line
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d.、)\]\s-]+/, '')
    .replace(/[，,；;。]$/, '')
    .trim();
  const nameFirst = cleaned.match(/^(.{1,32}?)[：:\s]*(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|l)\b/i);
  if (nameFirst) {
    return { name: cleanupLooseIngredientName(nameFirst[1]), grams: normalizeLooseUnit(nameFirst[2], nameFirst[3]) };
  }
  const amountFirst = cleaned.match(/^(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|l)\s*(?:de\s+)?(.{1,32})$/i);
  if (amountFirst) {
    return { name: cleanupLooseIngredientName(amountFirst[3]), grams: normalizeLooseUnit(amountFirst[1], amountFirst[2]) };
  }
  return null;
}

function cleanupLooseIngredientName(value: string): string {
  return value
    .replace(/^(原料|食材|用料)\s*[:：]?/, '')
    .replace(/\s*(约|大约|左右|适量|可选).*$/, '')
    .replace(/[|]/g, '')
    .trim();
}

function normalizeLooseUnit(amount: string, unit: string): string {
  const value = Number(amount);
  const normalizedUnit = unit.toLowerCase();
  if (/kg|千克|公斤/.test(normalizedUnit)) return String(value * 1000);
  if (/l|升/.test(normalizedUnit) && !/ml|毫升/.test(normalizedUnit)) return String(value * 1000);
  return String(value);
}

function inferLooseComponentName(title: string): string {
  if (/甘那许|ganache/i.test(title)) return 'Ganache 甘那许';
  if (/饼干|曲奇|cookie/i.test(title)) return 'Pâte à Cookie 曲奇面团';
  if (/蛋糕|cake/i.test(title)) return 'Appareil à Cake 蛋糕糊';
  if (/面包|brioche|bread/i.test(title)) return 'Pâte 面团';
  return 'Appareil principal 主体';
}

function toFrenchIngredientName(name: string): string {
  const value = name.trim();
  const lower = value.toLowerCase();
  if (/面粉|farine|flour/.test(lower)) return lower.includes('t45') || value.includes('45') ? 'farine T45' : 'farine';
  if (/黑巧|巧克力|chocolat|chocolate/.test(lower)) return /白巧|white/.test(lower) ? 'chocolat blanc' : 'chocolat noir';
  if (/黄油|beurre|butter/.test(lower)) return 'beurre';
  if (/糖|sucre|sugar/.test(lower)) return 'sucre';
  if (/盐|sel|salt/.test(lower)) return 'sel';
  if (/鸡蛋|蛋|œuf|oeuf|egg/.test(lower)) return 'œufs';
  if (/可可|cacao|cocoa/.test(lower)) return 'cacao poudre';
  if (/泡打粉|baking powder/.test(lower)) return 'levure chimique';
  if (/小苏打|baking soda/.test(lower)) return 'bicarbonate';
  if (/橙皮|orange zest/.test(lower)) return "zeste d'orange";
  if (/柠檬皮|lemon zest/.test(lower)) return 'zeste de citron';
  if (/核桃|noix|walnut/.test(lower)) return 'noix';
  if (/杏仁|amande|almond/.test(lower)) return 'amande';
  if (/榛子|noisette|hazelnut/.test(lower)) return 'noisette';
  if (/奶油|cream|cr[eè]me/.test(lower)) return 'crème';
  if (/牛奶|lait|milk/.test(lower)) return 'lait';
  if (/吉利丁|gelatine|gélatine/.test(lower)) return 'gélatine';
  if (/酵母|levure|yeast/.test(lower)) return 'levure fraîche';
  return value;
}

function validateRecipeMarkdown(raw: string): string[] {
  const problems: string[] = [];
  if (!/^titre:\s*.+$/m.test(raw) && !/^#\s+.+$/m.test(raw)) {
    problems.push('需要标题或 frontmatter 里的 titre');
  }
  if (!/^#{2,3}\s+.+$/m.test(raw)) {
    problems.push('至少需要一个 ## 组成标题');
  }
  if (!/\|\s*[^|\n]*\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b/i.test(raw)) {
    problems.push('至少需要一行带数字和单位的原料');
  }
  if (!/\|/.test(raw)) {
    problems.push('建议使用 Markdown 表格录入原料');
  }
  if (/\|\s*0(?:\.0+)?\s*g\s+de\b/i.test(raw) || /0(?:\.0+)?\s*克\s*原料待补/.test(raw)) {
    problems.push('存在 0g 或待补原料，导入前需要补齐重量');
  }
  return problems;
}

function buildReferencedRecipes(docs: KnowledgeDoc[], availableRecipes: Recipe[]): Recipe[] {
  const existing = new Set(availableRecipes.map((recipe) => recipe.path.split('/').pop()?.toLowerCase()));
  const seen = new Set<string>();
  const refs: Recipe[] = [];

  for (const doc of docs) {
    for (const example of extractKnowledgeExamples(doc.raw)) {
      const fileName = example.path.split('/').pop()?.toLowerCase();
      if (!fileName || existing.has(fileName) || seen.has(example.path)) continue;
      seen.add(example.path);
      refs.push({
        id: `ref-${slugify(example.path)}`,
        title: example.note || prettifyPath(example.path),
        sourceFile: 'knowledge-reference',
        path: example.path,
        raw: `${example.note} ${example.path}`,
        components: [],
        status: 'referenced',
        referencePath: example.path,
        referenceNote: `引用自技法库：${displayKnowledgeTitle(doc.title)}`,
        sourceDocId: doc.id,
      });
    }
  }

  return refs;
}

function filterKnowledge(docs: KnowledgeDoc[], query: string): KnowledgeDoc[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return docs;
  return docs.filter((doc) =>
    `${doc.id} ${doc.title} ${doc.source ?? ''} ${doc.status ?? ''} ${doc.featured ? '常用 星标 推荐' : ''} ${
      doc.badges?.join(' ') ?? ''
    } ${doc.raw}`
      .toLowerCase()
      .includes(normalized),
  );
}

function isFormulaDoc(doc: KnowledgeDoc): boolean {
  return formulaDocIds.has(doc.id);
}

function pinLabel(pin: PinItem, docs: KnowledgeDoc[]): string {
  if (pin.type === 'recipe') return '配方';
  if (pin.type === 'ingredient') return '原料';
  const doc = docs.find((item) => item.id === pin.docId);
  return doc ? knowledgeCardLabel(doc) : '技法';
}

function knowledgeStatus(doc: KnowledgeDoc): 'active' | 'archive' {
  return doc.status ?? (doc.source ? 'active' : 'archive');
}

function knowledgeCardLabel(doc: KnowledgeDoc): string {
  if (isFormulaDoc(doc)) return knowledgeStatus(doc) === 'archive' ? '基础配方归档' : '基础配方';
  return knowledgeStatus(doc) === 'archive' ? '资料归档' : '技法卡片';
}

function knowledgeSourceLabel(doc: KnowledgeDoc): string {
  if (doc.source) return `${doc.source} · ${doc.path.split('/').pop()}`;
  return `Baker Desk 资料归档（来源待补） · ${doc.path.split('/').pop()}`;
}

function sortRecipesByPriority(items: Recipe[]): Recipe[] {
  return [...items].sort((a, b) => itemPriority(b) - itemPriority(a));
}

function sortKnowledgeByPriority(items: KnowledgeDoc[]): KnowledgeDoc[] {
  return [...items].sort((a, b) => itemPriority(b) - itemPriority(a));
}

function itemPriority(item: Recipe | KnowledgeDoc): number {
  return (item.featured ? 100 : 0) + ((item.badges?.length ?? 0) > 0 ? 10 : 0);
}

function recipeCardLabel(recipe: Recipe): string {
  if (recipe.status === 'referenced') return '知识库实例';
  if (recipe.sourceDocId) return '可计算基础配方';
  return recipe.path.startsWith('/local-recipes/') ? '本地配方' : '可计算配方';
}

function recipeSourceLabel(recipe: Recipe): string {
  if (recipe.status === 'referenced') {
    return `技法笔记引用 · ${recipe.referencePath ?? recipe.sourceFile}`;
  }

  if (recipe.path.startsWith('/local-recipes/')) {
    return `本地录入 · ${recipe.sourceFile}`;
  }

  if (recipe.sourceDocId) {
    return `${recipe.source ?? 'Baker Desk 种子配方'} · 依据 ${recipe.sourceDocId}.md 转写`;
  }

  return `${recipe.source ?? '内置配方'} · ${recipe.sourceFile}`;
}

function uniqueBadgeKeys(badges: string[]): string[] {
  return [...new Set(badges.map((badge) => badge.trim()).filter(Boolean))];
}

function visibleBadgeKeys(badges: string[]): string[] {
  const hidden = new Set(['opensource', 'open']);
  return uniqueBadgeKeys(badges).filter((badge) => !hidden.has(normalizeBadgeKey(badge)));
}

function badgeLabel(badge: string): string {
  const key = normalizeBadgeKey(badge);
  const labels: Record<string, string> = {
    archive: '归档',
    base: '基础',
    bars: '切块',
    beginner: '新手',
    breakfast: '早餐',
    butter: '黄油香',
    cake: '蛋糕体',
    chocolate: '巧克力',
    classic: '经典',
    cream: '奶油',
    crisp: '酥脆',
    decoration: '装饰',
    dough: '面团',
    eggwhite: '分蛋',
    emulsion: '乳化',
    enriched: '高油脂',
    fast: '快手',
    filling: '内馅',
    flexible: '可变体',
    fruit: '水果',
    handwritten: '手写录入',
    historical: '传统',
    light: '轻盈',
    loweffort: '省事',
    makeahead: '可提前',
    microwave: '微波',
    mousse: '慕斯',
    nutty: '坚果',
    pan: '平底锅',
    pudding: '布丁',
    quick: '快手',
    quickbread: '快手面糊',
    rich: '浓郁',
    sauce: '酱料',
    scalable: '易缩放',
    shell: '壳体',
    simple: '简单',
    stable: '稳定',
    structure: '结构',
    syrup: '糖浆',
    tart: '塔类',
    texture: '口感',
    topping: '装饰面',
    troubleshooting: '排查',
  };
  return labels[key] ?? badge;
}

function badgeTitle(badge: string): string {
  const label = badgeLabel(badge);
  const details: Record<string, string> = {
    稳定: '稳定性更好，适合复用或容错',
    易缩放: '比例清晰，适合按基准重量换算',
    快手: '操作链路较短，适合日常快速制作',
    内馅: '适合作为夹心、填馅或复合甜点组件',
    结构: '适合作为支撑、承托或成型结构',
    口感: '在口感层次上更有优势',
  };
  return details[label] ?? label;
}

function badgeIcon(badge: string) {
  const key = normalizeBadgeKey(badge);
  if (['stable', 'structure'].includes(key)) return <ShieldCheck size={12} />;
  if (['scalable', 'base'].includes(key)) return <Scale size={12} />;
  if (['fast', 'quick', 'loweffort', 'makeahead'].includes(key)) return <Clock3 size={12} />;
  if (['flexible'].includes(key)) return <Repeat2 size={12} />;
  if (['filling', 'cake', 'mousse', 'shell', 'tart', 'quickbread'].includes(key)) return <Layers size={12} />;
  return <Sparkles size={12} />;
}

function normalizeBadgeKey(badge: string): string {
  return normalizeLoose(badge)
    .replace(/[\s_-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function knowledgeBlocks(raw: string): Array<{ kind: 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: string[] } | { kind: 'table'; rows: string[][] }> {
  const blocks: Array<{ kind: 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: string[] } | { kind: 'table'; rows: string[][] }> = [];
  const lines = raw.replace(/^---[\s\S]*?---\s*/m, '').split('\n');
  let list: string[] = [];
  let table: string[][] = [];

  function flushList() {
    if (list.length) {
      blocks.push({ kind: 'list', items: list });
      list = [];
    }
  }

  function flushTable() {
    if (table.length) {
      blocks.push({ kind: 'table', rows: table });
      table = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '---') {
      flushList();
      flushTable();
      continue;
    }
    if (line.startsWith('# ')) continue;
    if (/^-\s*`[^`]+\.md`/.test(line)) continue;

    if (line.includes('|') && line.startsWith('|')) {
      flushList();
      const cells = line
        .split('|')
        .map((cell) => cleanupMarkdown(cell.trim()))
        .filter(Boolean);
      if (cells.length && !cells.every((cell) => /^[-:]+$/.test(cell))) table.push(cells);
      continue;
    }

    flushTable();

    if (line.startsWith('##')) {
      flushList();
      blocks.push({ kind: 'heading', text: cleanupMarkdown(line.replace(/^#+\s*/, '')) });
      continue;
    }

    if (line.startsWith('- ')) {
      list.push(cleanupMarkdown(line.replace(/^-\s*/, '')));
      continue;
    }

    if (line.startsWith('>')) {
      blocks.push({ kind: 'paragraph', text: cleanupMarkdown(line.replace(/^>\s*/, '')) });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: cleanupMarkdown(line) });
  }

  flushList();
  flushTable();
  return blocks.slice(0, 20);
}

function extractKnowledgeExamples(raw: string): Array<{ path: string; note: string }> {
  return raw
    .split('\n')
    .map((line) => {
      const match = line.match(/`([^`]+\.md)`\s*[\u2013\u2014-]\s*(.+?)\r?$/);
      if (!match) return null;
      return { path: match[1], note: cleanupMarkdown(match[2]) };
    })
    .filter((item): item is { path: string; note: string } => Boolean(item));
}

function findRecipeReference(recipes: Recipe[], path: string, note: string): Recipe | null {
  const fileName = path.split('/').pop()?.toLowerCase();
  return (
    recipes.find((recipe) => recipe.referencePath === path) ??
    recipes.find((recipe) => recipe.path.toLowerCase().endsWith(fileName ?? '')) ??
    recipes.find((recipe) => recipe.title.toLowerCase() === note.toLowerCase()) ??
    null
  );
}

function ingredientPin(recipe: Recipe, ingredient: Ingredient, percent: number | null): PinItem {
  return {
    id: `ingredient:${recipe.id}:${ingredient.name}`,
    type: 'ingredient',
    title: displayIngredientName(ingredient.name),
    subtitle: displayRecipeTitle(recipe.title),
    note: `${ingredient.grams ?? ingredient.quantityText}g · ${percent === null ? '无百分比' : `${percent.toFixed(1)}%`}`,
  };
}

function countIngredients(recipe: Recipe) {
  return recipe.components.reduce((count, component) => count + component.ingredients.length, 0);
}

function totalOriginalGrams(recipe: Recipe): number {
  return recipe.components.reduce(
    (sum, component) => sum + component.ingredients.reduce((componentSum, ingredient) => componentSum + (ingredient.grams ?? 0), 0),
    0,
  );
}

function totalScaledGrams(result: ScaleResult | null): number {
  return result?.rows.reduce((sum, row) => sum + (row.scaled ?? row.ingredient.grams ?? 0), 0) ?? 0;
}

function formatGrams(value: number): string {
  if (!value) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}kg`;
  return `${value.toFixed(0)}g`;
}

function recipeInstructions(recipe: Recipe): string[] {
  const withoutFrontmatter = recipe.raw.replace(/^---[\s\S]*?---\s*/m, '');
  const lines = withoutFrontmatter
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const steps: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith('|')) {
      inTable = true;
      continue;
    }
    if (inTable && !line.startsWith('|')) inTable = false;
    if (inTable) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('- ')) continue;
    if (/^(source|sources?|来源|出处)\s*[:：]/i.test(line)) continue;
    if (/^[-:|\s]+$/.test(line)) continue;
    steps.push(cleanupMarkdown(line));
  }

  const preferredSteps = steps.some(containsChinese) ? steps.filter(containsChinese) : steps;
  return uniqueInstructionLines(preferredSteps.map(displayInstructionText)).slice(0, 8);
}

function workflowSteps(recipe: Recipe): string[] {
  const instructions = recipeInstructions(recipe);
  const arrowLine = instructions.find((line) => /[\u4e00-\u9fff]/.test(line) && line.includes('→')) ?? instructions.find((line) => line.includes('→'));
  if (arrowLine) {
    return arrowLine
      .split('→')
      .map((step) => step.trim())
      .filter(Boolean);
  }

  const sentenceLine =
    instructions.find((line) => containsChinese(line) && /[。；;]/.test(line)) ?? instructions.find((line) => line.includes('.') || /[。；;]/.test(line));
  if (!sentenceLine) return instructions;
  return sentenceLine
    .split(/[.。；;]/)
    .map((step) => step.trim())
    .filter(Boolean);
}

function recipeSignals(recipe: Recipe): Array<{ label: string; value: string }> {
  const raw = recipe.raw;
  const signals: Array<{ label: string; value: string }> = [];
  const temps = [...raw.matchAll(/\d+\s*°C/g)].map((match) => match[0]);
  const times = [...raw.matchAll(/\d+\s*(?:h|min|小时|分钟)/gi)].map((match) => match[0]);
  const hasFermentation = /发酵|pointage|apprêt|levure/i.test(raw);
  const hasBake = /cuisson|烘烤|bake|cuire/i.test(raw);

  if (temps.length) signals.push({ label: '温度', value: uniqueList(temps).join(' / ') });
  if (times.length) signals.push({ label: '时间', value: uniqueList(times).join(' / ') });
  if (hasFermentation) signals.push({ label: '发酵', value: '需要' });
  if (hasBake) signals.push({ label: '烘烤', value: '需要' });
  if (!signals.length) signals.push({ label: '流程', value: '查看步骤' });

  return signals.slice(0, 4);
}

function ingredientRoleTotals(recipe: Recipe): Array<{ role: string; grams: number; percent: number }> {
  const totals = new Map<string, number>();
  const total = totalOriginalGrams(recipe) || 1;

  for (const component of recipe.components) {
    for (const ingredient of component.ingredients) {
      if (!ingredient.grams) continue;
      const role = ingredientRole(ingredient);
      totals.set(role, (totals.get(role) ?? 0) + ingredient.grams);
    }
  }

  return [...totals.entries()]
    .map(([role, grams]) => ({ role, grams, percent: (grams / total) * 100 }))
    .sort((a, b) => b.grams - a.grams)
    .slice(0, 8);
}

function ingredientRole(ingredient: Ingredient): string {
  const normalized = normalizeLoose(`${ingredient.name} ${ingredient.originalName ?? ''}`);
  if (/面粉|粉|farine|flour|cacao|cocoa|poudre/.test(normalized)) return '粉类';
  if (/糖|葡萄糖|蜂蜜|sucre|sugar|glucose|miel|honey/.test(normalized)) return '糖';
  if (/黄油|油|油脂|beurre|butter|huile|oil/.test(normalized)) return '油脂';
  if (/鸡蛋|全蛋|蛋黄|蛋清|oeuf|oeufs|egg|yolk|white/.test(normalized)) return '蛋';
  if (/巧克力|chocolat|chocolate/.test(normalized)) return '巧克力';
  if (/坚果|杏仁|榛子|核桃|帕林内|noix|amande|noisette|nut|pralin/.test(normalized)) return '坚果';
  if (/牛奶|奶油|淡奶油|水|lait|creme|cream|water|eau/.test(normalized)) return '液体/乳制品';
  if (/盐|sel|salt/.test(normalized)) return '盐';
  if (/酵母|泡打粉|塔塔粉|levure|yeast|baking|tartar/.test(normalized)) return '膨松/酵母';
  return '其他';
}

function recipeRiskNotes(recipe: Recipe, result: ScaleResult | null): string[] {
  const notes: string[] = [];
  const rows = result?.rows ?? [];
  const byName = (pattern: RegExp) => rows.find((row) => pattern.test(normalizeLoose(`${row.ingredient.name} ${row.ingredient.originalName ?? ''}`)));
  const fat = byName(/黄油|油|beurre|butter|huile|oil/);
  const sugar = byName(/糖|sucre|sugar/);
  const salt = byName(/盐|sel|salt/);
  const yeast = byName(/酵母|levure|yeast/);
  const chocolate = byName(/巧克力|chocolat|chocolate/);

  if (fat?.percent && fat.percent >= 50) notes.push(`油脂约 ${fat.percent.toFixed(0)}%，搅拌和乳化要分次加入，避免结构断裂。`);
  if (sugar?.percent && sugar.percent >= 100) notes.push(`糖量约 ${sugar.percent.toFixed(0)}%，甜度和保湿感会比较明显。`);
  if (salt?.percent && salt.percent > 3) notes.push(`盐量约 ${salt.percent.toFixed(1)}%，已经偏高，缩放时建议复核。`);
  if (yeast?.percent && yeast.percent >= 4) notes.push(`酵母约 ${yeast.percent.toFixed(0)}%，发酵速度会比较快，注意温度。`);
  if (chocolate?.percent && chocolate.percent >= 150) notes.push(`巧克力占比很高，冷却后的质地主要由可可脂和糖结构决定。`);
  if (/brownie/i.test(recipe.title)) notes.push('布朗尼不要烤到完全干透，中心略湿润会更接近软糯口感。');
  if (/brioche/i.test(recipe.title)) notes.push('布里欧修属于高油脂面团，黄油建议在面筋形成后逐步加入。');

  return notes.length ? notes : ['当前比例没有明显异常；可以根据口感目标调整基准原料再对比。'];
}

function extractRatioFragments(value: string): string[] {
  const fragments = new Set<string>();
  for (const match of value.matchAll(/\d+(?:\.\d+)?\s*(?:g|ml|kg|克|毫升)[^，,；;）)]{0,24}/gi)) {
    fragments.add(match[0].trim());
  }
  for (const match of value.matchAll(/\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/g)) {
    fragments.add(match[0].trim());
  }
  return [...fragments];
}

function knowledgePreview(doc: KnowledgeDoc) {
  return cleanupMarkdown(
    doc.raw
      .replace(/^---[\s\S]*?---\s*/m, '')
      .split('\n')
      .find((line) => line.trim() && !line.startsWith('#') && !line.startsWith('|')) ?? '点击查看技法逻辑',
  ).slice(0, 52);
}

function cleanupMarkdown(value: string) {
  return value.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function uniqueList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/g, '')))];
}

function normalizeLoose(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function prettifyPath(path: string) {
  return path
    .split('/')
    .pop()!
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
