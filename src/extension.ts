// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import XvlogLinter from './XvlogLinter';

const SUPPORTED_LANGUAGES = ['verilog', 'systemverilog'];

let linter: XvlogLinter | undefined;

export function activate(context: vscode.ExtensionContext): void {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('xvlog');
    context.subscriptions.push(diagnosticCollection);

    linter = new XvlogLinter(diagnosticCollection);

    // Lint on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (isSupported(doc) && isEnabled()) {
                linter!.startLint(doc);
            }
        })
    );

    // Lint as the user types — debounce inside XvlogLinter prevents over-firing.
    // Content hashing ensures xvlog is only invoked when content actually changes.
    // onDidSaveTextDocument is intentionally omitted: saves are already covered
    // because saving triggers onDidChangeTextDocument with the final content.
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (isSupported(e.document) && isEnabled()) {
                linter!.startLint(e.document);
            }
        })
    );

    // Clear diagnostics when a file is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            if (isSupported(doc)) {
                linter!.removeFileDiagnostics(doc);
            }
        })
    );

    // Command: manually lint the active file
    context.subscriptions.push(
        vscode.commands.registerCommand('xvlog-linter.lint', () => {
            const doc = vscode.window.activeTextEditor?.document;
            if (!doc) {
                vscode.window.showWarningMessage('xvlog: No active file to lint.');
                return;
            }
            if (!isSupported(doc)) {
                vscode.window.showWarningMessage(
                    'xvlog: Active file is not a Verilog or SystemVerilog file.'
                );
                return;
            }
            linter!.startLint(doc);
        })
    );

    // Command: clear all diagnostics
    context.subscriptions.push(
        vscode.commands.registerCommand('xvlog-linter.clearDiagnostics', () => {
            diagnosticCollection.clear();
        })
    );

    // Lint any already-open supported documents on activation
    vscode.workspace.textDocuments.forEach((doc) => {
        if (isSupported(doc) && isEnabled()) {
            linter!.startLint(doc);
        }
    });
}

export function deactivate(): void {
    linter?.dispose();
    linter = undefined;
}

function isSupported(doc: vscode.TextDocument): boolean {
    return SUPPORTED_LANGUAGES.includes(doc.languageId);
}

function isEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('verilog.linting.xvlog')
        .get<boolean>('enabled', true);
}