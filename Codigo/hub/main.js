const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFileSync } = require('child_process');

// Portáteis com gráficos híbridos (Intel + NVIDIA) escolhem a Intel por omissão.
// O switch do Chromium é só um pedido; a escolha real da GPU no Windows é feita
// pela preferência por-executável do DXGI (a mesma que Definições > Gráficos usa),
// gravada no registo — sem ela o processo de GPU continua a abrir na Intel.
app.commandLine.appendSwitch('force_high_performance_gpu');
// A legenda do estado na janela de projeção é falada pelo Piper e tocada com um
// `new Audio(...)` numa janela aberta por código, que nunca recebe um clique.
//
// Isto **não** era a causa do silêncio — essa era o `caminhoCurto`, ver a nota
// junto dessa função. Reproduzido a 2026-09-17 num Electron desta versão, com
// uma janela criada por código e sem interação nenhuma: o `play()` de um
// `data:audio/wav` resolve e o áudio anda (currentTime 1,37 s depois de 1,5 s)
// **com e sem** este switch. Fica como salvaguarda de uma linha, porque a
// autoplay policy do Chromium já mudou de omissão mais do que uma vez e uma
// sala muda em exposição custa mais do que isto. Não é a correção.
// https://developer.chrome.com/blog/autoplay/
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform === 'win32') {
    try {
        execFileSync('reg', [
            'add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences',
            '/v', process.execPath,
            '/t', 'REG_SZ',
            '/d', 'GpuPreference=2;',
            '/f'
        ], { windowsHide: true });
    } catch (err) {
        console.error('Falha ao definir preferência de GPU (registo):', err.message);
    }
}

let rppgProcess = null;
let pendingSingleGen = null; // pedido generate-single-image à espera de resposta do engine
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: "Sensus AI — Console de Monitorização",
        icon: path.join(__dirname, 'icon.ico'),
        show: false,
        backgroundColor: '#060814',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Sem isto o Chromium suspende os temporizadores e a composição
            // desta janela quando ela fica tapada ou sem foco — que é o estado
            // normal da projeção, com o operador a trabalhar no painel. Medido
            // a 2026-09-17 numa janela não visível: uma transição de 300 ms
            // ficava parada no valor inicial indefinidamente. Numa peça que
            // corre sozinha num segundo ecrã, isso é a legenda a desvanecer aos
            // saltos, o aceno a congelar e o ciclo de 15 s da locução a andar
            // ao ritmo que o sistema decidir.
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        // Maximizada, nao em ecra inteiro: mantem a barra de titulo e a barra de
        // tarefas acessiveis. maximize() antes de show() evita o salto visual de
        // aparecer a 1400x900 e so depois crescer.
        mainWindow.maximize();
        mainWindow.show();
    });
}

// ═══════════ IPC: Write CSV to disk (TouchDesigner live feed) ═══════════
ipcMain.on('write-csv', (event, filePath, content) => {
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
    } catch (err) {
        console.error('CSV write error:', err.message);
    }
});

// ═══════════ IPC: Get desktop path ═══════════
ipcMain.handle('get-desktop-path', () => {
    return app.getPath('desktop');
});

// ═══════════ IPC: Open external URL (browser padrão do sistema) ═══════════
ipcMain.handle('open-external', (event, url) => {
    const { shell } = require('electron');
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        return { success: false, error: 'URL inválido' };
    }
    shell.openExternal(url);
    return { success: true };
});

function getPythonExecutionConfig() {
    const isPackaged = app.isPackaged;
    let pythonExecutable;
    let scriptPath;
    let cwdPath;

    if (isPackaged) {
        // Python autocontido (base Python 3.11 + site-packages sobreposto). Substitui o
        // rppg_env, cujo pyvenv.cfg tinha caminhos absolutos da máquina de desenvolvimento
        // e por isso não arrancava noutro PC.
        pythonExecutable = path.join(process.resourcesPath, 'python-standalone', 'python.exe');
        scriptPath = path.join(process.resourcesPath, 'engine_sensus_unificado.py');
        cwdPath = process.resourcesPath;
    } else {
        pythonExecutable = path.join(__dirname, '..', 'motor', 'rppg_env', 'Scripts', 'python.exe');
        scriptPath = path.join(__dirname, '..', 'motor', 'engine_sensus_unificado.py');
        cwdPath = path.join(__dirname, '..', 'motor');
    }

    return { pythonExecutable, scriptPath, cwdPath };
}

