namespace Gitxtr.Application;

public sealed record BranchDto(string Name, bool IsHead, string? UpstreamName);

public interface IBranchService
{
    IReadOnlyList<BranchDto> GetBranches(string repoPath);
    void Checkout(string repoPath, string branchName);
    BranchDto Create(string repoPath, string branchName, string sha, bool checkout);
    void Delete(string repoPath, string branchName);
    void Rename(string repoPath, string oldName, string newName);
}
