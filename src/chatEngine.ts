import {
  calculateScale,
  findKnowledge,
  findRecipes,
  formatScaleResult,
  searchByIngredient,
  summarizeKnowledge,
} from './bakerCore';
import type { KnowledgeDoc, Recipe } from './types';

export type ChatAction =
  | { type: 'selectRecipe'; recipe: Recipe; response: string; grounding?: string }
  | { type: 'showKnowledge'; doc: KnowledgeDoc; response: string; grounding?: string }
  | { type: 'plain'; response: string; grounding?: string };

export function handleRuleChat(input: string, recipes: Recipe[], docs: KnowledgeDoc[]): ChatAction {
  const text = input.trim();
  const lower = text.toLowerCase();
  const grams = extractTargetGrams(text);
  const recipeName = extractRecipeName(text, recipes);

  if (looksLikeCustardPairingQuestion(text)) {
    return answerCustardPairingQuestion(text, recipes);
  }

  if (looksLikeDessertPairingQuestion(text)) {
    return answerDessertPairingQuestion(text, recipes);
  }

  if (looksLikeSubstitutionQuestion(text)) {
    return { type: 'plain', response: answerSubstitutionQuestion(text) };
  }

  if (looksLikePanQuestion(text)) {
    return { type: 'plain', response: answerPanQuestion(text) };
  }

  if (looksLikeKnowledge(text)) {
    const doc = findKnowledge(docs, text);
    if (doc) {
      return { type: 'showKnowledge', doc, response: summarizeKnowledge(doc) };
    }
  }

  if (looksLikePreferenceRequest(text)) {
    if (recipeName) {
      const recipe = findRecipes(recipes, recipeName)[0];
      if (recipe && recipe.status !== 'referenced') return answerRecipePreferenceRequest(text, recipe, recipes);
    }
    return recommendByPreference(text, recipes);
  }

  if (looksLikeTroubleshootingQuestion(text)) {
    return { type: 'plain', response: answerTroubleshootingQuestion(text) };
  }

  if (looksLikeBakeTimeQuestion(text)) {
    return { type: 'plain', response: answerBakeTimeQuestion(text) };
  }

  if (looksLikeIngredientSearch(text)) {
    const ingredient = extractAfterKeywords(text, ['用到了', '含有', '包含', 'ingredient', '原料']) ?? text;
    const cleanIngredient = cleanupQuery(ingredient);
    const matches = searchByIngredient(recipes, cleanIngredient);
    if (!matches.length) {
      return { type: 'plain', response: `暂时没找到包含「${cleanIngredient}」的配方。` };
    }
    return {
      type: 'plain',
      response: `找到 ${matches.length} 个相关配方：\n${matches.map((recipe) => `- ${recipe.title}`).join('\n')}`,
    };
  }

  if (looksLikeNutRecipeQuestion(text)) {
    const matches = recipes
      .filter((recipe) => recipe.status !== 'referenced')
      .filter((recipe) => /坚果|核桃|杏仁|榛子|nut|nuts|walnut|almond|hazelnut|praline|pralin|帕林内/i.test(recipeText(recipe)))
      .slice(0, 6);
    if (matches.length) {
      const first = matches[0];
      return {
        type: 'selectRecipe',
        recipe: first,
        response: [
          '可以，坚果更适合放在有承托力、油脂不太冲突的配方里。',
          '我会优先看这些：',
          ...matches.map((recipe, index) => `${index + 1}. ${recipe.title}`),
          '如果是核桃/榛子这类颗粒坚果，优先放在松饼、布朗尼、饼干或帕林内结构里；如果是杏仁粉，更适合蛋糕体、达克瓦兹这类结构。',
          `我先帮你打开「${first.title}」。`,
        ].join('\n'),
      };
    }
  }

  if (recipeName) {
    const matches = findRecipes(recipes, recipeName);
    const recipe = matches[0];
    if (!recipe) {
      return { type: 'plain', response: `我没找到「${recipeName}」这份配方。当前配方库里只有：${listRecipeTitles(recipes)}。` };
    }

    if (grams || looksLikeBakersPercent(text)) {
      const baseHint = text.includes('巧克力') || lower.includes('chocolate') ? 'chocolat' : recipe.baseHint ?? 'farine';
      const result = calculateScale(recipe, baseHint, grams ?? undefined);
      return { type: 'selectRecipe', recipe, response: formatScaleResult(recipe, result, grams ?? undefined) };
    }

    return {
      type: 'selectRecipe',
      recipe,
      response: `找到了 ${recipe.title}。它有 ${recipe.components.length} 个组成部分，可以在右侧查看原料表和 Baker's %。`,
    };
  }

  if (looksLikeRecipeLookup(text)) {
    const clean = cleanupQuery(text);
    const matches = findRecipes(recipes, clean);
    if (matches.length) {
      const recipe = matches[0];
      return {
        type: 'selectRecipe',
        recipe,
        response: `找到了 ${recipe.title}。如果要缩放，可以说「把 ${recipe.id.replace('example-', '')} 缩放到 500g 面粉」。`,
      };
    }
    return { type: 'plain', response: `我没找到「${clean || text}」这份配方。可以换一个关键词，或在配方库里看：${listRecipeTitles(recipes)}。` };
  }

  const recipeMatches = findRecipes(recipes, cleanupQuery(text));
  if (recipeMatches.length) {
    const recipe = recipeMatches[0];
    return {
      type: 'selectRecipe',
      recipe,
      response: `我猜你是在找 ${recipe.title}。如果要缩放，可以说「把 ${recipe.id.replace('example-', '')} 缩放到 500g 面粉」。`,
    };
  }

  return {
    type: 'plain',
    response:
      '我可以处理：查配方、按原料搜索、计算 Baker’s %、按基准重量缩放、查看甘那许/慕斯/泡芙等技法笔记。Qwen 没返回时，也会用本地烘焙规则继续处理。',
  };
}

function extractTargetGrams(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:g|克|gram|grams)/i);
  return match ? Number(match[1]) : null;
}

