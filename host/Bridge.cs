using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Media;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace StillToday;

// The page's only way out of its sandbox. Every call is {id, m, p}; every reply is {id, ok, r|e}.
// Host-initiated notifications are {ev, d}.
internal sealed class Bridge
{
    public const string CanvasTarget = "StillToday/Canvas";
    public static string FeedTarget(string id) => "StillToday/Feed/" + id;
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "StillToday";

    private readonly JavaScriptSerializer _json = new() { MaxJsonLength = int.MaxValue };
    private readonly WidgetForm _form;
    private readonly Tray _tray;
    private readonly string _dataPath;
    // The Canvas profile picture as a data: URL, kept so Settings shows it offline.
    private readonly string _avatarPath;
    private readonly Aura _aura = new();
    private System.Threading.Timer _alarm;
    private bool _glass = true;
    // Saves wait for the disk, so they run off the UI thread, one after another in the order sent.
    private Task _saving = Task.CompletedTask;

    public Bridge(WidgetForm form, Tray tray, string dataDir)
    {
        _form = form;
        _tray = tray;
        _dataPath = Path.Combine(dataDir, "data.json");
        _avatarPath = Path.Combine(dataDir, "avatar.txt");
        form.WebMessage += OnMessage;
        form.Moved += SendAura;
        form.GlassChanged += () =>
        {
            if (form.Glass == _glass) return;
            _glass = form.Glass;
            Emit("glass", _glass);
        };
    }

    public void Emit(string name, object data = null) =>
        _form.Web?.PostWebMessageAsJson(_json.Serialize(new Dictionary<string, object> { ["ev"] = name, ["d"] = data }));

    /// <summary>Waits for saves still on their way to the disk, so quitting never cuts one off.</summary>
    public void Flush() => _saving.ContinueWith(_ => { }, TaskScheduler.Default).Wait(TimeSpan.FromSeconds(5));

    private async void OnMessage(string json)
    {
        var message = _json.Deserialize<Dictionary<string, object>>(json);
        var id = message["id"];
        var method = (string)message["m"];
        var p = message.TryGetValue("p", out var raw) ? raw as Dictionary<string, object> : null;
        Dictionary<string, object> reply;
        try
        {
            reply = new Dictionary<string, object> { ["id"] = id, ["ok"] = true, ["r"] = await Invoke(method, p ?? new()) };
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            reply = new Dictionary<string, object> { ["id"] = id, ["ok"] = false, ["e"] = exception.GetType().Name };
        }
        _form.Web?.PostWebMessageAsJson(_json.Serialize(reply));
    }

    private async Task<object> Invoke(string method, Dictionary<string, object> p)
    {
        switch (method)
        {
            case "boot":
                return new Dictionary<string, object>
                {
                    ["version"] = Application.ProductVersion,
                    ["locale"] = CultureInfo.CurrentUICulture.Name,
                    ["data"] = Store.ReadOrNull(_dataPath),
                    ["backup"] = Store.ReadOrNull(BackupPath),
                    ["legacy"] = File.Exists(Legacy.DatabasePath),
                    ["autostart"] = AutoStart,
                    ["canvasHost"] = CanvasHost(),
                    ["canvasAvatar"] = Store.ReadOrNull(_avatarPath),
                    ["glass"] = _glass = _form.Glass,
                };
            case "drag":
                _form.BeginDrag();
                return null;
            case "ready":
                _form.Reveal(Int(p, "width"), Int(p, "height"));
                SendAura();
                return null;
            case "save":
                var data = (string)p["data"];
                _saving = _saving.ContinueWith(_ => Store.WriteAtomic(_dataPath, data, BackupPath), TaskScheduler.Default);
                await _saving;
                return null;
            case "morph":
                _form.Morph(Int(p, "width"), Int(p, "height"), Convert.ToDouble(p["start"], CultureInfo.InvariantCulture), Int(p, "ms"));
                return null;
            case "material":
                _form.SetMaterial((bool)p["aura"], (bool)p["dark"]);
                return null;
            case "topmost":
                _form.SetTopmost((bool)p["on"]);
                return null;
            case "autostart":
                AutoStart = (bool)p["on"];
                return AutoStart;
            case "hide":
                _form.HideWidget();
                Emit("hidden");
                return null;
            case "quit":
                Application.Exit();
                return null;
            case "open":
                OpenExternal((string)p["url"]);
                return null;
            case "tray":
                _tray.Update((Dictionary<string, object>)p["labels"]);
                return null;
            case "legacy":
                return Legacy.Read();
            case "alarm":
                SetAlarm(p.TryGetValue("at", out var at) && at != null ? Convert.ToInt64(at) : null, p);
                return null;
            case "notify":
                _tray.Notify((string)p["title"], (string)p["body"], (string)p["tag"]);
                return null;
            case "chime":
                PlayChime();
                return null;
            case "canvas.connect":
                return await CanvasConnect((string)p["host"], (string)p["token"]);
            case "canvas.get":
                return await CanvasGet((string)p["path"]);
            case "canvas.schools":
                return Result(await Http.SchoolSearch((string)p["name"]));
            case "canvas.avatar":
                return await CanvasAvatar(p["url"] as string);
            case "canvas.disconnect":
                Secrets.Delete(CanvasTarget);
                File.Delete(_avatarPath);
                return null;
            case "feed.add":
                return await FeedAdd((string)p["url"]);
            case "feed.get":
                return await FeedGet((string)p["id"]);
            case "feed.remove":
                Secrets.Delete(FeedTarget((string)p["id"]));
                return null;
            default:
                throw new MissingMethodException(method);
        }
    }

