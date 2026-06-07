using System.Text.Json;
using Gitxtr.Application;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class GetGitIdentityHandler(IGitConfigService gitConfig, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string? path = ctx.Root.TryGetProperty("repoPath", out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString() : fallbackRepo;
        return gitConfig.Get(path);
    }
}
