using System.IO;
using System.Text;

namespace StillToday;

internal static class Store
{
    // Write-then-replace, with the new bytes on the disk before the swap, so neither a crash nor a
    // power cut mid-save leaves a torn file. With a `backup` path the version replaced stays there.
    public static void WriteAtomic(string path, string content, string backup = null)
    {
        var temp = path + ".tmp";
        var bytes = new UTF8Encoding(false).GetBytes(content);
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush(flushToDisk: true);
        }
        if (File.Exists(path)) File.Replace(temp, path, backup);
        else File.Move(temp, path);
    }

    public static string ReadOrNull(string path) => File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : null;
}