function extractRecipeName(text: string, recipes: Recipe[]): string | null {
  const lower = text.toLowerCase();
  const byId = recipes.find((recipe) => lower.includes(recipe.id.toLowerCase()) || lower.includes(recipe.id.replace('example-', '')));
  if (byId) return byId.id;

  const byTitle = recipes.find((recipe) => lower.includes(recipe.title.toLowerCase()));
  if (byTitle) return byTitle.title;

  const direct = text.match(/(?:查询|查一下|查|寻找|找|搜索|打开|缩放|计算|算一下|把)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fff\w'’.-]*)/);
  if (direct) return cleanupQuery(direct[1]);

  return null;
}

function looksLikeRecipeLookup(text: string): boolean {
  return /配方|recipe|查|查询|搜索|寻找|找|缩放|计算|重算|比例/i.test(text);
}

function looksLikePreferenceRequest(text: string): boolean {
  return /推荐|需要|想要|适合|不油腻|不腻|清爽|轻盈|少油|低油|低糖|少糖|减糖|控糖|降糖|夏天|淡一点|负担|入口轻|早餐|早饭|升糖|血糖|低\s*gi|低GI|全麦|燕麦/i.test(text);
}

function looksLikeCustardPairingQuestion(text: string): boolean {
  const normalized = normalizeForSearch(text);
  const mentionsCustard = /卡仕达|卡士达|custard|creme\s*patissiere|patissiere|patisserie/.test(normalized);
  const asksPairing = /搭配|配合|配什么|配啥|组合|夹心|内馅|馅|加到|加入|低糖|少糖|控糖|不太甜|甜度不高|烘焙配方|配方/i.test(text);
  return mentionsCustard && asksPairing;
}

function looksLikeDessertPairingQuestion(text: string): boolean {
  const normalized = normalizeForSearch(text);
  const mentionsKnownPart =
    /甘那许|ganache|柠檬凝乳|lemon\s*curd|curd|帕林内|praline|pralin|脆底|croustillant|泡芙|choux|甜酥|sucree|布朗尼|brownie|松饼|muffin/.test(
      normalized,
    );
  const asksPairing = /搭配|配合|配什么|配啥|组合|合理|适合|加到|加入|能和|可以和|低糖|少糖|控糖|早餐|清爽/i.test(text);
  return mentionsKnownPart && asksPairing;
}

function looksLikeIngredientSearch(text: string): boolean {
  return /哪些配方|用到了|含有|包含|原料搜索|ingredient/i.test(text);
}

function looksLikeNutRecipeQuestion(text: string): boolean {
  return /配方/.test(text) && /坚果|核桃|杏仁|榛子|nut|walnut|almond|hazelnut/i.test(text) && /融合|加入|加|搭配|适合|可以|能|含/i.test(text);
}

function looksLikeKnowledge(text: string): boolean {
  return /甘那许|慕斯|酸|吉利丁|琼脂|果胶|卡仕达|甜酥|泡芙|焦糖|蛋白霜|帕林内|慕斯林|joconde|dacquoise|ganache|mousse|caramel|choux/i.test(
    text,
  );
}

function looksLikeBakersPercent(text: string): boolean {
  return /baker|百分比|比例|缩放|放大|重算|scale/i.test(text);
}

function looksLikeSubstitutionQuestion(text: string): boolean {
  return /替代|代替|换成|换掉|可以换|能换|换.*吗|能不能用|可以用|没有.*怎么办|没有.*能|没有.*可以|substitute|replace/i.test(text);
}

function looksLikePanQuestion(text: string): boolean {
  return /模具|烤盘|寸|吋|圆模|方盘|长方形|pan size|cake pan|换算.*盘|盘.*换算/i.test(text);
}

function looksLikeTroubleshootingQuestion(text: string): boolean {
  return /为什么|怎么.*塌|塌陷|回缩|开裂|裂开|湿|夹生|没熟|外焦内生|太硬|太干|太黏|太稠|太稀|发不起来|消泡|失败|dense|sunk|crack|underbaked|gummy/i.test(text);
}

function looksLikeBakeTimeQuestion(text: string): boolean {
  return /温度|时间|烤多久|多少度|预热|热风|风炉|平炉|上色|高海拔|高原|altitude|convection|oven/i.test(text);
}

function answerSubstitutionQuestion(text: string): string {
  const lines = ['替代要先看这个原料在配方里负责什么：结构、乳化、油脂、水分、甜度还是膨胀。'];
  if (/joconde|dacquoise|达克瓦兹|杏仁蛋糕体/i.test(text)) {
    lines.push('Joconde 和 Dacquoise 不能直接当作同一种杏仁蛋糕体互换。Joconde 更柔韧、适合卷和薄夹层；Dacquoise 更干、更脆、更坚果香，适合底层或带脆感的结构。');
    lines.push('如果要互换，先确认目标是柔软夹层、吸水承托还是脆感底座，再调整厚度、含水和烘烤时间。');
  } else if (/黄油|butter|beurre/.test(text) && /油|植物油|玉米油|canola|oil/.test(text)) {
    lines.push('黄油和植物油不是完全等价：黄油有水分和固体乳脂，能带香气、支撑酥性和打发结构；油更软润，也更容易显油。蛋糕糊里可小批量试，酥皮、曲奇、布里欧修这类靠黄油结构的配方不建议直接换。');
  } else if (/吉利丁|gelatin|gélatine|琼脂|agar|果胶|pectin/.test(text)) {
    lines.push('吉利丁、琼脂和果胶不能按克数直接等量替换。吉利丁是弹性冷凝胶，琼脂是脆性热凝胶，果胶还要看糖度、酸度和钙离子；同样写 6g，成品质地和凝固条件也完全不同。');
    lines.push('如果是慕斯或奶油体系，优先重新按胶凝剂类型设计：吉利丁看 Bloom 值和酸度，高酸水果要提高用量或改用果胶 NH；琼脂通常要煮沸激活，口感会更脆，不适合直接替代柔软慕斯。');
  } else if (/奶油|淡奶油|heavy cream|cream|cr[eè]me/i.test(text)) {
    lines.push('淡奶油不能简单当成牛奶：它提供脂肪和乳化感。做甘那许、打发奶油、慕斯林时不建议直接换；如果只是补液体，可以用牛奶加少量黄油补油脂，但口感会变薄。');
  } else if (/鸡蛋|全蛋|蛋黄|蛋清|egg|oeuf/i.test(text)) {
    lines.push('鸡蛋替代最看配方类型：海绵、戚风、蛋白霜、达克瓦兹这类靠蛋起泡和结构的配方不适合替；布朗尼、玛芬这类结构负担较轻的配方才有尝试空间。');
  } else if (/低筋|高筋|中筋|面粉|粉|flour|farine/i.test(text)) {
    lines.push('面粉替代会直接改变筋度。蛋糕体优先低筋或中低筋，面包/布里欧修需要高筋或较强中筋；塔壳、甜酥皮太高筋会变硬。');
  } else if (/糖|砂糖|糖粉|红糖|蜂蜜|sugar|sucre|honey|miel/i.test(text)) {
    lines.push('糖不只负责甜味，还影响保湿、上色和结构。砂糖换糖粉会改变颗粒和延展，换蜂蜜/糖浆会增加水分，通常需要同步微调液体。');
  } else {
    lines.push('判断顺序是：它是不是结构原料？是不是主风味？是不是会参与打发或凝固？越靠前，越不能随手换。');
  }
  lines.push('稳妥做法：先用小份量试，记录替代比例、状态和成品口感，再把成功版本录入配方库。');
  return lines.join('\n');
}

function answerPanQuestion(text: string): string {
  const ratio = extractPanRatio(text);
  const lines = ['模具换算先算底面积比例，再决定原料量；不要只看“几寸”这一个数字。'];
  if (ratio) {
    lines.push(`${ratio.label} 的面积倍率约为 ×${ratio.value.toFixed(2)}，原料可以先按这个倍率缩放。`);
  } else {
    lines.push('圆模倍率 = 新直径² / 原直径²；方盘/长方盘倍率 = 新面积 / 原面积。比如 8 寸圆模改 6 寸圆模，倍率约 0.56；6 寸改 8 寸，倍率约 1.78。');
  }
  lines.push('如果换完后面糊高度接近原配方，温度和时间大体接近；更厚就低一点温度、延长时间，更薄就提前检查。');
  lines.push('第一次换模具时，宁可提前 5-10 分钟开始观察，用竹签/中心状态判断，不要只相信固定时间。');
  return lines.join('\n');
}

function answerTroubleshootingQuestion(text: string): string {
  if (/塌|回缩|sunk|sink/i.test(text)) {
    return [
      '塌陷通常先查四件事：中心没烤透、膨松剂过量、搅拌过度、烤箱门开太早。',
      '处理方向：延长烘烤到中心定型；泡打粉/小苏打精确称量并确认没失效；蛋糕糊混到无干粉就停；前半程尽量不开门。',
      '如果配方糖和油很高，也会削弱结构，缩放时要特别小心。',
    ].join('\n');
  }
  if (/湿|夹生|没熟|外焦内生|underbaked|gummy/i.test(text)) {
    return [
      '中间湿或夹生，优先怀疑：烤箱实际温度偏低、模具太小太深、时间不够。',
      '可以先盖锡纸继续烤，每 5 分钟检查一次中心；下次用更浅的模具或减少单盘厚度。',
      '如果外面已经很深色，说明表面升温太快，可以略降温、拉长时间。',
    ].join('\n');
  }
  if (/开裂|裂开|裂|crack/i.test(text)) {
    return [
      '表面开裂常见原因是：上火或整体温度偏高、模具太小导致膨胀过猛、膨松剂偏多。',
      '下次可以降低 10-15°C、换更合适的模具，或把面糊厚度降下来。',
    ].join('\n');
  }
  if (/太硬|太干|硬|干|dense/i.test(text)) {
    return [
      '成品硬、干、密实，先看：面粉过量、搅拌过度、黄油/鸡蛋温度不合适、烘烤过久。',
      '本地录入时尽量用克重；黄油打发类配方要让黄油“软但不化”，鸡蛋和乳制品不要太冰。',
    ].join('\n');
  }
  return [
    '失败排查先分三类：结构没立住、中心没熟、口感太干/太硬。',
    '结构问题看蛋/粉/膨松剂和搅拌；成熟问题看模具厚度、温度和时间；口感问题看水分、糖、油脂和烘烤损耗。',
    '把失败现象加上配方名、模具尺寸、温度时间一起问，判断会更准。',
  ].join('\n');
}

function answerBakeTimeQuestion(text: string): string {
  if (/热风|风炉|convection/i.test(text)) {
    return [
      '热风/风炉通常比平炉传热更强，同一配方可以先降 15-20°C，再提前检查上色和中心状态。',
      '多盘同烤要留空气流动空间，必要时中途调换位置。',
    ].join('\n');
  }
  if (/高海拔|高原|altitude/i.test(text)) {
    return [
      '高海拔会让水分蒸发更快、膨胀更快，常见方向是：略升烤温、缩短时间、增加液体、减少膨松剂。',
      '它受海拔和当地湿度影响很大，建议一次只改一个变量并记录。',
    ].join('\n');
  }
  return [
    '烤温和时间不要只看配方数字，先看三个变量：模具厚度、烤箱实际温度、上色速度。',
    '家用烤箱常有偏差，最好预热充分；表面上色太快就略降温或盖锡纸，中心慢就延长时间。',
    '换了模具、份量或风炉/平炉，第一次都要提前观察，后面把稳定版本录入配方。',
  ].join('\n');
}

function answerRecipePreferenceRequest(text: string, recipe: Recipe, recipes: Recipe[]): ChatAction {
  const profile = parsePreferenceProfile(text);
  const stats = ingredientStats(recipe);
  const available = recipes.filter((item) => item.status !== 'referenced');
  const ranked = rankPreferenceRecipes(available, profile).slice(0, 5);
  const lines = [`库里有「${recipe.title}」，但它不是专门按“低糖/控糖”设计的配方。`];

  if (profile.wantsLowGlycemic || profile.wantsModerateSweet) {
    const sugarPercent = stats.sugarRatio ? Math.round(stats.sugarRatio * 100) : null;
    const isBrownie = /brownie|布朗尼/i.test(recipeText(recipe));
    const reductionRange = isBrownie ? '10-20%' : '10-15%';
    lines.push(
      sugarPercent
        ? `这份配方的糖约占总量 ${sugarPercent}%，如果只是想“不那么甜”，建议先把糖小步下调 ${reductionRange}，不要一次砍太多。`
        : `如果只是想“不那么甜”，建议先把糖小步下调 ${reductionRange}，不要一次砍太多。`,
    );
    if (isBrownie) {
      lines.push('本地试做反馈里，主厨广坦风格布朗尼减 10%-20% 糖效果不错；更大的减糖幅度要重新观察表皮亮度、湿润度和苦味平衡。');
    }
    lines.push('糖会影响保湿、上色、表皮和苦甜平衡；尤其是布朗尼，减糖过猛会更干、更苦，表面也可能不亮。');
  }

  if (profile.wantsLowGlycemic || profile.wantsBreakfast) {
    const alternatives = [
      findRecipeByPattern(recipes, /banana nut muffins|香蕉坚果松饼|whole wheat|全麦/),
      findRecipeByPattern(recipes, /breakfast waffles|早餐华夫/),
      findRecipeByPattern(recipes, /banana pancakes|香蕉.*煎饼/),
    ]
      .filter(Boolean)
      .map((item) => item!.title);
    if (alternatives.length) {
      lines.push(`如果目标是早餐或升糖更平缓，我会优先看：${alternatives.join('、')}；布朗尼更适合做小份餐后甜点。`);
    }
  }

  if (profile.wantsLight || profile.avoidsGreasy) {
    lines.push('如果还想降低油腻感，优先控制单份大小，并搭配酸味或水果；不要只靠继续减糖来解决厚重感。');
  }

  lines.push(`我先帮你打开「${recipe.title}」，方便看原始比例；如果试出减糖版本，可以作为本地配方另存。`);
  return {
    type: 'selectRecipe',
    recipe,
    response: lines.join('\n'),
    grounding: buildPreferenceGrounding({
      prompt: text,
      profile,
      openedRecipe: recipe,
      ranked,
      pairing: '',
      caution: buildAvoidList(available, profile),
      focusRecipe: recipe,
    }),
  };
}

function answerCustardPairingQuestion(text: string, recipes: Recipe[]): ChatAction {
  const choux = findRecipeByPattern(recipes, /pate a choux|choux|泡芙/);
  const tart = findRecipeByPattern(recipes, /pate sucree|sucree|甜酥|塔壳/);
  const joconde = findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/);
  const muffin = findRecipeByPattern(recipes, /banana nut muffins|香蕉坚果松饼|whole wheat|全麦/);
  const wantsLowSugar = /低糖|少糖|控糖|升糖|低\s*gi|低GI|不太甜|甜度不高|不要太甜/i.test(text);
  const openedRecipe = choux ?? tart ?? joconde ?? recipes.find((recipe) => recipe.status !== 'referenced') ?? null;
  const suggestions = [
    choux ? `${choux.title}：壳体本身糖很低，和卡仕达是经典搭配；甜度主要由馅控制。` : '',
    tart ? `${tart.title}：适合做水果塔或小塔，卡仕达要薄铺，再用酸味水果压甜。` : '',
    joconde ? `${joconde.title}：适合做轻薄夹层，但卡仕达要少量使用，避免成品发闷。` : '',
  ].filter(Boolean);
  const lines = [
    wantsLowSugar
      ? '卡仕达可以搭低甜方向，但它本身有糖和淀粉，所以更适合“低甜呈现”，不是真正控糖配方。'
      : '卡仕达搭配要先看承托力和湿度，不能只按“早餐/低糖”标签选。',
    suggestions.length ? `我会优先看：${suggestions.join(' ')}` : '',
    muffin ? `不建议把「${muffin.title}」作为卡仕达搭档：松饼本身湿度和密度都高，再加卡仕达容易变湿、发闷，也需要冷藏管理。` : '',
    openedRecipe ? `我先帮你打开「${openedRecipe.title}」，更适合直接看比例和缩放。` : '',
  ].filter(Boolean);

  return openedRecipe ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n') } : { type: 'plain', response: lines.join('\n') };
}

