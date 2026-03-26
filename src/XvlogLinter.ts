// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { execFile, ExecFileException } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const MAX_BUFFER = 10 * 1024 * 1024;

interface LinterConfig {
	linterInstalledPath: string;
	arguments: string[];
	includePath: string[];
	addFileLocationToIncludePath: boolean;
	runAtFileLocation: boolean;
}

interface Logger {
	info(msg: string, meta?: Record<string, unknown>): void;
	warn(msg: string, meta?: Record<string, unknown>): void;
	error(msg: string, meta?: Record<string, unknown>): void;
}

function createLogger(category: string[]): Logger {
	const prefix = `[${category.join('.')}]`;
	return {
		info: (msg, meta) => console.log(`${prefix} INFO: ${msg}`, meta ?? ''),
		warn: (msg, meta) => console.warn(`${prefix} WARN: ${msg}`, meta ?? ''),
		error: (msg, meta) => console.error(`${prefix} ERROR: ${msg}`, meta ?? ''),
	};
}

export function parseDiagnostics(stdout: string): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];
	for (const line of stdout.split(/\r?\n/g)) {
		const match = line.match(
			/^(ERROR|WARNING):\s+\[(VRFC\b[^\]]*)\]\s+(.*\S)\s+\[(.*):(\d+)\]\s*$/
		);
		if (!match) {
			continue;
		}
		const lineno = parseInt(match[5], 10) - 1;
		diagnostics.push({
			severity: match[1] === 'ERROR'
				? vscode.DiagnosticSeverity.Error
				: vscode.DiagnosticSeverity.Warning,
			code: match[2],
			message: `[${match[2]}] ${match[3]}`,
			range: new vscode.Range(lineno, 0, lineno, Number.MAX_VALUE),
			source: 'xvlog',
		});
	}
	return diagnostics;
}

export default class XvlogLinter {
	private readonly diagnosticCollection: vscode.DiagnosticCollection;
	private readonly logger: Logger;
	private config: LinterConfig = {
		linterInstalledPath: '',
		arguments: [],
		includePath: [],
		addFileLocationToIncludePath: false,
		runAtFileLocation: false,
	};

	/** Persistent temp dir - reused across lints, deleted only on dispose. */
	private workDir: string | undefined;

	constructor(diagnosticCollection: vscode.DiagnosticCollection) {
		this.diagnosticCollection = diagnosticCollection;
		this.logger = createLogger(['Verilog', 'Linter', 'xvlog']);
		vscode.workspace.onDidChangeConfiguration(() => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig(): void {
		this.config.linterInstalledPath = vscode.workspace
			.getConfiguration()
			.get<string>('xvlog.path', '');

		const xvlog = vscode.workspace.getConfiguration('xvlog.linting');

		const rawArgs = xvlog.get<string>('arguments', '').trim();
		this.config.arguments = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];

		this.config.includePath = xvlog
			.get<string[]>('includePath', [])
			.map((p) => this.resolveWorkspacePath(p));

		this.config.addFileLocationToIncludePath =
			xvlog.get<boolean>('addFileLocationToIncludePath', false);

		this.config.runAtFileLocation =
			xvlog.get<boolean>('runAtFileLocation', false);
	}

	private resolveWorkspacePath(inputPath: string): string {
		if (path.isAbsolute(inputPath)) {
			return inputPath;
		}
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		return root ? path.join(root, inputPath) : inputPath;
	}

	/**
	 * Returns the persistent temp working directory, creating it on first call.
	 * Reusing the same dir lets xvlog warm its xsim.dir cache across lints.
	 */
	private getWorkDir(): string {
		if (!this.workDir) {
			this.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xvlog-'));
			this.logger.info(`Created work dir: ${this.workDir}`);
		}
		return this.workDir;
	}

	public dispose(): void {
		if (this.workDir) {
			fs.rmSync(this.workDir, { recursive: true, force: true });
			this.workDir = undefined;
		}
		this.diagnosticCollection.clear();
	}

	public lint(doc: vscode.TextDocument): void {
		const resolvedBin = this.config.linterInstalledPath
			? path.join(this.config.linterInstalledPath, 'xvlog')
			: 'xvlog';

		// Verify the binary exists before spawning and surface a clear error.
		try {
			if (this.config.linterInstalledPath) {
				fs.accessSync(resolvedBin, fs.constants.X_OK);
			}
		} catch {
			vscode.window.showErrorMessage(
				`xvlog-linter: Cannot find xvlog at "${resolvedBin}". ` +
				`Check the xvlog.path setting.`
			);
			return;
		}

		const workDir = this.getWorkDir();

		// Write the live buffer to a temp file so unsaved changes are linted.
		const ext = doc.languageId === 'systemverilog' ? '.sv' : '.v';
		const tmpFile = path.join(workDir, `lint_input${ext}`);
		fs.writeFileSync(tmpFile, doc.getText(), 'utf8');

		// Build include path list.
		const includePaths = [...this.config.includePath];
		if (this.config.addFileLocationToIncludePath) {
			const fileDir = path.dirname(doc.uri.fsPath);
			if (!includePaths.includes(fileDir)) {
				includePaths.push(fileDir);
			}
		}

		// Build argument list.
		const args: string[] = ['-nolog'];
		if (doc.languageId === 'systemverilog') {
			args.push('-sv');
		}
		includePaths.forEach((p) => args.push('-i', p));
		args.push(...this.config.arguments);
		args.push(tmpFile);

		// runAtFileLocation: run xvlog from the source file's directory instead
		// of the temp dir. Useful when relative `include paths in the source
		// file itself need to resolve from the original location.
		const cwd = this.config.runAtFileLocation
			? path.dirname(doc.uri.fsPath)
			: workDir;

		this.logger.info(`Executing: ${resolvedBin} ${args.join(' ')}`, { cwd });

		execFile(
			resolvedBin,
			args,
			{ cwd, maxBuffer: MAX_BUFFER },
			(error: ExecFileException | null, stdout: string, _stderr: string) => {
				// execFile errors on non-zero exit, which xvlog does whenever it
				// finds lint errors. Only treat it as a real failure when there
				// is no stdout to parse (i.e. the binary failed to run at all).
				if (error && !stdout) {
					this.logger.error('xvlog failed to run', { message: error.message });
					vscode.window.showErrorMessage(
						`xvlog-linter: xvlog failed to run - ${error.message}`
					);
					return;
				}

				const diagnostics = parseDiagnostics(stdout);
				this.logger.info(`${diagnostics.length} diagnostics returned`);
				this.diagnosticCollection.set(doc.uri, diagnostics);
			}
		);
	}

	public removeFileDiagnostics(doc: vscode.TextDocument): void {
		this.diagnosticCollection.delete(doc.uri);
	}
}