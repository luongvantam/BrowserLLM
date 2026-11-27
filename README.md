# BrowserLLM — Qwen3-4B-Thinking Browser AI (WebGPU & WASM)

Ứng dụng chạy **Qwen3-4B-Thinking-2507** (`onnx-community/Qwen3-4B-Thinking-2507-ONNX`, LiveCodeBench v6 **55.2%**, Codeforces **1852 Elo**) trực tiếp trên trình duyệt với giao diện ChatGPT-style, thanh tiến độ tự động nạp khi mở trang và hỗ trợ đọc file đầu vào.

## Đặc điểm chính

1. **Tự động nạp khi mở trang & Cache thông minh**
   - Mở trang là tự động nạp và cache từng mảnh để lần sau mở lại không phải tải lại nhiều gigabyte.
   - **WebGPU (`q4`)**: chạy `Qwen3-4B-Thinking-2507` (~2.91 GB) tăng tốc bằng GPU.
   - **WASM CPU fallback (`q8`)**: tự động chuyển sang `Qwen2.5-Coder-1.5B-Instruct` trên các máy không có WebGPU.
2. **Hỗ trợ tách mảnh `<= 20 MB` cho Static Hosting**
   - `scripts/prepare-model.mjs` tự động cắt mọi file vượt quá `20,000,000` bytes (`<= 20 MB`).
   - Nếu host không kèm sẵn `/models/`, ứng dụng tự động stream trực tiếp từ Hugging Face.
3. **Hiển thị khối suy luận `<think>...</think>` & Code Block**
   - Tách riêng phần suy luận của `Qwen3-4B-Thinking` vào khung thu gọn và làm nổi bật lời giải/code có nút sao chép.

## Lệnh sử dụng

```bash
npm install
npm run dev

# Tùy chọn: tải & cắt mảnh <= 20 MB để tự host
npm run prepare-model
npm run verify-chunks

# Build production (mọi file trong dist/ <= 20 MB)
npm run build
npm run verify-dist
```

## Giấy phép

Mã nguồn dự án phát hành theo giấy phép **MIT** ([LICENSE](LICENSE)).
Các mô hình Qwen phát hành theo giấy phép **Apache-2.0**.
