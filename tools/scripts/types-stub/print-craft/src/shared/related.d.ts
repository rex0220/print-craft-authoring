// 中核の型（dist/types/）を作るときだけ使う代わりの型（load.d.ts と同じ考え）。印刷屋 Ver.8 の関連レコード一覧（src/shared/related.ts）
export type RelatedChildren = string[] | "all";
export type RelatedSource = any;
export type RelatedDefs = Record<string, any>;
