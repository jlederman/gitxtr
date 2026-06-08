using Gitxtr.Application;
using Gitxtr.Domain;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class GetSettingsHandler(ISettingsStore store, IRepositoryReader reader, string? cliRepo)
    : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        var st = store.Load();
        string? currentRepo = cliRepo
            ?? (!string.IsNullOrEmpty(st.LastRepo) && reader.IsValid(st.LastRepo!) ? st.LastRepo : null)
            ?? st.Repos.FirstOrDefault(reader.IsValid);
        return new
        {
            st.Theme,
            st.FontFamily,
            st.FontSize,
            st.DetailHeight,
            st.DetailTopHeight,
            st.DetailMetaHeight,
            st.Repos,
            st.LastRepo,
            st.DiffView,
            currentRepo,
        };
    }
}
