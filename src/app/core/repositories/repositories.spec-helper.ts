import { Case, Instance, Label, Master, Project } from '../db/schema';

const TIMESTAMP = '2026-08-31T12:00:00.000Z';

export function makeProject(id: string, name = `project-${id}`): Project {
  return { id, name, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

export function makeCase(id: string, projectId: string, order = 0): Case {
  return { id, projectId, name: `case-${id}`, order, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

export function makeMaster(id: string, projectId: string, name = `master-${id}`): Master {
  return { id, projectId, name, tagIds: [], createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

/** カテゴリ / タグはどちらも同じ形なので 1 つのヘルパーで作る */
export function makeLabel(id: string, projectId: string, name = `label-${id}`, order = 0): Label {
  return { id, projectId, name, order, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

export function makeInstance(
  id: string,
  projectId: string,
  caseId: string,
  masterId: string,
  qty = 1,
): Instance {
  return {
    id,
    projectId,
    caseId,
    masterId,
    qty,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}
