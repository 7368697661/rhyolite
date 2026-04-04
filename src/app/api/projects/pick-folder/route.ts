import { exec } from "child_process";
import { platform } from "os";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const os = platform();

  let cmd: string;
  if (os === "darwin") {
    cmd = `osascript -e 'POSIX path of (choose folder with prompt "Select project folder")'`;
  } else if (os === "linux") {
    cmd = `zenity --file-selection --directory --title="Select project folder" 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null`;
  } else if (os === "win32") {
    cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select project folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { exit 1 }"`;
  } else {
    return Response.json({ error: "Unsupported platform" }, { status: 400 });
  }

  try {
    const folderPath = await new Promise<string>((resolve, reject) => {
      exec(cmd, { timeout: 120_000 }, (err, stdout) => {
        if (err) return reject(err);
        const p = stdout.trim().replace(/\/$/, "");
        if (!p) return reject(new Error("No folder selected"));
        resolve(p);
      });
    });

    return Response.json({ path: folderPath });
  } catch {
    return Response.json({ cancelled: true }, { status: 200 });
  }
}
