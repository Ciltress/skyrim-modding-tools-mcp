using System.Text.RegularExpressions;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Cache;
using Mutagen.Bethesda.Plugins.Records;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// A new spell's, enchantment's or scroll's effects, each cast as the record is. The game applies an
/// effect only through a spell of its own cast type and delivery, and the Creation Kit offers no other;
/// a build of text can name any. A small model built a Fire-and-Forget bolt on an atronach's
/// constant-effect cloak, which does nothing in game (eval probe 7 after round 11). What the game's own
/// plugins do otherwise is built all the same (<see cref="Shipped"/>).
/// </summary>
public static class EffectCasting
{
    /// <summary>
    /// A spell, enchantment or scroll: its effects' cast type, and the one written — 3 for a scroll. A
    /// spell with a HalfCostPerk is one a player casts, or an NPC's copy of one; a trap's, a hazard's and a
    /// creature's have none. Enchantments and scrolls count as the player's.
    /// </summary>
    private sealed record Caster(IMajorRecordGetter Record, string Kind, string Type, CastType Cast, CastType Written, TargetType Target,
        IReadOnlyList<IEffectGetter> Effects, bool Players = true);

    /// <summary>
    /// The ways the official plugins — Skyrim.esm, its update and DLCs, all 74 Creation Club plugins — cast
    /// an effect otherwise than its record: 15 of their 4,336 effects, in these ten shapes, read from every
    /// spell, enchantment and scroll of theirs. A build is not refused for what the game ships; several are
    /// cast by a script (the Skull of Corruption's, Mercer's Nightingale Strife). Kind, spell or enchantment
    /// type, then the record's and the effect's cast type and delivery.
    /// </summary>
    private static readonly HashSet<(string Kind, string Type, CastType Cast, CastType EffectCast, TargetType Target, TargetType EffectTarget)> ShippedShapes =
    [
        ("Scroll", "", CastType.Concentration, CastType.FireAndForget, TargetType.Self, TargetType.Self),                    // TGDetectLifeScroll
        ("Spell", "Spell", CastType.FireAndForget, CastType.FireAndForget, TargetType.TargetActor, TargetType.Aimed),       // DA16SkullOfCorruptionDamageSpell
        ("Spell", "Spell", CastType.FireAndForget, CastType.Concentration, TargetType.Aimed, TargetType.Aimed),             // TGNightingaleStrifeMercer
        ("Spell", "Spell", CastType.FireAndForget, CastType.ConstantEffect, TargetType.Self, TargetType.Self),              // ccRMSSSE001_AltarVaerminaSpell
        ("Spell", "Ability", CastType.ConstantEffect, CastType.ConstantEffect, TargetType.Self, TargetType.TargetLocation), // AbIceWraithFX
        ("Spell", "Ability", CastType.FireAndForget, CastType.FireAndForget, TargetType.Self, TargetType.Touch),            // TrapPoisonGasSpell01NotUsed
        ("Spell", "Ability", CastType.FireAndForget, CastType.ConstantEffect, TargetType.Self, TargetType.Self),            // DLC1AbKeeperWispCloak
        ("Spell", "Voice", CastType.FireAndForget, CastType.ConstantEffect, TargetType.Self, TargetType.Self),              // DLC1LD_ForgemasterFlameCloak
        ("ObjectEffect", "Enchantment", CastType.ConstantEffect, CastType.FireAndForget, TargetType.TargetActor, TargetType.Self), // MQClearSkyFogEnch
        ("ObjectEffect", "Enchantment", CastType.ConstantEffect, CastType.FireAndForget, TargetType.Touch, TargetType.Touch),      // DLC1nVampireMagicaDrainClawsENCH
    ];

    /// <summary>
    /// Whether an effect cast <paramref name="effectCast"/> on <paramref name="effectTarget"/> builds in a record cast
    /// <paramref name="cast"/> on <paramref name="target"/>: the same, or a way the official plugins cast it. A scroll's
    /// cast type 3 counts as FireAndForget.
    /// </summary>
    public static bool Fits(string kind, string type, CastType cast, CastType effectCast, TargetType target, TargetType effectTarget) =>
        EffectsCast(cast) == effectCast && target == effectTarget
        || ShippedShapes.Contains((kind, type, EffectsCast(cast), effectCast, target, effectTarget));

