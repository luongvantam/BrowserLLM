# BrowserLLM — Server-Side AI Chat (0 MB Client Download)

Ứng dụng chat AI giao diện phong cách ChatGPT, **chạy model trên Backend Server** (`server/index.mjs`) để người dùng mở web lên là sử dụng ngay lập tức mà **không cần tải 800 MB – 2 GB về trình duyệt**.

## Kiến trúc

- **Backend Server (`server/index.mjs`)**:
  - Hỗ trợ **chế độ tự chạy trực tiếp bằng Node.js** (`@huggingface/transformers` + `onnxruntime-node` / `onnxruntime-web` fallback), tự tải & lưu cache model trên ổ đĩa server (`.model-cache/server-hf/`) và stream token qua SSE (`POST /api/chat`).
  - Hỗ trợ **chế độ kết nối Upstream API** (Ollama / vLLM / OpenAI-compatible) qua biến môi trường `LLM_API_URL` (ví dụ `http://127.0.0.1:11434/v1`) và `MODEL_ID` (ví dụ `qwen3:4b`).
  - Phục vụ trực tiếp bản build tĩnh `dist/` trong production (`npm start`).
- **Frontend (`src/`)**:
  - Bố cục 2 sidebar trái/phải, hỗ trợ đính kèm & đọc file code/văn bản đầu vào, nút Gửi/Dừng hợp nhất, khối `<think>...</think>` thu gọn và hộp thoại Cài đặt (UI, Cá nhân hóa & Dữ liệu, Giấy phép MIT).

## Cách chạy

```bash
# 1. Cài dependencies
npm install

# 2. Build frontend
npm run build

# 3. Chạy server (mở http://localhost:3001)
npm start
```

### Tùy chọn biến môi trường cho Server

```bash
# Chạy model ONNX trực tiếp trên server (mặc định: Qwen2.5-Coder-1.5B-Instruct q4)
MODEL_ID="onnx-community/Qwen3-4B-Thinking-2507-ONNX" MODEL_DTYPE="q4" npm start

# Hoặc nối vào Ollama / vLLM chạy sẵn trên server GPU
LLM_API_URL="http://127.0.0.1:11434/v1" MODEL_ID="qwen3:4b" npm start
```

### Chạy môi trường dev (Vite + Server song song)

```bash
# Terminal 1: chạy AI server ở cổng 3001
npm run server

# Terminal 2: chạy Vite dev server (tự proxy /api -> :3001)
npm run dev
```

## Giấy phép

Mã nguồn dự án phát hành theo giấy phép **MIT** ([LICENSE](LICENSE)).
