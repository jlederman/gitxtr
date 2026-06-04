namespace Gitxt.Host;

/// <summary>Watches a repo's .git directory for changes (commits, refs, index) and fires
/// a debounced callback so the UI can reload the graph. All FSEvent callbacks arrive on
/// thread-pool threads; Interlocked.Exchange makes the debounce race-free.</summary>
internal sealed class RepoWatcherService(Action<string> onChanged) : IDisposable
{
    private FileSystemWatcher? _watcher;
    private Timer? _debounce;
    private string? _repoPath;

    public void Watch(string repoPath)
    {
        if (repoPath == _repoPath) return;
        _repoPath = repoPath;
        _watcher?.Dispose();
        _watcher = null;

        var gitDir = Path.Combine(repoPath, ".git");
        if (!Directory.Exists(gitDir)) return;

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
    }

    private void Debounce(string repoPath)
    {
        // Atomically replace the pending timer; dispose the old one so only the latest fires.
        Interlocked.Exchange(ref _debounce,
            new Timer(_ => onChanged(repoPath), null, 500, Timeout.Infinite))?.Dispose();
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref _debounce, null)?.Dispose();
        _watcher?.Dispose();
    }
}
