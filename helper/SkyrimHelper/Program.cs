// SkyrimHelper — the plugin engine behind skyrim-modding-tools-mcp (docs/adr/0003).
//
// Protocol: one JSON object per line on stdin, one answer per line on stdout, in order.
//   request   {"id": 1, "method": "findRecords", "params": {...}}
//   answer    {"id": 1, "result": {...}}  or  {"id": 1, "error": {"code": "notFound", "message": "..."}}
// Everything else goes to stderr: stdout carries answers only, and anything else written there would
// corrupt the stream the server reads.
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SkyrimHelper;

var answers = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
// A library that prints would otherwise write into the answer stream.
Console.SetOut(Console.Error);

var requests = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
using var session = new Session();

while (await requests.ReadLineAsync() is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    JsonNode? id = null;
    JsonObject answer;
    try
    {
        var request = JsonNode.Parse(line)?.AsObject()
            ?? throw new HelperException("badRequest", "A request must be a JSON object.");
        id = request["id"]?.DeepClone();
        var method = request["method"]?.GetValue<string>()
            ?? throw new HelperException("badRequest", "A request needs a 'method'.");
        var parameters = request["params"] as JsonObject ?? new JsonObject();

        var result = await session.Dispatch(method, parameters);
        answer = new JsonObject { ["id"] = id, ["result"] = result };
    }
    catch (HelperException e)
    {
        answer = Failure(id, e.Code, e.Message);
    }
    catch (Exception e)
    {
        Console.Error.WriteLine(e);
        answer = Failure(id, "internal", $"{e.GetType().Name}: {e.Message}");
    }

    await answers.WriteLineAsync(answer.ToJsonString());
}

static JsonObject Failure(JsonNode? id, string code, string message) =>
    new() { ["id"] = id, ["error"] = new JsonObject { ["code"] = code, ["message"] = message } };

namespace SkyrimHelper
{
    /// <summary>A failure the caller can act on; `code` is stable, `message` says what to do.</summary>
    public sealed class HelperException(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }
}
