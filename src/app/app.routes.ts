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
    title: '記録一覧 | Tallia',
    loadComponent: () =>
      import('./features/case-overview/case-overview').then((m) => m.CaseOverview),
  },
  {
    path: 'projects/:projectId/cases',
    title: 'ケースマスタ | Tallia',
    loadComponent: () => import('./features/case-list/case-list').then((m) => m.CaseList),
  },
  {
    path: 'projects/:projectId/cases/:caseId',
    title: 'ケース詳細 | Tallia',
    loadComponent: () => import('./features/case-detail/case-detail').then((m) => m.CaseDetail),
  },
  {
    path: 'projects/:projectId/masters',
    title: 'オブジェクトマスタ | Tallia',
    loadComponent: () => import('./features/master-list/master-list').then((m) => m.MasterList),
  },
  // 存在しないパスは一覧へ戻す
  { path: '**', redirectTo: '' },
];
