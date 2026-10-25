using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mutagen.Bethesda.Strings;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace SkyrimHelper;

/// <summary>
/// Changes fields of one record file by their paths — `Data.Damage`, `Effects[0].Data.Magnitude` — with no text to match:
/// each field's lines changed in place, the rest of the file as it was, its comments included. 95 of e4b's edits were
/// refused in eval rounds 40–47: the old text written from memory, indented otherwise than the file, or made stale by a
/// build. Set by its path, a field needs none of that (docs/adr/0008).
/// </summary>
public static class RecordEdits
{
    private const BindingFlags Public = BindingFlags.Public | BindingFlags.Instance;
    private static readonly Regex Segment = new(@"^(?<key>[A-Za-z][A-Za-z0-9_]*)(?:\[(?<index>\d+)\])?$");

    private sealed record Step(string Key, int? Index);

    public static JsonObject Edit(string pluginDir, string record, JsonObject? set, JsonArray? remove)
    {
        if ((set?.Count ?? 0) + (remove?.Count ?? 0) == 0)
            throw new HelperException("badRequest", "Nothing to change: give `set`, fields by path and their values — " +
                "{\"Data.Damage\": 12, \"Name\": \"Flame Blade\"} — or `remove`, paths of fields to delete — [\"Critical\"].");
        var (file, relative, type) = Find(pluginDir, record);
        var written = File.ReadAllText(file);
        var text = written.Replace("\r\n", "\n");
        var changes = new List<string>();
        foreach (var (path, value) in set ?? []) text = SetPath(text, type, path, value, changes);
        foreach (var path in (remove ?? []).Select(r => r?.GetValue<string>() ?? ""))
        {
            var (steps, label) = Placed(type, path);
            Types(type, steps, label);
            text = Remove(text, steps, label, changes);
        }
        // A change that left no YAML is this tool's fault, never written.
        if (Root(text) is null)
            throw new HelperException("badRequest", $"The change would leave {relative} no YAML to read; nothing was written. Change it with your file tools.");
        File.WriteAllText(file, written.Contains("\r\n") ? text.Replace("\n", "\r\n") : text);
        return new JsonObject
        {
            ["file"] = relative,
            ["changed"] = new JsonArray(changes.Select(c => (JsonNode)c).ToArray()),
            ["text"] = text
        };
    }

    /// <summary>The record file named by its path in the plugin folder, its file name, or the record's EditorID.</summary>
    private static (string File, string Relative, Type Type) Find(string pluginDir, string record)
    {
        var flat = RecordFiles.FlatRecords(pluginDir).ToList();
        var wanted = (Path.IsPathRooted(record) ? Path.GetRelativePath(pluginDir, record) : record).Replace('\\', '/').Trim();
        var hit = flat.FirstOrDefault(f => f.Relative.Equals(wanted, StringComparison.OrdinalIgnoreCase));
        if (hit == default) hit = flat.FirstOrDefault(f => Path.GetFileName(f.Relative).Equals(wanted, StringComparison.OrdinalIgnoreCase)
            || Path.GetFileNameWithoutExtension(f.Relative).Equals(wanted, StringComparison.OrdinalIgnoreCase));
        if (hit == default) hit = flat.FirstOrDefault(f => string.Equals(RecordFiles.Identity(File.ReadAllText(f.File)).EditorId, wanted, StringComparison.OrdinalIgnoreCase));
        if (hit != default) return hit;
        throw new HelperException("notFound", $"No record file '{record}' in the project — its record files: " +
            (flat.Count == 0 ? "none yet; write one first" : string.Join(", ", flat.Take(20).Select(f => f.Relative)) + (flat.Count > 20 ? ", …" : "")) +
            ". Give the file as its path in the plugin folder, like Weapons/FlameBlade.yaml, or the record's EditorID.");
    }

    private static List<Step> Parse(string path)
    {
        var steps = path.Split('.').Select(s => Segment.Match(s.Trim())).ToList();
        if (path.Trim().Length == 0 || steps.Any(m => !m.Success))
            throw new HelperException("badRequest", $"'{path}' is no field path: fields joined by dots, an item of a list by its " +
                "number from 0 — Data.Damage, Name, Effects[0].Data.Magnitude.");
        return steps.Select(m => new Step(m.Groups["key"].Value, m.Groups["index"].Success ? int.Parse(m.Groups["index"].Value) : null)).ToList();
    }

