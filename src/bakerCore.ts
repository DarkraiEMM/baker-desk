import type { Component, Ingredient, KnowledgeDoc, Recipe, ScaleResult } from './types';

const unitToGrams: Record<string, number> = {
  g: 1,
  gr: 1,
  kg: 1000,
  mg: 0.001,
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  克: 1,
  公斤: 1000,
  千克: 1000,
  毫克: 0.001,
  毫升: 1,
  升: 1000,
};

const baseKeywords = [
  '面粉',
  '巧克力',
  '淡奶油',
  '奶油',
  '牛奶',
  '杏仁粉',
  '杏仁',
  '蛋清',
  '全蛋',
  '鸡蛋',
  '蛋黄',
  '帕林内',
  '糖',
  'farine',
  'flour',
  'farine de ble',
  'farine de blé',
  'farine t55',
  'farine t45',
  'chocolat',
  'chocolate',
  'creme',
  'crème',
  'cream',
  'lait',
  'milk',
  'poudre d amande',
  'poudre d amandes',
  'amande',
  'amandes',
  'almond',
  'almonds',
  'blanc d oeuf',
  'blancs d oeufs',
  'egg white',
  'egg whites',
  'oeuf',
  'oeufs',
  'egg',
  'eggs',
];

export function parseQuantity(quantityText: string): number | null {
  let text = quantityText.trim().replace(',', '.');
  if (!text) return null;

  const rangeMatch = text.match(/^(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/);
  if (rangeMatch) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    text = String((low + high) / 2);
  }

  const unitMatch = text.match(/^(\d+\.?\d*)\s*(千克|公斤|毫克|毫升|克|升|[a-zA-Z]+)/i);
  if (unitMatch) {
    const value = Number(unitMatch[1]);
    const unit = unitMatch[2].toLowerCase().replace(/s$/, '');
    return value * (unitToGrams[unit] ?? 1);
  }

  const bareMatch = text.match(/^(\d+\.?\d*)$/);
  return bareMatch ? Number(bareMatch[1]) : null;
}

