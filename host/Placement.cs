using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace StillToday;

// Where the widget sits. Kept apart from the product data so the window can be placed before
// WebView2 has started.
internal sealed class Placement
{
    private string _path;
    public int? X { get; set; }
    public int? Y { get; set; }

    public static Placement Load(string dataDir)
    {
        var path = Path.Combine(dataDir, "window.json");
        var placement = new Placement();
        try
        {
            if (File.Exists(path))
            {
                var values = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                if (values.TryGetValue("x", out var x) && x is int xi) placement.X = xi;
                if (values.TryGetValue("y", out var y) && y is int yi) placement.Y = yi;
            }
        }
        catch (Exception exception) when (exception is IOException or ArgumentException or InvalidOperationException)
        {
            // A damaged placement file only costs the remembered position.
        }
        placement._path = path;
        return placement;
    }

    public void Save()
    {
        var json = new JavaScriptSerializer().Serialize(new Dictionary<string, object>
        {
            ["x"] = X,
            ["y"] = Y,
        });
        Store.WriteAtomic(_path, json);
    }
}
