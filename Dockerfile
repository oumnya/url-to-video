FROM ubuntu:bionic

ENV OUTPUT_VIDEO_WIDTH=1280
ENV OUTPUT_VIDEO_HEIGHT=720

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    dbus \
    dbus-x11 \
    xvfb \
    pulseaudio \
    ffmpeg \
    nodejs \
    npm \
    netcat \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# Create directories and set up D-Bus
RUN mkdir -p /var/run/dbus && \
    mkdir -p /recordings && \
    chown -R messagebus:messagebus /var/run/dbus && \
    dbus-uuidgen > /etc/machine-id

# Copy application files
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Volume for recordings
VOLUME ["/recordings"]

# Start script
RUN echo '#!/bin/bash\n\
dbus-daemon --system --fork\n\
./entrypoint.sh' > /app/start.sh && \
    chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]