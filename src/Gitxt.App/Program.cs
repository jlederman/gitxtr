using System.Text.Json;
using Gitxt.Application;
using Gitxt.Domain;
using Gitxt.Infrastructure;
using Photino.NET;

var service = new GraphQueryService(new LibGit2SharpRepositoryReader(), new GraphLayoutEngine());

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

string defaultRepo = Array.Find(args, a => !a.StartsWith("--")) ?? Directory.GetCurrentDirectory();
var jsonOpts = new JsonSerializerOptions(JsonSerializerDefaults.Web);
string indexPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");

var window = new PhotinoWindow()
    .SetTitle("gitxt")
    .SetUseOsDefaultSize(false)
    .SetSize(1100, 760)
    .Center()
    .RegisterWebMessageReceivedHandler((sender, message) =>
    {
        // Runs on the UI thread. The demo payloads are tiny, so we answer synchronously;
        // pitfall #5 (offload heavy work, paginate) is handled when we wire large repos.
        var w = (PhotinoWindow)sender!;
        w.SendWebMessage(Handle(message));
    })
    .Load(indexPath);

window.WaitForClose();
return 0;

string Handle(string message)
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
                string path = root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } s
                    ? s : defaultRepo;
                int? limit = root.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number
                    ? l.GetInt32() : 2000;
                GraphView view = service.GetGraph(path, limit);
                return JsonSerializer.Serialize(new { id, ok = true, data = view }, jsonOpts);

            case "getCommitDetails":
                string sha = root.GetProperty("sha").GetString() ?? "";
                CommitDetailsDto details = service.GetCommitDetails(defaultRepo, sha);
                return JsonSerializer.Serialize(new { id, ok = true, data = details }, jsonOpts);

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