const mainLogFile = path.join(app.getPath('desktop'), 'sensus_main.log');
function logMain(msg) {
    try {
        fs.appendFileSync(mainLogFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
    } catch (e) {}
}

// ═══════════ IPC: List available cameras/phones ═══════════
ipcMain.handle('list-camera-devices', () => {
    const { pythonExecutable, scriptPath, cwdPath } = getPythonExecutionConfig();
    if (!fs.existsSync(pythonExecutable) || !fs.existsSync(scriptPath)) {
        return { cameras: [] };
    }
    return new Promise((resolve) => {
        const proc = spawn(pythonExecutable, ['-u', scriptPath, '--list-cameras'], { cwd: cwdPath });
        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.on('close', () => {
            try {
                resolve(JSON.parse(out.trim()));
            } catch (e) {
                resolve({ cameras: [] });
            }
        });
        proc.on('error', () => resolve({ cameras: [] }));
    });
});

// ═══════════ IPC: Launch/Stop Python pipeline ═══════════
ipcMain.handle('launch-rppg', (event, cameraSource) => {
    logMain(`launch-rppg called with cameraSource: ${cameraSource}`);
    if (rppgProcess) {
        logMain("rppgProcess already exists. Killing it...");
        rppgProcess.kill('SIGINT');
        rppgProcess = null;
        return { success: true, status: 'stopped' };
    }

    const { pythonExecutable, scriptPath, cwdPath } = getPythonExecutionConfig();
    logMain(`Resolved config: python="${pythonExecutable}"\nscript="${scriptPath}"\ncwd="${cwdPath}"`);

    if (!fs.existsSync(pythonExecutable)) {
        logMain(`ERRO CRÍTICO: Executável do Python não encontrado em: "${pythonExecutable}"`);
        return { success: false, error: `Python não encontrado: ${pythonExecutable}` };
    }
    if (!fs.existsSync(scriptPath)) {
        logMain(`ERRO CRÍTICO: Script unificado não encontrado em: "${scriptPath}"`);
        return { success: false, error: `Script não encontrado: ${scriptPath}` };
    }

    try {
        const logFile = path.join(app.getPath('desktop'), 'sensus_engine.log');
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        logStream.write(`\n=== INICIANDO PIPELINE: ${new Date().toISOString()} ===\n`);

        const camera = cameraSource || 'pc';
        logMain(`Spawning: "${pythonExecutable}" with args ["-u", "${scriptPath}", "--camera", "${camera}"]`);
        rppgProcess = spawn(pythonExecutable, ['-u', scriptPath, '--camera', camera], {
            cwd: cwdPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
        logMain(`Spawned successfully with PID: ${rppgProcess.pid}`);

        // ─── STDOUT: Parse JSON data lines, forward rest as logs ───
        let stdoutBuffer = '';
        rppgProcess.stdout.on('data', (chunk) => {
            logStream.write(chunk);
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('{')) {
                    try {
                        const data = JSON.parse(trimmed);
                        // Resposta de geração única (SINGLE_GEN) — resolve o pedido IPC
                        // pendente em vez de fazer broadcast do payload pesado
                        if (data.single_gen) {
                            if (pendingSingleGen) {
                                const p = pendingSingleGen;
                                pendingSingleGen = null;
                                clearTimeout(p.timer);
                                p.resolve(data.single_gen.status === 'success'
                                    ? { success: true, image_ia: data.single_gen.image_ia }
                                    : { success: false, error: data.single_gen.error });
                            }
                            continue;
                        }
                        // Broadcast to both windows
                        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                            mainWindow.webContents.send('rppg-data', data);
                        }
                        if (projectionCameraWindow && !projectionCameraWindow.isDestroyed() && !projectionCameraWindow.webContents.isDestroyed()) {
                            projectionCameraWindow.webContents.send('rppg-data', data);
                        }
                        if (projectionAIWindow && !projectionAIWindow.isDestroyed() && !projectionAIWindow.webContents.isDestroyed()) {
                            projectionAIWindow.webContents.send('rppg-data', data);
                        }
                    } catch (e) {
                        // Not valid JSON, send as log
                        const text = trimmed + '\n';
                        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                            mainWindow.webContents.send('rppg-log', text);
                        }
                        if (projectionCameraWindow && !projectionCameraWindow.isDestroyed() && !projectionCameraWindow.webContents.isDestroyed()) {
                            projectionCameraWindow.webContents.send('rppg-log', text);
                        }
                        if (projectionAIWindow && !projectionAIWindow.isDestroyed() && !projectionAIWindow.webContents.isDestroyed()) {
                            projectionAIWindow.webContents.send('rppg-log', text);
                        }
                    }
                } else {
                    const text = trimmed + '\n';
                    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                        mainWindow.webContents.send('rppg-log', text);
                    }
                    if (projectionCameraWindow && !projectionCameraWindow.isDestroyed() && !projectionCameraWindow.webContents.isDestroyed()) {
                        projectionCameraWindow.webContents.send('rppg-log', text);
                    }
                    if (projectionAIWindow && !projectionAIWindow.isDestroyed() && !projectionAIWindow.webContents.isDestroyed()) {
                        projectionAIWindow.webContents.send('rppg-log', text);
                    }
                }
            }
        });

        // ─── STDERR: Always forward as log messages ───
        rppgProcess.stderr.on('data', (data) => {
            logStream.write(data);
            const text = data.toString();
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('rppg-log', text);
            }
            if (projectionCameraWindow && !projectionCameraWindow.isDestroyed() && !projectionCameraWindow.webContents.isDestroyed()) {
                projectionCameraWindow.webContents.send('rppg-log', text);
            }
            if (projectionAIWindow && !projectionAIWindow.isDestroyed() && !projectionAIWindow.webContents.isDestroyed()) {
                projectionAIWindow.webContents.send('rppg-log', text);
            }
        });

        // ─── Process exit ───
        rppgProcess.on('close', (code) => {
            logMain(`rppgProcess exited with code: ${code}`);
            logStream.write(`\n=== PIPELINE TERMINADO COM CODIGO: ${code} ===\n`);
            logStream.end();
            rppgProcess = null;
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('rppg-exit', code);
            }
            if (projectionCameraWindow && !projectionCameraWindow.isDestroyed() && !projectionCameraWindow.webContents.isDestroyed()) {
                projectionCameraWindow.webContents.send('rppg-exit', code);
            }
            if (projectionAIWindow && !projectionAIWindow.isDestroyed() && !projectionAIWindow.webContents.isDestroyed()) {
                projectionAIWindow.webContents.send('rppg-exit', code);
            }
        });

        return { success: true, status: 'running' };
    } catch (err) {
        console.error("Failed to spawn Python:", err);
        return { success: false, error: err.message };
    }
});

