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
    private static readonly Regex NameLine = new(@"^Name[ \t]*:", RegexOptions.Multiline);
    private static readonly Regex EffectsLine = new(@"^Effects[ \t]*:", RegexOptions.Multiline);

    /// <summary>The record types whose work is their Effects: each item a magic effect, with its strength.</summary>
    private static readonly HashSet<string> Effected = new(StringComparer.Ordinal) { "Spell", "ObjectEffect", "Ingestible", "Ingredient", "Scroll" };

    /// <summary>The record types the player sees by name — in the inventory, the magic menu, under the crosshair.</summary>
    private static readonly HashSet<string> Named = new(StringComparer.Ordinal)
    {
        "Weapon", "Armor", "Ammunition", "Book", "MiscItem", "Ingestible", "Ingredient", "Scroll", "Key", "SoulGem", "Spell", "Shout", "Npc"
    };

    /// <summary>The named types the game has many of one of — carried, sold, found — where a spell or an NPC is one.</summary>
    private static readonly HashSet<string> Things = new(StringComparer.Ordinal)
    {
        "Weapon", "Armor", "Ammunition", "Book", "MiscItem", "Ingestible", "Ingredient", "Scroll", "Key", "SoulGem"
    };

    /// <summary>The notes on the project's own records, each naming its file.</summary>
    public static List<string> Of(string pluginDir, RecordIndex index, ILinkCache cache)
    {
        var own = RecordFiles.OwnPlugin(pluginDir);
        // A file written empty, or with only comments, holds no record to note: it is left out of the build.
        var records = RecordFiles.FlatRecords(pluginDir).Select(f => (f.Relative, f.Type, Text: File.ReadAllText(f.File)))
            .Where(f => !RecordFiles.Empty(f.Text)).ToList();
        var newRecords = records.Where(f => RecordFiles.Identity(f.Text).FormKey is not { } key || key.ModKey == own).ToList();
        // Beside a weapon or armor that carries none, the build refuses such an enchantment (RecordLinks); alone, it may be another mod's.
        var unworn = RecordFiles.Unworn(records, own).Where(u => u.Carriers.Count == 0).Select(u => u.Relative).ToHashSet(StringComparer.Ordinal);
        var notes = new List<string>();
        foreach (var (relative, type, text) in newRecords)
        {
            // Left with no EditorID, its file's name no editor ID to give it (RecordFiles.NameFromFiles): 13 of e4b's
            // spells in eval rounds 25–36 were built so, nameless to links and to tools like SPID.
            if (RecordFiles.Identity(text).EditorId is null)
                notes.Add($"{relative}: {RecordFiles.Article(type.Name)} has no EditorID, so no link of the project and no tool like " +
                    "SPID can name it — write a line `EditorID:` with a name no other record has, at the margin below any FormKey line");
            // A new spell or NPC with no Name builds, and the game shows it with none: e4b's Storm Bolt and Hilda did,
            // and each run ended there (round 22's e4b probe). An NPC with a template may take its name from it.
            if (Named.Contains(type.Name) && !NameLine.IsMatch(text) && !(type == typeof(Npc) && TemplateLine.IsMatch(text)))
                notes.Add($"{relative}: {RecordFiles.Identity(text).EditorId ?? RecordFiles.Article(type.Name)} has no Name, so the game " +
                    "shows it with none — in the inventory, the magic menu, under the crosshair. A name is two lines indented below `Name:`, " +
                    "`TargetLanguage: English` and `Value:` with the name; a record the player never sees can go without");
            // A spell or enchantment with no Effects builds, and does nothing: e4b's Storm Bolt, the magic effect's fields
            // it was told to delete deleted with its Effects, and Flame Blade's enchantment of a name alone (eval round 37).
            if (Effected.Contains(type.Name) && !EffectsLine.IsMatch(text))
                notes.Add($"{relative}: {RecordFiles.Identity(text).EditorId ?? RecordFiles.Article(type.Name)} has no Effects, so it " +
                    "does nothing — each item of `Effects` names a magic effect as `- BaseEffect: X`, with its `Data` (Magnitude, Area, " +
                    "Duration) below, as readRecord shows a vanilla one");
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
            if (unworn.Contains(relative) && RecordFiles.Identity(text).EditorId is { } enchantment)
                notes.Add($"{relative}: no record of the project names {enchantment}, so it does nothing — a weapon or armor " +
                    $"carries it as `ObjectEffect: {enchantment}`");
            // So too a new magic effect: e4b's Storm Bolt was a magic effect alone, built and told the user as the spell
            // (eval round 34, spell+detailed #3).
            if (type == typeof(MagicEffect) && RecordFiles.Identity(text).EditorId is { } effect && !RecordFiles.NamedElsewhere(records, relative, text))
                notes.Add($"{relative}: no record of the project names {effect}, so the magic effect does nothing — a spell casts it " +
                    $"as `- BaseEffect: {effect}` among its `Effects`, as an enchantment, potion or scroll does");
        }
        // A record copied whole and renamed, its FormKey and EditorID kept, builds as a change to that record, not as
        // a new one beside it: e4b's "new note" was Maven's own, renamed (eval probe 19). A patch renames now and then.
        foreach (var (relative, type, text) in records)
        {
            if (RecordFiles.Identity(text).FormKey is not { } key || key.ModKey == own) continue;
            if (!index.ByFormKey.TryGetValue(key, out var entry) || entry.Name is not { Length: > 0 } was) continue;
            if (NameIn(text) is not { } now || now == was) continue;
            // What it does in the game, and the one edit that makes the copy a new record: told the game shows that
            // record renamed wherever it is, e4b told the user its sword was "successfully overridden and renamed" (round 23).
            // Told what it does, e4b reasoned that the copy still gave the user a sword called Flame Blade (round 25):
            // a new one asked for is not this copy, said so.
            var becomes = type.Name switch
            {
                var thing when Things.Contains(thing) =>
                    $"every {was} in the game — the player's, the merchants', the ones NPCs carry and leveled lists hand out — becomes '{now}'",
                "Spell" or "Shout" => $"{was} becomes '{now}' for every caster, the player and NPCs alike",
                "Npc" => $"{was} becomes '{now}' wherever the game places them",
                _ => $"the game shows that record as '{now}' wherever it is"
            };
            notes.Add($"{relative}: overrides {entry.EditorId} of {key.ModKey.FileName} and renames it from '{was}' to '{now}': {becomes}, " +
                $"with all this file changes. If a new one was asked for, this copy is not it: delete this file's FormKey line and give " +
                $"it an EditorID of its own — it builds as a new record, and {was} stays as it is");
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
