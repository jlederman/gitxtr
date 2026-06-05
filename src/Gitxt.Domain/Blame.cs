namespace Gitxt.Domain;

/// <summary>One line of a file annotated with the commit that last touched it.
/// <paramref name="LineNumber"/> is 1-based.</summary>
public sealed record BlameLine(
    int LineNumber, CommitId Commit, string Author, DateTimeOffset WhenUtc, string Summary, string Content);

/// <summary>Line-by-line blame for a file at a given commit. <paramref name="Truncated"/>
/// is true when the file exceeded the line cap and only the first lines are returned.</summary>
public sealed record FileBlame(string Path, IReadOnlyList<BlameLine> Lines, bool Truncated);
