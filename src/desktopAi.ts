import type { KnowledgeDoc, Recipe } from './types';
import { formatIntentTrainingExamples } from './trainingSet';

export type AiRuntimeStatus = {
  available: boolean;
  ready: boolean;
  mode: 'ollama-local' | 'qwen-local' | 'rules' | 'browser-preview' | string;
  engine: string;
  model: string;
  enginePath?: string | null;
  modelPath?: string | null;
  dataDir: string;
  detail: string;
};

export type AiIntentPayload = {
  intent?: 'find_recipe' | 'scale_recipe' | 'ingredient_search' | 'recommend_recipe' | 'show_knowledge' | 'answer' | string;
  recipe_query?: string | null;
  recipeQuery?: string | null;
  target_grams?: number | null;
  targetGrams?: number | null;
  base_hint?: string | null;
  baseHint?: string | null;
  ingredient_query?: string | null;
  ingredientQuery?: string | null;
  doc_query?: string | null;
  docQuery?: string | null;
  reply?: string | null;
};

type AiIntentResponse = {
  text: string;
  json?: string | null;
  markdown?: string | null;
  engine: string;
  model: string;
};

export type DesktopRecipePack = {
  path: string;
  raw: string;
};

export type AiGroundedReply = {
  text: string;
  engine: string;
  model: string;
  source: string;
};

export const browserPreviewAiStatus: AiRuntimeStatus = {
  available: false,
  ready: false,
  mode: 'browser-preview',
  engine: '浏览器预览',
  model: '桌面版检测 Ollama / Qwen',
  dataDir: '',
  detail: '当前是浏览器预览；安装版会优先检测本机 Ollama，再从程序资源目录加载内置 Qwen。',
};

export async function getAiStatus(): Promise<AiRuntimeStatus> {
  if (!isTauriRuntime()) return browserPreviewAiStatus;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AiRuntimeStatus>('baker_ai_status');
}

export async function askAiIntent(prompt: string, recipes: Recipe[], docs: KnowledgeDoc[]): Promise<AiIntentPayload | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const response = await invoke<AiIntentResponse>('baker_ai_intent', {
    request: {
      prompt,
      recipeIndex: buildRecipeIndex(recipes),
      knowledgeIndex: buildKnowledgeIndex(docs),
      trainingExamples: formatIntentTrainingExamples(),
    },
  });
  return parseAiIntent(response.json ?? response.text);
}

export async function askAiRecipeDraft(raw: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const response = await invoke<AiIntentResponse>('baker_ai_recipe_draft', {
    request: { raw },
  });
  return cleanupAiMarkdown(response.markdown ?? response.text);
}

export async function askAiGroundedReply(
  prompt: string,
  localReply: string,
  recipes: Recipe[],
  docs: KnowledgeDoc[],
): Promise<AiGroundedReply | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const response = await invoke<AiIntentResponse>('baker_ai_grounded_reply', {
    request: {
      prompt,
      localReply,
      recipeIndex: buildRelevantRecipeIndex(prompt, localReply, recipes),
      knowledgeIndex: buildRelevantKnowledgeIndex(prompt, localReply, docs),
    },
  });
  const text = cleanupAiReply(response.text);
  if (!text) return null;
  const source = response.engine.toLowerCase().includes('ollama') ? 'Ollama 回答' : 'Qwen 回答';
  return { text, engine: response.engine, model: response.model, source };
}

export async function stopAiRuntime(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('baker_ai_stop');
}

