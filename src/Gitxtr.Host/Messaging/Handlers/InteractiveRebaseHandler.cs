using Gitxtr.Application;
using Gitxtr.Host.Messaging;

namespace Gitxtr.Host.Messaging.Handlers;

internal sealed class InteractiveRebaseHandler(IWorkingTreeService workingTree, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        if (!ctx.Root.TryGetProperty("steps", out var stepsEl))
            throw new InvalidOperationException("missing steps");

        var steps = new List<RebaseStep>();
        foreach (var el in stepsEl.EnumerateArray())
        {
            var sha    = el.TryGetProperty("sha",    out var s) ? s.GetString() ?? "" : "";
            var action = el.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            if (!string.IsNullOrEmpty(sha) && !string.IsNullOrEmpty(action))
                steps.Add(new RebaseStep(sha, action));
        }

        workingTree.InteractiveRebase(repoPath, steps);
        return null;
    }
}
