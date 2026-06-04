using Gitxt.Application;
using Gitxt.Host.Messaging;

namespace Gitxt.Host.Messaging.Handlers;

internal sealed class BranchOpHandler(IBranchService branches, string fallbackRepo) : IMessageHandler
{
    public object? Handle(MessageContext ctx)
    {
        string repoPath = ctx.Root.TryGetProperty("repoPath", out var rp) && rp.GetString() is { Length: > 0 } r
            ? r : fallbackRepo;
        if (string.IsNullOrEmpty(repoPath))
            throw new InvalidOperationException("no repository selected");

        string op = ctx.Root.TryGetProperty("op", out var o) ? o.GetString() ?? "" : "";

        switch (op)
        {
            case "checkout":
            {
                string name = ctx.Root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                branches.Checkout(repoPath, name);
                return null;
            }
            case "create":
            {
                string name = ctx.Root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                string sha  = ctx.Root.TryGetProperty("sha",  out var s) ? s.GetString() ?? "" : "";
                bool co = ctx.Root.TryGetProperty("checkout", out var c) &&
                          c.ValueKind == System.Text.Json.JsonValueKind.True;
                return branches.Create(repoPath, name, sha, co);
            }
            case "delete":
            {
                string name = ctx.Root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                branches.Delete(repoPath, name);
                return null;
            }
            case "rename":
            {
                string oldName = ctx.Root.TryGetProperty("oldName", out var on) ? on.GetString() ?? "" : "";
                string newName = ctx.Root.TryGetProperty("newName", out var nn) ? nn.GetString() ?? "" : "";
                branches.Rename(repoPath, oldName, newName);
                return null;
            }
            default:
                throw new InvalidOperationException($"unknown branch op: {op}");
        }
    }
}