// ═══════════ IPC: Send command to Python stdin ═══════════
ipcMain.on('rppg-command', (event, command) => {
    const label = (command || '').split(' ')[0];
    if (rppgProcess && rppgProcess.stdin && !rppgProcess.stdin.destroyed) {
        logMain(`rppg-command: ${label} (${command.length} chars) -> enviado`);
        rppgProcess.stdin.write(command + '\n');
    } else {
        logMain(`rppg-command: ${label} (${command.length} chars) -> IGNORADO (rppgProcess indisponivel)`);
    }
});

// ═══════════ IPC: Toggle Fullscreen ═══════════
ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setFullScreen(!win.isFullScreen());
    }
});

// ═══════════ IPC: Open Projection Window ═══════════
let projectionCameraWindow = null;
let projectionAIWindow = null;

function checkAllProjectionsClosed() {
    if (!projectionCameraWindow && !projectionAIWindow) {
        if (rppgProcess) {
            logMain("Ambas as janelas do Ambiente Virtual foram fechadas pelo utilizador. Parando rppgProcess...");
            rppgProcess.kill('SIGINT');
            rppgProcess = null;
        }

        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('projection-closed');
        }
    }
}

// Cenário da janela de projeção. Guardado aqui para que uma janela aberta depois
// de o utilizador escolher a imagem receba na mesma o estado atual.
let projectionBackground = { url: null, enabled: false };

