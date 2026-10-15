using System.Diagnostics;
using System.Reflection;
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
        if (method is not ("hello" or "gameVersion" or "setLoadOrder") && indexing is { } running)
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

        IEnumerable<RecordIndex.Entry> matches;
        var notFound = new JsonArray();
        if (p["records"] is JsonArray wanted)
        {
            var found = new List<RecordIndex.Entry>();
            foreach (var raw in wanted.Select(r => r!.GetValue<string>()))
            {
                var key = raw.Contains(':') ? ParseFormKey(raw)
                    : idx.ByEditorId.TryGetValue(raw.Trim(), out var byId) ? byId : (FormKey?)null;
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
                .OrderBy(e => string.Equals(e.EditorId, text, StringComparison.OrdinalIgnoreCase) ? 0
                    : string.Equals(e.Name, text, StringComparison.OrdinalIgnoreCase) ? 1 : 2)
                .ThenBy(e => e.EditorId, StringComparer.OrdinalIgnoreCase);
        }
        if (types is { Count: > 0 }) matches = matches.Where(e => types.Contains(e.Signature) || types.Contains(e.Type));
        if (plugin is not null) matches = matches.Where(e => e.Plugins.Any(k => k.FileName.String.Equals(plugin, StringComparison.OrdinalIgnoreCase)));

        var all = matches.ToList();
        var rows = new JsonArray();
        foreach (var e in all.Take(limit)) rows.Add(e.ToJson());
        var answer = new JsonObject { ["total"] = all.Count, ["records"] = rows };
        if (notFound.Count > 0) answer["notFound"] = notFound;
        return answer;
    }

    // ---------------------------------------------------------------- reading

    private async Task<JsonNode> ReadRecord(JsonObject p)
    {
        var formKey = Resolve(Required(p, "record"));
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
                files.Add(new JsonObject { ["path"] = path, ["text"] = text });
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
                await File.WriteAllTextAsync(target, text);
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

    private async Task<JsonNode> Build(JsonObject p)
    {
        var dir = Required(p, "projectPluginDir");
        var output = Required(p, "outputPath");
        var headerVersion = p["headerVersion"]?.GetValue<float>() ?? 1.71f;
        if (!File.Exists(Path.Combine(dir, "RecordData.yaml")))
            throw new HelperException("notFound", $"No RecordData.yaml in '{dir}': this is not a project's plugin folder.");

        var deserialized = await MutagenYamlConverter.Instance.Deserialize(dir);
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
                if (link.IsNull) continue;
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
            ["headerVersion"] = written.ModHeader.Stats.Version
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

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// Every version of a record, winning first. Resolved by its own type when the index knows it:
    /// resolving as "any record" makes the link cache index every record type there is.
    /// </summary>
    private List<IModContext<ISkyrimMod, ISkyrimModGetter, IMajorRecord, IMajorRecordGetter>> Contexts(FormKey formKey)
    {
        var type = Index.ByFormKey.TryGetValue(formKey, out var entry) ? entry.GetterType : typeof(IMajorRecordGetter);
        return Cache.ResolveAllContexts(formKey, type).ToList();
    }

    private FormKey Resolve(string raw)
    {
        if (raw.Contains(':')) return ParseFormKey(raw);
        return Index.ByEditorId.TryGetValue(raw.Trim(), out var key)
            ? key
            : throw new HelperException("notFound", $"No record with editor ID '{raw}' in the load order. Search with findRecords.");
    }

    private static FormKey ParseFormKey(string raw) =>
        FormKey.TryFactory(raw.Trim(), out var key)
            ? key
            : throw new HelperException("badRequest", $"'{raw}' is not a FormID: write it as 012EB7:Skyrim.esm.");

    public static string FormKeyText(FormKey key) => $"{key.ID:X6}:{key.ModKey.FileName}";

    private static string Required(JsonObject p, string name) =>
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