export function parseRecipeMarkdown(id: string, path: string, raw: string): Recipe {
  const rawTitle = raw.match(/^titre:\s*(.+)$/m)?.[1]?.trim() ?? id;
  const titleParts = splitMixedDisplayName(rawTitle);
  const title = titleParts.primary;
  const source = raw.match(/^source:\s*(.+)$/m)?.[1]?.trim();
  const sourceFile = raw.match(/^source_file:\s*(.+)$/m)?.[1]?.trim() ?? path.split('/').pop() ?? id;
  const baseHint = raw.match(/^base_hint:\s*(.+)$/m)?.[1]?.trim();
  const sourceDocId = raw.match(/^source_doc:\s*(.+)$/m)?.[1]?.trim();
  const featured = parseFeatured(raw);
  const badges = parseBadges(raw);
  const components: Component[] = [];
  let current: Component | null = null;

  for (const originalLine of raw.split('\n')) {
    const line = originalLine.trimEnd();
    const heading = line.match(/^#{2,3}\s+(.+)/);

    if (heading) {
      const originalName = heading[1]
        .replace(/[\u4e00-\u9fff]+.*$/, '')
        .replace(/\/\s*$/, '')
        .trim();
      current = { name: originalName || heading[1].trim(), originalName: originalName || undefined, ingredients: [] };
      components.push(current);
      continue;
    }

    if (line.startsWith('|') && line.includes('|', 1)) {
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (!cells.length || /^[-:]+$/.test(cells[0])) continue;
      if (/^(ingredients?|ingrédients?|食材|原料|用料)$/i.test(cells[0])) continue;

      const ingredient = parseIngredientCells(cells);
      if (!ingredient) continue;

      if (!current) {
        current = { name: '未命名组成', ingredients: [] };
        components.push(current);
      }

      current.ingredients.push(ingredient);
      continue;
    }

    const bullet = line.match(/^-\s+(?!\*\*)(.+)/);
    if (bullet && current) {
      const [quantityText, name] = splitFrenchIngredient(bullet[1].trim());
      if (name && !/^[\u4e00-\u9fff]/.test(name)) {
        current.ingredients.push({
          name,
          quantityText,
          grams: quantityText ? parseQuantity(quantityText) : null,
        });
      }
    }
  }

  return { id, title, originalTitle: titleParts.secondary, source, sourceFile, path, raw, components, baseHint, featured, badges, sourceDocId };
}

export function parseKnowledgeMarkdown(id: string, path: string, raw: string): KnowledgeDoc {
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.replaceAll('-', ' ');
  const source = raw.match(/^source:\s*(.+)$/m)?.[1]?.trim();
  const status = raw.match(/^status:\s*(active|archive)$/m)?.[1]?.trim() as KnowledgeDoc['status'] | undefined;
  return {
    id,
    title,
    source,
    status: status ?? (source ? 'active' : 'archive'),
    featured: parseFeatured(raw),
    badges: parseBadges(raw),
    path,
    raw,
  };
}

export function findRecipes(recipes: Recipe[], query: string): Recipe[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return recipes;
  const dashed = normalized.replace(/\s+/g, '-');
  const compact = normalized.replace(/\s+/g, '');
  const terms = expandSearchTerms(normalized);
  return recipes.filter((recipe) => {
    const haystack = recipeSearchText(recipe);
    return (
      haystack.includes(normalized) ||
      haystack.includes(dashed) ||
      haystack.includes(compact) ||
      terms.some((term) => haystack.includes(term) || haystack.includes(term.replace(/\s+/g, '-')))
    );
  });
}

export function searchByIngredient(recipes: Recipe[], ingredient: string): Recipe[] {
  const needle = normalizeSearch(ingredient);
  if (!needle) return [];
  return recipes.filter((recipe) => recipeSearchText(recipe).includes(needle));
}

export function findKnowledge(docs: KnowledgeDoc[], query: string): KnowledgeDoc | null {
  const normalized = query.toLowerCase();
  const aliases: Array<[string[], string]> = [
    [['甘那许', 'ganache', '乳化', '巧克力'], 'ganache'],
    [['慕斯', 'mousse', '稳定', '凝固'], 'mousse-structure'],
    [['酸', '百香果', '柠檬', 'acidity'], 'acidity-control'],
    [['吉利丁', '琼脂', '果胶', '胶凝', 'hydrocolloid'], 'hydrocolloids'],
    [['替代', '代替', '换成', '换掉', 'substitution', 'substitute'], 'ingredient-substitution'],
    [['模具', '烤盘', '换算', '圆模', '方盘', 'pan scaling', 'pan size'], 'pan-scaling'],
    [['塌陷', '回缩', '夹生', '没熟', '开裂', '失败', 'troubleshooting'], 'cake-troubleshooting'],
    [['曲奇', '饼干', '摊开', 'cookie'], 'cookie-texture-control'],
    [['松饼', '玛芬', '快手蛋糕', 'muffin', 'quickbread'], 'muffin-quickbread-method'],
    [['烤箱', '热风', '风炉', '平炉', '温度', 'oven'], 'oven-temperature-control'],
    [['卡仕达', 'patissiere', 'pâtissière'], 'creme-patissiere'],
    [['甜酥', 'sucree', 'sucrée', 'sablage'], 'pate-sucree'],
    [['泡芙', 'choux'], 'pate-a-choux'],
    [['焦糖', 'caramel'], 'caramel'],
    [['蛋白霜', 'meringue'], 'meringue'],
    [['帕林内', 'praline', 'praliné'], 'praline-croustillant'],
    [['慕斯林', 'mousseline'], 'creme-mousseline'],
    [['joconde', 'dacquoise'], 'biscuit-joconde-dacquoise'],
  ];

  const match = aliases.find(([terms]) => terms.some((term) => normalized.includes(term.toLowerCase())));
  if (match) return docs.find((doc) => doc.id === match[1]) ?? null;

  return (
    docs.find((doc) => {
      const haystack = `${doc.id} ${doc.title} ${doc.raw}`.toLowerCase();
      return haystack.includes(normalized);
    }) ?? null
  );
}

export function calculateScale(recipe: Recipe, baseHint?: string, targetGrams?: number): ScaleResult {
  const allIngredients = recipe.components.flatMap((component) => component.ingredients);
  const base = findBaseIngredient(allIngredients, baseHint);
  const factor = base?.grams && targetGrams ? targetGrams / base.grams : 1;

  return {
    base,
    factor,
    rows: recipe.components.flatMap((component) =>
      component.ingredients.map((ingredient) => {
        const percent = base?.grams && ingredient.grams ? (ingredient.grams / base.grams) * 100 : null;
        const scaled = ingredient.grams && targetGrams ? ingredient.grams * factor : null;
        return { component: component.name, componentOriginalName: component.originalName, ingredient, percent, scaled };
      }),
    ),
  };
}

export function formatScaleResult(recipe: Recipe, result: ScaleResult, targetGrams?: number): string {
  if (!result.base) {
    return `我找到了 ${recipe.title}，但没有识别出可作为基准的重量原料。`;
  }

  const intro = targetGrams
    ? `已将 ${recipe.title} 按 ${result.base.name} = ${targetGrams}g 缩放，倍率 ×${result.factor.toFixed(2)}。`
    : `${recipe.title} 的 Baker's % 已按 ${result.base.name} = ${result.base.grams}g 计算。`;

  const lines = result.rows.map(({ ingredient, percent, scaled }) => {
    const original = ingredient.grams ? `${ingredient.grams.toFixed(1)}g` : ingredient.quantityText || 'QS';
    const pct = percent === null ? '-' : `${percent.toFixed(1)}%`;
    const scaledText = scaled === null ? '' : ` -> ${scaled.toFixed(1)}g`;
    return `${ingredient.name}: ${original}, ${pct}${scaledText}`;
  });

  return `${intro}\n\n${lines.join('\n')}`;
}

export function summarizeKnowledge(doc: KnowledgeDoc): string {
  const body = doc.raw
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('|') && !line.startsWith('---'))
    .slice(0, 12)
    .join('\n');
  return `${doc.title}\n\n${body}`;
}

