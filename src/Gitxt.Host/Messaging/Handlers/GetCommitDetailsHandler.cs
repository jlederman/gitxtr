using System.Text.Json;
using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class GetCommitDetailsHandler(IGraphQueryService service, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string sha = ctx.Root.GetProperty("sha").GetString() ?? "";
        string repo = ctx.Root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } rp
            ? rp : fallbackRepo;

        // Optional "parent": a 0-based parent index, or the string "combined" for a merge.
        int parentIndex = 0;
        bool combined = false;
        if (ctx.Root.TryGetProperty("parent", out var pv))
        {
            if (pv.ValueKind == JsonValueKind.String && pv.GetString() == "combined") combined = true;
            else if (pv.ValueKind == JsonValueKind.Number) parentIndex = pv.GetInt32();
        }

        return service.GetCommitDetails(repo, sha, parentIndex, combined);
    }
}
