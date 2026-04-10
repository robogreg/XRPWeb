/// <reference types="web-bluetooth" />
import Connection, { ConnectionState } from './connection';
import { ConnectionType } from '@/utils/types';
import ConnectionMgr from '@/managers/connectionmgr';

// ---------------------------------------------------------------------------
// Virtual File System backed by localStorage
// ---------------------------------------------------------------------------

const FS_STORAGE_KEY = 'simulation_fs';

interface SimulationVirtualFS {
    files: Record<string, string>; // absolute path → text content
    dirs: string[];                 // absolute directory paths
}

const DEFAULT_FS: SimulationVirtualFS = {
    files: {
        '/main.py': '# Main XRP program\nfrom XRPLib.defaults import *\n\n# Your code here\n',
        '/lib/XRPLib/version.py': "__version__ = '99.0.0'\n",
    },
    dirs: ['/lib', '/lib/XRPLib'],
};

function loadFS(): SimulationVirtualFS {
    try {
        const raw = localStorage.getItem(FS_STORAGE_KEY);
        if (raw) return JSON.parse(raw) as SimulationVirtualFS;
    } catch { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_FS));
}

function saveFS(fs: SimulationVirtualFS): void {
    localStorage.setItem(FS_STORAGE_KEY, JSON.stringify(fs));
}

/** Reset the virtual FS to defaults (exported so UI can call it) */
export function resetSimulationFS(): void {
    saveFS(JSON.parse(JSON.stringify(DEFAULT_FS)));
}

// ---------------------------------------------------------------------------
// Generate the FS tree string in the format expected by changeToJSON():
//   <parentDirBasename>,<idx>,<F|D>,<name>;
// (root items use "" as parentDirBasename)
// ---------------------------------------------------------------------------
function generateFSTree(): string {
    const fs = loadFS();

    type Child = { type: 'F' | 'D'; name: string };
    const tree = new Map<string, Child[]>();
    tree.set('', []);

    // Collect all dirs (explicit + inferred from file paths)
    const allDirs = new Set<string>(fs.dirs);
    for (const filePath of Object.keys(fs.files)) {
        const parts = filePath.split('/').filter(Boolean);
        for (let i = 0; i < parts.length - 1; i++) {
            allDirs.add('/' + parts.slice(0, i + 1).join('/'));
        }
    }

    // Build the tree map, keyed by dir BASENAME (matches Python walk behavior)
    const sortedDirs = Array.from(allDirs).sort(
        (a, b) => a.split('/').length - b.split('/').length,
    );
    for (const dirPath of sortedDirs) {
        const parts = dirPath.split('/').filter(Boolean);
        const name = parts[parts.length - 1];
        const parentName = parts.length > 1 ? parts[parts.length - 2] : '';

        if (!tree.has(parentName)) tree.set(parentName, []);
        if (!tree.get(parentName)!.some(c => c.name === name)) {
            tree.get(parentName)!.push({ type: 'D', name });
        }
        if (!tree.has(name)) tree.set(name, []);
    }

    // Add files, keyed by parent dir basename
    for (const filePath of Object.keys(fs.files)) {
        const parts = filePath.split('/').filter(Boolean);
        const name = parts[parts.length - 1];
        const parentName = parts.length > 1 ? parts[parts.length - 2] : '';

        if (!tree.has(parentName)) tree.set(parentName, []);
        if (!tree.get(parentName)!.some(c => c.name === name)) {
            tree.get(parentName)!.push({ type: 'F', name });
        }
    }

    // DFS to produce the output string
    let result = '';
    const visitDir = (dirBasename: string) => {
        const children = tree.get(dirBasename) ?? [];
        children.forEach((child, idx) => {
            result += `${dirBasename},${idx},${child.type},${child.name};`;
            if (child.type === 'D') visitDir(child.name);
        });
    };
    visitDir('');
    return result;
}

function generateSizeData(): string {
    const fs = loadFS();
    const usedBytes = Object.values(fs.files).reduce((s, c) => s + c.length, 0);
    const blockSize = 4096;
    const totalBlocks = 4096;
    const usedBlocks = Math.max(1, Math.ceil(usedBytes / blockSize));
    const freeBlocks = Math.max(0, totalBlocks - usedBlocks);
    return `${blockSize} ${totalBlocks} ${freeBlocks}`;
}

