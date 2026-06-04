using System.Text.Json;
using Gitxt.Application;
using Gitxt.Domain;
using Gitxt.Host.Messaging;
using Gitxt.Host.Messaging.Handlers;
using Gitxt.Infrastructure;
using Photino.NET;

var reader       = new LibGit2SharpRepositoryReader();
var service      = new GraphQueryService(reader, new GraphLayoutEngine());
var settingsStore = new JsonSettingsStore();
var gitConfig    = new LibGit2SharpGitConfigService();

// Headless dump mode (dev/verification): gitxt --dump <repoPath> [limit]
if (args is ["--dump", var dumpPath, ..])
{
    int? dumpLimit = args.Length >= 3 && int.TryParse(args[2], out var dn) ? dn : null;
    DumpAscii(service.GetGraph(dumpPath, dumpLimit));
    return 0;
}

// ── GUI mode ────────────────────────────────────────────────────────────────
// Pitfall #1: WebKitGTK's DMA-BUF / accelerated compositing renderer often shows a blank
// window under Wayland. Force it off on Linux BEFORE the window initializes.
if (OperatingSystem.IsLinux())
{
    Environment.SetEnvironmentVariable("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    Environment.SetEnvironmentVariable("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
}

// Optional CLI repo arg (dev convenience). If valid, ensure it's in the persisted repo list.
string? cliArg  = Array.Find(args, a => !a.StartsWith("--"));
string? cliRepo = !string.IsNullOrEmpty(cliArg) && reader.IsValid(Path.GetFullPath(cliArg))
    ? Path.GetFullPath(cliArg) : null;
if (cliRepo is not null)
{
    var startup = settingsStore.Load();
    if (!startup.Repos.Contains(cliRepo))
        settingsStore.Save(startup with { Repos = startup.Repos.Append(cliRepo).ToArray() });
}
string fallbackRepo = cliRepo ?? "";

var jsonOpts   = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var dispatcher = new MessageDispatcher(
    new Dictionary<string, IMessageHandler>
    {
        ["loadGraph"]        = new LoadGraphHandler(service, fallbackRepo),
        ["getCommitDetails"] = new GetCommitDetailsHandler(service, fallbackRepo),
        ["getSettings"]      = new GetSettingsHandler(settingsStore, reader, cliRepo),
        ["saveSettings"]     = new SaveSettingsHandler(settingsStore),
        ["addRepo"]          = new AddRepoHandler(settingsStore, reader),
        ["removeRepo"]       = new RemoveRepoHandler(settingsStore),
        ["getGitIdentity"]   = new GetGitIdentityHandler(gitConfig, fallbackRepo),
        ["setGitIdentity"]   = new SetGitIdentityHandler(gitConfig, fallbackRepo),
    },
    jsonOpts);

string indexPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
// Dev hot-reload: GITXT_DEV_URL points at the Vite dev server so web edits live-reload.
// Run `npm run dev`, then `GITXT_DEV_URL=http://localhost:5173 dotnet run --project src/Gitxt.Host -- <repo>`.
string? devUrl = Environment.GetEnvironmentVariable("GITXT_DEV_URL");

var window = new PhotinoWindow()
    .SetTitle("gitxt")
    .SetUseOsDefaultSize(false)
    .SetSize(1100, 760)
    .Center()
    .RegisterWebMessageReceivedHandler((sender, message) =>
    {
        var w = (PhotinoWindow)sender!;
        w.SendWebMessage(dispatcher.Dispatch(w, message));
    })
    .Load(string.IsNullOrEmpty(devUrl) ? indexPath : devUrl);

window.WaitForClose();
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
