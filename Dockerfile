FROM ubuntu:bionic

ENV OUTPUT_VIDEO_WIDTH=1280
ENV OUTPUT_VIDEO_HEIGHT=720

# Add s6-overlay
ADD https://github.com/just-containers/s6-overlay/releases/download/v2.0.0.1/s6-overlay-amd64.tar.gz /tmp/
RUN tar xzf /tmp/s6-overlay-amd64.tar.gz -C / && \
    rm /tmp/s6-overlay-amd64.tar.gz

# Create apps user
RUN useradd apps && \
    mkdir -p /home/apps && \
    chown apps:apps /home/apps

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    software-properties-common \
    curl \
    gpg-agent \
    dbus \
    dbus-x11 \
    xvfb \
    pulseaudio \
    ffmpeg \
    nodejs \
    npm \
    libnss3 \
    libgconf-2-4 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# Create necessary directories
RUN mkdir -p /recordings && \
    mkdir -p /var/run/dbus && \
    mkdir -p /run/dbus && \
    chown apps:apps /recordings

# Copy application files
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Set up dbus
RUN dbus-uuidgen > /var/lib/dbus/machine-id

# Cleanup unnecessary packages
RUN apt-get purge -y curl gpg-agent && \
    apt-get autoremove -y && \
    apt-get clean

ENV DBUS_SESSION_BUS_ADDRESS=unix:path=/var/run/dbus/system_bus_socket

VOLUME ["/recordings"]
EXPOSE 3000

ENTRYPOINT ["/init"]
CMD ["/app/entrypoint.sh"]