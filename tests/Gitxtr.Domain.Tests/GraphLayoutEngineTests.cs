using Gitxtr.Domain;

namespace Gitxtr.Domain.Tests;

public class GraphLayoutEngineTests
{
    private static readonly GraphLayoutEngine Engine = new();

    /// <summary>Build a commit. Parents are given newest-relevant first (index 0 = first parent).</summary>
    private static Commit C(string id, params string[] parents) =>
        new(new CommitId(id),
            parents.Select(p => new CommitId(p)).ToArray(),
            $"commit {id}", "tester", DateTimeOffset.UnixEpoch);

    private static int Col(GraphLayout l, string id) =>
        l.Rows.Single(r => r.Commit.Id.Sha == id).Column;

    [Fact]
    public void LinearHistory_AllInColumnZero()
    {
        // c <- b <- a  (newest first)
        var layout = Engine.Layout([C("c", "b"), C("b", "a"), C("a")]);

        Assert.Equal(0, Col(layout, "c"));
        Assert.Equal(0, Col(layout, "b"));
        Assert.Equal(0, Col(layout, "a"));
        Assert.Equal(1, layout.Width);

        // Each non-root row continues straight down; the root has no edges below.
        Assert.Equal(new GraphEdge(0, 0, 0), Assert.Single(layout.Rows[0].EdgesBelow));
        Assert.Equal(new GraphEdge(0, 0, 0), Assert.Single(layout.Rows[1].EdgesBelow));
        Assert.Empty(layout.Rows[2].EdgesBelow);
    }

    [Fact]
    public void BranchAndMerge_FeatureGetsSecondLane_AndMergesBack()
    {
        //   M  (merge of C and D)
        //   C   D        D branched off B, C is mainline
        //    \ /
        //     B
        //     A
        var layout = Engine.Layout([
            C("M", "C", "D"),
            C("C", "B"),
            C("D", "B"),
            C("B", "A"),
            C("A"),
        ]);

        Assert.Equal(0, Col(layout, "M"));
        Assert.Equal(0, Col(layout, "C"));
        Assert.Equal(1, Col(layout, "D")); // feature parent takes a second lane
        Assert.Equal(0, Col(layout, "B"));
        Assert.Equal(0, Col(layout, "A"));
        Assert.Equal(2, layout.Width);

        // M branches to two lanes (first parent stays in col 0, merge parent opens col 1).
        var m = layout.Rows[0].EdgesBelow;
        Assert.Contains(m, e => e is { FromColumn: 0, ToColumn: 0 });
        Assert.Contains(m, e => e is { FromColumn: 0, ToColumn: 1 });

        // D (col 1) merges back into B's lane (col 0): a connector from col 1 to col 0.
        var d = layout.Rows[2].EdgesBelow;
        Assert.Contains(d, e => e is { FromColumn: 1, ToColumn: 0 });
    }

    [Fact]
    public void OctopusMerge_SpreadsToThreeLanesThenCollapses()
    {
        //   M  (parents A, B, C)
        //   A B C   all share root R
        //    \|/
        //     R
        var layout = Engine.Layout([
            C("M", "A", "B", "C"),
            C("A", "R"),
            C("B", "R"),
            C("C", "R"),
            C("R"),
        ]);

        Assert.Equal(0, Col(layout, "M"));
        Assert.Equal(0, Col(layout, "A"));
        Assert.Equal(1, Col(layout, "B"));
        Assert.Equal(2, Col(layout, "C"));
        Assert.Equal(0, Col(layout, "R"));
        Assert.Equal(3, layout.Width);

        // The merge fans out from col 0 to three lanes.
        var m = layout.Rows[0].EdgesBelow;
        Assert.Equal(3, m.Count);
        Assert.Contains(m, e => e.ToColumn == 0);
        Assert.Contains(m, e => e.ToColumn == 1);
        Assert.Contains(m, e => e.ToColumn == 2);

        // B and C both rejoin R's lane in column 0.
        Assert.Contains(layout.Rows[2].EdgesBelow, e => e is { FromColumn: 1, ToColumn: 0 });
        Assert.Contains(layout.Rows[3].EdgesBelow, e => e is { FromColumn: 2, ToColumn: 0 });
    }

    [Fact]
    public void EmptyHistory_ProducesEmptyLayout()
    {
        var layout = Engine.Layout([]);
        Assert.Empty(layout.Rows);
        Assert.Equal(0, layout.Width);
    }
}
