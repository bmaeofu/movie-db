// Kleiner Launcher für dvbplay:// — wird von Chrome als Anwendung angezeigt
// ("DvbPlay" statt "Windows PowerShell") und zeigt kein Konsolenfenster.
//
// Build: csc /nologo /target:winexe /out:%LOCALAPPDATA%\dvbplay\DvbPlay.exe tools\dvbplay-launcher.cs

using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class DvbPlay
{
    private const string Player = @"C:\Program Files\MPC-HC\mpc-hc64.exe";

    private static void Main(string[] args)
    {
        var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dvbplay", "dvbplay.log");
        try
        {
            if (args.Length == 0)
            {
                WriteLog(log, "kein Argument übergeben");
                return;
            }

            var url = args[0];
            var rest = url;
            const string prefix = "dvbplay://";
            if (rest.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) rest = rest.Substring(prefix.Length);
            rest = rest.TrimEnd('/', '\\');
            rest = Uri.UnescapeDataString(rest);
            var path = rest.StartsWith("\\\\") ? rest : "\\\\" + rest.Replace('/', '\\');

            WriteLog(log, "URL=" + url + "  PFAD=" + path);

            if (!File.Exists(Player))
            {
                WriteLog(log, "FEHLER: MPC-HC nicht gefunden: " + Player);
                return;
            }
            if (!File.Exists(path))
            {
                WriteLog(log, "FEHLER: Datei nicht erreichbar");
                return;
            }

            Process.Start(new ProcessStartInfo(Player, "\"" + path + "\"") { UseShellExecute = false });
            WriteLog(log, "MPC-HC gestartet");
        }
        catch (Exception ex)
        {
            WriteLog(log, "AUSNAHME: " + ex.Message);
        }
    }

    private static void WriteLog(string file, string text)
    {
        try
        {
            var dir = Path.GetDirectoryName(file);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text + Environment.NewLine, Encoding.UTF8);
        }
        catch
        {
            // Logging darf den Start nie verhindern
        }
    }
}
