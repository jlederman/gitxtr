using Gitxt.Domain;

namespace Gitxt.Application;

// Serializable DTOs crossing the application boundary (→ JSON for the web UI).
public sealed record EdgeDto(int From, int To, int Color);
public sealed record RefDto(string Name, string Kind);
public sealed record RowDto(
    int Index, string Sha, string ShortSha, string Summary, string Author, string WhenIso,
    int Column, int Color, IReadOnlyList<EdgeDto> Edges, IReadOnlyList<RefDto> Refs);

/// <summary><paramref name="Truncated"/> is true when the result hit the requested limit —
/// surfaced so the UI never silently implies it showed the whole history.</summary>
public sealed record GraphView(IReadOnlyList<RowDto> Rows, int Width, bool Truncated, bool HasUncommittedChanges = false);

public sealed record FileChangeDto(string Path, string Status, int Added, int Deleted);
public sealed record CommitDetailsDto(
    string Sha, string ShortSha, string Author, string Email, string WhenIso, string Message,
    IReadOnlyList<RefDto> Refs, IReadOnlyList<FileChangeDto> Files, string Diff, bool DiffTruncated);

public interface IGraphQueryService
{
    GraphView GetGraph(string repoPath, int? limit = null);
    CommitDetailsDto GetCommitDetails(string repoPath, string sha);
}

public sealed class GraphQueryService(IRepositoryReader reader, GraphLayoutEngine engine)
    : IGraphQueryService
{
    public GraphView GetGraph(string repoPath, int? limit = null)
    {
        var commits = reader.ReadCommits(repoPath, limit);
        var refsByCommit = reader.ReadRefs(repoPath)
            .GroupBy(r => r.Target.Sha)
            .ToDictionary(g => g.Key, g => g.ToList());

        var layout = engine.Layout(commits);

        var rows = layout.Rows.Select(row =>
        {
            refsByCommit.TryGetValue(row.Commit.Id.Sha, out var rs);
            return new RowDto(
                row.Index, row.Commit.Id.Sha, row.Commit.Id.Short, row.Commit.Summary,
                row.Commit.Author, row.Commit.WhenUtc.ToString("o"),
                row.Column, row.ColorId,
                row.EdgesBelow.Select(e => new EdgeDto(e.FromColumn, e.ToColumn, e.ColorId)).ToList(),
                (rs ?? []).Select(r => new RefDto(r.Name, r.Kind.ToString())).ToList());
        }).ToList();

        bool truncated = limit is int n && commits.Count >= n;
        return new GraphView(rows, layout.Width, truncated);
    }

    public CommitDetailsDto GetCommitDetails(string repoPath, string sha)
    {
        var d = reader.ReadCommitDetail(repoPath, new CommitId(sha));
        var refs = reader.ReadRefs(repoPath)
            .Where(r => r.Target.Sha == d.Id.Sha)
            .Select(r => new RefDto(r.Name, r.Kind.ToString()))
            .ToList();

        return new CommitDetailsDto(
            d.Id.Sha, d.Id.Short, d.Author, d.Email, d.WhenUtc.ToString("o"), d.Message,
            refs,
            d.Files.Select(f => new FileChangeDto(f.Path, f.ChangeKind, f.Added, f.Deleted)).ToList(),
            d.UnifiedDiff, d.DiffTruncated);
    }
}
