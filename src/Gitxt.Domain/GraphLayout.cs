namespace Gitxt.Domain;

/// <summary>A downward graph segment within one row: a line from <see cref="FromColumn"/>
/// at this row's vertical center to <see cref="ToColumn"/> at the next row's center.
/// A straight pass-through lane has From==To. A parent/merge connector emanates from the
/// node column. The whole graph is the union of every row's <see cref="GraphRow.EdgesBelow"/>
/// plus the node dots — the renderer draws each edge between consecutive row centers.</summary>
public readonly record struct GraphEdge(int FromColumn, int ToColumn, int ColorId);

/// <summary>One commit row in the laid-out graph.</summary>
public sealed record GraphRow(
    int Index,
    Commit Commit,
    int Column,
    int ColorId,
    IReadOnlyList<GraphEdge> EdgesBelow);

/// <summary>The full laid-out graph. <see cref="Width"/> is the number of lane columns used.</summary>
public sealed record GraphLayout(IReadOnlyList<GraphRow> Rows, int Width);
