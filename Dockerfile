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
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome (updated method)
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    apt-get update && \
    apt-get install -y ./google-chrome-stable_current_amd64.deb && \
    rm google-chrome-stable_current_amd64.deb && \
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