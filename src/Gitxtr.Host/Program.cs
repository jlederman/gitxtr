using System.Text.Json;
using Gitxtr.Application;
using Gitxtr.Domain;
using Gitxtr.Host;
using Gitxtr.Host.Messaging;
using Gitxtr.Host.Messaging.Handlers;
using Gitxtr.Infrastructure;
using Microsoft.Extensions.Logging;
using Photino.NET;
using Velopack;

// Velopack hooks (install/update/uninstall) re-launch this exe with special args and exit;
// this MUST run before any other startup work. No-op for a normal, non-Velopack launch.
VelopackApp.Build().Run();

// Route all our log output to stderr so it survives the stdout suppression below.
// Gitxtr.* logs at Debug; everything else (framework, Photino internals) at Warning.
using var loggerFactory = LoggerFactory.Create(b => b
    .AddFilter("Gitxtr", LogLevel.Debug)
    .AddFilter(string.Empty, LogLevel.Warning)
    .AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace));

var reader = new LibGit2SharpRepositoryReader();
var service = new GraphQueryService(reader, new GraphLayoutEngine());
var workingTree = new LibGit2SharpWorkingTreeService();
var branches = new LibGit2SharpBranchService();
var remotes = new GitProcessRemoteService();
var settingsStore = new JsonSettingsStore(loggerFactory.CreateLogger<JsonSettingsStore>());
var gitConfig = new LibGit2SharpGitConfigService(loggerFactory.CreateLogger<LibGit2SharpGitConfigService>());

// Headless dump mode (dev/verification): gitxtr --dump <repoPath> [limit]
if (args is ["--dump", var dumpPath, ..])
{
    int? dumpLimit = args.Length >= 3 && int.TryParse(args[2], out var dn) ? dn : null;
    DumpAscii(service.GetGraph(dumpPath, dumpLimit));
    return 0;
}

// Photino echoes every SendWebMessage to stdout. Our logs use stderr, so stdout can be
// suppressed without losing them. The dump path above needs stdout and already returned.
Console.SetOut(TextWriter.Null);

