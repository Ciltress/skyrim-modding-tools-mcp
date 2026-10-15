using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace SkyrimHelper;

/// <summary>
/// A FOMOD installer's `fomod/ModuleConfig.xml` (schema 5.0, which reads the older ones too) as data:
/// its steps, groups and options, the flags options set, the conditions that show a step or change an
/// option's type, and the files each part installs. Nothing is evaluated here — the server does that,
/// knowing the load order and the choices made.
/// </summary>
/// <remarks>
/// Installers are often written by hand, so names are matched without regard to case, an attribute
/// the schema gives a default is answered as absent (null) rather than guessed, and a declared
/// encoding the bytes do not match is forgiven.
/// </remarks>
public static class Fomod
{
    public static JsonObject Parse(byte[] bytes)
    {
        var root = Load(bytes).Root ?? throw new HelperException("badArchive", "The FOMOD installer's ModuleConfig.xml is empty.");
        var steps = Child(root, "installSteps");
        return new JsonObject
        {
            ["moduleName"] = Child(root, "moduleName")?.Value.Trim() ?? "",
            ["dependencies"] = Composite(Child(root, "moduleDependencies")),
            ["requiredFiles"] = Files(Child(root, "requiredInstallFiles")),
            ["stepOrder"] = Attr(steps, "order"),
            ["steps"] = new JsonArray(Children(steps, "installStep").Select(Step).ToArray<JsonNode?>()),
            ["conditionalFiles"] = new JsonArray(Children(Child(Child(root, "conditionalFileInstalls"), "patterns"), "pattern")
                .Select(pattern => (JsonNode)new JsonObject
                {
                    ["when"] = Composite(Child(pattern, "dependencies")),
                    ["files"] = Files(Child(pattern, "files"))
                }).ToArray())
        };
    }

    private static JsonNode Step(XElement step)
    {
        var groups = Child(step, "optionalFileGroups");
        return new JsonObject
        {
            ["name"] = Attr(step, "name") ?? "",
            ["visible"] = Composite(Child(step, "visible")),
            ["groupOrder"] = Attr(groups, "order"),
            ["groups"] = new JsonArray(Children(groups, "group").Select(Group).ToArray<JsonNode?>())
        };
    }

    private static JsonNode Group(XElement group)
    {
        var options = Child(group, "plugins");
        return new JsonObject
        {
            ["name"] = Attr(group, "name") ?? "",
            ["type"] = Attr(group, "type") ?? "SelectAny",
            ["order"] = Attr(options, "order"),
            ["options"] = new JsonArray(Children(options, "plugin").Select(Option).ToArray<JsonNode?>())
        };
    }

    private static JsonNode Option(XElement option) => new JsonObject
    {
        ["name"] = Attr(option, "name") ?? "",
        ["description"] = Child(option, "description")?.Value.Trim() ?? "",
        ["files"] = Files(Child(option, "files")),
        ["flags"] = new JsonArray(Children(Child(option, "conditionFlags"), "flag")
            .Select(flag => (JsonNode)new JsonObject { ["name"] = Attr(flag, "name") ?? "", ["value"] = flag.Value.Trim() })
            .ToArray()),
        ["type"] = TypeDescriptor(Child(option, "typeDescriptor"))
    };

    /// <summary>`&lt;type name="…"/&gt;`, or a default type with patterns that change it under conditions.</summary>
    private static JsonObject TypeDescriptor(XElement? descriptor)
    {
        if (Child(descriptor, "type") is { } fixedType) return new JsonObject { ["default"] = Attr(fixedType, "name") ?? "Optional" };
        var dependent = Child(descriptor, "dependencyType");
        return new JsonObject
        {
            ["default"] = Attr(Child(dependent, "defaultType"), "name") ?? "Optional",
            ["patterns"] = new JsonArray(Children(Child(dependent, "patterns"), "pattern")
                .Select(pattern => (JsonNode)new JsonObject
                {
                    ["when"] = Composite(Child(pattern, "dependencies")),
                    ["type"] = Attr(Child(pattern, "type"), "name") ?? "Optional"
                }).ToArray())
        };
    }

