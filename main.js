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
  tcpTimeout: 1000,
  timeout: 10000
};

function getStartChromeCommand(width, height) {
  return `google-chrome \
    --headless \
    --disable-gpu \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --no-sandbox \
    --window-size=${width},${height} \
    --remote-debugging-port=9222 \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=TranslateUI \
    --disable-extensions \
    --mute-audio`;
}

function getStartRecordingCommand(width, height, duration, filename) {
  return `ffmpeg -y \
    -f x11grab \
    -draw_mouse 0 \
    -s ${width}x${height} \
    -r 30 \
    -i :1 \
    -f alsa \
    -i default \
    -c:v libx264 \
    -preset ultrafast \
    -pix_fmt yuv420p \
    -crf 17 \
    -c:a aac \
    -strict experimental \
    -t ${duration} \
    /recordings/${filename}`;
}

async function fireChrome(url, width, height) {
  console.log(`Launching Chrome for URL: ${url}`);
  try {
    const chromeCmd = getStartChromeCommand(width, height);
    console.log('Chrome command:', chromeCmd);
    
    await exec(chromeCmd);
    console.log('Chrome process started');

    await waitOn(opts);
    console.log('Chrome debugging port ready');

    const client = await CDP();
    const { Network, Page } = client;

    await Network.enable();
    await Page.enable();
    
    console.log('Navigating to URL...');
    await Page.navigate({ url });
    await Page.loadEventFired();
    console.log('Page loaded successfully');

    // Wait for network idle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return client;
  } catch (error) {
    console.error('Error in fireChrome:', error);
    throw error;
  }
}


async function fireRecorder(width, height, duration, filename) {
  console.log('Starting recorder...');
  try {
    const cmd = getStartRecordingCommand(width, height, duration, filename);
    console.log('FFmpeg command:', cmd);
    
    const process = exec(cmd);
    console.log('FFmpeg process started');

    // Add timeout for recording
    const timeout = duration * 1000 + 5000; // Duration plus 5 seconds buffer
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Recording timeout')), timeout);
    });

    await Promise.race([process, timeoutPromise]);
    console.log('Recording completed');
  } catch (error) {
    console.error('Error in fireRecorder:', error);
    throw error;
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
    // Check if Chrome or ffmpeg is already running
    try {
      await exec('pgrep chrome || pgrep ffmpeg');
      return res.status(409).json({ error: 'A recording is already in progress' });
    } catch {
      // No existing processes, continue
    }

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
      } catch (e) {
        console.log('Error closing CDP client:', e);
      }
    }
    try {
      await exec('pkill chrome; pkill ffmpeg');
    } catch (e) {
      console.log('Cleanup error:', e);
    }
  }
});

// Add a status endpoint
app.get('/api/status', async (req, res) => {
  try {
    await exec('pgrep chrome || pgrep ffmpeg');
    res.json({ status: 'recording' });
  } catch {
    res.json({ status: 'idle' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video recorder API running on port ${PORT}`);
});