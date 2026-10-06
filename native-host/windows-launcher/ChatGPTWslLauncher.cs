using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading.Tasks;

public class ChatGPTWslLauncher
{
    [DataContract]
    private sealed class LauncherConfig
    {
        [DataMember(Name = "WslDistribution")]
        public string WslDistribution { get; set; }

        [DataMember(Name = "ProjectPath")]
        public string ProjectPath { get; set; }

        [DataMember(Name = "ExtensionId")]
        public string ExtensionId { get; set; }
    }

    private static LauncherConfig LoadConfig(string configPath)
    {
        string json = File.ReadAllText(configPath, Encoding.UTF8);

        if (json.Length > 0 && json[0] == '\uFEFF')
            json = json.Substring(1);

        byte[] bytes = Encoding.UTF8.GetBytes(json);

        using (MemoryStream stream = new MemoryStream(bytes))
        {
            DataContractJsonSerializer serializer =
                new DataContractJsonSerializer(typeof(LauncherConfig));

            return (LauncherConfig)serializer.ReadObject(stream);
        }
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    public static int Main()
    {
        try
        {
            string executableDirectory =
                Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location);

            string configPath = Path.Combine(
                executableDirectory,
                "ChatGPTWslLauncher.config.json");

            if (!File.Exists(configPath))
                throw new FileNotFoundException(
                    "Launcher configuration file was not found.",
                    configPath);

            LauncherConfig config = LoadConfig(configPath);

            if (config == null ||
                string.IsNullOrWhiteSpace(config.WslDistribution) ||
                string.IsNullOrWhiteSpace(config.ProjectPath) ||
                string.IsNullOrWhiteSpace(config.ExtensionId) ||
                !System.Text.RegularExpressions.Regex.IsMatch(
                    config.ExtensionId,
                    "^[a-p]{32}$"))
            {
                throw new InvalidOperationException(
                    "Launcher configuration is incomplete.");
            }

            string wslPath =
                config.ProjectPath.TrimEnd('/', '\\') +
                "/native-host/host.js";

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = Path.Combine(
                Environment.SystemDirectory,
                "wsl.exe");
            startInfo.Arguments =
                "-d " + config.WslDistribution +
                " --exec /usr/bin/node " +
                QuoteArgument(wslPath) +
                " --extension-id " +
                config.ExtensionId;

            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardInput = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            using (Process process = new Process())
            {
                process.StartInfo = startInfo;
                process.Start();

                Task inputTask = Task.Run(() =>
                {
                    Console.OpenStandardInput().CopyTo(process.StandardInput.BaseStream);
                    process.StandardInput.Close();
                });

                Task outputTask = process.StandardOutput.BaseStream.CopyToAsync(
                    Console.OpenStandardOutput());

                Task errorTask = process.StandardError.BaseStream.CopyToAsync(
                    Console.OpenStandardError());

                process.WaitForExit();

                Task.WaitAll(inputTask, outputTask, errorTask);

                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            return 1;
        }
    }
}
