use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Создает процесс, который гарантированно запускается в Windows скрытно:
/// 1. Устанавливает флаг WinAPI `CREATE_NO_WINDOW = 0x08000000`, исключающий появление черного окна консоли (cmd).
/// 2. Пайпит `stdout` и `stderr`, предотвращая вывод мусора в терминал.
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd
}
