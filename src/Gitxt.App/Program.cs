using System.Text.Json;
using Gitxt.Application;
using Gitxt.Domain;
using Gitxt.Infrastructure;
using Photino.NET;

var reader = new LibGit2SharpRepositoryReader();
var service = new GraphQueryService(reader, new GraphLayoutEngine());
var settingsStore = new JsonSettingsStore();
var gitConfig = new LibGit2SharpGitConfigService();

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
string indexPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
// Dev hot-reload: when GITXT_DEV_URL is set (the Vite dev server), load that instead of the built
// bundle so editing web/ live-reloads via Vite HMR. Run `npm run dev`, then
// `GITXT_DEV_URL=http://localhost:5173 dotnet run --project src/Gitxt.App -- <repo>`.
string? devUrl = Environment.GetEnvironmentVariable("GITXT_DEV_URL");

var window = new PhotinoWindow()
    .SetTitle("gitxt")
    .SetUseOsDefaultSize(false)
    .SetSize(1100, 760)
    .Center()
    .RegisterWebMessageReceivedHandler((sender, message) =>
    {
        // Runs on the UI thread; answered synchronously. The folder picker (addRepo) uses
        // Photino's synchronous ShowOpenFolder, which is safe to call from here.
        var w = (PhotinoWindow)sender!;
        w.SendWebMessage(Handle(w, message));
    })
    .Load(string.IsNullOrEmpty(devUrl) ? indexPath : devUrl);

window.WaitForClose();
return 0;

string Handle(PhotinoWindow w, string message)
{
    string id = "";
    try
    {
        using var doc = JsonDocument.Parse(message);
        var root = doc.RootElement;
        id = root.GetProperty("id").GetString() ?? "";
        string type = root.GetProperty("type").GetString() ?? "";

        switch (type)
        {
            case "loadGraph":
            {
                string path = root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } rp
                    ? rp : fallbackRepo;
                int? limit = root.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number
                    ? l.GetInt32() : 2000;
                if (string.IsNullOrEmpty(path))
                    return JsonSerializer.Serialize(new { id, ok = false, error = "no repository selected" }, jsonOpts);
                return JsonSerializer.Serialize(new { id, ok = true, data = service.GetGraph(path, limit) }, jsonOpts);
            }

            case "getCommitDetails":
            {
                string sha = root.GetProperty("sha").GetString() ?? "";
                string repo = root.TryGetProperty("repoPath", out var cdp) && cdp.GetString() is { Length: > 0 } cds ? cds : fallbackRepo;
                return JsonSerializer.Serialize(new { id, ok = true, data = service.GetCommitDetails(repo, sha) }, jsonOpts);
            }

            case "getSettings":
            {
                var st = settingsStore.Load();
                string? currentRepo = cliRepo
                    ?? (!string.IsNullOrEmpty(st.LastRepo) && reader.IsValid(st.LastRepo!) ? st.LastRepo : null)
                    ?? st.Repos.FirstOrDefault(reader.IsValid);
                return JsonSerializer.Serialize(new { id, ok = true, data = new {
                    st.Theme, st.FontFamily, st.FontSize, st.DetailHeight, st.DetailTopHeight, st.DetailMetaHeight, st.Repos, st.LastRepo, currentRepo
                } }, jsonOpts);
            }

            case "saveSettings":
            {
                var se = root.GetProperty("settings");
                var cur = settingsStore.Load();
                var updated = cur with
                {
                    Theme = se.TryGetProperty("theme", out var th) && th.ValueKind == JsonValueKind.String ? th.GetString()! : cur.Theme,
                    FontFamily = se.TryGetProperty("fontFamily", out var ff) && ff.ValueKind == JsonValueKind.String ? ff.GetString()! : cur.FontFamily,
                    FontSize = se.TryGetProperty("fontSize", out var fz) && fz.ValueKind == JsonValueKind.Number ? (int)Math.Round(fz.GetDouble()) : cur.FontSize,
                    DetailHeight = se.TryGetProperty("detailHeight", out var dh) && dh.ValueKind == JsonValueKind.Number ? (int)Math.Round(dh.GetDouble()) : cur.DetailHeight,
                    DetailTopHeight = se.TryGetProperty("detailTopHeight", out var dth) && dth.ValueKind == JsonValueKind.Number ? (int)Math.Round(dth.GetDouble()) : cur.DetailTopHeight,
                    DetailMetaHeight = se.TryGetProperty("detailMetaHeight", out var dmh) && dmh.ValueKind == JsonValueKind.Number ? (int)Math.Round(dmh.GetDouble()) : cur.DetailMetaHeight,
                    LastRepo = se.TryGetProperty("lastRepo", out var lrp) && lrp.ValueKind == JsonValueKind.String ? lrp.GetString() : cur.LastRepo,
                };
                settingsStore.Save(updated);
                return JsonSerializer.Serialize(new { id, ok = true }, jsonOpts);
            }

            case "addRepo":
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string[] picked = w.ShowOpenFolder("Add a repository", home, false);
                var sa = settingsStore.Load();
                if (picked.Length == 0)
                    return JsonSerializer.Serialize(new { id, ok = true, data = new { added = (string?)null, repos = sa.Repos } }, jsonOpts);
                string repoPath = Path.GetFullPath(picked[0]);
                if (!reader.IsValid(repoPath))
                    return JsonSerializer.Serialize(new { id, ok = false, error = $"Not a git repository: {repoPath}" }, jsonOpts);
                if (!sa.Repos.Contains(repoPath))
                {
                    sa = sa with { Repos = sa.Repos.Append(repoPath).ToArray() };
                    settingsStore.Save(sa);
                }
                return JsonSerializer.Serialize(new { id, ok = true, data = new { added = repoPath, repos = sa.Repos } }, jsonOpts);
            }

            case "removeRepo":
            {
                string repoPath = root.GetProperty("repoPath").GetString() ?? "";
                var sr = settingsStore.Load();
                sr = sr with
                {
                    Repos = sr.Repos.Where(r => r != repoPath).ToArray(),
                    LastRepo = sr.LastRepo == repoPath ? null : sr.LastRepo,
                };
                settingsStore.Save(sr);
                return JsonSerializer.Serialize(new { id, ok = true, data = new { repos = sr.Repos } }, jsonOpts);
            }

            case "getGitIdentity":
            {
                string? gp = root.TryGetProperty("repoPath", out var gpr) && gpr.ValueKind == JsonValueKind.String ? gpr.GetString() : fallbackRepo;
                return JsonSerializer.Serialize(new { id, ok = true, data = gitConfig.Get(gp) }, jsonOpts);
            }

            case "setGitIdentity":
            {
                string? sp = root.TryGetProperty("repoPath", out var spr) && spr.ValueKind == JsonValueKind.String ? spr.GetString() : fallbackRepo;
                var scope = root.GetProperty("scope").GetString() == "local" ? GitConfigScope.Local : GitConfigScope.Global;
                string nm = root.TryGetProperty("name", out var nmv) ? nmv.GetString() ?? "" : "";
                string em = root.TryGetProperty("email", out var emv) ? emv.GetString() ?? "" : "";
                gitConfig.Set(sp, scope, nm, em);
                return JsonSerializer.Serialize(new { id, ok = true }, jsonOpts);
            }

            default:
                return JsonSerializer.Serialize(new { id, ok = false, error = $"unknown request type '{type}'" }, jsonOpts);
        }
    }
    catch (Exception ex)
    {
        return JsonSerializer.Serialize(new { id, ok = false, error = ex.Message }, jsonOpts);
    }
}

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
