using Gitxt.Application;
using LibGit2Sharp;

namespace Gitxt.Infrastructure;

public sealed class LibGit2SharpWorkingTreeService : IWorkingTreeService
{
    public bool HasChanges(string repoPath)
    {
        if (!Repository.IsValid(repoPath)) return false;
        using var repo = new Repository(repoPath);
        return repo.RetrieveStatus(new StatusOptions { IncludeUntracked = false }).IsDirty;
    }

    public WorkingTreeViewDto GetView(string repoPath)
    {
        using var repo = new Repository(repoPath);
        var headTree = repo.Head.Tip?.Tree;

        // Staged changes: HEAD → Index  (equivalent to git diff --staged)
        var stagedPatch = repo.Diff.Compare<Patch>(headTree, DiffTargets.Index);

        // Unstaged changes: Index → WorkDir  (equivalent to git diff)
        var unstagedPatch = repo.Diff.Compare<Patch>();

        var stagedPaths = new HashSet<string>(stagedPatch.Select(e => e.Path), StringComparer.Ordinal);

        var staged = stagedPatch
            .Select(e => new WorkingTreeFileDto(e.Path, StatusChar(e.Status), Staged: true, e.Patch))
            .OrderBy(f => f.Path)
            .ToList<WorkingTreeFileDto>();

        // Unstaged: tracked files modified/deleted in workdir, plus untracked.
        var status = repo.RetrieveStatus(new StatusOptions { IncludeUntracked = true });
        var unstaged = new List<WorkingTreeFileDto>();

        foreach (var entry in status.OrderBy(e => e.FilePath))
        {
            var state = entry.State;
            bool inWorkdir  = state.HasFlag(FileStatus.ModifiedInWorkdir) ||
                              state.HasFlag(FileStatus.DeletedFromWorkdir);
            bool isUntracked = state.HasFlag(FileStatus.NewInWorkdir);

            if (!inWorkdir && !isUntracked) continue;

            if (isUntracked)
            {
                unstaged.Add(new WorkingTreeFileDto(entry.FilePath, "?", Staged: false,
                    Patch: NewFilePatch(repoPath, entry.FilePath)));
            }
            else
            {
                var pe = unstagedPatch[entry.FilePath];
                unstaged.Add(new WorkingTreeFileDto(
                    entry.FilePath,
                    pe is not null ? StatusChar(pe.Status) : "M",
                    Staged: false,
                    Patch: pe?.Patch ?? ""));
            }
        }

        string lastMsg = repo.Head.Tip?.Message.TrimEnd() ?? "";
        return new WorkingTreeViewDto(staged, unstaged, lastMsg);
    }

    public void StageFile(string repoPath, string filePath)
    {
        using var repo = new Repository(repoPath);
        Commands.Stage(repo, filePath);
    }

    public void UnstageFile(string repoPath, string filePath)
    {
        using var repo = new Repository(repoPath);
        Commands.Unstage(repo, filePath);
    }

    public void DiscardFile(string repoPath, string filePath)
    {
        using var repo = new Repository(repoPath);
        bool inHead = repo.Head.Tip?.Tree[filePath] is not null;
        if (inHead)
        {
            repo.CheckoutPaths("HEAD", new[] { filePath },
                new CheckoutOptions { CheckoutModifiers = CheckoutModifiers.Force });
        }
        else
        {
            // Untracked / new file — delete from disk and remove from index if staged.
            var fullPath = Path.Combine(repoPath, filePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(fullPath)) File.Delete(fullPath);
            if (repo.Index[filePath] is not null)
            {
                repo.Index.Remove(filePath);
                repo.Index.Write();
            }
        }
    }

    public void StageAll(string repoPath)
    {
        using var repo = new Repository(repoPath);
        var paths = repo.RetrieveStatus(new StatusOptions { IncludeUntracked = true })
            .Where(e => (e.State & (FileStatus.ModifiedInWorkdir | FileStatus.DeletedFromWorkdir | FileStatus.NewInWorkdir)) != 0)
            .Select(e => e.FilePath)
            .ToList();
        if (paths.Count > 0) Commands.Stage(repo, paths);
    }

    public void UnstageAll(string repoPath)
    {
        using var repo = new Repository(repoPath);
        var paths = repo.RetrieveStatus()
            .Where(e => (e.State & (FileStatus.NewInIndex | FileStatus.ModifiedInIndex |
                                    FileStatus.DeletedFromIndex | FileStatus.RenamedInIndex)) != 0)
            .Select(e => e.FilePath)
            .ToList();
        if (paths.Count > 0) Commands.Unstage(repo, paths);
    }

    public void CreateCommit(string repoPath, string message, bool amend)
    {
        using var repo = new Repository(repoPath);
        var name  = repo.Config.GetValueOrDefault<string>("user.name")
                    ?? throw new InvalidOperationException("Git user.name is not configured. Set it with: git config --global user.name \"Your Name\"");
        var email = repo.Config.GetValueOrDefault<string>("user.email") ?? "";
        var sig   = new Signature(name, email, DateTimeOffset.Now);
        repo.Commit(message, sig, sig, new CommitOptions { AmendPreviousCommit = amend });
    }

    public void RevertCommit(string repoPath, string sha)
    {
        using var repo = new Repository(repoPath);
        var commit = repo.Lookup<Commit>(sha)
            ?? throw new InvalidOperationException($"Commit '{sha}' not found");
        var name  = repo.Config.GetValueOrDefault<string>("user.name")
                    ?? throw new InvalidOperationException("Git user.name is not configured");
        var email = repo.Config.GetValueOrDefault<string>("user.email") ?? "";
        var sig   = new Signature(name, email, DateTimeOffset.Now);
        var result = repo.Revert(commit, sig);
        if (result.Status == RevertStatus.Conflicts)
            throw new InvalidOperationException("Revert resulted in conflicts — resolve them manually.");
    }

