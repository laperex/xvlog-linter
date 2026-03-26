// SPDX-License-Identifier: MIT
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

import XvlogLinter, { parseDiagnostics } from '../XvlogLinter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal vscode.TextDocument stub */
function makeDoc(
	content: string,
	languageId: 'verilog' | 'systemverilog' = 'verilog',
	fileName = '/workspace/top.v'
): vscode.TextDocument {
	return {
		uri: vscode.Uri.file(fileName),
		fileName,
		languageId,
		getText: () => content,
	} as unknown as vscode.TextDocument;
}

/** Minimal DiagnosticCollection stub */
function makeDiagCollection() {
	const store = new Map<string, vscode.Diagnostic[]>();
	return {
		set: (uri: vscode.Uri, diags: vscode.Diagnostic[]) => store.set(uri.toString(), diags),
		delete: (uri: vscode.Uri) => store.delete(uri.toString()),
		clear: () => store.clear(),
		get: (uri: vscode.Uri) => store.get(uri.toString()) ?? [],
		store,
	} as unknown as vscode.DiagnosticCollection & { store: Map<string, vscode.Diagnostic[]> };
}

/** Build a fake ChildProcess that emits stdout then closes */
function makeFakeProcess(stdout: string): childProcess.ChildProcess {
	const proc = new EventEmitter() as childProcess.ChildProcess;
	(proc as any).killed = false;
	proc.kill = () => {
		(proc as any).killed = true;
		return true;
	};
	return proc;
}

// ---------------------------------------------------------------------------
// parseDiagnostics - pure unit tests (no VS Code runtime needed)
// ---------------------------------------------------------------------------

suite('parseDiagnostics', () => {
	test('parses a single ERROR line', () => {
		const stdout = `ERROR: [VRFC 10-91] some error message [/workspace/top.v:5]`;
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags.length, 1);
		assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
		assert.strictEqual(diags[0].code, 'VRFC 10-91');
		assert.strictEqual(diags[0].message, '[VRFC 10-91] some error message');
		assert.strictEqual(diags[0].range.start.line, 4); // 1-indexed -> 0-indexed
		assert.strictEqual(diags[0].source, 'xvlog');
	});

	test('parses a WARNING line', () => {
		const stdout = `WARNING: [VRFC 10-2] implicit wire declaration [/workspace/top.v:10]`;
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags.length, 1);
		assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Warning);
	});

	test('parses multiple diagnostics', () => {
		const stdout = [
			`ERROR: [VRFC 10-91] error one [/workspace/top.v:1]`,
			`WARNING: [VRFC 10-2] warning one [/workspace/top.v:2]`,
			`ERROR: [VRFC 10-91] error two [/workspace/top.v:3]`,
		].join('\n');
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags.length, 3);
	});

	test('ignores non-matching lines', () => {
		const stdout = [
			`INFO: Parsing design units from '/workspace/top.v'`,
			`ERROR: [VRFC 10-91] real error [/workspace/top.v:2]`,
			``,
			`xvlog: Number of errors: 1`,
		].join('\n');
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags.length, 1);
	});

	test('returns empty array for empty stdout', () => {
		assert.strictEqual(parseDiagnostics('').length, 0);
	});

	test('handles Windows CRLF line endings', () => {
		const stdout = `ERROR: [VRFC 10-91] an error [/workspace/top.v:3]\r\nWARNING: [VRFC 10-2] a warning [/workspace/top.v:4]\r\n`;
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags.length, 2);
	});

	test('range spans full line', () => {
		const stdout = `ERROR: [VRFC 10-91] err [/workspace/top.v:1]`;
		const diags = parseDiagnostics(stdout);
		assert.strictEqual(diags[0].range.end.character, Number.MAX_VALUE);
	});
});

// ---------------------------------------------------------------------------
// XvlogLinter - integration-style tests with stubs
// ---------------------------------------------------------------------------

