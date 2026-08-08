use printers::common::base::job::PrinterJobOptions;

/// List the names of every printer installed on this machine.
#[tauri::command]
fn list_printers() -> Vec<String> {
    printers::get_printers()
        .into_iter()
        .map(|p| p.name)
        .collect()
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
        .invoke_handler(tauri::generate_handler![list_printers, test_print])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
