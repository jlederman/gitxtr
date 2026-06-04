namespace Gitxt.Application;

public sealed record WorkingTreeFileDto(string Path, string Status, bool Staged, string Patch);
public sealed record WorkingTreeViewDto(
    IReadOnlyList<WorkingTreeFileDto> Staged,
    IReadOnlyList<WorkingTreeFileDto> Unstaged,
    string LastCommitMessage);

public sealed record RebaseStep(string Sha, string Action); // Action: "pick"|"squash"|"fixup"|"drop"

public interface IWorkingTreeService
{
    bool HasChanges(string repoPath);
    WorkingTreeViewDto GetView(string repoPath);
    void StageFile(string repoPath, string filePath);
    void UnstageFile(string repoPath, string filePath);
    void DiscardFile(string repoPath, string filePath);
    void StageAll(string repoPath);
    void UnstageAll(string repoPath);
    void CreateCommit(string repoPath, string message, bool amend);
    void RevertCommit(string repoPath, string sha);
    void CherryPick(string repoPath, string sha);
    void InteractiveRebase(string repoPath, IReadOnlyList<RebaseStep> steps);
}
