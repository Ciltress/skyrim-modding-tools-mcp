using System.Text.Json;
using System.Text.Json.Nodes;
using Mutagen.Bethesda.Plugins;

namespace SkyrimHelper;

/// <summary>
/// The record of the load order each link written by editor ID named when a build first resolved it, kept beside the
/// project's plugin folder in links.lock.json. The project's files keep the editor IDs their author wrote — the build
/// writes the FormIDs only into the copy the reader reads — and a mod installed later whose record has the same editor
/// ID does not change what the link names: the index keeps the first of several, and the first can change.
/// </summary>
public static class LinkPins
{
    public const string FileName = "links.lock.json";

    private static string PathOf(string pluginDir) => Path.Combine(Path.GetDirectoryName(Path.GetFullPath(pluginDir))!, FileName);

    /// <summary>Each pinned editor ID and the FormKey it names; empty with no file, or one that reads as none.</summary>
    public static Dictionary<string, FormKey> Read(string pluginDir)
    {
        var pins = new Dictionary<string, FormKey>(StringComparer.OrdinalIgnoreCase);
        var file = PathOf(pluginDir);
        if (!File.Exists(file)) return pins;
        try
        {
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject links)
                foreach (var (editorId, value) in links)
                    if (value is JsonValue text && text.TryGetValue<string>(out var raw) && FormKey.TryFactory(raw, out var key)) pins[editorId] = key;
        }
        catch (JsonException)
        {
            // Hand-edited into no JSON: the links resolve afresh, and the next build writes the file again.
        }
        return pins;
    }

    /// <summary>
    /// Adds the links a build resolved to records of the load order, from its `resolvedLinks`, and writes the file when
    /// that changed it. The project's own records are named by their files, and pinned there.
    /// </summary>
    public static void Add(string pluginDir, Dictionary<string, FormKey> pins, JsonArray resolved, ModKey own)
    {
        var changed = false;
        foreach (var link in resolved.OfType<JsonObject>())
        {
            var editorId = link["from"]?.GetValue<string>().Split(':')[0];
            if (editorId is null || !FormKey.TryFactory(link["to"]?.GetValue<string>(), out var key) || key.ModKey == own) continue;
            if (pins.TryGetValue(editorId, out var was) && was == key) continue;
            pins[editorId] = key;
            changed = true;
        }
        if (!changed) return;
        var json = new JsonObject();
        foreach (var (editorId, key) in pins.OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase)) json[editorId] = Session.FormKeyText(key);
        File.WriteAllText(PathOf(pluginDir), json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
    }
}
