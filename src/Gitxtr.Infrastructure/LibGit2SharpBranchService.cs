using Gitxtr.Application;
using LibGit2Sharp;

namespace Gitxtr.Infrastructure;

public sealed class LibGit2SharpBranchService : IBranchService
{
    public IReadOnlyList<BranchDto> GetBranches(string repoPath)
    {
        using var repo = new Repository(repoPath);
        return repo.Branches
            .Where(b => !b.IsRemote)
            .Select(b => new BranchDto(b.FriendlyName, b.IsCurrentRepositoryHead, b.TrackedBranch?.FriendlyName))
            .OrderBy(b => b.Name)
            .ToList();
    }

    public void Checkout(string repoPath, string branchName)
    {
        using var repo = new Repository(repoPath);
        var branch = repo.Branches[branchName]
            ?? throw new InvalidOperationException($"Branch '{branchName}' not found");
        Commands.Checkout(repo, branch);
    }

    public BranchDto Create(string repoPath, string branchName, string sha, bool checkout)
    {
        using var repo = new Repository(repoPath);
        var commit = repo.Lookup<Commit>(sha)
            ?? throw new InvalidOperationException($"Commit '{sha}' not found");
        var branch = repo.CreateBranch(branchName, commit);
        if (checkout) Commands.Checkout(repo, branch);
        return new BranchDto(branch.FriendlyName, branch.IsCurrentRepositoryHead, null);
    }

    public void Delete(string repoPath, string branchName)
    {
        using var repo = new Repository(repoPath);
        var branch = repo.Branches[branchName]
            ?? throw new InvalidOperationException($"Branch '{branchName}' not found");
        if (branch.IsCurrentRepositoryHead)
            throw new InvalidOperationException($"Cannot delete the currently checked-out branch '{branchName}'");
        repo.Branches.Remove(branch);
    }

    public void Rename(string repoPath, string oldName, string newName)
    {
        using var repo = new Repository(repoPath);
        var branch = repo.Branches[oldName]
            ?? throw new InvalidOperationException($"Branch '{oldName}' not found");
        repo.Branches.Rename(branch, newName);
    }
}
