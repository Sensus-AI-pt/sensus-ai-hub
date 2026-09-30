const { contextBridge, ipcRenderer } = require('electron');

// O preload corre em sandbox — o comportamento por omissão desde o Electron 20 —
// e o `require` só serve 'electron', 'events', 'timers' e 'url'. Um
// require('fs') aqui rebenta o preload inteiro em silêncio, e sem ele não há
// `window.electronAPI` nenhum. O que precisar do disco pede-se ao processo
// principal por IPC.

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // CSV export (TouchDesigner live feed)
    writeCSV: (filePath, content) => ipcRenderer.send('write-csv', filePath, content),

    // Desktop path resolution
    getDesktopPath: () => ipcRenderer.invoke('get-desktop-path'),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    writeBinaryFile: (filePath, base64Data) => ipcRenderer.invoke('write-binary-file', filePath, base64Data),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),

    // Pipeline control
    launchRPPG:  (camera) => ipcRenderer.invoke('launch-rppg', camera),
    installDeps: () => ipcRenderer.invoke('install-deps'),
    generateSingleImage: (params) => ipcRenderer.invoke('generate-single-image', params),
    listCameraDevices: () => ipcRenderer.invoke('list-camera-devices'),

    // Send command to Python stdin (e.g. "CALIBRATE", "QUIT")
    sendRPPGCommand: (cmd) => ipcRenderer.send('rppg-command', cmd),

    // Multimodalidade local — Whisper STT (ditado) e Piper TTS (voz bio-ativa)
    transcribeAudio: (base64Audio, mime) => ipcRenderer.invoke('stt-transcribe', base64Audio, mime),
    speakText: (text, voz) => ipcRenderer.invoke('piper-speak', text, voz),

    // Trigger secondary display window
    openProjection: () => ipcRenderer.send('open-projection'),

    // Cenário da janela de projeção (imagem de fundo por trás do efeito 3D).
    // O painel de controlo e a projeção são janelas distintas, por isso o estado
    // passa pelo processo principal em vez de estado partilhado no renderer.
    setProjectionBackground: (payload) => ipcRenderer.send('set-projection-background', payload),
    onProjectionBackground: (callback) => ipcRenderer.on('projection-background', (event, payload) => callback(payload)),

    // Espelhamento horizontal/vertical da janela de projeção
    setProjectionFlip: (payload) => ipcRenderer.send('set-projection-flip', payload),
    onProjectionFlip: (callback) => ipcRenderer.on('projection-flip', (event, payload) => callback(payload)),

    // Preset do ambiente Fluid AI (física do fluido + pedido de limpar a tela)
    setProjectionFluid: (payload) => ipcRenderer.send('set-projection-fluid', payload),
    onProjectionFluid: (callback) => ipcRenderer.on('projection-fluid', (event, payload) => callback(payload)),

    // Toggle fullscreen on the calling window
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),

    // Abrir um link externo no browser padrão do sistema (ex.: página de preços)
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Listeners — structured JSON data from Python
    onRPPGData: (callback) => ipcRenderer.on('rppg-data', (event, data) => callback(data)),

    // Listeners — log messages (stderr + non-JSON stdout)
    onRPPGLog: (callback) => ipcRenderer.on('rppg-log', (event, text) => callback(text)),

    // Listener — process exit
    onRPPGExit: (callback) => ipcRenderer.on('rppg-exit', (event, code) => callback(code)),

    // Listener — projection window closed
    onProjectionClosed: (callback) => ipcRenderer.on('projection-closed', (event) => callback()),
});

window.addEventListener('DOMContentLoaded', () => {
    console.log("Sensus AI Hub preloaded.");
});
