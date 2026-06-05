using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class GetBlameHandler(IGraphQueryService service, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string filePath = ctx.Root.TryGetProperty("path", out var fp) ? fp.GetString() ?? "" : "";
        if (string.IsNullOrEmpty(filePath))
            throw new InvalidOperationException("no file path");

        string? atSha = ctx.Root.TryGetProperty("sha", out var s) ? s.GetString() : null;

        return service.GetBlame(repoPath, filePath, atSha);
    }
}
