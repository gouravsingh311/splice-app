const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

/**
 * PRODUCTION-QUALITY ELECTRON MAIN PROCESS
 * Focus: Security, Robust Process Management, & Shared-Secret Authentication
 */

let backendProcess;
let mainWindow;
const INTERNAL_SECRET = crypto.randomBytes(32).toString('hex');
let backendUrl = '';

/**
 * Finds a free port for the backend to bind to.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Launches the FastAPI backend process.
 */
async function launchBackend() {
  const port = await findFreePort();
  backendUrl = `http://127.0.0.1:${port}`;
  
  const isDev = !app.isPackaged;
  const binaryPath = isDev ? 'python' : path.join(process.resourcesPath, 'splice_api');
  
  // In dev, we point to the entrypoint; in prod, we run the pre-compiled binary.
  const args = isDev 
    ? ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', port.toString()] 
    : ['--port', port.toString()];

  backendProcess = spawn(binaryPath, args, {
    env: { 
      ...process.env, 
      SPLICE_INTERNAL_SECRET: INTERNAL_SECRET,
      SPLICE_ENV: isDev ? 'development' : 'production'
    },
    stdio: 'pipe',
    windowsHide: true // Prevents flashing console windows in production
  });

  backendProcess.stdout.on('data', (data) => console.log(`[Backend STDOUT]: ${data}`));
  backendProcess.stderr.on('data', (data) => console.error(`[Backend STDERR]: ${data}`));

  backendProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      dialog.showErrorBox('Backend Error', `The application backend exited unexpectedly with code ${code}.`);
      app.quit();
    }
  });
}

/**
 * Health check polling to wait until the backend is fully initialized.
 */
async function waitForBackend(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${url}/health/ready`);
      if (res.ok) return true;
    } catch (e) {
      // Still booting...
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Backend failed to start within timeout.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true, // MANDATORY
      nodeIntegration: false,  // MANDATORY
      sandbox: true,           // MANDATORY
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // Load the frontend
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../web/dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(async () => {
  try {
    await launchBackend();
    await waitForBackend(backendUrl);
    createWindow();
  } catch (err) {
    dialog.showErrorBox('Startup Failed', err.message);
    app.quit();
  }
});

// Implementation of internal API routing
ipcMain.handle('api-call', async (event, { path: apiPath, payload, method = 'GET' }) => {
  const url = `${backendUrl}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': INTERNAL_SECRET
    },
    body: method !== 'GET' ? JSON.stringify(payload) : undefined
  });
  return response.json();
});

// Presenter Mode Toggle Handler
ipcMain.on('toggle-presenter-mode', (event, enabled) => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('privacy-changed', enabled);
  });
});

app.on('before-quit', () => {
  if (backendProcess) {
    // Graceful shutdown: SIGTERM allows FastAPI to run cleanup
    backendProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
