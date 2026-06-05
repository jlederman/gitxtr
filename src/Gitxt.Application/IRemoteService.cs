namespace Gitxt.Application;

public sealed record RemoteDto(string Name, string Url);

public interface IRemoteService
{
    IReadOnlyList<RemoteDto> GetRemotes(string repoPath);

    /// <summary>Fetch from a single remote, or all remotes when <paramref name="remote"/> is null/empty.</summary>
    string Fetch(string repoPath, string? remote, bool prune);

    /// <summary>Pull the current branch, merging (default) or rebasing.</summary>
    string Pull(string repoPath, string? remote, bool rebase);

    /// <summary>Push <paramref name="branch"/> to <paramref name="remote"/>.</summary>
    string Push(string repoPath, string remote, string branch, bool force, bool setUpstream);
}
