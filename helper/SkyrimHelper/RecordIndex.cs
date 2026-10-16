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

    /// <summary>The getter types of the records the index leaves out, of which it cannot say that one is missing.</summary>
    public static readonly Type[] SkippedTypes = Skipped
        .Select(name => typeof(ISkyrimModGetter).Assembly.GetType($"Mutagen.Bethesda.Skyrim.I{name}Getter")!)
        .ToArray();

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

    /// <summary>Whether a filter names a record type: a signature like WEAP, or a type name like Weapon.</summary>
    public static bool IsRecordType(string name) =>
        Signatures.Keys.Any(k => k.Equals(name, StringComparison.OrdinalIgnoreCase))
        || Signatures.Values.Any(s => s.Equals(name, StringComparison.OrdinalIgnoreCase));

    /// <summary>The real record types closest to a misspelled one, e.g. WEAP (Weapon) for WEPN.</summary>
    public static IEnumerable<string> Closest(string name) => Signatures
        .SelectMany(pair => new[] { (Text: pair.Value, Shown: $"{pair.Value} ({pair.Key})"), (Text: pair.Key, Shown: $"{pair.Value} ({pair.Key})") })
        .Select(c => (c.Shown, Distance: Distance(c.Text.ToUpperInvariant(), name.ToUpperInvariant()),
            Prefix: c.Text.Zip(name).TakeWhile(p => char.ToUpperInvariant(p.First) == char.ToUpperInvariant(p.Second)).Count()))
        .Where(c => c.Distance <= Math.Max(2, name.Length / 3))
        .OrderBy(c => c.Distance)
        .ThenByDescending(c => c.Prefix)
        .Select(c => c.Shown)
        .Distinct()
        .Take(3);

    public static int Distance(string a, string b)
    {
        var row = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var previous = row[0];
            row[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var current = row[j];
                row[j] = Math.Min(Math.Min(row[j] + 1, row[j - 1] + 1), previous + (a[i - 1] == b[j - 1] ? 0 : 1));
                previous = current;
            }
        }
        return row[b.Length];
    }

    /// <summary>Mutagen class name -> four-letter signature, read from the generated registrations.</summary>
    private static readonly Dictionary<string, string> Signatures = typeof(ISkyrimModGetter).Assembly.GetTypes()
        .Where(t => t.Name.EndsWith("_Registration", StringComparison.Ordinal))
        .Select(t => (Name: t.Name[..^"_Registration".Length],
            Value: t.GetField("TriggeringRecordType", BindingFlags.Public | BindingFlags.Static)?.GetValue(null)))
        .Where(x => x.Value is RecordType)
        .GroupBy(x => x.Name)
        .ToDictionary(g => g.Key, g => ((RecordType)g.First().Value!).Type, StringComparer.Ordinal);
}
