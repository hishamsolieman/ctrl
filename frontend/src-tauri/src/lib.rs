use printers::common::base::job::PrinterJobOptions;

/// List the names of every printer installed on this machine.
#[tauri::command]
fn list_printers() -> Vec<String> {
    printers::get_printers()
        .into_iter()
        .map(|p| p.name)
        .collect()
}

/// Motherboard serial + processor id (concatenated) for desktop HWID lock.
#[tauri::command]
fn get_hwid() -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = r#"
$board = [string](Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber
$cpu = [string](@(Get-CimInstance -ClassName Win32_Processor)[0].ProcessorId)
Write-Output (($board.Trim() + $cpu.Trim()) -replace '\s','')
"#;
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(if err.trim().is_empty() {
                "hwid.failed".into()
            } else {
                err.trim().into()
            });
        }
        let hwid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if hwid.is_empty() {
            return Err("hwid.empty".into());
        }
        Ok(hwid)
    }
    #[cfg(not(windows))]
    {
        Err("hwid.unsupported".into())
    }
}

/// Send a plain-text test job to the given printer.
#[tauri::command]
fn test_print(printer: String, text: String) -> Result<(), String> {
    let target = printers::get_printer_by_name(&printer)
        .ok_or_else(|| format!("Printer not found: {printer}"))?;
    target
        .print(text.as_bytes(), PrinterJobOptions::none())
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_printers, test_print, get_hwid])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
