using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class GetCommitDetailsHandler(IGraphQueryService service, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string sha = ctx.Root.GetProperty("sha").GetString() ?? "";
        string repo = ctx.Root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } rp
            ? rp : fallbackRepo;
        return service.GetCommitDetails(repo, sha);
    }
}
