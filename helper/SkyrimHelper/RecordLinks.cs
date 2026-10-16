using System.Globalization;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Skyrim;
using Mutagen.Bethesda.Strings;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace SkyrimHelper;

/// <summary>
/// Links written by editor ID — <c>BaseEffect: StormBoltDamage</c>, <c>ObjectEffect: FlameBladeEnch:FlameBlade.esp</c>
/// — replaced in their files by the FormKey of the record they name, before the build reads them. The
/// reader takes a link as a FormKey only, and a new record's FormKey exists only once the build assigned
/// it: models named the record they had just written by its editor ID, and the build failed with
/// "Malformed FormKey string" (eval round 10).
/// </summary>
/// <remarks>
/// A value is a link when the field it is written under is one in Mutagen's record class — so a
/// <c>Name</c> that happens to equal an editor ID stays as written. The project's own records are looked
/// up first, then the load order's; the record found must be of a type the field takes. A link written
/// as another plugin's FormKey is held to the same: a record of the load order, of a type the field takes.
/// Only records directly in a group's folder are read; cells, worldspaces and dialogue are left as written.
/// </remarks>
public static class RecordLinks
{
    private static readonly Regex ByEditorId = new(@"^(?<id>[A-Za-z0-9_]+)(?::(?<plugin>\S+\.es[mpl]))?$", RegexOptions.IgnoreCase);
    /// <summary>A FormID without its plugin, or with the load-order slot in front: 012EB7, 00012EB7, 00012EB7:Skyrim.esm.</summary>
    /// A plugin is a plugin's file name: F000123:CustomFireEnchantment is none (eval round 11's probes).
    private static readonly Regex LoadOrderFormId = new(@"^[0-9A-Fa-f]{0,2}(?<local>[0-9A-Fa-f]{6})(?::(?<plugin>\S+\.es[mpl]))?$", RegexOptions.IgnoreCase);

    /// <summary>A record a link may name; a new record of the project has no FormKey until the build assigns one.</summary>
    private sealed record Target(FormKey? FormKey, string EditorId, Type Type);
    private sealed record Replacement(int Start, int End, string Text);

