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
}

export interface GraphView {
  rows: Row[];
  width: number;
  truncated: boolean;
}
