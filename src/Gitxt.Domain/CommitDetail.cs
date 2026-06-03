namespace Gitxt.Domain;

/// <summary>A single file changed by a commit, with line counts.</summary>
public sealed record FileChange(string Path, string ChangeKind, int Added, int Deleted);

/// <summary>Full detail for one commit: metadata, changed files, and the unified diff
/// against its first parent (or the empty tree for a root commit).</summary>
public sealed record CommitDetail(
    CommitId Id,
    string Author,
    string Email,
    DateTimeOffset WhenUtc,
    string Message,
    IReadOnlyList<FileChange> Files,
    string UnifiedDiff,
    bool DiffTruncated);
