using System.Text;
using Microsoft.Extensions.Logging;

namespace Gitxtr.Host;

/// <summary>
/// Keeps the graph in sync with disk via two complementary mechanisms:
///   1. FileSystemWatcher on .git/ — fires fast (~300 ms) when FSEvents cooperates.
///   2. Polling every 2 s — reads a lightweight "state signature" from a handful of
///      .git files (no Repository open) and fires if anything changed. Catches the
///      cases where macOS FSEvents coalesces or drops events during atomic git writes.
/// All callbacks arrive on thread-pool threads; Interlocked.Exchange makes the debounce
/// race-free across concurrent events from both sources.
/// </summary>
internal sealed class RepoWatcherService(Action<string> onChanged, ILogger<RepoWatcherService> logger) : IDisposable
{
    private FileSystemWatcher? _watcher;
    private Timer? _debounce;
    private Timer? _pollTimer;
    private string? _repoPath;
    private string _lastState = "";

    public void Watch(string repoPath)
    {
        if (repoPath == _repoPath) return;
        _repoPath = repoPath;

        _watcher?.Dispose();
        _watcher = null;
        _pollTimer?.Dispose();
        _pollTimer = null;

        var gitDir = Path.Combine(repoPath, ".git");
        if (!Directory.Exists(gitDir)) return;

        _lastState = GitState(gitDir);

        // ── FSEvents watcher ────────────────────────────────────────────────
        _watcher = new FileSystemWatcher(gitDir)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName,
            IncludeSubdirectories = true,
            EnableRaisingEvents = true,
        };
        _watcher.Changed += (_, _) => Debounce(repoPath);
        _watcher.Created += (_, _) => Debounce(repoPath);
        _watcher.Deleted += (_, _) => Debounce(repoPath);
        _watcher.Renamed += (_, _) => Debounce(repoPath);

        // ── Polling fallback ─────────────────────────────────────────────────
        _pollTimer = new Timer(_ => Poll(repoPath, gitDir), null,
            dueTime: TimeSpan.FromSeconds(2),
            period:  TimeSpan.FromSeconds(2));
    }

    private void Poll(string repoPath, string gitDir)
    {
        var state = GitState(gitDir);
        if (state == _lastState) return;
        _lastState = state;
        Debounce(repoPath);
    }

    /// <summary>
    /// Cheap state fingerprint: reads HEAD, the current branch tip SHA, the stash ref,
    /// and the packed-refs mtime. No Repository handle opened.
    /// </summary>
    private string GitState(string gitDir)
    {
        try
        {
            var sb = new StringBuilder();

            var headPath = Path.Combine(gitDir, "HEAD");
            if (!File.Exists(headPath)) return "";
            var head = File.ReadAllText(headPath).Trim();
            sb.Append(head);

            if (head.StartsWith("ref: ", StringComparison.Ordinal))
            {
                var refRel = head[5..].Replace('/', Path.DirectorySeparatorChar);
                var refFile = Path.Combine(gitDir, refRel);
                if (File.Exists(refFile))
                    sb.Append(File.ReadAllText(refFile).Trim());
            }

            var stash = Path.Combine(gitDir, "refs", "stash");
            if (File.Exists(stash))
                sb.Append(File.ReadAllText(stash).Trim());

            var packed = Path.Combine(gitDir, "packed-refs");
            if (File.Exists(packed))
                sb.Append(File.GetLastWriteTimeUtc(packed).Ticks);

            return sb.ToString();
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Failed to read git state from {GitDir}", gitDir);
            return "";
        }
    }

    private void Debounce(string repoPath)
    {
        Interlocked.Exchange(ref _debounce,
            new Timer(_ =>
            {
                // Sync the poll baseline so a reliable watcher (Windows/Linux) doesn't
                // cause the poller to fire a redundant reload 2 s later.
                var gitDir = Path.Combine(repoPath, ".git");
                _lastState = GitState(gitDir);
                onChanged(repoPath);
            }, null, 300, Timeout.Infinite))?.Dispose();
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref _debounce, null)?.Dispose();
        _pollTimer?.Dispose();
        _watcher?.Dispose();
    }
}
