import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const mongoDataDir = path.resolve(rootDir, 'backend', 'mongo_data');

function waitForPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          socket.destroy();
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          socket.destroy();
          setTimeout(tryConnect, 400);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 400);
        }
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

async function runTests() {
  console.log('>>> [TEST RUNNER] Spawning local MongoDB test instance...');
  const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe';
  const mongoProc = spawn(mongodPath, [
    '--dbpath', mongoDataDir,
    '--port', '27017',
    '--bind_ip', '127.0.0.1'
  ], {
    stdio: 'ignore'
  });

  mongoProc.on('error', (err) => {
    console.error('Failed to spawn mongod:', err);
    process.exit(1);
  });

  try {
    await waitForPort(27017, '127.0.0.1', 20000);
    console.log('>>> [TEST RUNNER] MongoDB is ready. Running node test suite...\n');

    const testProc = spawn('node', ['--test', 'tests/*.test.js'], {
      cwd: path.resolve(rootDir, 'backend'),
      stdio: 'inherit'
    });

    testProc.on('exit', (code) => {
      console.log(`\n>>> [TEST RUNNER] Tests finished with exit code: ${code}`);
      mongoProc.kill();
      process.exit(code || 0);
    });
  } catch (err) {
    console.error('Test runner failure:', err.message);
    mongoProc.kill();
    process.exit(1);
  }
}

runTests();

