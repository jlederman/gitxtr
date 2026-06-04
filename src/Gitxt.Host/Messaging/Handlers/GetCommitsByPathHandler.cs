using Gitxt.Domain;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class GetCommitsByPathHandler(IRepositoryReader reader, string fallbackRepo) : IMessageHandler
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

        return reader.ReadCommitShasByPath(repoPath, filePath);
    }
}
