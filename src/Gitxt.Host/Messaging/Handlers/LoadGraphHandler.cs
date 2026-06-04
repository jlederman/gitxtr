using System.Text.Json;
using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class LoadGraphHandler(
    IGraphQueryService service,
    string fallbackRepo,
    RepoWatcherService? watcher = null,
    IWorkingTreeService? workingTree = null) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string path = ctx.Root.TryGetProperty("repoPath", out var p) && p.GetString() is { Length: > 0 } rp
            ? rp : fallbackRepo;
        int? limit = ctx.Root.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number
            ? l.GetInt32() : 2000;
        if (string.IsNullOrEmpty(path))
            throw new InvalidOperationException("no repository selected");
        watcher?.Watch(path);
        var graph = service.GetGraph(path, limit);
        bool hasChanges = workingTree?.HasChanges(path) ?? false;
        return graph with { HasUncommittedChanges = hasChanges };
    }
}