suite('XvlogLinter', () => {
	let sandbox: sinon.SinonSandbox;
	let execFileStub: sinon.SinonStub;
	let diagCollection: vscode.DiagnosticCollection & { store: Map<string, vscode.Diagnostic[]> };
	let linter: XvlogLinter;

	setup(() => {
		sandbox = sinon.createSandbox();

		// Stub execFile so no real xvlog process is spawned
		execFileStub = sandbox.stub(childProcess, 'execFile');

		// Stub VS Code workspace config
		sandbox.stub(vscode.workspace, 'getConfiguration').returns({
			get: (key: string, def: unknown) => def,
			has: () => false,
			inspect: () => undefined,
			update: async () => { },
		} as unknown as vscode.WorkspaceConfiguration);

		sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({ dispose: () => { } });

		diagCollection = makeDiagCollection() as any;
		linter = new XvlogLinter(diagCollection);
	});

	teardown(() => {
		linter.dispose();
		sandbox.restore();
	});

	test('calls execFile with -nolog for verilog', (done) => {
		const doc = makeDoc('module top; endmodule', 'verilog');

		execFileStub.callsFake((_bin: string, args: string[], _opts: object, cb: Function) => {
			assert.ok(args.includes('-nolog'));
			assert.ok(!args.includes('-sv'));
			cb(null, '', '');
			done();
			return makeFakeProcess('');
		});

		// Bypass debounce for test speed
		(linter as any).lint(doc);
	});

	test('passes -sv flag for systemverilog', (done) => {
		const doc = makeDoc('module top; endmodule', 'systemverilog', '/workspace/top.sv');

		execFileStub.callsFake((_bin: string, args: string[], _opts: object, cb: Function) => {
			assert.ok(args.includes('-sv'));
			cb(null, '', '');
			done();
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
	});

	test('writes temp file with document content', (done) => {
		const content = 'module foo; endmodule';
		const doc = makeDoc(content, 'verilog');
		let writtenContent = '';

		const writeStub = sandbox.stub(fs, 'writeFileSync').callsFake((_p, data) => {
			writtenContent = data as string;
		});

		execFileStub.callsFake((_bin: string, _args: string[], _opts: object, cb: Function) => {
			assert.strictEqual(writtenContent, content);
			writeStub.restore();
			cb(null, '', '');
			done();
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
	});

	test('lints temp file path, not original doc.fileName', (done) => {
		const doc = makeDoc('module top; endmodule', 'verilog', '/workspace/top.v');
		sandbox.stub(fs, 'writeFileSync');

		execFileStub.callsFake((_bin: string, args: string[], _opts: object, cb: Function) => {
			const lintedFile: string = args[args.length - 1];
			assert.ok(!lintedFile.includes('/workspace/top.v'), 'should lint temp file, not source file');
			assert.ok(lintedFile.endsWith('.v'), 'temp file should have .v extension');
			cb(null, '', '');
			done();
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
	});

	test('skips lint when content is unchanged', () => {
		const doc = makeDoc('module top; endmodule', 'verilog');
		sandbox.stub(fs, 'writeFileSync');

		execFileStub.callsFake((_b: string, _a: string[], _o: object, cb: Function) => {
			cb(null, '', '');
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
		const callsAfterFirst = execFileStub.callCount;

		(linter as any).lint(doc); // same content
		assert.strictEqual(execFileStub.callCount, callsAfterFirst, 'should not call execFile again');
	});

	test('re-lints when content changes', () => {
		sandbox.stub(fs, 'writeFileSync');
		execFileStub.callsFake((_b: string, _a: string[], _o: object, cb: Function) => {
			cb(null, '', '');
			return makeFakeProcess('');
		});

		(linter as any).lint(makeDoc('module top; endmodule', 'verilog'));
		(linter as any).lint(makeDoc('module top2; endmodule', 'verilog')); // different content

		assert.strictEqual(execFileStub.callCount, 2);
	});

	test('kills in-flight process before starting new lint', () => {
		sandbox.stub(fs, 'writeFileSync');
		const fakeProc = makeFakeProcess('');
		execFileStub.returns(fakeProc);

		// First lint - starts a process
		(linter as any).lint(makeDoc('module a; endmodule', 'verilog'));
		assert.ok((linter as any).runningProcess, 'process should be running');

		// Second lint with different content - should kill the first
		(linter as any).lint(makeDoc('module b; endmodule', 'verilog'));
		assert.ok((fakeProc as any).killed, 'previous process should be killed');
	});

	test('sets diagnostics on the collection after successful lint', (done) => {
		const doc = makeDoc('module top; endmodule', 'verilog');
		const stdout = `ERROR: [VRFC 10-91] undeclared symbol [${doc.fileName}:3]`;
		sandbox.stub(fs, 'writeFileSync');

		execFileStub.callsFake((_b: string, _a: string[], _o: object, cb: Function) => {
			cb(null, stdout, '');
			const diags = diagCollection.store.get(doc.uri.toString()) ?? [];
			assert.strictEqual(diags.length, 1);
			assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
			done();
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
	});

	test('clears diagnostics and content cache on removeFileDiagnostics', () => {
		const doc = makeDoc('module top; endmodule', 'verilog');
		sandbox.stub(fs, 'writeFileSync');

		execFileStub.callsFake((_b: string, _a: string[], _o: object, cb: Function) => {
			cb(null, `ERROR: [VRFC 10-91] err [${doc.fileName}:1]`, '');
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
		linter.removeFileDiagnostics(doc);

		assert.strictEqual(diagCollection.store.has(doc.uri.toString()), false);
		assert.strictEqual((linter as any).lastLintedContent.has(doc.uri.toString()), false);
	});

	test('dispose kills running process and removes workDir', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xvlog-test-'));
		(linter as any).workDir = tmpDir;

		const fakeProc = makeFakeProcess('');
		(linter as any).runningProcess = fakeProc;

		linter.dispose();

		assert.ok((fakeProc as any).killed, 'process should be killed on dispose');
		assert.ok(!fs.existsSync(tmpDir), 'work dir should be removed on dispose');
	});

	test('passes maxBuffer option to execFile', (done) => {
		const doc = makeDoc('module top; endmodule', 'verilog');
		sandbox.stub(fs, 'writeFileSync');

		execFileStub.callsFake((_b: string, _a: string[], opts: any, cb: Function) => {
			assert.strictEqual(opts.maxBuffer, 10 * 1024 * 1024);
			cb(null, '', '');
			done();
			return makeFakeProcess('');
		});

		(linter as any).lint(doc);
	});
});