// Espelhamento da janela de projeção. Útil quando se projeta contra um espelho
// ou por retroprojeção, em que a imagem chega invertida ao público.
let projectionFlip = { h: false, v: false };

ipcMain.on('set-projection-flip', (event, payload) => {
    projectionFlip = { h: !!payload?.h, v: !!payload?.v };
    if (projectionCameraWindow && !projectionCameraWindow.isDestroyed()) {
        projectionCameraWindow.webContents.send('projection-flip', projectionFlip);
    }
});

// Preset do ambiente Fluid AI: a física corre na janela de projeção, mas os
// botões estão no painel de controlo, que é outra BrowserWindow. O estado passa
// por aqui, como o cenário e o espelhamento.
let projectionFluid = null;

ipcMain.on('set-projection-fluid', (event, payload) => {
    projectionFluid = payload || null;
    if (projectionCameraWindow && !projectionCameraWindow.isDestroyed()) {
        projectionCameraWindow.webContents.send('projection-fluid', projectionFluid);
    }
});

ipcMain.on('set-projection-background', (event, payload) => {
    projectionBackground = payload || { url: null, enabled: false };
    if (projectionCameraWindow && !projectionCameraWindow.isDestroyed()) {
        projectionCameraWindow.webContents.send('projection-background', projectionBackground);
    }
});

ipcMain.on('open-projection', () => {
    if (projectionCameraWindow) projectionCameraWindow.focus();
    if (projectionAIWindow) projectionAIWindow.focus();
    if (projectionCameraWindow || projectionAIWindow) return;

    // 1. Ecrã de Projeção (apenas a imagem StreamDiffusion — arrastar para o projetor)
    projectionCameraWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        title: "Sensus AI — Projeção",
        show: false,
        backgroundColor: '#060814',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Sem isto o Chromium suspende os temporizadores e a composição
            // desta janela quando ela fica tapada ou sem foco — que é o estado
            // normal da projeção, com o operador a trabalhar no painel. Medido
            // a 2026-09-17 numa janela não visível: uma transição de 300 ms
            // ficava parada no valor inicial indefinidamente. Numa peça que
            // corre sozinha num segundo ecrã, isso é a legenda a desvanecer aos
            // saltos, o aceno a congelar e o ciclo de 15 s da locução a andar
            // ao ritmo que o sistema decidir.
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    projectionCameraWindow.setMenuBarVisibility(false);
    projectionCameraWindow.loadFile('index.html', { hash: 'projection-camera' });

    projectionCameraWindow.once('ready-to-show', () => {
        projectionCameraWindow.show();
    });

    // Erros do renderer desta janela vao para o log. Sem isto, uma excecao no
    // 3D deixa a janela preta sem qualquer pista do que falhou.
    projectionCameraWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
        if (level >= 2) logMain(`[projecao] ${message} (${sourceId}:${line})`);
    });

    // Reenvia o cenário guardado assim que a janela termina de carregar.
    projectionCameraWindow.webContents.on('did-finish-load', () => {
        if (projectionCameraWindow && !projectionCameraWindow.isDestroyed()) {
            projectionCameraWindow.webContents.send('projection-background', projectionBackground);
            projectionCameraWindow.webContents.send('projection-flip', projectionFlip);
            if (projectionFluid) projectionCameraWindow.webContents.send('projection-fluid', projectionFluid);
        }
    });

    projectionCameraWindow.on('closed', () => {
        projectionCameraWindow = null;
        if (projectionAIWindow) {
            projectionAIWindow.close();
        }
        checkAllProjectionsClosed();
    });

    // 2. Painel de Controlo do Ambiente Virtual (câmaras + parâmetros + controlos)
    projectionAIWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Sensus AI — Painel de Controlo (Ambiente Virtual)",
        show: false,
        backgroundColor: '#060814',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Sem isto o Chromium suspende os temporizadores e a composição
            // desta janela quando ela fica tapada ou sem foco — que é o estado
            // normal da projeção, com o operador a trabalhar no painel. Medido
            // a 2026-09-17 numa janela não visível: uma transição de 300 ms
            // ficava parada no valor inicial indefinidamente. Numa peça que
            // corre sozinha num segundo ecrã, isso é a legenda a desvanecer aos
            // saltos, o aceno a congelar e o ciclo de 15 s da locução a andar
            // ao ritmo que o sistema decidir.
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    projectionAIWindow.setMenuBarVisibility(false);
    projectionAIWindow.loadFile('index.html', { hash: 'projection-ai' });

    projectionAIWindow.once('ready-to-show', () => {
        projectionAIWindow.show();
    });

    projectionAIWindow.on('closed', () => {
        projectionAIWindow = null;
        if (projectionCameraWindow) {
            projectionCameraWindow.close();
        }
        checkAllProjectionsClosed();
    });
});

