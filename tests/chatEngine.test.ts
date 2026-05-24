import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKnowledgeMarkdown, parseRecipeMarkdown } from '../src/bakerCore';
import { handleRuleChat, type ChatAction } from '../src/chatEngine';
import { knowledgeFiles, recipeFiles } from '../src/dataManifest';
import type { KnowledgeDoc, Recipe } from '../src/types';

function loadRecipes(): Recipe[] {
  return recipeFiles.map((file) => {
    const raw = readFileSync(join(process.cwd(), 'public', file.path.replace(/^\//, '')), 'utf8');
    return parseRecipeMarkdown(file.id, file.path, raw);
  });
}

function loadDocs(): KnowledgeDoc[] {
  return knowledgeFiles.map((file) => {
    const raw = readFileSync(join(process.cwd(), 'public', file.path.replace(/^\//, '')), 'utf8');
    return parseKnowledgeMarkdown(file.id, file.path, raw);
  });
}

const recipes = loadRecipes();
const docs = loadDocs();

function fullText(action: ChatAction): string {
  const selectedTitle = action.type === 'selectRecipe' ? action.recipe.title : action.type === 'showKnowledge' ? action.doc.title : '';
  return `${selectedTitle}\n${action.response}`;
}

describe('Baker Desk chat intent coverage', () => {
  it.each([
    ['查一下 brownie', /BROWNIE|布朗尼/i],
    ['帮我把 brioche 缩放到 500g 面粉', /500\.0g|500g|BRIOCHE|布里欧修/i],
    ['哪些配方用到了 beurre', /BRIOCHE|黄油|beurre|SHORTBREAD|司康/i],
    ['甘那许比例是多少', /Ganache|甘那许|巧克力|奶油/i],
    ['8寸圆模改6寸怎么换算', /面积倍率|0\.56|模具/i],
    ['蛋糕中间湿没熟怎么办', /夹生|没熟|继续烤|模具/i],
    ['热风炉要降温吗', /热风|风炉|15-20°C|提前检查/i],
    ['黄油可以换植物油吗', /黄油|植物油|不.*等价|结构/i],
    ['适合早餐升糖比较慢的烘焙产品', /香蕉坚果松饼|早餐华夫|全谷物|低添加糖/i],
    ['可以融合坚果的配方', /坚果|核桃|杏仁|帕林内|松饼/i],
    ['布朗尼减糖配方', /经典布朗尼|低糖|减糖|10-15%|香蕉坚果松饼/i],
    ['需要一个黄油用量少，适合午餐甜点的配方', /黄油用量少|午餐|柠檬|达克瓦兹|轻负担/i],
    ['想要一款甜度适中口感轻盈的配方', /甜度适中|口感轻盈|杏仁蛋糕体|达克瓦兹|柠檬/i],
    ['卡仕达酱配合什么低糖烘焙配方呢', /泡芙|甜酥|卡仕达|不建议.*香蕉坚果松饼|湿度/i],
    ['甘那许适合做低糖早餐吗', /甘那许不适合|低糖早餐|油脂感|甜感/i],
    ['柠檬凝乳配什么蛋糕体', /柠檬凝乳|杏仁蛋糕体|达克瓦兹|清爽/i],
    ['帕林内脆底能和什么组合', /帕林内|脆底|打发.*甘那许|蛋糕体/i],
    ['泡芙面糊的鸡蛋量为什么不是固定的？应该怎么判断加够了？', /泡芙|Pâte à Choux|鸡蛋|状态/i],
    ['我用百香果泥做慕斯，直接按正常用量加吉利丁，应该没问题吧？', /慕斯|百香果|吉利丁|酸|凝固/i],
    ['白巧克力甘那许 1:1 太软了，要加更多奶油吗？', /Ganache|甘那许|巧克力|奶油/i],
    ['Dacquoise 和 Biscuit Joconde 可以互换用吗？', /Joconde|Dacquoise|杏仁蛋糕体|互换/i],
    ['一个配方需要 6g 吉利丁，能直接换成 6g 琼脂吗？', /吉利丁|琼脂|不能.*等量|凝胶/i],
  ])('handles "%s"', (prompt, expected) => {
    expect(fullText(handleRuleChat(prompt, recipes, docs))).toMatch(expected);
  });

  it('does not fall back to generic capability text for common baking questions', () => {
    const prompts = [
      '可以融合坚果的配方',
      '适合早餐的配方',
      '蛋糕为什么塌陷',
      '没有淡奶油可以换什么',
      '甘那许太软怎么办',
      '卡仕达酱配合什么低糖烘焙配方呢',
      '甘那许适合做低糖早餐吗',
      '柠檬凝乳配什么蛋糕体',
      '泡芙面糊的鸡蛋量为什么不是固定的？应该怎么判断加够了？',
      '一个配方需要 6g 吉利丁，能直接换成 6g 琼脂吗？',
    ];

    for (const prompt of prompts) {
      expect(handleRuleChat(prompt, recipes, docs).response).not.toContain('我可以处理：查配方');
    }
  });
});
