using System;
using System.Runtime.InteropServices;

namespace StillToday;

// Windows 11 24H2+ raises the shell desktop above ordinary top-level windows when the user
// presses Win+D or the taskbar's Show desktop button, instead of minimizing those windows.
// A widget pinned to HWND_BOTTOM is then covered by Program Manager. Making the desktop icon
// host (SHELLDLL_DefView) the widget's owner puts the window into the desktop owner band: it
// rises with the desktop when Show Desktop is used, while ordinary windows still stay above
// it. No WS_EX_TOPMOST is involved.
internal static class DesktopLayer
{
    private const int GwlpHwndParent = -8;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private static readonly IntPtr HwndBottom = new(1);

    private static bool? _supported;
    private static IntPtr _defView;
    private static IntPtr _originalOwner;
    private static bool _hasOriginalOwner;

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowTitle);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

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
    /// Makes the widget owned by the desktop icon view and keeps it at the bottom of that band.
    /// Returns false where the desktop has no raised-desktop behaviour or the attach failed.
    /// </summary>
    public static bool Attach(IntPtr hwnd)
    {
        if (!IsSupported || hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;

        var defView = FindDesktopIconView();
        if (defView == IntPtr.Zero) return false;

        if (!_hasOriginalOwner)
        {
            _originalOwner = GetWindowLongPtr(hwnd, GwlpHwndParent);
            _hasOriginalOwner = true;
        }

        if (GetWindowLongPtr(hwnd, GwlpHwndParent) != defView)
        {
            SetWindowLongPtr(hwnd, GwlpHwndParent, defView);
            if (GetWindowLongPtr(hwnd, GwlpHwndParent) != defView) return false;
        }

        SetWindowPos(hwnd, HwndBottom, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
        return true;
    }

    /// <summary>Re-attaches after an Explorer restart invalidated the cached owner.</summary>
    public static void EnsureAttached(IntPtr hwnd)
    {
        if (!IsSupported || hwnd == IntPtr.Zero || !IsWindow(hwnd)) return;
        if (_defView != IntPtr.Zero && IsWindow(_defView) && GetWindowLongPtr(hwnd, GwlpHwndParent) == _defView) return;
        Attach(hwnd);
    }

    /// <summary>Restores the owner the form had before attaching, on shutdown.</summary>
    public static void Detach(IntPtr hwnd)
    {
        if (!IsSupported || hwnd == IntPtr.Zero || !_hasOriginalOwner || !IsWindow(hwnd)) return;
        SetWindowLongPtr(hwnd, GwlpHwndParent, _originalOwner);
        SetWindowPos(hwnd, HwndBottom, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
        _hasOriginalOwner = false;
    }

    /// <summary>The handle's owner bookkeeping is stale after a WinForms handle recreation.</summary>
    public static void Forget()
    {
        _originalOwner = IntPtr.Zero;
        _hasOriginalOwner = false;
    }

    private static IntPtr FindDesktopIconView()
    {
        if (_defView != IntPtr.Zero && IsWindow(_defView)) return _defView;
        _defView = IntPtr.Zero;

        // 24H2+: SHELLDLL_DefView is a layered child of the Progman shell window.
        var shell = GetShellWindow();
        if (shell != IntPtr.Zero)
        {
            var direct = FindWindowEx(shell, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (direct != IntPtr.Zero)
            {
                _defView = direct;
                return direct;
            }
        }

        // Classic layout: SHELLDLL_DefView lives under a top-level WorkerW window.
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            var child = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (child == IntPtr.Zero) return true;
            found = child;
            return false;
        }, IntPtr.Zero);
        _defView = found;
        return found;
    }
}
