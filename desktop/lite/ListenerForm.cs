using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class ListenerForm : Form {
    const string Home = "https://localsound.app";
    readonly WebView2 web = new WebView2();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly string preferences = Path.Combine(Launcher.DataRoot, "address.txt");
    readonly bool test = !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("LOCALSOUND_LITE_TEST_PORT"));
    string room;
    bool mini, exiting;
    Rectangle largeBounds;
    FormWindowState largeState;
    public ListenerForm() {
        Text = "LocalSound — Auditeur Léger"; ClientSize = new Size(1100, 760); MinimumSize = new Size(740, 560);
        BackColor = Color.FromArgb(244, 240, 231); StartPosition = FormStartPosition.CenterScreen;
        Icon = new Icon(Path.Combine(Launcher.BundleRoot, "public", "branding", "icon.ico"));
        web.Dock = DockStyle.Fill; web.DefaultBackgroundColor = BackColor; Controls.Add(web);
        if (test) { StartPosition = FormStartPosition.Manual; Location = new Point(-20000, -20000); ShowInTaskbar = false; }
        Shown += async (sender, args) => await Initialize();
        FormClosing += (sender, args) => { if (mini && !exiting) { args.Cancel = true; RestoreMini(); } };
    }
    async Task Initialize() {
        try {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            var options = new CoreWebView2EnvironmentOptions();
            int port;
            if (test && Int32.TryParse(Environment.GetEnvironmentVariable("LOCALSOUND_LITE_TEST_PORT"), out port) && port > 1024 && port < 65536)
                options.AdditionalBrowserArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + port;
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Launcher.DataRoot, "browser"), options);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("localsound.app", Path.Combine(Launcher.BundleRoot, "public"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.AreDevToolsEnabled = test; core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false; core.Settings.IsZoomControlEnabled = false; core.Settings.AreHostObjectsAllowed = false;
            core.PermissionRequested += (sender, args) => { args.State = CoreWebView2PermissionState.Deny; args.Handled = true; };
            core.NewWindowRequested += (sender, args) => { args.Handled = true; OpenExternal(args.Uri); };
            core.DownloadStarting += (sender, args) => args.Cancel = true;
            core.WindowCloseRequested += (sender, args) => { exiting = true; Close(); };
            core.NavigationStarting += (sender, args) => {
                Uri uri;
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || !(Origin(uri) == Home || Origin(uri) == room)) { args.Cancel = true; return; }
                if (Origin(uri) == room && uri.AbsolutePath != "/listen" && uri.AbsolutePath != "/about.html" && uri.AbsolutePath != "/third-party.html" && !uri.AbsolutePath.StartsWith("/licenses/", StringComparison.Ordinal)) args.Cancel = true;
            };
            core.WebMessageReceived += Receive;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(Launcher.BundleRoot, "lite-bridge.js")));
            core.Navigate(Home + "/listener-connect.html");
        } catch (WebView2RuntimeNotFoundException) {
            if (!test && MessageBox.Show("Le lecteur léger utilise le moteur Microsoft WebView2 partagé de Windows. Il manque sur ce PC. Ouvrir la page officielle pour l’installer ?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
            exiting = true; Close();
        } catch (Exception error) { if (!test) MessageBox.Show(error.Message, Text); exiting = true; Close(); }
    }
    static string Origin(Uri uri) { return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/'); }
    static string Address(string value) {
        if (String.IsNullOrWhiteSpace(value) || value.Length > 2048) throw new Exception("Indiquez l’adresse du salon.");
        value = value.Trim(); if (!value.Contains("://")) value = "http://" + value;
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !String.IsNullOrEmpty(uri.UserInfo) || String.IsNullOrEmpty(uri.Host)) throw new Exception("Utilisez une adresse de salon HTTP ou HTTPS valide.");
        return Origin(uri);
    }
    async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs args) {
        Dictionary<string, object> request; object id = null;
        try {
            Uri source;
            if (!Uri.TryCreate(args.Source, UriKind.Absolute, out source) || (Origin(source) != Home && Origin(source) != room)) return;
            request = json.Deserialize<Dictionary<string, object>>(args.WebMessageAsJson);
            if (!request.TryGetValue("id", out id) || !request.ContainsKey("action")) return;
            string action = Convert.ToString(request["action"]); object result = true;
            if (action == "last-address") result = File.Exists(preferences) ? File.ReadAllText(preferences) : "";
            else if (action == "connect") {
                if (Origin(source) != Home) throw new Exception("Revenez à l’écran de connexion.");
                var address = Address(request.ContainsKey("value") ? Convert.ToString(request["value"]) : "");
                using (var handler = new HttpClientHandler { AllowAutoRedirect = false }) using (var client = new HttpClient(handler)) {
                    client.Timeout = TimeSpan.FromSeconds(5); client.MaxResponseContentBufferSize = 262144;
                    var status = json.Deserialize<Dictionary<string, object>>(await client.GetStringAsync(address + "/api/status"));
                    object application;
                    if (!status.TryGetValue("application", out application) || Convert.ToString(application) != "localsound-share") throw new Exception("Cette adresse ne correspond pas à un salon LocalSound.");
                    object version; Version hostVersion;
                    if (!status.TryGetValue("version", out version) || !Version.TryParse(Convert.ToString(version), out hostVersion) || hostVersion.CompareTo(new Version(0, 1, 5)) < 0)
                        throw new Exception("Mettez à jour l’hôte vers LocalSound 0.1.5 ou une version plus récente pour utiliser le lecteur léger.");
                }
                room = address; File.WriteAllText(preferences, room); Reply(id, true, null);
                web.CoreWebView2.Navigate(room + "/listen"); return;
            } else if (action == "change-room") {
                RestoreMini(); room = null; Reply(id, true, null); web.CoreWebView2.Navigate(Home + "/listener-connect.html"); return;
            } else if (action == "mini-open" && Origin(source) == room) OpenMini();
            else if (action == "mini-close") RestoreMini();
            else if (action == "test-state" && test) result = new { width = ClientSize.Width, height = ClientSize.Height, top = TopMost, maximize = MaximizeBox, resize = FormBorderStyle == FormBorderStyle.Sizable, compact = mini };
            else if (action == "test-exit" && test) { exiting = true; Reply(id, true, null); BeginInvoke(new Action(Close)); return; }
            else throw new Exception("Commande indisponible.");
            Reply(id, result, null);
        } catch (Exception error) {
            string message = error is HttpRequestException || error is TaskCanceledException ? "Salon injoignable. Vérifiez l’adresse, le réseau et le PC hôte." : error.Message;
            if (id != null) Reply(id, null, message);
        }
    }
    void Reply(object id, object value, string error) { if (!IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { id, value, error })); }
    void OpenMini() {
        if (mini) return; largeBounds = Bounds; largeState = WindowState; WindowState = FormWindowState.Normal;
        mini = true; MinimumSize = Size.Empty; MaximumSize = Size.Empty; MaximizeBox = false; FormBorderStyle = FormBorderStyle.FixedSingle;
        ClientSize = new Size(320, 216); TopMost = true;
        if (!test) { var area = Screen.FromControl(this).WorkingArea; Location = new Point(area.Right - Width - 20, area.Bottom - Height - 20); }
    }
    void RestoreMini() {
        if (!mini) return; mini = false; TopMost = false; MaximizeBox = true; FormBorderStyle = FormBorderStyle.Sizable;
        MinimumSize = new Size(740, 560); Bounds = largeBounds; WindowState = largeState;
        web.CoreWebView2.ExecuteScriptAsync("window.closeEmbeddedMiniPlayer && window.closeEmbeddedMiniPlayer()");
    }
    void OpenExternal(string value) {
        if (value == "mailto:ranjalahy.narindraa@gmail.com" || value == "tel:0328814081" || value == "https://narindraportfolio.netlify.app/" || value == "https://www.youtube.com/static?template=terms" || value == "https://policies.google.com/privacy?hl=fr")
            Process.Start(new ProcessStartInfo(value) { UseShellExecute = true });
    }
}
