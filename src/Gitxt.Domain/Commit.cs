namespace Gitxt.Domain;

/// <summary>A commit in the revision DAG. Parents are ordered: index 0 is the
/// first parent (mainline); indices 1+ are merge parents.</summary>
public sealed record Commit(
    CommitId Id,
    IReadOnlyList<CommitId> Parents,
    string Summary,
    string Author,
    DateTimeOffset WhenUtc);
