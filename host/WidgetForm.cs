using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace StillToday;

// The widget window. The page is laid out once at the largest size and never resized; the window
// only clips it. A morph therefore moves window edges once per vsync while Chromium does no layout,
// and the page moves its own chrome on the same timeline, which keeps the morph smooth at any
// refresh rate.
internal sealed class WidgetForm : Form
{
    // Keep in step with EXPANDED in ui/src/App.svelte.
    public const int MaxWidth96 = 440;
    public const int MaxHeight96 = 600;
    // The desktop grid a dropped widget settles onto, as in the WPF release.
    private const int Margin96 = 20;
    private const int Step96 = 24;
    private const int GlideMs = 300;

    private readonly string _dataDir;
    private readonly Placement _placement;
    private CoreWebView2Controller _controller;
    private (int Width, int Height) _size96 = (360, 320);
    // The user's chosen top-left corner. Larger states grow from it and are only pushed back inside
    // the work area when they would not fit; returning to the compact size returns here.
    private System.Drawing.Point _home;
    private bool _topmost;
    private bool _presented;
    private bool _placed;
    private int _animation;
    private bool _dragging;
    private int _energySaver;
    private int _batterySaver;

    public WidgetForm(string dataDir)
    {
        _dataDir = dataDir;
        _placement = Placement.Load(dataDir);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Text = "Still Today";
        Icon = App.Icon;
    }

