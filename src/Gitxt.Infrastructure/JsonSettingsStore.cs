using System.Text.Json;
using Gitxt.Application;

namespace Gitxt.Infrastructure;

/// <summary>Persists <see cref="Settings"/> to ~/.config/gitxt/settings.json (per
/// SpecialFolder.ApplicationData). Writes atomically (temp file + move) so a crash mid-write
/// can't corrupt the file; a missing or unreadable file falls back to defaults.</summary>
public sealed class JsonSettingsStore : ISettingsStore
{
    private static readonly JsonSerializerOptions Opts =
        new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _path;

    public JsonSettingsStore()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "gitxt");
        _path = Path.Combine(dir, "settings.json");
    }

    public Settings Load()
    {
        try
        {
            if (File.Exists(_path))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(_path), Opts) ?? new Settings();
        }
        catch
        {
            // Corrupt/unreadable settings should never block startup — fall back to defaults.
        }
        return new Settings();
    }

    public void Save(Settings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(settings, Opts));
        File.Move(tmp, _path, overwrite: true);
    }
}