    /// <summary>The new records of the plugin whose effects are cast otherwise than they are, as messages naming the file and the way out.</summary>
    public static List<string> Mismatches(ISkyrimModGetter mod, ILinkCache lookup, RecordIndex index, string pluginDir)
    {
        var files = RecordFiles.FlatRecords(pluginDir)
            .Select(f => (f.Relative, RecordFiles.Identity(File.ReadAllText(f.File)).FormKey))
            .Where(f => f.FormKey is not null)
            .GroupBy(f => f.FormKey!.Value).ToDictionary(g => g.Key, g => g.First().Relative);
        var problems = new List<string>();
        foreach (var caster in Casters(mod).Where(c => c.Record.FormKey.ModKey == mod.ModKey))
        {
            var name = caster.Record.EditorID ?? Session.FormKeyText(caster.Record.FormKey);
            var where = files.TryGetValue(caster.Record.FormKey, out var relative) ? relative : name;
            for (var i = 0; i < caster.Effects.Count; i++)
            {
                if (caster.Effects[i].BaseEffect.IsNull) continue;
                var key = caster.Effects[i].BaseEffect.FormKey;
                var ownEffect = mod.MagicEffects.FirstOrDefault(m => m.FormKey == key);
                if ((ownEffect ?? (lookup.TryResolve<IMagicEffectGetter>(key, out var found) ? found : null)) is not { } effect) continue;
                if (Fits(caster.Kind, caster.Type, caster.Cast, effect.CastType, caster.Target, effect.TargetType)) continue;

                var effectName = effect.EditorID ?? Session.FormKeyText(key);
                var said = $"{where}: Effects[{i}].BaseEffect {effectName} is cast {effect.CastType} on {effect.TargetType}, and {name} " +
                    $"{caster.Cast} on {caster.Target} — an effect does nothing in {RecordFiles.Article(caster.Kind)} cast otherwise: ";
                if (caster.Kind == "Scroll" && effect.CastType == CastType.FireAndForget && effect.TargetType == caster.Target)
                {
                    problems.Add(said + "write CastType: 3 in the scroll, the cast type every scroll of the game has");
                    continue;
                }
                // Left out, CastType and TargetType read as ConstantEffect and Self: a weapon's enchantment without
                // them was told to take a cloak's effect in place of its fire (eval probe 8 after round 11).
                var text = relative is null ? "" : File.ReadAllText(Path.Combine(pluginDir, relative));
                var castLeftOut = effect.CastType != caster.Cast && !Regex.IsMatch(text, @"^CastType:", RegexOptions.Multiline);
                var targetLeftOut = effect.TargetType != caster.Target && !Regex.IsMatch(text, @"^TargetType:", RegexOptions.Multiline);
                if (castLeftOut || targetLeftOut)
                {
                    var give = new[] { effect.CastType != caster.Cast ? $"CastType: {effect.CastType}" : null, effect.TargetType != caster.Target ? $"TargetType: {effect.TargetType}" : null }
                        .OfType<string>();
                    problems.Add(said + $"write {string.Join(" and ", give)} in {name}, as its effect is cast — " +
                        $"{RecordFiles.Article(caster.Kind)} without them is cast ConstantEffect on Self");
                    continue;
                }
                if (ownEffect is not null)
                {
                    problems.Add(said + $"give both the same CastType and TargetType, the ones the {caster.Kind} is meant to have");
                    continue;
                }
                var ways = Ways(effect, caster, i, lookup, index, mod.ModKey);
                problems.Add(said + (ways.Count > 0
                    ? string.Join("; or ", ways)
                    : $"find an effect cast {caster.Cast} on {caster.Target} with findRecords (types [\"MGEF\"]) and readRecord"));
            }
        }
        // A modifier that names no actor value changes nothing: e4b's Storm Bolt effect, its Archetype written over at last,
        // built as a plain success (eval round 27).
        foreach (var effect in mod.MagicEffects.Where(m => m.FormKey.ModKey == mod.ModKey))
        {
            if (!Modifiers.TryGetValue(effect.Archetype.Type, out var usual) || effect.Archetype.ActorValue != ActorValue.None) continue;
            var name = effect.EditorID ?? Session.FormKeyText(effect.FormKey);
            var relative = files.GetValueOrDefault(effect.FormKey);
            var written = relative is not null && Regex.IsMatch(File.ReadAllText(Path.Combine(pluginDir, relative)), @"^Archetype:", RegexOptions.Multiline);
            var official = $"the official plugins' {effect.Archetype.Type} effects name Health most often: {usual} — each of their {ModifierCount} " +
                "modifier and absorb effects names an actor value";
            problems.Add($"{relative ?? name}: " + (written
                ? $"{name} is a {effect.Archetype.Type} that names no actor value, so it changes nothing — write the one it changes under " +
                    $"Archetype, as deep as its other lines: `ActorValue: Health` for damage ({official})"
                : $"{name} has no Archetype, so it is a ValueModifier that names no actor value, and changes nothing — write `Archetype:` " +
                    $"at the margin with `MutagenObjectType: MagicEffectArchetype` and the actor value it changes below it, two spaces in: " +
                    $"`ActorValue: Health` for damage ({official})"));
        }
        return problems;
    }