    public event Action<string> WebMessage;
    public event Action Moved;
    /// <summary>Whether DWM blurs behind the window changed; see <see cref="Glass"/>.</summary>
    public event Action GlassChanged;
    public CoreWebView2 Web => _controller?.CoreWebView2;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            // A caption lets DWM give the window Win11's rounded corners and native shadow;
            // WM_NCCALCSIZE then removes the whole non-client area. No thick frame: that would let
            // Windows resize the widget and snap it to half the screen when dragged to an edge.
            var p = base.CreateParams;
            p.Style |= Native.WS_CAPTION;
            p.Style &= ~(Native.WS_MAXIMIZEBOX | Native.WS_MINIMIZEBOX | Native.WS_SYSMENU);
            // No GDI surface: the WebView covers the whole client area, and without one a resize
            // costs DWM no surface reallocation, so the morph keeps up with high refresh rates.
            p.ExStyle |= Native.WS_EX_NOREDIRECTIONBITMAP;
            return p;
        }
    }

    // Shown only after the page has painted its first frame, so startup never flashes a blank card.
    protected override void SetVisibleCore(bool value) => base.SetVisibleCore(value && _controller != null && _ready);

    private bool _ready;

    public async Task InitializeAsync(string uiUrl, string uiFolder)
    {
        var dpi = DpiForPoint(_placement.X, _placement.Y);
        var rect = InitialRect(dpi);
        Native.SetWindowPos(Handle, Native.HWND_BOTTOM, rect.Left, rect.Top, rect.Width, rect.Height, Native.SWP_NOACTIVATE);
        _home = new System.Drawing.Point(rect.Left, rect.Top);
        ApplyFrame();
        // Windows answers each registration with the current value at once.
        var saver = Native.GUID_ENERGY_SAVER_STATUS;
        Native.RegisterPowerSettingNotification(Handle, ref saver, 0);
        var battery = Native.GUID_POWER_SAVING_STATUS;
        Native.RegisterPowerSettingNotification(Handle, ref battery, 0);

        var options = new CoreWebView2EnvironmentOptions { AreBrowserExtensionsEnabled = false };
        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_dataDir, "WebView2"), options);
        _controller = await env.CreateCoreWebView2ControllerAsync(Handle);
        _controller.DefaultBackgroundColor = Color.Transparent;
        // The host sets the scale itself, in the same step as the bounds, so a monitor change never
        // leaves the page laid out for one DPI inside a window sized for another.
        _controller.ShouldDetectMonitorScaleChanges = false;
        UpdateBounds(Dpi);

        var web = _controller.CoreWebView2;
        var settings = web.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = App.IsDev;
        settings.AreDevToolsEnabled = App.IsDev;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        web.NewWindowRequested += (_, e) => e.Handled = true;
        web.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(uiUrl, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };
        web.WebMessageReceived += (_, e) => WebMessage?.Invoke(e.WebMessageAsJson);
        if (uiFolder != null)
            web.SetVirtualHostNameToFolderMapping("app.stilltoday", uiFolder, CoreWebView2HostResourceAccessKind.Deny);
        web.Navigate(uiUrl + "index.html");
    }

    /// <summary>The page calls this once it has laid out its first view.</summary>
    public void Reveal(int width96, int height96)
    {
        _size96 = Clamp(width96, height96);
        var target = TargetRect(_size96);
        Native.SetWindowPos(Handle, IntPtr.Zero, target.Left, target.Top, target.Width, target.Height, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
        _ready = true;
        _placed = true;
        ShowWidget();
    }

    public void ShowWidget()
    {
        if (!_ready) return;
        Visible = true;
        Native.SetWindowPos(Handle, _topmost ? Native.HWND_TOPMOST : Native.HWND_BOTTOM, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        if (_controller != null) _controller.IsVisible = true;
    }

    /// <summary>
    /// Shows the widget over other windows, for a notification click, a second launch or the tray's
    /// Settings. A desktop widget goes back under them once the user moves on.
    /// </summary>
    public void Present()
    {
        _presented = !_topmost;
        ShowWidget();
        Native.SetWindowPos(Handle, Native.HWND_TOP, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE);
        Activate();
        // Windows may refuse the activation; unactivated, the widget stays up only until the user
        // brings another window forward, and it never hears a deactivation to go back down on.
        if (Native.GetForegroundWindow() != Handle) _presented = false;
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        if (!_presented) return;
        _presented = false;
        Native.SetWindowPos(Handle, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
    }

    public void HideWidget()
    {
        Visible = false;
        if (_controller != null) _controller.IsVisible = false;
    }

    public void SetTopmost(bool value)
    {
        _topmost = value;
        Native.SetWindowPos(Handle, value ? Native.HWND_TOPMOST : Native.HWND_NOTOPMOST, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        if (!value)
            Native.SetWindowPos(Handle, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
    }

    /// <summary>
    /// Morphs the window to a new size, starting at <paramref name="startUnixMs"/> on the wall clock
    /// the page also animates against.
    /// </summary>
    public void Morph(int width96, int height96, double startUnixMs, int durationMs)
    {
        _size96 = Clamp(width96, height96);
        // Mid-drag the move loop owns the position, and the home corner is stale until the drop. A
        // page that relaid out for a new monitor's DPI (the compact card measures its content, which
        // can come out a pixel different) only resizes the window where it is.
        if (_dragging)
        {
            Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, Scale(_size96.Width, Dpi), Scale(_size96.Height, Dpi),
                Native.SWP_NOMOVE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            return;
        }
        Animate(CurrentRect(), TargetRect(_size96), startUnixMs, durationMs);
    }

    /// <summary>The page asks for this when a press lands on anything that is not a control.</summary>
    public void BeginDrag()
    {
        // Posted, so the modal move loop does not run inside WebView2's message callback.
        BeginInvoke(new Action(() =>
        {
            if (MouseButtons != MouseButtons.Left) return;
            Native.ReleaseCapture();
            Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero);
        }));
    }

    // A dropped widget glides onto the desktop grid: inside a margin of the work area, on fixed
    // steps from it, and flush with the margin when within a step of it.
    private void Settle()
    {
        var from = CurrentRect();
        var (work, dpi) = MonitorOf(from);
        var width = Scale(_size96.Width, dpi);
        var height = Scale(_size96.Height, dpi);
        var margin = Scale(Margin96, dpi);
        var step = Scale(Step96, dpi);
        int Snap(int value, int start, int end, int length)
        {
            var min = start + margin;
            var max = end - margin - length;
            if (max < min) return Math.Max(start, Math.Min(value, end - length));
            value = Math.Max(min, Math.Min(value, max));
            if (value - min <= step) return min;
            if (max - value <= step) return max;
            return Math.Min(max, min + (int)Math.Round((value - min) / (double)step, MidpointRounding.AwayFromZero) * step);
        }
        var left = Snap(from.Left, work.Left, work.Right, width);
        var top = Snap(from.Top, work.Top, work.Bottom, height);
        _home = new System.Drawing.Point(left, top);
        _placement.X = left;
        _placement.Y = top;
        _placement.Save();
        // Aura re-samples the wallpaper once the widget has landed, where it will actually sit.
        Animate(from, new Native.RECT { Left = left, Top = top, Right = left + width, Bottom = top + height }, Native.NowUnixMs(), GlideMs,
            () => Moved?.Invoke());
    }

    /// <summary>
    /// A background thread paces one SetWindowPos per DWM frame and samples the curve from the
    /// shared wall clock, so page and window agree on every frame without talking to each other; the
    /// UI thread stays free to pump the messages those calls send.
    /// </summary>
    private void Animate(Native.RECT from, Native.RECT to, double startUnixMs, int durationMs, Action landed = null)
    {
        var hwnd = Handle;
        var generation = Interlocked.Increment(ref _animation);
        if (durationMs <= 0 || !Visible)
        {
            Native.SetWindowPos(hwnd, IntPtr.Zero, to.Left, to.Top, to.Width, to.Height, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            landed?.Invoke();
            return;
        }

        var thread = new Thread(() =>
        {
            while (Native.NowUnixMs() < startUnixMs - 1) Thread.Sleep(1);
            while (generation == Volatile.Read(ref _animation))
            {
                var t = Math.Max(0, Math.Min(1.0, (Native.NowUnixMs() - startUnixMs) / durationMs));
                var e = Motion.Morph(t);
                int Lerp(int a, int b) => (int)Math.Round(a + (b - a) * e);
                var left = Lerp(from.Left, to.Left);
                var top = Lerp(from.Top, to.Top);
                // Nothing to repaint or copy: the page is never resized, only clipped.
                Native.SetWindowPos(hwnd, IntPtr.Zero, left, top, Lerp(from.Right, to.Right) - left, Lerp(from.Bottom, to.Bottom) - top,
                    Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_NOREDRAW | Native.SWP_NOCOPYBITS | Native.SWP_NOSENDCHANGING);
                if (t >= 1)
                {
                    if (landed != null) BeginInvoke(landed);
                    break;
                }
                Native.DwmFlush();
            }
        }) { IsBackground = true, Priority = ThreadPriority.AboveNormal, Name = "morph" };
        thread.Start();
    }

    private static (int, int) Clamp(int width96, int height96) =>
        (Math.Max(200, Math.Min(MaxWidth96, width96)), Math.Max(120, Math.Min(MaxHeight96, height96)));

    // Aura keeps DWM's live blur behind the page; the page lays its own tint over it. The plain blur
    // is used rather than acrylic because acrylic adds a milky luminosity layer that washes the
    // wallpaper out. The solid themes paint an opaque card.
    public void SetMaterial(bool aura, bool dark)
    {
        var accent = new Native.ACCENT_POLICY { AccentState = aura ? Native.ACCENT_ENABLE_BLURBEHIND : Native.ACCENT_DISABLED };
        var size = Marshal.SizeOf(accent);
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(accent, buffer, false);
            var data = new Native.WINDOWCOMPOSITIONATTRIBDATA { Attribute = Native.WCA_ACCENT_POLICY, Data = buffer, SizeOfData = size };
            Native.SetWindowCompositionAttribute(Handle, ref data);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        var darkMode = dark ? 1 : 0;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, 4);
    }

    /// <summary>
    /// Whether DWM will blur behind the window. Energy saver and battery saver turn transparency off
    /// across Windows, as does the Transparency effects switch; the blur then comes out black. Any
    /// saving mode counts, so the widget never shows that black.
    /// </summary>
    public bool Glass => _energySaver == 0 && _batterySaver == 0 && TransparencyOn;

    private static bool TransparencyOn
    {
        get
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("EnableTransparency") is not int value || value != 0;
        }
    }

    public WindowInfo Info()
    {
        var rect = CurrentRect();
        var monitor = Native.MonitorFromWindow(Handle, Native.MONITOR_DEFAULTTONEAREST);
        return new WindowInfo(rect, monitor, Dpi);
    }

    private int Dpi => (int)Native.GetDpiForWindow(Handle);

    private static int Scale(int value96, int dpi) => (int)Math.Round(value96 * dpi / 96.0);

    private void ApplyFrame()
    {
        var corner = Native.DWMWCP_ROUND;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, 4);
        // Without DWM's 1px outline the glass edge melts into the shadow and the corner reads softer;
        // the page adds only a top highlight.
        var none = Native.DWMWA_COLOR_NONE;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_BORDER_COLOR, ref none, 4);
        var margins = new Native.MARGINS { Top = 1 };
        Native.DwmExtendFrameIntoClientArea(Handle, ref margins);
    }

    private void UpdateBounds(int dpi)
    {
        if (_controller == null) return;
        _controller.RasterizationScale = dpi / 96.0;
        _controller.Bounds = new Rectangle(0, 0, Scale(MaxWidth96, dpi), Scale(MaxHeight96, dpi));
    }

    private Native.RECT CurrentRect()
    {
        Native.GetWindowRect(Handle, out var rect);
        return rect;
    }

    // Grows from the home corner; a size that would cross the grid margin is pushed back inside it.
    private Native.RECT TargetRect((int Width, int Height) size96)
    {
        var dpi = Dpi;
        var (work, _) = MonitorOf(new Native.RECT { Left = _home.X, Top = _home.Y, Right = _home.X + 1, Bottom = _home.Y + 1 });
        var margin = Scale(Margin96, dpi);
        var width = Scale(size96.Width, dpi);
        var height = Scale(size96.Height, dpi);
        var left = Math.Max(work.Left, Math.Min(_home.X, work.Right - margin - width));
        var top = Math.Max(work.Top, Math.Min(_home.Y, work.Bottom - margin - height));
        return new Native.RECT { Left = left, Top = top, Right = left + width, Bottom = top + height };
    }

    // The monitor a rect mostly covers: its work area and DPI.
    private static (Native.RECT Work, int Dpi) MonitorOf(Native.RECT rect)
    {
        var monitor = Native.MonitorFromRect(ref rect, Native.MONITOR_DEFAULTTONEAREST);
        var info = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
        Native.GetMonitorInfo(monitor, ref info);
        return (info.rcWork, Native.GetDpiForMonitor(monitor, 0, out var dpi, out _) == 0 ? (int)dpi : 96);
    }

    private Native.RECT InitialRect(int dpi)
    {
        var width = Scale(_size96.Width, dpi);
        var height = Scale(_size96.Height, dpi);
        if (_placement.X is int x && _placement.Y is int y)
        {
            var probe = new Native.RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
            var monitor = Native.MonitorFromRect(ref probe, Native.MONITOR_DEFAULTTONEAREST);
            var info = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
            Native.GetMonitorInfo(monitor, ref info);
            var w = info.rcWork;
            x = Math.Max(w.Left, Math.Min(x, w.Right - width));
            y = Math.Max(w.Top, Math.Min(y, w.Bottom - height));
            return new Native.RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
        }
        var primary = Screen.PrimaryScreen.WorkingArea;
        var margin = Scale(Margin96, dpi);
        var left = primary.Right - width - margin;
        var top = primary.Top + margin;
        return new Native.RECT { Left = left, Top = top, Right = left + width, Bottom = top + height };
    }

    private static int DpiForPoint(int? x, int? y)
    {
        var rect = new Native.RECT { Left = x ?? 0, Top = y ?? 0, Right = (x ?? 0) + 1, Bottom = (y ?? 0) + 1 };
        var monitor = Native.MonitorFromRect(ref rect, Native.MONITOR_DEFAULTTONEAREST);
        return Native.GetDpiForMonitor(monitor, 0, out var dpi, out _) == 0 ? (int)dpi : 96;
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case Native.WM_NCCALCSIZE when m.WParam != IntPtr.Zero:
                m.Result = IntPtr.Zero;
                return;
            case Native.WM_NCHITTEST:
                // Never a resize border; drags start from the page (BeginDrag).
                m.Result = (IntPtr)Native.HTCLIENT;
                return;
            case Native.WM_WINDOWPOSCHANGING when !_topmost && !_presented:
            {
                // A desktop widget sits under ordinary windows even after it is clicked.
                var pos = Marshal.PtrToStructure<Native.WINDOWPOS>(m.LParam);
                if ((pos.flags & Native.SWP_NOZORDER) == 0)
                {
                    pos.hwndInsertAfter = Native.HWND_BOTTOM;
                    Marshal.StructureToPtr(pos, m.LParam, false);
                }
                break;
            }
            case Native.WM_DPICHANGED:
            {
                // A running glide or morph was planned in the old DPI's pixels; stop it before it
                // fights the new size.
                Interlocked.Increment(ref _animation);
                var suggested = Marshal.PtrToStructure<Native.RECT>(m.LParam);
                var dpi = (int)((long)m.WParam & 0xFFFF);
                Native.SetWindowPos(Handle, IntPtr.Zero, suggested.Left, suggested.Top,
                    Scale(_size96.Width, dpi), Scale(_size96.Height, dpi), Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                UpdateBounds(dpi);
                // A drag carries on under the cursor; anything else lands on the new monitor's grid.
                if (!_dragging) Settle();
                m.Result = IntPtr.Zero;
                return;
            }
            case Native.WM_ENTERSIZEMOVE:
            {
                // A drag takes over from a morph or glide; the window jumps to the size it was heading for.
                _dragging = true;
                Interlocked.Increment(ref _animation);
                var rect = CurrentRect();
                Native.SetWindowPos(Handle, IntPtr.Zero, rect.Left, rect.Top, Scale(_size96.Width, Dpi), Scale(_size96.Height, Dpi),
                    Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                break;
            }
            case Native.WM_EXITSIZEMOVE:
                _dragging = false;
                Settle();
                break;
            case Native.WM_DISPLAYCHANGE:
                Moved?.Invoke();
                break;
            case Native.WM_SETTINGCHANGE:
                Moved?.Invoke();
                GlassChanged?.Invoke();
                break;
            case Native.WM_POWERBROADCAST when (int)m.WParam == Native.PBT_POWERSETTINGCHANGE:
            {
                var setting = Marshal.PtrToStructure<Native.POWERBROADCAST_SETTING>(m.LParam);
                if (setting.PowerSetting == Native.GUID_ENERGY_SAVER_STATUS) _energySaver = setting.Data;
                else if (setting.PowerSetting == Native.GUID_POWER_SAVING_STATUS) _batterySaver = setting.Data;
                else break;
                GlassChanged?.Invoke();
                break;
            }
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_placed)
        {
            _placement.X = _home.X;
            _placement.Y = _home.Y;
            _placement.Save();
        }
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _controller?.Close();
        base.Dispose(disposing);
    }
}

internal readonly record struct WindowInfo(Native.RECT Rect, IntPtr Monitor, int Dpi);
