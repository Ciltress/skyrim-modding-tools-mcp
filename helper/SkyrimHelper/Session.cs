using System.Diagnostics;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using Mutagen.Bethesda;
using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Plugins.Aspects;
using Mutagen.Bethesda.Plugins.Cache;
using Mutagen.Bethesda.Plugins.Records;
using Mutagen.Bethesda.Serialization.Yaml;
using Mutagen.Bethesda.Skyrim;

namespace SkyrimHelper;

/// <summary>
/// The helper's state between calls: the load order the server handed over, the plugins opened as
/// read-only overlays, a link cache over them, and a lazily built index of their records.
/// </summary>
public sealed class Session : IDisposable
{
    public const string Version = "0.1.0";
    private const int DefaultLimit = 25;
    internal static readonly ModKey SkyrimMaster = ModKey.FromFileName("Skyrim.esm");

    private SkyrimRelease release = SkyrimRelease.SkyrimSE;
    private readonly List<LoadedPlugin> plugins = [];
    private ILinkCache<ISkyrimMod, ISkyrimModGetter>? cache;
    /// <summary>Started as soon as a load order arrives, so the first search rarely waits for it.</summary>
    private Task<RecordIndex>? indexing;

    private RecordIndex Index => (indexing ?? throw new HelperException("noLoadOrder", "No load order set: call setLoadOrder first."))
        .GetAwaiter().GetResult();

    private sealed record LoadedPlugin(ModKey Key, string Path, ISkyrimModDisposableGetter Mod);

    public async Task<JsonNode?> Dispatch(string method, JsonObject p)
    {
        // Overlays are read by one thread at a time: whatever reads plugins waits for the background index.
        // Downloaded files and plugin headers are read from files of their own, and need not wait; record
        // files do, since a FormKey of another plugin's is checked against the record it names.
        if (method is not ("hello" or "gameVersion" or "setLoadOrder" or "readArchive" or "extractArchive" or "pluginHeaders")
            && indexing is { } running)
        {
            try { await running; } catch { /* surfaced by the call that needs the index */ }
        }
        return await Run(method, p);
    }

    private async Task<JsonNode?> Run(string method, JsonObject p) => method switch
    {
        "hello" => new JsonObject { ["helper"] = Version, ["mutagen"] = MutagenVersion(), ["protocol"] = 1 },
        "gameVersion" => GameVersion(p),
        "setLoadOrder" => SetLoadOrder(p),
        "findRecords" => FindRecords(p),
        "readRecord" => await ReadRecord(p),
        "addOverrides" => await AddOverrides(p),
        "build" => await Build(p),
        "serialize" => await Serialize(p),
        "readArchive" => Archives.Read(p),
        "extractArchive" => Archives.Extract(p),
        "pluginHeaders" => PluginHeaders(p),
        "checkRecords" => CheckRecords(Required(p, "projectPluginDir")),
        "sksePlugins" => SksePlugins.Read(p),
        _ => throw new HelperException("unknownMethod", $"No method '{method}'.")
    };

    // ---------------------------------------------------------------- environment

    private static string MutagenVersion() =>
        typeof(SkyrimMod).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion?.Split('+')[0] ?? "?";

    private static JsonNode GameVersion(JsonObject p)
    {
        var exe = Required(p, "exePath");
        if (!File.Exists(exe)) throw new HelperException("notFound", $"No game executable at '{exe}'.");
        return new JsonObject { ["version"] = PeVersion.Read(exe) };
    }

