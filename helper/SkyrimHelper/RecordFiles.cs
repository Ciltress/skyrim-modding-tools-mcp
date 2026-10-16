using System.Collections.Concurrent;
using System.Reflection;
using System.Text.RegularExpressions;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Records;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// A project's record files, checked before they are built, so that a mistake is named rather than
/// built: a file outside a group folder or below one, a folder that is no group, a field the record's
/// type does not have, a FormKey that cannot be one — or that names another plugin's record the file
/// does not mean to change. The YAML reader skips what it does not know — an invented <c>damage:</c>
/// gives a weapon without damage and a build that succeeds — and fails on some of it with an exception
/// that names the file but not the field.
/// </summary>
/// <remarks>
/// Fields are a record type's public properties, the names Spriggit writes them under; only the top
/// level of a file is checked. A group's records are files directly in its folder; the records cells,
/// worldspaces and dialogue keep in folders of their own are left to the reader — no other group
/// nests, as five serialized Creation Club plugins show.
/// </remarks>
public static class RecordFiles
{
    /// <summary>The groups whose records sit in folders below the group's own.</summary>
    private static readonly HashSet<string> Nested = new(StringComparer.Ordinal) { "Cells", "Worldspaces", "DialogTopics" };

    /// <summary>A plugin's group folders by name — <c>Weapons</c> → Weapon — and null for a group of nested blocks.</summary>
    private static readonly Dictionary<string, Type?> Groups = typeof(SkyrimMod)
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Where(p => p.PropertyType.IsGenericType && p.PropertyType.Name.Contains("Group", StringComparison.Ordinal))
        .ToDictionary(
            p => p.Name,
            p => p.PropertyType.GetGenericArguments()[0] is var record && typeof(IMajorRecord).IsAssignableFrom(record) ? record : null,
            StringComparer.Ordinal);

    /// <summary>
    /// A vanilla record of each everyday type, to read before writing one: a small model that wrote from
    /// memory invented fields build after build (eval round 11: Gender, Sex, OneHanded, Signature).
    /// </summary>
    private static readonly Dictionary<string, string> Examples = new(StringComparer.Ordinal)
    {
        ["Weapon"] = "IronSword", ["Armor"] = "ArmorIronCuirass", ["Spell"] = "Firebolt",
        ["MagicEffect"] = "FireDamageFFAimed", ["ObjectEffect"] = "EnchWeaponFireDamage01", ["Npc"] = "HousecarlWhiterun"
    };

    /// <summary>The editor ID of a vanilla record of the type — the everyday one, else the first the load order has.</summary>
    private static string? ExampleOf(Type type, RecordIndex index) =>
        Examples.TryGetValue(type.Name, out var example) && index.ByEditorId.TryGetValue(example, out var key)
            && index.ByFormKey.TryGetValue(key, out var entry) && entry.Type == type.Name
            ? example
            : index.ByFormKey.Values.FirstOrDefault(e => e.Type == type.Name && e.EditorId is not null)?.EditorId;

    /// <summary>The group folders a new record of an everyday kind goes into, for messages.</summary>
    public const string CommonGroups = "Weapons, Armors, Spells, MagicEffects, ObjectEffects (enchantments), Npcs, LeveledItems";

    private static readonly ConcurrentDictionary<Type, HashSet<string>> Fields = new();

    private static readonly Regex TopLevelKey = new(@"^([A-Za-z_]\w*)[ \t]*:", RegexOptions.Multiline);
    private static readonly Regex FormKeyLine = new(@"^FormKey:[ \t]*(\S*)[ \t]*\r?$", RegexOptions.Multiline);

    private static readonly Regex ObjectTypeLine = new(@"^MutagenObjectType:[ \t]*(\w+)", RegexOptions.Multiline);
    private static readonly Regex EditorIdLine = new(@"^EditorID:[ \t]*(\S+?)[ \t]*\r?$", RegexOptions.Multiline);
    private static readonly Regex ModKeyLine = new(@"^ModKey:[ \t]*(\S+?)[ \t]*\r?$", RegexOptions.Multiline);

    /// <summary>The file's FormKey and editor ID, as its top-level lines give them.</summary>
    public static (FormKey? FormKey, string? EditorId) Identity(string text) => (
        FormKeyLine.Match(text) is { Success: true } key && FormKey.TryFactory(key.Groups[1].Value, out var formKey) ? formKey : null,
        EditorIdLine.Match(text) is { Success: true } id ? id.Groups[1].Value : null);

