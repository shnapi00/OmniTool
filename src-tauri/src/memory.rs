/// Модуль оптимизации памяти для работы в фоновом режиме (системном трее).
/// На Windows вызывает API `EmptyWorkingSet`, сбрасывая неактивные страницы
/// процесса в файл подкачки, что моментально снижает потребление RAM до ~15-25 МБ.

#[cfg(target_os = "windows")]
pub fn trim_memory() {
    use windows_sys::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let process = GetCurrentProcess();
        let _ = K32EmptyWorkingSet(process);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn trim_memory() {
    // На Linux / macOS память освобождается ядром ОС автоматически при скрытии окна
}
