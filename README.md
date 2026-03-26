# xvlog linter

Lint Verilog and SystemVerilog files directly in VS Code using Xilinx's `xvlog` tool, part of Vivado and Vivado Lab Edition. Errors and warnings appear inline in your editor and in the **Problems** panel as you work.

## Requirements

- `xvlog` must be accessible - either on your system `PATH` or configured via `verilog.linting.path`

## Features

- **Lint on open and save** for `.v`, `.vh`, `.sv`, and `.svh` files
- **Inline diagnostics** - errors and warnings shown directly in the editor gutter and Problems panel
- **SystemVerilog support** - automatically passes `-sv` flag for `.sv`/`.svh` files
- **Configurable include paths** - resolve workspace-relative or absolute include directories
- **Manual lint command** - trigger linting on demand via the Command Palette

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `verilog.linting.path` | `string` | `""` | Directory containing the `xvlog` binary. Leave empty if `xvlog` is on your PATH. |
| `verilog.linting.xvlog.enabled` | `boolean` | `true` | Enable or disable the linter. |
| `verilog.linting.xvlog.arguments` | `string` | `""` | Extra CLI arguments passed to `xvlog`. |
| `verilog.linting.xvlog.includePath` | `string[]` | `[]` | Include paths. Relative paths resolve from the workspace root. |
| `verilog.linting.xvlog.runAtFileLocation` | `boolean` | `false` | Run `xvlog` in the file's directory instead of the workspace root. |

### Example `.vscode/settings.json`

```json
{
  "verilog.linting.path": "/tools/Xilinx/Vivado/2023.2/bin",
  "verilog.linting.xvlog.enabled": true,
  "verilog.linting.xvlog.arguments": "--define SIMULATION",
  "verilog.linting.xvlog.includePath": [
    "rtl/include",
    "ip/headers"
  ],
  "verilog.linting.xvlog.runAtFileLocation": false
}
```

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command | Description |
|---|---|
| `Verilog: xvlog: Lint Current File` | Manually trigger linting on the active file |
| `Verilog: xvlog: Clear Diagnostics` | Remove all xvlog diagnostics from the Problems panel |

## Known Issues

- `xvlog` writes a `xvlog.pb` database file and `xvlog.dir/` folder in the working directory each time it runs. These can be safely deleted and are excluded via `.gitignore`.
- On Windows with WSL, set `verilog.linting.path` to the WSL-accessible path (e.g. `/mnt/c/Xilinx/Vivado/2023.2/bin`) and ensure your terminal profile uses WSL.
- `xvlog` does not support linting a file in isolation when it has unresolved cross-file dependencies - use `verilog.linting.xvlog.includePath` to point at your include directories.

## Release Notes

### 0.0.1

Initial release - lint on open/save, SystemVerilog support, configurable include paths and arguments.