    /// <summary>
    /// Writes the FormKey of the record each editor-ID link names into its file, and answers what was
    /// replaced. Throws, changing no file, when a link names no record of a type its field takes.
    /// Without <paramref name="write"/> it only throws: checked before FormIDs are assigned, a refusal
    /// leaves every file under the name its author knows — refused after, a model went on fixing the
    /// file under its old name, which made a second record (eval round 11).
    /// </summary>
    public static JsonArray Resolve(string pluginDir, RecordIndex index, bool write)
    {
        var (own, unnamed) = OwnRecords(pluginDir);
        var ownPlugin = RecordFiles.OwnPlugin(pluginDir);
        var resolved = new JsonArray();
        var problems = new List<string>();
        var rewrites = new List<(string File, string Text)>();

        foreach (var (file, relative, type) in RecordFiles.FlatRecords(pluginDir))
        {
            var text = File.ReadAllText(file);
            var yaml = new YamlStream();
            try
            {
                yaml.Load(new StringReader(text));
            }
            catch (YamlException e)
            {
                // Named before the build numbers the file and renames it, with the line it breaks on.
                var lines = text.Split('\n');
                var at = (int)e.Start.Line;
                var where = at >= 1 && at <= lines.Length ? $"line {at}, `{lines[at - 1].Trim()}`" : $"line {at}";
                var reason = Regex.Replace(e.Message, @"^\(Line:[^)]*\)( - \(Line:[^)]*\))?:\s*", "").Trim();
                problems.Add($"{relative}: the YAML breaks at {where}: {reason} Indent a field's own fields by two spaces below it, " +
                    "and give every other line a `Field: value`");
                continue;
            }
            if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode root) continue;

            var replacements = new List<Replacement>();
            void Link(YamlScalarNode value, Type takes, string field)
            {
                var raw = value.Value?.Trim() ?? "";
                if (raw.Length == 0 || raw is "~" || raw.Equals("null", StringComparison.OrdinalIgnoreCase)) return;
                var wanted = Kind(takes);
                if (FormKey.TryFactory(raw, out var linked))
                {
                    // A FormID written from memory names another record, or none: Race: 011F7B:Skyrim.esm
                    // (eval round 11's probes). The project's own are numbered by the build, and checked after it.
                    if (linked.ModKey != ownPlugin && Mismatch(linked, takes, index) is { } mismatch)
                        problems.Add($"{relative}: {field} is {raw}, {mismatch}; {field} takes {RecordFiles.Article(wanted)} — " +
                            $"write the editor ID of the one meant, or its FormID as findRecords answers it");
                    return;
                }
                if (LoadOrderFormId.Match(raw) is { Success: true } numbered)
                {
                    // 00012EB7 as the console shows it: the load-order slot first, and no plugin.
                    problems.Add($"{relative}: {field} is {raw} — a FormID is six digits and the plugin that defines the record, " +
                        $"as findRecords answers it: {numbered.Groups["local"].Value}:" +
                        (numbered.Groups["plugin"].Success ? numbered.Groups["plugin"].Value : "Skyrim.esm for a record of Skyrim.esm"));
                    return;
                }
                if (ByEditorId.Match(raw) is not { Success: true } written)
                {
                    problems.Add($"{relative}: {field} is '{raw}' — a link is a FormID like 012EB7:Skyrim.esm, or the editor ID of {RecordFiles.Article(wanted)}");
                    return;
                }
                var editorId = written.Groups["id"].Value;
                var found = own.TryGetValue(editorId, out var mine) ? mine
                    : index.ByEditorId.TryGetValue(editorId, out var key) && index.ByFormKey.TryGetValue(key, out var entry)
                        ? new Target(key, entry.EditorId ?? editorId, entry.GetterType)
                        : null;
                if (found is null)
                {
                    var near = Near(editorId, takes, own, index);
                    // A record of the project written without an EditorID line has no name a link can use (eval round 11).
                    var nameless = unnamed.Where(u => takes.IsAssignableFrom(u.Type)).Select(u => u.Relative).ToList();
                    problems.Add($"{relative}: {field} names {editorId}, and no record has that editor ID — " +
                        (nameless.Count > 0 ? $"{string.Join(", ", nameless)} {(nameless.Count == 1 ? "has" : "have")} no EditorID line: " +
                            $"give the record meant the line EditorID: {editorId}" + (near.Count > 0 ? "; or " : "") : "") +
                        (near.Count > 0 ? $"the {wanted} records closest to it: {string.Join(", ", near)}"
                            : nameless.Count > 0 ? "" : $"find the {wanted} with findRecords"));
                    return;
                }
                if (!takes.IsAssignableFrom(found.Type))
                {
                    problems.Add($"{relative}: {field} names {found.EditorId}, which is {RecordFiles.Article(Kind(found.Type))}; {field} takes {RecordFiles.Article(wanted)}");
                    return;
                }
                if (found.FormKey is not { } target) return; // A new record, numbered after this check.
                var formKey = Session.FormKeyText(target);
                replacements.Add(new Replacement((int)value.Start.Index, (int)value.End.Index, formKey));
                resolved.Add(new JsonObject { ["file"] = relative, ["field"] = field, ["from"] = raw, ["to"] = formKey });
            }

            Walk(root, type, "", Link, problem => problems.Add($"{relative}: {problem}"));
            if (replacements.Count == 0) continue;
            var rewritten = text;
            foreach (var r in replacements.OrderByDescending(r => r.Start))
                rewritten = rewritten[..r.Start] + r.Text + rewritten[r.End..];
            rewrites.Add((file, rewritten));
        }