    /// <summary>`destination` stays null when absent: the schema then means the source's own path, which differs from "".</summary>
    private static JsonArray Files(XElement? list) => new(
        (list?.Elements() ?? [])
            .Where(e => Is(e, "file") || Is(e, "folder"))
            .Select(e => (JsonNode)new JsonObject
            {
                ["source"] = Attr(e, "source") ?? "",
                ["destination"] = Attr(e, "destination"),
                ["folder"] = Is(e, "folder"),
                ["priority"] = int.TryParse(Attr(e, "priority"), out var priority) ? priority : 0,
                ["alwaysInstall"] = IsTrue(Attr(e, "alwaysInstall")),
                ["installIfUsable"] = IsTrue(Attr(e, "installIfUsable"))
            }).ToArray());

    /// <summary>
    /// A composite dependency: an operator over file, flag, game, FOMM and script extender conditions,
    /// and nested composites. A step's `visible` holds the conditions directly in some installers and a
    /// `dependencies` element in others; both read the same.
    /// </summary>
    private static JsonObject? Composite(XElement? element)
    {
        if (element is null) return null;
        var conditions = new JsonArray();
        foreach (var condition in element.Elements())
        {
            JsonNode? item = condition.Name.LocalName.ToLowerInvariant() switch
            {
                "filedependency" => new JsonObject { ["file"] = Attr(condition, "file") ?? "", ["state"] = Attr(condition, "state") ?? "Active" },
                "flagdependency" => new JsonObject { ["flag"] = Attr(condition, "flag") ?? "", ["value"] = Attr(condition, "value") ?? "" },
                "gamedependency" => new JsonObject { ["game"] = Attr(condition, "version") ?? "" },
                "fommdependency" => new JsonObject { ["fomm"] = Attr(condition, "version") ?? "" },
                "fosedependency" => new JsonObject { ["scriptExtender"] = Attr(condition, "version") ?? "" },
                "dependencies" => Composite(condition),
                _ => null
            };
            if (item is not null) conditions.Add(item);
        }
        return new JsonObject { ["operator"] = Attr(element, "operator") ?? "And", ["conditions"] = conditions };
    }

    private static XDocument Load(byte[] bytes)
    {
        try
        {
            using var stream = new MemoryStream(bytes);
            return XDocument.Load(stream);
        }
        catch (XmlException)
        {
            // Saved as UTF-8 but declared UTF-16, or the other way round: read the bytes as their BOM
            // says — UTF-8 without one — and drop the declaration that disagrees.
            using var reader = new StreamReader(new MemoryStream(bytes), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            var text = Regex.Replace(reader.ReadToEnd(), @"^\s*<\?xml[^>]*\?>", "");
            try
            {
                return XDocument.Parse(text);
            }
            catch (XmlException e)
            {
                throw new HelperException("badArchive",
                    $"The FOMOD installer's ModuleConfig.xml cannot be read ({e.Message}). Install one folder of the file as it is, with `root`.");
            }
        }
    }

    private static bool Is(XElement element, string name) => element.Name.LocalName.Equals(name, StringComparison.OrdinalIgnoreCase);

    private static XElement? Child(XElement? parent, string name) => parent?.Elements().FirstOrDefault(e => Is(e, name));

    private static IEnumerable<XElement> Children(XElement? parent, string name) => parent?.Elements().Where(e => Is(e, name)) ?? [];

    private static string? Attr(XElement? element, string name) =>
        element?.Attributes().FirstOrDefault(a => a.Name.LocalName.Equals(name, StringComparison.OrdinalIgnoreCase))?.Value;

    private static bool IsTrue(string? value) => value is not null && (value.Trim().Equals("true", StringComparison.OrdinalIgnoreCase) || value.Trim() == "1");
}
