using Microsoft.Extensions.Logging;
using Velopack;
using Velopack.Sources;

namespace Gitxtr.Host;

// In-app auto-update against the GitHub Releases feed (vscode/iterm style). The startup hook
// lives in Program.cs (VelopackApp.Build().Run()); this only does the background check.
internal static class Updater
{
    private const string RepoUrl = "https://github.com/jlederman/gitxtr";

    // If a newer release exists, download it and stage it to apply when the app next exits —
    // never restarts mid-session. No-op when the app wasn't installed via Velopack (e.g. a raw
    // `dotnet run` or unpacked build), so it's safe to call unconditionally in production.
    public static async Task CheckInBackgroundAsync(ILogger logger)
    {
        try
        {
            var mgr = new UpdateManager(new GithubSource(RepoUrl, null, prerelease: false));
            if (!mgr.IsInstalled) return;

            var info = await mgr.CheckForUpdatesAsync();
            if (info is null) return;

            logger.LogInformation("Update {Version} available; downloading", info.TargetFullRelease.Version);
            await mgr.DownloadUpdatesAsync(info);
            mgr.WaitExitThenApplyUpdates(info);
            logger.LogInformation("Update {Version} staged; applies on next launch", info.TargetFullRelease.Version);
        }
        catch (Exception ex)
        {
            // Updates are best-effort: a network blip or feed hiccup must never break startup.
            logger.LogWarning(ex, "Update check failed");
        }
    }
}
