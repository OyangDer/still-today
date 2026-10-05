using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;

namespace StillToday;

internal sealed record HttpResult(int Status, string Body, string Next);

// Bounded GETs on behalf of the page. The page cannot reach Canvas or a feed directly (CORS, and it
// must never hold the secrets), so it asks the host, which attaches the credential itself.
internal static class Http
{
    private const int Limit = 8 * 1024 * 1024;
    private const string Agent = "StillToday/0.2 (Windows; +calendar)";

    // Canvas never redirects its API; refusing redirects keeps the bearer token on its own host.
    private static readonly HttpClient Api = Create(allowRedirect: false);
    // Requests without a credential (feeds, the profile picture) may follow redirects.
    private static readonly HttpClient Plain = Create(allowRedirect: true);

    private static HttpClient Create(bool allowRedirect)
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = allowRedirect,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseCookies = false,
        };
        var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(Agent);
        return client;
    }

    public static Task<HttpResult> CanvasGet(Uri uri, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.ParseAdd("application/json");
        return Send(Api, request, uri);
    }

    // Instructure's public directory of Canvas schools, the one its own apps search at sign-in.
    // It matches the name as one piece of text and needs no credential.
    public static Task<HttpResult> SchoolSearch(string name)
    {
        var uri = new Uri("https://canvas.instructure.com/api/v1/accounts/search?per_page=50&name=" + Uri.EscapeDataString(name));
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.ParseAdd("application/json");
        return Send(Api, request, uri);
    }

    public static Task<HttpResult> FeedGet(Uri uri)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.ParseAdd("text/calendar, text/plain;q=0.8, */*;q=0.5");
        return Send(Plain, request, uri);
    }

    /// <summary>An image as a data: URL, the only kind the page's CSP lets it show; null when none arrives.</summary>
    public static async Task<string> ImageGet(Uri uri)
    {
        try
        {
            using var response = await Plain.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            var type = response.Content.Headers.ContentType?.MediaType;
            if (!response.IsSuccessStatusCode || type == null || !type.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) return null;
            var bytes = await ReadBounded(response.Content).ConfigureAwait(false);
            return bytes == null ? null : $"data:{type};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or IOException or WebException)
        {
            return null;
        }
    }

    private static async Task<HttpResult> Send(HttpClient client, HttpRequestMessage request, Uri origin)
    {
        using (request)
        {
            try
            {
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                var status = (int)response.StatusCode;
                if (!response.IsSuccessStatusCode) return new HttpResult(status, null, null);
                var bytes = await ReadBounded(response.Content).ConfigureAwait(false);
                if (bytes == null) return new HttpResult(-2, null, null);
                return new HttpResult(status, Encoding.UTF8.GetString(bytes), NextPage(response, origin));
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or IOException or WebException)
            {
                // Exception text can echo the request URI, which may carry a secret; report only a code.
                return new HttpResult(-1, null, null);
            }
        }
    }

    // The body, or null past the size limit.
    private static async Task<byte[]> ReadBounded(HttpContent content)
    {
        using var stream = await content.ReadAsStreamAsync().ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, 0, chunk.Length).ConfigureAwait(false)) > 0)
        {
            if (buffer.Length + read > Limit) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    // Canvas paginates with Link headers. Only a same-host https "next" link is followed.
    private static string NextPage(HttpResponseMessage response, Uri origin)
    {
        if (!response.Headers.TryGetValues("Link", out var values)) return null;
        foreach (var part in values.SelectMany(v => v.Split(',')))
        {
            if (part.IndexOf("rel=\"next\"", StringComparison.OrdinalIgnoreCase) < 0) continue;
            var start = part.IndexOf('<');
            var end = part.IndexOf('>');
            if (start < 0 || end <= start + 1) return null;
            if (!Uri.TryCreate(origin, part.Substring(start + 1, end - start - 1), out var next)) return null;
            if (next.Scheme != Uri.UriSchemeHttps || !next.Host.Equals(origin.Host, StringComparison.OrdinalIgnoreCase)) return null;
            return next.PathAndQuery;
        }
        return null;
    }
}
