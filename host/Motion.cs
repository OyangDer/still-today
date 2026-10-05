using System;

namespace StillToday;

// The window morph and the page share one curve and one start instant, so the native edge and the
// CSS chrome land on the same frame. Keep in step with MORPH in ui/src/lib/motion.ts.
internal static class Motion
{
    private const double X1 = 0.22, Y1 = 0.8, X2 = 0.22, Y2 = 1.0;

    public static double Morph(double t)
    {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        // Solve x(s) = t for the bezier parameter, then return y(s).
        var s = t;
        for (var i = 0; i < 8; i++)
        {
            var x = Bezier(s, X1, X2) - t;
            var dx = Derivative(s, X1, X2);
            if (Math.Abs(x) < 1e-5 || Math.Abs(dx) < 1e-6) break;
            s -= x / dx;
        }
        s = Math.Max(0, Math.Min(1, s));
        return Bezier(s, Y1, Y2);
    }

    private static double Bezier(double s, double p1, double p2) =>
        3 * p1 * s * (1 - s) * (1 - s) + 3 * p2 * s * s * (1 - s) + s * s * s;

    private static double Derivative(double s, double p1, double p2) =>
        3 * p1 * (1 - s) * (1 - s) + 6 * (p2 - p1) * s * (1 - s) + 3 * (1 - p2) * s * s;
}