    /// <summary>
    /// The archetypes that change an actor value, and how many of the official plugins' effects of each name Health,
    /// the one they name most often: every one of their 1,133 names an actor value (2,108 magic effects of the 80
    /// official plugins audited, 2026-10-21).
    /// </summary>
    private static readonly Dictionary<MagicEffectArchetype.TypeEnum, string> Modifiers = new()
    {
        [MagicEffectArchetype.TypeEnum.ValueModifier] = "282 of 496",
        [MagicEffectArchetype.TypeEnum.PeakValueModifier] = "53 of 405",
        [MagicEffectArchetype.TypeEnum.DualValueModifier] = "131 of 160",
        [MagicEffectArchetype.TypeEnum.Absorb] = "37 of 72"
    };
    private const string ModifierCount = "1,133";

    private static Caster Of(ISpellGetter s) => new(s, "Spell", s.Type.ToString(), EffectsCast(s.CastType), s.CastType, s.TargetType, s.Effects, !s.HalfCostPerk.IsNull);
    private static Caster Of(IObjectEffectGetter e) => new(e, "ObjectEffect", e.EnchantType.ToString(), EffectsCast(e.CastType), e.CastType, e.TargetType, e.Effects);
    private static Caster Of(IScrollGetter s) => new(s, "Scroll", "", EffectsCast(s.CastType), s.CastType, s.TargetType, s.Effects);

    private static IEnumerable<Caster> Casters(ISkyrimModGetter mod) =>
        mod.Spells.Select(s => Of(s)).Concat(mod.ObjectEffects.Select(e => Of(e))).Concat(mod.Scrolls.Select(s => Of(s)));

    /// <summary>The load order's spells, enchantments or scrolls of the record's kind and type, the project's own left out.</summary>
    private static IEnumerable<Caster> Kin(Caster caster, ILinkCache lookup, RecordIndex index, ModKey own) => index.ByFormKey.Values
        .Where(e => e.Type == caster.Kind && e.FormKey.ModKey != own)
        .Select(e => caster.Kind switch
        {
            "Spell" => lookup.TryResolve<ISpellGetter>(e.FormKey, out var spell) ? Of(spell) : null,
            "ObjectEffect" => lookup.TryResolve<IObjectEffectGetter>(e.FormKey, out var enchantment) ? Of(enchantment) : null,
            _ => lookup.TryResolve<IScrollGetter>(e.FormKey, out var scroll) ? Of(scroll) : null
        })
        .OfType<Caster>()
        .Where(c => c.Type == caster.Type);

    /// <summary>
    /// The cast type a record's effects have: its own, but FireAndForget for 3, the scroll's, which Mutagen's
    /// CastType does not name — all 103 regular scrolls of the official plugins are cast 3 with fire-and-forget
    /// effects, and Saints and Seducers' would not build until this said so.
    /// </summary>
    private static CastType EffectsCast(CastType cast) => cast == (CastType)3 ? CastType.FireAndForget : cast;

