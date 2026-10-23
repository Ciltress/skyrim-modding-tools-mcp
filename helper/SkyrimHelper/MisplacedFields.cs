using System.Reflection;
using Mutagen.Bethesda.Strings;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.RepresentationModel;

namespace SkyrimHelper;

/// <summary>
/// Moves a field written where its record's type has none to the one place it goes, before the files are checked:
/// a part's field written at the margin, under that part — an NPC's level, under Configuration — and a field written
/// a level too deep, up below the part it was written in. Refused, these were what failed runs had met most: 13 of the
/// 27 runs e4b failed in eval rounds 23–32 had been told to move a field, and moved it back and forth — an NPC's level
/// into Level, then to the margin, build after build (round 32). A field with no one place — one "in each item of
/// Effects", or one the place has already — is left to the refusal.
/// </summary>
public static class MisplacedFields
{
    private const BindingFlags Public = BindingFlags.Public | BindingFlags.Instance;

    /// <summary>Moves what has one place, in each record file of the plugin folder; answers each file and what was moved.</summary>
    public static List<(string File, string Change)> Move(string pluginDir)
    {
        var changes = new List<(string File, string Change)>();
        foreach (var (file, relative, type) in RecordFiles.FlatRecords(pluginDir))
        {
            var written = File.ReadAllText(file);
            var text = written.Replace("\r\n", "\n");
            // One move at a time, each found in the text the last one left: the lines below it have shifted.
            for (var moves = 0; moves < 16 && NextMove(text, type) is { } move; moves++)
            {
                text = move.Text;
                changes.Add((relative, move.Change));
            }
            if (text != written.Replace("\r\n", "\n")) File.WriteAllText(file, written.Contains("\r\n") ? text.Replace("\n", "\r\n") : text);
        }
        return changes;
    }

    private sealed record Moved(string Text, string Change);

