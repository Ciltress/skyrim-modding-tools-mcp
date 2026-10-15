using System.Reflection.PortableExecutable;
using System.Text;

namespace SkyrimHelper;

/// <summary>
/// The version of a Windows executable, read from its version resource. FileVersionInfo does this on
/// Windows only — on Linux it reads managed assemblies and returns 0.0.0.0 for the game's exe — so the
/// helper reads the resource itself, the same way on both systems (docs/adr/0007).
/// </summary>
public static class PeVersion
{
    private const int RtVersion = 16;
    private const uint FixedSignature = 0xFEEF04BD;

    /// <summary>"1.7.104.0", or null when the file carries no version.</summary>
    public static string? Read(string exePath)
    {
        using var stream = File.OpenRead(exePath);
        using var pe = new PEReader(stream);
        var directory = pe.PEHeaders.PEHeader?.ResourceTableDirectory;
        if (directory is null || directory.Value.Size == 0) return null;
        // Offsets inside the resource tree count from its start; its leaves hold RVAs.
        var section = pe.GetSectionData(directory.Value.RelativeVirtualAddress);
        if (section.Length == 0) return null;
        var resources = section.GetContent().ToArray();

        // Resource tree: type (RT_VERSION) -> name (the first) -> language (the first) -> data entry.
        var names = FindEntry(resources, 0, id: RtVersion);
        if (names is null) return null;
        var languages = FirstEntry(resources, names.Value);
        var data = languages is null ? null : FirstEntry(resources, languages.Value);
        if (data is null) return null;
        var dataRva = BitConverter.ToInt32(resources, data.Value);
        var size = BitConverter.ToInt32(resources, data.Value + 4);
        var block = pe.GetSectionData(dataRva).GetContent(0, size);
        return Parse(block.ToArray());
    }

    /// <summary>
    /// A VS_VERSIONINFO block: the StringFileInfo "FileVersion" when it is a version, else the fixed
    /// numbers — older Skyrim executables leave those at 1.0.0.0.
    /// </summary>
    public static string? Parse(byte[] info)
    {
        string? fixedVersion = null;
        string? fileVersion = null;
        Walk(info, 0, info.Length, (key, value, valueLength, isText) =>
        {
            if (key == "VS_VERSION_INFO" && valueLength >= 52 && BitConverter.ToUInt32(info, value) == FixedSignature)
            {
                var ms = BitConverter.ToUInt32(info, value + 8);
                var ls = BitConverter.ToUInt32(info, value + 12);
                fixedVersion = $"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}";
            }
            else if (key == "FileVersion" && isText && valueLength > 0)
            {
                var text = Encoding.Unicode.GetString(info, value, valueLength * 2).TrimEnd('\0');
                var parts = text.Split([',', '.'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length is >= 2 and <= 4 && parts.All(p => p.All(char.IsAsciiDigit)))
                    fileVersion = string.Join('.', parts.Concat(Enumerable.Repeat("0", 4 - parts.Length)));
            }
        });
        return fileVersion ?? fixedVersion;
    }

    /// <summary>Visits every block — wLength, wValueLength, wType, a UTF-16 key, its value, its children.</summary>
    private static void Walk(byte[] info, int start, int end, Action<string, int, int, bool> visit)
    {
        var at = start;
        while (at + 6 <= end)
        {
            int length = BitConverter.ToUInt16(info, at);
            if (length == 0) break;
            int valueLength = BitConverter.ToUInt16(info, at + 2);
            var isText = BitConverter.ToUInt16(info, at + 4) == 1;
            var keyEnd = at + 6;
            while (keyEnd + 1 < at + length && (info[keyEnd] != 0 || info[keyEnd + 1] != 0)) keyEnd += 2;
            var key = Encoding.Unicode.GetString(info, at + 6, keyEnd - (at + 6));
            var value = Align(keyEnd + 2);
            // A text value's length counts UTF-16 characters, a binary one's bytes.
            var valueBytes = isText ? valueLength * 2 : valueLength;
            visit(key, value, valueLength, isText);
            var children = Align(value + valueBytes);
            if (children < at + length) Walk(info, children, Math.Min(at + length, end), visit);
            at = Align(at + length);
        }
    }

    private static int Align(int offset) => (offset + 3) & ~3;

    /// <summary>The offset of the directory or data an entry with this id points at.</summary>
    private static int? FindEntry(byte[] resources, int directory, int id)
    {
        int named = BitConverter.ToUInt16(resources, directory + 12);
        int ids = BitConverter.ToUInt16(resources, directory + 14);
        for (var i = 0; i < named + ids; i++)
        {
            var entry = directory + 16 + i * 8;
            var name = BitConverter.ToUInt32(resources, entry);
            if ((name & 0x80000000) == 0 && name == id) return Target(resources, entry);
        }
        return null;
    }

    private static int? FirstEntry(byte[] resources, int directory)
    {
        int count = BitConverter.ToUInt16(resources, directory + 12) + BitConverter.ToUInt16(resources, directory + 14);
        return count == 0 ? null : Target(resources, directory + 16);
    }

    private static int Target(byte[] resources, int entry) =>
        (int)(BitConverter.ToUInt32(resources, entry + 4) & 0x7FFFFFFF);
}
