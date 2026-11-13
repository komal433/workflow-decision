import dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { RetryService } from './services/retryService.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const mongoDataDir = path.resolve(rootDir, 'backend', 'mongo_data');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform';

function checkPortOpen(port = 27017, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function waitForPort(port = 27017, host = '127.0.0.1', timeoutMs = 45000) {
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
          reject(new Error('Timed out waiting for MongoDB to initialize. If running manually, start mongod first.'));
        } else {
          socket.destroy();
          setTimeout(tryConnect, 500);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for MongoDB to initialize.'));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

async function bootstrap() {
  let spawnedMongo = null;

  try {
    const isMongoReady = await checkPortOpen(27017);
    if (!isMongoReady) {
      logger.info('MongoDB instance not detected on port 27017. Spawning local instance automatically...');
      
      if (!fs.existsSync(mongoDataDir)) {
        fs.mkdirSync(mongoDataDir, { recursive: true });
      }

      const lockFile = path.join(mongoDataDir, 'mongod.lock');
      if (fs.existsSync(lockFile)) {
        try { fs.unlinkSync(lockFile); } catch (e) {}
      }

      const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe';
      spawnedMongo = spawn(mongodPath, [
        '--dbpath', mongoDataDir,
        '--port', '27017',
        '--bind_ip', '127.0.0.1'
      ], { stdio: 'ignore' });

      logger.info('Waiting for MongoDB to recover checkpoints and listen on port 27017...');
      await waitForPort(27017);
      logger.info('Local MongoDB instance spawned and listening on port 27017.');
    } else {
      logger.info('Connected to existing MongoDB on port 27017.');
    }

    await connectDB(MONGODB_URI);

    // Auto-seed basic config if database is empty so dashboard works out of the box
    const { WorkflowConfig } = await import('./models/WorkflowConfig.js');
    const existingConfig = await WorkflowConfig.findOne({ workflowType: 'LOAN_APPLICATION' });
    if (!existingConfig) {
      const { seedDatabase } = await import('./seeds/seed.js');
      logger.info('No workflow configuration found. Auto-seeding initial workflows...');
      await seedDatabase();
    }

    const app = createApp();
    const retryWorker = RetryService.startBackgroundWorker(5000);

    const server = app.listen(PORT, () => {
      console.log('\n' + '='.repeat(68));
      console.log(` 🚀 Workflow Decision Platform Backend is ACTIVE on port ${PORT}`);
      console.log(` 🌐 Web Dashboard: http://localhost:${PORT}`);
      console.log(` 🩺 Health Check:   http://localhost:${PORT}/api/health`);
      console.log('='.repeat(68) + '\n');
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      clearInterval(retryWorker);
      server.close(async () => {
        await disconnectDB();
        if (spawnedMongo) {
          spawnedMongo.kill();
        }
        logger.info('Server process terminated.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start application server', { error: err.message });
    if (spawnedMongo) {
      spawnedMongo.kill();
    }
    process.exit(1);
  }
}

bootstrap();
