namespace Gitxt.Application;

/// <summary>Persisted user preferences (theme, font, panel sizes, known repos). Stored as
/// JSON; all fields have defaults so a missing/partial file degrades gracefully.</summary>
public sealed record Settings
{
    public string Theme { get; init; } = "mocha";
    public string FontFamily { get; init; } = "ui-monospace, monospace";
    public int FontSize { get; init; } = 13;
    public int DetailHeight { get; init; } = 320;
    public IReadOnlyList<string> Repos { get; init; } = [];
    public string? LastRepo { get; init; }
}

public interface ISettingsStore
{
    Settings Load();
    void Save(Settings settings);
}