    /// <summary>
    /// A path, and its words for answers: where it was placed otherwise, as placed and as sent —
    /// "Configuration.CalcMinLevel (sent as Level.CalcMinLevel)".
    /// </summary>
    private static (List<Step> Steps, string Label) Placed(Type record, string path)
    {
        var sent = Parse(path);
        var steps = Place(record, sent);
        return (steps, steps.SequenceEqual(sent) ? path : $"{Upto(steps, steps.Count)} (sent as {path})");
    }

    /// <summary>
    /// The path to where the record has the field, where it was sent to a place without it and the place is plain: a
    /// field of the part above, sent below one of that part's fields — Configuration.Level.CalcMinLevel is
    /// Configuration.CalcMinLevel — and a field the top level lacks, of the one part RecordFiles names — an NPC's Level
    /// is Configuration's, a weapon's Damage BasicStats'. Sent Level.CalcMinLevel and told an NPC's level is "three lines
    /// under Configuration", e4b sent Configuration.Level.CalcMinLevel, then the level whole with a brace too many,
    /// which Ollama dropped, and the run ended (eval round 60's npc+detailed #3).
    /// </summary>
    private static List<Step> Place(Type record, List<Step> sent)
    {
        var steps = sent.ToList();
        while (FirstUnknown(record, steps) is var (at, above) && at >= 0)
        {
            if (at == 0 && RecordFiles.PartFor(record, steps[0].Key, "") is { } part && Property(record, part) is not null)
                steps.Insert(0, new Step(part, null));
            else if (at > 0 && steps[at - 1].Index is null && above is not null && Property(above, steps[at].Key) is not null)
                steps.RemoveAt(at - 1);
            else break;
        }
        return steps;
    }

    /// <summary>The first step of a path whose part has no field for it, and the part holding the step before it; -1 for none.</summary>
    private static (int At, Type? Above) FirstUnknown(Type record, List<Step> steps)
    {
        var current = record;
        Type? above = null;
        for (var i = 0; i < steps.Count; i++)
        {
            if (steps[i].Key == "MutagenObjectType" || Translated(current)) break;
            if (Property(current, steps[i].Key) is not { } property) return (i, above);
            above = current;
            current = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (steps[i].Index is null) continue;
            if (Items(current) is not { } item) break;
            current = item;
        }
        return (-1, null);
    }

    /// <summary>The type each step of the path holds, checked against the record's type: a field it has not is refused.</summary>
    private static List<Type> Types(Type record, List<Step> steps, string path)
    {
        var types = new List<Type>();
        var current = record;
        for (var i = 0; i < steps.Count; i++)
        {
            var step = steps[i];
            var where = i == 0 ? RecordFiles.Article(record.Name) : string.Join('.', steps.Take(i).Select(s => s.Index is { } n ? $"{s.Key}[{n}]" : s.Key));
            if (step.Key == "MutagenObjectType") { types.Add(typeof(string)); break; }
            // A text as the file writes it — `Name:`, then `TargetLanguage: English` and `Value: Iron Sword` — not as
            // Mutagen holds it: `Name.Value` was refused e4b for no field Value, "its fields: String, StringsKey" (eval round 49).
            if (Translated(current))
            {
                if (step.Key is "Value" or "TargetLanguage" && i == steps.Count - 1) { types.Add(typeof(string)); break; }
                throw new HelperException("badRequest", $"{path}: {where} is a text, written as its Value and TargetLanguage — set " +
                    $"{where} to its words, or {where}.Value. Nothing was written.");
            }
            // A magic effect's Data, found by name, was a condition's: "move it in each item of Conditions", as the build said
            // until round 24.
            var property = Property(current, step.Key)
                ?? throw new HelperException("badRequest", $"{path}: {where} has no field {step.Key}" +
                    (i == 0 && record.Name == "MagicEffect" && step.Key == "Data" ? $" ({RecordFiles.EffectStrength})"
                        : RecordFiles.HintFor(current, step.Key) is { Length: > 0 } hint ? hint.Replace(RecordFiles.NpcLevel, NpcLevel) : "") +
                    $" — its fields: {string.Join(", ", Fields(current).Take(40))}. Nothing was written.");
            var type = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (step.Index is not null)
                type = Items(type) ?? throw new HelperException("badRequest", $"{path}: {step.Key} is no list. Nothing was written.");
            types.Add(type);
            current = type;
        }
        return types;
    }