function answerDessertPairingQuestion(text: string, recipes: Recipe[]): ChatAction {
  const normalized = normalizeForSearch(text);
  const wantsBreakfastOrLowSugar = /低糖|少糖|控糖|升糖|早餐|早饭|低\s*gi|低GI|不太甜|甜度不高/i.test(text);
  const wantsFresh = /清爽|酸|水果|夏天|轻盈|不腻|fresh/i.test(text);
  const mentionsGanache = /甘那许|ganache/.test(normalized);
  const mentionsCurd = /柠檬凝乳|lemon\s*curd|curd/.test(normalized);
  const mentionsPraline = /帕林内|praline|pralin|脆底|croustillant/.test(normalized);
  const mentionsBrownie = /布朗尼|brownie/.test(normalized);
  const mentionsMuffin = /松饼|muffin/.test(normalized);

  if (mentionsGanache) {
    const tart = findRecipeByPattern(recipes, /pate sucree|sucree|甜酥|塔壳/);
    const choux = findRecipeByPattern(recipes, /choux|泡芙/);
    const brownie = findRecipeByPattern(recipes, /brownie|布朗尼/);
    const acid = findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/);
    const openedRecipe = wantsBreakfastOrLowSugar ? acid ?? choux ?? tart ?? null : tart ?? choux ?? brownie ?? null;
    const lines = [
      wantsBreakfastOrLowSugar
        ? '甘那许不适合作为低糖早餐主线：巧克力和奶油会把油脂感、甜感和冷藏负担都拉高。'
        : '甘那许适合搭有承托力的结构，别和同样厚重的馅堆得太满。',
      tart ? `更稳的搭法是「${tart.title}」薄层甘那许，配酸味水果或柠檬凝乳来压甜。` : '',
      choux ? `如果想轻一点，可以用「${choux.title}」做壳，甘那许只做薄夹心或装饰。` : '',
      brownie ? `布朗尼配甘那许可行，但会非常浓厚，更像小份餐后甜点。` : '',
      openedRecipe ? `我先帮你打开「${openedRecipe.title}」。` : '',
    ].filter(Boolean);
    return openedRecipe ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n') } : { type: 'plain', response: lines.join('\n') };
  }

  if (mentionsCurd || wantsFresh) {
    const joconde = findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/);
    const dacquoise = findRecipeByPattern(recipes, /dacquoise|达克瓦兹/);
    const tart = findRecipeByPattern(recipes, /pate sucree|sucree|甜酥|塔壳/);
    const choux = findRecipeByPattern(recipes, /choux|泡芙/);
    const openedRecipe = joconde ?? dacquoise ?? tart ?? choux ?? null;
    const lines = [
      '柠檬凝乳适合拿来做“压甜”和提清爽的搭配，尤其适合放在轻薄蛋糕体、塔壳或泡芙里。',
      joconde ? `想做层次清爽，优先看「${joconde.title}」。` : '',
      dacquoise ? `想要坚果香和一点脆感，可以看「${dacquoise.title}」。` : '',
      tart ? `想做小塔，搭「${tart.title}」也合理，但甜酥皮本身不算低糖。` : '',
      openedRecipe ? `我先帮你打开「${openedRecipe.title}」。` : '',
    ].filter(Boolean);
    return openedRecipe ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n') } : { type: 'plain', response: lines.join('\n') };
  }

  if (mentionsPraline) {
    const croustillant = findRecipeByPattern(recipes, /croustillant|脆底/);
    const ganacheMontee = findRecipeByPattern(recipes, /ganache montee|打发.*甘那许/);
    const joconde = findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/);
    const openedRecipe = croustillant ?? ganacheMontee ?? joconde ?? null;
    const lines = [
      wantsBreakfastOrLowSugar
        ? '帕林内和脆底香但不适合走低糖早餐：坚果糖浆和巧克力会让热量、甜感、油脂感都上来。'
        : '帕林内脆底适合做“香、脆、底部结构”，不要把它当清爽主体。',
      croustillant ? `如果需要脆底，直接看「${croustillant.title}」。` : '',
      ganacheMontee ? `上层可以配少量「${ganacheMontee.title}」，但要控制厚度。` : '',
      joconde ? `需要蛋糕体承托时，可以搭「${joconde.title}」。` : '',
      openedRecipe ? `我先帮你打开「${openedRecipe.title}」。` : '',
    ].filter(Boolean);
    return openedRecipe ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n') } : { type: 'plain', response: lines.join('\n') };
  }

  if (mentionsBrownie || mentionsMuffin) {
    const acid = findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/);
    const breakfast = findRecipeByPattern(recipes, /banana nut muffins|香蕉坚果松饼|whole wheat|全麦/);
    const openedRecipe = wantsBreakfastOrLowSugar ? breakfast ?? acid ?? null : acid ?? breakfast ?? null;
    const lines = [
      mentionsBrownie
        ? '布朗尼适合小份浓郁路线，不适合作为低糖或清爽主线；要降甜，先小步减糖并搭酸味。'
        : '松饼适合早餐和低添加糖方向，但不适合再塞湿润奶油馅，否则容易发闷。',
      acid ? `想降低甜腻感，可以搭少量「${acid.title}」这类酸味结构。` : '',
      breakfast ? `如果目标是早餐，优先看「${breakfast.title}」，不要再叠厚重夹心。` : '',
      openedRecipe ? `我先帮你打开「${openedRecipe.title}」。` : '',
    ].filter(Boolean);
    return openedRecipe ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n') } : { type: 'plain', response: lines.join('\n') };
  }

  return recommendByPreference(text, recipes);
}

