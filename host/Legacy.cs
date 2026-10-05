using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace StillToday;

// One-time import from the WPF release's SQLite database, read through Windows' own winsqlite3.
// The page maps the rows into the new model; secrets are copied here, credential to credential, so
// they never pass through the page.
internal static class Legacy
{
    private static readonly string[] Tables =
    {
        "settings", "source_connections", "subscriptions", "calendar_items", "item_user_state",
        "canvas_assignment_details", "local_events", "local_tasks", "focus_sessions",
    };

    public static string DatabasePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DesktopKanban", "desktop-kanban.db");

    public static Dictionary<string, object> Read()
    {
        if (!File.Exists(DatabasePath)) return null;
        if (Native.sqlite3_open_v2(Utf8(DatabasePath), out var db, Native.SQLITE_OPEN_READONLY, IntPtr.Zero) != 0)
        {
            Native.sqlite3_close(db);
            return null;
        }
        try
        {
            var tables = new Dictionary<string, object>();
            foreach (var table in Tables) tables[table] = Query(db, $"SELECT * FROM \"{table}\"");
            var result = new Dictionary<string, object> { ["tables"] = tables };
            result["canvasConnected"] = CopyCanvasSecret(tables);
            result["feeds"] = CopyFeedSecrets(tables);
            return result;
        }
        finally
        {
            Native.sqlite3_close(db);
        }
    }

    private static bool CopyCanvasSecret(Dictionary<string, object> tables)
    {
        foreach (Dictionary<string, object> row in (List<object>)tables["source_connections"])
        {
            if (row["kind"] as string != "Canvas") continue;
            var payload = Secrets.Read(row["credential_reference"] as string);
            if (string.IsNullOrEmpty(payload)) continue;
            // The WPF release stored {"Token": "...", "ExpiryDate": "..."}; the expiry arrives separately
            // through its reminder event in local_events.
            if (new JavaScriptSerializer().DeserializeObject(payload) is not Dictionary<string, object> credential
                || credential.TryGetValue("Token", out var token) is false
                || token is not string value || value.Length == 0) continue;
            Secrets.Write(Bridge.CanvasTarget, row["host"] as string, value);
            return true;
        }
        return false;
    }

    private static List<object> CopyFeedSecrets(Dictionary<string, object> tables)
    {
        var copied = new List<object>();
        foreach (Dictionary<string, object> row in (List<object>)tables["subscriptions"])
        {
            var url = Secrets.Read(row["credential_reference"] as string);
            if (string.IsNullOrEmpty(url)) continue;
            var id = row["id"] as string;
            Secrets.Write(Bridge.FeedTarget(id), "feed", url);
            copied.Add(id);
        }
        return copied;
    }

    private static List<object> Query(IntPtr db, string sql)
    {
        var rows = new List<object>();
        var bytes = Utf8(sql);
        // A table missing from an older schema simply imports as empty.
        if (Native.sqlite3_prepare_v2(db, bytes, bytes.Length, out var statement, IntPtr.Zero) != 0) return rows;
        try
        {
            var columns = Native.sqlite3_column_count(statement);
            while (Native.sqlite3_step(statement) == Native.SQLITE_ROW)
            {
                var row = new Dictionary<string, object>();
                for (var i = 0; i < columns; i++)
                {
                    var name = Marshal.PtrToStringUni(Native.sqlite3_column_name16(statement, i));
                    row[name] = Native.sqlite3_column_type(statement, i) switch
                    {
                        Native.SQLITE_NULL => null,
                        Native.SQLITE_INTEGER => Native.sqlite3_column_int64(statement, i),
                        Native.SQLITE_FLOAT => Native.sqlite3_column_double(statement, i),
                        _ => Marshal.PtrToStringUni(Native.sqlite3_column_text16(statement, i)),
                    };
                }
                rows.Add(row);
            }
        }
        finally
        {
            Native.sqlite3_finalize(statement);
        }
        return rows;
    }

    private static byte[] Utf8(string value) => Encoding.UTF8.GetBytes(value + "\0");
}
