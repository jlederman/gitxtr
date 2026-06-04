export interface Edge {
  from: number;
  to: number;
  color: number;
}

export interface Ref {
  name: string;
  kind: string;
}

export interface Row {
  index: number;
  sha: string;
  shortSha: string;
  summary: string;
  author: string;
  whenIso: string;
  column: number;
  color: number;
  edges: Edge[];
  refs: Ref[];
  parents: string[];
}

export interface GraphView {
  rows: Row[];
  width: number;
  truncated: boolean;
  hasUncommittedChanges?: boolean;
}

export interface WorkingTreeFile {
  path: string;
  status: string;
  staged: boolean;
  patch: string;
}

export interface WorkingTreeView {
  staged: WorkingTreeFile[];
  unstaged: WorkingTreeFile[];
  lastCommitMessage: string;
}
