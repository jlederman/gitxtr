using Gitxt.Domain;
using LibGit2Sharp;
using DomainCommit = Gitxt.Domain.Commit;
using LibCommit = LibGit2Sharp.Commit;

namespace Gitxt.Infrastructure;

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
        var startPoints = repo.Branches
            .Select(b => b.Tip)
            .OfType<LibCommit>()
            .Concat(repo.Head?.Tip is { } h ? [h] : [])
            .ToList<object>();
        if (startPoints.Count == 0) return [];

        var filter = new CommitFilter
        {
            IncludeReachableFrom = startPoints,
            SortBy = CommitSortStrategies.Topological | CommitSortStrategies.Time,
        };

        // If the query is a bare filename (no directory separator), resolve it to full
        // repo-relative paths by walking the HEAD tree so QueryBy finds the right history.
        IEnumerable<string> pathsToSearch;
        if (!filePath.Contains('/') && !filePath.Contains('\\'))
        {
            var headTree = repo.Head?.Tip?.Tree;
            var found = headTree is not null
                ? WalkTree(headTree, "")
                      .Where(p => Path.GetFileName(p).Equals(filePath, StringComparison.OrdinalIgnoreCase))
                      .ToList()
                : [];
            pathsToSearch = found.Count > 0 ? found : [filePath];
        }
        else
        {
            pathsToSearch = [filePath];
        }

        var shaSet = new HashSet<string>();
        foreach (var path in pathsToSearch)
            foreach (var entry in repo.Commits.QueryBy(path, filter))
                shaSet.Add(entry.Commit.Sha);

        return shaSet.ToList();
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

    public CommitDetail ReadCommitDetail(string repoPath, CommitId id)
    {
        using var repo = new Repository(repoPath);
        var commit = repo.Lookup<LibCommit>(id.Sha)
            ?? throw new ArgumentException($"commit {id.Sha} not found");

        var parentTree = commit.Parents.FirstOrDefault()?.Tree; // null => root, diffs vs empty tree
        using var patch = repo.Diff.Compare<Patch>(parentTree, commit.Tree);

        var files = patch
            .Select(p => new FileChange(p.Path, p.Status.ToString(), p.LinesAdded, p.LinesDeleted))
            .ToList();

        string content = patch.Content;
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
            truncated);
    }

    private static DomainCommit Map(LibCommit c) =>
        new(new CommitId(c.Sha),
            c.Parents.Select(p => new CommitId(p.Sha)).ToArray(),
            c.MessageShort ?? string.Empty,
            c.Author?.Name ?? string.Empty,
            c.Author?.When ?? DateTimeOffset.UnixEpoch);
}