function extractPanRatio(text: string): { label: string; value: number } | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:寸|吋|inch|in)[^0-9]{0,12}(?:改|换|到|变成|->|→)\s*(\d+(?:\.\d+)?)\s*(?:寸|吋|inch|in)/i);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!from || !to) return null;
  return { label: `${from} 寸圆模改 ${to} 寸圆模`, value: (to * to) / (from * from) };
}

function recommendByPreference(text: string, recipes: Recipe[]): ChatAction {
  const available = recipes.filter((recipe) => recipe.status !== 'referenced');
  const profile = parsePreferenceProfile(text);
  const ranked = rankPreferenceRecipes(available, profile).slice(0, 5);

  if (ranked.length) {
    const openedRecipe = chooseRecipeToOpen(available, profile, ranked);
    const pairing = buildPairingPlan(available, profile);
    const caution = buildAvoidList(available, profile);
    const header = preferenceSummary(profile);
    const grounding = buildPreferenceGrounding({
      prompt: text,
      profile,
      openedRecipe,
      ranked,
      pairing,
      caution,
    });
    const lines = [
      header,
      pairing,
      '我会优先看这几份：',
      ...ranked.map((item, index) => `${index + 1}. ${item.recipe.title}：${item.reasons.slice(0, 2).join('；')}${item.cautions.length ? `。注意：${item.cautions[0]}` : ''}`),
      caution,
      openedRecipe ? `我先帮你打开「${openedRecipe.title}」，方便直接看比例和缩放。` : '',
    ].filter(Boolean);

    return openedRecipe
      ? { type: 'selectRecipe', recipe: openedRecipe, response: lines.join('\n'), grounding }
      : { type: 'plain', response: lines.join('\n'), grounding };
  }

  const featured = available.filter((recipe) => recipe.featured).slice(0, 5);
  return {
    type: 'plain',
    response: [
      `我理解你是在按偏好找配方，不是查某个固定名称。当前可以先从这些常用配方里选：`,
      ...featured.map((recipe) => `- ${recipe.title}`),
      text.includes('配方') ? '也可以补一句用途，比如“做夹心”“做蛋糕体”“适合夏天”。' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

type PreferenceGroundingInput = {
  prompt: string;
  profile: PreferenceProfile;
  openedRecipe: Recipe | null;
  ranked: RecipeScore[];
  pairing: string;
  caution: string;
  focusRecipe?: Recipe | null;
};

function buildPreferenceGrounding(input: PreferenceGroundingInput): string {
  const constraints = buildPreferenceConstraints(input.profile);
  const opened = input.openedRecipe
    ? `最终打开：${input.openedRecipe.title}。原因：${findRankedRecipe(input.ranked, input.openedRecipe)?.reasons.slice(0, 3).join('；') || '本地规则认为更适合直接查看比例'}。`
    : '最终打开：无，保持普通回答。';
  const focus = input.focusRecipe ? `用户点名配方：${formatRecipeStatsLine(input.focusRecipe)}。` : '';
  const candidates = input.ranked.length
    ? input.ranked.map((item, index) => `${index + 1}. ${formatRecipeScoreForAi(item)}`).join('\n')
    : '没有达到阈值的候选，回到常用配方或追问用途。';

  return [
    '规则评分材料，供 AI 组织自然回答；不要把这一段逐字展示给用户。',
    `用户原始需求：${input.prompt}`,
    `意图拆解：${preferenceSummary(input.profile)}`,
    constraints ? `硬约束：${constraints}` : '',
    focus,
    input.pairing ? `组合收敛：${input.pairing}` : '',
    input.caution ? `避开项：${input.caution}` : '',
    opened,
    '候选评分：',
    candidates,
    '回答要求：优先推荐高分候选；若用户点名配方但它不匹配目标，要先说明不匹配点，再给更稳替代；不要编造库外配方、克数或步骤。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPreferenceConstraints(profile: PreferenceProfile): string {
  const rules = [
    profile.wantsBreakfast || profile.wantsLowGlycemic
      ? '早餐/控升糖优先低添加糖、全谷物、坚果或香蕉路线；布朗尼、焦糖、蛋白霜、曲奇、磅蛋糕放后面。'
      : '',
    profile.wantsLight ? '轻盈目标优先低油脂、酸味平衡、打发或薄蛋糕体结构；避开厚甘那许、慕斯林、脆底堆叠。' : '',
    profile.wantsModerateSweet ? '甜度适中优先糖占比不高或有酸度平衡；减糖建议小步试，不要承诺无糖或低 GI。' : '',
    profile.wantsLowButter ? '黄油用量少时，酥饼、甜酥皮、布里欧修、磅蛋糕和焦糖黄油类需要降权。' : '',
    profile.avoidsCream ? '明确不要奶油时，避开淡奶油、打发奶油、甘那许、慕斯林、奶油馅和重卡仕达路线。' : '',
    profile.wantsButterMain ? '黄油为主时要保留黄油香，但仍要检查是否与轻盈/少油目标冲突。' : '',
  ].filter(Boolean);
  return rules.join(' ');
}

function formatRecipeScoreForAi(item: RecipeScore): string {
  const stats = ingredientStats(item.recipe);
  const badges = item.recipe.badges?.length ? `；标签=${item.recipe.badges.join(', ')}` : '';
  const source = item.recipe.source ? `；来源=${item.recipe.source}` : '';
  const reasons = item.reasons.slice(0, 3).join('；');
  const cautions = item.cautions.slice(0, 2).join('；');
  return `${item.recipe.title}：score=${item.score}；${formatStats(stats)}${badges}${source}；适配=${reasons || '部分匹配'}${cautions ? `；风险=${cautions}` : ''}`;
}

function formatRecipeStatsLine(recipe: Recipe): string {
  return `${recipe.title}；${formatStats(ingredientStats(recipe))}${recipe.badges?.length ? `；标签=${recipe.badges.join(', ')}` : ''}`;
}

function formatStats(stats: ReturnType<typeof ingredientStats>): string {
  return [
    `糖=${formatPercent(stats.sugarRatio)}`,
    `油脂=${formatPercent(stats.fatRatio)}`,
    `黄油=${formatPercent(stats.butterRatio)}`,
    `奶油=${formatPercent(stats.creamRatio)}`,
    `酸味=${formatPercent(stats.acidRatio)}`,
    `全谷/坚果/水果=${formatPercent(stats.fiberFriendlyRatio)}`,
  ].join('，');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function findRankedRecipe(ranked: RecipeScore[], recipe: Recipe): RecipeScore | null {
  return ranked.find((item) => item.recipe.id === recipe.id) ?? null;
}

type PreferenceProfile = {
  wantsLight: boolean;
  wantsModerateSweet: boolean;
  wantsFresh: boolean;
  wantsCreamy: boolean;
  wantsButterMain: boolean;
  wantsLowButter: boolean;
  wantsBreakfast: boolean;
  wantsLowGlycemic: boolean;
  wantsLunchDessert: boolean;
  avoidsCream: boolean;
  wantsChocolate: boolean;
  wantsFilling: boolean;
  wantsDessert: boolean;
  avoidsGreasy: boolean;
};

type RecipeScore = {
  recipe: Recipe;
  score: number;
  reasons: string[];
  cautions: string[];
};

function parsePreferenceProfile(text: string): PreferenceProfile {
  const avoidsCream = /不需要奶油|不要奶油|不用奶油|无奶油|别用奶油|不要淡奶油|不加奶油/i.test(text);
  return {
    wantsLight: /不油腻|不腻|清爽|轻盈|少油|低油|淡一点|负担|入口轻|light|fresh/i.test(text),
    wantsModerateSweet: /甜度适中|不太甜|不要太甜|少甜|微甜|中等甜|甜.*适中|moderate\s*sweet/i.test(text),
    wantsFresh: /清爽|水果|果味|柠檬|百香果|酸|夏天|fresh|fruit|lemon/i.test(text),
    wantsCreamy: !avoidsCream && /奶油|乳|顺滑|creamy|cream/i.test(text),
    wantsButterMain: /黄油为主|黄油.*主要|主要.*黄油|黄油.*主料|主料.*黄油|butter.*main/i.test(text),
    wantsLowButter: /黄油.*少|少.*黄油|低黄油|黄油用量少|不用黄油|不要黄油|butter.*less|less.*butter/i.test(text),
    wantsBreakfast: /早餐|早饭|早点|breakfast|morning/i.test(text),
    wantsLowGlycemic: /升糖|血糖|低\s*gi|低GI|控糖|少糖|低糖|慢碳|全麦|燕麦/i.test(text),
    wantsLunchDessert: /午餐|饭后|餐后|lunch|dessert/i.test(text),
    avoidsCream,
    wantsChocolate: /巧克力|黑巧|chocolate|cacao/i.test(text),
    wantsFilling: /夹心|内馅|馅|filling/i.test(text),
    wantsDessert: /甜点|甜品|日常|款|配方|蛋糕|dessert/i.test(text),
    avoidsGreasy: /不油腻|不腻|少油|低油|负担|腻/i.test(text),
  };
}

function rankPreferenceRecipes(recipes: Recipe[], profile: PreferenceProfile): RecipeScore[] {
  return recipes
    .map((recipe) => scoreRecipePreference(recipe, profile))
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score);
}

function scoreRecipePreference(recipe: Recipe, profile: PreferenceProfile): RecipeScore {
  const text = recipeText(recipe);
  const stats = ingredientStats(recipe);
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 0;

  if (profile.avoidsCream) {
    if (/淡奶油|奶油|whipped cream|cream|creme|crème|ganache|甘那许|mousseline|慕斯林|cremeux|奶油馅|卡仕达/.test(text)) {
      score -= 42;
      cautions.push('含奶油或奶油馅路线，不符合“不需要奶油”');
    } else {
      score += 10;
      reasons.push('不走奶油体系');
    }
  }

  if (profile.wantsButterMain) {
    if (stats.butterRatio >= 0.14) {
      score += 26;
      reasons.push('黄油占比明确，能作为主要风味');
    } else if (/黄油|beurre|butter/.test(text)) {
      score += 14;
      reasons.push('含黄油，能保留黄油香');
    } else {
      score -= 14;
      cautions.push('黄油不是主体风味');
    }
    if (/choux|泡芙/.test(text)) {
      score += 22;
      reasons.push('靠水汽膨胀形成轻壳，适合黄油香但不厚重');
    }
    if (/brioche|布里欧修/.test(text)) {
      score += 16;
      reasons.push('黄油香明显，发酵结构比黄油霜轻');
    }
    if (/pate sucree|甜酥|塔壳/.test(text)) {
      score += 10;
      reasons.push('黄油是主要风味，但口感偏酥不偏轻');
      cautions.push('更像塔壳/饼底，轻盈感不如泡芙或发酵面团');
    }
  }

  if (profile.wantsLowButter) {
    if (stats.butterRatio === 0) {
      score += 20;
      reasons.push('没有明显黄油负担');
    } else if (stats.butterRatio <= 0.08) {
      score += 16;
      reasons.push('黄油占比低，适合轻负担甜点');
    } else if (stats.butterRatio <= 0.16) {
      score += 8;
      reasons.push('黄油不算主体，可以控制份量');
    } else {
      score -= 26;
      cautions.push('黄油占比偏高，不符合“黄油用量少”');
    }
    if (/shortbread|酥饼|pound cake|磅蛋糕|brioche|布里欧修|pate sucree|甜酥|caramel beurre|焦糖黄油/.test(text)) {
      score -= 20;
      cautions.push('这类配方主要靠黄油形成风味或结构');
    }
  }

  if (profile.wantsBreakfast) {
    if (/breakfast|早餐|waffle|华夫|pancake|煎饼|muffin|松饼|scone|司康|quickbread|快手/.test(text)) {
      score += 18;
      reasons.push('更像早餐或早午餐场景，制作负担低');
    }
    if (/ganache|甘那许|mousseline|慕斯林|caramel|焦糖|brownie|布朗尼/.test(text)) {
      score -= 14;
      cautions.push('更偏餐后甜点或夹心，不像早餐主选');
    }
  }

  if (profile.wantsLowGlycemic) {
    if (/whole wheat|wholemeal|全麦|oat|燕麦|nut|坚果|banana|香蕉|muffin|松饼/.test(text)) {
      score += 24;
      reasons.push('含全谷物/坚果/香蕉路线，比纯白面粉甜点更适合控升糖');
    }
    if (stats.sugarRatio > 0 && stats.sugarRatio <= 0.08) {
      score += 18;
      reasons.push('添加糖占比低');
    } else if (stats.sugarRatio > 0.18) {
      score -= 18;
      cautions.push('糖占比偏高，不适合低升糖目标');
    }
    if (stats.fiberFriendlyRatio > 0.25) {
      score += 16;
      reasons.push('全麦、坚果或水果比例较高，饱腹感更好');
    }
    if (/pound cake|磅蛋糕|shortbread|酥饼|cookie|曲奇|brownie|布朗尼|meringue|蛋白霜|caramel|焦糖/.test(text)) {
      score -= 24;
      cautions.push('糖/油/精制粉特征更明显，不适合作为低升糖早餐');
    }
  }

  if (profile.wantsLunchDessert) {
    if (/lemon|柠檬|fruit|水果|curd|凝乳|joconde|杏仁蛋糕体|dacquoise|达克瓦兹|meringue|蛋白霜|waffle|华夫|pancake|煎饼/.test(text)) {
      score += 14;
      reasons.push('更适合饭后小份、清爽或轻体量呈现');
    }
    if (/brownie|布朗尼|shortbread|酥饼|pound cake|磅蛋糕|ganache|甘那许|caramel|焦糖/.test(text)) {
      score -= 12;
      cautions.push('午餐后容易显厚重，建议做小份或搭配酸味');
    }
  }

  if (profile.wantsLight) {
    if (/joconde|dacquoise|biscuit|杏仁蛋糕体|达克瓦兹/.test(text)) {
      score += 28;
      reasons.push('主体结构比黄油酱、布朗尼和酥皮更轻');
    }
    if (!profile.avoidsCream && /whipped cream|打发奶油/.test(text)) {
      score += 22;
      reasons.push('靠打发带空气感，口感会轻');
    }
    if (/lemon curd|柠檬凝乳|柠檬/.test(text)) {
      score += 22;
      reasons.push('酸度可以把甜感拉清爽');
    }
    if (/choux|泡芙/.test(text)) {
      score += 16;
      reasons.push('壳体轻，适合搭配清爽夹心');
    }
    if (!profile.avoidsCream && /ganache montee|打发.*甘那许/.test(text)) {
      score += 10;
      reasons.push('打发结构比普通甘那许轻');
      cautions.push('仍然是奶油和巧克力体系，别做太厚');
    }
    if (stats.fatRatio > 0.32) {
      score -= 18;
      cautions.push('油脂占比偏高，容易显厚重');
    }
    if (/brownie|布朗尼|mousseline|慕斯林|pate sucree|甜酥|caramel beurre|焦糖黄油|praline|帕林内|croustillant|脆底/.test(text)) {
      score -= 24;
      cautions.push('结构偏厚重或油脂感更明显');
    }
  }

  if (profile.wantsModerateSweet) {
    if (stats.sugarRatio > 0 && stats.sugarRatio <= 0.22) {
      score += 18;
      reasons.push('糖占比不高，甜度更容易控制');
    } else if (stats.sugarRatio > 0.22 && stats.sugarRatio <= 0.38) {
      score += 8;
      reasons.push('甜度在可调整区间');
    }
    if (stats.acidRatio > 0 || /lemon|柠檬|酸/.test(text)) {
      score += 20;
      reasons.push('酸度能平衡甜感');
    }
    if (/meringue|蛋白霜/.test(text) && stats.sugarRatio > 0.5) {
      score -= 20;
      cautions.push('蛋白霜单独吃会偏甜，更适合作结构辅助');
    }
    if (/caramel|焦糖|praline|帕林内|brownie|布朗尼/.test(text)) {
      score -= 14;
      cautions.push('天然更甜或更厚，适中甜度要靠搭配修正');
    }
  }

  if (profile.wantsFresh) {
    if (/lemon|柠檬|fruit|水果|curd|凝乳/.test(text)) {
      score += 24;
      reasons.push('水果酸度路线更清爽');
    }
    if (/cream|奶油|ganache|甘那许/.test(text) && !/montee|打发/.test(text)) {
      score -= 10;
      cautions.push('纯奶油/甘那许路线清爽度不足');
    }
  }

  if (profile.wantsCreamy && /cream|奶油|creme|crème|卡仕达|慕斯林|凝乳/.test(text)) {
    score += 10;
    reasons.push('能提供柔滑或乳感');
  }

  if (profile.wantsChocolate) {
    if (/chocolate|chocolat|巧克力|cacao|可可/.test(text)) {
      score += 14;
      reasons.push('符合巧克力方向');
    } else {
      score -= 6;
    }
  }

  if (profile.wantsFilling && /curd|凝乳|cream|奶油|ganache|甘那许|cremeux|奶油馅|卡仕达/.test(text)) {
    score += 12;
    reasons.push('可以作为夹心或内馅');
  }

  if (profile.wantsDessert && /joconde|dacquoise|choux|biscuit|蛋糕体|泡芙|达克瓦兹/.test(text)) {
    score += 8;
    reasons.push('适合作为成品甜点主体');
  }

  if (!reasons.length) reasons.push('和当前偏好有部分匹配');
  return { recipe, score, reasons: uniqueReasons(reasons), cautions: uniqueReasons(cautions) };
}

function buildPairingPlan(recipes: Recipe[], profile: PreferenceProfile): string {
  if (
    !(profile.wantsLight || profile.wantsModerateSweet || profile.wantsFresh || profile.wantsLowButter || profile.wantsLunchDessert || profile.wantsBreakfast || profile.wantsLowGlycemic)
  ) {
    return '';
  }

  if (profile.wantsBreakfast || profile.wantsLowGlycemic) {
    const wholeGrain = findRecipeByPattern(recipes, /banana nut muffins|香蕉坚果松饼|whole wheat|全麦/);
    const lightBreakfast = findRecipeByPattern(recipes, /breakfast waffles|早餐华夫/);
    const quick = findRecipeByPattern(recipes, /banana pancakes|香蕉.*煎饼|basic scones|基础司康/);
    const parts = [wholeGrain, lightBreakfast, quick].filter(Boolean).map((recipe) => recipe!.title);
    return parts.length
      ? `早餐控升糖优先看“全谷物/坚果/低添加糖”，再看制作是否省事：${parts.join('、')}。磅蛋糕、酥饼、布朗尼这类糖油更集中，我会先放到后面。`
      : '';
  }

  if (profile.wantsButterMain && profile.avoidsCream) {
    const base =
      findRecipeByPattern(recipes, /choux|泡芙/) ??
      findRecipeByPattern(recipes, /brioche|布里欧修/) ??
      findRecipeByPattern(recipes, /pate sucree|甜酥/);
    const acid = findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/);
    const parts = [base, acid].filter(Boolean).map((recipe) => recipe!.title);
    if (!parts.length) return '';
    return `这个方向别走奶油夹心，优先用黄油香来自带结构的配方：${parts.join(' + ')}。主体负责轻，酸味负责压甜，不靠奶油堆顺滑感。`;
  }

  const base =
    findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/) ??
    findRecipeByPattern(recipes, /dacquoise|达克瓦兹/) ??
    findRecipeByPattern(recipes, /choux|泡芙/);
  const acid = findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/);
  const cream = profile.avoidsCream
    ? null
    : profile.wantsChocolate
      ? findRecipeByPattern(recipes, /ganache montee|打发.*甘那许/) ?? findRecipeByPattern(recipes, /whipped cream|打发奶油/)
      : findRecipeByPattern(recipes, /whipped cream|打发奶油/) ?? findRecipeByPattern(recipes, /ganache montee|打发.*甘那许/);
  const parts = [base, acid, cream].filter(Boolean).map((recipe) => recipe!.title);

  if (!parts.length) return '';
  return profile.avoidsCream
    ? `更像“成品甜点”的做法不是只挑一个高分配方，而是组合：${parts.join(' + ')}。主体负责轻，酸味负责压甜，这次不加奶油。`
    : `更像“成品甜点”的做法不是只挑一个高分配方，而是组合：${parts.join(' + ')}。主体负责轻，酸味负责压甜，少量奶油负责顺滑。`;
}

function buildAvoidList(recipes: Recipe[], profile: PreferenceProfile): string {
  if (!(profile.avoidsGreasy || profile.wantsLight || profile.wantsModerateSweet || profile.wantsLowButter || profile.wantsLunchDessert || profile.wantsLowGlycemic || profile.wantsBreakfast)) return '';
  const avoid = recipes
    .filter((recipe) => {
      const text = recipeText(recipe);
      if (profile.avoidsCream && /淡奶油|奶油|whipped cream|cream|creme|crème|ganache|甘那许|mousseline|慕斯林|cremeux|奶油馅|卡仕达/.test(text)) {
        return true;
      }
      if (profile.wantsLowButter && /shortbread|酥饼|pound cake|磅蛋糕|brioche|布里欧修|pate sucree|甜酥|caramel beurre|焦糖黄油/.test(text)) {
        return true;
      }
      if ((profile.wantsLowGlycemic || profile.wantsBreakfast) && /shortbread|酥饼|pound cake|磅蛋糕|brownie|布朗尼|cookie|曲奇|meringue|蛋白霜|caramel|焦糖/.test(text)) {
        return true;
      }
      return /brownie|布朗尼|mousseline|慕斯林|caramel beurre|焦糖黄油|praline|帕林内|croustillant|脆底/.test(text);
    })
    .slice(0, 4)
    .map((recipe) => recipe.title);
  return avoid.length
    ? `这次我会先避开：${avoid.join('、')}，它们更容易和“轻盈/无奶油”的目标冲突。`
    : '';
}

function chooseRecipeToOpen(recipes: Recipe[], profile: PreferenceProfile, ranked: RecipeScore[]): Recipe | null {
  if (profile.wantsButterMain && profile.avoidsCream && profile.wantsLight) {
    return (
      findRecipeByPattern(recipes, /choux|泡芙/) ??
      findRecipeByPattern(recipes, /brioche|布里欧修/) ??
      findRecipeByPattern(recipes, /pate sucree|甜酥/) ??
      ranked[0]?.recipe ??
      null
    );
  }
  if (profile.wantsLight || profile.wantsModerateSweet) {
    return (
      findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/) ??
      findRecipeByPattern(recipes, /dacquoise|达克瓦兹/) ??
      findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/) ??
      ranked[0]?.recipe ??
      null
    );
  }
  if (profile.wantsBreakfast || profile.wantsLowGlycemic) {
    return (
      findRecipeByPattern(recipes, /banana nut muffins|香蕉坚果松饼|whole wheat|全麦/) ??
      findRecipeByPattern(recipes, /breakfast waffles|早餐华夫/) ??
      findRecipeByPattern(recipes, /banana pancakes|香蕉.*煎饼/) ??
      ranked[0]?.recipe ??
      null
    );
  }
  if (profile.wantsLowButter || profile.wantsLunchDessert) {
    return (
      findRecipeByPattern(recipes, /lemon curd|柠檬凝乳/) ??
      findRecipeByPattern(recipes, /joconde|杏仁蛋糕体/) ??
      findRecipeByPattern(recipes, /dacquoise|达克瓦兹/) ??
      ranked[0]?.recipe ??
      null
    );
  }
  return ranked[0]?.recipe ?? null;
}

