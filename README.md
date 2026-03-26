# xvlog linter

Lint Verilog and SystemVerilog files directly in VS Code using Xilinx's `xvlog` tool, part of Vivado and Vivado Lab Edition. Errors and warnings appear inline in your editor and in the **Problems** panel as you work.

## Requirements

- `xvlog` must be accessible - either on your system `PATH` or configured via `xvlog.path`

## Features

- **Lint on open and save** for `.v`, `.vh`, `.sv`, and `.svh` files
- **Inline diagnostics** - errors and warnings shown directly in the editor gutter and Problems panel
- **SystemVerilog support** - automatically passes `-sv` flag for `.sv`/`.svh` files
- **Configurable include paths** - resolve workspace-relative or absolute include directories
- **Manual lint command** - trigger linting on demand via the Command Palette

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `xvlog.path` | `string` | `""` | Directory containing the `xvlog` binary. Leave empty if `xvlog` is on your PATH. |
| `xvlog.linting.enabled` | `boolean` | `true` | Enable or disable the linter. |
| `xvlog.linting.arguments` | `string` | `""` | Extra CLI arguments passed to `xvlog`. |
| `xvlog.linting.includePath` | `string[]` | `[]` | Include paths. Relative paths resolve from the workspace root. |
| `xvlog.linting.runAtFileLocation` | `boolean` | `false` | Run `xvlog` in the file's directory instead of the workspace root. |

### Example `.vscode/settings.json`

```json
{
  "xvlog.path": "/tools/Xilinx/Vivado/2023.2/bin",
  "xvlog.linting.enabled": true,
  "xvlog.linting.arguments": "--define SIMULATION",
  "xvlog.linting.includePath": [
    "rtl/include",
    "ip/headers"
  ],
  "xvlog.linting.runAtFileLocation": false
}
```

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command | Description |
|---|---|
| `Verilog: xvlog: Lint Current File` | Manually trigger linting on the active file |
| `Verilog: xvlog: Clear Diagnostics` | Remove all xvlog diagnostics from the Problems panel |

## Known Issues

- `xvlog` does not support linting a file in isolation when it has unresolved cross-file dependencies - use `xvlog.linting.includePath` to point at your include directories.

## Release Notes

### 0.0.1

Initial release - lint on open/save, SystemVerilog support, configurable include paths and arguments.