function findBaseIngredient(ingredients: Ingredient[], baseHint?: string): Ingredient | null {
  const candidates = ingredients.filter((ingredient) => ingredient.grams !== null);
  if (!candidates.length) return null;

  if (baseHint) {
    const hint = normalizeTerm(baseHint);
    const explicit = candidates.find((ingredient) => ingredientSearchName(ingredient).includes(hint));
    if (explicit) return explicit;
  }

  for (const keyword of baseKeywords) {
    const match = candidates.find((ingredient) => ingredientSearchName(ingredient).includes(normalizeTerm(keyword)));
    if (match) return match;
  }

  return candidates.reduce((best, ingredient) => ((ingredient.grams ?? 0) > (best.grams ?? 0) ? ingredient : best));
}

function splitFrenchIngredient(text: string): [string, string] {
  const cleaned = text.replace(/\s*[\u4e00-\u9fff].*$/, '').trim();
  if (!cleaned) return ['', ''];

  const match = cleaned.match(
    /^([\d.,/\-–—]+\s*(?:g|kg|mg|ml|cl|dl|L|l|gr)?)?\s*(?:de\s+|d['’]\s*|du\s+|des\s+|à\s+)?(.+)$/i,
  );

  if (match) {
    let quantity = (match[1] ?? '').trim();
    let name = (match[2] ?? '').trim();

    if (!quantity) {
      const numberMatch = cleaned.match(/^(\d+[\d.,]*)\s+(.+)$/);
      if (numberMatch) {
        quantity = numberMatch[1];
        name = numberMatch[2];
      }
    }

    return [quantity, name];
  }

  return ['', cleaned];
}

function parseIngredientCells(cells: string[]): Ingredient | null {
  if (/^(ingredients?|ingrédients?|食材|原料|用料)$/i.test(cells[0])) return null;
  const [foreignQuantity, foreignName] = splitFrenchIngredient(cells[0]);
  const chineseCell = cells.find((cell, index) => index > 0 && /[\u4e00-\u9fff]/.test(cell));
  const [chineseQuantity, chineseName] = chineseCell ? splitChineseIngredient(chineseCell) : ['', ''];
  const name = chineseName || foreignName;
  if (!name) return null;

  const quantityText = chineseQuantity || foreignQuantity;
  return {
    name,
    originalName: foreignName && normalizeTerm(foreignName) !== normalizeTerm(name) ? foreignName : undefined,
    quantityText,
    grams: quantityText ? parseQuantity(quantityText) : null,
  };
}

function splitChineseIngredient(text: string): [string, string] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^([\d.,/\-–—]+\s*(?:千克|公斤|毫克|毫升|克|升|g|kg|mg|ml|cl|dl|l|gr)?)\s*(?:的)?(.+)$/i);
  if (!match) return ['', cleanupChineseIngredientName(cleaned)];
  return [(match[1] ?? '').trim(), cleanupChineseIngredientName(match[2] ?? '')];
}