function preferenceSummary(profile: PreferenceProfile): string {
  const goals = [
    profile.wantsModerateSweet ? '甜度适中' : '',
    profile.wantsLight ? '口感轻盈' : '',
    profile.wantsFresh ? '带一点清爽感' : '',
    profile.wantsButterMain ? '黄油作为主要风味' : '',
    profile.wantsLowButter ? '黄油用量少' : '',
    profile.wantsBreakfast ? '适合早餐' : '',
    profile.wantsLowGlycemic ? '升糖更平缓' : '',
    profile.wantsLunchDessert ? '适合午餐后小份甜点' : '',
    profile.avoidsCream ? '避开奶油体系' : '',
    profile.wantsCreamy ? '保留乳感' : '',
    profile.wantsChocolate ? '巧克力方向' : '',
  ].filter(Boolean);
  return goals.length
    ? `我会把这个需求拆成：${goals.join('、')}。判断上会优先看糖占比、油脂感、酸度和能不能组合成成品。`
    : '我会按口感目标来选，不只按关键词查配方。';
}

function ingredientStats(recipe: Recipe) {
  let total = 0;
  let sugar = 0;
  let fat = 0;
  let butter = 0;
  let cream = 0;
  let acid = 0;
  let fiberFriendly = 0;

  for (const component of recipe.components) {
    for (const ingredient of component.ingredients) {
      const grams = ingredient.grams ?? 0;
      if (!grams) continue;
      total += grams;
      const name = normalizeForSearch(`${ingredient.name} ${ingredient.originalName ?? ''}`);
      if (/糖|sucre|sugar|glucose|蜂蜜|honey|miel/.test(name)) sugar += grams;
      if (/黄油|油|beurre|butter|huile|oil|奶油|cream|creme|crème|巧克力|chocolate|chocolat|帕林内|praline|pralin/.test(name)) fat += grams;
      if (/黄油|beurre|butter/.test(name)) butter += grams;
      if (/淡奶油|奶油|cream|creme|crème/.test(name)) cream += grams;
      if (/柠檬|lemon|citron|百香果|passion|酸/.test(name)) acid += grams;
      if (/全麦|whole wheat|wholemeal|oat|燕麦|坚果|核桃|杏仁|榛子|nut|walnut|almond|hazelnut|banana|香蕉/.test(name)) {
        fiberFriendly += grams;
      }
    }
  }

  return {
    sugarRatio: total ? sugar / total : 0,
    fatRatio: total ? fat / total : 0,
    butterRatio: total ? butter / total : 0,
    creamRatio: total ? cream / total : 0,
    acidRatio: total ? acid / total : 0,
    fiberFriendlyRatio: total ? fiberFriendly / total : 0,
  };
}