    /// <summary>A field of the type — of any of its kinds, for a field of several kinds.</summary>
    private static PropertyInfo? Property(Type type, string key) =>
        Kinds(type).SelectMany(t => t.GetProperties(Public)).Where(p => p.Name == key).OrderBy(p => p.DeclaringType == type ? 0 : 1).FirstOrDefault();

    private static IEnumerable<Type> Kinds(Type type) => type.IsAbstract
        ? type.Assembly.GetTypes().Where(t => !t.IsAbstract && !t.IsInterface && type.IsAssignableFrom(t))
        : [type];

    private static IEnumerable<string> Fields(Type type) =>
        Kinds(type).SelectMany(t => t.GetProperties(Public)).Where(p => p.CanWrite).Select(p => p.Name).Distinct().Order(StringComparer.Ordinal);

    private static bool Translated(Type type) => typeof(ITranslatedStringGetter).IsAssignableFrom(type);

    /// <summary>
    /// The item type of a list field, a flags field's its names, as the file writes them — `Flags:`, `- Female` below it.
    /// Told "TemplateFlags is no list" for TemplateFlags[5], e4b edited the file by hand and broke its YAML twice (eval
    /// round 61's npc #1).
    /// </summary>
    private static Type? Items(Type type) =>
        type.IsEnum && type.IsDefined(typeof(FlagsAttribute), false) ? type : RecordLinks.ElementType(type);

    /// <summary>An NPC's level in paths: told it is "three lines under Configuration", as a file is, e4b sent Configuration.Level.CalcMinLevel (eval round 60).</summary>
    private const string NpcLevel = "an NPC's level is Configuration.Level, {\"MutagenObjectType\": \"PcLevelMult\", \"LevelMult\": 1}, " +
        "with Configuration.CalcMinLevel and Configuration.CalcMaxLevel — the level follows the player's between those two; " +
        "or, for a fixed level, Configuration.Level alone, {\"MutagenObjectType\": \"NpcLevel\", \"Level\": 10}";

    // ---------------------------------------------------------------- set and remove

    /// <summary>
    /// One entry of `set`. An object for a part the file has sets the fields it names and keeps the others, as a JSON
    /// merge patch does: {"BasicStats": {"Damage": 12}}, written whole, took the Iron Sword's Value and Weight with it
    /// (e4b, eval round 49's patch #1). One naming another kind of the part is written whole. A text's Value is the text.
    /// </summary>
    private static string SetPath(string text, Type type, string path, JsonNode? value, List<string> changes)
    {
        var (steps, label) = Placed(type, path);
        var types = Types(type, steps, label);
        // Fields of the part above, sent inside a part: an NPC's {"Level": {…, "CalcMinLevel": 5}} — set as Configuration's.
        if (value is JsonObject sent && sent.Where(f => f.Key != "MutagenObjectType" && Segment.IsMatch(f.Key)
                && Place(type, Parse($"{path}.{f.Key}")) is var placed && !(placed.Count > steps.Count && placed.Take(steps.Count).SequenceEqual(steps)))
                .Select(f => f.Key).ToList() is { Count: > 0 } outside)
        {
            var rest = (JsonObject)sent.DeepClone();
            foreach (var key in outside)
            {
                text = SetPath(text, type, $"{path}.{key}", sent[key]?.DeepClone(), changes);
                rest.Remove(key);
            }
            if (rest.Count == 0) return text;
            value = rest;
        }
        if (value is JsonObject { Count: > 0 } fields && At(text, steps) is YamlMappingNode there
            && (fields["MutagenObjectType"] is not JsonValue kind || kind.GetValue<object>().ToString() == Field(there, "MutagenObjectType")))
            return fields.Where(f => f.Key != "MutagenObjectType")
                .Aggregate(text, (merged, f) => SetPath(merged, type, $"{path}.{f.Key}", f.Value?.DeepClone(), changes));
        if (steps.Count > 1 && steps[^1] is { Key: "Value", Index: null } && Translated(types[^2]) && value is JsonValue)
            return Set(text, steps.SkipLast(1).ToList(), types.SkipLast(1).ToList(), value, label, changes);
        // A list of names sent as a text: "- AutoCalcStats\n- Unique\n- Female", its line ends written `\n`, was set as one
        // text, which the build refused, then "AutoCalcStats\nUnique\nFemale", and e4b answered as built (eval round 61's
        // npc+detailed #5).
        if (steps[^1].Index is null && value is JsonValue words && words.TryGetValue<string>(out var said)
            && Items(types[^1]) is { } item && (item.IsEnum || RecordLinks.LinkTarget(item) is not null))
        {
            value = Listed(text, steps, label, said);
            label += " (a list, sent as a text)";
        }
        text = Set(text, steps, types, value, label, changes);
        return steps.Count > 1 && steps[^1] is { Key: "MutagenObjectType", Index: null } ? Rekinded(text, steps.SkipLast(1).ToList(), types[^2], changes) : text;
    }

