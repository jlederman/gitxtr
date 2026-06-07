using System.Text.Json;
using Photino.NET;

namespace Gitxtr.Host.Messaging;

internal sealed class MessageContext(string id, string type, JsonElement root, PhotinoWindow window)
{
    public string Id { get; } = id;
    public string Type { get; } = type;
    public JsonElement Root { get; } = root;
    public PhotinoWindow Window { get; } = window;
}
