using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class CreateCommitHandler(IWorkingTreeService workingTree, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string message = ctx.Root.TryGetProperty("message", out var m) ? m.GetString()?.Trim() ?? "" : "";
        if (message.Length == 0)
            throw new InvalidOperationException("commit message is required");

        bool amend = ctx.Root.TryGetProperty("amend", out var a) && a.ValueKind == System.Text.Json.JsonValueKind.True;

        workingTree.CreateCommit(repoPath, message, amend);
        return null;
    }
}