export async function readDesktopRecipePacks(): Promise<DesktopRecipePack[]> {
  if (!isTauriRuntime()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopRecipePack[]>('baker_read_recipe_packs');
}

export function isAiReady(status: AiRuntimeStatus): boolean {
  return Boolean(status.ready && (status.mode === 'ollama-local' || status.mode === 'qwen-local'));
}

export function aiRuntimeLabel(status: AiRuntimeStatus): string {
  if (status.mode === 'ollama-local') return 'Ollama';
  if (status.mode === 'qwen-local') return 'Qwen';
  return '本地规则';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function buildRecipeIndex(recipes: Recipe[]): string {
  return recipes
    .filter((recipe) => recipe.status !== 'referenced')
    .slice(0, 12)
    .map(formatRecipeIndexLine)
    .join('\n');
}

function buildRelevantRecipeIndex(prompt: string, localReply: string, recipes: Recipe[]): string {
  const query = normalizeSearchText(`${prompt} ${localReply}`);
  const scored = recipes
    .filter((recipe) => recipe.status !== 'referenced')
    .map((recipe) => ({ recipe, score: scoreRecipeForQuery(recipe, query) }))
    .sort((a, b) => b.score - a.score);
  const relevant = scored.filter((item) => item.score > 0).slice(0, 8);
  const fallback = scored.slice(0, 6);
  return (relevant.length ? relevant : fallback).map((item) => formatRecipeIndexLine(item.recipe)).join('\n');
}

function formatRecipeIndexLine(recipe: Recipe): string {
  const ingredients = Array.from(
    new Set(
      recipe.components
        .flatMap((component) => component.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.originalName]))
        .filter(Boolean),
    ),
  )
    .slice(0, 8)
    .join(', ');
  return `- ${recipe.id}: ${recipe.title}; base=${recipe.baseHint ?? ''}; badges=${recipe.badges?.join(', ') ?? ''}; source=${recipe.source ?? ''}; ingredients=${ingredients}`;
}

function buildRelevantKnowledgeIndex(prompt: string, localReply: string, docs: KnowledgeDoc[]): string {
  const query = normalizeSearchText(`${prompt} ${localReply}`);
  const scored = docs
    .map((recipe) => {
      const title = normalizeSearchText(recipe.title);
      const id = normalizeSearchText(recipe.id);
      const score = (query.includes(title) ? 20 : 0) + (query.includes(id) ? 12 : 0) + sharedTokenScore(query, `${title} ${id}`);
      return { doc: recipe, score };
    })
    .sort((a, b) => b.score - a.score);
  const relevant = scored.filter((item) => item.score > 0).slice(0, 6);
  const fallback = scored.slice(0, 4);
  return (relevant.length ? relevant : fallback)
    .map(({ doc }) => `- ${doc.id}: ${doc.title}`)
    .join('\n');
}

function buildKnowledgeIndex(docs: KnowledgeDoc[]): string {
  return docs
    .slice(0, 12)
    .map((doc) => `- ${doc.id}: ${doc.title}`)
    .join('\n');
}

function scoreRecipeForQuery(recipe: Recipe, query: string): number {
  const identity = normalizeSearchText(
    [recipe.id, recipe.title, recipe.originalTitle, recipe.badges?.join(' ')].filter(Boolean).join(' '),
  );
  const ingredientText = normalizeSearchText(
    recipe.components
      .flatMap((component) => [component.name, component.originalName, ...component.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.originalName])])
      .filter(Boolean)
      .join(' '),
  );
  let score = 0;
  for (const part of identity.split(/\s+/).filter((item) => item.length >= 2)) {
    if (query.includes(part)) score += 8;
  }
  if (query.includes(normalizeSearchText(recipe.id))) score += 24;
  if (query.includes(normalizeSearchText(recipe.title))) score += 24;
  if (recipe.originalTitle && query.includes(normalizeSearchText(recipe.originalTitle))) score += 18;
  score += sharedTokenScore(query, ingredientText);
  return score;
}

function sharedTokenScore(query: string, target: string): number {
  const queryTokens = new Set(query.split(/\s+/).filter((item) => item.length >= 2));
  let score = 0;
  for (const token of target.split(/\s+/).filter((item) => item.length >= 2)) {
    if (queryTokens.has(token)) score += 2;
  }
  return score;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAiIntent(raw: string): AiIntentPayload | null {
  const text = raw.trim();
  const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!json || !json.startsWith('{') || !json.endsWith('}')) return null;
  try {
    return JSON.parse(json) as AiIntentPayload;
  } catch {
    return null;
  }
}

function cleanupAiMarkdown(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  const markdown = (fenced?.[1] ?? text).trim();
  if (!markdown.includes('|') || !/titre:|^#\s+/m.test(markdown)) return null;
  return markdown;
}

function cleanupAiReply(raw: string): string | null {
  const text = raw
    .replace(/<\/?think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
  if (!text || text.length < 12) return null;
  if (/菜系|清蒸鱼|家具|桌子|无法帮助|不能提供/i.test(text)) return null;
  return text;
}