/** Apply a FS mutation and persist */
function mutateFSOperation(code: string): void {
    const fs = loadFS();

    if (code.includes('uos.mkdir')) {
        // buildPath: create all dirs along the path
        const m = code.match(/path\s*=\s*['"]([^'"]+)['"]/);
        if (m && m[1]) {
            const parts = m[1].split('/').filter(Boolean);
            for (let i = 1; i <= parts.length; i++) {
                const d = '/' + parts.slice(0, i).join('/');
                if (!fs.dirs.includes(d)) fs.dirs.push(d);
            }
            saveFS(fs);
        }
    } else if (code.includes('uos.rename')) {
        const m = code.match(/uos\.rename\(['"](.+?)['"]\s*,\s*['"](.+?)['"]\)/);
        if (m) {
            const [, oldPath, newPath] = m;
            if (fs.files[oldPath] !== undefined) {
                fs.files[newPath] = fs.files[oldPath];
                delete fs.files[oldPath];
            } else {
                // Rename directory tree
                Object.keys(fs.files).forEach(p => {
                    if (p.startsWith(oldPath + '/') || p === oldPath) {
                        fs.files[newPath + p.slice(oldPath.length)] = fs.files[p];
                        delete fs.files[p];
                    }
                });
                fs.dirs = fs.dirs.map(d =>
                    d === oldPath || d.startsWith(oldPath + '/')
                        ? newPath + d.slice(oldPath.length)
                        : d,
                );
            }
            saveFS(fs);
        }
    } else if (code.includes("rm('")) {
        // deleteFileOrDir: rm('/path')
        const m = code.match(/rm\(['"]([^'"]+)['"]\)/);
        if (m) {
            const delPath = m[1];
            Object.keys(fs.files).forEach(p => {
                if (p === delPath || p.startsWith(delPath + '/')) delete fs.files[p];
            });
            fs.dirs = fs.dirs.filter(d => d !== delPath && !d.startsWith(delPath + '/'));
            saveFS(fs);
        }
    }
}

// ---------------------------------------------------------------------------
// SimulationConnection
// ---------------------------------------------------------------------------

/**
 * SimulationConnection — fake XRP device for using the IDE without hardware.
 *
 * Intercepts the MicroPython REPL protocol and routes file operations through
 * a localStorage-backed virtual file system so files persist across sessions.
 */
export class SimulationConnection extends Connection {
    private rawModeBuffer = '';
    private inRawMode = false;

    // Pending file-write state (set when writeFileScript is detected)
    private pendingWritePath: string | null = null;
    private pendingWriteByteCount = 0;
    private pendingWriteAccumulator: number[] = [];

    // Fake version (99.0.0 → no update dialogs)
    private readonly FAKE_VERSION =
        'OK(99, 0, 0)\r\nRaspberry Pi Pico W with RP2040 XRP\r\n99.0.0\r\ndeadbeef1234\r\n>';

    private readonly MP_BANNER =
        'MicroPython v1.23.0 on 2024-06-02; Raspberry Pi Pico W with RP2040 XRP [SIMULATION]\r\n' +
        'Type "help()" for more information.\r\n' +
        '>>> ';

    constructor(connMgr: ConnectionMgr) {
        super();
        this.connMgr = connMgr;
    }

    // -----------------------------------------------------------------------
    // Connection lifecycle
    // -----------------------------------------------------------------------

    public async connect(): Promise<void> {
        if (this.connectionStates === ConnectionState.Connected) return;
        this.connectionStates = ConnectionState.Connected;
        this.connMgr?.connectCallback(ConnectionState.Connected, ConnectionType.SIMULATION);
    }

    public async disconnect(): Promise<void> {
        this.connectionStates = ConnectionState.Disconnected;
        this.connMgr?.connectCallback(ConnectionState.Disconnected, ConnectionType.SIMULATION);
    }

    public isConnected(): boolean {
        return this.connectionStates === ConnectionState.Connected;
    }

    public async getToREPL(): Promise<boolean> {
        return true;
    }

    // -----------------------------------------------------------------------
    // REPL protocol interception
    // -----------------------------------------------------------------------

    public async writeToDevice(str: string | Uint8Array): Promise<void> {
        const rawBytes = typeof str === 'string' ? this.textEncoder.encode(str) : str;
        const data = new TextDecoder().decode(rawBytes);

        // ── File-content capture mode ──────────────────────────────────────
        // Binary bytes are written to the device AFTER executeBuffer returns
        // 'OKstarted'. We accumulate them here until ctrl-C finalizes the write.
        if (this.pendingWritePath !== null) {
            if (data.includes('\x03')) {
                // ctrl-C from getToNormal finalizes the write
                this.finalizeFileWrite();
                this.inRawMode = false;
                this.rawModeBuffer = '';
                await this.inject('\r\n>>> ');
            } else if (data.includes('\x01')) {
                // Unexpected ctrl-A while writing — abort and go raw
                this.pendingWritePath = null;
                this.pendingWriteAccumulator = [];
                this.inRawMode = true;
                this.rawModeBuffer = '';
                await this.inject('raw REPL; CTRL-B to exit\r\n>');
            } else {
                // Accumulate content bytes (ignore 0xFF padding)
                for (const byte of rawBytes) {
                    if (this.pendingWriteByteCount === 0 ||
                        this.pendingWriteAccumulator.length < this.pendingWriteByteCount) {
                        this.pendingWriteAccumulator.push(byte);
                    }
                }
                // Auto-finalize once all expected bytes arrive
                if (this.pendingWriteByteCount > 0 &&
                    this.pendingWriteAccumulator.length >= this.pendingWriteByteCount) {
                    this.finalizeFileWrite();
                }
            }
            return;
        }

        // ── Normal REPL control character handling ─────────────────────────
        if (data.includes('\x01')) {
            // ctrl-A → enter raw mode
            this.inRawMode = true;
            this.rawModeBuffer = '';
            await this.inject('raw REPL; CTRL-B to exit\r\n>');

        } else if (data.includes('\x02')) {
            // ctrl-B → exit raw mode, show banner
            this.inRawMode = false;
            this.rawModeBuffer = '';
            await this.inject(this.MP_BANNER);

        } else if (data.includes('\x03')) {
            // ctrl-C → keyboard interrupt
            this.inRawMode = false;
            this.rawModeBuffer = '';
            await this.inject('\r\n>>> ');

        } else if (data.includes('\x04')) {
            // ctrl-D → execute buffered raw-mode code
            await this.executeBuffer();

        } else if (this.inRawMode) {
            this.rawModeBuffer += data;

        } else if (data.includes('\r')) {
            await this.inject('\r\n>>> ');
        }
    }

    // -----------------------------------------------------------------------
    // Execute buffered raw-mode Python code
    // -----------------------------------------------------------------------

    private async executeBuffer(): Promise<void> {
        const code = this.rawModeBuffer;
        this.rawModeBuffer = '';

        let response: string;

        if (code.includes('os.listdir') || code.includes('walk(')) {
            // FS tree query (getOnBoardFSTree)
            const fsData = generateFSTree();
            const sizeData = generateSizeData();
            response = `OK${fsData}\r\n${sizeData}\r\n>`;

        } else if (code.includes('sys.implementation')) {
            // Version info query (getVersionInfo / checkIfNeedUpdate)
            response = this.FAKE_VERSION;

        } else if (code.includes('###DONE READING FILE###')) {
            // File-content read (getFileContents)
            const pathMatch = code.match(/open\(['"](.+?)['"]\s*,\s*['"]rb['"]\)/);
            const filePath = pathMatch?.[1] ?? null;
            const content = filePath ? (loadFS().files[filePath] ?? '') : '';
            response = `OK${content}###DONE READING FILE###\r\n>`;

        } else if (code.includes("print('started')") && code.includes('byte_count_to_read')) {
            // File-write script (uploadFile)
            const pathMatch = code.match(/w\s*=\s*open\(['"](.+?)['"]\s*,\s*['"]wb['"]\)/);
            const byteCountMatch = code.match(/byte_count_to_read\s*=\s*(\d+)/);
            if (pathMatch?.[1]) {
                this.pendingWritePath = pathMatch[1];
                this.pendingWriteByteCount = byteCountMatch ? parseInt(byteCountMatch[1]) : 0;
                this.pendingWriteAccumulator = [];

                // Ensure parent directories exist in virtual FS
                const fs = loadFS();
                const parts = this.pendingWritePath.split('/').filter(Boolean);
                for (let i = 1; i < parts.length; i++) {
                    const d = '/' + parts.slice(0, i).join('/');
                    if (!fs.dirs.includes(d)) fs.dirs.push(d);
                }
                saveFS(fs);

                // For empty files (byteCount = 0) finalize immediately
                if (this.pendingWriteByteCount === 0) {
                    this.finalizeFileWrite();
                }
            }
            response = `OKstarted\r\n\r\n>`;

        } else if (code.includes('os.dupterm')) {
            // resetTerminal — acknowledge
            response = 'OK\r\n>';

        } else if (code.includes('isrunning')) {
            // clearIsRunning — acknowledge
            response = 'OK\r\n>';

        } else if (code.includes('uos.mkdir') || code.includes('uos.rename') || code.includes("rm('")) {
            // FS mutation operations (buildPath, renameFile, deleteFileOrDir)
            mutateFSOperation(code);
            if (code.includes('uos.rename')) {
                response = 'OKno_rename_error\r\n\r\n>';
            } else if (code.includes("rm('")) {
                response = 'OKrm_worked\r\n\r\n>';
            } else {
                response = 'OK\r\n>';
            }

        } else {
            // Generic execution — simulate print() calls
            const printOutput = this.extractPrintOutput(code);
            response = printOutput ? `OK${printOutput}\r\n>` : 'OK\r\n>';
        }

        await this.inject(response);
    }

    // -----------------------------------------------------------------------
    // Finalize a pending file write into the virtual FS
    // -----------------------------------------------------------------------

    private finalizeFileWrite(): void {
        if (this.pendingWritePath === null) return;

        const count = this.pendingWriteByteCount > 0
            ? Math.min(this.pendingWriteByteCount, this.pendingWriteAccumulator.length)
            : this.pendingWriteAccumulator.length;

        const content = new TextDecoder().decode(
            new Uint8Array(this.pendingWriteAccumulator.slice(0, count)),
        );

        const fs = loadFS();
        fs.files[this.pendingWritePath] = content;
        saveFS(fs);

        this.pendingWritePath = null;
        this.pendingWriteByteCount = 0;
        this.pendingWriteAccumulator = [];
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private extractPrintOutput(code: string): string {
        const lines: string[] = [];
        const re = /print\(\s*["']([^"']*)["']\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
            lines.push(m[1]);
        }
        return lines.length > 0 ? lines.join('\r\n') + '\r\n' : '';
    }

    private async inject(data: string): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        this.readData(this.textEncoder.encode(data));
    }
}
