using Porta.Pty;

namespace Gitxtr.Host.Terminal;

// A single PTY-backed shell session for the integrated terminal. Spawns the user's default
// shell, pumps its raw output to onData on a background task, and forwards input/resize.
//
// Output is handed back as raw bytes (NOT decoded to a string): a PTY read can split a
// multi-byte UTF-8 sequence or an ANSI escape across chunks, so decoding per-chunk would
// corrupt them. The frontend feeds the bytes straight to xterm, which decodes across writes.
internal sealed class TerminalSession : IDisposable
{
    private readonly IPtyConnection _pty;
    private readonly CancellationTokenSource _cts = new();
    private volatile bool _disposed;

    private TerminalSession(IPtyConnection pty) => _pty = pty;

    public static async Task<TerminalSession> StartAsync(
        string cwd, int cols, int rows, Action<byte[]> onData, Action<int> onExit)
    {
        var (app, args) = DefaultShell();
        var options = new PtyOptions
        {
            Name = "xterm-256color",
            Cols = Math.Max(cols, 2),
            Rows = Math.Max(rows, 1),
            Cwd = cwd,
            App = app,
            CommandLine = args,
            Environment = BuildEnvironment(),
        };

        IPtyConnection pty = await PtyProvider.SpawnAsync(options, CancellationToken.None);
        var session = new TerminalSession(pty);
        pty.ProcessExited += (_, _) =>
        {
            try { onExit(pty.ExitCode); }
            catch { /* the host marshals/handles; never let a callback crash the PTY thread */ }
        };
        session.PumpOutput(onData);
        return session;
    }

    private void PumpOutput(Action<byte[]> onData)
    {
        _ = Task.Run(async () =>
        {
            var buffer = new byte[8192];
            try
            {
                int n;
                while (!_cts.IsCancellationRequested &&
                       (n = await _pty.ReaderStream.ReadAsync(buffer, _cts.Token)) > 0)
                {
                    var chunk = new byte[n];
                    Array.Copy(buffer, chunk, n);
                    onData(chunk);
                }
            }
            catch (OperationCanceledException) { }
            catch { /* stream closes when the shell exits — expected */ }
        });
    }

    public void Write(byte[] data)
    {
        if (_disposed) return;
        try
        {
            _pty.WriterStream.Write(data, 0, data.Length);
            _pty.WriterStream.Flush();
        }
        catch { /* shell may have exited between the UI event and this write */ }
    }

    public void Resize(int cols, int rows)
    {
        if (_disposed) return;
        try { _pty.Resize(Math.Max(cols, 2), Math.Max(rows, 1)); }
        catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        try { _pty.Kill(); } catch { }
        (_pty as IDisposable)?.Dispose();
        _cts.Dispose();
    }

    // The default interactive shell. Unix honours $SHELL (the user's login shell); Windows
    // prefers PowerShell. Verified locally on macOS; the Windows path can't be tested here.
    private static (string app, string[] args) DefaultShell()
    {
        if (OperatingSystem.IsWindows())
            return ("powershell.exe", []);

        string shell = Environment.GetEnvironmentVariable("SHELL") ?? "";
        return (string.IsNullOrEmpty(shell) ? "/bin/bash" : shell, []);
    }

    private static IDictionary<string, string> BuildEnvironment()
    {
        var env = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (System.Collections.DictionaryEntry kv in Environment.GetEnvironmentVariables())
            env[(string)kv.Key] = kv.Value?.ToString() ?? "";
        // Advertise a capable terminal so programs emit colours.
        env["TERM"] = "xterm-256color";
        env["COLORTERM"] = "truecolor";
        return env;
    }
}