function cleanupChineseIngredientName(value: string): string {
  return value.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim();
}

function splitMixedDisplayName(value: string): { primary: string; secondary?: string } {
  const clean = value.trim();
  const chinese = clean.match(/[\u4e00-\u9fff][\u4e00-\u9fff\d\s%％：:（）()·/+\-.]*/)?.[0]?.trim();
  if (!chinese) return { primary: clean };
  const secondary = clean.replace(chinese, '').replace(/\s{2,}/g, ' ').trim();
  return { primary: chinese, secondary: secondary || undefined };
}

function normalizeTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function ingredientSearchName(ingredient: Ingredient): string {
  return normalizeTerm(`${ingredient.name} ${ingredient.originalName ?? ''}`);
}

function recipeSearchText(recipe: Recipe): string {
  const ingredients = recipe.components
    .flatMap((component) => [
      component.name,
      component.originalName,
      ...component.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.originalName]),
    ])
    .join(' ');
  const typeTerms =
    recipe.status === 'referenced'
      ? '知识库实例 库内实例 本地实例 本地实例配方 实例配方 引用 reference instance'
      : recipe.path.startsWith('/local-recipes/')
        ? '本地录入 本地配方 用户配方 local recipe'
        : recipe.sourceDocId
          ? '基础配方 种子配方 可计算基础配方 base formula seed recipe'
          : '可计算配方 内置配方 recipe';

  return normalizeSearch(
    [
      recipe.id,
      recipe.title,
      recipe.originalTitle,
      recipe.source,
      recipe.sourceFile,
      recipe.sourceDocId,
      recipe.baseHint,
      recipe.featured ? '常用 星标 推荐 favorite featured' : '',
      recipe.badges?.join(' '),
      recipe.path,
      recipe.referencePath,
      recipe.referenceNote,
      typeTerms,
      ingredients,
      recipe.raw,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function expandSearchTerms(query: string): string[] {
  const aliasGroups = [
    ['甘那许', '干纳许', 'ganache'],
    ['卡仕达', '卡士达', 'creme patissiere', 'creme pâtissière', 'patissiere', 'patisserie'],
    ['慕斯林', 'mousseline'],
    ['泡芙', 'choux', 'pate a choux', 'pâte à choux'],
    ['甜酥皮', '甜酥', 'pate sucree', 'pâte sucrée', 'sucree'],
    ['蛋白霜', 'meringue'],
    ['达克瓦兹', 'dacquoise'],
    ['杏仁蛋糕体', 'joconde'],
    ['帕林内', 'praline', 'praliné'],
    ['脆底', 'croustillant'],
    ['焦糖', 'caramel'],
    ['布朗尼', 'brownie'],
    ['布里欧修', 'brioche'],
    ['库内实例', '本地实例', '本地实例配方', '实例配方', '知识库实例', '引用'],
  ].map((group) => group.map(normalizeSearch));

  const terms = new Set<string>([query]);
  for (const group of aliasGroups) {
    if (group.some((alias) => query.includes(alias))) {
      group.forEach((alias) => terms.add(alias));
    }
  }
  return [...terms].filter(Boolean);
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeatured(raw: string): boolean {
  return /^(featured|starred|common):\s*(true|yes|1|常用|推荐)$/im.test(raw);
}

function parseBadges(raw: string): string[] {
  const match = raw.match(/^(?:badges|tags|advantages):\s*(.+)$/im);
  if (!match) return [];
  return match[1]
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