    // The version each save replaced: what the page opens on should the latest be unreadable.
    private string BackupPath => _dataPath + ".bak";

    private static int Int(Dictionary<string, object> p, string key) => Convert.ToInt32(p[key], CultureInfo.InvariantCulture);

    private static Dictionary<string, object> Result(HttpResult result) => new()
    {
        ["status"] = result.Status,
        ["body"] = result.Body,
        ["next"] = result.Next,
    };

    private static string CanvasHost()
    {
        Secrets.Read(CanvasTarget, out var host);
        return host;
    }

    // The token is verified against /users/self before it is stored, and afterwards every Canvas
    // request goes to the host saved beside it: the page can choose the path, never the host.
    private static async Task<object> CanvasConnect(string host, string token)
    {
        var root = ValidHost(host);
        if (root == null) return new Dictionary<string, object> { ["status"] = -3 };
        var result = await Http.CanvasGet(new Uri(root, "/api/v1/users/self"), token.Trim());
        if (result.Status == 200) Secrets.Write(CanvasTarget, root.Host, token.Trim());
        return Result(result);
    }

    private static async Task<object> CanvasGet(string path)
    {
        var token = Secrets.Read(CanvasTarget, out var host);
        if (token == null) return new Dictionary<string, object> { ["status"] = 401 };
        if (!path.StartsWith("/api/v1/", StringComparison.Ordinal)) throw new ArgumentException("path");
        return Result(await Http.CanvasGet(new Uri(new Uri("https://" + host), path), token));
    }

    // The picture is fetched without the token: Canvas redirects it to its file store with a signed
    // link. No picture clears the cache; a failed download keeps the last one.
    private async Task<string> CanvasAvatar(string url)
    {
        if (url == null)
        {
            File.Delete(_avatarPath);
            return null;
        }
        Secrets.Read(CanvasTarget, out var host);
        if (host == null || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps
            || !uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("url");
        var avatar = await Http.ImageGet(uri);
        if (avatar == null) return Store.ReadOrNull(_avatarPath);
        Store.WriteAtomic(_avatarPath, avatar);
        return avatar;
    }

    private static Uri ValidHost(string host)
    {
        if (string.IsNullOrWhiteSpace(host)) return null;
        return Uri.TryCreate("https://" + host.Trim(), UriKind.Absolute, out var uri) && uri.PathAndQuery == "/" && uri.IsDefaultPort
            ? uri
            : null;
    }

    private static async Task<object> FeedAdd(string url)
    {
        if (!Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var uri)) return new Dictionary<string, object> { ["status"] = -3 };
        if (uri.Scheme == "webcal") uri = new UriBuilder(uri) { Scheme = "https", Port = -1 }.Uri;
        if (uri.Scheme != Uri.UriSchemeHttps) return new Dictionary<string, object> { ["status"] = -4 };
        // Windows keeps at most 2,560 bytes of secret: 1,280 characters of link.
        if (uri.AbsoluteUri.Length > 1280) return new Dictionary<string, object> { ["status"] = -6 };
        var result = await Http.FeedGet(uri);
        var reply = Result(result);
        if (result.Status == 200 && result.Body != null && result.Body.IndexOf("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            var id = Guid.NewGuid().ToString("N");
            Secrets.Write(FeedTarget(id), "feed", uri.AbsoluteUri);
            reply["id"] = id;
            reply["host"] = uri.Host;
        }
        return reply;
    }

    private static async Task<object> FeedGet(string id)
    {
        var url = Secrets.Read(FeedTarget(id));
        if (url == null) return new Dictionary<string, object> { ["status"] = -5 };
        return Result(await Http.FeedGet(new Uri(url)));
    }

    // Web pages, and email addresses for the mail app. A mail link goes out as the bare address:
    // some mail apps act on fields such as attach= in the rest of it.
    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        string target;
        if (uri.Scheme == Uri.UriSchemeHttps) target = uri.AbsoluteUri;
        else if (uri.Scheme == Uri.UriSchemeMailto && uri.UserInfo.Length > 0 && uri.Host.Length > 0) target = $"mailto:{uri.UserInfo}@{uri.Host}";
        else return;
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }

    private static bool AutoStart
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(RunValue) is string;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue(RunValue, $"\"{Application.ExecutablePath}\" --autostart");
            else key.DeleteValue(RunValue, false);
        }
    }

    // The focus timer's end is kept here, not in the page: a hidden WebView throttles its timers,
    // and the chime has to land on the second.
    private void SetAlarm(long? atUnixMs, Dictionary<string, object> p)
    {
        _alarm?.Dispose();
        _alarm = null;
        if (atUnixMs is not long at) return;
        var title = p.TryGetValue("title", out var t) ? t as string : null;
        var body = p.TryGetValue("body", out var b) ? b as string : null;
        var due = TimeSpan.FromMilliseconds(Math.Max(0, at - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        _alarm = new System.Threading.Timer(_ => _form.BeginInvoke(new Action(() =>
        {
            PlayChime();
            if (!_form.Visible && title != null) _tray.Notify(title, body, "focus");
            Emit("alarm");
        })), null, due, Timeout.InfiniteTimeSpan);
    }

    private static void PlayChime()
    {
        var stream = typeof(Bridge).Assembly.GetManifestResourceStream("Chime.wav");
        var player = new SoundPlayer(stream);
        player.Play();
    }

    private async void SendAura()
    {
        var rect = _form.Info().Rect;
        var sample = await Task.Run(() => _aura.Sample(rect));
        if (sample == null) return;
        Emit("aura", new Dictionary<string, object>
        {
            ["average"] = sample.Average,
            ["darkest"] = sample.Darkest,
            ["brightest"] = sample.Brightest,
        });
    }
}