// ── GUI mode ────────────────────────────────────────────────────────────────
// Pitfall #1: WebKitGTK's DMA-BUF / accelerated compositing renderer often shows a blank
// window under Wayland. Force it off on Linux BEFORE the window initializes.
if (OperatingSystem.IsLinux())
{
    Environment.SetEnvironmentVariable("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    Environment.SetEnvironmentVariable("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
}

// Optional CLI repo arg (dev convenience). If valid, ensure it's in the persisted repo list.
string? cliArg = Array.Find(args, a => !a.StartsWith("--"));
string? cliRepo = !string.IsNullOrEmpty(cliArg) && reader.IsValid(Path.GetFullPath(cliArg))
    ? Path.GetFullPath(cliArg) : null;
if (cliRepo is not null)
{
    var startup = settingsStore.Load();
    if (!startup.Repos.Contains(cliRepo))
        settingsStore.Save(startup with { Repos = startup.Repos.Append(cliRepo).ToArray() });
}
string fallbackRepo = cliRepo ?? "";

var jsonOpts = new JsonSerializerOptions(JsonSerializerDefaults.Web);

// watcher is created before window; the lambda captures `window` which is assigned below.
PhotinoWindow? window = null;
var watcher = new RepoWatcherService(repoPath =>
{
    var w = window;
    if (w is null) return;
    // SendWebMessage must run on the UI thread (WebKit requirement on macOS).
    var msg = JsonSerializer.Serialize(new { type = "repoChanged", repoPath }, jsonOpts);
    w.Invoke(() => w.SendWebMessage(msg));
}, loggerFactory.CreateLogger<RepoWatcherService>());

var dispatcher = new MessageDispatcher(
    new Dictionary<string, IMessageHandler>
    {
        ["loadGraph"] = new LoadGraphHandler(service, fallbackRepo, watcher, workingTree),
        ["getWorkingTree"] = new GetWorkingTreeHandler(workingTree, fallbackRepo),
        ["workingTreeOp"] = new WorkingTreeOpHandler(workingTree, fallbackRepo),
        ["createCommit"] = new CreateCommitHandler(workingTree, fallbackRepo),
        ["getCommitDetails"] = new GetCommitDetailsHandler(service, fallbackRepo),
        ["getCommitsByPath"] = new GetCommitsByPathHandler(reader, fallbackRepo),
        ["getFileHistory"] = new GetFileHistoryHandler(service, fallbackRepo),
        ["getBlame"] = new GetBlameHandler(service, fallbackRepo),
        ["getSettings"] = new GetSettingsHandler(settingsStore, reader, cliRepo),
        ["saveSettings"] = new SaveSettingsHandler(settingsStore),
        ["addRepo"] = new AddRepoHandler(settingsStore, reader),
        ["removeRepo"] = new RemoveRepoHandler(settingsStore),
        ["getGitIdentity"] = new GetGitIdentityHandler(gitConfig, fallbackRepo),
        ["setGitIdentity"] = new SetGitIdentityHandler(gitConfig, fallbackRepo),
        ["commitOp"] = new CommitOpHandler(workingTree, fallbackRepo),
        ["interactiveRebase"] = new InteractiveRebaseHandler(workingTree, fallbackRepo),
        ["branchOp"] = new BranchOpHandler(branches, fallbackRepo),
        ["getBranches"] = new GetBranchesHandler(branches, fallbackRepo),
        ["remoteOp"] = new RemoteOpHandler(remotes, fallbackRepo),
        ["getRemotes"] = new GetRemotesHandler(remotes, fallbackRepo),
    },
    jsonOpts,
    loggerFactory.CreateLogger<MessageDispatcher>());

string indexPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
// Window/taskbar icon (the installed bundle's icon is set separately by Velopack --icon).
// Windows wants a .ico; macOS/Linux take a .png. Both ship next to the exe (see the .csproj).
string iconPath = Path.Combine(
    AppContext.BaseDirectory,
    OperatingSystem.IsWindows() ? "icon.ico" : "icon.png");
// Dev hot-reload: GITXTR_DEV_URL points at the Vite dev server so web edits live-reload.
// Run `npm run dev`, then `GITXTR_DEV_URL=http://localhost:5173 dotnet run --project src/Gitxtr.Host -- <repo>`.
string? devUrl = Environment.GetEnvironmentVariable("GITXTR_DEV_URL");

void RunWindow()
{
    window = new PhotinoWindow()
        .SetTitle("gitxtr")
        .SetIconFile(iconPath)
        .SetUseOsDefaultSize(false)
        .SetSize(1100, 760)
        .Center()
        .RegisterWebMessageReceivedHandler((sender, message) =>
        {
            // Handle off the UI thread: git/network ops would otherwise block the WebKit
            // thread that repaints the webview, freezing the window. The bridge correlates
            // responses by id, so out-of-order replies are fine. SendWebMessage must run on
            // the UI thread, so post the result back via Invoke.
            var w = (PhotinoWindow)sender!;
            Task.Run(() =>
            {
                string response = dispatcher.Dispatch(w, message);
                w.Invoke(() => w.SendWebMessage(response));
            });
        })
        .Load(string.IsNullOrEmpty(devUrl) ? indexPath : devUrl);

    // Check GitHub Releases for a newer build in the background and stage it to apply on next
    // launch (no mid-session restart). Skipped in dev and when not installed via Velopack.
    if (string.IsNullOrEmpty(devUrl))
        _ = Updater.CheckInBackgroundAsync(loggerFactory.CreateLogger("Updater"));

    window.WaitForClose();
}

// Pitfall #2: WebView2 (Windows) must be created and pumped on a single-threaded COM
// apartment (STA). The top-level entry point runs as MTA, where Photino's WebView2 init
// fails silently and the window shows blank (empty user-data folder, no error surfaced).
// Photino captures its owning thread in the PhotinoWindow constructor, so the window must be
// BUILT and closed on the same STA thread. macOS/Linux keep the UI on the process main
// thread (Cocoa/GTK affinity), where COM apartments don't apply and SetApartmentState throws.
if (OperatingSystem.IsWindows())
{
    var uiThread = new Thread(RunWindow);
    uiThread.SetApartmentState(ApartmentState.STA);
    uiThread.Start();
    uiThread.Join();
}
else
    RunWindow();

return 0;

static void DumpAscii(GraphView view)
{
    Console.WriteLine($"width={view.Width} rows={view.Rows.Count} truncated={view.Truncated}");
    foreach (var row in view.Rows)
    {
        var lane = new char[Math.Max(view.Width, row.Column + 1)];
        Array.Fill(lane, ' ');
        foreach (var e in row.Edges)
            if (e.From == e.To && e.From < lane.Length) lane[e.From] = '|';
        lane[row.Column] = '*';

        string refs = row.Refs.Count > 0
            ? " (" + string.Join(", ", row.Refs.Select(r => r.Name)) + ")"
            : "";
        Console.WriteLine($"{new string(lane)}  {row.ShortSha}{refs} {row.Summary}");
    }
}
