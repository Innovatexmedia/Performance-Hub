# Backend Setup & Development

## 1. Install / Run Redis

If Redis is not already installed, use one of the following options.

### macOS

```bash
brew install redis
brew services start redis
```

### Linux

```bash
sudo apt install redis-server
sudo systemctl start redis
```

### Docker

```bash
docker run -d -p 6379:6379 redis
```

---

## 2. Install Backend Dependencies

Go into the `BACKEND` directory and install the dependencies:

```bash
cd BACKEND
npm install
```

This installs the required packages, including:

* `bullmq`
* `ioredis`
* Socket.IO adapter/emitter dependencies

---

## 3. Run the API Server

Start the backend API server:

```bash
npm run dev
```

Keep this terminal running.

---

## 4. Run the Worker

Open a **separate terminal**, go to the `BACKEND` directory, and start the worker process:

```bash
cd BACKEND
npm run worker
```

Keep the worker terminal running.

---

## 5. Run ngrok

Open another **separate terminal** and expose the API server running on port `4001`:

```bash
./ngrok http 4001
```

ngrok will provide a public URL that can be used to access the local API server.

---

## Terminal Setup

You should have the following processes running:

### Terminal 1 — Redis

```bash
redis-server
```

Or if using Docker:

```bash
docker run -d -p 6379:6379 redis
```

### Terminal 2 — API Server

```bash
cd BACKEND
npm run dev
```

### Terminal 3 — Worker

```bash
cd BACKEND
npm run worker
```

### Terminal 4 — ngrok

```bash
./ngrok http 4001
```

All required services should remain running during development.
