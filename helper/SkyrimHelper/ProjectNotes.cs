using System.Text.RegularExpressions;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Cache;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// What a project's records build into, but likely not as meant — said beside a build that succeeds,
/// not refused, as the official plugins do each of them here and there: a man with a woman's voice
/// among their corpses and test NPCs, an enchantment no item carries. Models wrote both (eval probe 14).
/// </summary>
public static class ProjectNotes
{
    private static readonly Regex VoiceLine = new(@"^Voice:[ \t]*([^\s#]+)", RegexOptions.Multiline);
    private static readonly Regex FemaleFlag = new(@"^[ \t]+-[ \t]*Female[ \t]*\r?$|^[ \t]+Flags:[ \t]*\[[^\]\r\n]*\bFemale\b", RegexOptions.Multiline);
    private static readonly Regex TemplateLine = new(@"^Template:[ \t]*\S", RegexOptions.Multiline);

    /// <summary>The notes on the project's own records, each naming its file.</summary>
    public static List<string> Of(string pluginDir, RecordIndex index, ILinkCache cache)
    {
        var own = RecordFiles.OwnPlugin(pluginDir);
        var files = RecordFiles.FlatRecords(pluginDir).Select(f => (f.Relative, f.Type, Text: File.ReadAllText(f.File)))
            .Where(f => RecordFiles.Identity(f.Text).FormKey is not { } key || key.ModKey == own).ToList();
        var notes = new List<string>();
        foreach (var (relative, type, text) in files)
        {
            if (type == typeof(Npc) && Voice(text, index, cache) is { } voice
                && !(TemplateLine.IsMatch(text) && text.Contains("Traits", StringComparison.Ordinal)))
            {
                var name = RecordFiles.Identity(text).EditorId ?? relative;
                var woman = FemaleFlag.IsMatch(text);
                var womansVoice = voice.Flags.HasFlag(VoiceType.Flag.Female);
                if (womansVoice && !woman)
                    notes.Add($"{relative}: {name} speaks with {voice.EditorID}, a woman's voice, but has no Female among Configuration.Flags, " +
                        "so the game makes this NPC a man — a woman has `- Female` there");
                else if (woman && !womansVoice && voice.EditorID?.StartsWith("Male", StringComparison.Ordinal) == true)
                    notes.Add($"{relative}: {name} is a woman (Female) who speaks with {voice.EditorID}, a man's voice — " +
                        "the npcs skill names each race's woman's voice");
            }
            if (type == typeof(ObjectEffect) && RecordFiles.Identity(text) is { EditorId: { } enchantment } identity)
            {
                // Named by any other record of the project — by editor ID, or by the FormID a build wrote in.
                var formId = identity.FormKey is { } key ? Session.FormKeyText(key) : null;
                var named = files.Any(f => f.Relative != relative
                    && (Regex.IsMatch(f.Text, $@"\b{Regex.Escape(enchantment)}\b") || formId is not null && f.Text.Contains(formId, StringComparison.OrdinalIgnoreCase)));
                if (!named)
                    notes.Add($"{relative}: no record of the project names {enchantment}, so it does nothing — a weapon or armor " +
                        $"carries it as `ObjectEffect: {enchantment}`");
            }
        }
        // A record copied whole and renamed, its FormKey and EditorID kept, builds as a change to that record, not as
        // a new one beside it: e4b's "new note" was Maven's own, renamed (eval probe 19). A patch renames now and then.
        foreach (var (relative, _, text) in RecordFiles.FlatRecords(pluginDir).Select(f => (f.Relative, f.Type, Text: File.ReadAllText(f.File))))
        {
            if (RecordFiles.Identity(text).FormKey is not { } key || key.ModKey == own) continue;
            if (!index.ByFormKey.TryGetValue(key, out var entry) || entry.Name is not { Length: > 0 } was) continue;
            if (NameIn(text) is not { } now || now == was) continue;
            notes.Add($"{relative}: overrides {entry.EditorId} of {key.ModKey.FileName} and renames it from '{was}' to '{now}', so the game " +
                $"shows that record as '{now}' wherever it is. A new record of its own has no FormKey line, and an EditorID of its own");
        }
        return notes;
    }

    /// <summary>A record's in-game name as its file writes it — `Name:` with its `Value:` below — unquoted; null for none.</summary>
    private static string? NameIn(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var at = Array.FindIndex(lines, line => line.TrimEnd() == "Name:");
        if (at < 0) return null;
        foreach (var line in lines.Skip(at + 1).TakeWhile(line => line.StartsWith(' ')))
        {
            var value = line.Trim();
            if (!value.StartsWith("Value:", StringComparison.Ordinal)) continue;
            value = value["Value:".Length..].Trim();
            if (value.Length >= 2 && value[0] == '\'' && value[^1] == '\'') return value[1..^1].Replace("''", "'");
            if (value.Length >= 2 && value[0] == '"' && value[^1] == '"') return Regex.Unescape(value[1..^1]);
            return value;
        }
        return null;
    }

    /// <summary>The voice type an NPC's file names, by editor ID or FormID; null for none or one the load order lacks.</summary>
    private static IVoiceTypeGetter? Voice(string text, RecordIndex index, ILinkCache cache)
    {
        if (VoiceLine.Match(text) is not { Success: true } line) return null;
        var raw = line.Groups[1].Value;
        var key = raw.Contains(':') ? FormKey.TryFactory(raw, out var formKey) ? formKey : (FormKey?)null
            : index.ByEditorId.TryGetValue(raw, out var byId) ? byId : null;
        return key is { } found && cache.TryResolve<IVoiceTypeGetter>(found, out var voice) ? voice : null;
    }
}
