using System.Text.Json;
using Microsoft.Extensions.Logging;
using Photino.NET;

namespace Gitxtr.Host.Terminal;

// Routes the "term:*" message channel (separate from the JSON-RPC bridge) and owns the single
// active terminal session. Web -> host terminal messages are fire-and-forget (no id, no
// response); host -> web output is sent as unsolicited push messages, which the bridge
// delivers via onPush(). All SendWebMessage calls are marshalled to the UI thread.
internal sealed class TerminalManager(PhotinoWindow window, ILogger logger) : IDisposable
{
    private readonly object _gate = new();
    private TerminalSession? _session;
    private volatile bool _disposed;

    /// <summary>Handle a raw web message if it belongs to the terminal channel. Returns true
    /// when handled here (so the caller skips JSON-RPC dispatch), false otherwise.</summary>
    public bool TryHandle(string raw)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(raw); }
        catch { return false; }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("type", out var t) || t.ValueKind != JsonValueKind.String)
                return false;

            string type = t.GetString()!;
            if (!type.StartsWith("term:", StringComparison.Ordinal))
                return false;

            try { Handle(type, root); }
            catch (Exception ex) { logger.LogWarning(ex, "terminal '{Type}' failed", type); }
            return true;
        }
    }

    private void Handle(string type, JsonElement root)
    {
        switch (type)
        {
            case "term:open":
                Open(Int(root, "cols", 80), Int(root, "rows", 24),
                    root.TryGetProperty("cwd", out var c) ? c.GetString() : null);
                break;
            case "term:input":
                if (root.TryGetProperty("data", out var d) && d.GetString() is { } b64)
                    Session?.Write(Convert.FromBase64String(b64));
                break;
            case "term:resize":
                Session?.Resize(Int(root, "cols", 80), Int(root, "rows", 24));
                break;
            case "term:close":
                CloseSession();
                break;
        }
    }

    private void Open(int cols, int rows, string? cwd)
    {
        lock (_gate)
            if (_disposed || _session is not null) return;

        string dir = !string.IsNullOrEmpty(cwd) && Directory.Exists(cwd)
            ? cwd!
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        _ = Task.Run(async () =>
        {
            try
            {
                var session = await TerminalSession.StartAsync(
                    dir, cols, rows,
                    onData: bytes => Push(new { type = "term:data", data = Convert.ToBase64String(bytes) }),
                    onExit: code =>
                    {
                        CloseSession();
                        Push(new { type = "term:exit", code });
                    });

                bool keep;
                lock (_gate)
                {
                    keep = !_disposed && _session is null;
                    if (keep) _session = session;
                }
                if (!keep) session.Dispose();   // window closed (or raced) while spawning
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "terminal spawn failed");
                Push(new { type = "term:error", message = ex.Message });
            }
        });
    }

    private TerminalSession? Session
    {
        get { lock (_gate) return _session; }
    }

    private void CloseSession()
    {
        TerminalSession? s;
        lock (_gate) { s = _session; _session = null; }
        s?.Dispose();
    }

    private void Push(object message)
    {
        if (_disposed) return;
        string json = JsonSerializer.Serialize(message);
        try { window.Invoke(() => { if (!_disposed) window.SendWebMessage(json); }); }
        catch { /* window is closing */ }
    }

    private static int Int(JsonElement root, string name, int fallback) =>
        root.TryGetProperty(name, out var v) && v.TryGetInt32(out int n) ? n : fallback;

    public void Dispose()
    {
        _disposed = true;
        CloseSession();
    }
}
