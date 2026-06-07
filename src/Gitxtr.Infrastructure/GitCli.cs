using System.Diagnostics;

namespace Gitxtr.Infrastructure;

// Direct invocation of the user's git executable (no command shell). Used for things
// LibGit2Sharp can't do well cross-platform: remote auth (SSH / credential helpers) and
// combined merge diffs (git show --cc). Discovery falls back to well-known install
// locations because GUI apps launched from Finder/Explorer often have a minimal PATH.
internal static class GitCli
{
    private static readonly Lazy<string> ExePath = new(Resolve);

    /// <summary>Run git in <paramref name="repoPath"/>. Returns exit code plus the raw
    /// stdout and stderr (callers combine them as they see fit).</summary>
    public static (int code, string stdout, string stderr) Run(string repoPath, params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = ExePath.Value,
            WorkingDirectory = repoPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Never block on an interactive credential prompt — git fails fast instead.
        // Cached credential helpers and the SSH agent still work.
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException("failed to start git");
        // Read both streams concurrently to avoid a pipe-buffer deadlock.
        var so = p.StandardOutput.ReadToEndAsync();
        var se = p.StandardError.ReadToEndAsync();
        p.WaitForExit();
        return (p.ExitCode, so.Result, se.Result);
    }

    private static string Resolve()
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