// ═══════════ IPC: Install dependencies ═══════════
ipcMain.handle('install-deps', (event) => {
    const { pythonExecutable, cwdPath } = getPythonExecutionConfig();
    const pipPath = path.join(path.dirname(pythonExecutable), 'pip.exe');

    try {
        // scrcpy-client declara av<10 nas suas deps, mas essa gama não tem wheel
        // pré-compilada para Windows/py3.11 (obriga a compilar de fonte e falha) —
        // instala-se sem deps depois de garantir av 18 (testado e compatível).
        const proc1 = spawn(pipPath, ['install', 'mediapipe', 'pillow', 'pygrabber', 'av==18.0.0', 'adbutils'], { cwd: cwdPath });
        proc1.stdout.on('data', (data) => { event.sender.send('rppg-log', data.toString()); });
        proc1.stderr.on('data', (data) => { event.sender.send('rppg-log', data.toString()); });
        proc1.on('close', () => {
            const proc2 = spawn(pipPath, ['install', '--no-deps', 'scrcpy-client'], { cwd: cwdPath });
            proc2.stdout.on('data', (data) => { event.sender.send('rppg-log', data.toString()); });
            proc2.stderr.on('data', (data) => { event.sender.send('rppg-log', data.toString()); });
            proc2.on('close', (code) => {
                event.sender.send('rppg-log', `\n[Sensus AI] Instalação concluída (código: ${code})\n`);
            });
        });

        return { success: true };
    } catch (err) {
        console.error("Failed to run pip:", err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    return await dialog.showSaveDialog(win, options);
});

ipcMain.handle('write-binary-file', async (event, filePath, base64Data) => {
    try {
        const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
        return { success: true };
    } catch (err) {
        console.error('File write error:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        // Apenas ficheiros gerados pela app (gravações/registos) — nunca outros
        const allowed = ['.webm', '.csv', '.txt'];
        if (!allowed.includes(path.extname(filePath).toLowerCase())) {
            return { success: false, error: 'Extensão não permitida.' };
        }
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { success: true };
    } catch (err) {
        console.error('File delete error:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('generate-single-image', async (event, params) => {
    const fs = require('fs');
    const { spawn } = require('child_process');

    // Guardar imagem de referência (se existir) num ficheiro temporário
    let tempImgPath = null;
    if (params.refImage) {
        try {
            const cleanBase64 = params.refImage.replace(/^data:image\/\w+;base64,/, "");
            const tempDir = path.join(app.getPath('temp'), 'sensus_temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            tempImgPath = path.join(tempDir, `ref_${Date.now()}.jpg`);
            fs.writeFileSync(tempImgPath, Buffer.from(cleanBase64, 'base64'));
        } catch (e) {
            console.error("Failed to write temporary reference image:", e);
        }
    }

    // Caminho rápido: engine já em execução com o modelo carregado — pedir por stdin.
    // (O caminho antigo arrancava um 2.º processo que recarregava o modelo e disputava
    // a VRAM com o engine ativo — demorava minutos e podia nunca responder.)
    if (rppgProcess && rppgProcess.stdin && !rppgProcess.stdin.destroyed) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (pendingSingleGen) {
                    pendingSingleGen = null;
                    resolve({ success: false, error: 'Tempo esgotado na geração (180 s)' });
                }
            }, 180000);
            pendingSingleGen = { resolve, timer };
            const payload = {
                prompt: params.prompt || 'Ambiente sensorial calmo',
                cfg: params.cfg || 1.0,
                steps: params.steps || 4,
                seed: params.seed || 2252004,
                denoising: params.denoising || 0.65,
                ref_image: tempImgPath,
            };
            rppgProcess.stdin.write('SINGLE_GEN ' + JSON.stringify(payload) + '\n');
        });
    }

    // Fallback: sem engine ativo — processo dedicado (carrega o modelo, ~60-90 s)
    return new Promise((resolve) => {
        const { pythonExecutable, scriptPath, cwdPath } = getPythonExecutionConfig();

        const args = [
            '-u',
            scriptPath,
            '--single-gen',
            '--prompt', params.prompt || 'Ambiente sensorial calmo',
            '--cfg', String(params.cfg || 1.0),
            '--steps', String(params.steps || 4),
            '--seed', String(params.seed || 2252004),
            '--denoising', String(params.denoising || 0.65)
        ];
        if (tempImgPath) {
            args.push('--ref-image', tempImgPath);
        }

        const proc = spawn(pythonExecutable, args, { cwd: cwdPath, env: { ...process.env, PYTHONUNBUFFERED: '1' } });

        // Sem resposta em 5 minutos: matar o processo e devolver erro claro
        // (antes a promise nunca resolvia e a UI ficava sem retorno)
        const killTimer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (e) {}
        }, 300000);
        proc.on('close', () => clearTimeout(killTimer));
        
        let stdoutData = '';
        let stderrData = '';
        
        proc.stdout.on('data', (chunk) => {
            stdoutData += chunk.toString();
        });
        
        proc.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });
        
        proc.on('close', (code) => {
            // Clean up temporary image
            if (tempImgPath && fs.existsSync(tempImgPath)) {
                try {
                    fs.unlinkSync(tempImgPath);
                } catch (err) {}
            }

            if (code !== 0) {
                console.error("Single gen failed with code:", code, stderrData);
                resolve({ success: false, error: stderrData || `Exit code ${code}` });
                return;
            }
            
            try {
                const lines = stdoutData.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('{')) {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.status === 'success') {
                            resolve({ success: true, image_ia: parsed.image_ia });
                            return;
                        } else {
                            resolve({ success: false, error: parsed.error });
                            return;
                        }
                    }
                }
                resolve({ success: false, error: "No JSON found in stdout" });
            } catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    });
});