    private JsonNode SetLoadOrder(JsonObject p)
    {
        release = (p["release"]?.GetValue<string>() ?? "SkyrimSE") switch
        {
            "SkyrimSE" => SkyrimRelease.SkyrimSE,
            "SkyrimSEGog" => SkyrimRelease.SkyrimSEGog,
            var other => throw new HelperException("badRequest", $"Unsupported release '{other}': use SkyrimSE or SkyrimSEGog.")
        };

        DisposePlugins();
        var missing = new JsonArray();
        foreach (var entry in p["plugins"]?.AsArray() ?? [])
        {
            var name = entry?["name"]?.GetValue<string>() ?? throw new HelperException("badRequest", "Every plugin needs a 'name'.");
            var path = entry?["path"]?.GetValue<string>();
            if (path is null || !File.Exists(path)) { missing.Add(name); continue; }
            var key = ModKey.FromFileName(name);
            // A plugin someone may edit — from a mod folder or overwrite — is read into memory, so this
            // process never holds it open: an open handle stops the Creation Kit, xEdit and a deploy from
            // saving over it. The game's own masters are large and never saved over; they stay on disk.
            ISkyrimModDisposableGetter mod;
            if (entry?["inMemory"]?.GetValue<bool>() == true)
            {
                var bytes = File.ReadAllBytes(path);
                mod = SkyrimMod.Create(release).FromStreamFactory(() => new MemoryStream(bytes, writable: false), key).Construct();
            }
            else
            {
                mod = SkyrimMod.Create(release).FromPath(new ModPath(key, path)).Construct();
            }
            plugins.Add(new LoadedPlugin(mod.ModKey, path, mod));
        }
        cache = plugins.Select(x => (ISkyrimModGetter)x.Mod).ToImmutableLinkCache<ISkyrimMod, ISkyrimModGetter>();
        var snapshot = plugins.Select(x => (x.Key, (ISkyrimModGetter)x.Mod)).ToList();
        indexing = Task.Run(() =>
        {
            var clock = Stopwatch.StartNew();
            var built = RecordIndex.Build(snapshot);
            Console.Error.WriteLine($"[helper] indexed {built.ByFormKey.Count} records of {snapshot.Count} plugins in {clock.ElapsedMilliseconds} ms");
            return built;
        });
        return new JsonObject { ["plugins"] = plugins.Count, ["missing"] = missing };
    }

    private ILinkCache<ISkyrimMod, ISkyrimModGetter> Cache =>
        cache ?? throw new HelperException("noLoadOrder", "No load order set: call setLoadOrder first.");

    // ---------------------------------------------------------------- finding

