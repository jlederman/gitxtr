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

        // All working-directory changes vs HEAD; used for unstaged-file patches.
        // For files that are also staged this shows the combined diff — acceptable for now.
        var workdirPatch = repo.Diff.Compare<Patch>(headTree, DiffTargets.WorkingDirectory);

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
                var pe = workdirPatch[entry.FilePath];
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
