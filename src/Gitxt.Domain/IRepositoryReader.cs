namespace Gitxt.Domain;

/// <summary>Port for reading a repository's history. Implemented in Infrastructure
/// (the LibGit2Sharp adapter). Commits are returned in display order — newest first,
/// topologically sorted so every commit appears above all of its parents.</summary>
public interface IRepositoryReader
{
    /// <summary>Commits newest-first in topological+date order. When <paramref name="limit"/>
    /// is set, only the most recent N are returned (the caller is expected to surface the cap).</summary>
    IReadOnlyList<Commit> ReadCommits(string repoPath, int? limit = null);

    /// <summary>Branch tips, tags, and HEAD.</summary>
    IReadOnlyList<GitRef> ReadRefs(string repoPath);

    /// <summary>Metadata, changed files, and the unified diff for a single commit. For a merge,
    /// <paramref name="parentIndex"/> selects which parent to diff against; <paramref name="combined"/>
    /// instead produces a combined diff against all parents (git --cc).</summary>
    CommitDetail ReadCommitDetail(string repoPath, CommitId id, int parentIndex = 0, bool combined = false);

    /// <summary>SHAs of commits (newest-first) that touched <paramref name="filePath"/>.</summary>
    IReadOnlyList<string> ReadCommitShasByPath(string repoPath, string filePath);

    /// <summary>Commits (newest-first) that touched <paramref name="filePath"/>, with metadata.</summary>
    IReadOnlyList<Commit> ReadFileHistory(string repoPath, string filePath);

    /// <summary>Line-by-line blame for <paramref name="filePath"/> as of <paramref name="atSha"/>
    /// (or HEAD when null).</summary>
    FileBlame ReadBlame(string repoPath, string filePath, string? atSha = null);

    /// <summary>True if <paramref name="repoPath"/> is a valid git repository.</summary>
    bool IsValid(string repoPath);
}
