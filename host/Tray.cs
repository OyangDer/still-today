using System;
using System.Collections.Generic;
using System.Windows.Forms;

namespace StillToday;

// Native HMENU (the .NET Framework ContextMenu), so Win11 draws it with the system's own rounded,
// theme-aware menu instead of a WinForms imitation.
internal sealed class Tray : IDisposable
{
    // Everything else lives in Settings.
    private static readonly string[] Layout = { "toggle", "settings", "-", "quit" };
    private readonly NotifyIcon _icon;
    private readonly Dictionary<string, MenuItem> _items = new();
    private string _tag;

    public Tray()
    {
        var menu = new ContextMenu();
        foreach (var key in Layout)
        {
            if (key == "-")
            {
                menu.MenuItems.Add("-");
                continue;
            }
            var item = new MenuItem(key) { Tag = key };
            item.Click += (_, _) => Action?.Invoke((string)item.Tag);
            menu.MenuItems.Add(item);
            _items[key] = item;
        }
        _items["toggle"].DefaultItem = true;
        _icon = new NotifyIcon { Icon = App.Icon, Text = "Still Today", ContextMenu = menu, Visible = true };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) Action?.Invoke("toggle");
        };
        _icon.BalloonTipClicked += (_, _) => NoticeClicked?.Invoke(_tag);
    }

    public event Action<string> Action;
    /// <summary>A notification was clicked; carries the tag the latest one was shown with.</summary>
    public event Action<string> NoticeClicked;

    public void Update(Dictionary<string, object> labels)
    {
        foreach (var pair in labels)
            if (_items.TryGetValue(pair.Key, out var item)) item.Text = (string)pair.Value;
    }

    // Windows shows a balloon as a toast. A click only says that a balloon was clicked, so the tag of
    // the latest one is what a click refers to.
    public void Notify(string title, string body, string tag)
    {
        _tag = tag;
        _icon.ShowBalloonTip(5000, title, body, ToolTipIcon.None);
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
