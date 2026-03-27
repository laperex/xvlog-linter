# xvlog linter

Lint and format Verilog and SystemVerilog files directly in VS Code using Xilinx's `xvlog` (Vivado) and Google's `verible-verilog-format`. Errors and warnings appear inline in your editor and in the **Problems** panel as you work.

## Requirements

- `xvlog` must be accessible - either on your system `PATH` or configured via `xvlog.path`
- `verible-verilog-format` must be accessible - either on your system `PATH` or configured via `verible.path` (only required for formatting)

## Features

- **Lint on open and change** for `.v`, `.vh`, `.sv`, `.svh`, and `.svi` files
- **Live buffer linting** - unsaved changes are linted immediately, no save required
- **Inline diagnostics** - errors and warnings shown directly in the editor gutter and Problems panel
- **SystemVerilog support** - automatically passes `-sv` flag for `.sv`/`.svh`/`.svi` files
- **Format Document** (`Shift+Alt+F`) using `verible-verilog-format`
- **Configurable include paths** - resolve workspace-relative or absolute include directories
- **Auto include** - optionally add the file's own directory to the include path automatically
- **Manual lint command** - trigger linting on demand via the Command Palette

## Extension Settings

### xvlog (linter)

| Setting | Type | Default | Description |
|---|---|---|---|
| `xvlog.path` | `string` | `""` | Directory containing the `xvlog` binary. Leave empty if `xvlog` is on your PATH. |
| `xvlog.linting.enabled` | `boolean` | `true` | Enable or disable the linter. |
| `xvlog.linting.arguments` | `string` | `""` | Extra CLI arguments passed to `xvlog`. |
| `xvlog.linting.includePath` | `string[]` | `[]` | Include paths. Relative paths resolve from the workspace root. |
| `xvlog.linting.addFileLocationToIncludePath` | `boolean` | `true` | Automatically add the directory of the file being linted to the include path. |
| `xvlog.linting.runAtFileLocation` | `boolean` | `false` | Run `xvlog` in the file's directory instead of the temp dir. |

### verible (formatter)

| Setting | Type | Default | Description |
|---|---|---|---|
| `verible.path` | `string` | `""` | Directory containing `verible-verilog-format`. Leave empty if verible is on your PATH. |
| `verible.formatting.arguments` | `string` | `""` | Extra CLI arguments passed to `verible-verilog-format`. |

### Example `.vscode/settings.json`
```json
{
    "xvlog.path": "/tools/Xilinx/Vivado/2024.1/bin",
    "xvlog.linting.enabled": true,
    "xvlog.linting.arguments": "--define SIMULATION",
    "xvlog.linting.includePath": [
        "rtl/include",
        "ip/headers"
    ],
    "xvlog.linting.addFileLocationToIncludePath": true,
    "xvlog.linting.runAtFileLocation": false,

    "verible.path": "/tools/verible/bin",
    "verible.formatting.arguments": "--indentation_spaces=4 --named_port_indentation=indent --named_parameter_indentation=indent --port_declarations_indentation=indent --failsafe_success=false"
}
```

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command | Description |
|---|---|
| `xvlog: Lint Current File` | Manually trigger linting on the active file |
| `xvlog: Clear Diagnostics` | Remove all xvlog diagnostics from the Problems panel |

Formatting is triggered via the standard **Format Document** command (`Shift+Alt+F`) or automatically on save if `editor.formatOnSave` is enabled.

## Known Issues

- `xvlog` does not support linting a file in isolation when it has unresolved cross-file dependencies - use `xvlog.linting.includePath` or enable `xvlog.linting.addFileLocationToIncludePath` to point at your include directories.
- Verible alignment flags (`--port_declarations_alignment`, `--named_port_alignment`) fire inconsistently depending on verible's internal grouping heuristic and are not recommended.

## Release Notes

### 0.0.4
- Added verible formatter with Format Document support
- Live buffer linting - unsaved changes linted immediately
- `xsim.dir` isolated to temp directory, workspace root stays clean
- Added `addFileLocationToIncludePath` setting
- Implemented `runAtFileLocation` (was previously declared but had no effect)
- Binary validation with clear error messages

### 0.0.1
Initial release - lint on open/save, SystemVerilog support, configurable include paths and arguments.