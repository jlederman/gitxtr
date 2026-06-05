using System.Diagnostics;
using Gitxt.Application;

namespace Gitxt.Infrastructure;

// Remote operations shell out to the user's git executable (via direct process
// invocation — no command shell). This is what makes SSH and the system credential
// helpers work cross-platform; LibGit2Sharp ships without an SSH transport and has no
// credential-helper integration, so it cannot reliably reach real remotes.
public sealed class GitProcessRemoteService : IRemoteService
{
    // Resolved once. Process.Start searches PATH for a bare "git", but GUI apps launched
    // from Finder/Explorer often have a minimal PATH that omits Homebrew/Git-for-Windows,
    // so fall back to well-known install locations.
    private static readonly Lazy<string> GitPath = new(ResolveGit);

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

    private static (int code, string output) Run(string repoPath, params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = GitPath.Value,
            WorkingDirectory = repoPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Never block on an interactive credential prompt — git fails fast instead, and we
        // surface the error. Cached credential helpers and the SSH agent still work.
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException("failed to start git");
        // Read both streams concurrently to avoid a pipe-buffer deadlock.
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        p.WaitForExit();
        string combined = (stdout.Result + stderr.Result).Trim();
        return (p.ExitCode, combined);
    }

    private static string ResolveGit()
    {
        string[] candidates = OperatingSystem.IsWindows()
            ? ["git.exe", @"C:\Program Files\Git\cmd\git.exe", @"C:\Program Files (x86)\Git\cmd\git.exe"]
            : ["git", "/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

        foreach (var c in candidates)
            if (CanRun(c)) return c;

        throw new InvalidOperationException(
            "git executable not found. Install Git and make sure it is on your PATH.");
    }

    private static bool CanRun(string git)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo
            {
                FileName = git,
                Arguments = "--version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            if (p is null) return false;
            p.WaitForExit();
            return p.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }
}
