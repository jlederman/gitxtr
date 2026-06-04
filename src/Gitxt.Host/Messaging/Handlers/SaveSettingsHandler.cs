using System.Text.Json;
using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class SaveSettingsHandler(ISettingsStore store) : IMessageHandler
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private sealed record Patch(
        string? Theme, string? FontFamily, double? FontSize,
        double? DetailHeight, double? DetailTopHeight, double? DetailMetaHeight,
        string? DiffView);

    public object? Handle(MessageContext ctx)
    {
        var se = ctx.Root.GetProperty("settings");
        var patch = JsonSerializer.Deserialize<Patch>(se.GetRawText(), JsonOpts) ?? new(null, null, null, null, null, null, null);
        var cur = store.Load();
        store.Save(cur with
        {
            Theme            = patch.Theme            ?? cur.Theme,
            FontFamily       = patch.FontFamily       ?? cur.FontFamily,
            FontSize         = patch.FontSize         is double fs  ? (int)Math.Round(fs)  : cur.FontSize,
            DetailHeight     = patch.DetailHeight     is double dh  ? (int)Math.Round(dh)  : cur.DetailHeight,
            DetailTopHeight  = patch.DetailTopHeight  is double dth ? (int)Math.Round(dth) : cur.DetailTopHeight,
            DetailMetaHeight = patch.DetailMetaHeight is double dmh ? (int)Math.Round(dmh) : cur.DetailMetaHeight,
            DiffView         = patch.DiffView         ?? cur.DiffView,
            // lastRepo can be set to null (clearing the last-used repo), so we check presence not value
            LastRepo         = se.TryGetProperty("lastRepo", out var lrp) && lrp.ValueKind == JsonValueKind.String
                                   ? lrp.GetString() : cur.LastRepo,
        });
        return null;
    }
}
