using System.Text.Json.Nodes;
using SharpCompress.Archives;
using SharpCompress.Common;

namespace SkyrimHelper;

/// <summary>
/// Downloaded files — .7z, .zip, .rar — for installMod. The helper only reads them: which files one
/// holds, its FOMOD installer as data (Fomod.cs), and the files it is told to unpack where it is told.
/// What goes where is the server's decision, and is tested there.
/// </summary>
public static class Archives
{
    /// <summary>Every file in the archive, with `/` between folders, and its FOMOD installer when it has one.</summary>
    public static JsonNode Read(JsonObject p)
    {
        var path = Session.Required(p, "archivePath");
        using var archive = Open(path);
        var files = archive.Entries
            .Where(e => !e.IsDirectory && e.Key is not null)
            .Select(e => (Entry: e, Path: Normalize(e.Key!)))
            .ToList();
        var answer = new JsonObject
        {
            ["files"] = new JsonArray(files.Select(f => (JsonNode)f.Path).ToArray())
        };
        // The installer nearest the top: a wrapper folder may hold it, a bundled mod's own may sit deeper.
        const string config = "fomod/ModuleConfig.xml";
        var installer = files
            .Where(f => f.Path.Equals(config, StringComparison.OrdinalIgnoreCase)
                || f.Path.EndsWith("/" + config, StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f.Path.Count(c => c == '/'))
            .FirstOrDefault();
        if (installer.Entry is not null)
        {
            using var stream = installer.Entry.OpenEntryStream();
            using var bytes = new MemoryStream();
            stream.CopyTo(bytes);
            answer["fomod"] = new JsonObject
            {
                ["path"] = installer.Path,
                ["config"] = Fomod.Parse(bytes.ToArray())
            };
        }
        return answer;
    }

    /// <summary>
    /// Unpacks the files named in `files` — `{from, to}`, `to` relative to `targetDir` — and nothing
    /// else. One file may go to several places. Answers how many were written, and any `from` the
    /// archive does not hold.
    /// </summary>
    public static JsonNode Extract(JsonObject p)
    {
        var path = Session.Required(p, "archivePath");
        var targetDir = Path.GetFullPath(Session.Required(p, "targetDir"));
        var wanted = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in p["files"]?.AsArray() ?? throw new HelperException("badRequest", "'files' is required: [{from, to}]."))
        {
            var from = Normalize(item?["from"]?.GetValue<string>() ?? throw new HelperException("badRequest", "Every file needs a 'from'."));
            var to = Inside(targetDir, item?["to"]?.GetValue<string>() ?? throw new HelperException("badRequest", "Every file needs a 'to'."));
            if (!wanted.TryGetValue(from, out var targets)) wanted[from] = targets = [];
            targets.Add(to);
        }

        using var archive = Open(path);
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var written = 0;
        void Write(string key, Action<Stream> writeTo)
        {
            if (!wanted.TryGetValue(key, out var targets)) return;
            found.Add(key);
            Directory.CreateDirectory(Path.GetDirectoryName(targets[0])!);
            using (var output = File.Create(targets[0])) writeTo(output);
            foreach (var other in targets.Skip(1))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(other)!);
                File.Copy(targets[0], other, overwrite: true);
            }
            written += targets.Count;
        }

        try
        {
            // A solid archive — most .7z — is one compressed stream: read it once, front to back,
            // rather than from the start again for every file.
            if (archive.IsSolid || archive.Type == ArchiveType.SevenZip)
            {
                using var reader = archive.ExtractAllEntries();
                while (reader.MoveToNextEntry())
                {
                    if (reader.Entry.IsDirectory || reader.Entry.Key is null) continue;
                    Write(Normalize(reader.Entry.Key), output => reader.WriteEntryTo(output));
                }
            }
            else
            {
                foreach (var entry in archive.Entries.Where(e => !e.IsDirectory && e.Key is not null))
                {
                    Write(Normalize(entry.Key!), output =>
                    {
                        using var input = entry.OpenEntryStream();
                        input.CopyTo(output);
                    });
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new HelperException("ioFailed", $"Could not unpack into '{targetDir}': {e.Message}");
        }
        catch (Exception e) when (e is not HelperException)
        {
            throw new HelperException("badArchive", $"'{Path.GetFileName(path)}' could not be unpacked ({e.Message}). Download it again.");
        }

        var missing = wanted.Keys.Where(k => !found.Contains(k)).ToList();
        return new JsonObject
        {
            ["written"] = written,
            ["missing"] = new JsonArray(missing.Select(m => (JsonNode)m).ToArray())
        };
    }

    private static IArchive Open(string path)
    {
        if (!File.Exists(path)) throw new HelperException("notFound", $"No file at '{path}'.");
        try
        {
            return ArchiveFactory.OpenArchive(path);
        }
        catch (Exception e)
        {
            throw new HelperException("badArchive",
                $"'{Path.GetFileName(path)}' cannot be opened as a .7z, .zip or .rar ({e.Message}). Download it again, or unpack it by hand.");
        }
    }

    /// <summary>An entry's path with `/` between folders and no leading `./` or `/`.</summary>
    public static string Normalize(string key)
    {
        var path = key.Replace('\\', '/');
        while (path.StartsWith("./", StringComparison.Ordinal)) path = path[2..];
        return path.TrimStart('/');
    }

    /// <summary>`relative` under `root` — never outside it, whatever `..` an archive or installer names.</summary>
    private static string Inside(string root, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('\\', '/').TrimStart('/')));
        if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new HelperException("badRequest", $"'{relative}' leads outside the mod folder.");
        return full;
    }
}
