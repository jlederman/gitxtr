namespace Gitxt.Application;

public sealed record WorkingTreeFileDto(string Path, string Status, bool Staged, string Patch);
public sealed record WorkingTreeViewDto(
    IReadOnlyList<WorkingTreeFileDto> Staged,
    IReadOnlyList<WorkingTreeFileDto> Unstaged);

public interface IWorkingTreeService
{
    bool HasChanges(string repoPath);
    WorkingTreeViewDto GetView(string repoPath);
    void StageFile(string repoPath, string filePath);
    void UnstageFile(string repoPath, string filePath);
    void DiscardFile(string repoPath, string filePath);
    void StageAll(string repoPath);
    void UnstageAll(string repoPath);
}
