// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { execFile, ExecFileException, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB — prevents truncation on files with many errors
const DEBOUNCE_MS = 500;

interface LinterConfig {
	linterInstalledPath: string;
	arguments: string;
	includePath: string[];
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
	stdout.split(/\r?\n/g).forEach((line) => {
		const match = line.match(
			/^(ERROR|WARNING):\s+\[(VRFC\b[^\]]*)\]\s+(.*\S)\s+\[(.*):(\d+)\]\s*$/
		);
		if (!match) {
			return;
		}
		const lineno = parseInt(match[5]) - 1;
		diagnostics.push({
			severity:
				match[1] === 'ERROR'
					? vscode.DiagnosticSeverity.Error
					: vscode.DiagnosticSeverity.Warning,
			code: match[2],
			message: `[${match[2]}] ${match[3]}`,
			range: new vscode.Range(lineno, 0, lineno, Number.MAX_VALUE),
			source: 'xvlog',
		});
	});
	return diagnostics;
}

export default class XvlogLinter {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private logger: Logger;
	private config: LinterConfig = {
		linterInstalledPath: '',
		arguments: '',
		includePath: [],
	};

	/** Persistent temp dir reused across lints so xvlog can warm its xsim.dir cache. */
	private workDir: string | undefined;

	/** Debounce timer — prevents firing xvlog on every keystroke. */
	private debounceTimer: NodeJS.Timeout | undefined;

	/** Currently running xvlog process — killed when a newer lint supersedes it. */
	private runningProcess: ChildProcess | undefined;

	/** Last linted content per document URI — skips xvlog when nothing changed. */
	private lastLintedContent = new Map<string, string>();

	constructor(diagnosticCollection: vscode.DiagnosticCollection) {
		this.diagnosticCollection = diagnosticCollection;
		this.logger = createLogger(['Verilog', 'Linter', 'xvlog']);

		vscode.workspace.onDidChangeConfiguration(() => {
			this.loadConfig();
		});

		this.loadConfig();
	}

	private loadConfig(): void {
		this.config.linterInstalledPath = vscode.workspace
			.getConfiguration()
			.get<string>('verilog.linting.path', '');

		const xvlog = vscode.workspace.getConfiguration('verilog.linting.xvlog');
		this.config.arguments = xvlog.get<string>('arguments', '');
		this.config.includePath = xvlog
			.get<string[]>('includePath', [])
			.map((p) => this.resolvePath(p));
	}

	private resolvePath(inputPath: string): string {
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

	/** Cleans up all resources. Call from extension deactivate(). */
	public dispose(): void {
		clearTimeout(this.debounceTimer);
		this.runningProcess?.kill();
		this.runningProcess = undefined;
		if (this.workDir) {
			fs.rmSync(this.workDir, { recursive: true, force: true });
			this.workDir = undefined;
		}
		this.lastLintedContent.clear();
	}

	public startLint(doc: vscode.TextDocument): void {
		clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => this.lint(doc), DEBOUNCE_MS);
	}

	private lint(doc: vscode.TextDocument): void {
		// Content hash skip — bail early if nothing has changed since the last lint.
		const content = doc.getText();
		const key = doc.uri.toString();
		if (this.lastLintedContent.get(key) === content) {
			this.logger.info('Content unchanged, skipping lint');
			return;
		}
		this.lastLintedContent.set(key, content);

		// Kill any in-flight xvlog process that this lint supersedes.
		if (this.runningProcess) {
			this.runningProcess.kill();
			this.runningProcess = undefined;
			this.logger.info('Killed previous in-flight lint process');
		}

		const workDir = this.getWorkDir();

		// Write current (possibly unsaved) buffer content to a temp file so xvlog
		// always lints what is in the editor, not just what is on disk.
		const ext = doc.languageId === 'systemverilog' ? '.sv' : '.v';
		const tmpFile = path.join(workDir, `lint_input${ext}`);
		fs.writeFileSync(tmpFile, content, 'utf8');

		const binPath = path.join(this.config.linterInstalledPath, 'xvlog');
		const args: string[] = ['-nolog'];

		if (doc.languageId === 'systemverilog') {
			args.push('-sv');
		}

		this.config.includePath.forEach((p) => args.push('-i', p));

		if (this.config.arguments.trim().length > 0) {
			args.push(...this.config.arguments.trim().split(/\s+/));
		}

		args.push(tmpFile);

		this.logger.info(`Executing: ${binPath} ${args.join(' ')}`, { cwd: workDir });

		this.runningProcess = execFile(
			binPath,
			args,
			{ cwd: workDir, maxBuffer: MAX_BUFFER },
			(_error: ExecFileException | null, stdout: string, _stderr: string) => {
				this.runningProcess = undefined;

				const diagnostics = parseDiagnostics(stdout);
				this.logger.info(`${diagnostics.length} errors/warnings returned`);
				this.diagnosticCollection.set(doc.uri, diagnostics);
			}
		);
	}

	public removeFileDiagnostics(doc: vscode.TextDocument): void {
		this.lastLintedContent.delete(doc.uri.toString());
		this.diagnosticCollection.delete(doc.uri);
	}
}