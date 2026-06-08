using Gitxtr.Application;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class CommitOpHandler(IWorkingTreeService workingTree, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string op = ctx.Root.TryGetProperty("op", out var o) ? o.GetString() ?? "" : "";
        string sha = ctx.Root.TryGetProperty("sha", out var sh) ? sh.GetString() ?? "" : "";
        if (string.IsNullOrEmpty(sha))
            throw new InvalidOperationException("sha is required");

        switch (op)
        {
            case "revert": workingTree.RevertCommit(repoPath, sha); break;
            case "cherryPick": workingTree.CherryPick(repoPath, sha); break;
            default: throw new InvalidOperationException($"unknown commit op: {op}");
        }
        return null;
    }
}
