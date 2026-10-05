using System;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace StillToday;

internal static class App
{
    public static readonly Icon Icon = new(typeof(App).Assembly.GetManifestResourceStream("StillToday.ico"));

    // STILLTODAY_DEV_URL points the host at the Vite dev server instead of the bundled UI.
    public static readonly string DevUrl = Environment.GetEnvironmentVariable("STILLTODAY_DEV_URL");
    public static bool IsDev => DevUrl != null;
}

internal static class Program
{
    private static readonly int ShowMessage = Native.RegisterWindowMessage("StillToday.Show");

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, @"Local\StillToday.App", out var first);
        if (!first)
        {
            // This launch came from the user, so it may bring a window forward; it hands that on.
            Native.AllowSetForegroundWindow(Native.ASFW_ANY);
            Native.PostMessage(Native.HWND_BROADCAST, ShowMessage, IntPtr.Zero, IntPtr.Zero);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StillToday");
        Directory.CreateDirectory(dataDir);

        using var tray = new Tray();
        using var form = new WidgetForm(dataDir);
        var bridge = new Bridge(form, tray, dataDir);
        var doorbell = new Doorbell(ShowMessage);
        doorbell.Rung += () =>
        {
            form.Present();
            bridge.Emit("shown");
        };
        tray.NoticeClicked += tag =>
        {
            form.Present();
            bridge.Emit("shown");
            bridge.Emit("notice", tag);
        };
        tray.Action += action =>
        {
            if (action == "toggle")
            {
                if (form.Visible) form.HideWidget();
                else form.ShowWidget();
                bridge.Emit(form.Visible ? "shown" : "hidden");
                return;
            }
            if (action == "quit")
            {
                Application.Exit();
                return;
            }
            if (action == "settings")
            {
                form.Present();
                bridge.Emit("shown");
            }
            bridge.Emit("tray", action);
        };
        SystemEvents.PowerModeChanged += (_, e) =>
        {
            if (e.Mode == PowerModes.Resume) form.BeginInvoke(new Action(() => bridge.Emit("wake")));
        };

        var uiFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui");
        Start(form, uiFolder);
        Application.Run(form);
        bridge.Flush();
        // Nothing else holds the doorbell, and a collected NativeWindow stops hearing its messages.
        GC.KeepAlive(doorbell);
    }

    /// <summary>
    /// Hears a second launch. The widget cannot: it is an owned window, which keeps it off the
    /// taskbar, and a broadcast skips owned windows while they are hidden.
    /// </summary>
    private sealed class Doorbell : NativeWindow
    {
        private readonly int _message;

        public Doorbell(int message)
        {
            _message = message;
            CreateHandle(new CreateParams());
        }

        public event Action Rung;

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == _message) Rung?.Invoke();
            base.WndProc(ref m);
        }
    }

    // Runs its first await inside Application.Run's message loop, which WebView2 requires.
    private static async void Start(WidgetForm form, string uiFolder)
    {
        try
        {
            await form.InitializeAsync(App.DevUrl ?? "https://app.stilltoday/", App.IsDev ? null : uiFolder);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Still Today needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11.",
                "Still Today", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
        }
    }
}
