namespace Gitxt.Domain;

/// <summary>A git object id (commit SHA). Value object — equality by SHA.</summary>
public readonly record struct CommitId(string Sha)
{
    public string Short => Sha.Length >= 7 ? Sha[..7] : Sha;
    public override string ToString() => Sha;
}