    private JsonNode FindRecords(JsonObject p)
    {
        var idx = Index;
        var limit = p["limit"]?.GetValue<int>() ?? DefaultLimit;
        var types = p["types"]?.AsArray().Select(t => t!.GetValue<string>()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var plugin = p["plugin"]?.GetValue<string>();
        // A misspelled type would match nothing, and "no records" sends a model looking elsewhere.
        foreach (var type in types ?? [])
        {
            if (RecordIndex.IsRecordType(type)) continue;
            var closest = RecordIndex.Closest(type).ToList();
            throw new HelperException("badRequest",
                $"'{type}' is not a record type." + (closest.Count > 0 ? $" Did you mean {string.Join(", ", closest)}?" : "") +
                " Use a signature like WEAP or a type name like Weapon.");
        }

        IEnumerable<RecordIndex.Entry> matches;
        var notFound = new JsonArray();
        if (p["records"] is JsonArray wanted)
        {
            var found = new List<RecordIndex.Entry>();
            foreach (var raw in wanted.Select(r => r!.GetValue<string>()))
            {
                var key = FormIdShape.IsMatch(raw) ? ParseFormKey(raw)
                    : idx.ByEditorId.TryGetValue(raw.Trim(), out var byId) ? byId
                    : EditorIdWithPlugin(raw, idx) ?? (raw.Contains(':') ? ParseFormKey(raw) : (FormKey?)null);
                if (key is { } k && idx.ByFormKey.TryGetValue(k, out var entry)) found.Add(entry);
                else notFound.Add(raw);
            }
            matches = found;
        }
        else
        {
            var text = p["text"]?.GetValue<string>()?.Trim() ?? "";
            matches = idx.ByFormKey.Values
                .Where(e => text.Length == 0
                    || e.EditorId?.Contains(text, StringComparison.OrdinalIgnoreCase) == true
                    || e.Name?.Contains(text, StringComparison.OrdinalIgnoreCase) == true)
                // Exact matches first, then the in-game names people speak in — "steel" finds the Steel
                // Sword before 1stPersonSteelSword, a static only the editor ID mentions — and the named records
                // whose editor IDs begin with the text, which name the thing itself: "shock" finds
                // ShockDamageFFAimed, Lightning Bolt's effect, before EnchShockDamageFFContact, a weapon's, which
                // three of three spells copied (eval probe 9 after round 11); SteelBootsAA, nameless, stays back.
                .OrderBy(e => string.Equals(e.EditorId, text, StringComparison.OrdinalIgnoreCase) ? 0
                    : string.Equals(e.Name, text, StringComparison.OrdinalIgnoreCase) ? 1
                    : e.Name?.Contains(text, StringComparison.OrdinalIgnoreCase) == true
                        || e.Name is { Length: > 0 } && e.EditorId?.StartsWith(text.Replace(" ", ""), StringComparison.OrdinalIgnoreCase) == true ? 2 : 3)
                // Among equals, the editor ID beginning with the text, then the one spelling it out: SteelSword
                // before the quest's FFRiften16HarraldSword, both named "Steel Sword".
                .ThenBy(e => e.EditorId?.StartsWith(text.Replace(" ", ""), StringComparison.OrdinalIgnoreCase) == true ? 0 : 1)
                .ThenBy(e => e.EditorId?.Contains(text.Replace(" ", ""), StringComparison.OrdinalIgnoreCase) == true ? 0 : 1)
                .ThenBy(e => e.EditorId, StringComparer.OrdinalIgnoreCase);
        }
        if (types is { Count: > 0 }) matches = matches.Where(e => types.Contains(e.Signature) || types.Contains(e.Type));
        if (plugin is not null) matches = matches.Where(e => e.Plugins.Any(k => k.FileName.String.Equals(plugin, StringComparison.OrdinalIgnoreCase)));

        var all = matches.ToList();
        var rows = new JsonArray();
        foreach (var e in all.Take(limit)) rows.Add(e.ToJson());
        var answer = new JsonObject { ["total"] = all.Count, ["records"] = rows };
        if (notFound.Count > 0)
        {
            answer["notFound"] = notFound;
            // "Steel Sword" looked up as an editor ID found nothing, and a model gave up (eval round 11's probes).
            answer["nextStep"] = "records takes exact FormIDs and editor IDs only; to search in-game names and parts of " +
                $"editor IDs, send text instead: {{\"text\": \"{notFound[0]!.GetValue<string>().Replace("\"", "")}\"}}";
        }
        return answer;
    }

    // ---------------------------------------------------------------- reading

    private async Task<JsonNode> ReadRecord(JsonObject p)
    {
        var formKey = Resolve(Required(p, "record"), byName: true);
        var plugin = p["plugin"]?.GetValue<string>();
        var all = p["allVersions"]?.GetValue<bool>() ?? false;

        var contexts = Contexts(formKey);
        if (contexts.Count == 0) throw new HelperException("notFound", $"No record {formKey} in the load order.");

        var chosen = plugin is not null
            ? contexts.Where(c => c.ModKey.FileName.String.Equals(plugin, StringComparison.OrdinalIgnoreCase)).ToList()
            : all ? contexts : contexts.Take(1).ToList();
        if (chosen.Count == 0)
            throw new HelperException("notFound",
                $"{plugin} does not contain {formKey}. It is in: {string.Join(", ", contexts.Select(c => c.ModKey.FileName))}.");

        var versions = new JsonArray();
        foreach (var context in chosen)
        {
            var files = new JsonArray();
            foreach (var (path, text) in await Render([context], context.ModKey))
                files.Add(new JsonObject { ["path"] = path, ["text"] = Annotated(text) });
            versions.Add(new JsonObject
            {
                ["plugin"] = context.ModKey.FileName.String,
                ["winning"] = context.ModKey == contexts[0].ModKey,
                ["files"] = files
            });
        }

        var winner = contexts[0].Record;
        return new JsonObject
        {
            ["formId"] = FormKeyText(formKey),
            ["editorId"] = winner.EditorID,
            ["type"] = RecordIndex.TypeName(winner),
            ["signature"] = RecordIndex.Signature(winner),
            ["definedIn"] = formKey.ModKey.FileName.String,
            ["winner"] = contexts[0].ModKey.FileName.String,
            ["plugins"] = new JsonArray(contexts.AsEnumerable().Reverse().Select(c => (JsonNode)c.ModKey.FileName.String).ToArray()),
            ["versions"] = versions
        };
    }

    private static readonly Regex LinkLine = new(@"^(?!FormKey:)([ \t]*(?:- )?(?:\w+:[ \t]*)?)([0-9A-Fa-f]{6}:\S+\.es[mpl])[ \t]*$",
        RegexOptions.Multiline | RegexOptions.IgnoreCase);

    /// <summary>
    /// A record's text to read, with the editor ID of each record it links to beside the FormID, as a
    /// YAML comment the reader skips: <c>BaseEffect: 012F03:Skyrim.esm  # FireDamageFFAimed</c>. Bare
    /// FormIDs said nothing: a model copied Firebolt's fire effects into its shock spell, and wrote an
    /// invented race after reading Lydia's (eval round 11's probes).
    /// </summary>
    private string Annotated(string text) => LinkLine.Replace(text, line =>
        FormKey.TryFactory(line.Groups[2].Value, out var key) && Index.ByFormKey.TryGetValue(key, out var entry) && entry.EditorId is { } id
            ? $"{line.Groups[1].Value}{line.Groups[2].Value}  # {id}"
            : line.Value);

    /// <summary>
    /// The given versions, as overrides in a plugin named <paramref name="asPlugin"/>, in project text:
    /// relative path and contents of every file except the plugin header.
    /// </summary>
    /// <remarks>
    /// The overrides go through a real plugin file first, so the text is exactly what a build and a
    /// pull produce — one language instead of every translation a localized master carries, and the
    /// normalisations a round trip applies — and a project never changes on its first pull.
    /// </remarks>
    private async Task<List<(string Path, string Text)>> Render(
        IEnumerable<IModContext<ISkyrimMod, ISkyrimModGetter, IMajorRecord, IMajorRecordGetter>> contexts, ModKey asPlugin)
    {
        var temp = new SkyrimMod(asPlugin, release);
        foreach (var context in contexts) context.GetOrAddAsOverride(temp);

        var dir = Directory.CreateTempSubdirectory("skyrimhelper-").FullName;
        try
        {
            var plugin = Path.Combine(dir, asPlugin.FileName);
            await temp.BeginWrite.ToPath(plugin).WithLoadOrder(LoadedMods(except: asPlugin)).WriteAsync();
            using var written = SkyrimMod.Create(release).FromPath(plugin).Construct();
            var yaml = Path.Combine(dir, "yaml");
            await MutagenYamlConverter.Instance.Serialize(written, yaml);
            return Directory.GetFiles(yaml, "*.yaml", SearchOption.AllDirectories)
                .Select(f => (Path: Path.GetRelativePath(yaml, f).Replace('\\', '/'), Text: Lf(File.ReadAllText(f))))
                .Where(f => f.Path != "RecordData.yaml")
                .OrderBy(f => f.Path, StringComparer.Ordinal)
                .ToList();
        }
        finally { Directory.Delete(dir, true); }
    }

    private List<ISkyrimModGetter> LoadedMods(ModKey except) =>
        plugins.Where(x => x.Key != except).Select(x => (ISkyrimModGetter)x.Mod).ToList();

    /// <summary>Project text uses LF: fewer bytes in every answer, and no line-ending churn in git.</summary>
    public static string Lf(string text) => text.Replace("\r\n", "\n");

    // ---------------------------------------------------------------- patching

    private async Task<JsonNode> AddOverrides(JsonObject p)
    {
        var pluginName = ModKey.FromFileName(Required(p, "plugin"));
        var projectDir = Required(p, "projectPluginDir");
        var from = p["from"]?.GetValue<string>();
        var requested = p["records"]?.AsArray().Select(r => r!.GetValue<string>()).ToList()
            ?? throw new HelperException("badRequest", "'records' is required: FormIDs like 012EB7:Skyrim.esm, or editor IDs.");

        var added = new JsonArray();
        var already = new JsonArray();
        foreach (var raw in requested)
        {
            var formKey = Resolve(raw);
            if (ProjectFileFor(projectDir, formKey) is { } existing)
            {
                already.Add(new JsonObject { ["formId"] = FormKeyText(formKey), ["file"] = existing });
                continue;
            }

            // The project's own deployed plugin is never the source: its content is the project itself.
            var contexts = Contexts(formKey).Where(c => c.ModKey != pluginName).ToList();
            if (contexts.Count == 0) throw new HelperException("notFound", $"No record {formKey} in the load order.");
            var source = from is null
                ? contexts[0]
                : contexts.FirstOrDefault(c => c.ModKey.FileName.String.Equals(from, StringComparison.OrdinalIgnoreCase))
                  ?? throw new HelperException("notFound",
                      $"{from} does not contain {formKey}. It is in: {string.Join(", ", contexts.Select(c => c.ModKey.FileName))}.");

            var files = new JsonArray();
            foreach (var (path, text) in await Render([source], pluginName))
            {
                var target = Path.Combine(projectDir, path);
                if (File.Exists(target)) continue; // e.g. the parent cell's header, already brought in
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                // As readRecord shows it: a line copied from there into an edit, its link's editor ID beside it, matched
                // nothing in a copy that held the FormID bare — seven times the same edit (eval round 30). A pull, whose
                // text has none, leaves a file that differs only in them as it is.
                await File.WriteAllTextAsync(target, Annotated(text));
                files.Add(path);
            }
            added.Add(new JsonObject
            {
                ["formId"] = FormKeyText(formKey),
                ["editorId"] = source.Record.EditorID,
                ["type"] = RecordIndex.TypeName(source.Record),
                ["from"] = source.ModKey.FileName.String,
                ["files"] = files
            });
        }
        return new JsonObject { ["added"] = added, ["alreadyInProject"] = already };
    }

    private static string? ProjectFileFor(string projectDir, FormKey formKey)
    {
        if (!Directory.Exists(projectDir)) return null;
        var suffix = $"{formKey.ID:X6}_{formKey.ModKey.FileName}.yaml";
        return Directory.EnumerateFiles(projectDir, "*.yaml", SearchOption.AllDirectories)
            .FirstOrDefault(f => Path.GetFileName(f).EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) is { } hit
            ? Path.GetRelativePath(projectDir, hit).Replace('\\', '/')
            : null;
    }

    // ---------------------------------------------------------------- build and pull

    /// <summary>
    /// Everything a build would refuse in the record files, said before the server gives new records
    /// their FormIDs — so every file is still under the name its author wrote it under.
    /// </summary>
    private JsonNode CheckRecords(string dir)
    {
        // A fix with one right answer is written first, and named in a refusal that comes after it too: the model
        // knows the file as it wrote it, and an edit of the line taken out finds nothing.
        var corrected = RecordFiles.DropCopiedFormKeys(dir, Index);
        // A line written twice first: the YAML reader the moves use refuses the file until it is gone.
        corrected.AddRange(RecordFiles.DropRepeatedLines(dir));
        corrected.AddRange(MisplacedFields.Move(dir));
        int records;
        List<(string File, string Copy)> leftOut;
        try
        {
            (records, leftOut) = RecordFiles.Require(dir, Index);
            RecordLinks.Resolve(dir, Index, write: false);
        }
        catch (HelperException e) when (corrected.Count > 0)
        {
            throw new HelperException(e.Code,
                $"{e.Message} Corrected in the files already: {string.Join("; ", corrected.Select(c => $"{c.File}: {c.Change}"))}.");
        }
        return new JsonObject
        {
            ["records"] = records,
            ["leftOut"] = new JsonArray(leftOut.Select(l => (JsonNode)new JsonObject { ["file"] = l.File, ["copy"] = l.Copy }).ToArray()),
            ["notes"] = new JsonArray(ProjectNotes.Of(dir, Index, Cache).Select(n => (JsonNode)n).ToArray()),
            ["corrected"] = new JsonArray(corrected.Select(c => (JsonNode)new JsonObject { ["file"] = c.File, ["change"] = c.Change }).ToArray())
        };
    }

    private async Task<JsonNode> Build(JsonObject p)
    {
        var dir = Required(p, "projectPluginDir");
        var output = Required(p, "outputPath");
        var headerVersion = p["headerVersion"]?.GetValue<float>() ?? 1.71f;
        if (!File.Exists(Path.Combine(dir, "RecordData.yaml")))
            throw new HelperException("notFound", $"No RecordData.yaml in '{dir}': this is not a project's plugin folder.");

        // What the reader would skip or fail on without saying why, named first (RecordFiles); then the
        // links written by editor ID, made FormKeys the reader takes (RecordLinks).
        RecordFiles.Require(dir, Index);
        var resolvedLinks = RecordLinks.Resolve(dir, Index, write: true);
        IModGetter deserialized;
        var readable = WithoutEmptyFiles(dir);
        try
        {
            deserialized = await MutagenYamlConverter.Instance.Deserialize(readable);
        }
        catch (Exception e) when (e is not HelperException)
        {
            // The copy has the folder's layout, so the file is named as the project has it.
            throw RecordFiles.Unreadable(e, readable);
        }
        finally
        {
            if (readable != dir) Directory.Delete(readable, recursive: true);
        }
        if (deserialized is not ISkyrimMod mod) throw new HelperException("badRequest", "The project is not a Skyrim plugin.");
        mod.ModHeader.Stats.Version = headerVersion;
        // xEdit's Check for Errors requires an author in the header; the Creation Kit writes this one.
        if (string.IsNullOrWhiteSpace(mod.ModHeader.Author)) mod.ModHeader.Author = "DEFAULT";

        // Everything the plugin points at must exist — in the plugin itself, or in the load order without it.
        var others = LoadedMods(except: mod.ModKey);
        var lookup = others.ToImmutableLinkCache<ISkyrimMod, ISkyrimModGetter>();
        var own = mod.EnumerateMajorRecords().Select(r => r.FormKey).ToHashSet();
        var dangling = new List<string>();
        foreach (var record in mod.EnumerateMajorRecords())
        {
            foreach (var link in record.EnumerateFormLinks())
            {
                // Skyrim.esm's numbers below 000800 are the engine's own: the player's reference, 000014,
                // is in no plugin, and every Creation Club plugin points at it.
                if (link.IsNull || (link.FormKey.ModKey == SkyrimMaster && link.FormKey.ID < 0x800)) continue;
                var found = link.FormKey.ModKey == mod.ModKey
                    ? own.Contains(link.FormKey)
                    : lookup.TryResolve(link.FormKey, link.Type, out _);
                if (!found) dangling.Add($"{record.EditorID ?? FormKeyText(record.FormKey)} -> {FormKeyText(link.FormKey)}");
            }
        }
        if (dangling.Count > 0)
            throw new HelperException("danglingLinks",
                $"{dangling.Count} link(s) point at records that exist neither in the project nor in the load order: " +
                string.Join("; ", dangling.Distinct().Take(20)) + (dangling.Count > 20 ? "; …" : ""));

        // A new spell's effects cast as it is, or the spell does nothing in game (EffectCasting).
        var miscast = EffectCasting.Mismatches(mod, lookup, Index, dir);
        if (miscast.Count > 0)
            throw new HelperException("badRecord",
                $"{miscast.Count} effect(s) would do nothing in game: {string.Join("; ", miscast.Take(12))}" + (miscast.Count > 12 ? "; …" : ""));

        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        try
        {
            await mod.BeginWrite.ToPath(output).WithLoadOrder(others).WriteAsync();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // The disk, not the project: a full drive, a file another program holds open.
            throw new HelperException("ioFailed", $"Could not write '{output}': {e.Message}");
        }
        catch (Exception e) when (e is not HelperException)
        {
            throw new HelperException("writeFailed",
                $"The plugin cannot be written from the project's text: {e.Message} Compare the records named " +
                "there with a vanilla record of the same type (readRecord) and fix their fields.");
        }

        using var written = SkyrimMod.Create(release).FromPath(output).Construct();
        return new JsonObject
        {
            ["output"] = output,
            ["records"] = written.EnumerateMajorRecords().Count(),
            ["masters"] = new JsonArray(written.ModHeader.MasterReferences.Select(m => (JsonNode)m.Master.FileName.String).ToArray()),
            ["headerVersion"] = written.ModHeader.Stats.Version,
            ["resolvedLinks"] = resolvedLinks
        };
    }

    private async Task<JsonNode> Serialize(JsonObject p)
    {
        var pluginPath = Required(p, "pluginPath");
        var outputDir = Required(p, "outputDir");
        if (!File.Exists(pluginPath)) throw new HelperException("notFound", $"No plugin at '{pluginPath}'.");
        using var mod = SkyrimMod.Create(release).FromPath(pluginPath).Construct();
        await MutagenYamlConverter.Instance.Serialize(mod, outputDir);
        var files = Directory.GetFiles(outputDir, "*.yaml", SearchOption.AllDirectories);
        foreach (var file in files) File.WriteAllText(file, Lf(File.ReadAllText(file)));
        return new JsonObject { ["files"] = files.Length };
    }

    // ---------------------------------------------------------------- installing

    /// <summary>
    /// The header of each plugin a mod brings: its masters, and whether it is master- or light-flagged —
    /// what the server needs to place new plugins in the load order and to name missing masters. A file
    /// that is not a plugin answers its error instead.
    /// </summary>
    private JsonNode PluginHeaders(JsonObject p)
    {
        var answers = new JsonArray();
        foreach (var path in p["paths"]?.AsArray().Select(x => x!.GetValue<string>())
            ?? throw new HelperException("badRequest", "'paths' is required: the plugins' full paths."))
        {
            try
            {
                using var mod = SkyrimMod.Create(release).FromPath(new ModPath(ModKey.FromFileName(Path.GetFileName(path)), path)).Construct();
                var flags = mod.ModHeader.Flags;
                answers.Add(new JsonObject
                {
                    ["path"] = path,
                    ["masters"] = new JsonArray(mod.ModHeader.MasterReferences.Select(m => (JsonNode)m.Master.FileName.String).ToArray()),
                    ["master"] = flags.HasFlag(SkyrimModHeader.HeaderFlag.Master),
                    ["light"] = flags.HasFlag(SkyrimModHeader.HeaderFlag.Small)
                });
            }
            catch (Exception e)
            {
                answers.Add(new JsonObject { ["path"] = path, ["error"] = e.Message });
            }
        }
        return new JsonObject { ["plugins"] = answers };
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// The plugin folder as the reader can take it: itself, or — where record files were written empty to
    /// drop their records (RecordFiles.Check) — a copy without them, as the reader fails on an empty file.
    /// The project's own files are never renamed or moved.
    /// </summary>
    private static string WithoutEmptyFiles(string dir)
    {
        var files = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).ToList();
        var empty = files.Where(f => f.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase) && RecordFiles.Empty(File.ReadAllText(f))).ToHashSet();
        if (empty.Count == 0) return dir;
        var copy = Path.Combine(Path.GetTempPath(), $"skyrim-helper-build-{Guid.NewGuid():N}");
        foreach (var file in files)
        {
            if (empty.Contains(file)) continue;
            var target = Path.Combine(copy, Path.GetRelativePath(dir, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target);
        }
        return copy;
    }

    /// <summary>
    /// Every version of a record, winning first. Resolved by its own type when the index knows it:
    /// resolving as "any record" makes the link cache index every record type there is.
    /// </summary>
    private List<IModContext<ISkyrimMod, ISkyrimModGetter, IMajorRecord, IMajorRecordGetter>> Contexts(FormKey formKey)
    {
        var type = Index.ByFormKey.TryGetValue(formKey, out var entry) ? entry.GetterType : typeof(IMajorRecordGetter);
        return Cache.ResolveAllContexts(formKey, type).ToList();
    }

    /// <param name="byName">
    /// Whether an in-game name that one record alone has finds that record — for reading. e4b asked for "Note
    /// From Maven", was told its editor ID, and never read it (eval round 18). Copying keeps to exact names.
    /// </param>
    private FormKey Resolve(string raw, bool byName = false)
    {
        // A FormID is hex digits before its colon; "Spell Tome: Flames" is a name.
        if (FormIdShape.IsMatch(raw)) return ParseFormKey(raw);
        if (Index.ByEditorId.TryGetValue(raw.Trim(), out var key)) return key;
        if (EditorIdWithPlugin(raw, Index) is { } withPlugin) return withPlugin;
        // An in-game name, sent as an editor ID: "Lydia", whose editor ID is HousecarlWhiterun (eval probe 15).
        var withName = Index.ByFormKey.Values.Where(e => e.EditorId is not null && string.Equals(e.Name, raw.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        if (byName && withName.Count == 1) return withName[0].FormKey;
        var named = withName.OrderBy(e => e.FormKey.ModKey == SkyrimMaster ? 0 : 1).Take(5)
            .Select(e => $"{e.EditorId} ({e.Type}, {FormKeyText(e.FormKey)})").ToList();
        // A colon that is no record's name is a FormID written wrong: Skyrim.esm:012EB7.
        if (named.Count == 0 && raw.Contains(':')) return ParseFormKey(raw);
        var near = named.Count > 0 ? new List<string>() : RecordLinks.Closest(raw.Trim(), Index);
        throw new HelperException("notFound", $"No record with editor ID '{raw}' in the load order" +
            (named.Count > 0 ? $" — the records named '{raw.Trim()}' in game: {string.Join(", ", named)}; read one by its editor ID"
                : near.Count > 0 ? $" — the records closest to it: {string.Join(", ", near)}" : "") + ". Search with findRecords.");
    }

    private static readonly Regex FormIdShape = new(@"^\s*[0-9A-Fa-f]{1,8}\s*:", RegexOptions.None, TimeSpan.FromSeconds(5));

    /// <summary>
    /// An editor ID with the plugin that defines it after a colon, written the way a FormID is —
    /// SteelSword:Skyrim.esm (eval round 21) — names that record. With a plugin that does not define it, the
    /// refusal gives the FormID it has.
    /// </summary>
    private static FormKey? EditorIdWithPlugin(string raw, RecordIndex index)
    {
        var colon = raw.LastIndexOf(':');
        var editorId = colon > 0 ? raw[..colon].Trim() : "";
        if (editorId.Length == 0 || !index.ByEditorId.TryGetValue(editorId, out var key)) return null;
        return key.ModKey.FileName.String.Equals(raw[(colon + 1)..].Trim(), StringComparison.OrdinalIgnoreCase)
            ? key
            : throw new HelperException("badRequest",
                $"'{raw.Trim()}' is not a FormID: {editorId} is {FormKeyText(key)}, defined in {key.ModKey.FileName} — write that, or {editorId} alone.");
    }

    private static FormKey ParseFormKey(string raw) =>
        FormKey.TryFactory(raw.Trim(), out var key)
            ? key
            : throw new HelperException("badRequest", $"'{raw}' is not a FormID: write it as 012EB7:Skyrim.esm.");

    public static string FormKeyText(FormKey key) => $"{key.ID:X6}:{key.ModKey.FileName}";

    public static string Required(JsonObject p, string name) =>
        p[name]?.GetValue<string>() is { Length: > 0 } value
            ? value
            : throw new HelperException("badRequest", $"'{name}' is required.");

    private void DisposePlugins()
    {
        // The index reads the plugins in the background; let it finish before closing them.
        try { indexing?.Wait(); } catch { /* a failed index is rebuilt with the next load order */ }
        foreach (var plugin in plugins) plugin.Mod.Dispose();
        plugins.Clear();
        cache = null;
        indexing = null;
    }

    public void Dispose() => DisposePlugins();
}