    /// <summary>
    /// A text for a list of names, as the list of them: split at its line ends, written or as `\n`, and at its commas,
    /// each name without its `- `. One name alone for a list that holds others is refused, the whole list given: a list
    /// is set whole, and "Female" for an NPC's Flags would have taken its AutoCalcStats and Unique with it.
    /// </summary>
    private static JsonArray Listed(string text, List<Step> steps, string label, string said)
    {
        var names = Regex.Split(said.Trim().TrimStart('[').TrimEnd(']'), @"\\n|\r?\n|,")
            .Select(n => n.Trim().TrimStart('-').Trim().Trim('"', '\'')).Where(n => n.Length > 0).ToList();
        var held = At(text, steps) is YamlSequenceNode list ? list.Children.OfType<YamlScalarNode>().Select(s => s.Value ?? "").ToList() : [];
        if (names.Count == 1 && held.Count > 0 && !held.SequenceEqual(names))
            throw new HelperException("badRequest", held.Contains(names[0])
                ? $"{label}: a list, set whole, and {names[0]} is among its items already: {Json(held)}. Nothing was written."
                : $"{label}: a list, set whole — to add {names[0]}, set it to {Json([.. held, names[0]])}. Nothing was written.");
        return new JsonArray(names.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray());
    }

    private static string Json(IEnumerable<string> names) => new JsonArray(names.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray()).ToJsonString();

    /// <summary>
    /// A part given another kind, without the fields of the kind it was that this one has not: an NpcLevel's `Level: 1`,
    /// left under a PcLevelMult, is refused by the build.
    /// </summary>
    private static string Rekinded(string text, List<Step> part, Type group, List<string> changes)
    {
        if (!group.IsAbstract || At(text, part) is not YamlMappingNode there || Field(there, "MutagenObjectType") is not { } named
            || RecordFiles.KindOf(group, named) is not { } kind)
            return text;
        var lacking = there.Children.Keys.OfType<YamlScalarNode>().Select(k => k.Value ?? "")
            .Where(k => k != "MutagenObjectType" && !kind.GetProperties(Public).Any(p => p.Name == k)).ToList();
        return lacking.Aggregate(text, (left, key) =>
            Remove(left, [.. part, new Step(key, null)], $"{Upto(part, part.Count)}.{key} ({RecordFiles.Article(kind.Name)} has no {key})", changes));
    }

