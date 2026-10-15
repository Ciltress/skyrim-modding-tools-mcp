using System.Reflection;
using System.Text.Json.Nodes;
using Loqui;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Aspects;
using Mutagen.Bethesda.Plugins.Records;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// Every record in the load order by FormID and by editor ID, with the plugins that carry it. Placed
/// references, landscape and navmesh are left out: there are hundreds of thousands of them, they rarely
/// carry an editor ID, and the record families this server serves do not search for them.
/// </summary>
public sealed class RecordIndex
{
    public sealed class Entry(FormKey formKey)
    {
        public FormKey FormKey { get; } = formKey;
        public string? EditorId { get; set; }
        public string? Name { get; set; }
        public string Type { get; set; } = "";
        public string Signature { get; set; } = "";
        /// <summary>The getter interface, so a lookup builds the link cache for this type only.</summary>
        public Type GetterType { get; set; } = typeof(IMajorRecordGetter);
        /// <summary>In load order; the last one wins.</summary>
        public List<ModKey> Plugins { get; } = [];

        public JsonObject ToJson() => new()
        {
            ["formId"] = Session.FormKeyText(FormKey),
            ["editorId"] = EditorId,
            ["name"] = Name,
            ["signature"] = Signature,
            ["type"] = Type,
            ["definedIn"] = FormKey.ModKey.FileName.String,
            ["winner"] = Plugins[^1].FileName.String,
            ["overrides"] = Plugins.Count - 1
        };
    }

    public Dictionary<FormKey, Entry> ByFormKey { get; } = [];
    public Dictionary<string, FormKey> ByEditorId { get; } = new(StringComparer.OrdinalIgnoreCase);

    private static readonly HashSet<string> Skipped = new(StringComparer.Ordinal)
    {
        "PlacedObject", "PlacedNpc", "PlacedArrow", "PlacedBarrier", "PlacedBeam", "PlacedCone",
        "PlacedFlame", "PlacedHazard", "PlacedMissile", "PlacedTrap", "Landscape", "NavigationMesh"
    };

    public static RecordIndex Build(IEnumerable<(ModKey Key, ISkyrimModGetter Mod)> loadOrder)
    {
        var index = new RecordIndex();
        foreach (var (key, mod) in loadOrder)
        {
            foreach (var record in mod.EnumerateMajorRecords())
            {
                var type = TypeName(record);
                if (Skipped.Contains(type)) continue;
                if (!index.ByFormKey.TryGetValue(record.FormKey, out var entry))
                {
                    entry = new Entry(record.FormKey)
                    {
                        Type = type,
                        Signature = Signature(record),
                        GetterType = ((ILoquiObject)record).Registration.GetterType
                    };
                    index.ByFormKey[record.FormKey] = entry;
                }
                entry.Plugins.Add(key);
                // The winner's identity is the one that counts, so later plugins overwrite.
                if (record.EditorID is { Length: > 0 } editorId) entry.EditorId = editorId;
                if (record is INamedGetter { Name: { Length: > 0 } name }) entry.Name = name;
            }
        }
        foreach (var entry in index.ByFormKey.Values)
            if (entry.EditorId is { } editorId) index.ByEditorId.TryAdd(editorId, entry.FormKey);
        return index;
    }

    public static string TypeName(IMajorRecordGetter record)
    {
        var name = record.GetType().Name;
        return name.EndsWith("BinaryOverlay", StringComparison.Ordinal) ? name[..^"BinaryOverlay".Length] : name;
    }

    public static string Signature(IMajorRecordGetter record) =>
        Signatures.TryGetValue(TypeName(record), out var signature) ? signature : "";

    /// <summary>Mutagen class name -> four-letter signature, read from the generated registrations.</summary>
    private static readonly Dictionary<string, string> Signatures = typeof(ISkyrimModGetter).Assembly.GetTypes()
        .Where(t => t.Name.EndsWith("_Registration", StringComparison.Ordinal))
        .Select(t => (Name: t.Name[..^"_Registration".Length],
            Value: t.GetField("TriggeringRecordType", BindingFlags.Public | BindingFlags.Static)?.GetValue(null)))
        .Where(x => x.Value is RecordType)
        .GroupBy(x => x.Name)
        .ToDictionary(g => g.Key, g => ((RecordType)g.First().Value!).Type, StringComparer.Ordinal);
}