    public void CherryPick(string repoPath, string sha)
    {
        using var repo = new Repository(repoPath);
        var commit = repo.Lookup<Commit>(sha)
            ?? throw new InvalidOperationException($"Commit '{sha}' not found");
        var name  = repo.Config.GetValueOrDefault<string>("user.name")
                    ?? throw new InvalidOperationException("Git user.name is not configured");
        var email = repo.Config.GetValueOrDefault<string>("user.email") ?? "";
        var sig   = new Signature(name, email, DateTimeOffset.Now);
        var result = repo.CherryPick(commit, sig);
        if (result.Status == CherryPickStatus.Conflicts)
            throw new InvalidOperationException("Cherry-pick resulted in conflicts — resolve them manually.");
    }

    public void InteractiveRebase(string repoPath, IReadOnlyList<RebaseStep> steps)
    {
        if (steps.Count == 0) return;

        using var repo = new Repository(repoPath);
        var name  = repo.Config.GetValueOrDefault<string>("user.name")
                    ?? throw new InvalidOperationException("Git user.name is not configured");
        var email = repo.Config.GetValueOrDefault<string>("user.email") ?? "";
        var sig   = new Signature(name, email, DateTimeOffset.Now);

        // The base is the parent of the oldest step (steps[0]).
        var firstOriginal = repo.Lookup<Commit>(steps[0].Sha)
            ?? throw new InvalidOperationException($"Commit '{steps[0].Sha}' not found");
        var baseCommit = firstOriginal.Parents.FirstOrDefault()
            ?? throw new InvalidOperationException("Cannot rebase root commit");

        var originalHead = repo.Head.Tip;
        try
        {
            repo.Reset(ResetMode.Hard, baseCommit);
            ExecuteSteps(repo, sig, steps);
        }
        catch
        {
            repo.Reset(ResetMode.Hard, originalHead);
            throw;
        }
    }

    private static void ExecuteSteps(Repository repo, Signature sig, IReadOnlyList<RebaseStep> steps)
    {
        Commit? groupBase = null;   // parent of the first pick in the current squash group
        string? groupMsg  = null;

        void FlushGroup()
        {
            if (groupBase is null) return;
            repo.Reset(ResetMode.Soft, groupBase);
            repo.Commit(groupMsg!, sig, sig);
            groupBase = null;
            groupMsg  = null;
        }

        foreach (var step in steps)
        {
            var original = repo.Lookup<Commit>(step.Sha)
                ?? throw new InvalidOperationException($"Commit '{step.Sha}' not found");

            if (step.Action == "drop") continue;

            if (step.Action == "pick")
            {
                FlushGroup();
                var result = repo.CherryPick(original, sig);
                if (result.Status == CherryPickStatus.Conflicts)
                    throw new InvalidOperationException($"Cherry-pick of {step.Sha[..7]} resulted in conflicts.");
            }
            else // squash or fixup
            {
                if (groupBase is null)
                {
                    // Start a squash group anchored at the parent of the current HEAD.
                    groupBase = repo.Head.Tip.Parents.First();
                    groupMsg  = repo.Head.Tip.Message.TrimEnd();
                }

                var result = repo.CherryPick(original, sig);
                if (result.Status == CherryPickStatus.Conflicts)
                    throw new InvalidOperationException($"Cherry-pick of {step.Sha[..7]} resulted in conflicts.");

                if (step.Action == "squash")
                    groupMsg += "\n\n" + original.Message.TrimEnd();
                // fixup: keep groupMsg unchanged (discard this commit's message)
            }
        }

        FlushGroup();
    }

    private static string StatusChar(ChangeKind kind) => kind switch
    {
        ChangeKind.Added   => "A",
        ChangeKind.Deleted => "D",
        ChangeKind.Renamed => "R",
        ChangeKind.Copied  => "C",
        _                  => "M",
    };

    private static string NewFilePatch(string repoPath, string filePath)
    {
        var fullPath = Path.Combine(repoPath, filePath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(fullPath)) return "";
        try
        {
            var bytes = File.ReadAllBytes(fullPath);
            if (IsBinary(bytes))
                return $"diff --git a/{filePath} b/{filePath}\nnew file mode 100644\n(binary file — cannot display)\n";

            var content = System.Text.Encoding.UTF8.GetString(bytes);
            var lines = content.Split('\n');
            bool trailingNewline = content.EndsWith('\n');
            var body = trailingNewline ? lines[..^1] : lines;

            var sb = new System.Text.StringBuilder();
            sb.Append($"diff --git a/{filePath} b/{filePath}\n");
            sb.Append("new file mode 100644\n");
            sb.Append("--- /dev/null\n");
            sb.Append($"+++ b/{filePath}\n");
            sb.Append($"@@ -0,0 +1,{body.Length} @@\n");
            foreach (var line in body)
                sb.Append('+').Append(line).Append('\n');
            if (!trailingNewline && body.Length > 0)
                sb.Append("\\ No newline at end of file\n");
            return sb.ToString();
        }
        catch (Exception) { return ""; }
    }

    private static bool IsBinary(byte[] data)
    {
        var limit = Math.Min(data.Length, 8000);
        for (var i = 0; i < limit; i++)
            if (data[i] == 0) return true;
        return false;
    }
}
