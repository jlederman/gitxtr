using System.Diagnostics;
using Gitxt.Application;
using Gitxt.Domain;
using Gitxt.Infrastructure;

namespace Gitxt.Domain.Tests;

// Integration tests for #8: viewing a merge commit's diff against a chosen parent, or
// combined (--cc) against all parents. Builds a real repo with a conflict-resolved merge.
public sealed class MergeCommitDiffTests : IDisposable
{
    private readonly string _repo;
    private readonly string _mergeSha;
    private readonly IGraphQueryService _service;

    public MergeCommitDiffTests()
    {
        _repo = Path.Combine(Path.GetTempPath(), "gitxt-merge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_repo);

        Git("init", "-q", "-b", "main");
        Git("config", "user.email", "t@t.c");
        Git("config", "user.name", "tester");

        Write("line1\nshared\nline3\n");
        Git("add", "f.txt"); Git("commit", "-qm", "A: base");

        Git("checkout", "-q", "-b", "feature");
        Write("line1\nFEATURE\nline3\n");
        Git("commit", "-qam", "B: feature change");

        Git("checkout", "-q", "main");
        Write("line1\nMAIN\nline3\n");
        Git("commit", "-qam", "C: main change");

        // Conflicting merge, then resolve to a third value so the combined diff is non-empty.
        Git(allowFailure: true, "merge", "feature", "-m", "M: merge");
        Write("line1\nRESOLVED\nline3\n");
        Git("add", "f.txt"); Git("commit", "-qm", "M: merge resolved");

        _mergeSha = Git("rev-parse", "HEAD").stdout.Trim();
        _service = new GraphQueryService(new LibGit2SharpRepositoryReader(), new GraphLayoutEngine());
    }

    [Fact]
    public void MergeCommit_ReportsAllParents()
    {
        var d = _service.GetCommitDetails(_repo, _mergeSha);
        Assert.Equal(2, d.Parents.Count);
    }

    [Fact]
    public void DiffAgainstEachParent_Differs()
    {
        var vsParent1 = _service.GetCommitDetails(_repo, _mergeSha, parentIndex: 0);
        var vsParent2 = _service.GetCommitDetails(_repo, _mergeSha, parentIndex: 1);

        // Parent 1 is main (MAIN→RESOLVED); parent 2 is feature (FEATURE→RESOLVED).
        Assert.Contains("-MAIN", vsParent1.Diff);
        Assert.Contains("+RESOLVED", vsParent1.Diff);
        Assert.Contains("-FEATURE", vsParent2.Diff);
        Assert.NotEqual(vsParent1.Diff, vsParent2.Diff);
    }

    [Fact]
    public void CombinedDiff_UsesCcFormat()
    {
        var combined = _service.GetCommitDetails(_repo, _mergeSha, combined: true);

        Assert.Contains("diff --cc f.txt", combined.Diff);
        Assert.Contains("@@@", combined.Diff); // combined hunk header
        Assert.Single(combined.Files);
        Assert.Equal("f.txt", combined.Files[0].Path);
    }

    private void Write(string content) => File.WriteAllText(Path.Combine(_repo, "f.txt"), content);

    private (string stdout, int code) Git(params string[] args) => Run(false, args);
    private (string stdout, int code) Git(bool allowFailure, params string[] args) => Run(allowFailure, args);

    private (string stdout, int code) Run(bool allowFailure, string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = _repo,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        string outp = p.StandardOutput.ReadToEnd();
        p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (!allowFailure && p.ExitCode != 0)
            throw new InvalidOperationException($"git {string.Join(' ', args)} failed ({p.ExitCode})");
        return (outp, p.ExitCode);
    }

    public void Dispose()
    {
        try { Directory.Delete(_repo, recursive: true); } catch { /* best effort */ }
    }
}
