using System.Collections.Concurrent;
using System.Reflection;
using System.Text.RegularExpressions;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Records;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// A project's record files, checked before they are built, so that a mistake is named rather than
/// built: a file outside a group folder, a folder that is no group, a field the record's type does not
/// have, a FormKey that cannot be one. The YAML reader skips what it does not know — an invented
/// <c>damage:</c> gives a weapon without damage and a build that succeeds — and fails on some of it
/// with an exception that names the file but not the field.
/// </summary>
/// <remarks>
/// Fields are a record type's public properties, the names Spriggit writes them under; only the top
/// level of a file is checked. A group's records are files directly in its folder; the records cells,
/// worldspaces and dialogue keep in folders of their own are left to the reader.
/// </remarks>
public static class RecordFiles
{
    /// <summary>A plugin's group folders by name — <c>Weapons</c> → Weapon — and null for a group of nested blocks.</summary>
    private static readonly Dictionary<string, Type?> Groups = typeof(SkyrimMod)
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Where(p => p.PropertyType.IsGenericType && p.PropertyType.Name.Contains("Group", StringComparison.Ordinal))
        .ToDictionary(
            p => p.Name,
            p => p.PropertyType.GetGenericArguments()[0] is var record && typeof(IMajorRecord).IsAssignableFrom(record) ? record : null,
            StringComparer.Ordinal);

    /// <summary>The group folders a new record of an everyday kind goes into, for messages.</summary>
    public const string CommonGroups = "Weapons, Armors, Spells, MagicEffects, ObjectEffects (enchantments), Npcs, LeveledItems";

    private static readonly ConcurrentDictionary<Type, HashSet<string>> Fields = new();

    private static readonly Regex TopLevelKey = new(@"^([A-Za-z_]\w*)[ \t]*:", RegexOptions.Multiline);
    private static readonly Regex FormKeyLine = new(@"^FormKey:[ \t]*(\S*)[ \t]*\r?$", RegexOptions.Multiline);

    private static readonly Regex ObjectTypeLine = new(@"^MutagenObjectType:[ \t]*(\w+)", RegexOptions.Multiline);

    /// <summary>A record type's fields, and MutagenObjectType, which names the kind where a group has several.</summary>
    private static HashSet<string> FieldsOf(Type type) =>
        Fields.GetOrAdd(type, t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name)
            .Append("MutagenObjectType").ToHashSet(StringComparer.Ordinal));

    /// <summary>
    /// What an unknown field is likely meant to be: a field spelled otherwise (<c>name</c> → Name), or one
    /// that belongs inside another (a weapon's <c>Weight</c> → under BasicStats).
    /// </summary>
    private static string? Hint(Type type, HashSet<string> known, string key)
    {
        if (known.FirstOrDefault(k => k.Equals(key, StringComparison.OrdinalIgnoreCase)) is { } spelled) return $"it is spelled {spelled}";
        var parent = type.GetProperties(BindingFlags.Public | BindingFlags.Instance).FirstOrDefault(p =>
            p.PropertyType is { IsPrimitive: false, IsEnum: false } inner && inner != typeof(string) &&
            inner.GetProperty(key, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase) is not null);
        return parent is null ? null : $"it goes under {parent.Name}";
    }

    /// <summary>The kind of a group's records a file names — GlobalFloat for a Global — or null.</summary>
    private static Type? KindOf(Type group, string name) =>
        group.Assembly.GetTypes().FirstOrDefault(t => t.Name == name && !t.IsInterface && group.IsAssignableFrom(t));

    /// <summary>How many record files the plugin folder holds, and what is wrong with any of them.</summary>
    public static (int Records, List<string> Problems) Check(string pluginDir)
    {
        var problems = new List<string>();
        var records = 0;
        if (!Directory.Exists(pluginDir)) return (0, problems);
        foreach (var file in Directory.EnumerateFiles(pluginDir, "*.*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(pluginDir, file).Replace('\\', '/');
            if (relative == "RecordData.yaml") continue;
            if (file.EndsWith(".yml", StringComparison.OrdinalIgnoreCase))
            {
                problems.Add($"{relative} ends in .yml, which the build does not read: name it .yaml");
                continue;
            }
            if (!file.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)) continue;
            records++;

            var parts = relative.Split('/');
            if (parts.Length == 1)
            {
                problems.Add($"{relative} is in no group folder: put it into its type's, e.g. Weapons/{relative}");
                continue;
            }
            if (!Groups.TryGetValue(parts[0], out var type))
            {
                var spelled = Groups.Keys.FirstOrDefault(g => g.Equals(parts[0], StringComparison.OrdinalIgnoreCase));
                problems.Add(spelled is not null
                    ? $"{relative}: the folder is spelled {spelled}, not {parts[0]}"
                    : $"{relative}: '{parts[0]}' is no group folder — use the one readRecord's pathInPluginFolder names for the type, such as {CommonGroups}");
                continue;
            }

            var text = File.ReadAllText(file);
            if (FormKeyLine.Match(text) is { Success: true } line && !FormKey.TryFactory(line.Groups[1].Value, out _))
            {
                problems.Add($"{relative}: '{line.Groups[1].Value}' is no FormKey — leave FormKey out of a new record, the build assigns one");
            }
            if (type is null || parts.Length != 2) continue;

            // A group of several kinds — Globals: GlobalFloat, GlobalShort… — names the kind in the file.
            var kind = ObjectTypeLine.Match(text) is { Success: true } objectType ? KindOf(type, objectType.Groups[1].Value) : null;
            var known = FieldsOf(kind ?? type);
            var unknown = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).Where(key => !known.Contains(key)).Distinct().ToList();
            if (unknown.Count == 0) continue;
            var named = unknown.Select(key => Hint(kind ?? type, known, key) is { } hint ? $"{key} ({hint})" : key);
            problems.Add($"{relative}: {("AEIOU".Contains(type.Name[0]) ? "an" : "a")} {type.Name} has no field {string.Join(", ", named)}");
        }
        return (records, problems);
    }

    /// <summary>Throws what is wrong with the files, as the request's fault; answers how many there are.</summary>
    public static int Require(string pluginDir)
    {
        var (records, problems) = Check(pluginDir);
        if (problems.Count > 0)
        {
            throw new HelperException("badRecord",
                $"{problems.Count} record file(s) cannot be built as written: {string.Join("; ", problems.Take(12))}" +
                (problems.Count > 12 ? "; …" : "") +
                ". Write each record the way readRecord shows a record of its type — the same field names, nesting and " +
                "folder — changing only the values.");
        }
        return records;
    }

    /// <summary>A failure of the YAML reader as the request's fault: the file it names, and the innermost cause.</summary>
    public static HelperException Unreadable(Exception error, string pluginDir)
    {
        var cause = error;
        while (cause.InnerException is not null) cause = cause.InnerException;
        var path = Regex.Match(error.Message, @"filepath:\s*(.+?)\s*$").Groups[1].Value;
        var where = path.Length > 0 ? Path.GetRelativePath(pluginDir, path).Replace('\\', '/') : "A record file";
        return new HelperException("badRecord",
            $"{where} cannot be read as a record: {cause.Message.Trim()} Write it the way readRecord shows a record of its " +
            "type — the same field names, nesting and value formats.");
    }
}
