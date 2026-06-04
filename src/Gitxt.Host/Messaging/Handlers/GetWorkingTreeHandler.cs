using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class GetWorkingTreeHandler(IWorkingTreeService workingTree, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string path = ctx.Root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } rp
            ? rp : fallbackRepo;
        if (string.IsNullOrEmpty(path))
            throw new InvalidOperationException("no repository selected");
        return workingTree.GetView(path);
    }
}
