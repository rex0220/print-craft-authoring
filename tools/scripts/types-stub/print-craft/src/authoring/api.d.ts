// 中核の型（dist/types/）を作るときだけ使う代わりの型。印刷屋の authoring API の型は印刷屋のリポジトリにあり、npm には出さない。
// 公開の型では any とする（中核を使う側は engine.api を直接使わず、中核の関数に渡すだけ）。tools の開発中の型の検査は本物の型で行う（tsconfig.json）
export type PrintCraftAuthoringApi = any;
