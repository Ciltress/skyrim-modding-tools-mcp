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
    /// Finds the FormKey of the record each editor-ID link names, and answers what each named; <paramref name="rewrites"/>
    /// holds each file with them written in, for the reader's copy. The project's files keep the editor IDs: written
    /// into them as FormIDs, e4b's next edits of those lines found nothing, 12 times in eval rounds 40–47 — Storm Bolt's
    /// `MenuDisplayObject: MAGINVShockSpellArt` in seven. A link to the load order keeps to its pin (LinkPins).
    /// Throws when a link names no record of a type its field takes.
    /// </summary>
    public static JsonArray Resolve(string pluginDir, RecordIndex index, IReadOnlyDictionary<string, FormKey> pins,
        out List<(string Relative, string Text)> rewrites)
    {
        var (own, unnamed) = OwnRecords(pluginDir);
        var ownPlugin = RecordFiles.OwnPlugin(pluginDir);
        var resolved = new JsonArray();
        var problems = new List<string>();
        var rewritten = new List<(string Relative, string Text)>();
        // The record a pin names, while the load order has it under that editor ID still.
        Target? Pinned(string editorId) =>
            pins.TryGetValue(editorId, out var pin) && index.ByFormKey.TryGetValue(pin, out var entry)
                && string.Equals(entry.EditorId, editorId, StringComparison.OrdinalIgnoreCase)
                ? new Target(pin, entry.EditorId!, entry.GetterType) : null;

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
                problems.Add($"{relative}: {YamlBreak(text, e, type)}");
                continue;
            }
            if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode root) continue;
            if (FieldInText(text, type, root) is { } swallowed) problems.Add($"{relative}: {swallowed}");
            if (TakenEditorId(text, index, ownPlugin) is { } taken) problems.Add($"{relative}: {taken}");
            // What every official weapon or armor of its kind carries itself, named with the links' problems.
            if (RecordFiles.Identity(text).FormKey is not { } written || written.ModKey == ownPlugin)
                if (RecordFiles.Uncarried(type, text, index) is { } uncarried) problems.Add($"{relative}: {uncarried}");

            var replacements = new List<Replacement>();
            void Link(YamlScalarNode value, Type takes, string field)
            {
                var raw = value.Value?.Trim() ?? "";
                if (raw.Length == 0 || raw is "~" || raw.Equals("null", StringComparison.OrdinalIgnoreCase)) return;
                var wanted = Kind(takes);
                if (FormKey.TryFactory(raw, out var linked))
                {
                    // None and Null are the reader's no record: DefaultOutfit: None was refused as missing (eval probe 8).
                    if (linked.IsNull) return;
                    // A FormID written from memory under the comment of the record meant: e4b's Hilda had
                    // `Race: 02C65A:Skyrim.esm  # NordRace`, RedguardRaceChild's, and built a plain success (eval round 22).
                    if (CommentedOther(text, value, linked, takes, own, index) is { } other)
                    {
                        var leaf = field[(field.LastIndexOf('.') + 1)..];
                        string Line(string id) => leaf.EndsWith(']') ? $"- {id}" : $"{leaf}: {id}";
                        var was = other.Linked is { } linkedEditorId ? $"which is {linkedEditorId}" : "which no record has";
                        if (other.Meant is { } meant)
                            problems.Add($"{relative}: {field} is {raw}, {was}, but the comment after it names {meant.EditorId}" +
                                (meant.FormKey is { } meantKey ? $" ({Session.FormKeyText(meantKey)})" : ", a new record of this project") +
                                $" — the build reads the FormID and skips the comment. Write the one meant by its editor ID: `{Line(meant.EditorId)}`" +
                                (other.Linked is { } linkedId ? $" or `{Line(linkedId)}`" : ""));
                        else
                        {
                            var near = Near(other.Named, takes, own, index);
                            problems.Add($"{relative}: {field} is {raw}, {was}, but the comment after it names {other.Named}, which no record has " +
                                "— the build reads the FormID and skips the comment. Write the one meant by its editor ID" +
                                (near.Count > 0 ? $" — the {wanted} records closest to {other.Named}: {string.Join(", ", near)}" : $" — find the {wanted} with findRecords") +
                                (other.Linked is { } linkedId ? $"; or `{Line(linkedId)}`, the one the FormID names" : ""));
                        }
                        return;
                    }
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
                // A file where a record goes: told "a link is a FormID … or the editor ID of a Static", e4b wrote
                // `FirstPersonModel: 1stPersonWeapons\FlameBlade.nif` three times (eval probe 20).
                if (FilePath.IsMatch(raw))
                {
                    problems.Add($"{relative}: {field} is '{raw}', a file — {field} names {RecordFiles.Article(wanted)} record, the one " +
                        "that holds the file: write the line of the vanilla record you mirror, as readRecord shows it" +
                        (field == "FirstPersonModel" ? " — an iron sword's is `FirstPersonModel: 1stPersonIronSword`" : ""));
                    return;
                }
                if (ByEditorId.Match(raw) is not { Success: true } written)
                {
                    problems.Add($"{relative}: {field} is '{raw}' — a link is a FormID like 012EB7:Skyrim.esm, or the editor ID of {RecordFiles.Article(wanted)}");
                    return;
                }
                var editorId = written.Groups["id"].Value;
                var found = own.TryGetValue(editorId, out var mine) ? mine
                    : Pinned(editorId) ?? (index.ByEditorId.TryGetValue(editorId, out var key) && index.ByFormKey.TryGetValue(key, out var entry)
                        ? new Target(key, entry.EditorId ?? editorId, entry.GetterType)
                        : null);
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
                    // A weapon's enchantment named as the magic effect it was to cast: all 3 runs of eval rounds 40–53 that
                    // were refused so failed — round 53's sword+detailed #5 rewrote its magic effect until the turns ran out.
                    problems.Add($"{relative}: {field} names {found.EditorId}, which is {RecordFiles.Article(Kind(found.Type))}; {field} takes {RecordFiles.Article(wanted)}" +
                        (wanted == "ObjectEffect" && Kind(found.Type) == "MagicEffect"
                            ? $" — an enchantment, whose Effects name the magic effects it casts: name one, such as {RecordFiles.ExampleName("ObjectEffect")}, " +
                                $"or write one in ObjectEffects with `- BaseEffect: {found.EditorId}` among its Effects, as readRecord {{\"record\": " +
                                $"\"{RecordFiles.ExampleName("ObjectEffect")}\"}} shows them, and name it here"
                            : ""));
                    return;
                }
                if (found.FormKey is not { } target) return; // A new record, numbered after this check.
                var formKey = Session.FormKeyText(target);
                replacements.Add(new Replacement((int)value.Start.Index, (int)value.End.Index, formKey));
                resolved.Add(new JsonObject { ["file"] = relative, ["field"] = field, ["from"] = raw, ["to"] = formKey });
            }

            // The NPC's level is given whole once per file, however many of its fields are misplaced.
            var levelGiven = false;
            var before = problems.Count;
            Walk(root, type, "", Link, problem =>
            {
                if (problem.Contains(RecordFiles.NpcLevel))
                {
                    if (levelGiven) problem = problem.Replace(RecordFiles.NpcLevel, "the level's lines as above");
                    levelGiven = true;
                }
                problems.Add($"{relative}: {problem}");
            });
            // A new record nothing else names can be dropped by writing its file empty, said first, after the file's
            // name (RecordFiles.Droppable).
            if (problems.Count > before)
                problems[before] = problems[before].Insert(relative.Length + 2, RecordFiles.Droppable(type, relative, text,
                    RecordFiles.FlatRecords(pluginDir).Where(f => f.Relative != relative).Select(f => (f.Relative, File.ReadAllText(f.File)))));
            if (replacements.Count == 0) continue;
            var withFormIds = text;
            foreach (var r in replacements.OrderByDescending(r => r.Start))
                withFormIds = withFormIds[..r.Start] + r.Text + withFormIds[r.End..];
            rewritten.Add((relative, withFormIds));
        }
        // A new enchantment no record names, beside a weapon or armor that carries none (RecordFiles.Unworn).
        var records = RecordFiles.FlatRecords(pluginDir).Select(f => (f.Relative, f.Type, Text: File.ReadAllText(f.File)))
            .Where(f => !RecordFiles.Empty(f.Text)).ToList();
        foreach (var (relative, enchantment, carriers) in RecordFiles.Unworn(records, ownPlugin).Where(u => u.Carriers.Count > 0))
            problems.Add(RecordFiles.UnwornProblem(relative, enchantment, carriers));

        if (problems.Count > 0)
        {
            throw new HelperException("badRecord",
                $"{problems.Count} field(s) cannot be built as written: {string.Join("; ", problems.Take(12))}" +
                (problems.Count > 12 ? "; …" : "") +
                ". Write each field the way readRecord shows a record of its type; a link is a record's FormID, or the exact " +
                "editor ID of a record of this project's or of the load order.");
        }
        rewrites = rewritten;
        return resolved;
    }

    /// <summary>A field whose value is a block text, <c>Value: &gt;-</c> or <c>Value: |</c>, as readRecord writes a long one.</summary>
    private static readonly Regex BlockTextHeader = new(@"^ *(?:- +)?(?<key>[A-Za-z0-9_]+): +[|>][-+1-9]* *(?:#.*)?$");

    /// <summary>
    /// Where and why a record file's YAML breaks, with the line it breaks on — named before the build
    /// numbers the file and renames it. A line that fell out of a block text is said as such: told to
    /// give every line a `Field: value`, e4b rewrote a note five times with its paragraphs still at the
    /// margin, where they end the text and are read as fields (eval round 16).
    /// </summary>
    private static string YamlBreak(string text, YamlException e, Type type)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var at = (int)e.Start.Line;
        var where = at >= 1 && at <= lines.Length ? $"line {at}, `{lines[at - 1].Trim()}`" : $"line {at}";
        if (TextLeft(lines, at) is { } block)
        {
            // Told only to indent the text, e4b indented the fields after it too, then put both back at the margin,
            // four times (eval round 20): what stays as it is, said with what moves.
            var fields = RecordFiles.FieldsOf(type);
            var next = Array.FindIndex(lines, at, line => MarginField.Match(line) is { Success: true } m && fields.Contains(m.Groups["key"].Value));
            return $"the YAML breaks at {where}: the line is part of the text under `{block.Header}` (line {block.Line}), but a text " +
                $"ends at the first line indented less than its own first line, and the rest is read as fields. Indent every line of " +
                $"the text by {block.Indent} spaces, as readRecord shows a text — `{new string(' ', block.Indent)}{lines[at - 1].Trim()}`; " +
                "an empty line may stay empty" +
                (next >= 0 ? $"; the record's fields after the text, from `{lines[next].Trim()}` (line {next + 1}) on, stay at the margin" : "");
        }
        var reason = Regex.Replace(e.Message, @"^\(Line:[^)]*\)( - \(Line:[^)]*\))?:\s*", "").Trim();
        // Told to remove a FormKey line, e4b wrote the line below it over it, and was then sent to fix its indentation
        // while it looked for the FormKey line again, until its turns ran out (eval round 21): both lines, named.
        if (Regex.Match(reason, @"^Duplicate key (?<key>[A-Za-z0-9_]+)") is { Success: true } duplicate && at >= 2 && at <= lines.Length)
        {
            var key = duplicate.Groups["key"].Value;
            var indent = lines[at - 1].Length - lines[at - 1].TrimStart().Length;
            var first = Array.FindLastIndex(lines, at - 2, line => line.Length - line.TrimStart().Length == indent && line.TrimStart().StartsWith($"{key}:"));
            if (first >= 0)
                return $"the YAML breaks at {where}: {key} is written twice, on lines {first + 1} and {at}, and a field is written once — " +
                    (lines[first].Trim() == lines[at - 1].Trim()
                        ? "delete one of the two lines, they are the same"
                        : $"keep the one meant, `{lines[first].Trim()}` or `{lines[at - 1].Trim()}`, and delete the other");
        }
        // Indented below a field that has a value of its own: a part's fields whose line was lost, under `EnchantmentAmount:
        // 500` (eval round 35's sword+detailed #3) — the line above, named; the record's own fields there are moved
        // (MisplacedFields.Dedent).
        static int Depth(string line) => line.Length - line.TrimStart(' ').Length;
        if (at >= 2 && at <= lines.Length && Depth(lines[at - 1]) > 0
            && Array.FindLastIndex(lines, at - 2, line => line.Trim().Length > 0 && Depth(line) < Depth(lines[at - 1])) is var above and >= 0
            && ValueLine.IsMatch(lines[above]))
            return $"the YAML breaks at {where}: it is indented below line {above + 1}, `{lines[above].Trim()}`, which has a value of its " +
                "own, so no line goes below it. A field beside it is written as deep as it is; a part's fields go below a line of the " +
                "part's name alone, `Part:`";
        return $"the YAML breaks at {where}: {reason} Indent a field's own fields by two spaces below it, and give every other line a `Field: value`";
    }

    /// <summary>A field with a value of its own on its line, plain — no text block, quote or flow below it.</summary>
    private static readonly Regex ValueLine = new(@"^[ \t]*(?:- +)?[A-Za-z0-9_]+:[ \t]+[^\s'""|>\[{&*!#]", RegexOptions.None, TimeSpan.FromSeconds(5));

    /// <summary>A field of the record at the margin, `Key: value` or `Key:`, as Spriggit writes one.</summary>
    private static readonly Regex MarginField = new(@"^(?<key>[A-Z][A-Za-z0-9]*):(?: |$)", RegexOptions.None, TimeSpan.FromSeconds(5));

    /// <summary>A file's path: folders apart by a slash, or a file's extension at the end.</summary>
    private static readonly Regex FilePath = new(@"[\\/]|\.(nif|dds|tga|wav|xwm|fuz|hkx|pex|psc|swf)$", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(5));

    /// <summary>
    /// A line written as a field, in a field's own spelling, with a value only a field has: a link, a
    /// number, or none — fields of its own below it. A text's "By:" or "Value: 200 gold" is no field.
    /// </summary>
    private static readonly Regex FieldLine = new(
        @"^(?<indent> +)(?<key>[A-Z][A-Za-z0-9]*):(?:[ \t]+(?<value>[0-9A-Fa-f]{6}:\S+\.es[mpl]|-?\d+(?:\.\d+)?)(?:[ \t]+#.*)?)?[ \t]*$",
        RegexOptions.IgnoreCase, TimeSpan.FromSeconds(5));

    /// <summary>
    /// A field of the record indented into a block text above it, where it is a line of the text and the
    /// record silently has no such field. Told to indent a text's lines, e4b indented the fields below it
    /// too, and a note built with its sound and keywords as words of its text (eval probe 18). Only a field
    /// the record has nowhere else counts: a letter's own "Name: …" line is text.
    /// </summary>
    private static string? FieldInText(string text, Type type, YamlMappingNode root)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var fields = RecordFiles.FieldsOf(type);
        var written = root.Children.Keys.OfType<YamlScalarNode>().Select(key => key.Value).ToHashSet(StringComparer.Ordinal);
        static int IndentOf(string line) => line.Length - line.TrimStart(' ').Length;
        for (var i = 0; i < lines.Length; i++)
        {
            if (BlockTextHeader.Match(lines[i]) is not { Success: true } header) continue;
            var column = header.Groups["key"].Index;
            for (var j = i + 1; j < lines.Length && (lines[j].Trim().Length == 0 || IndentOf(lines[j]) > column); j++)
            {
                if (FieldLine.Match(lines[j]) is not { Success: true } field) continue;
                var key = field.Groups["key"].Value;
                if (!fields.Contains(key) || written.Contains(key)) continue;
                // `Keywords:` with nothing after it is a field when its own lines follow: a list, or deeper ones.
                if (!field.Groups["value"].Success)
                {
                    var next = lines.Skip(j + 1).FirstOrDefault(line => line.Trim().Length > 0);
                    var ownLines = next is not null && (next.TrimStart().StartsWith("- ") || IndentOf(next) > field.Groups["indent"].Length);
                    if (!ownLines) continue;
                }
                return $"the text under `{lines[i].Trim()}` (line {i + 1}) runs on into `{lines[j].Trim()}` (line {j + 1}) — the " +
                    $"{Kind(type)}'s field {key}, indented into the text, so the record would have no {key} and the text would " +
                    $"end with it. The text ends before line {j + 1}: write that line and the field lines after it at the margin, " +
                    $"as readRecord shows them; the text's own lines, above line {j + 1}, keep their spaces";
            }
        }
        return null;
    }

    /// <summary>
    /// The block text the broken line (1-based) fell out of: going up from it through the text's lines —
    /// each indented deeper than the field that holds the text — to that field's line. Undefined when the
    /// line is indented as deep as the text, or follows no block text.
    /// </summary>
    private static (string Header, int Line, int Indent)? TextLeft(string[] lines, int at)
    {
        if (at < 2 || at > lines.Length) return null;
        static int IndentOf(string line) => line.Length - line.TrimStart(' ').Length;
        var broken = lines[at - 1];
        if (broken.Trim().Length == 0) return null;
        int? textIndent = null;
        var shallowest = int.MaxValue;
        for (var i = at - 2; i >= 0; i--)
        {
            if (lines[i].Trim().Length == 0) continue;
            if (BlockTextHeader.Match(lines[i]) is { Success: true } header)
            {
                var fieldColumn = header.Groups["key"].Index;
                // The text's lines are indented as deep as its first; with none yet, two deeper than its field.
                var indent = textIndent ?? fieldColumn + 2;
                return shallowest > fieldColumn && IndentOf(broken) < indent ? (lines[i].Trim(), i + 1, indent) : null;
            }
            // A line at the margin can be no text's: the field holding one is at the margin or deeper.
            if (IndentOf(lines[i]) == 0) return null;
            textIndent = IndentOf(lines[i]);
            shallowest = Math.Min(shallowest, textIndent.Value);
        }
        return null;
    }

    /// <summary>
    /// Follows a mapping through the record class's properties, calling <paramref name="link"/> on each
    /// link value, and <paramref name="problem"/> on what the reader would refuse or skip below the top
    /// level, which RecordFiles checks: a field the type does not have, a field of several kinds that
    /// does not name its kind, a text written as one value, a list where fields belong and the reverse,
    /// a value a field of names, numbers or truths does not take. <paramref name="parent"/> is the type of the
    /// mapping this one is a field of, where a field written a level too deep belongs; <paramref name="record"/>
    /// the record's, where one written in the wrong part does.
    /// </summary>
    private static void Walk(YamlMappingNode mapping, Type type, string path, Action<YamlScalarNode, Type, string> link,
        Action<string> problem, Type? parent = null, Type? record = null)
    {
        record ??= type;
        // A field of several kinds names its kind, as a group of several does.
        var named = mapping.Children.TryGetValue(new YamlScalarNode("MutagenObjectType"), out var kindNode)
            && kindNode is YamlScalarNode { Value: { Length: > 0 } kindName } ? kindName : null;
        if (named is not null && RecordFiles.KindOf(type, named) is { } kind) type = kind;
        else if (path.Length > 0 && type.IsAbstract && KindsOf(type) is { Count: > 0 } kinds)
        {
            // Left unnamed, the reader fails with "Object reference not set to an instance of an object" (eval round 11).
            problem($"{path} is a field of several kinds: give it a first line `MutagenObjectType:` naming one — {string.Join(", ", kinds)}" +
                (named is null ? "" : $"; {named} is none of them") + (type.Name == "ANpcLevel" ? $"; {RecordFiles.NpcLevel}" : ""));
            return;
        }
        // The fields of the level above written here, named in one problem with what this part holds: told
        // "move it up" eight times, field by field, a model moved them all and back, build after build (round 13).
        var movedUp = new List<string>();
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
                // A field of the level above, written below one of its fields: Configuration.Level.CalcMinLevel,
                // which a model moved to the top level next, a build later (eval probe 8 after round 11).
                if (path.Length > 0 && !type.IsInterface)
                {
                    // A field of another part goes there: a weapon's Speed, written under BasicStats, is Data's.
                    // Only one the record has nowhere is deleted; "has no field" alone reads as one missing (eval probe 9).
                    // An NPC's level whole, before "move it up": moved one field at a time, it went back and forth (round 12).
                    if (RecordFiles.LevelHint(type, key) is null && parent?.GetProperties(BindingFlags.Public | BindingFlags.Instance).Any(p => p.Name == key) == true)
                    {
                        movedUp.Add(key);
                        continue;
                    }
                    // A magic effect's Data, below one of its parts: found by name, the Data was a condition's, and e4b
                    // moved Storm Bolt's magnitude into its Conditions (eval round 39's spell+detailed #4), as at the
                    // margin in round 24.
                    problem($"{path} has no field {key}" + (RecordFiles.LevelHint(type, key) is { } level ? $" ({level})"
                        : record.Name == "MagicEffect" && key == "Data" ? $" ({RecordFiles.EffectStrength})"
                        : RecordFiles.HintFor(type, key) is { Length: > 0 } hint ? hint
                        : record != type && RecordFiles.WhereIn(record, key) is { } at ? $" (move it: {RecordFiles.Article(record.Name)}'s {key} is {at})"
                        : " (delete it)"));
                }
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
                // Any other line in a text the reader skips without a word (eval round 53's sword #2); one of the part's
                // own fields is moved out of it before this (MisplacedFields).
                else if (value is YamlMappingNode words)
                    foreach (var other in words.Children.Keys.OfType<YamlScalarNode>().Select(k => k.Value).Where(k => k is not null && !TextFields.Contains(k)))
                        problem($"{field}.{other}: a text holds `TargetLanguage` and `Value` alone — " +
                            (RecordFiles.WhereIn(record, other!) is { } at ? $"{RecordFiles.Article(record.Name)}'s {other} is {at}" : $"delete `{other}`"));
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
                        Walk(inner, element, at, link, problem, record: record);
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
                {
                    // A magic effect's flags in a spell's, named where they go in one problem: e4b copied ShockDamageFFAimed's
                    // Hostile, Detrimental and NoArea into its spell in 3 runs of eval rounds 35–43, all failed; told only the
                    // flags a spell takes, round 43's spell+detailed #5 took them out of its magic effect too.
                    var effects = new List<string>();
                    foreach (var item in many.Children.OfType<YamlScalarNode>())
                        if (item.Value is { Length: > 0 } flag && Unfit(propertyType, flag) is { } flagExpected)
                        {
                            if (path.Length == 0 && record != typeof(MagicEffect) && record.GetProperties().Any(p => p.Name == "Effects")
                                && Enum.GetNames<MagicEffect.Flag>().Contains(flag, StringComparer.Ordinal)) effects.Add(flag);
                            else problem($"{field} has {flag} — {flagExpected}");
                        }
                    var them = effects.Count > 1 ? "them" : "it";
                    if (effects.Count > 0)
                        problem($"{field} has {string.Join(", ", effects)} — {(effects.Count > 1 ? "magic effects' flags" : "a magic effect's flag")}, " +
                            $"which {RecordFiles.Article(record.Name)} takes from the MagicEffect each item of its Effects names: delete {them} here, " +
                            $"and keep {them} in that MagicEffect's Flags");
                }
            }
            else if (propertyType != typeof(string) && !typeof(System.Collections.IEnumerable).IsAssignableFrom(propertyType))
            {
                if (value is YamlMappingNode nested) Walk(nested, propertyType, field, link, problem, type, record);
                else if (value is YamlSequenceNode) problem($"{field} takes fields of its own, indented below it — not a list");
                // A part of the record, not a file path or a struct written as one value, as Model's File and a bound's corner are.
                else if (value is YamlScalarNode { Value: { Length: > 0 } one } && one is not ("~" or "null" or "Null" or "NULL")
                    && typeof(Loqui.ILoquiObject).IsAssignableFrom(propertyType))
                    problem(PartAsValue(field, propertyType, one, record));
                // Left empty, a part the record cannot be without reads as none, and the reader failed with "Object reference not
                // set to an instance of an object": e4b's Hilda, her `Level:` emptied once the build had moved CalcMinLevel and
                // CalcMaxLevel out of it up to Configuration (eval round 45's npc+detailed #3, two builds; round 35's #1).
                else if (value is YamlScalarNode { Value: null or "" or "~" or "null" or "Null" or "NULL" }
                    && typeof(Loqui.ILoquiObject).IsAssignableFrom(propertyType)
                    && new NullabilityInfoContext().Create(property).WriteState == NullabilityState.NotNull)
                    problem(PartAsValue(field, propertyType, null, record));
            }
        }
        if (movedUp.Count > 0)
        {
            var above = path.LastIndexOf('.') is var dot and >= 0 ? path[..dot] : "";
            var holds = movedUp.Count > 1
                ? $"; {path} holds only {string.Join(", ", type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name))}"
                : "";
            // Told "to the top level", e4b wrote the lines back with their two spaces in front, under Data again,
            // until it gave up (eval round 19): the lines themselves, and how deep they go.
            var lines = string.Join(", ", movedUp.Select(key => mapping.Children[new YamlScalarNode(key)] is YamlScalarNode { Value: { Length: > 0 } one }
                ? $"`{key}: {one}`" : $"`{key}:` with its lines"));
            // Told to move them up, e4b deleted both lines and built a sword its enchantment never reached (eval
            // round 22): that they stay, said in so many words, and the move as the edit it is.
            var single = movedUp.Count == 1;
            var keys = mapping.Children.Keys.OfType<YamlScalarNode>().Select(key => key.Value).ToList();
            var last = keys.Skip(keys.Count - movedUp.Count).ToHashSet();
            var there = above.Length == 0 ? "at the margin, with no spaces in front" : $"under {above}, as deep as its other fields";
            problem($"{path} has no field {string.Join(", ", movedUp)} (move {(single ? "it" : "them")} up, keeping " +
                $"{(single ? "the line" : movedUp.Count == 2 ? "both" : "all of them")}: " +
                (last.SetEquals(movedUp)
                    ? $"{(single ? "it is" : "they are")} {path}'s last, so take the two spaces out in front of {(single ? "it" : "them")} " +
                        $"and {(single ? "it is" : "they are")} {(above.Length == 0 ? "at the margin" : $"under {above}")}"
                    : $"delete {(single ? "it" : "them")} from {path} and write {(single ? "it" : "them")} again {there}, below {path}'s last line") +
                $" — {lines}{holds})");
        }
    }

    /// <summary>
    /// The value of an NPC's AIData the official plugins' named NPCs have most often, by its type: told only the
    /// names, e4b took the second, Aggressive, for an NPC the task gave no aggression (eval round 26). Counted over
    /// the 3,186 named NPCs the 80 official plugins define (2026-10-21).
    /// </summary>
    private static readonly Dictionary<Type, (string Value, string Of)> Usual = new()
    {
        [typeof(Aggression)] = ("Unaggressive", "1,838"),
        [typeof(Confidence)] = ("Foolhardy", "1,383"),
        [typeof(Responsibility)] = ("NoCrime", "2,371"),
        [typeof(Mood)] = ("Neutral", "2,901"),
        [typeof(Assistance)] = ("HelpsNobody", "1,353")
    };
    private const string NamedNpcs = "3,186";

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
                    : $"it takes one of {string.Join(", ", names.Take(16))}{(names.Length > 16 ? ", …" : "")}" +
                        (Usual.TryGetValue(type, out var usual)
                            ? $" (the official plugins' named NPCs have {usual.Value} most often: {usual.Of} of {NamedNpcs})" : "");
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

    /// <summary>A text's own lines, as Spriggit writes one: its language and its words — or, in a localized plugin, each language's.</summary>
    internal static readonly HashSet<string> TextFields = new(["TargetLanguage", "Value", "Values"], StringComparer.Ordinal);

    /// <summary>A comment after a value that names one record — `# NordRace`, as readRecord writes one — not words.</summary>
    private static readonly Regex CommentName = new(@"^[ \t]+#[ \t]*(?<id>[A-Za-z0-9_]+)[ \t]*\r?$", RegexOptions.None, TimeSpan.FromSeconds(5));

    /// <summary>An editor ID as a model makes one up — `FireDamageEnchantment`, `1stPersonFlameBlade`: a capital inside the word, or a digit.</summary>
    private static readonly Regex MadeUpEditorId = new(@"^(?=.*(?:[a-z0-9][A-Z]|[0-9]))[A-Za-z0-9_]{6,}$", RegexOptions.None, TimeSpan.FromSeconds(5));

    /// <summary>
    /// The record the comment after a link names, when it is another than the one the link's FormID names —
    /// with that one's editor ID, null for no record — or null when the comment names that one, or one of a type
    /// the field does not take: such a comment is a word, and says nothing of the link. A comment written as an
    /// editor ID that no record has is answered with <c>Meant</c> null: `ObjectEffect: 091AE7:Skyrim.esm  #
    /// FireDamageEnchantment` built Mehrunes' Razor's enchantment into e4b's Flame Blade (eval round 49's sword #2) —
    /// 15 such lines in rounds 32–49, each a made-up name, three of them built so.
    /// </summary>
    private static (string? Linked, Target? Meant, string Named)? CommentedOther(string text, YamlScalarNode value, FormKey linked, Type takes,
        Dictionary<string, Target> own, RecordIndex index)
    {
        var end = (int)value.End.Index;
        var lineEnd = text.IndexOf('\n', end);
        if (CommentName.Match(text[end..(lineEnd < 0 ? text.Length : lineEnd)]) is not { Success: true } comment) return null;
        var named = comment.Groups["id"].Value;
        var linkedId = index.ByFormKey.TryGetValue(linked, out var entry) ? entry.EditorId
            : own.Values.FirstOrDefault(t => t.FormKey == linked)?.EditorId;
        if (named.Equals(linkedId, StringComparison.OrdinalIgnoreCase)) return null;
        var meant = own.TryGetValue(named, out var mine) ? mine
            : index.ByEditorId.TryGetValue(named, out var key) && index.ByFormKey.TryGetValue(key, out var found)
                ? new Target(key, found.EditorId ?? named, found.GetterType)
                : null;
        // A record the index leaves out may be the one it names; a FormID of none is answered by the check after this.
        if (meant is null)
            return linkedId is not null && MadeUpEditorId.IsMatch(named) && !RecordIndex.SkippedTypes.Any(takes.IsAssignableFrom)
                ? (linkedId, null, named) : null;
        if (meant.FormKey == linked || !takes.IsAssignableFrom(meant.Type)) return null;
        return (linkedId, meant, named);
    }

    /// <summary>
    /// What a part of the record written as one value takes: `Archetype: ShockDamage`, which the reader answered
    /// with "Expected 'Scalar', got 'MappingEnd'" and a line and column, twice to e4b (eval round 27). A value one of
    /// the part's fields takes is given as that field's line. One written empty (<paramref name="one"/> null) is said so.
    /// </summary>
    private static string PartAsValue(string field, Type type, string? one, Type record)
    {
        var leaf = field[(field.LastIndexOf('.') + 1)..];
        if (one is null && type.Name == "ANpcLevel") return $"{field} is empty — {RecordFiles.NpcLevel}";
        // `Level: 1` under Configuration: told only of the kinds and readRecord, e4b moved the lines the build had moved
        // already, five edits refused (eval round 50's npc #5). The level's lines, its number in them.
        if (type.Name == "ANpcLevel")
            return $"{field} is written as one value, {one} — " + (int.TryParse(one, out var level)
                ? RecordFiles.NpcLevel.Replace("NpcLevel, Level: 10}", $"NpcLevel, Level: {level}}}") : RecordFiles.NpcLevel);
        var shapes = type.IsAbstract
            ? type.Assembly.GetTypes().Where(t => !t.IsAbstract && !t.IsInterface && type.IsAssignableFrom(t)).OrderBy(t => t.Name, StringComparer.Ordinal).ToList()
            : [type];
        var fit = shapes.SelectMany(shape => shape.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.CanWrite && (Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType).IsEnum)
                .Select(p => (Shape: shape, Field: p.Name,
                    Value: Enum.GetNames(Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType).FirstOrDefault(n => n.Equals(one, StringComparison.OrdinalIgnoreCase)))))
            .FirstOrDefault(f => f.Value is not null);
        var said = (one is null ? $"{field} is empty" : $"{field} is written as one value, {one}") +
            $" — it takes fields of its own, on lines indented below `{leaf}:`";
        if (fit.Value is not null)
            return said + $": write `{leaf}:` with " + (type.IsAbstract ? $"`MutagenObjectType: {fit.Shape.Name}` and " : "") +
                $"`{fit.Field}: {fit.Value}` below it, two spaces in";
        var example = RecordFiles.ExampleName(record.Name) is { } id ? $"readRecord {{\"record\": \"{id}\"}}" : "readRecord";
        return said + (type.IsAbstract
            ? $", the first `MutagenObjectType:` naming its kind — {string.Join(", ", KindsOf(type))} — and the kind's fields below it"
            : $" — {string.Join(", ", type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanWrite).Select(p => p.Name))}") +
            $", as {example} shows them in a vanilla {record.Name}";
    }

    /// <summary>The kinds a field of several kinds can be — NpcLevel, PcLevelMult for an NPC's level.</summary>
    private static List<string> KindsOf(Type type) => type.Assembly.GetTypes()
        .Where(t => !t.IsAbstract && !t.IsInterface && type.IsAssignableFrom(t))
        .Select(t => t.Name).Order(StringComparer.Ordinal).Take(8).ToList();

    /// <summary>The record type a link field takes — IMagicEffectGetter for an effect's BaseEffect — or null for a field that is no link.</summary>
    internal static Type? LinkTarget(Type type) =>
        typeof(IFormLinkGetter).IsAssignableFrom(type)
            ? type.GetInterfaces().Append(type)
                .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IFormLinkGetter<>))?.GetGenericArguments()[0]
            : null;

    /// <summary>The item type of a list field, or null.</summary>
    internal static Type? ElementType(Type type) =>
        type == typeof(string) ? null
            : type.GetInterfaces().Append(type)
                .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>))?.GetGenericArguments()[0];

    /// <summary>A record type as people say it: IMagicEffectGetter → MagicEffect.</summary>
    internal static string Kind(Type type)
    {
        var name = type.Name;
        if (type.IsInterface && name.StartsWith('I')) name = name[1..];
        return name.EndsWith("Getter", StringComparison.Ordinal) ? name[..^"Getter".Length] : name;
    }

    /// <summary>
    /// A new record — no FormKey line yet — written with the editor ID of a record of the load order: every link by it
    /// names the new one, and the game has two records of one editor ID. e4b wrote `EditorID: ShockDamageFFAimed` with a
    /// few lines to change Skyrim.esm's, and its spell then cast that empty effect, refused until the turns ran out
    /// (eval rounds 31 and 51, spell+detailed #3) — 4 runs of rounds 30–51 wrote one.
    /// </summary>
    private static string? TakenEditorId(string text, RecordIndex index, ModKey? ownPlugin)
    {
        if (RecordFiles.Identity(text) is not { FormKey: null, EditorId: { } editorId }
            || !index.ByEditorId.TryGetValue(editorId, out var key) || key.ModKey == ownPlugin
            || !index.ByFormKey.TryGetValue(key, out var entry))
            return null;
        var formId = Session.FormKeyText(key);
        return $"a new record, with the editor ID of {key.ModKey.FileName}'s {Kind(entry.GetterType)} {entry.EditorId} ({formId}) — every link " +
            $"by {editorId} would name this one instead. To change {key.ModKey.FileName}'s, copy it in with addPatch {{\"records\": " +
            $"[\"{formId}\"]}} and edit the copy, and write this file empty; for a new record, give it an EditorID of its own";
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

    /// <summary>
    /// Up to five records of any type an editor ID the load order lacks may have meant, the closest first,
    /// each with its type and FormID. Told only "search with findRecords", a model that guessed
    /// FireDamageEnchantment01 searched for any enchantment and read a Creation Club axe's, though
    /// EnchWeaponFireDamage01 shares three of its words (eval probe 9 after round 11).
    /// </summary>
    public static List<string> Closest(string editorId, RecordIndex index) => index.ByFormKey.Values
        .Where(e => e.EditorId is not null)
        .Select(e => (Entry: e, Score: Closeness(editorId, e.EditorId!)))
        .Where(c => c.Score < int.MaxValue)
        .OrderBy(c => c.Score).ThenBy(c => c.Entry.EditorId!.Length).ThenBy(c => c.Entry.EditorId, StringComparer.Ordinal)
        .Take(5)
        .Select(c => $"{c.Entry.EditorId} ({c.Entry.Type}, {Session.FormKeyText(c.Entry.FormKey)})")
        .ToList();

    /// <summary>
    /// Lower is closer: one editor ID inside the other, at least half its length — not the quest T01 in
    /// FireDamageEnchantment01; else a few letters apart; else sharing two or more
    /// of its words — one of four letters or more, for a name of two words or fewer — most first, and
    /// among as many the ones beginning as it does, which names the kind
    /// (WPNz… for a weapon's impact set) — WeapTypeOneHanded has none a few letters away, but the WeapType
    /// keywords share two of its words (eval probe 6 after round 11). int.MaxValue for none of these.
    /// </summary>
    private static int Closeness(string written, string candidate)
    {
        if (2 * Math.Min(candidate.Length, written.Length) >= Math.Max(candidate.Length, written.Length)
            && (candidate.Contains(written, StringComparison.OrdinalIgnoreCase) || written.Contains(candidate, StringComparison.OrdinalIgnoreCase)))
            return Math.Abs(candidate.Length - written.Length);
        if (Math.Abs(candidate.Length - written.Length) <= 2
            && RecordIndex.Distance(candidate.ToUpperInvariant(), written.ToUpperInvariant()) is var distance and <= 2)
            return 100 + distance;
        // A name of one or two words shares one: Warrior1F the WARRIOR1 of CombatWarrior1H (eval probe 7).
        var mine = WordsOf(written);
        var shared = SharedWords(mine, WordsOf(candidate));
        if (shared.Count < 2 && !(mine.Count <= 2 && shared.Any(word => word.Length >= 4))) return int.MaxValue;
        var prefix = written.Zip(candidate).TakeWhile(p => char.ToUpperInvariant(p.First) == char.ToUpperInvariant(p.Second)).Count();
        return 1000 - 2 * shared.Count - (prefix >= 3 ? 1 : 0);
    }

    /// <summary>
    /// The words of one editor ID another has too, or a word one begins the other with, of four letters or
    /// more: ENCH for ENCHANTMENT, DAMAGE for DAMAGE01 — the way Bethesda shortens and numbers its words.
    /// </summary>
    internal static List<string> SharedWords(HashSet<string> mine, HashSet<string> theirs) => mine
        .Where(word => theirs.Contains(word) || theirs.Any(other => Math.Min(word.Length, other.Length) >= 4
            && (word.StartsWith(other, StringComparison.Ordinal) || other.StartsWith(word, StringComparison.Ordinal))))
        .ToList();

    /// <summary>
    /// An editor ID's words, upper-cased: WeapTypeOneHanded -> WEAP, TYPE, ONE, HANDED; a run of capitals
    /// ends before a capitalised word, so WPNZFireImpactSet -> WPNZ, FIRE, IMPACT, SET.
    /// </summary>
    internal static HashSet<string> WordsOf(string editorId) =>
        Regex.Split(editorId, @"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|_").Where(w => w.Length > 0)
            .Select(w => w.ToUpperInvariant()).ToHashSet();
}
