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
          setTimeout(tryConnect, 500);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

async function run() {
  console.log('Spawning mongod at:', mongoDataDir);
  const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe';
  const mongoProc = spawn(mongodPath, [
    '--dbpath', mongoDataDir,
    '--port', '27017',
    '--bind_ip', '127.0.0.1'
  ]);

  mongoProc.stdout.on('data', (data) => {
    console.log('[MONGOD]:', data.toString().trim());
  });

  mongoProc.stderr.on('data', (data) => {
    console.error('[MONGOD STDERR]:', data.toString().trim());
  });

  mongoProc.on('exit', (code) => {
    console.log(`[MONGOD EXITED] with code: ${code}`);
  });

  try {
    console.log('Waiting for port 27017...');
    await waitForPort(27017, '127.0.0.1', 20000);
    console.log('MongoDB is online! Running seedDatabase()...');

    const { seedDatabase } = await import('./src/seeds/seed.js');
    await seedDatabase();
    console.log('>>> SEED COMPLETE! <<<');
  } catch (err) {
    console.error('Runner error:', err.message);
  } finally {
    console.log('Shutting down mongod...');
    mongoProc.kill();
  }
}

run();
