import type { GraphView } from "./types";

// Mirrors the /tmp/gitxtr_demo branch+merge repo so the UI renders in a plain browser
// (npm run dev) without the Photino host.
const MOCK_GRAPH: GraphView = {
    width: 2,
    truncated: false,
    rows: [
        {
            index: 0,
            sha: "49f97bd0",
            shortSha: "49f97bd",
            summary: "M: merge feature",
            author: "tester",
            whenIso: "2026-06-02T19:36:36Z",
            column: 0,
            color: 0,
            edges: [
                { from: 0, to: 0, color: 0 },
                { from: 0, to: 1, color: 1 },
            ],
            refs: [
                { name: "main", kind: "LocalBranch" },
                { name: "HEAD", kind: "Head" },
            ],
        },
        {
            index: 1,
            sha: "6f2bb2a5",
            shortSha: "6f2bb2a",
            summary: "C: main work",
            author: "tester",
            whenIso: "2026-06-02T19:36:36Z",
            column: 0,
            color: 0,
            edges: [
                { from: 0, to: 0, color: 0 },
                { from: 1, to: 1, color: 1 },
            ],
            refs: [],
        },
        {
            index: 2,
            sha: "0f00d158",
            shortSha: "0f00d15",
            summary: "D: feature work",
            author: "tester",
            whenIso: "2026-06-02T19:36:36Z",
            column: 1,
            color: 1,
            edges: [
                { from: 1, to: 0, color: 0 },
                { from: 0, to: 0, color: 0 },
            ],
            refs: [{ name: "feature", kind: "LocalBranch" }],
        },
        {
            index: 3,
            sha: "74a65424",
            shortSha: "74a6542",
            summary: "B: second",
            author: "tester",
            whenIso: "2026-06-02T19:36:36Z",
            column: 0,
            color: 0,
            edges: [{ from: 0, to: 0, color: 0 }],
            refs: [],
        },
        {
            index: 4,
            sha: "0b7d15f3",
            shortSha: "0b7d15f",
            summary: "A: init",
            author: "tester",
            whenIso: "2026-06-02T19:36:36Z",
            column: 0,
            color: 0,
            edges: [],
            refs: [],
        },
    ],
};

export function mockResponse(type: string, payload: Record<string, unknown>): unknown {
    if (type === "loadGraph") return MOCK_GRAPH;
    if (type === "getCommitDetails") {
        const sha = String(payload.sha ?? "0000000");
        const isMerge = sha.startsWith("49f97bd"); // the mock graph's merge commit
        const parent = payload.parent;
        const diff = !isMerge
            ? "diff --git a/f.txt b/f.txt\n@@ -1,2 +1,3 @@\n a\n b\n+feat\n"
            : parent === "combined"
              ? "diff --cc f.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- main\n -feature\n++resolved\n"
              : `diff --git a/f.txt b/f.txt\n@@ -1,1 +1,1 @@\n-${parent === 1 ? "feature" : "main"}\n+resolved\n`;
        return {
            sha,
            shortSha: sha.slice(0, 7),
            author: "tester",
            email: "t@t.c",
            whenIso: "2026-06-02T19:36:36Z",
            message: "D: feature work\n\nMock commit body.",
            refs: [{ name: "feature", kind: "LocalBranch" }],
            files: [{ path: "f.txt", status: "Modified", added: 1, deleted: 0 }],
            diff,
            diffTruncated: false,
            parents: isMerge ? ["6f2bb2a", "0f00d15"] : ["6f2bb2a"],
        };
    }
    if (type === "getSettings")
        return {
            theme: "atom-one-light",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            detailHeight: 320,
            detailTopHeight: 200,
            detailMetaHeight: 120,
            diffView: "unified",
            repos: ["/tmp/gitxtr_demo"],
            lastRepo: null,
            currentRepo: "/tmp/gitxtr_demo",
        };
    if (type === "saveSettings") return {};
    if (type === "addRepo") return { added: "/tmp/gitxtr_demo", repos: ["/tmp/gitxtr_demo"] };
    if (type === "removeRepo") return { repos: [] };
    if (type === "getGitIdentity")
        return {
            globalName: "Mock User",
            globalEmail: "mock@example.com",
            localName: null,
            localEmail: null,
        };
    if (type === "setGitIdentity") return {};
    if (type === "getBranches")
        return [
            { name: "main", isHead: true, upstreamName: "origin/main" },
            { name: "feature", isHead: false, upstreamName: null },
        ];
    if (type === "getRemotes")
        return [{ name: "origin", url: "https://github.com/example/repo.git" }];
    if (type === "remoteOp") return { output: "Already up to date." };
    throw new Error(`no mock for request type '${type}'`);
}