// ═══════════ IPC: Speech-to-Text local (ditado de prompt) ═══════════
// Recebe áudio base64 (webm/wav) do renderer e manda-o transcrever pelo Whisper
// do motor Python. Substituiu o servidor Speaches em http://localhost:8000: era
// o mesmo modelo atrás de HTTP e obrigava a instalar um servidor à parte.
// Processo persistente: arranca à primeira utilização e fica vivo. Medido, um
// processo novo por ditado custava ~17 s (10,3 s só a importar cv2/mediapipe do
// motor); assim o primeiro ditado demora ~8 s e os seguintes ~1 s.
let sttProcess = null;
let sttFila = Promise.resolve();

function obterSTT() {
    if (sttProcess && !sttProcess.killed) return sttProcess;
    const { pythonExecutable, cwdPath } = getPythonExecutionConfig();
    const sttScript = path.join(cwdPath, 'stt_local.py');
    if (!fs.existsSync(pythonExecutable) || !fs.existsSync(sttScript)) return null;
    sttProcess = spawn(pythonExecutable, ['-u', sttScript], { cwd: cwdPath });
    sttProcess.stderr.on('data', (d) => logMain(`[STT] ${d.toString().trim()}`));
    sttProcess.on('exit', () => { sttProcess = null; });
    sttProcess.on('error', () => { sttProcess = null; });
    return sttProcess;
}

