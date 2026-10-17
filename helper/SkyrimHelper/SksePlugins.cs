using System.Reflection.PortableExecutable;
using System.Text;
using System.Text.Json.Nodes;

namespace SkyrimHelper;

/// <summary>
/// What an SKSE plugin declares about the game it fits, read out of the DLL without loading it: its
/// machine and link time from the PE header, which of SKSEPlugin_Query, _Load and _Version it exports,
/// and SKSEPlugin_Version's data — the struct CommonLibSSE and SKSE's own headers define:
/// <code>
/// 0x000 dataVersion (1)   0x004 pluginVersion   0x008 name[256]   0x108 author[256]   0x208 supportEmail[252]
/// 0x304 versionIndependenceEx   0x308 versionIndependence   0x30C compatibleVersions[16]   0x34C seVersionRequired
/// </code>
/// The server judges it (src/backend/skyrim/sksePlugins.ts); the layout is the one Amethyst Mod Manager
/// reads (src/Utils/bethesda/skse_plugins.py).
/// </summary>
public static class SksePlugins
{
    private const int VersionDataSize = 0x350;
    private static readonly string[] Exports = ["SKSEPlugin_Query", "SKSEPlugin_Load", "SKSEPlugin_Version"];

    /// <summary>One entry per file: what it declares; `plugin: false` for a DLL that is no SKSE plugin; `error` for one that cannot be read.</summary>
    public static JsonNode Read(JsonObject p)
    {
        var files = p["files"]?.AsArray().Select(f => f!.GetValue<string>()).ToList()
            ?? throw new HelperException("badRequest", "sksePlugins needs 'files', a list of DLL paths.");
        var answers = new JsonArray();
        foreach (var file in files)
        {
            try
            {
                answers.Add(ReadOne(file));
            }
            catch (Exception e) when (e is IOException or BadImageFormatException or InvalidOperationException or ArgumentException or UnauthorizedAccessException)
            {
                answers.Add(new JsonObject { ["file"] = file, ["error"] = e.Message });
            }
        }
        return new JsonObject { ["plugins"] = answers };
    }

    private static JsonObject ReadOne(string file)
    {
        using var stream = File.OpenRead(file);
        using var pe = new PEReader(stream);
        var headers = pe.PEHeaders;
        var coff = headers.CoffHeader;
        var exports = ExportedFunctions(pe);
        var found = Exports.ToDictionary(name => name, name => exports.TryGetValue(name, out var rva) ? rva : 0);
        if (found.Values.All(rva => rva == 0)) return new JsonObject { ["file"] = file, ["plugin"] = false };

        var answer = new JsonObject
        {
            ["file"] = file,
            ["machine"] = (int)coff.Machine,
            ["timestamp"] = (long)(uint)coff.TimeDateStamp,
            ["query"] = found["SKSEPlugin_Query"] != 0,
            ["load"] = found["SKSEPlugin_Load"] != 0,
            ["version"] = found["SKSEPlugin_Version"] != 0
        };
        if (coff.Machine == Machine.Amd64 && found["SKSEPlugin_Version"] is var versionRva and not 0 && VersionData(pe, versionRva) is { } data)
            answer["data"] = data;
        return answer;
    }

    /// <summary>SKSEPlugin_Version's struct, when it is all in the file and says it is version 1 with a name.</summary>
    private static JsonObject? VersionData(PEReader pe, int rva)
    {
        var block = pe.GetSectionData(rva);
        if (block.Length < VersionDataSize) return null;
        var bytes = block.GetContent(0, VersionDataSize).ToArray();
        uint U32(int at) => BitConverter.ToUInt32(bytes, at);
        string Text(int at, int length)
        {
            var end = Array.IndexOf(bytes, (byte)0, at, length);
            return Encoding.UTF8.GetString(bytes, at, (end < 0 ? at + length : end) - at);
        }
        if (U32(0) != 1 || bytes[8] == 0) return null;
        var compatible = new JsonArray();
        for (var i = 0; i < 16 && U32(0x30C + i * 4) is var version and not 0; i++) compatible.Add((long)version);
        return new JsonObject
        {
            ["dataVersion"] = (long)U32(0),
            ["pluginVersion"] = (long)U32(4),
            ["name"] = Text(8, 256),
            ["author"] = Text(0x108, 256),
            ["independenceEx"] = (long)U32(0x304),
            ["independence"] = (long)U32(0x308),
            ["compatibleVersions"] = compatible,
            ["skseRequired"] = (long)U32(0x34C)
        };
    }

    /// <summary>The DLL's exported functions by name, each with its RVA; forwarders, which point back into the export table, left out.</summary>
    private static Dictionary<string, int> ExportedFunctions(PEReader pe)
    {
        var result = new Dictionary<string, int>(StringComparer.Ordinal);
        var directory = pe.PEHeaders.PEHeader?.ExportTableDirectory;
        if (directory is null || directory.Value.RelativeVirtualAddress == 0 || directory.Value.Size < 40) return result;
        var exportRva = directory.Value.RelativeVirtualAddress;
        var table = pe.GetSectionData(exportRva);
        if (table.Length < 40) return result;
        var header = table.GetContent(0, 40).ToArray();
        var functions = BitConverter.ToInt32(header, 20);
        var names = BitConverter.ToInt32(header, 24);
        if (names <= 0 || names > functions || functions > 65_536) return result;
        var functionRvas = Ints(pe, BitConverter.ToInt32(header, 28), functions, 4);
        var nameRvas = Ints(pe, BitConverter.ToInt32(header, 32), names, 4);
        var ordinals = Ints(pe, BitConverter.ToInt32(header, 36), names, 2);
        if (functionRvas is null || nameRvas is null || ordinals is null) return result;
        for (var i = 0; i < names; i++)
        {
            var name = NameAt(pe, nameRvas[i]);
            if (name is null || !Exports.Contains(name) || ordinals[i] >= functions) continue;
            var rva = functionRvas[ordinals[i]];
            if (rva != 0 && (rva < exportRva || rva >= exportRva + directory.Value.Size)) result[name] = rva;
        }
        return result;
    }

    /// <summary>`count` little-endian numbers of `size` bytes at an RVA, or null when the file does not hold them.</summary>
    private static int[]? Ints(PEReader pe, int rva, int count, int size)
    {
        var block = pe.GetSectionData(rva);
        if (block.Length < count * size) return null;
        var bytes = block.GetContent(0, count * size).ToArray();
        return Enumerable.Range(0, count).Select(i => size == 4 ? BitConverter.ToInt32(bytes, i * 4) : BitConverter.ToUInt16(bytes, i * 2)).ToArray();
    }

    private static string? NameAt(PEReader pe, int rva)
    {
        var block = pe.GetSectionData(rva);
        if (block.Length == 0) return null;
        var bytes = block.GetContent(0, Math.Min(block.Length, 128)).ToArray();
        var end = Array.IndexOf(bytes, (byte)0);
        return end < 0 ? null : Encoding.ASCII.GetString(bytes, 0, end);
    }
}
