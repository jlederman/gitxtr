namespace Gitxtr.Application;

public enum GitConfigScope { Global, Local }

/// <summary>The user.name/user.email values at both global and the current repo's local scope.
/// Any field may be null when unset.</summary>
public sealed record GitIdentity(string? GlobalName, string? GlobalEmail, string? LocalName, string? LocalEmail);

public interface IGitConfigService
{
    /// <summary>Read global identity, plus local identity for <paramref name="repoPath"/> when given.</summary>
    GitIdentity Get(string? repoPath);

    /// <summary>Write user.name/user.email at the requested scope. Local scope requires a repo.</summary>
    void Set(string? repoPath, GitConfigScope scope, string name, string email);
}
