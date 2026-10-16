using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Launcher {
    internal static string DataRoot;
    internal static string BundleRoot;
    [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string path);
    [STAThread] static void Main() {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        try {
            DataRoot = Environment.GetEnvironmentVariable("LOCALSOUND_LITE_PROFILE");
            if (String.IsNullOrEmpty(DataRoot)) DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalSound Auditeur Lite");
            DataRoot = Path.GetFullPath(DataRoot);
            var assembly = Assembly.GetExecutingAssembly();
            BundleRoot = Path.Combine(DataRoot, "app-" + assembly.GetName().Version + "-" + assembly.ManifestModule.ModuleVersionId.ToString("N").Substring(0, 12));
            Directory.CreateDirectory(BundleRoot);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
                foreach (var entry in zip.Entries) {
                    if (String.IsNullOrEmpty(entry.Name)) continue;
                    var path = Path.GetFullPath(Path.Combine(BundleRoot, entry.FullName));
                    if (!path.StartsWith(BundleRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Ressource invalide.");
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    if (File.Exists(path) && new FileInfo(path).Length == entry.Length) continue;
                    using (var input = entry.Open()) using (var output = File.Create(path)) input.CopyTo(output);
                }
            }
            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => {
                var name = new AssemblyName(args.Name).Name;
                if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
                return Assembly.LoadFrom(Path.Combine(BundleRoot, name + ".dll"));
            };
            SetDllDirectory(BundleRoot); Run();
        } catch (Exception error) { MessageBox.Show(error.Message, "LocalSound Auditeur Léger", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }
    [MethodImpl(MethodImplOptions.NoInlining)] static void Run() { Application.Run(new ListenerForm()); }
}
