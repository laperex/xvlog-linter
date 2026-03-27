// SPDX-License-Identifier: MIT
import VeribleFormatter from './VeribleFormatter';
import * as vscode from 'vscode';
import XvlogLinter from './XvlogLinter';

const SUPPORTED_LANGUAGES = ['verilog', 'systemverilog'];
let linter: XvlogLinter | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const diagnosticCollection =
		vscode.languages.createDiagnosticCollection('xvlog');
	context.subscriptions.push(diagnosticCollection);

	linter = new XvlogLinter(diagnosticCollection);

	// Formatting provider - handles Format Document (Shift+Alt+F)
	const formatter = new VeribleFormatter();
	const formatterDisposable = vscode.languages.registerDocumentFormattingEditProvider(
		SUPPORTED_LANGUAGES.map((lang) => ({ language: lang })),
		formatter
	);
	context.subscriptions.push(formatterDisposable);

	// Lint on open
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (isSupported(doc) && isEnabled()) {
				linter!.lint(doc);
			}
		})
	);

	// Lint on change
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (isSupported(e.document) && isEnabled()) {
				linter!.lint(e.document);
			}
		})
	);

	// Clear diagnostics on close
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((doc) => {
			if (isSupported(doc)) {
				linter!.removeFileDiagnostics(doc);
			}
		})
	);

	// Command: lint active file
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
			if (!isEnabled()) {
				vscode.window.showWarningMessage(
					'xvlog: Linting is disabled. Enable it via xvlog.linting.enabled.'
				);
				return;
			}
			linter!.lint(doc);
		})
	);

	// Command: clear all diagnostics
	context.subscriptions.push(
		vscode.commands.registerCommand('xvlog-linter.clearDiagnostics', () => {
			diagnosticCollection.clear();
		})
	);

	// Lint any already-open documents on activation
	vscode.workspace.textDocuments.forEach((doc) => {
		if (isSupported(doc) && isEnabled()) {
			linter!.lint(doc);
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
		.getConfiguration('xvlog.linting')
		.get<boolean>('enabled', true);
}