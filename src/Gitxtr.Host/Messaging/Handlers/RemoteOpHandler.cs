using System.Text.Json;
using Gitxtr.Application;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class RemoteOpHandler(IRemoteService remotes, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string op = ctx.Root.TryGetProperty("op", out var o) ? o.GetString() ?? "" : "";
        string? remote = ctx.Root.TryGetProperty("remote", out var rm) ? rm.GetString() : null;

        string output = op switch
        {
            "fetch" => remotes.Fetch(repoPath, remote, Flag("prune")),
            "pull"  => remotes.Pull(repoPath, remote, Flag("rebase")),
            "push"  => remotes.Push(repoPath, remote ?? "", Str("branch"), Flag("force"), Flag("setUpstream")),
            _ => throw new InvalidOperationException($"unknown remote op: {op}"),
        };

        return new { output };

        bool Flag(string name) =>
            ctx.Root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
        string Str(string name) =>
            ctx.Root.TryGetProperty(name, out var v) ? v.GetString() ?? "" : "";
    }
}
