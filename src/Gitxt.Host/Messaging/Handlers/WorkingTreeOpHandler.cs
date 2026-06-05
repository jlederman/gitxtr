using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class WorkingTreeOpHandler(IWorkingTreeService workingTree, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string op = ctx.Root.TryGetProperty("op", out var o) ? o.GetString() ?? "" : "";

        if (op is "stageAll" or "unstageAll" or "discardAll")
        {
            if (op == "stageAll")       workingTree.StageAll(repoPath);
            else if (op == "unstageAll") workingTree.UnstageAll(repoPath);
            else                         workingTree.DiscardAllUnstaged(repoPath);
            return null;
        }

        string filePath = ctx.Root.TryGetProperty("path", out var fp) ? fp.GetString() ?? "" : "";
        if (string.IsNullOrEmpty(filePath))
            throw new InvalidOperationException("no file path");

        switch (op)
        {
            case "stage":   workingTree.StageFile(repoPath, filePath);   break;
            case "unstage": workingTree.UnstageFile(repoPath, filePath); break;
            case "discard": workingTree.DiscardFile(repoPath, filePath); break;
            default: throw new InvalidOperationException($"unknown op: {op}");
        }
        return null;
    }
}
