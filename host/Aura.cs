using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace StillToday;

internal sealed record AuraSample(string Average, string Darkest, string Brightest);

// DWM blurs whatever is behind the widget. The page still has to choose light or dark ink, so this
// looks at the wallpaper the widget's monitor shows under the widget, at 1/16 scale, and reports
// its average, darkest and brightest colours.
internal sealed class Aura
{
    private const int Divisor = 16;
    private readonly Dictionary<string, (string Key, Bitmap Image, Native.RECT Monitor)> _cache = new();

    public AuraSample Sample(Native.RECT window)
    {
        lock (_cache) return SampleCore(window);
    }

    private AuraSample SampleCore(Native.RECT window)
    {
        try
        {
            var desktop = (IDesktopWallpaper)new DesktopWallpaperClass();
            try
            {
                var center = new Native.RECT
                {
                    Left = (window.Left + window.Right) / 2,
                    Top = (window.Top + window.Bottom) / 2,
                };
                var count = desktop.GetMonitorDevicePathCount();
                string monitorId = null;
                var monitor = default(Native.RECT);
                var virtualScreen = default(Native.RECT);
                for (uint i = 0; i < count; i++)
                {
                    var id = desktop.GetMonitorDevicePathAt(i);
                    Native.RECT rect;
                    try { rect = desktop.GetMonitorRECT(id); }
                    catch (COMException) { continue; }
                    virtualScreen = Union(virtualScreen, rect, i == 0);
                    if (center.Left >= rect.Left && center.Left < rect.Right && center.Top >= rect.Top && center.Top < rect.Bottom)
                    {
                        monitorId = id;
                        monitor = rect;
                    }
                }
                if (monitorId == null) return null;

                var path = desktop.GetWallpaper(monitorId);
                var position = desktop.GetPosition();
                var background = desktop.GetBackgroundColor();
                var image = MonitorImage(monitorId, path, position, background, monitor, virtualScreen);
                return Measure(image, monitor, window);
            }
            finally
            {
                Marshal.ReleaseComObject(desktop);
            }
        }
        catch (Exception exception) when (exception is COMException or IOException or ArgumentException or OutOfMemoryException or InvalidCastException)
        {
            return null;
        }
    }

    private static Native.RECT Union(Native.RECT a, Native.RECT b, bool first) => first
        ? b
        : new Native.RECT
        {
            Left = Math.Min(a.Left, b.Left),
            Top = Math.Min(a.Top, b.Top),
            Right = Math.Max(a.Right, b.Right),
            Bottom = Math.Max(a.Bottom, b.Bottom),
        };

    private Bitmap MonitorImage(string monitorId, string path, int position, uint background, Native.RECT monitor, Native.RECT virtualScreen)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Themes\TranscodedWallpaper");
        var stamp = File.Exists(path) ? File.GetLastWriteTimeUtc(path).Ticks : 0;
        var key = $"{path}|{stamp}|{position}|{background}|{monitor.Left},{monitor.Top},{monitor.Width},{monitor.Height}";
        if (_cache.TryGetValue(monitorId, out var cached) && cached.Key == key) return cached.Image;

