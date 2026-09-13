// Author/creator: nattapat2871 (https://nattapat2871.me)
using System;
using System.IO;
using System.Threading;
class AutoUpdateLauncherFixture {
    static void Main(string[] args) {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        if (args.Length > 0) {
            File.WriteAllText(Path.Combine(directory, "reopened.txt"), String.Join(" ", args));
            return;
        }
        File.WriteAllText(Path.Combine(directory, "ready.txt"), "ready");
        for (int i = 0; i < 1800 && !File.Exists(Path.Combine(directory, "exit.txt")); i++) Thread.Sleep(100);
    }
}
