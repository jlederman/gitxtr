namespace Gitxt.Domain;

public enum GitRefKind { Head, LocalBranch, RemoteBranch, Tag }

/// <summary>A ref decoration pointing at a commit (branch tip, tag, HEAD).</summary>
public sealed record GitRef(string Name, CommitId Target, GitRefKind Kind);
