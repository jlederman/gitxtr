using Gitxt.Application;
using LibGit2Sharp;

namespace Gitxt.Infrastructure;

/// <summary>Reads/writes user.name and user.email via libgit2's configuration. When a repo path
/// is supplied, <c>repo.Config</c> exposes both Global and Local levels; otherwise a standalone
/// configuration is built that still discovers the global (~/.gitconfig) file.</summary>
public sealed class LibGit2SharpGitConfigService : IGitConfigService
{
    public GitIdentity Get(string? repoPath)
    {
        if (!string.IsNullOrEmpty(repoPath) && Repository.IsValid(repoPath))
        {
            using var repo = new Repository(repoPath);
            var c = repo.Config;
            return new GitIdentity(
                c.Get<string>("user.name", ConfigurationLevel.Global)?.Value,
                c.Get<string>("user.email", ConfigurationLevel.Global)?.Value,
                c.Get<string>("user.name", ConfigurationLevel.Local)?.Value,
                c.Get<string>("user.email", ConfigurationLevel.Local)?.Value);
        }

        using var global = Configuration.BuildFrom(null);
        return new GitIdentity(
            global.Get<string>("user.name", ConfigurationLevel.Global)?.Value,
            global.Get<string>("user.email", ConfigurationLevel.Global)?.Value,
            null, null);
    }

    public void Set(string? repoPath, GitConfigScope scope, string name, string email)
    {
        var level = scope == GitConfigScope.Local ? ConfigurationLevel.Local : ConfigurationLevel.Global;
        bool haveRepo = !string.IsNullOrEmpty(repoPath) && Repository.IsValid(repoPath);

        if (level == ConfigurationLevel.Local && !haveRepo)
            throw new InvalidOperationException("Select a repository before editing its local git identity.");

        if (haveRepo)
        {
            using var repo = new Repository(repoPath!);
            Apply(repo.Config, level, name, email);
        }
        else
        {
            using var global = Configuration.BuildFrom(null);
            Apply(global, level, name, email);
        }
    }

    // An empty value unsets the key (rather than writing an empty string), so clearing a field
    // in the UI removes the override instead of silently doing nothing.
    private static void Apply(Configuration cfg, ConfigurationLevel level, string name, string email)
    {
        SetOrUnset(cfg, "user.name", name, level);
        SetOrUnset(cfg, "user.email", email, level);
    }

    private static void SetOrUnset(Configuration cfg, string key, string value, ConfigurationLevel level)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            try { cfg.Unset(key, level); }
            catch (LibGit2SharpException) { /* nothing set at this level — nothing to clear */ }
        }
        else
        {
            cfg.Set(key, value, level);
        }
    }
}