        var width = Math.Max(1, monitor.Width / Divisor);
        var height = Math.Max(1, monitor.Height / Divisor);
        var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            // COLORREF is 0x00BBGGRR.
            g.Clear(Color.FromArgb((int)(background & 0xFF), (int)((background >> 8) & 0xFF), (int)((background >> 16) & 0xFF)));
            if (stamp != 0)
            {
                using var stream = File.OpenRead(path);
                using var source = Image.FromStream(stream, false, false);
                g.InterpolationMode = InterpolationMode.Bilinear;
                g.ScaleTransform(1f / Divisor, 1f / Divisor);
                Draw(g, source, position, monitor, virtualScreen);
            }
        }
        Blur(bitmap);
        if (_cache.TryGetValue(monitorId, out var old)) old.Image.Dispose();
        _cache[monitorId] = (key, bitmap, monitor);
        return bitmap;
    }

    // DWM's acrylic blurs away small dark or bright details, so contrast is judged on what the blur
    // leaves: three box passes of radius 2 at 1/16 scale approximate its ~30px gaussian.
    private static void Blur(Bitmap bitmap)
    {
        var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        var data = bitmap.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
        try
        {
            var bytes = new byte[data.Stride * data.Height];
            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            var scratch = new byte[bytes.Length];
            for (var pass = 0; pass < 3; pass++)
            {
                BoxPass(bytes, scratch, data.Width, data.Height, data.Stride, horizontal: true);
                BoxPass(scratch, bytes, data.Width, data.Height, data.Stride, horizontal: false);
            }
            Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static void BoxPass(byte[] source, byte[] target, int width, int height, int stride, bool horizontal)
    {
        const int radius = 2;
        var length = horizontal ? width : height;
        var lines = horizontal ? height : width;
        for (var line = 0; line < lines; line++)
        for (var i = 0; i < length; i++)
        for (var channel = 0; channel < 3; channel++)
        {
            int sum = 0, count = 0;
            for (var k = Math.Max(0, i - radius); k <= Math.Min(length - 1, i + radius); k++)
            {
                sum += source[Offset(k, line) + channel];
                count++;
            }
            target[Offset(i, line) + channel] = (byte)(sum / count);
        }

        int Offset(int along, int across) => horizontal ? across * stride + along * 3 : along * stride + across * 3;
    }

    // DESKTOP_WALLPAPER_POSITION: Center, Tile, Stretch, Fit, Fill, Span.
    private static void Draw(Graphics g, Image source, int position, Native.RECT monitor, Native.RECT virtualScreen)
    {
        float w = monitor.Width, h = monitor.Height, iw = source.Width, ih = source.Height;
        switch (position)
        {
            case 0:
                g.DrawImage(source, (w - iw) / 2, (h - ih) / 2, iw, ih);
                break;
            case 1:
                using (var brush = new TextureBrush(source, WrapMode.Tile))
                    g.FillRectangle(brush, 0, 0, w, h);
                break;
            case 2:
                g.DrawImage(source, 0, 0, w, h);
                break;
            case 3:
            {
                var scale = Math.Min(w / iw, h / ih);
                g.DrawImage(source, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
                break;
            }
            case 5:
            {
                float vw = virtualScreen.Width, vh = virtualScreen.Height;
                var scale = Math.Max(vw / iw, vh / ih);
                var x = virtualScreen.Left + (vw - iw * scale) / 2 - monitor.Left;
                var y = virtualScreen.Top + (vh - ih * scale) / 2 - monitor.Top;
                g.DrawImage(source, x, y, iw * scale, ih * scale);
                break;
            }
            default:
            {
                var scale = Math.Max(w / iw, h / ih);
                g.DrawImage(source, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
                break;
            }
        }
    }

    private static AuraSample Measure(Bitmap image, Native.RECT monitor, Native.RECT window)
    {
        var left = Clamp((window.Left - monitor.Left) / Divisor, image.Width - 1);
        var top = Clamp((window.Top - monitor.Top) / Divisor, image.Height - 1);
        var right = Clamp((window.Right - monitor.Left + Divisor - 1) / Divisor, image.Width);
        var bottom = Clamp((window.Bottom - monitor.Top + Divisor - 1) / Divisor, image.Height);
        right = Math.Max(right, left + 1);
        bottom = Math.Max(bottom, top + 1);

        long r = 0, gSum = 0, b = 0, n = 0;
        Color darkest = Color.White, brightest = Color.Black;
        double low = double.MaxValue, high = double.MinValue;
        for (var y = top; y < bottom; y++)
        for (var x = left; x < right; x++)
        {
            var c = image.GetPixel(x, y);
            r += c.R; gSum += c.G; b += c.B; n++;
            var l = 0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B;
            if (l < low) { low = l; darkest = c; }
            if (l > high) { high = l; brightest = c; }
        }
        var average = Color.FromArgb((int)(r / n), (int)(gSum / n), (int)(b / n));
        return new AuraSample(Hex(average), Hex(darkest), Hex(brightest));
    }

    private static int Clamp(int value, int max) => Math.Max(0, Math.Min(max, value));

    private static string Hex(Color c) => $"#{c.R:x2}{c.G:x2}{c.B:x2}";
}
