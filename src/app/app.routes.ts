import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'プロジェクト一覧 | Tallia',
    loadComponent: () => import('./features/project-list/project-list').then((m) => m.ProjectList),
  },
  {
    path: 'settings',
    title: '設定 | Tallia',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  {
    // プロジェクトを選ぶと、まずこのメニューに入る
    path: 'projects/:projectId',
    title: 'メニュー | Tallia',
    loadComponent: () => import('./features/project-menu/project-menu').then((m) => m.ProjectMenu),
  },
  {
    path: 'projects/:projectId/overview',
    title: 'レコードリスト | Tallia',
    loadComponent: () =>
      import('./features/case-overview/case-overview').then((m) => m.CaseOverview),
  },
  {
    path: 'projects/:projectId/cases',
    title: 'ケースマスタ | Tallia',
    loadComponent: () => import('./features/case-list/case-list').then((m) => m.CaseList),
  },
  {
    path: 'projects/:projectId/categories',
    title: 'カテゴリマスタ | Tallia',
    // 画面は共通で、`kind` だけを変えて使い分ける（withComponentInputBinding で input に届く）
    data: { kind: 'category' },
    loadComponent: () => import('./features/label-list/label-list').then((m) => m.LabelList),
  },
  {
    path: 'projects/:projectId/tags',
    title: 'タグマスタ | Tallia',
    data: { kind: 'tag' },
    loadComponent: () => import('./features/label-list/label-list').then((m) => m.LabelList),
  },
  {
    path: 'projects/:projectId/masters',
    title: 'オブジェクトマスタ | Tallia',
    loadComponent: () => import('./features/master-list/master-list').then((m) => m.MasterList),
  },
  // 存在しないパスは一覧へ戻す
  { path: '**', redirectTo: '' },
];
