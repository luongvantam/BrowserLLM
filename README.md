# BrowserLLM — Gemma 3 1B Browser AI

Ứng dụng chạy **Google Gemma 3 1B-IT** (`onnx-community/gemma-3-1b-it-ONNX`) trực tiếp trên trình duyệt, thanh tiến độ nạp gọn gàng và hỗ trợ đọc file đầu vào.

## Đặc điểm chính

1. **Tối ưu cho Static Hosting (mọi file `<= 20 MB`)**
   - Mọi file model (bao gồm `tokenizer.json`, `onnx/model_q4.onnx_data`, `onnx/model_int8.onnx`) được cắt thành các mảnh `<= 20,000,000` bytes (`<= 20 MB`), dễ dàng triển khai trên các nền tảng static hosting có giới hạn kích thước từng file.
   - Plugin Vite trong `vite.config.js` tự loại bỏ file `.wasm` > 20 MB không dùng trong `dist/assets/` (runtime ORT WASM được nạp từ jsDelivr CDN có sẵn `Cross-Origin-Resource-Policy: cross-origin`).
   - File `public/_headers` bật `Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp` để kích hoạt WASM đa luồng trên các host hỗ trợ `_headers`.

2. **Không lưu trọng số hay dữ liệu người dùng trên máy (RAM-Only Streaming)**
   - Tắt hoàn toàn `env.useBrowserCache` và `env.useWasmCache`; tự dọn sạch mọi cache cũ nếu có.
   - `src/worker/chunked-fetch.js` tải từng mảnh với `{ cache: 'no-store' }` qua cửa sổ trượt 4 mảnh và đẩy thẳng vào `ReadableStream`, giải phóng buffer ngay sau khi enqueue.
   - Lịch sử chat chỉ tồn tại trong RAM của tab hiện tại (không dùng `localStorage` / `IndexedDB` / `Cache API`), đóng tab hoặc bấm **Giải phóng RAM** là sạch hoàn toàn.

3. **Chạy trên mọi thiết bị hỗ trợ WebGPU hoặc WASM**
   - **WebGPU (`q4`, ~859 MB)**: ưu tiên tự động khi trình duyệt có GPU hỗ trợ WebGPU.
   - **WASM CPU (`int8`, ~1.0 GB)**: tự động fallback khi thiết bị không có WebGPU hoặc WebGPU lỗi (dùng file `model_int8.onnx` tương thích đầy đủ kernel CPU của `onnxruntime-web` WASM).

## Lệnh sử dụng

```bash
# 1. Cài dependencies
npm install

# 2. Tải Gemma 3 1B-IT & cắt thành các mảnh <= 20 MB
npm run prepare-model

# 3. Kiểm tra SHA-256 toàn bộ mảnh
npm run verify-chunks

# 4. Chạy dev local
npm run dev

# 5. Build & kiểm tra giới hạn <= 20 MB cho mọi file trong dist/
npm run build
npm run verify-dist

# 6. Xem trước bản production
npm run preview
```

## Giấy phép

Mã nguồn dự án được phát hành theo giấy phép **MIT** — xem chi tiết trong file [LICENSE](LICENSE).
Mô hình **Google Gemma 3 1B-IT** tuân theo *Gemma Terms of Use* của Google.
