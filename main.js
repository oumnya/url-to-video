const express = require('express');
const CDP = require('chrome-remote-interface');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const waitOn = require('wait-on');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

function getStartChromeCommand(width, height) {
  return [
    'google-chrome',
    '--headless',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-sandbox',
    `--window-size=${width},${height}`,
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--mute-audio',
    '--disable-setuid-sandbox',
    '--disable-accelerated-2d-canvas',
    '--disable-notifications',
    '--disable-dbus'  // Add this to disable D-Bus dependency
  ];
}

function getStartRecordingCommand(width, height, duration, filename) {
  return `ffmpeg -y \
    -f x11grab \
    -draw_mouse 0 \
    -s ${width}x${height} \
    -r 30 \
    -i :1 \
    -f pulse \
    -ac 2 \
    -i default \
    -acodec aac \
    -strict experimental \
    -c:v libx264 \
    -preset ultrafast \
    -pix_fmt yuv420p \
    -movflags +faststart \
    -crf 23 \
    -t ${duration} \
    /recordings/${filename}`;
}

async function setupPulseAudio() {
  try {
    await exec('pulseaudio -D --system');
    await exec('pacmd load-module module-null-sink sink_name=DummyOutput');
    await exec('pacmd set-default-sink DummyOutput');
    console.log('PulseAudio setup completed');
  } catch (error) {
    console.log('PulseAudio setup error (non-fatal):', error);
  }
}

async function waitForPort(port, timeout) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await exec(`nc -z localhost ${port}`);
      return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

async function fireChrome(url, width, height) {
  console.log(`Launching Chrome for URL: ${url}`);
  
  // Kill any existing Chrome instances
  try {
    await exec('pkill chrome || true');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.log('No existing Chrome process to kill');
  }

  return new Promise((resolve, reject) => {
    const args = getStartChromeCommand(width, height);
    console.log('Starting Chrome with args:', args.join(' '));
    
    const chrome = spawn('google-chrome', args, {
      stdio: 'pipe',
      env: { ...process.env, DISPLAY: ':1' }
    });

    let output = '';

    chrome.stdout.on('data', (data) => {
      output += data.toString();
      console.log('Chrome stdout:', data.toString());
    });

    chrome.stderr.on('data', (data) => {
      output += data.toString();
      console.log('Chrome stderr:', data.toString());
    });

    chrome.on('error', (err) => {
      console.error('Failed to start Chrome:', err);
      reject(err);
    });

    // Wait for Chrome to start and CDP to be available
    waitForPort(9222, 10000)
      .then(async () => {
        try {
          console.log('Chrome debug port is available');
          const client = await CDP();
          console.log('CDP client connected');
          
          const { Network, Page } = client;
          await Network.enable();
          await Page.enable();
          
          console.log('Navigating to URL...');
          await Page.navigate({ url });
          await Page.loadEventFired();
          console.log('Page loaded successfully');
          
          resolve(client);
        } catch (error) {
          console.error('CDP connection failed:', error);
          reject(error);
        }
      })
      .catch((error) => {
        console.error('Port wait failed:', error, '\nChrome output:', output);
        chrome.kill();
        reject(error);
      });

    // Set a global timeout
    setTimeout(() => {
      chrome.kill();
      reject(new Error('Chrome startup timeout'));
    }, 20000);
  });
}

async function fireRecorder(width, height, duration, filename) {
  console.log('Starting recorder...');
  try {
    await setupPulseAudio();
    const cmd = getStartRecordingCommand(width, height, duration, filename);
    console.log('FFmpeg command:', cmd);
    
    return new Promise((resolve, reject) => {
      const ffmpeg = exec(cmd);
      
      ffmpeg.stdout.on('data', (data) => {
        console.log('FFmpeg stdout:', data);
      });
      
      ffmpeg.stderr.on('data', (data) => {
        console.log('FFmpeg stderr:', data);
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('Recording completed successfully');
          resolve();
        } else {
          console.error('FFmpeg exited with code:', code);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      // Set timeout
      setTimeout(() => {
        ffmpeg.kill();
        resolve();
      }, (duration + 2) * 1000);
    });
  } catch (error) {
    console.error('Error in fireRecorder:', error);
    throw error;
  }
}

async function cleanup() {
  try {
    await exec('pkill -f chrome || true');
    await exec('pkill -f ffmpeg || true');
    await exec('pkill -f Xvfb || true');
    await exec('pkill -f pulseaudio || true');
  } catch (error) {
    console.log('Cleanup warning (non-fatal):', error);
  }
}

app.post('/api/record', async (req, res) => {
  console.log('Received recording request:', req.body);
  
  const {
    url,
    width = parseInt(process.env.OUTPUT_VIDEO_WIDTH) || 1280,
    height = parseInt(process.env.OUTPUT_VIDEO_HEIGHT) || 720,
    duration = 10,
    filename = `recording-${Date.now()}.mp4`
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let client;
  try {
    client = await fireChrome(url, width, height);
    await fireRecorder(width, height, duration, filename);
    
    res.json({
      status: 'success',
      filename,
      message: 'Recording completed successfully'
    });
  } catch (error) {
    console.error('Recording failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      details: error.stack
    });
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.log('Error closing CDP client:', error);
      }
    }
    await cleanup();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video recorder API running on port ${PORT}`);
});