    /// <summary>The plugin a project's folder builds, from its RecordData.yaml.</summary>
    public static ModKey? OwnPlugin(string pluginDir)
    {
        var header = Path.Combine(pluginDir, "RecordData.yaml");
        if (!File.Exists(header) || ModKeyLine.Match(File.ReadAllText(header)) is not { Success: true } line) return null;
        return ModKey.TryFromFileName(line.Groups[1].Value, out var key) ? key : (ModKey?)null;
    }

    /// <summary>A record's type as a reader says it — a Weapon, an ObjectEffect.</summary>
    public static string Article(string typeName) => $"{("AEIOU".Contains(typeName[0]) ? "an" : "a")} {typeName}";

    /// <summary>
    /// The record files of the plugin folder that hold one record each: directly in a group's folder,
    /// with that group's record type — or the kind the file names, where a group has several.
    /// </summary>
    public static IEnumerable<(string File, string Relative, Type Type)> FlatRecords(string pluginDir)
    {
        if (!Directory.Exists(pluginDir)) yield break;
        foreach (var file in Directory.EnumerateFiles(pluginDir, "*.yaml", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(pluginDir, file).Replace('\\', '/');
            var parts = relative.Split('/');
            if (parts.Length != 2 || !Groups.TryGetValue(parts[0], out var type) || type is null) continue;
            yield return (file, relative, KindIn(type, File.ReadAllText(file)) ?? type);
        }
    }

    /// <summary>The kind a file of a group of several kinds names — GlobalFloat in Globals — or null.</summary>
    private static Type? KindIn(Type group, string text) =>
        ObjectTypeLine.Match(text) is { Success: true } objectType ? KindOf(group, objectType.Groups[1].Value) : null;

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

    /// <summary>
    /// What a field a type does not have is likely meant to be, as words to append to its name — " (it
    /// is spelled Name)" — or nothing.
    /// </summary>
    public static string HintFor(Type type, string key) =>
        Hint(type, FieldsOf(type), key) is { } hint ? $" ({hint})" : "";

    /// <summary>The kind of a group's records a file names — GlobalFloat for a Global — or null; the same for any polymorphic field.</summary>
    public static Type? KindOf(Type group, string name) =>
        group.Assembly.GetTypes().FirstOrDefault(t => t.Name == name && !t.IsInterface && group.IsAssignableFrom(t));

    /// <summary>
    /// How many record files the plugin folder holds, and what is wrong with any of them. With the load
    /// order's index, a FormKey of another plugin is checked against the record it names.
    /// </summary>
    public static (int Records, List<string> Problems) Check(string pluginDir, RecordIndex? index = null)
    {
        var problems = new List<string>();
        var records = 0;
        if (!Directory.Exists(pluginDir)) return (0, problems);
        var own = OwnPlugin(pluginDir);
        var formKeys = new Dictionary<FormKey, List<string>>();
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

            // Below a group of single records the reader takes nothing for a record, but the file still
            // got a FormID, and the build succeeded empty (eval round 10: Spells/Spells/…).
            if (parts.Length > 2 && !Nested.Contains(parts[0]))
            {
                var into = Groups.ContainsKey(parts[1]) ? string.Join('/', parts[1..]) : $"{parts[0]}/{parts[^1]}";
                problems.Add($"{relative} is in a folder below {parts[0]}/, where the build reads no record: put it directly into its group's folder, as {into}");
                continue;
            }

            var text = File.ReadAllText(file);
            var line = FormKeyLine.Match(text);
            if (line.Success)
            {
                if (!FormKey.TryFactory(line.Groups[1].Value, out var formKey))
                    problems.Add($"{relative}: '{line.Groups[1].Value}' is no FormKey — leave FormKey out of a new record, the build assigns one");
                else if (formKey.ID == 0)
                    problems.Add($"{relative}: {Session.FormKeyText(formKey)} is no record's FormID — leave FormKey out of a new record, the build assigns one");
                else
                    (formKeys.TryGetValue(formKey, out var holders) ? holders : formKeys[formKey] = []).Add(relative);
            }
            if (type is null || parts.Length != 2) continue;
            // The reader takes a record's first line for its FormKey — after the kind, where a group has
            // several (eval round 11: EditorID written above it).
            if (line.Success && TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).FirstOrDefault(k => k != "MutagenObjectType") is { } first
                && first != "FormKey")
                problems.Add($"{relative}: FormKey is the first line of a record file — move it above {first}");
            if (index is not null && Foreign(relative, text, own, index) is { } foreign) problems.Add(foreign);

            // A group of several kinds — Globals: GlobalFloat, GlobalShort… — names the kind in the file.
            var kind = KindIn(type, text);
            var known = FieldsOf(kind ?? type);
            var unknown = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).Where(key => !known.Contains(key)).Distinct().ToList();
            if (unknown.Count == 0) continue;
            var named = unknown.Select(key => Hint(kind ?? type, known, key) is { } hint ? $"{key} ({hint})" : key);
            var read = index is not null && ExampleOf(kind ?? type, index) is { } example
                ? $" — read a vanilla one first, readRecord {{\"record\": \"{example}\"}}, and write yours with its field names and nesting"
                : "";
            problems.Add($"{relative}: {Article(type.Name)} has no field {string.Join(", ", named)}{read}");
        }
        // Two files of one record: the reader names the FormKey but neither file (eval round 11: 000000 in each new record).
        foreach (var (formKey, holders) in formKeys.Where(pair => pair.Value.Count > 1))
            problems.Add($"{string.Join(" and ", holders)} have the same FormKey {Session.FormKeyText(formKey)} — one file per record; " +
                "a new record has no FormKey line, the build assigns one");
        return (records, problems);
    }

    /// <summary>
    /// What is wrong with a file that names another plugin's record: a FormKey copied from the record a
    /// model read makes the build change that record — the Iron Sword "renamed" Flame Blade (eval round
    /// 10) — and one that names no record makes a record the plugin does not have.
    /// </summary>
    private static string? Foreign(string relative, string text, ModKey? own, RecordIndex index)
    {
        var (formKey, editorId) = Identity(text);
        if (formKey is not { } key || key.ModKey == own) return null;
        const string fresh = "a new record has no FormKey line: remove it, and the build assigns one";
        if (!index.ByFormKey.TryGetValue(key, out var entry))
            return $"{relative}: FormKey {Session.FormKeyText(key)} names no record in the load order — {fresh}";
        if (editorId is not null && entry.EditorId is { } theirs && !editorId.Equals(theirs, StringComparison.OrdinalIgnoreCase))
            // Only the way to a new record: offered "keep its editor ID" as well, a model restored it and
            // built an override of a vanilla weapon as its new sword (eval round 11's probes).
            return $"{relative}: FormKey {Session.FormKeyText(key)} is {theirs} of {key.ModKey.FileName}, so this file would change " +
                $"that record instead of making {editorId} — {fresh}";
        return null;
    }

    /// <summary>Throws what is wrong with the files, as the request's fault; answers how many there are.</summary>
    public static int Require(string pluginDir, RecordIndex? index = null)
    {
        var (records, problems) = Check(pluginDir, index);
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

    /// <summary>
    /// A failure of the YAML reader as the request's fault: the file it names, the innermost cause, and
    /// the line the cause points at — "Expected 'MappingStart', got 'Scalar' (at Line: 2…)" alone sent a
    /// model nowhere (eval round 10).
    /// </summary>
    public static HelperException Unreadable(Exception error, string pluginDir)
    {
        var cause = error;
        while (cause.InnerException is not null) cause = cause.InnerException;
        var path = Regex.Match(error.Message, @"filepath:\s*(.+?)\s*$").Groups[1].Value;
        var where = path.Length > 0 ? Path.GetRelativePath(pluginDir, path).Replace('\\', '/') : "A record file";
        var message = cause.Message.Trim();
        var quoted = "";
        if (path.Length > 0 && File.Exists(path) && Regex.Match(message, @"\(at Line: (\d+), Col: (\d+)") is { Success: true } at)
        {
            var lines = File.ReadAllLines(path);
            var number = int.Parse(at.Groups[1].Value);
            if (number >= 1 && number <= lines.Length)
                quoted = $" Line {number} is `{lines[number - 1].Trim()}`{Expected(message)}.";
        }
        return new HelperException("badRecord",
            $"{where} cannot be read as a record: {message}{quoted} Write it the way readRecord shows a record of its " +
            "type — the same field names, nesting and value formats.");
    }

    /// <summary>What the reader's "Expected X, got Y" means for the line it names.</summary>
    private static string Expected(string message) => Regex.Match(message, @"Expected '(\w+)', got '(\w+)'") switch
    {
        { Success: true } m when m.Groups[1].Value == "MappingStart" =>
            ": its field takes fields of its own, indented on the lines below it, not one value",
        { Success: true } m when m.Groups[1].Value == "SequenceStart" =>
            ": its field takes a list, one `- ` item per line below it",
        { Success: true } m when m.Groups[1].Value == "Scalar" =>
            ": its field takes one value on its own line, not fields or a list below it",
        _ => ""
    };
}