/** Envia um caminho e espera pela linha JSON correspondente. */
function pedirTranscricao(caminho) {
    return new Promise((resolve) => {
        const proc = obterSTT();
        if (!proc) return resolve({ success: false, error: 'Motor de transcrição não encontrado.' });
        let buffer = '';
        // 120 s cobre o arranque a frio (carregar o modelo para a VRAM).
        const timer = setTimeout(() => {
            proc.stdout.off('data', aoReceber);
            resolve({ success: false, error: 'A transcrição não respondeu a tempo.' });
        }, 120000);
        const aoReceber = (d) => {
            buffer += d.toString();
            let corte;
            while ((corte = buffer.indexOf('\n')) >= 0) {
                const linha = buffer.slice(0, corte).trim();
                buffer = buffer.slice(corte + 1);
                if (!linha.startsWith('{')) continue;
                let data;
                try { data = JSON.parse(linha); } catch (e) { continue; }
                if (data.pronto) continue;   // saudação de arranque
                clearTimeout(timer);
                proc.stdout.off('data', aoReceber);
                return resolve(data);
            }
        };
        proc.stdout.on('data', aoReceber);
        proc.stdin.write(caminho + '\n');
    });
}

ipcMain.handle('stt-transcribe', async (event, base64Audio, mime) => {
    // Ficheiro temporário na pasta temp do sistema, não na do pacote: a app pode
    // estar instalada num sítio sem permissão de escrita.
    const ext = (mime && mime.includes('wav')) ? 'wav' : 'webm';
    const tmpFile = path.join(os.tmpdir(), `sensus_ditado_${Date.now()}.${ext}`);
    // Em fila: o processo responde uma linha por pedido, e dois ditados ao mesmo
    // tempo trocariam as respostas.
    const tarefa = sttFila.then(async () => {
        try {
            const cleanBase64 = String(base64Audio).replace(/^data:[^;]+;base64,/, '');
            fs.writeFileSync(tmpFile, Buffer.from(cleanBase64, 'base64'));
            const data = await pedirTranscricao(tmpFile);
            if (!data.success) return { success: false, error: data.error || 'Falha na transcrição.' };
            if (!data.text) return { success: false, error: 'Não percebi nada do que foi dito.' };
            return { success: true, text: String(data.text).trim() };
        } catch (err) {
            logMain(`STT local falhou: ${err.message}`);
            return { success: false, error: `Falha na transcrição: ${err.message}` };
        } finally {
            try { fs.unlinkSync(tmpFile); } catch (e) {}
        }
    });
    sttFila = tarefa.catch(() => {});
    return tarefa;
});

/**
 * Nome curto 8.3 de uma pasta (C:\Users\NOMEDO~1\…), para passar a executáveis
 * que não lidam com caracteres não-ASCII. Devolve null se não der — nesse caso
 * o chamador segue com o caminho normal.
 */
// Nome curto 8.3 de um caminho, ou null se nao for possivel.
//
// Os dois detalhes abaixo nao sao decoracao — sem eles esta funcao devolvia
// lixo para *todos* os caminhos, e com isso a voz da aplicacao esteve muda
// desde que a funcao foi escrita (nem o assistente em portugues nem a legenda
// em ingles chegavam a correr o piper.exe):
//
// 1. `windowsVerbatimArguments`. Sem isto o Node poe aspas a volta do
//    argumento inteiro do `/c`, as aspas do caminho ficam aninhadas, o `cmd`
//    deixa de as reconhecer como delimitador e o `%~sI` devolve o nome do
//    ficheiro *com as aspas dentro*, prefixado pela unidade atual. Medido a
//    2026-09-17: `caminhoCurto('C:\\Windows\\System32\\notepad.exe')` devolvia
//    `D:\"C:\Windows\System32\notepad.exe\"`. Nao dependia de acentos nem de
//    espacos: falhava sempre.
// 2. Validar o resultado com `existsSync`. A string devolvida era "verdadeira"
//    para o `||` a seguir, por isso o caminho errado ganhava ao caminho certo e
//    o `spawn` morria com ENOENT dentro de um `resolve({success:false})` que
//    ninguem lia. Um caminho que nao existe passa a valer null, e o chamador
//    usa o original.
function caminhoCurto(dir) {
    try {
        if (!fs.existsSync(dir)) return null;
        const saida = execFileSync('cmd', ['/c', 'for %I in ("' + dir + '") do @echo %~sI'], {
            encoding: 'utf-8', windowsHide: true, windowsVerbatimArguments: true,
        }).trim();
        return saida && fs.existsSync(saida) ? saida : null;
    } catch (e) {
        return null;
    }
}