    /// <summary>The node a path names in the file, or null where the file has none.</summary>
    private static YamlNode? At(string text, List<Step> steps)
    {
        YamlNode? node = Root(text);
        foreach (var step in steps)
        {
            if (node is not YamlMappingNode mapping || mapping.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == step.Key) is not { } key)
                return null;
            node = mapping.Children[key];
            if (step.Index is int n) node = node is YamlSequenceNode list && n < list.Children.Count ? list.Children[n] : null;
        }
        return node;
    }

    private static string? Field(YamlMappingNode mapping, string key) =>
        mapping.Children.FirstOrDefault(f => f.Key is YamlScalarNode k && k.Value == key).Value is YamlScalarNode value ? value.Value : null;

    private static string Set(string text, List<Step> steps, List<Type> types, JsonNode? value, string path, List<string> changes)
    {
        var root = Root(text) ?? throw Unreadable();
        YamlNode node = root;
        var indent = 0; // the column the current mapping's keys are written at
        for (var i = 0; i < steps.Count; i++)
        {
            var step = steps[i];
            var last = i == steps.Count - 1;
            if (node is not YamlMappingNode mapping)
                throw new HelperException("badRequest", $"{path}: {Upto(steps, i)} is written as one value, not as fields — set {Upto(steps, i)} whole. Nothing was written.");
            var key = mapping.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == step.Key);
            if (key is null)
            {
                // Missing from here on: written whole, below the fields the mapping has.
                if (steps.Skip(i).Any(s => s.Index is not null))
                    throw new HelperException("badRequest", $"{path}: there is no {step.Key} to take an item of — set {Upto(steps, i + 1).Split('[')[0]} whole, as a list. Nothing was written.");
                var whole = Nest(steps.Skip(i).ToList(), types.Skip(i).ToList(), value);
                var keyIndent = mapping.Children.Count > 0 ? Column(mapping.Children.Keys.First()) : indent;
                changes.Add($"added {path}: {Shown(value)}");
                return InsertAfter(text, mapping, ReferenceEquals(mapping, root), Render(step.Key, whole, keyIndent));
            }
            var child = mapping.Children[key];
            indent = Column(key) + 2;
            if (step.Index is int n)
            {
                if (child is not YamlSequenceNode list || n >= list.Children.Count)
                    throw new HelperException("badRequest", $"{path}: {step.Key} has {(child as YamlSequenceNode)?.Children.Count ?? 0} item(s), so [{n}] is none — " +
                        $"set {step.Key} whole, as a list. Nothing was written.");
                var item = list.Children[n];
                if (last)
                {
                    changes.Add($"set {path}: {Shown(item)} → {Shown(value)}");
                    return ReplaceItem(text, item, Column(item), value);
                }
                node = item;
                indent = Column(item) + 2;
                continue;
            }
            if (!last) { node = child; continue; }
            // A text — Name, Description — takes its words: written into its Value.
            if (Translated(types[i]) && value is JsonValue words && words.TryGetValue<string>(out var said))
            {
                if (child is YamlMappingNode text2 && text2.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == "Value") is { } valueKey
                    && text2.Children[valueKey] is YamlScalarNode was)
                {
                    changes.Add($"set {path}: {Shown(was)} → {Shown(value)}");
                    return ReplaceScalar(text, was, Column(valueKey), JsonValue.Create(said));
                }
                value = new JsonObject { ["TargetLanguage"] = "English", ["Value"] = said };
            }
            changes.Add($"set {path}: {Shown(child)} → {Shown(value)}");
            return child is YamlScalarNode scalar && value is JsonValue && !Empty(scalar)
                ? ReplaceScalar(text, scalar, Column(key), value)
                : ReplaceField(text, key, child, Render(step.Key, value, Column(key)));
        }
        return text;
    }

    private static string Remove(string text, List<Step> steps, string path, List<string> changes)
    {
        var root = Root(text) ?? throw Unreadable();
        YamlNode node = root;
        for (var i = 0; i < steps.Count; i++)
        {
            var step = steps[i];
            if (node is not YamlMappingNode mapping || mapping.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == step.Key) is not { } key)
            {
                changes.Add($"no {path} to remove");
                return text;
            }
            var child = mapping.Children[key];
            if (step.Index is int n)
            {
                if (child is not YamlSequenceNode list || n >= list.Children.Count) { changes.Add($"no {path} to remove"); return text; }
                if (i == steps.Count - 1)
                {
                    changes.Add($"removed {path}");
                    return RemoveLines(text, Line(list.Children[n].Start), LastLine(text, list.Children[n]));
                }
                node = list.Children[n];
                continue;
            }
            if (i == steps.Count - 1)
            {
                changes.Add($"removed {path}");
                return RemoveLines(text, Line(key.Start), FieldEnd(text, key, child));
            }
            node = child;
        }
        return text;
    }

    /// <summary>The rest of a path written as nested fields: Data.Damage 12 is {Damage: 12} below Data, a part of several kinds named.</summary>
    private static JsonNode? Nest(List<Step> steps, List<Type> types, JsonNode? value)
    {
        var inner = value?.DeepClone();
        if (Translated(types[^1]) && inner is JsonValue words && words.TryGetValue<string>(out var said))
            inner = new JsonObject { ["TargetLanguage"] = "English", ["Value"] = said };
        for (var i = steps.Count - 1; i >= 1; i--)
        {
            var part = new JsonObject();
            // A part of several kinds names the one whose field this is: an NPC's Level with Level is an NpcLevel.
            if (types[i - 1].IsAbstract && Kinds(types[i - 1]).Where(k => k.GetProperty(steps[i].Key, Public) is not null).ToList() is [var kind])
                part["MutagenObjectType"] = kind.Name;
            part[steps[i].Key] = inner;
            inner = part;
        }
        return inner;
    }

    // ---------------------------------------------------------------- text

    private static string ReplaceScalar(string text, YamlScalarNode node, int keyColumn, JsonNode? value)
    {
        var start = (int)node.Start.Index;
        var end = (int)node.End.Index;
        // A block text ends where the next field begins: its own line ends are kept.
        while (end > start && char.IsWhiteSpace(text[end - 1])) end--;
        // The comment after a link names the record it named: with another value, it would say what is no longer there.
        var lineEnd = text.IndexOf('\n', end);
        var rest = text[end..(lineEnd < 0 ? text.Length : lineEnd)];
        if (Regex.IsMatch(rest, @"^[ \t]+#")) end += rest.Length;
        var rendered = Scalar(value, keyColumn + 2);
        if (start > 0 && text[start - 1] == ':') rendered = " " + rendered;
        return text[..start] + rendered + text[end..];
    }

    /// <summary>A field's lines — its key's line and every line of its value — written anew.</summary>
    private static string ReplaceField(string text, YamlScalarNode key, YamlNode value, List<string> lines) =>
        ReplaceLines(text, Line(key.Start), FieldEnd(text, key, value), lines);

    /// <summary>The last line of a field: its key's, for a value written empty — `Level:` — whose mark may sit on the next line.</summary>
    private static int FieldEnd(string text, YamlScalarNode key, YamlNode value) =>
        value is YamlScalarNode scalar && Empty(scalar) ? Line(key.Start) : Math.Max(Line(key.Start), LastLine(text, value));

    private static bool Empty(YamlScalarNode scalar) => scalar.Style == ScalarStyle.Plain && string.IsNullOrEmpty(scalar.Value);

    private static string ReplaceItem(string text, YamlNode item, int column, JsonNode? value)
    {
        var lines = Render("", value, column);
        var pad = new string(' ', column);
        if (value is JsonObject or JsonArray)
        {
            // The first field after the dash: `- BaseEffect: X`, the rest two spaces in.
            lines = lines.Skip(1).ToList();
            lines[0] = pad + "- " + lines[0].TrimStart();
        }
        else lines = [pad + "- " + Scalar(value, column + 2)];
        return ReplaceLines(text, Line(item.Start), LastLine(text, item), lines);
    }

    /// <summary>New lines below a mapping's last field — at the root, below the file's last line.</summary>
    private static string InsertAfter(string text, YamlMappingNode mapping, bool root, List<string> lines)
    {
        var all = text.Split('\n').ToList();
        var after = root || mapping.Children.Count == 0
            ? root ? all.FindLastIndex(l => l.Trim().Length > 0) : Line(mapping.Start)
            : Math.Max(LastLine(text, mapping.Children.Last().Value), Line(mapping.Children.Last().Key.Start));
        all.InsertRange(after + 1, lines);
        return string.Join('\n', all);
    }

    private static string ReplaceLines(string text, int first, int last, List<string> lines)
    {
        var all = text.Split('\n').ToList();
        all.RemoveRange(first, last - first + 1);
        all.InsertRange(first, lines);
        return string.Join('\n', all);
    }

    private static string RemoveLines(string text, int first, int last)
    {
        var all = text.Split('\n').ToList();
        all.RemoveRange(first, last - first + 1);
        return string.Join('\n', all);
    }

    /// <summary>A field written as Spriggit writes one: a value on its line, fields two spaces in, a list's items at the key's column.</summary>
    private static List<string> Render(string key, JsonNode? value, int column)
    {
        var pad = new string(' ', column);
        var head = key.Length > 0 ? $"{pad}{key}:" : $"{pad}:";
        switch (value)
        {
            case JsonObject fields when fields.Count == 0:
                return [$"{head} {{}}"];
            case JsonObject fields:
                return [head, .. fields.SelectMany(f => Render(f.Key, f.Value, column + 2))];
            case JsonArray items when items.Count == 0:
                return [$"{head} []"];
            case JsonArray items:
                var lines = new List<string> { head };
                foreach (var item in items)
                {
                    if (item is JsonObject fields && fields.Count > 0)
                    {
                        var inner = fields.SelectMany(f => Render(f.Key, f.Value, column + 2)).ToList();
                        inner[0] = pad + "- " + inner[0].TrimStart();
                        lines.AddRange(inner);
                    }
                    else lines.Add($"{pad}- {Scalar(item, column + 2)}");
                }
                return lines;
            default:
                return [$"{head} {Scalar(value, column + 2)}"];
        }
    }

    /// <summary>A value on its line: plain where YAML reads it as written, quoted where it would not, a text of several lines as a block.</summary>
    private static string Scalar(JsonNode? value, int column)
    {
        if (value is null) return "~";
        if (value is not JsonValue one) return value.ToJsonString();
        if (one.TryGetValue<bool>(out var flag)) return flag ? "true" : "false";
        if (!one.TryGetValue<string>(out var s)) return one.ToJsonString();
        if (s.Contains('\n'))
        {
            var pad = new string(' ', column);
            return "|-\n" + string.Join('\n', s.Replace("\r\n", "\n").Split('\n').Select(l => l.Length == 0 ? "" : pad + l));
        }
        var plain = s.Length > 0 && !char.IsWhiteSpace(s[0]) && !char.IsWhiteSpace(s[^1]) && "-?:,[]{}#&*!|>'\"%@`".IndexOf(s[0]) < 0
            && !s.Contains(": ") && !s.Contains(" #") && !s.EndsWith(':')
            && !Regex.IsMatch(s, "^(?:true|false|null|yes|no|on|off|~)$", RegexOptions.IgnoreCase);
        return plain ? s : $"'{s.Replace("'", "''")}'";
    }

    // ---------------------------------------------------------------- reading

    private static YamlMappingNode? Root(string text)
    {
        var yaml = new YamlStream();
        try { yaml.Load(new StringReader(text)); }
        catch (YamlException) { return null; }
        return yaml.Documents.Count > 0 ? yaml.Documents[0].RootNode as YamlMappingNode : null;
    }

    private static HelperException Unreadable() => new("badRequest",
        "The file's YAML does not read, so no field can be found in it; nothing was written. buildProject names the line where it breaks — fix that first.");

    /// <summary>The line of a mark, from 0.</summary>
    private static int Line(Mark mark) => (int)mark.Line - 1;

    /// <summary>The column a node starts at, from 0.</summary>
    private static int Column(YamlNode node) => (int)node.Start.Column - 1;

    /// <summary>
    /// The last line of a node that holds any of it, from 0 — a block ends where the next field begins. A list's or a
    /// part's, from its last item: for a list written at its key's column, as Spriggit writes `Keywords:` and its
    /// items, the reader's end mark is its first item's, and set whole, the Iron Sword kept two keywords of three.
    /// </summary>
    private static int LastLine(string text, YamlNode node) => node switch
    {
        YamlSequenceNode list when list.Children.Count > 0 => Math.Max(Line(list.Start), list.Children.Max(item => LastLine(text, item))),
        YamlMappingNode fields when fields.Children.Count > 0 =>
            Math.Max(Line(fields.Start), fields.Children.Max(f => Math.Max(Line(f.Key.Start), f.Value is YamlScalarNode s && Empty(s) ? Line(f.Key.Start) : LastLine(text, f.Value)))),
        _ => ScalarEnd(text, node)
    };

    private static int ScalarEnd(string text, YamlNode node)
    {
        var end = (int)node.End.Index;
        while (end > (int)node.Start.Index && char.IsWhiteSpace(text[end - 1])) end--;
        return text[..Math.Max(end, (int)node.Start.Index)].Count(c => c == '\n');
    }

    private static string Upto(List<Step> steps, int count) =>
        string.Join('.', steps.Take(count).Select(s => s.Index is { } n ? $"{s.Key}[{n}]" : s.Key));

    private static string Shown(JsonNode? value) => value switch
    {
        null => "~",
        JsonValue one when one.TryGetValue<string>(out var s) => s.Length > 60 ? s[..57] + "…" : s,
        JsonValue one => one.ToJsonString(),
        _ => value.ToJsonString().Length > 60 ? value.ToJsonString()[..57] + "…" : value.ToJsonString()
    };

    private static string Shown(YamlNode node) => node switch
    {
        YamlScalarNode s => (s.Value ?? "").Length > 60 ? s.Value![..57] + "…" : s.Value ?? "",
        YamlSequenceNode list => $"{list.Children.Count} item(s)",
        YamlMappingNode fields => $"{fields.Children.Count} field(s)",
        _ => "?"
    };
}
