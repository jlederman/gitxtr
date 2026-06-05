namespace Gitxt.Domain;

/// <summary>A single file changed by a commit, with line counts.</summary>
public sealed record FileChange(string Path, string ChangeKind, int Added, int Deleted);

/// <summary>Full detail for one commit: metadata, changed files, and the unified diff.
/// For a merge the diff is taken against one selected parent, or combined against all
/// (git --cc); for an ordinary commit it is against its single parent (or the empty tree
/// for a root commit). <paramref name="ParentShas"/> lists the parents (short SHAs) so the
/// UI can offer a parent selector.</summary>
public sealed record CommitDetail(
    CommitId Id,
    string Author,
    string Email,
    DateTimeOffset WhenUtc,
    string Message,
    IReadOnlyList<FileChange> Files,
    string UnifiedDiff,
    bool DiffTruncated,
    IReadOnlyList<string> ParentShas);