// ═══════════ IPC: Piper TTS — Voz Bio-Ativa (síntese local) ═══════════
// Sintetiza fala offline via piper.exe e devolve o WAV em base64 ao renderer,
// que o reproduz. Requer PIPER_EXE e PIPER_MODEL configurados.
//
// Duas vozes, um só pipeline: o assistente fala português e a legenda do estado
// na projeção fala inglês. Só muda o modelo — o `.onnx` traz a língua, e o
// espeak-ng que faz a fonética vem do mesmo sítio para as duas.
const MODELOS_PIPER = {
    pt: 'pt_PT-tugao-medium.onnx',
    en: 'en_US-amy-medium.onnx',
};

ipcMain.handle('piper-speak', async (event, text, voz) => {
    return new Promise((resolve) => {
        const idioma = voz === 'en' ? 'en' : 'pt';
        const piperExe = process.env.PIPER_EXE || path.join(process.resourcesPath || __dirname, 'piper', 'piper.exe');
        const piperModel = (idioma === 'en' ? process.env.PIPER_MODEL_EN : process.env.PIPER_MODEL)
            || path.join(process.resourcesPath || __dirname, 'piper', MODELOS_PIPER[idioma]);
        if (!fs.existsSync(piperExe) || !fs.existsSync(piperModel)) {
            resolve({ success: false, error: `Piper TTS não configurado (falta ${path.basename(piperModel)}).` });
            return;
        }
        try {
            const tmpDir = path.join(app.getPath('temp'), 'sensus_tts');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const outWav = path.join(tmpDir, `tts_${Date.now()}.wav`);
            // O piper.exe lê o modelo e o espeak-ng-data com uma API que rebenta
            // em caminhos não-ASCII ("Illegal byte sequence", reproduzido em
            // C:\Users\<nome com acentos>…), e resolve o espeak a partir da própria pasta — por
            // isso é preciso passar os três em nome curto 8.3. Verificado: com os
            // caminhos normais a síntese falha, com os curtos escreve o WAV.
            // O ficheiro de saída não sofre disto (é escrito por outra via).
            const exeCurto = caminhoCurto(piperExe) || piperExe;
            const modeloCurto = caminhoCurto(piperModel) || piperModel;
            const espeakDir = caminhoCurto(path.join(path.dirname(piperExe), 'espeak-ng-data'));
            const argsPiper = ['--model', modeloCurto, '--output_file', outWav];
            if (espeakDir) argsPiper.push('--espeak_data', espeakDir);
            const proc = spawn(exeCurto, argsPiper);
            proc.stdin.write(String(text || '')); proc.stdin.end();
            proc.on('close', () => {
                try {
                    const wav = fs.readFileSync(outWav);
                    fs.unlinkSync(outWav);
                    resolve({ success: true, wav: 'data:audio/wav;base64,' + wav.toString('base64') });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
            proc.on('error', (e) => {
                logMain(`[piper] falhou a arrancar: ${e.message}`);
                resolve({ success: false, error: e.message });
            });
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
});

// ═══════════ Cleanup on quit ═══════════
app.on('will-quit', () => {
    if (rppgProcess) {
        rppgProcess.kill('SIGINT');
    }
    if (sttProcess) {
        sttProcess.kill();
        sttProcess = null;
    }
});

// ═══════════ App Ready ═══════════
app.whenReady().then(() => {
    // Limpar cache Chromium no arranque para evitar assets locais desatualizados
    session.defaultSession.clearCache();

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') return callback(true);
        callback(false);
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Travar falhas globais não capturadas para evitar encerramentos/bloqueios silenciosos
process.on('uncaughtException', (err) => {
    logMain(`Uncaught Exception: ${err.message}\nStack: ${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    logMain(`Unhandled Rejection at: ${promise}\nReason: ${reason}`);
});
