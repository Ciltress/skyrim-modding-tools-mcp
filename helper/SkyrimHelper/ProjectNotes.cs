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
        return notes;
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
