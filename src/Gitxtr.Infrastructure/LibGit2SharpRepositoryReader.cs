using Gitxtr.Domain;
using LibGit2Sharp;
using DomainCommit = Gitxtr.Domain.Commit;
using LibCommit = LibGit2Sharp.Commit;

namespace Gitxtr.Infrastructure;

/// <summary>Adapter over LibGit2Sharp. Isolates the libgit2 dependency so the rest of the
/// app speaks only in domain types. Each call opens and disposes its own Repository handle.</summary>
public sealed class LibGit2SharpRepositoryReader : IRepositoryReader
{
    public IReadOnlyList<DomainCommit> ReadCommits(string repoPath, int? limit = null)
    {
        using var repo = new Repository(repoPath);

        // Emulate `git log --all`: walk everything reachable from all branch tips + HEAD,
        // newest first, topologically sorted (every commit above its parents).
        var startPoints = new List<object>();
        foreach (var branch in repo.Branches)
            if (branch.Tip is { } tip) startPoints.Add(tip);
        if (repo.Head?.Tip is { } headTip) startPoints.Add(headTip);
        if (startPoints.Count == 0) return [];

        var filter = new CommitFilter
        {
            IncludeReachableFrom = startPoints,
            SortBy = CommitSortStrategies.Topological | CommitSortStrategies.Time,
        };

        IEnumerable<LibCommit> query = repo.Commits.QueryBy(filter);
        if (limit is int n) query = query.Take(n);
        return query.Select(Map).ToList();
    }

    public IReadOnlyList<GitRef> ReadRefs(string repoPath)
    {
        using var repo = new Repository(repoPath);
        var refs = new List<GitRef>();

        foreach (var branch in repo.Branches)
            if (branch.Tip is { } tip)
                refs.Add(new GitRef(branch.FriendlyName, new CommitId(tip.Sha),
                    branch.IsRemote ? GitRefKind.RemoteBranch : GitRefKind.LocalBranch));

        foreach (var tag in repo.Tags)
            if (tag.PeeledTarget is LibCommit target)
                refs.Add(new GitRef(tag.FriendlyName, new CommitId(target.Sha), GitRefKind.Tag));

        if (repo.Head?.Tip is { } head)
            refs.Add(new GitRef("HEAD", new CommitId(head.Sha), GitRefKind.Head));

        return refs;
    }

    public IReadOnlyList<string> ReadCommitShasByPath(string repoPath, string filePath)
    {
        using var repo = new Repository(repoPath);
        var shaSet = new HashSet<string>();
        foreach (var commit in QueryFileHistory(repo, filePath))
            shaSet.Add(commit.Sha);
        return shaSet.ToList();
    }

    public IReadOnlyList<DomainCommit> ReadFileHistory(string repoPath, string filePath)
    {
        using var repo = new Repository(repoPath);
        var bySha = new Dictionary<string, LibCommit>();
        foreach (var commit in QueryFileHistory(repo, filePath))
            bySha.TryAdd(commit.Sha, commit);

        return bySha.Values
            .OrderByDescending(c => c.Author?.When ?? DateTimeOffset.UnixEpoch)
            .Select(Map)
            .ToList();
    }

    private const int MaxBlameLines = 20_000;

    public FileBlame ReadBlame(string repoPath, string filePath, string? atSha = null)
    {
        using var repo = new Repository(repoPath);

        var start = atSha is { Length: > 0 } s
            ? repo.Lookup<LibCommit>(s) ?? throw new ArgumentException($"commit {s} not found")
            : repo.Head?.Tip ?? throw new InvalidOperationException("no HEAD to blame");

        // Resolve a bare filename to a full repo-relative path within the target commit's tree.
        string path = ResolvePaths(repo, filePath, start.Tree).FirstOrDefault() ?? filePath;

        if (start[path]?.Target is not Blob blob)
            throw new ArgumentException($"{path} not found in commit {start.Sha}");
        if (blob.IsBinary)
            throw new InvalidOperationException($"{path} is binary and cannot be blamed");

        string[] contentLines = blob.GetContentText().Replace("\r\n", "\n").Split('\n');

        var lines = new List<BlameLine>();
        bool truncated = false;
        foreach (var hunk in repo.Blame(path, new BlameOptions { StartingAt = start }))
        {
            var c = hunk.FinalCommit;
            for (int i = 0; i < hunk.LineCount; i++)
            {
                int lineNo = hunk.FinalStartLineNumber + i + 1; // FinalStartLineNumber is 0-based
                if (lines.Count >= MaxBlameLines) { truncated = true; break; }
                string text = lineNo - 1 < contentLines.Length ? contentLines[lineNo - 1] : "";
                lines.Add(new BlameLine(
                    lineNo, new CommitId(c.Sha), c.Author?.Name ?? string.Empty,
                    c.Author?.When ?? DateTimeOffset.UnixEpoch, c.MessageShort ?? string.Empty, text));
            }
            if (truncated) break;
        }

        return new FileBlame(path, lines, truncated);
    }

    /// <summary>Resolves <paramref name="filePath"/> to full repo-relative paths. A bare filename
    /// (no directory separator) is matched against <paramref name="tree"/> (defaulting to HEAD);
    /// anything else is returned as-is.</summary>
    private static IReadOnlyList<string> ResolvePaths(Repository repo, string filePath, Tree? tree = null)
    {
        if (filePath.Contains('/') || filePath.Contains('\\'))
            return [filePath];

        var searchTree = tree ?? repo.Head?.Tip?.Tree;
        var found = searchTree is not null
            ? WalkTree(searchTree, "")
                  .Where(p => Path.GetFileName(p).Equals(filePath, StringComparison.OrdinalIgnoreCase))
                  .ToList()
            : [];
        return found.Count > 0 ? found : [filePath];
    }

