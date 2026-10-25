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

    /// <summary>The skill whose tables hold a record type's lines — the server's FAMILY_SKILLS — or null.</summary>
    private static string? SkillOf(string type) => type switch
    {
        "Weapon" or "Armor" or "ArmorAddon" or "Ammunition" or "Ingestible" or "Ingredient" or "Book" or "MiscItem"
            or "ConstructibleObject" or "ObjectEffect" => "items-and-crafting",
        "Spell" or "MagicEffect" or "Scroll" or "Shout" => "magic",
        "Npc" => "npcs",
        "LeveledItem" or "LeveledNpc" or "LeveledSpell" => "leveled-lists",
        _ => null
    };

    /// <summary>The everyday vanilla record of a type, by editor ID, or null — for messages written without the load order.</summary>
    internal static string? ExampleName(string type) => Examples.GetValueOrDefault(type);

    /// <summary>The editor ID of a vanilla record of the type — the everyday one, else the first the load order has.</summary>
    private static string? ExampleOf(Type type, RecordIndex index) =>
        Examples.TryGetValue(type.Name, out var example) && index.ByEditorId.TryGetValue(example, out var key)
            && index.ByFormKey.TryGetValue(key, out var entry) && entry.Type == type.Name
            ? example
            : index.ByFormKey.Values.FirstOrDefault(e => e.Type == type.Name && e.EditorId is not null)?.EditorId;

    /// <summary>The group folders a new record of an everyday kind goes into, for messages.</summary>
    // "ObjectEffects (enchantments)" was taken for a folder's name, then "ObjectEffectsEnchantments" (eval probe 19).
    public const string CommonGroups = "Weapons, Armors, Spells, MagicEffects, Npcs, LeveledItems, and ObjectEffects for an enchantment";

    /// <summary>
    /// The group folder another word names — its record type's own name, or the game's word for it, one
    /// or many: Enchantments is ObjectEffects, Notes is Books, Weapon is Weapons. Null for none.
    /// </summary>
    private static string? GroupCalled(string folder)
    {
        string[] words = [folder, folder.EndsWith("es", StringComparison.OrdinalIgnoreCase) ? folder[..^2] : folder, folder.TrimEnd('s', 'S')];
        foreach (var word in words.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var typeName = RecordIndex.EditorNames.TryGetValue(word, out var named) ? named : word;
            if (Groups.FirstOrDefault(g => g.Value is not null && g.Value.Name.Equals(typeName, StringComparison.OrdinalIgnoreCase)).Key is { } group)
                return group;
        }
        return null;
    }

    private static readonly ConcurrentDictionary<Type, HashSet<string>> Fields = new();

    private static readonly Regex TopLevelKey = new(@"^([A-Za-z_]\w*)[ \t]*:", RegexOptions.Multiline);
    // A comment after the value is no part of it: `FormKey: 000123:Skyrim.esm # Placeholder` passed for a new record (round 14).
    // A value of words is one too: `FormKey: [Will be assigned]` matched nothing, and the reader's list was refused as
    // "FormKey takes fields of its own" (eval round 51's sword+detailed #1) — taken out now, as any line that is no FormKey.
    private static readonly Regex FormKeyLine = new(@"^FormKey:[ \t]*([^#\r\n]*?)[ \t]*(?:#.*?)?\r?$", RegexOptions.Multiline);

    private static readonly Regex ObjectTypeLine = new(@"^MutagenObjectType:[ \t]*(\w+)", RegexOptions.Multiline);
    private static readonly Regex EditorIdLine = new(@"^EditorID:[ \t]*([^\s#]+)[ \t]*(?:#.*?)?\r?$", RegexOptions.Multiline);
    private static readonly Regex AnyEditorIdLine = new(@"^EditorID[ \t]*:", RegexOptions.Multiline);
    private static readonly Regex WrittenEditorIdLine = new(@"^EditorID[ \t]*:[ \t]*(?<value>[^\r\n]*?)[ \t]*(?:[ \t]#[^\r\n]*)?(?=\r?$)", RegexOptions.Multiline);
    private static readonly Regex EditorIdName = new(@"^[A-Za-z_][A-Za-z0-9_]*$");
    // The lines Spriggit writes above a record's EditorID.
    private static readonly Regex HeadLine = new(@"^(?:FormKey|MutagenObjectType|VersionControl)[ \t]*:");
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

    private static readonly Regex SmallFlag = new(@"^\s*-\s*Small\s*$|^\s*Flags:\s*\[[^\]]*\bSmall\b", RegexOptions.Multiline);

    /// <summary>Whether a project's folder builds a light plugin: its RecordData.yaml flags it Small, as newProject writes it.</summary>
    public static bool LightPlugin(string pluginDir)
    {
        var header = Path.Combine(pluginDir, "RecordData.yaml");
        return File.Exists(header) && SmallFlag.IsMatch(File.ReadAllText(header));
    }

    /// <summary>The highest FormID a light plugin's records can have.</summary>
    private const uint LightMax = 0xFFF;

    /// <summary>
    /// Whether a record file holds no record: nothing, or only blank lines and comments. "Emptied" with a comment,
    /// a magic effect built as a record of no fields and no EditorID (eval round 25).
    /// </summary>
    public static bool Empty(string text) =>
        text.Split('\n').All(line => line.Trim().Length == 0 || line.TrimStart().StartsWith('#'));

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
    internal static HashSet<string> FieldsOf(Type type) =>
        Fields.GetOrAdd(type, t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name)
            .Append("MutagenObjectType").ToHashSet(StringComparer.Ordinal));

    /// <summary>
    /// Fields written under another name, by the record types they were written on — the names a small
    /// model guessed after reading the vanilla record a refusal named (eval round 11's probes). Checked
    /// before a field of that name further down: a weapon's <c>Effect</c> is its enchantment, not the
    /// critical hit's Effect.
    /// </summary>
    private static readonly (string[] Types, string[] Keys, string? Field, string Hint)[] Synonyms =
    [
        (["Weapon", "Armor"], ["Enchantment", "Enchantments", "Enchant", "Effect", "Effects", "MagicEffect", "BaseEffect"], "ObjectEffect",
            "an enchantment is ObjectEffect, naming an ObjectEffect record"),
        (["MagicEffect"], ["Magnitude", "Damage", "DamageAmount", "Area", "Duration"], null, EffectStrength),
        (["MagicEffect"], ["DamageType", "Element", "Resist"], null,
            "fire, frost and shock damage is ResistValue — ResistFire, ResistFrost, ResistShock — with Archetype's ActorValue Health"),
        (["Spell", "ObjectEffect", "Scroll", "Ingestible", "Ingredient"], ["Damage", "DamageAmount", "Strength"], null,
            "damage is Magnitude, under Data, in each item of Effects"),
        (["EffectData"], ["Damage", "DamageAmount", "Strength"], "Magnitude", "damage is Magnitude"),
        // An item of Effects names its magic effect as BaseEffect; told "has no field Effect", a model kept it (eval probe 10).
        (["Effect"], ["Effect", "MagicEffect", "EffectID", "MGEF", "Base", "Spell", "EffectType", "Type"], "BaseEffect", "it is BaseEffect, naming the MagicEffect"),
        // An enchantment's charge belongs to what carries it; told "delete it", e4b wrote it elsewhere in the enchantment (eval round 19).
        (["ObjectEffect", "Effect", "EffectData"], ["Charge", "Charges", "ChargeAmount", "EnchantmentCharge"], null,
            "an enchantment's charge is the weapon's or armor's EnchantmentAmount, beside its ObjectEffect line"),
        // Told only "delete it", a model dropped the damage of its sword's enchantment (eval round 17).
        (["Effect"], ["Damage", "DamageAmount", "Strength"], null, "damage is Magnitude, under Data — beside Area and Duration"),
        (["Spell", "ObjectEffect", "Scroll"], ["Delivery"], "TargetType", "it is TargetType: Self, Touch, Aimed, TargetActor or TargetLocation"),
        (["Spell"], ["Cost", "MagickaCost"], "BaseCost", "it is BaseCost"),
        // Told only where a school is, e4b took MagicSkill out of its magic effect and kept it in the spell (eval round 23).
        (["Spell"], ["School", "MagicSkill", "Skill"], null, SpellSchool),
        (["Weapon"], ["Type", "WeaponType"], null, "a weapon's type is AnimationType, under Data — OneHandSword, TwoHandAxe, Bow…"),
        (["Npc"], ["Gender", "Sex", "Female"], null, "a female NPC has Female among the Flags under Configuration"),
        (["Npc", "NpcConfiguration", "PcLevelMult", "NpcLevel"], ["Level", "LevelMult", "CalcMinLevel", "CalcMaxLevel"], null, NpcLevel)
    ];

    /// <summary>Where a spell's school is: in its magic effects, not in the spell — a field to delete there.</summary>
    private const string SpellSchool = "delete it here, and keep the magic effect's: a spell's school is the MagicSkill of the magic effects its Effects name";

    /// <summary>Where the strength of a magic effect is written: in what names it, not in the effect.</summary>
    internal const string EffectStrength ="a magic effect has no strength of its own: Magnitude, Area and Duration go under Data, " +
        "in the Effects item of the spell or ObjectEffect that names it as BaseEffect";

    /// <summary>A field's name as YAML writes it, at a line's start or in flow style — not the 012EB7 of a FormID.</summary>
    private static readonly Regex KeyIn = new(@"(?<![\w.])([A-Za-z_]\w*)[ \t]*:(?=[ \t]|$)", RegexOptions.Multiline);

    /// <summary>
    /// A magic effect's Data, answered by what it holds. Found by name, a Data was a condition's: "move it in each
    /// item of Conditions" sent e4b away (eval round 24) — and again for a `Data: {}` holding nothing (round 51's
    /// spell+detailed #3). A strength — Magnitude, Area, Duration — or nothing goes in the Effects item of the spell;
    /// the magic effect's own fields, which xEdit shows under DATA (Flags, BaseCost…), at the margin, with the edit
    /// that puts them there.
    /// </summary>
    private static string? DataHint(Type type, string key, string text)
    {
        if (type.Name != "MagicEffect" || key != "Data" || BlockOf(text, key) is not { Length: > 0 } block) return null;
        var keys = KeyIn.Matches(Regex.Replace(block[(key.Length + 1)..], @"[ \t]#.*$", "", RegexOptions.Multiline))
            .Select(m => m.Groups[1].Value).Distinct().ToList();
        var strength = keys.Any(k => k is "Magnitude" or "Area" or "Duration");
        var own = keys.Where(k => k != "MutagenObjectType" && FieldsOf(type).Contains(k)).ToList();
        if (own.Count == 0) return EffectStrength;
        var theirs = $"{string.Join(", ", own)} {(own.Count == 1 ? "is" : "are")} the magic effect's own, at the margin";
        if (strength) return $"{EffectStrength}; {theirs}";
        var flow = Regex.Replace(block.Split('\n')[0][(key.Length + 1)..], "#.*$", "").Trim().Length > 0;
        return theirs + (flow ? ": write each there on a line of its own, and delete the `Data:` line"
            : ": delete the `Data:` line and take two spaces out in front of each line below it");
    }

    /// <summary>A top-level field's lines — its own, and those indented or listed below it; empty where the file has none.</summary>
    private static string BlockOf(string text, string key)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var at = Array.FindIndex(lines, line => line.StartsWith(key + ":", StringComparison.Ordinal));
        return at < 0 ? "" : string.Join('\n', lines.Skip(at).Take(1)
            .Concat(lines.Skip(at + 1).TakeWhile(line => line.Length == 0 || line[0] is ' ' or '\t' or '-')));
    }

    /// <summary>
    /// An NPC's level, whole, in the flow style the build reads. Told to move one of its fields at a time,
    /// a model moved CalcMinLevel into Level, Level to the top and LevelMult under Configuration, back and
    /// forth — nine builds for one NPC (eval round 12).
    /// </summary>
    // "Beside it" left a model nesting CalcMinLevel inside Level, or moving it to the top (eval probe 17): the
    // three lines, each indented as Configuration's Flags line is.
    public const string NpcLevel = "an NPC's level is three lines under Configuration, each indented as its Flags line is: " +
        "`Level: {MutagenObjectType: PcLevelMult, LevelMult: 1}`, `CalcMinLevel: 1`, `CalcMaxLevel: 25` — the level follows " +
        "the player's between those two; or, for a fixed level, the one line `Level: {MutagenObjectType: NpcLevel, Level: 10}`";

    /// <summary>The whole level, where a field of an NPC's level is written in the wrong place; else null.</summary>
    public static string? LevelHint(Type type, string key) =>
        type.Name is "Npc" or "NpcConfiguration" or "PcLevelMult" or "NpcLevel"
        && key is "Level" or "LevelMult" or "CalcMinLevel" or "CalcMaxLevel" ? NpcLevel : null;

    /// <summary>
    /// What an unknown field is likely meant to be: a field spelled otherwise (<c>name</c> → Name,
    /// <c>Effect</c> → Effects), another name for one (a weapon's <c>Enchantment</c> → ObjectEffect), or
    /// one that belongs inside another (a weapon's <c>Weight</c> → under BasicStats, a spell's
    /// <c>Magnitude</c> → under Data, in each item of Effects). With the value written on the field's
    /// line, a field of one value to rename is answered as the line to write: told "an enchantment is
    /// ObjectEffect", a model wrote <c>EnchantmentID</c> (eval round 11's probes).
    /// </summary>
    private static string? Hint(Type type, HashSet<string> known, string key, string? value = null, IReadOnlyList<string>? values = null,
        IReadOnlyList<string>? fields = null)
    {
        string Rename(string field, string otherwise) =>
            value is { Length: > 0 } && OneValue(type, field) ? $"write it as `{field}: {value}`" : otherwise;
        if (known.FirstOrDefault(k => k.Equals(key, StringComparison.OrdinalIgnoreCase)) is { } spelled) return Rename(spelled, $"it is spelled {spelled}");
        foreach (var (types, keys, field, hint) in Synonyms)
            if (types.Contains(type.Name) && keys.Contains(key, StringComparer.OrdinalIgnoreCase)) return field is null ? hint : Rename(field, hint);
        if (known.FirstOrDefault(k => k.Equals(key + "s", StringComparison.OrdinalIgnoreCase) || k.Equals(key + "es", StringComparison.OrdinalIgnoreCase)
                || key.EndsWith('s') && k.Equals(key[..^1], StringComparison.OrdinalIgnoreCase)) is { } number)
            return Rename(number, $"it is spelled {number}");
        // "Move", not "it goes": told Value and Weight go under BasicStats, a model added BasicStats and kept
        // them at the top level, build after build (eval probe 7 after round 11).
        if (Under(type, key, values, fields) is { } path) return $"move it {path}";
        // One letter off one field of the type: HalflCostPerk, told "delete it", was deleted, written back and deleted
        // again until the turns ran out (eval round 37's spell+detailed #3).
        return known.Where(k => OneEditApart(k, key)).ToList() is [var near] ? Rename(near, $"it is spelled {near}") : null;
    }

    /// <summary>Whether two names differ, case aside, by one letter added, left out, changed, or two swapped.</summary>
    private static bool OneEditApart(string a, string b)
    {
        (a, b) = (a.ToLowerInvariant(), b.ToLowerInvariant());
        if (a == b || Math.Abs(a.Length - b.Length) > 1) return false;
        var i = 0;
        while (i < a.Length && i < b.Length && a[i] == b[i]) i++;
        if (a.Length > b.Length) return a[(i + 1)..] == b[i..];
        if (b.Length > a.Length) return a[i..] == b[(i + 1)..];
        return a[(i + 1)..] == b[(i + 1)..]
            || i + 1 < a.Length && a[i] == b[i + 1] && a[i + 1] == b[i] && a[(i + 2)..] == b[(i + 2)..];
    }

    /// <summary>The kinds a part of several kinds can be: the concrete classes Mutagen makes for Skyrim.</summary>
    private static readonly Lazy<Type[]> Parts = new(() => typeof(Weapon).Assembly.GetTypes()
        .Where(t => t.IsClass && !t.IsAbstract && t.Namespace == typeof(Weapon).Namespace).ToArray());

    /// <summary>Whether a field is written as one value on its own line — a number, a name, a link — not as fields, a list or a text.</summary>
    private static bool OneValue(Type type, string field) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance).FirstOrDefault(p => p.Name == field) is { } property
        && (Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType) is var t
        && (t.IsPrimitive || t.IsEnum || t == typeof(string) || typeof(IFormLinkGetter).IsAssignableFrom(t));

    /// <summary>
    /// Where a field of the record's parts is, two levels deep at most, the nearest first, and at one
    /// depth a part before a list's items: "under BasicStats", "under Data, in each item of Effects". A
    /// magic effect's <c>Type</c> is its Archetype's, not a sound's. Only the parts Mutagen makes for
    /// Skyrim are followed — a link's FormKey, a text's Value are no field a record is written with. Of two parts at one
    /// depth with the field, the one whose field takes the <paramref name="values"/> written: a weapon's Flags are
    /// Data's and Critical's, and OnDeath is only Critical's — sent to Data, e4b ran out of turns (eval round 40's sword #2).
    /// A field written with <paramref name="fields"/> below it goes only where most of them are its: an enchantment written
    /// after the Iron Sword was told to move the sword's Data — AnimationType, Speed, Reach — into each item of Effects
    /// (eval round 58's sword+detailed #5).
    /// </summary>
    private static string? Under(Type type, string key, IReadOnlyList<string>? values = null, IReadOnlyList<string>? fields = null)
    {
        const BindingFlags Public = BindingFlags.Public | BindingFlags.Instance;
        var level = new List<(Type Part, string Path, bool Listed)> { (type, "", false) };
        for (var depth = 0; depth < 2 && level.Count > 0; depth++)
        {
            var next = new List<(Type Part, string Path, bool Listed)>();
            foreach (var (part, path, listed) in level)
                foreach (var property in part.GetProperties(Public))
                {
                    var inner = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                    var list = inner != typeof(string) && inner.IsGenericType && typeof(System.Collections.IList).IsAssignableFrom(inner);
                    if (list) inner = inner.GetGenericArguments()[0];
                    if (inner.Namespace != typeof(Weapon).Namespace || !inner.IsClass || typeof(IMajorRecordGetter).IsAssignableFrom(inner)) continue;
                    var at = (list ? $"in each item of {property.Name}" : $"under {property.Name}") + (path.Length > 0 ? $", {path}" : "");
                    next.Add((inner, at, listed || list));
                }
            // By name, not GetProperty: that throws where a class redeclares a property of its base. A part
            // of several kinds has the fields of each: Archetype's Type is MagicEffectArchetype's.
            var hits = next.Where(n => KindsOf(n.Part)
                .Any(kind => kind.GetProperties(Public).Any(p => p.Name.Equals(key, StringComparison.OrdinalIgnoreCase)))).ToList();
            if (fields is { Count: > 0 }) hits = hits.Where(h => Fits(h.Part, key, fields)).ToList();
            if (hits.Count > 1 && values is { Count: > 0 } && hits.Where(h => Takes(h.Part, key, values)).ToList() is [var fits]) return fits.Path;
            if (hits.Count > 0) return hits.OrderBy(h => h.Listed).First().Path;
            level = next;
        }
        return null;
    }

    /// <summary>A part's kinds: its own type, or the concrete ones of a part of several kinds.</summary>
    private static IEnumerable<Type> KindsOf(Type part) => part.IsAbstract ? Parts.Value.Where(part.IsAssignableFrom) : [part];

    /// <summary>Whether most of the fields written below a part's field are fields of what that field holds, of any of its kinds.</summary>
    private static bool Fits(Type part, string key, IReadOnlyList<string> fields)
    {
        const BindingFlags Public = BindingFlags.Public | BindingFlags.Instance;
        foreach (var kind in KindsOf(part))
        {
            if (kind.GetProperties(Public).FirstOrDefault(p => p.Name.Equals(key, StringComparison.OrdinalIgnoreCase)) is not { } property) continue;
            var held = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (held != typeof(string) && held.IsGenericType && typeof(System.Collections.IList).IsAssignableFrom(held)) held = held.GetGenericArguments()[0];
            var theirs = KindsOf(held).ToList();
            if (fields.Count(f => theirs.Any(t => t.GetProperties(Public).Any(p => p.Name == f))) * 2 > fields.Count) return true;
        }
        return false;
    }

    /// <summary>
    /// The fields written one level below a top-level field written with fields below it — AnimationType, Speed… of a
    /// weapon's Data; none for a field of one value, a list, or a flow.
    /// </summary>
    private static List<string> FieldsBelow(string text, string key)
    {
        var below = BlockOf(text, key).Split('\n').Skip(1).Where(line => line.Trim().Length > 0 && !line.TrimStart().StartsWith('#')).ToList();
        if (below.Count == 0 || below[0].TrimStart().StartsWith('-')) return [];
        var indent = below[0].Length - below[0].TrimStart().Length;
        return below.Where(line => line.Length - line.TrimStart().Length == indent)
            .Select(line => Regex.Match(line, @"^[ \t]+([A-Za-z_]\w*)[ \t]*:")).Where(m => m.Success).Select(m => m.Groups[1].Value).Distinct().ToList();
    }

    /// <summary>Whether a part's field of names takes each of the values: a flag or a kind its enum has.</summary>
    private static bool Takes(Type part, string key, IReadOnlyList<string> values)
    {
        if (part.GetProperties(BindingFlags.Public | BindingFlags.Instance).FirstOrDefault(p => p.Name == key) is not { } property) return false;
        var type = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
        if (type.IsGenericType && typeof(System.Collections.IEnumerable).IsAssignableFrom(type)) type = type.GetGenericArguments()[0];
        return type.IsEnum && values.All(v => Enum.GetNames(type).Contains(v, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>The values a top-level field is written with: its one value, a list in brackets, or the items listed below it.</summary>
    private static List<string> ValuesOf(string text, string key)
    {
        var block = BlockOf(text, key);
        if (block.Length == 0) return [];
        var first = Regex.Replace(block.Split('\n')[0][(key.Length + 1)..], @"[ \t]#.*$", "").Trim();
        if (first.Length > 0) return first.Trim('[', ']').Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToList();
        return block.Split('\n').Skip(1).Select(line => Regex.Match(line, @"^[ \t]*-[ \t]*([^\s#]+)")).Where(m => m.Success)
            .Select(m => m.Groups[1].Value).ToList();
    }

    /// <summary>Where a record type has a field: "at the top level", "under Data", or null for nowhere.</summary>
    public static string? WhereIn(Type record, string key) =>
        record.GetProperties(BindingFlags.Public | BindingFlags.Instance).Any(p => p.Name == key) ? "at the top level" : Under(record, key);

    /// <summary>
    /// What a field a type does not have is likely meant to be, as words to append to its name — " (it
    /// is spelled Name)" — or nothing.
    /// </summary>
    public static string HintFor(Type type, string key) =>
        Hint(type, FieldsOf(type), key) is { } hint ? $" ({hint})" : "";

    /// <summary>
    /// The part of the record a top-level field it lacks goes under, where the refusal names one place: an NPC's
    /// level, under Configuration; another, as "move it under BasicStats" says. Null for any other — a field to
    /// rename or delete, or one "in each item of Effects", which is not one place where a list holds several.
    /// </summary>
    internal static string? PartFor(Type type, string key, string text)
    {
        if (type.Name == "Npc" && key is "Level" or "CalcMinLevel" or "CalcMaxLevel") return "Configuration";
        var hint = HintIn(type, FieldsOf(type), key, text);
        return hint is not null && Regex.Match(hint, @"^move it under (?<part>\w+)$") is { Success: true } move ? move.Groups["part"].Value : null;
    }

    /// <summary>What a top-level field its type lacks is likely meant to be, as the file writes it — the value on its line, the fields below it — or null.</summary>
    private static string? HintIn(Type type, HashSet<string> known, string key, string text) =>
        DataHint(type, key, text) ?? Hint(type, known, key, ValueOf(text, key), ValuesOf(text, key), FieldsBelow(text, key));

    /// <summary>
    /// The unknown fields of a record file, named for a message: those with one hint together — "Damage,
    /// Weight (move them under BasicStats)" — and those without any last, set apart, so that "Type, Level
    /// (move it under Configuration)" does not send Type along (eval round 11's probes). Those the type has
    /// nowhere are to be deleted, and said so first: "has no field Description" alone was read as one
    /// missing, and a model wrote it back build after build (eval probe 9 after round 11).
    /// </summary>
    private static string Unknown(Type type, HashSet<string> known, IEnumerable<string> keys, string text)
    {
        var hinted = keys.Select(key => (Key: key, Hint: HintIn(type, known, key, text))).ToList();
        var named = hinted.Where(f => f.Hint is not null).GroupBy(f => f.Hint!).Select(group => group.Count() == 1
            ? $"{group.First().Key} ({group.Key}{Moved(text, group.Key, [group.First().Key])})"
            : $"{string.Join(", ", group.Select(f => f.Key))} ({Regex.Replace(group.Key, @"^(move it|it is)\b", m => m.Groups[1].Value == "move it" ? "move them" : "they are")}" +
                $"{Moved(text, group.Key, group.Select(f => f.Key).ToList())})");
        var bare = hinted.Where(f => f.Hint is null).Select(f => f.Key).ToList();
        var them = bare.Count == 1 ? "it" : "them";
        // A file of one other record type's fields alone: an enchantment written in MagicEffects/, told to delete its
        // EnchantType, Effects and EnchantmentAmount, deleted them, and ran out of turns (eval round 38's sword+detailed
        // #3). Every field of the file, not only those its type lacks: a spell with a magic effect's fields beside its
        // own Effects was sent to MagicEffects/ (round 39's spell+detailed #4).
        var fields = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).Where(k => k != "MutagenObjectType").Distinct().ToList();
        var owner = bare.Count == 0 ? [] : Groups.Where(g => g.Value is { IsAbstract: false } other && other != type && fields.All(FieldsOf(other).Contains))
            .DistinctBy(g => g.Value).ToList();
        var deleted = owner is [var (folder, of)]
            ? $"{(bare.Count == 1 ? "it is" : "they are")} {Article(of!.Name)}'s, which {Article(type.Name)} has nowhere: if this is " +
                $"{Article(of.Name)}, write it in {folder}/, and this file empty — the build leaves an empty record file out"
            : $"delete {them}: {Article(type.Name)} has {them} nowhere";
        return string.Join(", ", named.Append(bare.Count == 0 ? "" : $"{string.Join(", ", bare)} ({deleted})")
            .Where(s => s.Length > 0));
    }

    /// <summary>
    /// The edit a "move it under X" is, X a part of the record, as words after it: told to move an NPC's Health
    /// and Stamina under PlayerSkills, e4b and 12b indented them where they stood, under the field above them
    /// (eval round 22, probe 23). Empty for any other hint.
    /// </summary>
    private static string Moved(string text, string hint, IReadOnlyList<string> keys)
    {
        if (Regex.Match(hint, @"^move it under (?<part>\w+)$") is not { Success: true } move) return "";
        var part = move.Groups["part"].Value;
        var them = keys.Count > 1 ? "them" : "it";
        var at = Regex.Match(text, $@"^{Regex.Escape(part)}:[ \t]*\r?$", RegexOptions.Multiline);
        if (!at.Success) return $": delete {them} at the margin, and write `{part}:` with {them} below, two spaces in";
        // The part has it already, with another value (the same is taken out by the build): moved, it would be there
        // twice — e4b was told to move BasicStats' Value there, twice, and answered unbuilt (eval round 37).
        var block = BlockOf(text, part);
        var had = keys.Select(k => Regex.Match(block, $@"^[ \t]+{Regex.Escape(k)}[ \t]*:.*$", RegexOptions.Multiline))
            .Where(m => m.Success).Select(m => $"`{m.Value.Trim()}`").ToList();
        return had.Count > 0
            ? $": `{part}:` has {string.Join(" and ", had)} already — write the value meant there, and delete {them} at the margin"
            : $": delete {them} at the margin and write {them} again below `{part}:` (line {text[..at.Index].Count(c => c == '\n') + 1}), " +
                "as deep as its other fields";
    }

    /// <summary>
    /// The value written on a top-level field's own line — the FlameBladeEnch of <c>Enchantment: FlameBladeEnch</c> —
    /// or the EditorID written in its block, where it names a record as one (<c>Enchantment:</c> above
    /// <c>EditorID: FireEnchantment</c>, eval probe 7 after round 11); else null.
    /// </summary>
    private static string? ValueOf(string text, string key)
    {
        // A comment after the value too: readRecord writes a link's editor ID beside its FormID (`012EB7:Skyrim.esm  # IronSword`).
        if (Regex.Match(text, $@"^{Regex.Escape(key)}:[ \t]*([^\s#|>{{\[][^#\r\n]*?)[ \t]*(?:#.*?)?\r?$", RegexOptions.Multiline) is { Success: true } m)
            return m.Groups[1].Value;
        // Each line of the block matches one way only — its indent, a letter, the rest without the \r — or as a
        // blank line. Written `[ \t]+.*\r?\n`, a block of a dozen lines with no EditorID in it was tried every
        // way its indents and line ends could be split, and checkRecords hung past its 120 s (eval round 17).
        return Regex.Match(text, $@"^{Regex.Escape(key)}:[ \t]*\r?\n(?:[ \t]+\S[^\r\n]*\r?\n|[ \t]*\r?\n)*?[ \t]+EditorID:[ \t]*(\w+)[ \t]*\r?$", RegexOptions.Multiline)
            is { Success: true } block ? block.Groups[1].Value : null;
    }

    /// <summary>
    /// What a weapon or armor of the project lacks that every official one carries itself: a weapon its
    /// Data (3,823 of 3,823 in the 80 official plugins); one with a Template, or an armor with a
    /// TemplateArmor, the template's own lines (3,258 of 3,258 weapons, 2,679 of 2,679 armors) — the
    /// Creation Kit copies them in. 26b mirrored the enchanted EnchIronSwordFire01 by its Template, name,
    /// enchantment and damage alone, and built a sword without an animation (eval round 12). Checked with
    /// the links (RecordLinks), on a file that parses: first, it hid the refusal a file was written for.
    /// </summary>
    internal static string? Uncarried(Type type, string text, RecordIndex? index)
    {
        var (templateField, carried) = type.Name switch
        {
            "Weapon" => ("Template", new[] { "Data", "Keywords", "Model", "EquipmentType" }),
            "Armor" => ("TemplateArmor", new[] { "Armature", "Keywords", "BodyTemplate" }),
            _ => ((string?)null, Array.Empty<string>())
        };
        if (templateField is null) return null;
        var keys = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);
        var missing = carried.Where(field => !keys.Contains(field)).ToList();
        if (keys.Contains(templateField) && missing.Count > 0)
        {
            var written = ValueOf(text, templateField) ?? "its template";
            var template = FormKey.TryFactory(written, out var key) && index?.ByFormKey.TryGetValue(key, out var entry) == true
                && entry!.EditorId is { } id ? id : written;
            var lines = missing.Count == 1 ? missing[0] : $"{string.Join(", ", missing.Take(missing.Count - 1))} and {missing[^1]}";
            return $"{Article(type.Name)} with a {templateField} carries the template's lines itself, as every official one does — " +
                $"copy {lines} from {template} (readRecord {{\"record\": \"{template}\"}})";
        }
        if (type.Name == "Weapon" && !keys.Contains("Data"))
        {
            var example = index is not null ? ExampleOf(type, index) ?? "IronSword" : "IronSword";
            return $"a Weapon has its Data — AnimationType, Speed, Reach, Skill — as every official one does: copy it from {example} " +
                $"(readRecord {{\"record\": \"{example}\"}}) and change what differs";
        }
        return null;
    }

    /// <summary>A weapon's or armor's enchantment line that names a record, not Null.</summary>
    private static readonly Regex ObjectEffectLine = new(@"^ObjectEffect:[ \t]*(?!(?:Null|null|~)[ \t]*(?:#|\r?$))[^\s#]", RegexOptions.Multiline);
    private static readonly Regex ConstantCast = new(@"^CastType:[ \t]*ConstantEffect\b", RegexOptions.Multiline);

    /// <summary>
    /// A weapon or armor of the project that carries no enchantment; EditorId is its file's, Overrides the load order's
    /// record a copy changes.
    /// </summary>
    internal sealed record Carrier(string Relative, string Type, string Name, string? EditorId, string? Overrides);

    /// <summary>
    /// The project's new enchantments no other record names — by editor ID, or by the FormID a build wrote in, an
    /// override's too — each with the weapons and armors that carry none: the new ones, else the copies of the load
    /// order's; armors first for an enchantment cast ConstantEffect, weapons first for any other. e4b's Flame Blade
    /// carried its enchantment on a copy of IronSword (round 23).
    /// </summary>
    internal static List<(string Relative, string EditorId, List<Carrier> Carriers)> Unworn(
        IReadOnlyList<(string Relative, Type Type, string Text)> records, ModKey? own)
    {
        bool IsNew(string text) => Identity(text).FormKey is not { } key || key.ModKey == own;
        var bare = records.Where(r => (r.Type == typeof(Weapon) || r.Type == typeof(Armor)) && !ObjectEffectLine.IsMatch(r.Text)).ToList();
        var fresh = bare.Where(r => IsNew(r.Text)).ToList();
        var unworn = new List<(string, string, List<Carrier>)>();
        foreach (var (relative, type, text) in records)
        {
            if (type != typeof(ObjectEffect) || !IsNew(text) || Identity(text) is not { EditorId: { } enchantment }) continue;
            if (NamedElsewhere(records, relative, text)) continue;
            var armorFirst = ConstantCast.IsMatch(text);
            var carriers = (fresh.Count > 0 ? fresh : bare)
                .OrderBy(r => r.Type == typeof(Armor) == armorFirst ? 0 : 1)
                .Select(r =>
                {
                    var (key, id) = Identity(r.Text);
                    if (key is not { } copied || copied.ModKey == own) return new Carrier(r.Relative, r.Type.Name, id ?? r.Relative, id, null);
                    var name = id ?? Session.FormKeyText(copied);
                    return new Carrier(r.Relative, r.Type.Name, name, id, $"{name} of {copied.ModKey.FileName}");
                })
                .ToList();
            unworn.Add((relative, enchantment, carriers));
        }
        return unworn;
    }

    /// <summary>Whether another record of the project names this one — by editor ID, or by the FormID a build wrote in.</summary>
    internal static bool NamedElsewhere(IReadOnlyList<(string Relative, Type Type, string Text)> records, string relative, string text)
    {
        var (key, editorId) = Identity(text);
        var formId = key is { } numbered ? Session.FormKeyText(numbered) : null;
        return records.Any(f => f.Relative != relative && (editorId is not null && Regex.IsMatch(f.Text, $@"\b{Regex.Escape(editorId)}\b")
            || formId is not null && f.Text.Contains(formId, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// A new enchantment no record names while the project has a weapon or armor that carries none — the one meant
    /// to, most likely — refused with the lines to write there: built with a note saying so, e4b told the user the
    /// mod was done, twice (eval round 27). With no such weapon or armor it is a note (ProjectNotes): an enchantment
    /// for another mod.
    /// </summary>
    internal static string UnwornProblem(string relative, string enchantment, List<Carrier> carriers)
    {
        // None of the official plugins' 3,007 enchanted armors has an EnchantmentAmount; the skill's weapon has 500 (2026-10-21).
        string Lines(string type) => type == "Weapon" ? $"`ObjectEffect: {enchantment}` and `EnchantmentAmount: 500`" : $"`ObjectEffect: {enchantment}`";
        var shown = carriers.Take(4).ToList();
        var copies = shown[0].Overrides is not null;
        var kinds = shown.Select(c => c.Type).Distinct().ToList();
        var names = shown.Select(c => c.Name).ToList();
        var who = shown.Count == 1
            ? copies ? $"this copy of {shown[0].Overrides} carries" : $"{shown[0].Name} carries"
            : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}{(carriers.Count > shown.Count ? " and more" : "")} carry";
        var into = shown.Count == 1 ? copies ? "it" : shown[0].Name : "the one meant to carry it";
        var write = kinds.Count == 1 ? $"write {Lines(kinds[0])} in {into}" : $"write in {into} {Lines("Weapon")} for a weapon, {Lines("Armor")} for an armor";
        var kind = kinds.Count == 1 ? kinds[0].ToLowerInvariant() : "one";
        // Where: told only "at the margin", e4b wrote them in place of Data's last line, `Stagger: 0.75`, inside Data and
        // over the line (eval round 28). The EditorID line is at the margin and one of a kind, and the lines build there.
        var where = shown.Count == 1
            ? shown[0].EditorId is { } id ? $"on the lines right below `EditorID: {id}`, at the margin" : "at the margin"
            : "on the lines right below its `EditorID:` line, at the margin";
        return $"{string.Join(", ", shown.Select(c => c.Relative))}: {who} no enchantment, and no record of the project names the new " +
            $"{enchantment} ({relative}), so the enchantment does nothing — {write}, {where}" +
            (!copies ? ""
                : shown.Count == 1
                    ? $". The copy changes {shown[0].Name} itself, everywhere in the game: for a new {kind}, also delete its FormKey line and give it an EditorID of its own"
                    : $". Each copy changes its record itself, everywhere in the game: for a new {kind}, also delete the FormKey line of the one you write it in and give it an EditorID of its own");
    }

    /// <summary>A top-level field with no value on its line, and a field indented below it.</summary>
    private static readonly Regex BlockFields = new(@"^([A-Za-z_]\w*):[ \t]*(?:#.*)?\r?\n[ \t]+[A-Za-z_]\w*[ \t]*:", RegexOptions.Multiline);

    /// <summary>
    /// What a field of one value written with fields below it takes instead. The reader fails on the first
    /// of them with "Expected 'MappingEnd', got 'Scalar'", which sent a model through five builds with an
    /// enchantment written inside the weapon, under ObjectEffect (eval probe 10 after round 11).
    /// </summary>
    private static string Blocked(Type type, string key, string text)
    {
        var property = type.GetProperties(BindingFlags.Public | BindingFlags.Instance).First(p => p.Name == key);
        var named = ValueOf(text, key);
        var example = named is null ? "" : $": `{key}: {named}`";
        if (RecordLinks.LinkTarget(Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType) is not { } target)
            return $"{key} is written with fields below it — it takes one value on its own line{example}";
        var kind = RecordLinks.Kind(target);
        var folder = Groups.FirstOrDefault(g => g.Value?.Name == kind).Key;
        return $"{key} is written with fields below it — it takes one value on its own line, the editor ID or FormID of " +
            $"{Article(kind)}{example}" + (folder is null ? "" : $"; a new {kind} is a file of its own in {folder}/, named here by its EditorID");
    }

    /// <summary>The kind of a group's records a file names — GlobalFloat for a Global — or null; the same for any polymorphic field.</summary>
    public static Type? KindOf(Type group, string name) =>
        group.Assembly.GetTypes().FirstOrDefault(t => t.Name == name && !t.IsInterface && group.IsAssignableFrom(t));

    /// <summary>
    /// How many record files the plugin folder holds, what is wrong with any of them, and the files left
    /// out: in a folder that is no group, or one below a group's folder, whose record a group's folder holds
    /// too — by file name or editor ID — and a .yml file beside its .yaml twin. The reader skips such a folder; refused, the file trapped a model whose file tools could not
    /// delete it, after it had written the record again in the right folder (eval probe 10 after round 11).
    /// With the load order's index, a FormKey of another plugin is checked against the record it names.
    /// </summary>
    public static (int Records, List<string> Problems, List<(string File, string Copy)> LeftOut) Check(string pluginDir, RecordIndex? index = null)
    {
        var problems = new List<string>();
        var leftOut = new List<(string File, string Copy)>();
        var texts = new Lazy<List<(string Relative, string Text)>>(() => FlatRecords(pluginDir).Select(f => (f.Relative, File.ReadAllText(f.File))).ToList());
        var records = 0;
        if (!Directory.Exists(pluginDir)) return (0, problems, leftOut);
        var own = OwnPlugin(pluginDir);
        var formKeys = new Dictionary<FormKey, List<string>>();
        var editorIds = new Dictionary<string, List<(string Relative, FormKey? Key)>>(StringComparer.OrdinalIgnoreCase);
        var grouped = new Lazy<List<(string Relative, string Name, string? EditorId)>>(() => FlatRecords(pluginDir)
            .Select(f => (f.Relative, Path.GetFileName(f.File), Identity(File.ReadAllText(f.File)).EditorId)).ToList());
        foreach (var file in Directory.EnumerateFiles(pluginDir, "*.*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(pluginDir, file).Replace('\\', '/');
            if (relative == "RecordData.yaml") continue;
            if (file.EndsWith(".yml", StringComparison.OrdinalIgnoreCase))
            {
                // Written again as .yaml, as the refusal said: left out — refused, the .yml file failed every build
                // of a model whose file tools could not delete it, until it made a second project (eval round 15).
                var twin = Path.ChangeExtension(file, ".yaml");
                if (File.Exists(twin))
                    leftOut.Add((relative, Path.GetRelativePath(pluginDir, twin).Replace('\\', '/')));
                else
                    problems.Add($"{relative} ends in .yml, which the build does not read: name it .yaml");
                continue;
            }
            // Any other ending in a group's folder too: an enchantment saved as FlameBladeBurn.nhs went unread,
            // and the link to it was refused as naming no record (eval probe 16).
            if (!file.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase))
            {
                var folder = relative.Split('/')[0];
                if (relative.Contains('/') && Groups.ContainsKey(folder))
                    problems.Add($"{relative} ends in {Path.GetExtension(file)}, which the build does not read: write it as " +
                        $"{Path.ChangeExtension(relative, ".yaml")}");
                continue;
            }
            // An empty record file holds no record, and is left out: the way to drop a record without deleting
            // its file — a broken one no longer needed trapped a model whose file tools could not delete (probe 16).
            if (Empty(File.ReadAllText(file)))
            {
                leftOut.Add((relative, ""));
                continue;
            }
            records++;

            var parts = relative.Split('/');
            if (parts.Length == 1)
            {
                problems.Add($"{relative} is in no group folder: put it into its type's, e.g. Weapons/{relative}");
                continue;
            }
            if (!Groups.TryGetValue(parts[0], out var type))
            {
                var editorId = parts.Length == 2 ? Identity(File.ReadAllText(file)).EditorId : null;
                if (parts.Length == 2 && grouped.Value.FirstOrDefault(g => g.Name.Equals(parts[1], StringComparison.OrdinalIgnoreCase)
                        || editorId is not null && editorId.Equals(g.EditorId, StringComparison.OrdinalIgnoreCase)) is { Relative: { } copy })
                {
                    leftOut.Add((relative, copy));
                    records--;
                    continue;
                }
                var spelled = Groups.Keys.FirstOrDefault(g => g.Equals(parts[0], StringComparison.OrdinalIgnoreCase));
                problems.Add(spelled is not null ? $"{relative}: the folder is spelled {spelled}, not {parts[0]}"
                    : GroupCalled(parts[0]) is { } group
                        ? $"{relative}: '{parts[0]}' is no group folder — the folder for them is {group}: write the file as {group}/{parts[^1]}"
                        : $"{relative}: '{parts[0]}' is no group folder — use the one readRecord's pathInPluginFolder names for the type, such as {CommonGroups}");
                continue;
            }

            // Below a group of single records the reader takes nothing for a record, but the file still
            // got a FormID, and the build succeeded empty (eval round 10: Spells/Spells/…).
            if (parts.Length > 2 && !Nested.Contains(parts[0]))
            {
                var into = Groups.ContainsKey(parts[1]) ? string.Join('/', parts[1..]) : $"{parts[0]}/{parts[^1]}";
                // Written again where the refusal said, its record is in the group's folder: left out, like a file
                // in a folder that is no group — refused, the first copy failed every build of a model whose file
                // tools could not delete it (ObjectEffects/Enchantments/, eval round 15's probes).
                var nestedId = Identity(File.ReadAllText(file)).EditorId;
                if (grouped.Value.FirstOrDefault(g => g.Relative.Equals(into, StringComparison.OrdinalIgnoreCase)
                        || nestedId is not null && nestedId.Equals(g.EditorId, StringComparison.OrdinalIgnoreCase)) is { Relative: { } copy })
                {
                    leftOut.Add((relative, copy));
                    records--;
                    continue;
                }
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
            if (Identity(text) is { EditorId: { } recordId } identity)
                (editorIds.TryGetValue(recordId, out var sharing) ? sharing : editorIds[recordId] = []).Add((relative, identity.FormKey));
            // The reader takes a record's first line for its FormKey — after the kind, where a group has
            // several (eval round 11: EditorID written above it).
            if (line.Success && TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).FirstOrDefault(k => k != "MutagenObjectType") is { } first
                && first != "FormKey")
                problems.Add($"{relative}: FormKey is the first line of a record file — move it above {first}");
            if (index is not null && Foreign(relative, text, own, index) is { } foreign) problems.Add(foreign);

            // A group of several kinds — Globals: GlobalFloat, GlobalShort… — names the kind in the file.
            var kind = KindIn(type, text);
            var known = FieldsOf(kind ?? type);
            // A field written twice breaks the reader a check later: told only of the fields the type lacks, e4b moved
            // those, was then told of DefaultOutfit written twice, and wrote the file anew each time, ten builds (eval probe 23).
            if (Twice(text, known) is { } twice) problems.Add($"{relative}: {twice}");
            foreach (var key in BlockFields.Matches(text).Select(m => m.Groups[1].Value).Where(known.Contains).Distinct())
                if (OneValue(kind ?? type, key)) problems.Add($"{relative}: {Blocked(kind ?? type, key, text)}");
            var unknown = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).Where(key => !known.Contains(key)).Distinct().ToList();
            if (unknown.Count == 0) continue;
            // The family's skill first: its tables have the lines of each kind — told only to read Firebolt, a
            // model built its shock spell on Firebolt's fire effect (eval probe 15).
            var skill = SkillOf((kind ?? type).Name) is { } family ? $"the {family} skill's tables, readSkill {{\"skill\": \"{family}\"}}, or " : "";
            var read = index is not null && ExampleOf(kind ?? type, index) is { } example
                ? $" — read {skill}a vanilla one, readRecord {{\"record\": \"{example}\"}}, and write yours with its field names and nesting"
                : "";
            problems.Add($"{relative}: {Droppable(kind ?? type, relative, text, texts.Value)}" +
                $"{Article(type.Name)} has no field {Unknown(kind ?? type, known, unknown, text)}{read}");
        }
        // Two files of one record: the reader names the FormKey but neither file (eval round 11: 000000 in each new record).
        foreach (var (formKey, holders) in formKeys.Where(pair => pair.Value.Count > 1))
            problems.Add($"{string.Join(" and ", holders)} have the same FormKey {Session.FormKeyText(formKey)} — one file per record; " +
                "a new record has no FormKey line, the build assigns one");
        // One editor ID, two records: told of a warning in a file the build had just numbered and renamed, e4b wrote
        // the file again under its old name, and Hilda was built twice, a man and a woman (eval probe 23).
        // A numbered file written whole again lost the FormKey line the build gave it, but keeps the name the build gave it:
        // told to empty the other, e4b rewrote the numbered one without the line, and was then told only to pick (eval round 28).
        // A build no longer renames a file (eval round 30); a pull, and builds before that, name it the way Spriggit does.
        bool Numbered((string Relative, FormKey? Key) file) => file.Key is { } key ? key.ModKey == own
            : own is { } plugin && Regex.IsMatch(Path.GetFileName(file.Relative), $@" - [0-9A-Fa-f]{{6}}_{Regex.Escape(plugin.FileName)}\.yaml$", RegexOptions.IgnoreCase);
        foreach (var (editorId, files) in editorIds.Where(pair => pair.Value.Count > 1 && pair.Value.Any(f => f.Key is not { } key || key.ModKey == own)))
        {
            var numbered = files.Where(Numbered).ToList();
            var fresh = files.Where(f => f.Key is null && !Numbered(f)).ToList();
            problems.Add($"{string.Join(" and ", files.Select(f => f.Relative))} have the same EditorID {editorId} — " +
                (numbered.Count == 1 && fresh.Count == files.Count - 1
                    ? $"one record written twice: a build numbered it in {numbered[0].Relative}. Make the changes " +
                        $"there, and write {string.Join(" and ", fresh.Select(f => f.Relative))} empty — the build leaves an empty record file out"
                    : "an editor ID names one record: give each new one an EditorID of its own, or write the file of one not needed " +
                        "empty — the build leaves an empty record file out"));
        }
        return (records, problems, leftOut);
    }

    /// <summary>
    /// A top-level field of the record written twice, which the reader refuses as a duplicate key — said with both
    /// lines, as the YAML check says one — or null. Only the type's own fields: a line of a text written at the
    /// margin is the YAML check's to name, as the text it fell out of.
    /// </summary>
    private static string? Twice(string text, HashSet<string> known)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < lines.Length; i++)
        {
            if (TopLevelKey.Match(lines[i]) is not { Success: true } key || !known.Contains(key.Groups[1].Value)) continue;
            var name = key.Groups[1].Value;
            if (seen.TryAdd(name, i)) continue;
            var (first, second) = (lines[seen[name]].Trim(), lines[i].Trim());
            return $"{name} is written twice, on lines {seen[name] + 1} and {i + 1}, and a field is written once — " +
                (first.EndsWith(':') ? $"keep one `{name}:` with the lines below it, and delete the other with its lines"
                    : first == second ? "delete one of the two lines, they are the same"
                    : $"keep the one meant, `{first}` or `{second}`, and delete the other");
        }
        return null;
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

    /// <summary>
    /// For a new record of the project that no other record names, how to drop it without deleting its
    /// file — written empty, it is left out — as words before what is wrong with it; else nothing. A model
    /// wrote a magic effect of its own, then named a vanilla one in its spell, and the broken file it no
    /// longer needed failed every build (probe 16). Said after the fields, e4b went back to the file it had
    /// fixed instead (eval round 24).
    /// </summary>
    internal static string Droppable(Type type, string relative, string text, IEnumerable<(string Relative, string Text)> others)
    {
        // Only a part another record names — an effect, an enchantment, an addon — and beside other records:
        // offered on an NPC that was the whole mod, emptying it would have left nothing to build.
        if (type.Name is not ("MagicEffect" or "ObjectEffect" or "ArmorAddon")) return "";
        var rest = others.Where(o => o.Relative != relative).ToList();
        return rest.Count > 0 && Identity(text) is { FormKey: null, EditorId: { } id }
            && !rest.Any(o => Regex.IsMatch(o.Text, $@"\b{Regex.Escape(id)}\b"))
            ? $"no other record names {id}: if it is not needed, write its file empty — the build leaves an empty record file out. If it is needed: "
            : "";
    }

    /// <summary>
    /// Takes out of a new record's file the FormKey line copied from the record it was written after — another
    /// plugin's record of another editor ID — or one that names nothing: no record of the load order, 000000, no
    /// FormKey at all. Answers each file and what was taken out. A new record has no FormKey line, and the refusal
    /// offered only that way (eval round 11's probes); refused, it was the refusal runs met most — 51 of 312 in eval
    /// rounds 24–31, seven failed after it. addPatch's copy given another editor ID too: refused as an override
    /// renamed, it was met in three runs of eval rounds 32–33 and ended sword #4 of round 33 on an empty turn — a
    /// copy is renamed for a new record. One of addPatch's copies that names no record is left to Foreign. And the
    /// plugin's own FormKey past a light plugin's last, 000FFF: Mutagen refused it as "out of bounds for the given
    /// record compaction settings", naming no file, and npc+detailed #4 of eval round 34 gave up after three builds.
    /// A link to it in another file of the project names its editor ID instead, which the build resolves.
    /// </summary>
    public static List<(string File, string Change)> DropCopiedFormKeys(string pluginDir, RecordIndex index)
    {
        var changes = new List<(string File, string Change)>();
        var own = OwnPlugin(pluginDir);
        var light = LightPlugin(pluginDir);
        foreach (var (file, relative, _) in FlatRecords(pluginDir))
        {
            var text = File.ReadAllText(file);
            if (Empty(text) || FormKeyLine.Match(text) is not { Success: true } line) continue;
            var written = line.Groups[1].Value;
            bool Copied(FormKey key) => Path.GetFileName(file).EndsWith($"{key.ID:X6}_{key.ModKey.FileName}.yaml", StringComparison.OrdinalIgnoreCase);
            string why;
            var relinked = new List<(string File, string Change)>();
            if (!FormKey.TryFactory(written, out var key)) why = $"'{written}' is no FormKey";
            else if (key.ID == 0) why = $"{Session.FormKeyText(key)} is no record's FormID";
            else if (key.ModKey == own)
            {
                if (!light || key.ID <= LightMax) continue;
                why = $"{Session.FormKeyText(key)} is past the last FormID a light plugin has, 000FFF";
                if (Identity(text).EditorId is { } named) relinked = Relink(pluginDir, file, key, named);
            }
            else if (!index.ByFormKey.TryGetValue(key, out var entry))
            {
                if (Copied(key)) continue;
                why = $"{Session.FormKeyText(key)} names no record in the load order";
            }
            else if (Identity(text).EditorId is { } editorId && entry.EditorId is { } theirs && !editorId.Equals(theirs, StringComparison.OrdinalIgnoreCase))
                why = Copied(key)
                    ? $"{Session.FormKeyText(key)} is {theirs} of {key.ModKey.FileName}, and addPatch's copy of it was given the EditorID " +
                        $"{editorId}, which makes it a new record and leaves {theirs} as it is"
                    : $"{Session.FormKeyText(key)} is {theirs} of {key.ModKey.FileName}, and this file makes {editorId}";
            else continue;
            // The line with its line break: the lines below it move up one.
            var end = line.Index + line.Length;
            if (end < text.Length && text[end] == '\n') end++;
            File.WriteAllText(file, text[..line.Index] + text[end..]);
            changes.Add((relative, $"removed `{line.Value.TrimEnd('\r')}` — {why}; a new record has no FormKey line, and the build numbers it"));
            changes.AddRange(relinked);
        }
        return changes;
    }

    /// <summary>
    /// Writes the editor ID in place of a FormKey in the links of the plugin folder's other record files, the FormKey
    /// lines left as they are; answers each file changed.
    /// </summary>
    private static List<(string File, string Change)> Relink(string pluginDir, string record, FormKey key, string editorId)
    {
        var changes = new List<(string File, string Change)>();
        var link = new Regex($@"(?<![0-9A-Fa-f]){Regex.Escape(Session.FormKeyText(key))}(?![\w.])", RegexOptions.IgnoreCase);
        foreach (var (file, relative, _) in FlatRecords(pluginDir))
        {
            if (file == record) continue;
            var text = File.ReadAllText(file);
            var lines = text.Split('\n');
            var count = 0;
            for (var i = 0; i < lines.Length; i++)
            {
                if (lines[i].StartsWith("FormKey:", StringComparison.Ordinal)) continue;
                var changed = link.Replace(lines[i], editorId);
                if (changed != lines[i]) { lines[i] = changed; count++; }
            }
            if (count == 0) continue;
            File.WriteAllText(file, string.Join('\n', lines));
            changes.Add((relative, $"{(count == 1 ? "the link" : $"{count} links")} to {Session.FormKeyText(key)} now name{(count == 1 ? "s" : "")} " +
                $"{editorId}, the record whose FormKey line was taken out"));
        }
        return changes;
    }

    /// <summary>
    /// Takes out a top-level line written again the same, which the reader refuses as a field written twice: the line
    /// above says it already. e4b's note+detailed #5 (eval round 36) wrote VersionControl's line over the FormKey line
    /// above it, was refused, and ran out of turns; five runs of rounds 23–33 were refused one and built again. Two
    /// values, or a field with lines below it, are left to the refusal (Twice).
    /// </summary>
    public static List<(string File, string Change)> DropRepeatedLines(string pluginDir)
    {
        var changes = new List<(string File, string Change)>();
        foreach (var (file, relative, type) in FlatRecords(pluginDir))
        {
            var lines = File.ReadAllText(file).Split('\n').ToList();
            var known = FieldsOf(type);
            var seen = new Dictionary<string, (int Line, string Text)>(StringComparer.Ordinal);
            var dropped = 0;
            for (var i = 0; i < lines.Count; i++)
            {
                if (TopLevelKey.Match(lines[i]) is not { Success: true } key || !known.Contains(key.Groups[1].Value)) continue;
                var (name, line) = (key.Groups[1].Value, lines[i].Trim());
                // Numbered as the file was written: the model knows it so.
                if (seen.TryAdd(name, (i + dropped + 1, line)) || line.EndsWith(':') || seen[name].Text != line) continue;
                changes.Add((relative, $"removed line {i + dropped + 1}, `{line}` — line {seen[name].Line} says the same, and a record has each field once"));
                lines.RemoveAt(i--);
                dropped++;
            }
            if (dropped > 0) File.WriteAllText(file, string.Join('\n', lines));
        }
        return changes;
    }

    /// <summary>
    /// Deletes from a record file the fields of another record type, which its own type has nowhere, left in where the
    /// file was written after a record of that type: Flame Blade Burn, written after the Iron Sword, kept the sword's Model,
    /// BasicStats, Critical and thirteen more beside its own Effects; told to delete them, e4b planned the edit, its turn
    /// came back with no call, and the run failed (eval round 58's sword+detailed #5) — 9 of the 18 such refusals of
    /// rounds 40–58 were of a file so written, and two of those runs failed. Only fields the type has no other place for, two
    /// or more, all of one other record type, in a file with fields of its own type that one lacks: a file of the other
    /// type's fields alone is left to the refusal, which names that type's folder.
    /// </summary>
    public static List<(string File, string Change)> DropOtherTypesFields(string pluginDir)
    {
        var changes = new List<(string File, string Change)>();
        foreach (var (file, relative, type) in FlatRecords(pluginDir))
        {
            var written = File.ReadAllText(file);
            var text = written.Replace("\r\n", "\n");
            var known = FieldsOf(type);
            var fields = TopLevelKey.Matches(text).Select(m => m.Groups[1].Value).Where(k => k != "MutagenObjectType").Distinct().ToList();
            // A spell's school is a field it has nowhere too, said as one to delete.
            var nowhere = fields.Where(k => !known.Contains(k) && HintIn(type, known, k, text) is null or SpellSchool).ToList();
            if (nowhere.Count < 2) continue;
            var own = fields.Where(known.Contains).ToList();
            var source = Groups.Values.OfType<Type>().Where(other => !other.IsAbstract && other != type).Distinct()
                .Where(other => nowhere.All(k => WhereIn(other, k) is not null) && own.Any(k => !FieldsOf(other).Contains(k)))
                .OrderByDescending(other => nowhere.Count(FieldsOf(other).Contains)).FirstOrDefault();
            if (source is null) continue;
            // Each field's block: its line, and the lines below it that are indented, listed or blank.
            var kept = new List<string>();
            var dropping = false;
            foreach (var line in text.Split('\n'))
            {
                if (line.Length > 0 && line[0] is not (' ' or '\t' or '-' or '#'))
                    dropping = TopLevelKey.Match(line) is { Success: true } key && nowhere.Contains(key.Groups[1].Value);
                if (!dropping) kept.Add(line);
            }
            var left = string.Join('\n', kept);
            File.WriteAllText(file, written.Contains("\r\n") ? left.Replace("\n", "\r\n") : left);
            changes.Add((relative, $"deleted {string.Join(", ", nowhere.Select(k => $"`{k}`"))} — {Article(source.Name)}'s fields, which " +
                $"{Article(type.Name)} has nowhere"));
        }
        return changes;
    }

    /// <summary>
    /// The value of a record's EditorID line as written, its quotes taken off — `Maven's Warning` too, which is no
    /// editor ID — or null where the record has no such line, or none with a value.
    /// </summary>
    internal static string? EditorIdWritten(string text)
    {
        if (WrittenEditorIdLine.Match(text) is not { Success: true } line || line.Groups["value"].Value is not { Length: > 0 } written) return null;
        return written.Length >= 2 && written[0] == '\'' && written[^1] == '\'' ? written[1..^1].Replace("''", "'")
            : written.Length >= 2 && written[0] == '"' && written[^1] == '"' ? written[1..^1]
            : written;
    }

    /// <summary>
    /// An EditorID written with characters no editor ID has — `Maven's Warning`, `MavenNote:MavenWarning` — written with
    /// its letters, digits and underscores alone, where no other record has that name. Read as none, `Maven's Warning`
    /// was answered "has no EditorID" three builds long, and the copied FormKey beside it kept the note an override of
    /// Maven's (eval round 39's note #5); 7 runs of rounds 23–39 wrote one. A name taken is left to the note.
    /// </summary>
    public static List<(string File, string Change)> CleanEditorIds(string pluginDir, RecordIndex index)
    {
        var changes = new List<(string File, string Change)>();
        var own = OwnPlugin(pluginDir);
        var files = FlatRecords(pluginDir).Select(f => (f.File, f.Relative, Text: File.ReadAllText(f.File))).ToList();
        var taken = files.Select(f => Identity(f.Text).EditorId).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var (file, relative, text) in files)
        {
            if (EditorIdWritten(text) is not { } written || EditorIdName.IsMatch(written)) continue;
            var name = Regex.Replace(written, "[^A-Za-z0-9_]", "");
            if (!EditorIdName.IsMatch(name) || taken.Contains(name)
                || index.ByEditorId.TryGetValue(name, out var holder) && holder.ModKey != own) continue;
            var line = WrittenEditorIdLine.Match(text);
            File.WriteAllText(file, text[..line.Index] + $"EditorID: {name}" + text[(line.Index + line.Length)..]);
            taken.Add(name);
            changes.Add((relative, $"wrote `EditorID: {name}` for `{written}` — an editor ID is letters, digits and underscores alone, " +
                "by which links and tools like SPID name the record"));
        }
        return changes;
    }

    /// <summary>
    /// Takes the project's own FormKey out of the files that share it, where no build gave it to one of them: e4b wrote
    /// 000800 into a new sword and its enchantment both (eval round 39's sword+detailed #5), and 4 of the 8 runs of
    /// rounds 23–39 refused two files of one FormKey failed. Where the last built plugin has the record, the file of
    /// its editor ID keeps it; where none of them is that record, or that plugin cannot be read, the refusal stays.
    /// </summary>
    public static List<(string File, string Change)> DropSharedFormKeys(string pluginDir, SkyrimRelease release)
    {
        var changes = new List<(string File, string Change)>();
        if (OwnPlugin(pluginDir) is not { } own) return changes;
        var shared = FlatRecords(pluginDir).Select(f => (f.File, f.Relative, Text: File.ReadAllText(f.File)))
            .Where(f => Identity(f.Text).FormKey is { } key && key.ModKey == own)
            .GroupBy(f => Identity(f.Text).FormKey!.Value).Where(g => g.Count() > 1).ToList();
        if (shared.Count == 0) return changes;
        var built = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(pluginDir))!, "build", own.FileName);
        Dictionary<FormKey, string?> given;
        try
        {
            using var plugin = File.Exists(built) ? SkyrimMod.Create(release).FromPath(new ModPath(own, built)).Construct() : null;
            given = plugin?.EnumerateMajorRecords().ToDictionary(r => r.FormKey, r => r.EditorID) ?? [];
        }
        catch (Exception)
        {
            return changes;
        }
        foreach (var group in shared)
        {
            string? keeper = null;
            if (given.TryGetValue(group.Key, out var builtId))
            {
                keeper = group.FirstOrDefault(f => string.Equals(Identity(f.Text).EditorId, builtId, StringComparison.OrdinalIgnoreCase)).Relative;
                if (keeper is null) continue;
            }
            foreach (var (file, relative, text) in group.Where(f => f.Relative != keeper))
            {
                var line = FormKeyLine.Match(text);
                var end = line.Index + line.Length;
                if (end < text.Length && text[end] == '\n') end++;
                File.WriteAllText(file, text[..line.Index] + text[end..]);
                var others = group.Where(f => f.Relative != relative).Select(f => f.Relative).ToList();
                changes.Add((relative, $"removed `{line.Value.TrimEnd('\r')}` — " + (keeper is not null
                    ? $"a build gave it to {keeper}'s record"
                    : $"{string.Join(" and ", others)} {(others.Count == 1 ? "has" : "have")} it too, and no build gave it to " +
                        (others.Count == 1 ? "either" : "any of them")) +
                    "; a new record has no FormKey line, and the build numbers it"));
            }
        }
        return changes;
    }

    /// <summary>
    /// Gives the project's own record written with no EditorID its file's name, where that is an editor ID no other
    /// record has: the author's own name for it. With none, no link of the project and no tool like SPID can name the
    /// record, and the build's notes call it "a Spell" — e4b wrote 13 spells so in eval rounds 25–36. A file name that
    /// is no editor ID, one the load order or the project has, or one two such files share, is left to a note (ProjectNotes).
    /// </summary>
    public static List<(string File, string Change)> NameFromFiles(string pluginDir, RecordIndex index)
    {
        var changes = new List<(string File, string Change)>();
        var own = OwnPlugin(pluginDir);
        var files = FlatRecords(pluginDir).Select(f => (f.File, f.Relative, Text: File.ReadAllText(f.File))).Where(f => !Empty(f.Text)).ToList();
        var taken = files.Select(f => Identity(f.Text).EditorId).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unnamed = files
            .Where(f => !AnyEditorIdLine.IsMatch(f.Text) && (Identity(f.Text).FormKey is not { } key || key.ModKey == own))
            .Select(f => (f.File, f.Relative, f.Text, Name: Path.GetFileNameWithoutExtension(f.File)))
            .Where(f => EditorIdName.IsMatch(f.Name)).ToList();
        foreach (var (file, relative, text, name) in unnamed)
        {
            // The load order's own name would take the links meant for its record: the project's resolve first.
            if (unnamed.Count(u => u.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) > 1 || taken.Contains(name)
                || index.ByEditorId.TryGetValue(name, out var holder) && holder.ModKey != own) continue;
            var lines = text.Split('\n').ToList();
            lines.Insert(lines.TakeWhile(line => HeadLine.IsMatch(line)).Count(), $"EditorID: {name}{(text.Contains("\r\n") ? "\r" : "")}");
            File.WriteAllText(file, string.Join('\n', lines));
            changes.Add((relative, $"wrote `EditorID: {name}`, the file's name — a record has an editor ID of its own, by which " +
                "links and tools like SPID name it"));
        }
        return changes;
    }

    /// <summary>
    /// Gives a new record — no FormKey line — written with the editor ID of a record of the load order an editor ID of its
    /// own, from its in-game name: every link by the one it had would name it, and the game would have two records of one
    /// editor ID. Refused, e4b half-did the build's own advice for addPatch's renamed copy — took out its FormKey line,
    /// kept its EditorID — then named it so and wrote a second file of that name, and answered unbuilt (eval round 54's
    /// note+detailed #3); in rounds 31 and 51 a magic effect so written took its spell's link from Skyrim.esm's. A link
    /// by the old editor ID names the load order's record again.
    /// </summary>
    public static List<(string File, string Change)> RenameTakenEditorIds(string pluginDir, RecordIndex index)
    {
        var changes = new List<(string File, string Change)>();
        var own = OwnPlugin(pluginDir);
        var files = FlatRecords(pluginDir).Select(f => (f.File, f.Relative, Text: File.ReadAllText(f.File))).Where(f => !Empty(f.Text)).ToList();
        var taken = files.Select(f => Identity(f.Text).EditorId).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool Free(string name) => !taken.Contains(name) && !index.ByEditorId.ContainsKey(name);
        foreach (var (file, relative, text) in files)
        {
            if (Identity(text) is not { FormKey: null, EditorId: { } editorId } || !index.ByEditorId.TryGetValue(editorId, out var key)
                || key.ModKey == own || !index.ByFormKey.TryGetValue(key, out var entry) || EditorIdLine.Match(text) is not { Success: true } line)
                continue;
            // The in-game name's words, each capitalized — Maven's Warning is MavensWarning — or the old name and the plugin's.
            var named = ProjectNotes.NameIn(text) is { } words
                ? string.Concat(Regex.Split(Regex.Replace(words, "['’]", ""), "[^A-Za-z0-9]+").Where(w => w.Length > 0).Select(w => char.ToUpperInvariant(w[0]) + w[1..]))
                : "";
            var stem = named.Length > 0 && char.IsLetter(named[0]) ? named : editorId + (own is { } plugin ? Regex.Replace(plugin.Name, "[^A-Za-z0-9]", "") : "New");
            var name = Enumerable.Range(1, 99).Select(n => n == 1 ? stem : $"{stem}{n}").First(Free);
            taken.Add(name);
            var value = line.Groups[1];
            File.WriteAllText(file, text[..value.Index] + name + text[(value.Index + value.Length)..]);
            changes.Add((relative, $"wrote `EditorID: {name}` for `EditorID: {editorId}` — {editorId} is {key.ModKey.FileName}'s " +
                $"{entry.Type} ({Session.FormKeyText(key)}), and this file, with no FormKey line, is a new record of its own; a link by " +
                $"{editorId} names {key.ModKey.FileName}'s. To change that one instead, copy it in with addPatch and write this file empty"));
        }
        return changes;
    }

    /// <summary>Throws what is wrong with the files, as the request's fault; answers how many there are, and those left out.</summary>
    public static (int Records, List<(string File, string Copy)> LeftOut) Require(string pluginDir, RecordIndex? index = null)
    {
        var (records, problems, leftOut) = Check(pluginDir, index);
        if (problems.Count > 0)
        {
            throw new HelperException("badRecord",
                $"{problems.Count} record file(s) cannot be built as written: {string.Join("; ", problems.Take(12))}" +
                (problems.Count > 12 ? "; …" : "") +
                ". Write each record the way readRecord shows a record of its type — the same field names, nesting and " +
                "folder — changing only the values.");
        }
        return (records, leftOut);
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
        else if (path.Length > 0 && File.Exists(path) && message.Contains("hex string") && Groups.GetValueOrDefault(where.Split('/')[0]) is { } type)
            quoted = BytesWritten(File.ReadAllLines(path), type);
        return new HelperException("badRecord",
            $"{where} cannot be read as a record: {message}{quoted} Write it the way readRecord shows a record of its " +
            "type — the same field names, nesting and value formats.");
    }

    /// <summary>
    /// The lines that write a field of bytes otherwise than as hex — `Unused2: 0` for the Iron Sword's Critical `Unused2:
    /// 0x000000` — for the reader's "not a valid hex string", which names no line: e4b's sword was so refused three builds
    /// running (eval round 43's sword #3), and round 58's sword+detailed #5 wrote Critical's Unused2 so. Empty where none is.
    /// </summary>
    private static string BytesWritten(string[] lines, Type type)
    {
        // Each line's field found in the part its indent puts it in: Critical's Unused is a number, Data's three bytes.
        var parts = new List<(int Column, Type Part)>();
        var wrong = new List<string>();
        for (var i = 0; i < lines.Length; i++)
        {
            if (Regex.Match(lines[i], @"^(?<lead>[ \t]*(?:-[ \t]+)?)(?<key>[A-Za-z_]\w*)[ \t]*:[ \t]*(?<value>[^\s#]*)") is not { Success: true } field) continue;
            var column = field.Groups["lead"].Length;
            while (parts.Count > 0 && parts[^1].Column >= column) parts.RemoveAt(parts.Count - 1);
            var key = field.Groups["key"].Value;
            if (KindsOf(parts.Count > 0 ? parts[^1].Part : type).Select(kind => kind.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .FirstOrDefault(p => p.Name == key)).FirstOrDefault(p => p is not null) is not { } property)
                continue;
            var held = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            var value = field.Groups["value"].Value;
            if (held == typeof(byte[]) || held.IsGenericType && held.GetGenericArguments() is [var of] && of == typeof(byte) && held.Name.Contains("MemorySlice"))
            {
                if (value.Length > 0 && !Regex.IsMatch(value, "^0x(?:[0-9A-Fa-f]{2})+$")) wrong.Add($"line {i + 1}, `{lines[i].Trim()}`");
            }
            else if (value.Length == 0)
                parts.Add((column, held != typeof(string) && held.IsGenericType && typeof(System.Collections.IEnumerable).IsAssignableFrom(held)
                    ? held.GetGenericArguments()[0] : held));
        }
        return wrong.Count == 0 ? ""
            : $" Of bytes, written otherwise: {string.Join(", ", wrong)} — a field of bytes is written as readRecord shows it, 0x and two hex " +
                "digits a byte, as `Unused2: 0x000000`.";
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
        // Below a field of one value, or indented deeper than the fields beside it (eval probe 10 after round 11).
        { Success: true } m when m.Groups[1].Value == "MappingEnd" =>
            ": it is indented below a field that takes one value on its own line, or deeper than the fields beside it",
        _ => ""
    };
}
