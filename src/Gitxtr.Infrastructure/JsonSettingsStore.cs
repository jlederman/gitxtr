using System.Text.Json;
using Gitxtr.Application;
using Microsoft.Extensions.Logging;

namespace Gitxtr.Infrastructure;

/// <summary>Persists <see cref="Settings"/> to ~/.config/gitxtr/settings.json (per
/// SpecialFolder.ApplicationData). Writes atomically (temp file + move) so a crash mid-write
/// can't corrupt the file; a missing or unreadable file falls back to defaults.</summary>
public sealed class JsonSettingsStore(ILogger<JsonSettingsStore> logger) : ISettingsStore
{
    private static readonly JsonSerializerOptions Opts =
        new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _path = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "gitxtr", "settings.json");

    public Settings Load()
    {
        try
        {
            if (File.Exists(_path))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(_path), Opts) ?? new Settings();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read settings from {Path} — falling back to defaults", _path);
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