    /// <summary>Branch tips and HEAD, deduped by SHA.</summary>
    private static IReadOnlyList<LibCommit> UniqueTips(Repository repo) =>
        repo.Branches
            .Select(b => b.Tip)
            .OfType<LibCommit>()
            .Concat(repo.Head?.Tip is { } h ? [h] : [])
            .GroupBy(c => c.Sha)
            .Select(g => g.First())
            .ToList();

    /// <summary>Commits touching <paramref name="filePath"/>, queried per-tip and unioned.
    /// LibGit2Sharp's FileHistory throws KeyNotFoundException on divergent multi-branch start
    /// points, so each unique tip is queried separately to get full cross-branch coverage.</summary>
    private static IEnumerable<LibCommit> QueryFileHistory(Repository repo, string filePath)
    {
        var paths = ResolvePaths(repo, filePath);
        foreach (var tip in UniqueTips(repo))
        {
            var filter = new CommitFilter
            {
                IncludeReachableFrom = tip,
                SortBy = CommitSortStrategies.Topological | CommitSortStrategies.Time,
            };
            foreach (var path in paths)
                foreach (var entry in repo.Commits.QueryBy(path, filter))
                    yield return entry.Commit;
        }
    }

    private static IEnumerable<string> WalkTree(Tree tree, string prefix)
    {
        foreach (var entry in tree)
        {
            var full = prefix.Length > 0 ? $"{prefix}/{entry.Name}" : entry.Name;
            if (entry.TargetType == TreeEntryTargetType.Tree)
            {
                foreach (var p in WalkTree((Tree)entry.Target, full))
                    yield return p;
            }
            else
            {
                yield return full;
            }
        }
    }

    public bool IsValid(string repoPath) =>
        !string.IsNullOrEmpty(repoPath) && Repository.IsValid(repoPath);

    private const int MaxDiffChars = 200_000;

    public CommitDetail ReadCommitDetail(string repoPath, CommitId id, int parentIndex = 0, bool combined = false)
    {
        using var repo = new Repository(repoPath);
        var commit = repo.Lookup<LibCommit>(id.Sha)
            ?? throw new ArgumentException($"commit {id.Sha} not found");

        var parents = commit.Parents.ToList();
        var parentShas = parents.Select(p => p.Sha[..7]).ToList();

        List<FileChange> files;
        string content;

        if (combined && parents.Count >= 2)
        {
            // LibGit2Sharp can't produce a combined (--cc) diff; shell out to git.
            content = ReadCombinedDiff(repoPath, commit.Sha);
            files = ParseCombinedFiles(content);
        }
        else
        {
            int idx = parentIndex >= 0 && parentIndex < parents.Count ? parentIndex : 0;
            var parentTree = parents.Count > 0 ? parents[idx].Tree : null; // null => root, vs empty tree
            using var patch = repo.Diff.Compare<Patch>(parentTree, commit.Tree);
            files = patch
                .Select(p => new FileChange(p.Path, p.Status.ToString(), p.LinesAdded, p.LinesDeleted))
                .ToList();
            content = patch.Content;
        }

        bool truncated = content.Length > MaxDiffChars;
        if (truncated) content = content[..MaxDiffChars];

        return new CommitDetail(
            new CommitId(commit.Sha),
            commit.Author?.Name ?? string.Empty,
            commit.Author?.Email ?? string.Empty,
            commit.Author?.When ?? DateTimeOffset.UnixEpoch,
            commit.Message ?? string.Empty,
            files,
            content,
            truncated,
            parentShas);
    }

    // Combined merge diff via `git show --cc` (empty --pretty drops the commit header).
    // A conflict-free merge yields an empty combined diff — that's expected, not an error.
    private static string ReadCombinedDiff(string repoPath, string sha)
    {
        var (code, stdout, stderr) = GitCli.Run(
            repoPath, "show", "--cc", "--no-color", "--pretty=format:", sha);
        if (code != 0)
            throw new InvalidOperationException(stderr.Length > 0 ? stderr : "git show --cc failed");
        return stdout.TrimStart('\n');
    }

    // Combined diff headers look like "diff --cc <path>" / "diff --combined <path>".
    // Line counts aren't meaningful for a combined diff, so report them as zero.
    private static List<FileChange> ParseCombinedFiles(string diff)
    {
        var files = new List<FileChange>();
        foreach (var line in diff.Split('\n'))
        {
            if (line.StartsWith("diff --cc ", StringComparison.Ordinal))
                files.Add(new FileChange(line["diff --cc ".Length..], "Modified", 0, 0));
            else if (line.StartsWith("diff --combined ", StringComparison.Ordinal))
                files.Add(new FileChange(line["diff --combined ".Length..], "Modified", 0, 0));
        }
        return files;
    }

    private static DomainCommit Map(LibCommit c) =>
        new(new CommitId(c.Sha),
            c.Parents.Select(p => new CommitId(p.Sha)).ToArray(),
            c.MessageShort ?? string.Empty,
            c.Author?.Name ?? string.Empty,
            c.Author?.When ?? DateTimeOffset.UnixEpoch);
}
