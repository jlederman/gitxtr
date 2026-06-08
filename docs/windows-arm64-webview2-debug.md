# Windows WebView2 Blank Window — Post-Mortem

## Symptom

On Windows the app launched, the window opened, but the client area was solid white — no
content rendered. Reproduced on a Windows 11 ARM64 guest under UTM/QEMU on Apple Silicon.
A trivial `LoadRawString("<body style='background:red'>")` was also blank, so it was not a
content/bundle problem.

## Root Cause

**The process main thread was MTA; WebView2 requires STA.**

`Gitxtr.Host.csproj` is `OutputType=Exe`, and the top-level-statement entry point runs as a
**multi-threaded COM apartment (MTA)**. Photino creates the WebView2 environment inside
`PhotinoWindow.WaitForClose()` (via `Photino_ctor`), and WebView2's
`CreateCoreWebView2EnvironmentWithOptions` requires a **single-threaded apartment (STA)**.
On an MTA thread it fails with `RPC_E_CHANGED_MODE` (0x80010106) — and Photino's async
completion callback **swallows the error silently**. The result: window opens, WebView2
never initializes, user-data folder stays empty, no crash, no message. A blank window.

## The Fix

Run the Photino window on a dedicated **STA thread on Windows**. Because Photino captures its
owning thread in the `PhotinoWindow` constructor (`_managedThreadId`), the window must be both
**constructed and pumped** on that same STA thread — you cannot build it on the main thread and
only move `WaitForClose`. macOS/Linux keep the UI on the process main thread (Cocoa/GTK
affinity, and `Thread.SetApartmentState` throws on non-Windows).

See `src/Gitxtr.Host/Program.cs` — the `RunWindow()` local function and the
`OperatingSystem.IsWindows()` STA-thread dispatch.

This was never ARM64-specific. It affects **every** Windows build (x64 and arm64); the fix
landed before the first Windows release.

## How It Was Diagnosed

A standalone WebView2 host with **no Photino** (raw `Microsoft.Web.WebView2` SDK), logging the
HRESULT at every stage, isolated the cause:

| Thread apartment | `--disable-gpu` | Result |
|------------------|-----------------|--------|
| MTA              | no              | `RPC_E_CHANGED_MODE` |
| MTA              | yes             | `RPC_E_CHANGED_MODE` |
| **STA**          | **no**          | **renders** |
| STA              | yes             | renders |

STA alone fixes it. GPU flags are irrelevant.

## Dead Ends (for the record)

These were investigated and ruled out before the apartment was found:

- **Architecture (win-x64 on ARM64):** switched to win-arm64; all binaries confirmed Aarch64.
  Not the cause.
- **GPU / software rendering:** the VM has only "Microsoft Basic Render Driver" (no GPU), but
  Microsoft Edge renders fine in it, proving WebView2 needs no GPU here. `--disable-gpu` via
  registry `AdditionalBrowserArguments` (HKCU is ignored; HKLM needs admin) and env vars never
  actually reached WebView2 and would not have helped anyway.
- **Network/UNC path, missing runtime, user-data-folder path:** all ruled out.

The lesson: the silent `RPC_E_CHANGED_MODE` in Photino's swallowed callback hid the real cause
for a long time. When a hosted WebView2 is blank with an empty user-data folder and no crash,
**suspect the COM apartment first.**
