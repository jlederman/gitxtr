using System.Text.Json;
using Photino.NET;

namespace Gitxt.Host.Messaging;

internal sealed class MessageDispatcher(
    IReadOnlyDictionary<string, IMessageHandler> handlers,
    JsonSerializerOptions jsonOpts)
{
    public string Dispatch(PhotinoWindow window, string raw)
    {
        string id = "";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetString() ?? "";
            string type = root.GetProperty("type").GetString() ?? "";

            if (!handlers.TryGetValue(type, out var handler))
                return Err(id, $"unknown request type '{type}'");

            var data = handler.Handle(new MessageContext(id, type, root, window));
            return data is null
                ? JsonSerializer.Serialize(new { id, ok = true }, jsonOpts)
                : JsonSerializer.Serialize(new { id, ok = true, data }, jsonOpts);
        }
        catch (Exception ex)
        {
            return Err(id, ex.Message);
        }
    }

    private string Err(string id, string error) =>
        JsonSerializer.Serialize(new { id, ok = false, error }, jsonOpts);
}