        if (problems.Count > 0)
        {
            throw new HelperException("badRecord",
                $"{problems.Count} field(s) cannot be built as written: {string.Join("; ", problems.Take(12))}" +
                (problems.Count > 12 ? "; …" : "") +
                ". Write each field the way readRecord shows a record of its type; a link is a record's FormID, or the exact " +
                "editor ID of a record of this project's or of the load order.");
        }
        if (!write) return [];
        foreach (var (file, text) in rewrites) File.WriteAllText(file, text);
        return resolved;
    }

    /// <summary>
    /// Follows a mapping through the record class's properties, calling <paramref name="link"/> on each
    /// link value, and <paramref name="problem"/> on what the reader would refuse or skip below the top
    /// level, which RecordFiles checks: a field the type does not have, a field of several kinds that
    /// does not name its kind, a text written as one value, a list where fields belong and the reverse,
    /// a value a field of names, numbers or truths does not take.
    /// </summary>
    private static void Walk(YamlMappingNode mapping, Type type, string path, Action<YamlScalarNode, Type, string> link,
        Action<string> problem)
    {
        // A field of several kinds names its kind, as a group of several does.
        var named = mapping.Children.TryGetValue(new YamlScalarNode("MutagenObjectType"), out var kindNode)
            && kindNode is YamlScalarNode { Value: { Length: > 0 } kindName } ? kindName : null;
        if (named is not null && RecordFiles.KindOf(type, named) is { } kind) type = kind;
        else if (path.Length > 0 && type.IsAbstract && KindsOf(type) is { Count: > 0 } kinds)
        {
            // Left unnamed, the reader fails with "Object reference not set to an instance of an object" (eval round 11).
            problem($"{path} is a field of several kinds: give it a first line `MutagenObjectType:` naming one — {string.Join(", ", kinds)}" +
                (named is null ? "" : $"; {named} is none of them"));
            return;
        }
        foreach (var (keyNode, value) in mapping.Children)
        {
            if (keyNode is not YamlScalarNode { Value: { } key } || key == "MutagenObjectType") continue;
            // The most derived one, where a class redeclares a property of its base.
            var property = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.Name == key).OrderBy(p => p.DeclaringType == type ? 0 : 1).FirstOrDefault();
            var field = path.Length == 0 ? key : $"{path}.{key}";
            if (property is null)
            {
                // The top level is RecordFiles' to name; below it, the reader skips the field without a word.
                if (path.Length > 0 && !type.IsInterface) problem($"{path} has no field {key}{RecordFiles.HintFor(type, key)}");
                continue;
            }
            var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;

            if (LinkTarget(propertyType) is { } takes)
            {
                if (value is YamlScalarNode scalar) link(scalar, takes, field);
            }
            else if (typeof(ITranslatedStringGetter).IsAssignableFrom(propertyType))
            {
                // `Name: Hilda`, which the reader refuses for want of its language.
                if (value is YamlScalarNode { Value.Length: > 0 } or YamlSequenceNode)
                    problem($"{field} is written as {(value is YamlSequenceNode ? "a list" : "one value")} — a text takes two lines indented " +
                        $"below `{field}:`, `TargetLanguage: English` and `Value: {(value as YamlScalarNode)?.Value ?? "…"}`");
            }
            else if (typeof(System.Collections.IList).IsAssignableFrom(propertyType) && ElementType(propertyType) is { } element)
            {
                if (value is YamlMappingNode)
                {
                    problem($"{field} takes a list: each item on a line of its own below it, starting `- `");
                    continue;
                }
                if (value is not YamlSequenceNode items) continue;
                var i = 0;
                foreach (var item in items.Children)
                {
                    var at = $"{field}[{i++}]";
                    if (LinkTarget(element) is { } itemTakes)
                    {
                        if (item is YamlScalarNode scalarItem) link(scalarItem, itemTakes, at);
                    }
                    else if (item is YamlMappingNode inner)
                    {
                        Walk(inner, element, at, link, problem);
                    }
                }
            }
            else if (propertyType.IsEnum || propertyType.IsPrimitive)
            {
                // The reader's own words name neither field nor line: "The input string '15.0' was not in a
                // correct format", "Requested value 'Passive' was not found" (eval round 11's probes).
                if (value is YamlScalarNode { Value: { Length: > 0 } one } && Unfit(propertyType, one) is { } expected)
                    problem($"{field} is {one} — {expected}");
                else if (value is YamlSequenceNode many && propertyType.IsDefined(typeof(FlagsAttribute), false))
                    foreach (var item in many.Children.OfType<YamlScalarNode>())
                        if (item.Value is { Length: > 0 } flag && Unfit(propertyType, flag) is { } flagExpected)
                            problem($"{field} has {flag} — {flagExpected}");
            }
            else if (propertyType != typeof(string) && !typeof(System.Collections.IEnumerable).IsAssignableFrom(propertyType))
            {
                if (value is YamlMappingNode nested) Walk(nested, propertyType, field, link, problem);
                else if (value is YamlSequenceNode) problem($"{field} takes fields of its own, indented below it — not a list");
            }
        }
    }

    /// <summary>
    /// What a value of a field of names, a number or a truth is not, as words after it — "it takes a whole
    /// number, such as 15", "it takes one of Unaggressive, Aggressive…" — or null for one the reader takes.
    /// </summary>
    private static string? Unfit(Type type, string raw)
    {
        var invariant = CultureInfo.InvariantCulture;
        if (type.IsEnum)
        {
            var names = Enum.GetNames(type);
            var written = type.IsDefined(typeof(FlagsAttribute), false)
                ? raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) : [raw.Trim()];
            foreach (var name in written)
            {
                // A value without a name is written as a number — 0x4 for an unnamed flag.
                if (names.Contains(name, StringComparer.Ordinal) || long.TryParse(name, NumberStyles.Integer, invariant, out _)
                    || name.StartsWith("0x", StringComparison.OrdinalIgnoreCase) && long.TryParse(name[2..], NumberStyles.HexNumber, invariant, out _)) continue;
                return names.FirstOrDefault(n => n.Equals(name, StringComparison.OrdinalIgnoreCase)) is { } spelled
                    ? $"it is spelled {spelled}"
                    : $"it takes one of {string.Join(", ", names.Take(16))}{(names.Length > 16 ? ", …" : "")}";
            }
            return null;
        }
        if (type == typeof(bool)) return bool.TryParse(raw, out _) ? null : "it takes True or False";
        if (type == typeof(float) || type == typeof(double))
            return double.TryParse(raw, NumberStyles.Float, invariant, out _) ? null : "it takes a number, such as 1.5";
        if (type == typeof(char)) return null;
        if (!decimal.TryParse(raw, NumberStyles.Integer, invariant, out var whole))
            return decimal.TryParse(raw, NumberStyles.Float, invariant, out var number)
                ? $"it takes a whole number, such as {decimal.Round(number)}" : "it takes a whole number";
        var (min, max) = (Convert.ToDecimal(type.GetField("MinValue")!.GetValue(null), invariant),
            Convert.ToDecimal(type.GetField("MaxValue")!.GetValue(null), invariant));
        return whole < min || whole > max ? $"it takes a whole number from {min} to {max}" : null;
    }

    /// <summary>
    /// What is wrong with a FormKey a link field holds, as words after it — "which is IronSword, a Weapon",
    /// "which no record of the load order has" — or null when it names a record of a type the field takes.
    /// </summary>
    private static string? Mismatch(FormKey formKey, Type takes, RecordIndex index)
    {
        if (index.ByFormKey.TryGetValue(formKey, out var entry))
            return takes.IsAssignableFrom(entry.GetterType) ? null
                : $"which is {(entry.EditorId is { } id ? $"{id}, " : "")}{RecordFiles.Article(Kind(entry.GetterType))}";
        // Skyrim.esm's numbers below 000800 are the engine's own: the player's reference, 000014, is in no
        // plugin, and every Creation Club plugin points at it. References and navmeshes the index leaves out.
        if (formKey.ModKey == Session.SkyrimMaster && formKey.ID < 0x800 || RecordIndex.SkippedTypes.Any(takes.IsAssignableFrom)) return null;
        return "which no record of the load order has";
    }

    /// <summary>The kinds a field of several kinds can be — NpcLevel, PcLevelMult for an NPC's level.</summary>
    private static List<string> KindsOf(Type type) => type.Assembly.GetTypes()
        .Where(t => !t.IsAbstract && !t.IsInterface && type.IsAssignableFrom(t))
        .Select(t => t.Name).Order(StringComparer.Ordinal).Take(8).ToList();

    /// <summary>The record type a link field takes — IMagicEffectGetter for an effect's BaseEffect — or null for a field that is no link.</summary>
    private static Type? LinkTarget(Type type) =>
        typeof(IFormLinkGetter).IsAssignableFrom(type)
            ? type.GetInterfaces().Append(type)
                .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IFormLinkGetter<>))?.GetGenericArguments()[0]
            : null;

    /// <summary>The item type of a list field, or null.</summary>
    private static Type? ElementType(Type type) =>
        type == typeof(string) ? null
            : type.GetInterfaces().Append(type)
                .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>))?.GetGenericArguments()[0];

    /// <summary>A record type as people say it: IMagicEffectGetter → MagicEffect.</summary>
    private static string Kind(Type type)
    {
        var name = type.Name;
        if (type.IsInterface && name.StartsWith('I')) name = name[1..];
        return name.EndsWith("Getter", StringComparison.Ordinal) ? name[..^"Getter".Length] : name;
    }

    /// <summary>
    /// The project's records by editor ID, with the FormKey each has — none yet for a new one; and the
    /// files of records without an editor ID, which no link can name.
    /// </summary>
    private static (Dictionary<string, Target> Named, List<(string Relative, Type Type)> Unnamed) OwnRecords(string pluginDir)
    {
        var own = new Dictionary<string, Target>(StringComparer.OrdinalIgnoreCase);
        var unnamed = new List<(string, Type)>();
        foreach (var (file, relative, type) in RecordFiles.FlatRecords(pluginDir))
        {
            var (formKey, editorId) = RecordFiles.Identity(File.ReadAllText(file));
            if (editorId is null) unnamed.Add((relative, type));
            else own.TryAdd(editorId, new Target(formKey, editorId, type));
        }
        return (own, unnamed);
    }

    /// <summary>Up to five records a link may have meant: of a type the field takes, with an editor ID close to the one written.</summary>
    private static List<string> Near(string editorId, Type takes, Dictionary<string, Target> own, RecordIndex index)
    {
        var candidates = own.Values.Where(t => takes.IsAssignableFrom(t.Type)).Select(t => (t.EditorId, t.FormKey))
            .Concat(index.ByFormKey.Values.Where(e => e.EditorId is not null && takes.IsAssignableFrom(e.GetterType))
                .Select(e => (EditorId: e.EditorId!, FormKey: (FormKey?)e.FormKey)));
        return candidates
            .Select(c => (c.EditorId, c.FormKey, Score: Closeness(editorId, c.EditorId)))
            .Where(c => c.Score < int.MaxValue)
            .OrderBy(c => c.Score).ThenBy(c => c.EditorId.Length).ThenBy(c => c.EditorId, StringComparer.Ordinal)
            .Select(c => $"{c.EditorId} ({(c.FormKey is { } key ? Session.FormKeyText(key) : "new in this project")})")
            .Distinct()
            .Take(5)
            .ToList();
    }

    /// <summary>Lower is closer: one editor ID inside the other, else a few letters apart; int.MaxValue for neither.</summary>
    private static int Closeness(string written, string candidate)
    {
        if (candidate.Contains(written, StringComparison.OrdinalIgnoreCase) || written.Contains(candidate, StringComparison.OrdinalIgnoreCase))
            return Math.Abs(candidate.Length - written.Length);
        if (Math.Abs(candidate.Length - written.Length) > 2) return int.MaxValue;
        var distance = RecordIndex.Distance(candidate.ToUpperInvariant(), written.ToUpperInvariant());
        return distance <= 2 ? 100 + distance : int.MaxValue;
    }
}
