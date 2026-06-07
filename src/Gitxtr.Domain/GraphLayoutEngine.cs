namespace Gitxtr.Domain;

/// <summary>
/// Assigns each commit to a lane (column) and produces the edges connecting rows, i.e. the
/// commit-graph DAG layout. Commits must arrive in display order (newest first), with every
/// commit appearing above all of its parents.
///
/// Algorithm (the classic gitk/tig-style lane assignment, no column compaction):
/// walking top→bottom we keep a list of active lanes, each "targeting" the next commit it
/// expects to reach going downward (reserved by an already-drawn child). For each commit we
/// (1) find the lanes targeting it (its children merge in there), (2) place the node in the
/// leftmost such lane — or a fresh lane if it's a branch tip, (3) route its first parent down
/// the node's lane and each extra (merge) parent into a new lane, reusing any lane already
/// targeting that parent. Each row emits the downward edges leaving it.
/// </summary>
public sealed class GraphLayoutEngine
{
    private const int ColorCount = 8;

    private sealed class Lane(CommitId target, int colorId)
    {
        public CommitId Target = target;
        public int ColorId = colorId;
    }

    public GraphLayout Layout(IReadOnlyList<Commit> commits)
    {
        var rows = new List<GraphRow>(commits.Count);
        var lanes = new List<Lane?>();
        int nextColor = 0;
        int width = 0;

        for (int r = 0; r < commits.Count; r++)
        {
            Commit c = commits[r];

            // 1. Lanes whose target is this commit (drawn children pointing down to it).
            var mine = new List<int>();
            for (int i = 0; i < lanes.Count; i++)
                if (lanes[i] is { } lane && lane.Target.Equals(c.Id))
                    mine.Add(i);

            int nodeColumn;
            int nodeColor;
            if (mine.Count == 0)
            {
                nodeColumn = FirstFree(lanes);
                EnsureSize(lanes, nodeColumn + 1);
                nodeColor = nextColor;
                nextColor = (nextColor + 1) % ColorCount;
            }
            else
            {
                nodeColumn = mine[0];
                nodeColor = lanes[nodeColumn]!.ColorId;
            }

            // Children merge into the node here: terminate every lane that targeted this commit.
            foreach (int i in mine) lanes[i] = null;

            var edges = new List<GraphEdge>();
            var createdThisRow = new HashSet<int>();

            // 2. Route parents downward.
            IReadOnlyList<CommitId> parents = c.Parents;
            for (int pi = 0; pi < parents.Count; pi++)
            {
                CommitId parent = parents[pi];
                int existing = FindLane(lanes, parent);
                int targetCol;
                int colorId;

                if (existing != -1)
                {
                    // Another branch already heads to this parent — merge into that lane.
                    targetCol = existing;
                    colorId = lanes[existing]!.ColorId;
                }
                else if (pi == 0)
                {
                    // First parent continues straight down the node's own lane.
                    targetCol = nodeColumn;
                    colorId = nodeColor;
                    lanes[targetCol] = new Lane(parent, colorId);
                    createdThisRow.Add(targetCol);
                }
                else
                {
                    // Extra (merge) parent branches off into a fresh lane.
                    targetCol = FirstFree(lanes);
                    EnsureSize(lanes, targetCol + 1);
                    colorId = nextColor;
                    nextColor = (nextColor + 1) % ColorCount;
                    lanes[targetCol] = new Lane(parent, colorId);
                    createdThisRow.Add(targetCol);
                }

                edges.Add(new GraphEdge(nodeColumn, targetCol, colorId));
            }

            // 3. Straight pass-through edges for lanes that pre-existed and continue. Lanes
            //    created this row already have a connector edge emanating from the node.
            for (int i = 0; i < lanes.Count; i++)
            {
                if (lanes[i] is null || createdThisRow.Contains(i)) continue;
                edges.Add(new GraphEdge(i, i, lanes[i]!.ColorId));
            }

            rows.Add(new GraphRow(r, c, nodeColumn, nodeColor, edges));
            width = Math.Max(width, lanes.Count);
        }

        return new GraphLayout(rows, width);
    }

    private static int FirstFree(List<Lane?> lanes)
    {
        for (int i = 0; i < lanes.Count; i++)
            if (lanes[i] is null) return i;
        return lanes.Count;
    }

    private static int FindLane(List<Lane?> lanes, CommitId target)
    {
        for (int i = 0; i < lanes.Count; i++)
            if (lanes[i] is { } lane && lane.Target.Equals(target)) return i;
        return -1;
    }

    private static void EnsureSize(List<Lane?> lanes, int size)
    {
        while (lanes.Count < size) lanes.Add(null);
    }
}
