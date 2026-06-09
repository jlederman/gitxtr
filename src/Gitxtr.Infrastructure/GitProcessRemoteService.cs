using Gitxtr.Application;

namespace Gitxtr.Infrastructure;

// Remote operations shell out to the user's git executable (via GitCli — direct process
// invocation, no command shell). This is what makes SSH and the system credential helpers
// work cross-platform; LibGit2Sharp ships without an SSH transport and has no
// credential-helper integration, so it cannot reliably reach real remotes.
public sealed class GitProcessRemoteService : IRemoteService
{
    public IReadOnlyList<RemoteDto> GetRemotes(string repoPath)
    {
        var (code, output) = Run(repoPath, "remote", "-v");
        if (code != 0)
            throw new InvalidOperationException(output.Length > 0 ? output : "git remote failed");

        var remotes = new List<RemoteDto>();
        var seen = new HashSet<string>();
        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            // "origin\thttps://example/repo.git (fetch)"
            var parts = line.Split('\t', ' ');
            if (parts.Length < 2 || !line.Contains("(fetch)")) continue;
            if (seen.Add(parts[0]))
                remotes.Add(new RemoteDto(parts[0], parts[1]));
        }
        return remotes;
    }

    public string Fetch(string repoPath, string? remote, bool prune)
    {
        var args = new List<string> { "fetch" };
        if (prune) args.Add("--prune");
        args.Add(string.IsNullOrEmpty(remote) ? "--all" : remote);
        return Exec(repoPath, args);
    }

    public string Pull(string repoPath, string? remote, bool rebase)
    {
        var args = new List<string> { "pull", rebase ? "--rebase" : "--no-rebase" };
        if (!string.IsNullOrEmpty(remote)) args.Add(remote);
        return Exec(repoPath, args);
    }

    public string Push(string repoPath, string remote, string branch, bool force, bool setUpstream)
    {
        var args = new List<string> { "push" };
        if (force) args.Add("--force-with-lease");
        if (setUpstream) args.Add("--set-upstream");
        args.Add(remote);
        args.Add(branch);
        return Exec(repoPath, args);
    }

    private static string Exec(string repoPath, List<string> args)
    {
        var (code, output) = Run(repoPath, args.ToArray());
        if (code != 0)
            throw new InvalidOperationException(output.Length > 0 ? output : "git exited with a non-zero status");
        return output;
    }

    // Remote ops show git's full chatter (progress/results land on stderr), so combine streams.
    private static (int code, string output) Run(string repoPath, params string[] args)
    {
        var (code, stdout, stderr) = GitCli.Run(repoPath, args);
        return (code, (stdout + stderr).Trim());
    }
}
