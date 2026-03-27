# Change Log

## [0.0.4]
### Added
- **Verible formatter** - Format Document (`Shift+Alt+F`) now formats Verilog and SystemVerilog files using `verible-verilog-format`
- **`verible.path`** - configure the directory containing `verible-verilog-format`
- **`verible.formatting.arguments`** - pass additional CLI arguments to verible
- **`xvlog.linting.addFileLocationToIncludePath`** - automatically adds the directory of the file being linted to the xvlog include path, useful when include files sit alongside the source file
- **Language declarations** - `.v`, `.vh`, `.sv`, `.svh`, `.svi` file associations are now declared by this extension directly, removing the dependency on a separate language extension
- **Binary validation** - clear error message shown if `xvlog` or `verible-verilog-format` cannot be found at the configured path
- **`runAtFileLocation`** - previously declared in `package.json` but never implemented; now fully functional

### Changed
- Linting now runs on the **live buffer content** via a temp file, so unsaved changes are linted immediately without requiring a save
- `xsim.dir` is now isolated to a persistent temp directory for the lifetime of the VS Code session and cleaned up on deactivate, keeping the workspace root clean
- xvlog process failures (binary not found, crash) are now distinguished from lint errors (non-zero exit with diagnostics) and surfaced as error notifications

### Fixed
- Empty `arguments` string no longer passes a blank token to xvlog
- `runAtFileLocation` setting had no effect in previous versions

## [0.0.1]
### Added
- Initial release - lint on open/change, SystemVerilog support, configurable include paths and arguments