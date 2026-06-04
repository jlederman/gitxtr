using System.Text.Json;
using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class SetGitIdentityHandler(IGitConfigService gitConfig, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string? path = ctx.Root.TryGetProperty("repoPath", out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString() : fallbackRepo;
        var scope = ctx.Root.GetProperty("scope").GetString() == "local"
            ? GitConfigScope.Local : GitConfigScope.Global;
        string name  = ctx.Root.TryGetProperty("name",  out var nv) ? nv.GetString() ?? "" : "";
        string email = ctx.Root.TryGetProperty("email", out var ev) ? ev.GetString() ?? "" : "";
        gitConfig.Set(path, scope, name, email);
        return null;
    }
}