function findRecipeByPattern(recipes: Recipe[], pattern: RegExp): Recipe | null {
  return recipes.find((recipe) => pattern.test(recipeIdentityText(recipe))) ?? null;
}

function recipeText(recipe: Recipe): string {
  return normalizeForSearch(
    [
      recipe.id,
      recipe.title,
      recipe.originalTitle,
      recipe.badges?.join(' '),
      recipe.components.map((component) => [component.name, component.originalName, ...component.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.originalName])].join(' ')).join(' '),
      recipe.raw,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function recipeIdentityText(recipe: Recipe): string {
  return normalizeForSearch(
    [
      recipe.id,
      recipe.title,
      recipe.originalTitle,
      recipe.badges?.join(' '),
      recipe.components.map((component) => [component.name, component.originalName].join(' ')).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function uniqueReasons(values: string[]): string[] {
  return [...new Set(values)];
}

function extractAfterKeywords(text: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    const index = text.indexOf(keyword);
    if (index >= 0) return text.slice(index + keyword.length);
  }
  return null;
}

function cleanupQuery(value: string): string {
  return value
    .replace(/[？?。.!！]/g, '')
    .replace(/缩放到.*|放大到.*|重算.*|计算.*|比例.*|到\s*\d+.*$/g, '')
    .replace(/常规|经典|标准|的配方|配方|recipe|哪些|帮我|把|寻找|搜索|查询|查一下|查|找/g, '')
    .trim();
}

function listRecipeTitles(recipes: Recipe[]): string {
  const names = recipes.slice(0, 10).map((recipe) => recipe.title);
  const suffix = recipes.length > names.length ? ` 等 ${recipes.length} 个` : '';
  return `${names.join('、')}${suffix}` || '暂无配方';
}
