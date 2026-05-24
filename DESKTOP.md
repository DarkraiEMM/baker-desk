# Baker Desk Desktop Build

This app is now prepared for a Tauri desktop shell.

## Current status

- Tauri npm packages are installed.
- `src-tauri/` has been scaffolded.
- The frontend remains the React/Vite app.
- Rust/Cargo and Visual Studio C++ Build Tools are installed on this machine.
- The desktop app has been compiled successfully.

## Build outputs

Convenience copies:

```text
F:\BakerDesk\dist\BakerDesk.exe
F:\BakerDesk\dist\BakerDesk-Setup-0.1.0-x64.exe
F:\BakerDesk\dist\BakerDesk-0.1.0-x64.msi
```

Original Tauri outputs:

```text
F:\BakerDesk\app\src-tauri\target\release\baker-desk.exe
F:\BakerDesk\app\src-tauri\target\release\bundle\nsis\Baker Desk_0.1.0_x64-setup.exe
F:\BakerDesk\app\src-tauri\target\release\bundle\msi\Baker Desk_0.1.0_x64_en-US.msi
```

## Install prerequisites

Rust is already installed on this machine. On another machine, install Rust using `rustup`:

```powershell
winget install Rustlang.Rustup
```

Then open a new PowerShell window and check:

```powershell
rustc --version
cargo --version
```

Tauri on Windows may also require Microsoft C++ Build Tools / WebView2 runtime depending on the machine. This machine has both installed.

## Run desktop dev mode

```powershell
cd F:\BakerDesk\app
npm.cmd run tauri:dev
```

## Build installer

```powershell
cd F:\BakerDesk\app
npm.cmd run tauri:build
```

## Next desktop-specific work

1. Replace browser `localStorage` recipe storage with a local `user-data/recipes` folder.
2. Add file picker / folder picker for recipe import.
3. Add llama.cpp/Qwen sidecar runtime.
4. Add model health check and first-run setup.