    /// <summary>
    /// The ways out, as the lines to write: as the load order's records of the kind cast effects like the
    /// one named — the player's spells, where any does — up to two ways of casting, the fewest lines to
    /// change first, each with the effect most of them name and a record to mirror; and keeping the
    /// effect, where such records are cast as it is. Told "name an effect cast FireAndForget instead, and give StormBolt its TargetType: … on
    /// Touch, ShockDamageFFAimed … on Aimed", a model wrote CastType: Aimed; and weapons' enchantment
    /// effects were offered first, by their names alone (eval probe 9 after round 11).
    /// </summary>
    private static List<string> Ways(IMagicEffectGetter named, Caster caster, int item, ILinkCache lookup, RecordIndex index, ModKey own)
    {
        var effects = new Dictionary<FormKey, IMagicEffectGetter?>();
        IMagicEffectGetter? EffectOf(FormKey key) => effects.TryGetValue(key, out var known) ? known
            : effects[key] = lookup.TryResolve<IMagicEffectGetter>(key, out var found) ? found : null;

        var kin = Kin(caster, lookup, index, own).ToList();
        // Only records cast as their effects are: a way out is never one of the shapes the game ships by exception.
        var uses = kin.SelectMany(record => record.Effects.Where(e => !e.BaseEffect.IsNull)
                .Select(e => (Record: record, Effect: EffectOf(e.BaseEffect.FormKey))))
            .Where(use => use.Effect is { } effect && effect.CastType == use.Record.Cast && effect.TargetType == use.Record.Target)
            .Select(use => (use.Record, Effect: use.Effect!))
            .ToList();
        var like = uses.Where(use => Like(named, use.Effect, strict: true)).ToList();
        if (like.Count == 0 && (named.ResistValue != ActorValue.None || named.MagicSkill != ActorValue.None))
            like = uses.Where(use => Like(named, use.Effect, strict: false)).ToList();
        // A spell the player casts is the one to mirror: by number alone, a shock bolt was sent to a trap's
        // and a hazard's (TrapLightningBolt01, HazardWallOfShockSpell) before Lightning Bolt.
        if (like.Any(use => use.Record.Players)) like = like.Where(use => use.Record.Players).ToList();
        var castable = kin.Any(k => k.Players) ? kin.Where(k => k.Players).ToList() : kin;

        var name = caster.Record.EditorID ?? Session.FormKeyText(caster.Record.FormKey);
        var ways = like.GroupBy(use => (use.Record.Cast, use.Record.Target))
            .Select(shape =>
            {
                var best = shape.GroupBy(use => use.Effect.FormKey)
                    .OrderByDescending(g => g.Count())
                    .ThenByDescending(g => RecordLinks.SharedWords(RecordLinks.WordsOf(named.EditorID ?? ""), RecordLinks.WordsOf(g.First().Effect.EditorID ?? "")).Count)
                    .ThenBy(g => g.First().Effect.EditorID?.Length ?? int.MaxValue)
                    .First();
                var example = best.Select(use => use.Record)
                    .OrderBy(r => r.Record.EditorID?.Length ?? int.MaxValue).ThenBy(r => r.Record.EditorID, StringComparer.Ordinal).First();
                return (Lines: Lines(caster, item, named, best.First().Effect, example.Written, shape.Key.Target), Uses: shape.Count(), Example: example.Record);
            })
            .Where(way => way.Lines.Count > 0)
            .OrderBy(way => way.Lines.Count).ThenByDescending(way => way.Uses)
            .Take(2)
            .ToList();
        var said = ways.Select(way => $"write {name} the way {Shown(way.Example)} is cast: {Joined(way.Lines)}").ToList();

        var keepWritten = caster.Kind == "Scroll" && named.CastType == CastType.FireAndForget ? (CastType)3 : named.CastType;
        var keep = Lines(caster, item, named, named, keepWritten, named.TargetType);
        if (keep.Count > 0 && castable.Any(k => k.Cast == named.CastType && k.Target == named.TargetType)
            && !ways.Any(way => way.Lines.SequenceEqual(keep)))
            said.Add($"keep {named.EditorID ?? Session.FormKeyText(named.FormKey)} and write {Joined(keep)} in {name}");
        return said;
    }

    /// <summary>
    /// Whether an effect does what the one named does: the same resistance and school, where it has them,
    /// and, strictly, the same archetype on the same actor value — damage to Health, not a cloak.
    /// </summary>
    private static bool Like(IMagicEffectGetter named, IMagicEffectGetter effect, bool strict) =>
        (named.ResistValue == ActorValue.None || effect.ResistValue == named.ResistValue)
        && (named.MagicSkill == ActorValue.None || effect.MagicSkill == named.MagicSkill)
        && (!strict || effect.Archetype.Type == named.Archetype.Type && effect.Archetype.ActorValue == named.Archetype.ActorValue);

    /// <summary>The lines that cast a record as another is, with that one's effect: only those that change.</summary>
    private static List<string> Lines(Caster caster, int item, IMagicEffectGetter named, IMagicEffectGetter effect, CastType written, TargetType target)
    {
        var lines = new List<string>();
        if (EffectsCast(written) != caster.Cast || written != caster.Written && caster.Kind == "Scroll") lines.Add($"`CastType: {written}`");
        if (target != caster.Target) lines.Add($"`TargetType: {target}`");
        if (effect.FormKey != named.FormKey) lines.Add($"in Effects[{item}] `BaseEffect: {effect.EditorID ?? Session.FormKeyText(effect.FormKey)}`");
        return lines;
    }

    private static string Joined(List<string> lines) =>
        lines.Count == 1 ? lines[0] : $"{string.Join(", ", lines.Take(lines.Count - 1))} and {lines[^1]}";

    private static string Shown(IMajorRecordGetter record) =>
        record.EditorID is { } id ? $"{id} ({Session.FormKeyText(record.FormKey)})" : Session.FormKeyText(record.FormKey);
}