    /// <summary>The first move the file needs — fields at the margin first, then those a level too deep — or null.</summary>
    private static Moved? NextMove(string text, Type type)
    {
        var yaml = new YamlStream();
        try
        {
            yaml.Load(new StringReader(text));
        }
        catch (YamlException)
        {
            return null; // RecordLinks names the break.
        }
        if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode root) return null;
        var lines = text.Split('\n').ToList();
        var known = RecordFiles.FieldsOf(type);
        var parts = new Dictionary<string, List<YamlScalarNode>>(StringComparer.Ordinal);
        foreach (var key in root.Children.Keys.OfType<YamlScalarNode>())
            if (key.Value is { } name && !known.Contains(name) && RecordFiles.PartFor(type, name, text) is { } part)
                (parts.TryGetValue(part, out var keys) ? keys : parts[part] = []).Add(key);
        foreach (var (part, keys) in parts)
            if (Under(lines, root, type, part, keys) is { } under) return under;
        return Up(lines, text, root, type, "", null, null, null) ?? Wrap(lines, root, type, "");
    }

    /// <summary>
    /// A part written as one value where the part has a field of its own name — an NPC's `- Item: 04F78D:Skyrim.esm`
    /// with `Count: 1` beside it, where an item is `Item:` with `Item:` and `Count:` below — written as that field, a
    /// level deeper, with the one-line fields beside it that the part has. Refused, both runs of e4b's that wrote an
    /// NPC's items so answered without building again (eval rounds 36 and 38). Walked as Up walks a record.
    /// </summary>
    private static Moved? Wrap(List<string> lines, YamlMappingNode mapping, Type type, string path)
    {
        if (mapping.Children.TryGetValue(new YamlScalarNode("MutagenObjectType"), out var kind)
            && kind is YamlScalarNode { Value: { Length: > 0 } named } && RecordFiles.KindOf(type, named) is { } concrete)
            type = concrete;
        foreach (var (keyNode, value) in mapping.Children)
        {
            if (keyNode is not YamlScalarNode { Value: { } key } field) continue;
            var property = type.GetProperties(Public).Where(p => p.Name == key).OrderBy(p => p.DeclaringType == type ? 0 : 1).FirstOrDefault();
            if (property is null) continue;
            var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (propertyType == typeof(string) || typeof(ITranslatedStringGetter).IsAssignableFrom(propertyType)
                || RecordLinks.LinkTarget(propertyType) is not null) continue;
            var fieldPath = path.Length == 0 ? key : $"{path}.{key}";
            var listed = typeof(System.Collections.IEnumerable).IsAssignableFrom(propertyType);
            if (value is YamlScalarNode { Value: { Length: > 0 } one } && propertyType.IsClass && !propertyType.IsAbstract && !listed
                && propertyType.GetProperties(Public).Any(p => p.Name == key && p.CanWrite))
                return Wrapped(lines, mapping, field, one, type, propertyType, fieldPath);
            if (value is YamlMappingNode nested && !listed)
            {
                if (Wrap(lines, nested, propertyType, fieldPath) is { } moved) return moved;
            }
            else if (value is YamlSequenceNode items && RecordLinks.ElementType(propertyType) is { } element)
                for (var i = 0; i < items.Children.Count; i++)
                    if (items.Children[i] is YamlMappingNode inner && Wrap(lines, inner, element, $"{fieldPath}[{i}]") is { } moved)
                        return moved;
        }
        return null;
    }

    /// <summary>The part at <paramref name="at"/>, written as <paramref name="one"/>, written as its own field below it, with those beside it it has.</summary>
    private static Moved? Wrapped(List<string> lines, YamlMappingNode mapping, YamlScalarNode at, string one, Type type, Type part, string path)
    {
        var key = at.Value!;
        var (line, column) = ((int)at.Start.Line - 1, (int)at.Start.Column - 1);
        var beside = mapping.Children
            .Where(c => c.Key is YamlScalarNode { Value: { } n } && n != key && n != "MutagenObjectType" && !Has(type, n) && part.GetProperties(Public).Any(p => p.Name == n))
            .Select(c => (Key: (YamlScalarNode)c.Key, c.Value)).ToList();
        // Only fields of one line, each on a line of its own: a block, or the field after a list item's dash, is left to the refusal.
        if (beside.Any(b => b.Value is not YamlScalarNode || b.Value.End.Line != b.Key.Start.Line
                || lines[(int)b.Key.Start.Line - 1][..((int)b.Key.Start.Column - 1)].Trim().Length > 0))
            return null;
        var rest = lines[line][(column + key.Length)..].TrimStart().TrimStart(':').Trim();
        var taken = beside.Select(b => (Line: (int)b.Key.Start.Line - 1, Text: lines[(int)b.Key.Start.Line - 1].Trim())).ToList();
        foreach (var (index, _) in taken.OrderByDescending(t => t.Line)) lines.RemoveAt(index);
        var keyLine = line - taken.Count(t => t.Line < line);
        var depth = new string(' ', column + 2);
        lines[keyLine] = lines[keyLine][..column] + $"{key}:";
        lines.InsertRange(keyLine + 1, taken.Select(t => depth + t.Text).Prepend($"{depth}{key}: {rest}"));
        var names = beside.Select(b => b.Key.Value!).ToList();
        return new Moved(string.Join('\n', lines),
            $"moved `{key}: {one}`{(names.Count > 0 ? $" and {Quoted(names)}" : "")} under `{path}:` — it takes fields of its own, " +
            string.Join(", ", part.GetProperties(Public).Where(p => p.CanWrite).Select(p => p.Name)));
    }

    /// <summary>
    /// Fields at the margin moved under the part they belong to, below its last line and as deep as its fields — or,
    /// where the record has no such part, under one written in their place. Told to move them, e4b put them inside the
    /// field above, or wrote them back at the margin (eval rounds 22 and 32).
    /// </summary>
    private static Moved? Under(List<string> lines, YamlMappingNode root, Type type, string part, List<YamlScalarNode> keys)
    {
        if (type.GetProperties(Public).FirstOrDefault(p => p.Name == part) is not { } property) return null;
        var names = keys.Select(k => k.Value!).ToList();
        int insertAt, indent;
        var create = false;
        if (root.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == part) is { } partKey)
        {
            var value = root.Children[partKey];
            if (value is YamlMappingNode { Style: not MappingStyle.Flow } mapping)
            {
                // A field the part has already would be written twice: which one is meant is the model's to say — but
                // the same one value says nothing more at the margin. e4b's sword+detailed #2 set BasicStats' Value to
                // the 150 it had written at the margin, was told to move it, and answered unbuilt (eval round 37).
                if (mapping.Children.FirstOrDefault(c => c.Key is YamlScalarNode { Value: { } n } && names.Contains(n)) is { Key: YamlScalarNode inPart } had)
                {
                    var atMargin = keys.First(k => k.Value == inPart.Value);
                    if (had.Value is not YamlScalarNode { Value: { } kept } || root.Children[atMargin] is not YamlScalarNode { Value: { } written }
                        || kept != written) return null;
                    var start = (int)atMargin.Start.Line - 1;
                    var dropped = lines[start].TrimEnd('\r').Trim();
                    lines.RemoveRange(start, BlockEnd(lines, start, 0) - start);
                    return new Moved(string.Join('\n', lines), $"removed `{dropped}` at the margin — `{part}` has it already, the same");
                }
                indent = mapping.Children.Keys.FirstOrDefault() is { } first ? (int)first.Start.Column - 1 : 2;
            }
            else if (value is YamlScalarNode { Value: null or "" }) indent = 2;
            else return null;
            insertAt = BlockEnd(lines, (int)partKey.Start.Line - 1, 0);
        }
        else
        {
            // A part of several kinds names its kind first; which kind is not the build's to say.
            if ((Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType).IsAbstract) return null;
            (insertAt, indent, create) = ((int)keys[0].Start.Line - 1, 2, true);
        }
        var blocks = keys.Select(k => (Start: (int)k.Start.Line - 1, End: BlockEnd(lines, (int)k.Start.Line - 1, 0))).ToList();
        var taken = blocks.SelectMany(b => lines.Skip(b.Start).Take(b.End - b.Start))
            .Select(line => line.Length == 0 ? line : new string(' ', indent) + line).ToList();
        if (create) taken.Insert(0, $"{part}:");
        // Taken out from the last one up, so the lines above keep their numbers; put in where the part's block ended,
        // less the lines taken out above that.
        foreach (var (start, end) in blocks.OrderByDescending(b => b.Start)) lines.RemoveRange(start, end - start);
        insertAt -= blocks.Where(b => b.Start < insertAt).Sum(b => b.End - b.Start);
        lines.InsertRange(insertAt, taken);
        var them = names.Count > 1 ? "them" : "it";
        return new Moved(string.Join('\n', lines),
            $"moved {Quoted(names)} under `{part}`{(create ? $", a `{part}:` line written above {them}" : "")} — " +
            $"{RecordFiles.Article(type.Name)} has {them} there, not at the margin");
    }

    /// <summary>
    /// Fields written a level too deep, moved up below the part they were written in, as deep as the part — the first
    /// part found holding any, all of its at once. Walked as RecordLinks walks a record: a part's kind from its
    /// MutagenObjectType; a list's items have no field above them to move to. <paramref name="at"/> is the part's key,
    /// <paramref name="parent"/> and <paramref name="above"/> the type and mapping it is a field of.
    /// </summary>
    private static Moved? Up(List<string> lines, string text, YamlMappingNode mapping, Type type, string path,
        Type? parent, YamlMappingNode? above, YamlScalarNode? at)
    {
        if (mapping.Children.TryGetValue(new YamlScalarNode("MutagenObjectType"), out var kind)
            && kind is YamlScalarNode { Value: { Length: > 0 } named } && RecordFiles.KindOf(type, named) is { } concrete)
            type = concrete;
        if (at is not null && parent is not null && above is not null && !type.IsInterface)
        {
            var theirs = parent.GetProperties(Public).Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
            var up = mapping.Children.Keys.OfType<YamlScalarNode>()
                .Where(k => k.Value is { } name && name != "MutagenObjectType" && !Has(type, name) && theirs.Contains(name)).ToList();
            // Written twice above, a field is refused as a duplicate: left to the refusal, as at the margin.
            if (up.Count > 0 && !above.Children.Keys.OfType<YamlScalarNode>().Any(k => up.Any(u => u.Value == k.Value))
                && UpFrom(lines, text, mapping, at, up, path) is { } moved)
                return moved;
        }
        foreach (var (keyNode, value) in mapping.Children)
        {
            if (keyNode is not YamlScalarNode { Value: { } key } field) continue;
            var property = type.GetProperties(Public).Where(p => p.Name == key).OrderBy(p => p.DeclaringType == type ? 0 : 1).FirstOrDefault();
            if (property is null) continue;
            var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (propertyType == typeof(string) || typeof(ITranslatedStringGetter).IsAssignableFrom(propertyType)
                || RecordLinks.LinkTarget(propertyType) is not null) continue;
            var fieldPath = path.Length == 0 ? key : $"{path}.{key}";
            if (value is YamlMappingNode nested && !typeof(System.Collections.IEnumerable).IsAssignableFrom(propertyType))
            {
                if (Up(lines, text, nested, propertyType, fieldPath, type, mapping, field) is { } moved) return moved;
            }
            else if (value is YamlSequenceNode items && RecordLinks.ElementType(propertyType) is { } element)
            {
                var i = 0;
                foreach (var item in items.Children)
                    if (item is YamlMappingNode inner && Up(lines, text, inner, element, $"{fieldPath}[{i++}]", null, null, null) is { } moved)
                        return moved;
            }
        }
        return null;
    }

    /// <summary>The fields <paramref name="up"/> taken out of the part at <paramref name="at"/> and written below it, as deep as it is.</summary>
    private static Moved? UpFrom(List<string> lines, string text, YamlMappingNode mapping, YamlScalarNode at, List<YamlScalarNode> up, string path)
    {
        var names = up.Select(k => k.Value!).ToList();
        var partLine = (int)at.Start.Line - 1;
        var partColumn = (int)at.Start.Column - 1;
        if (mapping.Style == MappingStyle.Flow)
        {
            // `Level: {MutagenObjectType: PcLevelMult, LevelMult: 1, CalcMinLevel: 1}` — on one line, of one values only. The
            // node's End is its start: the brace that closes it is the first after its last value.
            var closing = text.IndexOf('}', (int)mapping.Children.Values.Last().End.Index);
            var lineEnd = text.IndexOf('\n', (int)mapping.Start.Index);
            if (mapping.Start.Line != at.Start.Line || closing < 0 || lineEnd >= 0 && lineEnd < closing
                || mapping.Children.Values.Any(v => v is not YamlScalarNode))
                return null;
            string Pair(KeyValuePair<YamlNode, YamlNode> c) => $"{Raw(text, c.Key)}: {Raw(text, c.Value)}";
            var lineStart = text.LastIndexOf('\n', Math.Max(0, (int)mapping.Start.Index - 1)) + 1;
            var line = lines[partLine];
            var (open, close) = ((int)mapping.Start.Index - lineStart, closing + 1 - lineStart);
            lines[partLine] = line[..open] + "{" +
                string.Join(", ", mapping.Children.Where(c => !names.Contains(((YamlScalarNode)c.Key).Value!)).Select(Pair)) + "}" + line[close..];
            lines.InsertRange(partLine + 1, mapping.Children.Where(c => names.Contains(((YamlScalarNode)c.Key).Value!))
                .Select(c => new string(' ', partColumn) + Pair(c)));
        }
        else
        {
            var partEnd = BlockEnd(lines, partLine, partColumn);
            var keys = mapping.Children.Keys.OfType<YamlScalarNode>().ToList();
            var blocks = new List<(int Start, int End)>();
            foreach (var key in up)
            {
                var start = (int)key.Start.Line - 1;
                var next = keys.IndexOf(key) + 1 < keys.Count ? (int)keys[keys.IndexOf(key) + 1].Start.Line - 1 : partEnd;
                var end = Math.Min(next, partEnd);
                while (end > start + 1 && lines[end - 1].Trim().Length == 0) end--;
                blocks.Add((start, end));
            }
            var depth = (int)up[0].Start.Column - 1 - partColumn;
            var taken = blocks.SelectMany(b => lines.Skip(b.Start).Take(b.End - b.Start)).ToList();
            // Each line as much shallower as the part's fields are deeper than the part; one less deep is not the field's.
            if (depth <= 0 || taken.Any(line => line.Trim().Length > 0 && !line.StartsWith(new string(' ', depth), StringComparison.Ordinal)))
                return null;
            foreach (var (start, end) in blocks.OrderByDescending(b => b.Start)) lines.RemoveRange(start, end - start);
            lines.InsertRange(partEnd - blocks.Sum(b => b.End - b.Start), taken.Select(line => line.Length < depth ? line.TrimStart() : line[depth..]));
        }
        var dot = path.LastIndexOf('.');
        var (part, into) = (path[(dot + 1)..], dot < 0 ? "the margin" : $"`{path[..dot]}`");
        return new Moved(string.Join('\n', lines),
            $"moved {Quoted(names)} out of `{path}` up to {into}, below `{part}` — " +
            (names.Count > 1 ? $"they are not fields of {part}" : $"it is not a field of {part}"));
    }

    /// <summary>Whether a part has the field — one of its kinds, where the part is of several and names none.</summary>
    private static bool Has(Type type, string key) =>
        type.GetProperties(Public).Any(p => p.Name == key)
        || type.IsAbstract && type.Assembly.GetTypes().Any(t => !t.IsAbstract && type.IsAssignableFrom(t) && t.GetProperties(Public).Any(p => p.Name == key));

    /// <summary>
    /// Where the block of the field on line <paramref name="start"/> ends, as an index past its last line: the lines
    /// below it that are deeper than <paramref name="column"/>, blank, or a list's items at its depth — trailing blank
    /// lines left where they are.
    /// </summary>
    private static int BlockEnd(List<string> lines, int start, int column)
    {
        var end = start + 1;
        while (end < lines.Count && (lines[end].Trim().Length == 0 || Indent(lines[end]) > column
            || Indent(lines[end]) == column && lines[end].TrimStart().StartsWith('-')))
            end++;
        while (end > start + 1 && lines[end - 1].Trim().Length == 0) end--;
        return end;
    }

    private static int Indent(string line) => line.Length - line.TrimStart(' ').Length;

    private static string Raw(string text, YamlNode node) => text[(int)node.Start.Index..(int)node.End.Index];

    private static string Quoted(IEnumerable<string> names) => string.Join(", ", names.Select(n => $"`{n}`"));
}
