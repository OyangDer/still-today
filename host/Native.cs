using System;
using System.Runtime.InteropServices;

namespace StillToday;

internal static class Native
{
    public const int WM_SETTINGCHANGE = 0x001A;
    public const int WM_WINDOWPOSCHANGING = 0x0046;
    public const int WM_DISPLAYCHANGE = 0x007E;
    public const int WM_POWERBROADCAST = 0x0218;
    public const int PBT_POWERSETTINGCHANGE = 0x8013;
    public const int WM_NCCALCSIZE = 0x0083;
    public const int WM_NCHITTEST = 0x0084;
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int WM_ENTERSIZEMOVE = 0x0231;
    public const int WM_EXITSIZEMOVE = 0x0232;
    public const int WM_DPICHANGED = 0x02E0;
    public const int HTCLIENT = 1;
    public const int HTCAPTION = 2;

    public const int WS_CAPTION = 0x00C00000;
    public const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const int WS_MAXIMIZEBOX = 0x00010000;
    public const int WS_MINIMIZEBOX = 0x00020000;
    public const int WS_SYSMENU = 0x00080000;

    public static readonly IntPtr HWND_TOP = IntPtr.Zero;
    public static readonly IntPtr HWND_BOTTOM = new(1);
    public static readonly IntPtr HWND_TOPMOST = new(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new(-2);
    public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOREDRAW = 0x0008, SWP_NOACTIVATE = 0x0010,
        SWP_NOCOPYBITS = 0x0100, SWP_NOSENDCHANGING = 0x0400;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPOS { public IntPtr hwnd, hwndInsertAfter; public int x, y, cx, cy; public uint flags; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MARGINS { public int Left, Right, Top, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromRect(ref RECT rect, uint flags);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    public const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("shcore.dll")]
    public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int RegisterWindowMessage(string name);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll")]
    public static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, int flags);

    /// <summary>Windows 11's energy saver: 0 off, 1 standard, 2 high savings.</summary>
    public static readonly Guid GUID_ENERGY_SAVER_STATUS = new("550e8400-e29b-41d4-a716-446655440000");
    /// <summary>Windows 10's battery saver: 0 off, 1 on.</summary>
    public static readonly Guid GUID_POWER_SAVING_STATUS = new("e00958c0-c213-4ace-ac77-fecced2eeea5");

    [StructLayout(LayoutKind.Sequential)]
    public struct POWERBROADCAST_SETTING
    {
        public Guid PowerSetting;
        public int DataLength;
        public int Data;
    }

    public const int ASFW_ANY = -1;

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    public static readonly IntPtr HWND_BROADCAST = new(0xffff);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    [DllImport("dwmapi.dll")]
    public static extern int DwmFlush();

    [DllImport("kernel32.dll")]
    private static extern void GetSystemTimePreciseAsFileTime(out long fileTime);

    /// <summary>
    /// Wall-clock milliseconds since 1970 at sub-millisecond precision: the same clock as the page's
    /// Date.now()/performance.timeOrigin, which is what lets the window and the page share one timeline.
    /// </summary>
    public static double NowUnixMs()
    {
        GetSystemTimePreciseAsFileTime(out var fileTime);
        return (fileTime - 116444736000000000L) / 10000.0;
    }

    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    public const int DWMWA_BORDER_COLOR = 34;
    public const int DWMWCP_ROUND = 2;
    public const int DWMWA_COLOR_NONE = unchecked((int)0xFFFFFFFE);

    // Win11's documented system backdrops fall back to a flat fill while the window is inactive, and
    // a desktop widget is inactive almost all the time. The accent policy keeps DWM's live blur on
    // regardless of focus, which is what the Aura theme needs.
    [StructLayout(LayoutKind.Sequential)]
    public struct ACCENT_POLICY { public int AccentState, AccentFlags, GradientColor, AnimationId; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWCOMPOSITIONATTRIBDATA { public int Attribute; public IntPtr Data; public int SizeOfData; }

    public const int WCA_ACCENT_POLICY = 19;
    public const int ACCENT_DISABLED = 0;
    public const int ACCENT_ENABLE_BLURBEHIND = 3;

    [DllImport("user32.dll")]
    public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WINDOWCOMPOSITIONATTRIBDATA data);

    // Credential Manager: feed links and the Canvas token are bearer secrets.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredReadW")]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredWriteW")]
    public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredDeleteW")]
    public static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr buffer);

    // Windows ships SQLite as winsqlite3.dll; it is only needed once, to read the old WPF database.
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open_v2", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_close(IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_prepare_v2", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int bytes, out IntPtr stmt, IntPtr tail);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_step", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_step(IntPtr stmt);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_finalize", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_finalize(IntPtr stmt);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_count", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_column_count(IntPtr stmt);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_name16", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr sqlite3_column_name16(IntPtr stmt, int column);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_type", CallingConvention = CallingConvention.StdCall)]
    public static extern int sqlite3_column_type(IntPtr stmt, int column);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_text16", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr sqlite3_column_text16(IntPtr stmt, int column);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_double", CallingConvention = CallingConvention.StdCall)]
    public static extern double sqlite3_column_double(IntPtr stmt, int column);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_int64", CallingConvention = CallingConvention.StdCall)]
    public static extern long sqlite3_column_int64(IntPtr stmt, int column);

    public const int SQLITE_ROW = 100;
    public const int SQLITE_OPEN_READONLY = 1;
    public const int SQLITE_INTEGER = 1, SQLITE_FLOAT = 2, SQLITE_NULL = 5;
}

// The wallpaper each monitor actually shows. Aura reads it only to decide light or dark ink; the
// blur itself is DWM's.
[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDesktopWallpaper
{
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorId, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorId);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
    Native.RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorId);
    void SetBackgroundColor(uint color);
    uint GetBackgroundColor();
    void SetPosition(int position);
    int GetPosition();
}

[ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")]
internal class DesktopWallpaperClass { }
