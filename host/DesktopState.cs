using System;
using System.Runtime.InteropServices;

namespace StillToday;

// Windows 11 24H2+ raises the shell desktop (Progman) above ordinary top-level windows for
// Show Desktop instead of minimizing them. Rather than adding the widget to the desktop owner
// band (which makes a click activate the whole band), detect that state and move the widget only
// while the desktop is actually raised; the normal z-order path stays unchanged.
internal static class DesktopState
{
    private static bool? _supported;

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetTopWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]
    private static extern IntPtr GetProcAddress(IntPtr module, string procName);

    /// <summary>
    /// True only on the Windows 11 servicing line whose desktop has the raised-desktop
    /// behaviour. user32 only exports GetCurrentMonitorTopologyId there.
    /// </summary>
    public static bool IsSupported
    {
        get
        {
            if (_supported is bool supported) return supported;
            bool value;
            try
            {
                value = GetProcAddress(GetModuleHandle("user32.dll"), "GetCurrentMonitorTopologyId") != IntPtr.Zero;
            }
            catch (Exception)
            {
                value = false;
            }
            _supported = value;
            return value;
        }
    }

    /// <summary>
    /// True while the shell desktop is raised: Progman is above at least one visible top-level
    /// window. In the normal state Progman is the bottom-most visible window.
    /// </summary>
    public static bool IsDesktopRaised()
    {
        var shell = GetShellWindow();
        if (shell == IntPtr.Zero || !IsWindowVisible(shell)) return false;
        var foundShell = false;
        for (var hwnd = GetTopWindow(IntPtr.Zero); hwnd != IntPtr.Zero; hwnd = GetWindow(hwnd, 2))
        {
            if (hwnd == shell)
            {
                foundShell = true;
            }
            else if (foundShell && IsWindowVisible(hwnd))
            {
                return true;
            }
        }
        return false;
    }
}
