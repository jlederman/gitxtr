using Gitxtr.Application;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class GetRemotesHandler(IRemoteService remotes, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        return remotes.GetRemotes(repoPath);
    }
}
