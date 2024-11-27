const express = require('express');
const CDP = require('chrome-remote-interface');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const waitOn = require('wait-on');

const app = express();
app.use(express.json());

const opts = {
  resources: ['tcp:localhost:9222'],
  interval: 100,
  tcpTimeout: 100
};

function getStartChromeCommand(width, height) {
  return 'DISPLAY=:1.0 /bin/sh -c ' +
    '"/opt/google/chrome/google-chrome ' +
    '--window-position=0,0 ' +
    `--window-size=${width + 1},${height + 1} ` +
    '--remote-debugging-port=9222 ' +
    '--no-first-run ' +
    '--no-default-browser-check ' +
    '--start-fullscreen ' +
    '--kiosk ' +
    '--disable-gpu ' +
    '--no-sandbox ' +
    '--disable-extensions ' +
    '--autoplay-policy=no-user-gesture-required ' +
    '--allow-running-insecure-content ' +
    '--disable-features=TranslateUI ' +
    '--disable-dev-shm-usage"';
}

function getStartRecordingCommand(width, height, duration, filename) {
  return 'ffmpeg -y ' +
    '-f x11grab ' +
    '-draw_mouse 0 ' +
    `-s ${width}x${height} ` +
    '-thread_queue_size 4096 ' +
    '-i :1 ' +
    '-f alsa ' +
    '-i default ' +
    '-c:v libx264 ' +
    '-tune zerolatency ' +
    '-preset ultrafast ' +
    '-v info ' +
    '-bufsize 5952k ' +
    '-acodec aac ' +
    '-pix_fmt yuv420p ' +
    '-r 30 ' +
    '-crf 17 ' +
    '-g 60 ' +
    '-strict -2 ' +
    '-ar 44100 ' +
    `-t ${duration} ` +
    `/recordings/${filename}`;
}

async function fireChrome(url, width, height) {
  await exec(getStartChromeCommand(width, height));
  await waitOn(opts);
  const client = await CDP();
  const { Network, Page } = client;

  Network.requestWillBeSent((params) => {
    console.log(`Requested URL: ${params.request.url}`);
  });

  await Network.enable();
  await Page.enable();
  await Page.navigate({ url });
  await Page.loadEventFired();
  console.log('All assets are loaded');
  
  return client;
}

async function fireRecorder(width, height, duration, filename) {
  console.log('Firing recorder');
  await exec(getStartRecordingCommand(width, height, duration, filename));
  console.log('Recording completed');
}

// REST API endpoints
app.post('/api/record', async (req, res) => {
  const {
    url,
    width = process.env.OUTPUT_VIDEO_WIDTH || 1280,
    height = process.env.OUTPUT_VIDEO_HEIGHT || 720,
    duration = 60,
    filename = `recording-${Date.now()}.mp4`
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    let client;
    try {
      client = await fireChrome(url, width, height);
      await fireRecorder(width, height, duration, filename);
      
      res.json({
        status: 'success',
        filename,
        message: 'Recording completed successfully'
      });
    } finally {
      if (client) {
        await client.close();
      }
      // Cleanup Chrome process
      try {
        await exec('pkill chrome');
      } catch (e) {
        console.log('Chrome cleanup error:', e);
      }
    }
  } catch (error) {
    console.error('Recording failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Get list of recordings
app.get('/api/recordings', async (req, res) => {
  try {
    const { stdout } = await exec('ls -l /recordings');
    res.json({
      status: 'success',
      recordings: stdout.split('\n').filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video recorder API running on port ${PORT}`);
});