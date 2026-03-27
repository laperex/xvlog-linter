// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Verible with compact_indexing_and_selections=true produces [IP_WIDTH-1:0].
 * This adds spaces around binary operators inside [] while leaving : alone,
 * giving [IP_WIDTH - 1:0].
 */
function postProcessBitSelections(text: string): string {
    return text.replace(/\[([^\]]*)\]/g, (_match, inner) => {
        const processed = inner
            .replace(/(\w)\s*-\s*(\w)/g, '$1 - $2')
            .replace(/(\w)\s*\+\s*(\w)/g, '$1 + $2')
            .replace(/(\w)\s*\*\s*(\w)/g, '$1 * $2')
            .replace(/:\s*/g, ': ');
        return `[${processed}]`;
    });
}


interface FormatterConfig {
    installedPath: string;
    arguments: string[];
}

interface Logger {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}

function createLogger(category: string[]): Logger {
    const prefix = `[${category.join('.')}]`;
    return {
        info:  (msg, meta) => console.log(`${prefix} INFO: ${msg}`,  meta ?? ''),
        warn:  (msg, meta) => console.warn(`${prefix} WARN: ${msg}`, meta ?? ''),
        error: (msg, meta) => console.error(`${prefix} ERROR: ${msg}`, meta ?? ''),
    };
}

export default class VeribleFormatter
    implements vscode.DocumentFormattingEditProvider
{
    private readonly logger: Logger;
    private config: FormatterConfig = {
        installedPath: '',
        arguments: [],
    };

    constructor() {
        this.logger = createLogger(['Verilog', 'Formatter', 'verible']);
        vscode.workspace.onDidChangeConfiguration(() => this.loadConfig());
        this.loadConfig();
    }

    private loadConfig(): void {
        this.config.installedPath = vscode.workspace
            .getConfiguration()
            .get<string>('verible.path', '');

        const rawArgs = vscode.workspace
            .getConfiguration('verible.formatting')
            .get<string>('arguments', '')
            .trim();

        this.config.arguments = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];
    }

    private get resolvedBin(): string {
        return this.config.installedPath
            ? path.join(this.config.installedPath, 'verible-verilog-format')
            : 'verible-verilog-format';
    }

    private validateBinary(): boolean {
        try {
            if (this.config.installedPath) {
                fs.accessSync(this.resolvedBin, fs.constants.X_OK);
            }
            return true;
        } catch {
            vscode.window.showErrorMessage(
                `xvlog-linter: Cannot find verible-verilog-format at "${this.resolvedBin}". ` +
                `Check the verible.path setting.`
            );
            return false;
        }
    }

    public provideDocumentFormattingEdits(
        doc: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        if (!this.validateBinary()) {
            return Promise.resolve([]);
        }

        // Pass the real filename via --stdin_name so verible can apply
        // file-type-specific rules, then read the document content from stdin.
        // This means unsaved buffer content is always what gets formatted.
        const args: string[] = [
            `--stdin_name=${doc.uri.fsPath}`,
            ...this.config.arguments,
            '-', // read from stdin
        ];

        this.logger.info(`Executing: ${this.resolvedBin} ${args.join(' ')}`);

        return new Promise((resolve) => {
            const child = spawn(this.resolvedBin, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            // Cancel support - kill the process if the user triggers another format.
            const cancelDisposable = token.onCancellationRequested(() => {
                child.kill();
                this.logger.warn('Formatting cancelled');
                resolve([]);
            });

            // Feed the live buffer content to verible via stdin.
            child.stdin.write(doc.getText(), 'utf8');
            child.stdin.end();

            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
            child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

            child.on('close', (code) => {
                cancelDisposable.dispose();

                if (code !== 0) {
                    // verible writes parse errors to stderr
                    const reason = stderr.trim() || `exit code ${code}`;
                    this.logger.error('verible-verilog-format failed', { reason });
                    vscode.window.showErrorMessage(
                        `xvlog-linter: Formatting failed - ${reason}`
                    );
                    resolve([]);
                    return;
                }
				
				const formatted = postProcessBitSelections(stdout);

                if (formatted === doc.getText()) {
                    // Nothing changed - return empty to avoid a dirty buffer.
                    this.logger.info('No formatting changes');
                    resolve([]);
                    return;
                }

                // Replace the entire document with the formatted output.
                const fullRange = new vscode.Range(
                    doc.lineAt(0).range.start,
                    doc.lineAt(doc.lineCount - 1).range.end
                );
                this.logger.info('Formatting applied');
                resolve([vscode.TextEdit.replace(fullRange, formatted)]);
            });

            child.on('error', (err) => {
                cancelDisposable.dispose();
                this.logger.error('Failed to spawn verible', { message: err.message });
                vscode.window.showErrorMessage(
                    `xvlog-linter: Failed to run verible-verilog-format - ${err.message}`
                );
                resolve([]);
            });
        });
    }
}