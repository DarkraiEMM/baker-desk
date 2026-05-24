export type Ingredient = {
  name: string;
  originalName?: string;
  quantityText: string;
  grams: number | null;
  percent?: number | null;
};

export type Component = {
  name: string;
  originalName?: string;
  ingredients: Ingredient[];
};

export type Recipe = {
  id: string;
  title: string;
  originalTitle?: string;
  source?: string;
  sourceFile: string;
  path: string;
  raw: string;
  components: Component[];
  baseHint?: string;
  featured?: boolean;
  badges?: string[];
  status?: 'available' | 'referenced';
  referencePath?: string;
  referenceNote?: string;
  sourceDocId?: string;
};

export type KnowledgeDoc = {
  id: string;
  title: string;
  source?: string;
  status?: 'active' | 'archive';
  featured?: boolean;
  badges?: string[];
  path: string;
  raw: string;
};

export type ScaleResult = {
  base: Ingredient | null;
  factor: number;
  rows: Array<{
    component: string;
    componentOriginalName?: string;
    ingredient: Ingredient;
    percent: number | null;
    scaled: number | null;
  }>;
};

export type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  kind?: 'plain' | 'table';
};

export type PinItem =
  | {
      id: string;
      type: 'recipe';
      title: string;
      subtitle: string;
      recipeId: string;
    }
  | {
      id: string;
      type: 'technique';
      title: string;
      subtitle: string;
      docId: string;
    }
  | {
      id: string;
      type: 'ingredient';
      title: string;
      subtitle: string;
      note: string;
    };
