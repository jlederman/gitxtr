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

export interface FileHistoryCommit {
    sha: string;
    shortSha: string;
    summary: string;
    author: string;
    whenIso: string;
}

export interface BlameLine {
    lineNumber: number;
    sha: string;
    shortSha: string;
    author: string;
    whenIso: string;
    summary: string;
    content: string;
}

export interface FileBlame {
    path: string;
    lines: BlameLine[];
    truncated: boolean;
}
