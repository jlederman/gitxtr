using Gitxtr.Application;
using Gitxtr.Domain;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class AddRepoHandler(ISettingsStore store, IRepositoryReader reader) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string[] picked = ctx.Window.ShowOpenFolder("Add a repository", home, false);
        var settings = store.Load();

        if (picked.Length == 0)
            return new { added = (string?)null, repos = settings.Repos };

        string repoPath = Path.GetFullPath(picked[0]);
        if (!reader.IsValid(repoPath))
            throw new InvalidOperationException($"Not a git repository: {repoPath}");

        if (!settings.Repos.Contains(repoPath))
        {
            settings = settings with { Repos = settings.Repos.Append(repoPath).ToArray() };
            store.Save(settings);
        }
        return new { added = repoPath, repos = settings.Repos };
    }
}
