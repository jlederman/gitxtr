using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class RemoveRepoHandler(ISettingsStore store) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.GetProperty("repoPath").GetString() ?? "";
        var settings = store.Load();
        settings = settings with
        {
            Repos    = settings.Repos.Where(r => r != repoPath).ToArray(),
            LastRepo = settings.LastRepo == repoPath ? null : settings.LastRepo,
        };
        store.Save(settings);
        return new { repos = settings.Repos };
    }
}
